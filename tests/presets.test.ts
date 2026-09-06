import { describe, expect, it } from 'vitest'
import {
  PLAN_PRESETS,
  WARNING_PRESETS,
  planForWindow,
  presetForThresholds,
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
    expect(planForWindow('chatgpt', DEFAULT_WINDOWS.chatgpt)?.id).toBe('plus')
    expect(planForWindow('claude', DEFAULT_WINDOWS.claude)?.id).toBe('default')
    expect(planForWindow('gemini', DEFAULT_WINDOWS.gemini)?.id).toBe('free')
  })

  it('every plan window round-trips to its own plan', () => {
    for (const [platform, plans] of Object.entries(PLAN_PRESETS)) {
      for (const plan of plans) {
        expect(planForWindow(platform as 'chatgpt', plan.window)?.id).toBe(plan.id)
      }
    }
  })

  it('returns null for a custom window size', () => {
    expect(planForWindow('chatgpt', 64_000)).toBeNull()
  })

  it('windows are strictly increasing per platform so labels stay unambiguous', () => {
    for (const plans of Object.values(PLAN_PRESETS)) {
      const windows = plans.map((p) => p.window)
      expect(new Set(windows).size).toBe(windows.length)
    }
  })
})
