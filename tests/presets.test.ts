import { describe, expect, it } from 'vitest'
import {
  PLAN_PRESETS,
  WARNING_PRESETS,
  chatgptModeForText,
  fallbackModeForPlan,
  planById,
  planForWindow,
  presetForThresholds,
  resolveWindow,
  windowForModel,
} from '../src/core/presets'
import { DEFAULT_THRESHOLDS, DEFAULT_WINDOWS } from '../src/core/constants'

describe('warning presets', () => {
  it('the default thresholds map to the Balanced preset', () => {
    const preset = presetForThresholds(DEFAULT_THRESHOLDS)
    expect(preset?.id).toBe('balanced')
  })

  it('every preset round-trips through its own thresholds', () => {
    for (const preset of WARNING_PRESETS) {
      expect(presetForThresholds(preset.thresholds)?.id).toBe(preset.id)
    }
  })

  it('returns null for custom thresholds', () => {
    expect(presetForThresholds({ amber: 0.6, red: 0.9 })).toBeNull()
  })

  it('red is always above amber in every preset', () => {
    for (const preset of WARNING_PRESETS) {
      expect(preset.thresholds.red).toBeGreaterThan(preset.thresholds.amber)
    }
  })
})

describe('plan presets', () => {
  it('the default window for each platform maps to one of its plans', () => {
    expect(planForWindow('chatgpt', DEFAULT_WINDOWS.chatgpt)?.id).toBe('free')
    expect(planForWindow('claude', DEFAULT_WINDOWS.claude)?.id).toBe('default')
    expect(planForWindow('gemini', DEFAULT_WINDOWS.gemini)?.id).toBe('free')
  })

  it('every plan window maps back to a plan with that window', () => {
    for (const [platform, plans] of Object.entries(PLAN_PRESETS)) {
      for (const plan of plans) {
        expect(planForWindow(platform as 'chatgpt', plan.instantWindow)?.instantWindow).toBe(
          plan.instantWindow,
        )
        expect(planForWindow(platform as 'chatgpt', plan.reasoningWindow)?.reasoningWindow).toBe(
          plan.reasoningWindow,
        )
      }
    }
  })

  it('returns null for a custom window size', () => {
    expect(planForWindow('chatgpt', 64_000)).toBeNull()
  })

  it('plan ids are unique per platform', () => {
    for (const plans of Object.values(PLAN_PRESETS)) {
      const ids = plans.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('keeps plans distinct: one entry per plan, modes carried as dual windows', () => {
    const chatgptIds = PLAN_PRESETS.chatgpt.map((p) => p.id)
    expect(chatgptIds).toEqual(['free', 'go', 'plus', 'pro'])
    const byId = Object.fromEntries(PLAN_PRESETS.chatgpt.map((p) => [p.id, p]))
    // Go matches Plus context (official), Pro is strictly larger.
    expect(byId.go?.instantWindow).toBe(byId.plus?.instantWindow)
    expect(byId.go?.reasoningWindow).toBe(byId.plus?.reasoningWindow)
    expect(byId.pro?.reasoningWindow).toBeGreaterThan(byId.plus?.reasoningWindow ?? 0)
    expect(byId.free?.instantWindow).toBeLessThan(byId.go?.instantWindow ?? 0)
  })
})

describe('model window resolution (Claude, model-driven)', () => {
  it('maps Claude model text to web-app windows', () => {
    expect(windowForModel('claude', 'Claude Sonnet 5')).toEqual({ window: 1_000_000, label: '1M' })
    expect(windowForModel('claude', 'Claude Opus 5')).toEqual({ window: 1_000_000, label: '1M' })
    expect(windowForModel('claude', 'Claude Fable 5.1')).toEqual({ window: 1_000_000, label: '1M' })
    expect(windowForModel('claude', 'Claude Opus 4.6')).toEqual({ window: 500_000, label: '500K' })
    expect(windowForModel('claude', 'Claude Sonnet 4.6')).toEqual({ window: 500_000, label: '500K' })
    expect(windowForModel('claude', 'Claude Opus 4.5')).toEqual({ window: 200_000, label: '200K' })
    expect(windowForModel('claude', 'Claude Haiku 4.5')).toEqual({ window: 200_000, label: '200K' })
  })

  it('returns null for unknown models so the plan setting governs', () => {
    expect(windowForModel('claude', 'Claude Opus 6')).toBeNull()
    expect(windowForModel('claude', '')).toBeNull()
  })

  it('returns null on platforms whose window is plan-based', () => {
    expect(windowForModel('chatgpt', 'GPT-5.6 Sol')).toBeNull()
    expect(windowForModel('gemini', 'Gemini 3 Pro')).toBeNull()
  })

  it('does not confuse version substrings (word boundaries)', () => {
    expect(windowForModel('claude', 'Sonnet 45')).toBeNull()
  })
})

describe('effective window resolution (detection-first)', () => {
  it('claude: the detected model wins over the plan selection', () => {
    expect(resolveWindow('claude', 'default', 'Claude Sonnet 5')).toEqual({
      window: 1_000_000,
      label: '1M · DETECTED',
    })
  })

  it('claude: falls back to the selected plan when no model is readable', () => {
    expect(resolveWindow('claude', 'newer', null)).toEqual({ window: 500_000, label: null })
  })

  it('chatgpt: plan × detected mode — Thinking text gives the reasoning window', () => {
    expect(resolveWindow('chatgpt', 'plus', 'GPT-5.6 Thinking')).toEqual({
      window: 256_000,
      label: 'PLUS · REASONING · DETECTED',
    })
    expect(resolveWindow('chatgpt', 'plus', 'GPT Instant')).toEqual({
      window: 54_000,
      label: 'PLUS · INSTANT · DETECTED',
    })
  })

  it('chatgpt: unreadable mode falls back to the plan default (Reasoning on paid)', () => {
    expect(resolveWindow('chatgpt', 'plus', null)).toEqual({ window: 256_000, label: null })
    expect(resolveWindow('chatgpt', 'free', null)).toEqual({ window: 27_000, label: null })
    expect(fallbackModeForPlan(planById('chatgpt', 'free')!)).toBe('instant')
    expect(fallbackModeForPlan(planById('chatgpt', 'pro')!)).toBe('reasoning')
  })

  it('chatgpt: model text that names no mode is ignored, not guessed', () => {
    expect(resolveWindow('chatgpt', 'pro', 'GPT-5.6 Sol')).toEqual({ window: 400_000, label: null })
  })

  it('gemini: the plan alone determines the window', () => {
    expect(resolveWindow('gemini', 'aiplus', null)).toEqual({ window: 128_000, label: null })
  })

  it('a custom plan id resolves to nothing — the stored window governs', () => {
    expect(resolveWindow('chatgpt', 'custom', null)).toBeNull()
  })

  it('mode classification from picker text', () => {
    expect(chatgptModeForText('GPT-5.6 Thinking')).toBe('reasoning')
    expect(chatgptModeForText('GPT Instant')).toBe('instant')
    expect(chatgptModeForText('Extended thinking')).toBe('reasoning')
    expect(chatgptModeForText('GPT-5.6 Sol')).toBeNull()
  })
})
