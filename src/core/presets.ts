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
  // ChatGPT's web-app windows, now published on OpenAI's own pricing page
  // (chatgpt.com/pricing — "GPT Instant / GPT Reasoning total context
  // window" per plan) and split by model MODE within paid plans. Free's
  // reasoning window is officially "Varies", so Free users meter against
  // the Instant window. Business tracks Plus. Cross-checked 2026-09-08.
  chatgpt: [
    { id: 'free', label: 'Free', source: 'official', window: 27_000 },
    { id: 'go-instant', label: 'Go — Instant models', source: 'official', window: 54_000 },
    { id: 'go-reasoning', label: 'Go — Reasoning models', source: 'official', window: 256_000 },
    { id: 'plus-instant', label: 'Plus — Instant models', source: 'official', window: 54_000 },
    { id: 'plus-reasoning', label: 'Plus — Reasoning models', source: 'official', window: 256_000 },
    { id: 'pro-instant', label: 'Pro — Instant models', source: 'official', window: 128_000 },
    { id: 'pro-reasoning', label: 'Pro — Reasoning models', source: 'official', window: 400_000 },
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

/**
 * Active-model → context-window resolution. Only Claude's web-app window
 * depends on the model in the conversation (1M on Fable/Opus 5/Sonnet 5,
 * 500K on Opus 4.6+/Sonnet 4.6 — note the API allows 1M on those, but the
 * web app caps them at 500K per Anthropic's consumer docs; 200K otherwise).
 * ChatGPT's and Gemini's web-app windows depend on the subscription plan,
 * not the model, so their model text resolves to null and the user's plan
 * selection governs.
 */
export interface ModelWindowRule {
  pattern: RegExp
  window: number
  label: string
}

const MODEL_WINDOWS: Partial<Record<PlatformId, ModelWindowRule[]>> = {
  claude: [
    { pattern: /\b(fable|opus\s*5|sonnet\s*5)\b/i, window: 1_000_000, label: '1M' },
    { pattern: /\b(opus\s*4\.[6-9]|sonnet\s*4\.6)\b/i, window: 500_000, label: '500K' },
    { pattern: /\b(haiku|opus\s*4\.[0-5]|sonnet\s*4\.[0-5])\b/i, window: 200_000, label: '200K' },
  ],
}

/** Resolve a context window from the active model's display text, if known. */
export function windowForModel(
  platform: PlatformId,
  modelText: string,
): { window: number; label: string } | null {
  const rules = MODEL_WINDOWS[platform]
  if (!rules) return null
  for (const rule of rules) {
    if (rule.pattern.test(modelText)) return { window: rule.window, label: rule.label }
  }
  return null
}
