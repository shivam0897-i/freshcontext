import { describe, expect, it } from 'vitest'
import {
  PLAN_PRESETS,
  WARNING_PRESETS,
  planForWindow,
  presetForThresholds,
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
    // Free and Go legitimately share a window, so the reverse mapping may
    // resolve to either — what matters is it never resolves to a different
    // window size.
    for (const [platform, plans] of Object.entries(PLAN_PRESETS)) {
      for (const plan of plans) {
        expect(planForWindow(platform as 'chatgpt', plan.window)?.window).toBe(plan.window)
      }
    }
  })

  it('returns null for a custom window size', () => {
    expect(planForWindow('chatgpt', 64_000)).toBeNull()
  })

  it('plan ids are unique per platform so saved values map back unambiguously', () => {
    for (const plans of Object.values(PLAN_PRESETS)) {
      const ids = plans.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('lists the Go plan with Free-class window and splits paid plans by model mode', () => {
    const byId = Object.fromEntries(PLAN_PRESETS.chatgpt.map((p) => [p.id, p]))
    expect(byId.go?.window).toBe(byId.free?.window)
    expect(byId['plus-reasoning']?.window).toBeGreaterThan(byId['plus-instant']?.window ?? 0)
    expect(byId['pro-reasoning']?.window).toBeGreaterThan(byId['pro-instant']?.window ?? 0)
  })
})

describe('model window resolution', () => {
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
