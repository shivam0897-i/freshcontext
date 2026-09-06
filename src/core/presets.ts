import type { PlatformId, Thresholds } from './constants'

/**
 * UI-level mappings: human choices (plans, warning sensitivity) expressed as
 * the numbers the engine consumes. Storage keeps only the numbers, so these
 * presets are pure presentation — picking a plan just writes its window size.
 */

export interface WarningPreset {
  id: 'relaxed' | 'balanced' | 'strict'
  label: string
  hint: string
  thresholds: Thresholds
}

export const WARNING_PRESETS: WarningPreset[] = [
  {
    id: 'relaxed',
    label: 'Relaxed',
    hint: 'Warn only when the window is nearly full',
    thresholds: { amber: 0.8, red: 0.92 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Recommended — warns as quality starts to slip',
    thresholds: { amber: 0.7, red: 0.85 },
  },
  {
    id: 'strict',
    label: 'Strict',
    hint: 'Warn early — maximum safety margin',
    thresholds: { amber: 0.55, red: 0.7 },
  },
]

export function presetForThresholds(thresholds: Thresholds): WarningPreset | null {
  return (
    WARNING_PRESETS.find(
      (p) => p.thresholds.amber === thresholds.amber && p.thresholds.red === thresholds.red,
    ) ?? null
  )
}

export interface PlanPreset {
  id: string
  label: string
  /** How the size is known — shown so users can judge trustworthiness. */
  source: string
  window: number
}

/**
 * Per-plan context windows. ChatGPT sizes are community-measured (OpenAI
 * publishes none for the web app); Claude and Gemini sizes are official.
 */
export const PLAN_PRESETS: Record<PlatformId, PlanPreset[]> = {
  chatgpt: [
    { id: 'free', label: 'Free', source: 'community-measured', window: 16_000 },
    { id: 'plus', label: 'Plus / Business', source: 'community-measured', window: 32_000 },
    { id: 'pro', label: 'Pro', source: 'community-measured', window: 128_000 },
  ],
  claude: [
    { id: 'default', label: 'Default models', source: 'official', window: 200_000 },
    { id: 'newer', label: 'Opus 4.6+ / Sonnet 4.6', source: 'official', window: 500_000 },
    { id: 'latest', label: 'Sonnet 5 / Opus 5 / Fable 5.1', source: 'official', window: 1_000_000 },
  ],
  gemini: [
    { id: 'free', label: 'Free', source: 'official', window: 32_000 },
    { id: 'aiplus', label: 'AI Plus', source: 'official', window: 128_000 },
    { id: 'aipro', label: 'AI Pro / Ultra', source: 'official', window: 1_000_000 },
  ],
}

export const PLAN_SOURCES: Record<string, string> = {
  'community-measured': 'Community-measured — OpenAI publishes no web-app numbers.',
  official: 'Official documentation.',
}

export function planForWindow(platform: PlatformId, window: number): PlanPreset | null {
  return PLAN_PRESETS[platform].find((p) => p.window === window) ?? null
}
