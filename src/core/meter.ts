import { estimateTokens } from './estimator'
import type { Thresholds } from './constants'
import type { ChatMessage } from '../platforms/types'

export type Level = 'ok' | 'amber' | 'red'

export interface MeterState {
  tokens: number
  exact: boolean
  window: number
  /** 0..1, capped — never above 100% even if the estimate overshoots. */
  pct: number
  level: Level
  messages: number
  /**
   * True while the first full read of this conversation is still in flight —
   * the badge shows "measuring" instead of a number we know is unreliable
   * (e.g. virtualized old chats, where a DOM-only count is off by an order
   * of magnitude). Correctness-first: never display a known-wrong value.
   */
  measuring: boolean
}

export function classify(pct: number, thresholds: Thresholds): Level {
  if (pct >= thresholds.red) return 'red'
  if (pct >= thresholds.amber) return 'amber'
  return 'ok'
}

export function computeState(
  messages: ChatMessage[],
  windowSize: number,
  exactTokens: number | null,
  thresholds: Thresholds,
): MeterState {
  const heuristic = messages.reduce((n, m) => n + estimateTokens(m.text), 0)
  const tokens = exactTokens ?? heuristic
  const pct = windowSize > 0 ? Math.min(1, tokens / windowSize) : 0
  return {
    tokens,
    exact: exactTokens !== null,
    window: windowSize,
    pct,
    level: classify(pct, thresholds),
    messages: messages.length,
    measuring: false,
  }
}

/**
 * Rough "messages left" reading, like a fuel gauge. Only meaningful once the
 * conversation has enough turns to average over.
 */
export function messagesLeftEstimate(state: MeterState): number | null {
  if (state.messages < 4 || state.tokens <= 0) return null
  const avg = state.tokens / state.messages
  if (avg <= 0) return null
  return Math.max(0, Math.floor((state.window - state.tokens) / avg))
}
