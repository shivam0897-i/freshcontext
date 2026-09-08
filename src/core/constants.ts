export type PlatformId = 'chatgpt' | 'claude' | 'gemini'

export interface Thresholds {
  amber: number
  red: number
}

export const DEFAULT_THRESHOLDS: Thresholds = { amber: 0.7, red: 0.85 }

/**
 * Context-window defaults (tokens) per platform.
 *
 * Sources (cross-checked 2026-09-08):
 * - chatgpt: official (chatgpt.com/pricing) — Free 27K; Go/Plus 54K
 *   Instant / 256K Reasoning; Pro 128K / 400K. The default is
 *   deliberately the Free window: over-warning a paid user beats
 *   silently under-warning a free one.
 * - claude: official — 200K default; 500K (Opus 4.6+/Sonnet 4.6); 1M
 *   (Sonnet 5/Opus 5/Fable 5.1). Auto-detected from the active model.
 * - gemini: official — 32K free; 128K AI Plus; 1M AI Pro/Ultra.
 */
export const DEFAULT_WINDOWS: Record<PlatformId, number> = {
  chatgpt: 27_000,
  claude: 200_000,
  gemini: 32_000,
}

export const RESPONSE_TIMEOUT_MS = 90_000
/** How long the last assistant text must stay unchanged to count as "finished". */
export const STABLE_MS = 1_400
export const POLL_MS = 300
/** How long to wait for a composer on a freshly opened chat page. */
export const COMPOSER_WAIT_MS = 20_000
