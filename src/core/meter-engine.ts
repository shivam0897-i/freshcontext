import { estimateTokens } from './estimator'
import { classify, computeState, type MeterState } from './meter'
import type { PlatformId, Thresholds } from './constants'
import type { ChatMessage } from '../platforms/types'

/**
 * MeterEngine — the single source of truth for what the context badge shows.
 *
 * Design:
 * - PURE state machine. No DOM, no timers, no network. The same event
 *   sequence always produces the same display sequence, which makes every
 *   race condition a unit test instead of a live bug.
 * - Every asynchronous result enters as an event through dispatch(). Stale
 *   results are rejected at exactly one choke point (the read epoch).
 * - The engine decides WHAT to show and WHEN it wants a full read; the
 *   runtime shell (src/meter-runtime.ts) decides HOW to satisfy it.
 *
 * Correctness-first display rule:
 * - Until the first full read of a conversation lands, the badge shows a
 *   MEASURING state — never a number. A DOM-only count of a virtualized old
 *   chat can be off by an order of magnitude; displaying it would be
 *   displaying a known-wrong value.
 * - After the first full read establishes a baseline, every displayed number
 *   is ANCHORED to it: baseline + estimated delta for messages added since.
 *   (New messages always render, so the delta is sound; the raw heuristic is
 *   never shown as the value.)
 *
 * State transition spec:
 *
 *   snapshot(url, msgs) — from the cheap DOM poll:
 *     • url changed  → enter conversation: forget baseline, show measuring
 *       (empty messages: show "New chat" — an empty chat is a KNOWN state).
 *     • msgs empty, same url → flicker guard: only reset after the second
 *       consecutive empty poll (mid-render blips shouldn't flash "New chat").
 *     • identical to the last poll → no-op (no display churn, no new read).
 *     • otherwise → update the live reading and request a full read.
 *       First read of a conversation is 'initial' (fast); re-reads after
 *       changes are 'settled' (debounced until the conversation stops
 *       changing — streaming would otherwise trigger a read per poll).
 *
 *   fullRead(readId, url, msgs, tokens, exact) — from a satisfied request:
 *     • url differs from the current conversation → dropped (switched mid-read)
 *     • readId older than the last accepted read → dropped (out of order)
 *     • otherwise → becomes the baseline when at least as complete as the
 *       current one; the display re-anchors.
 *
 *   settings(...) — recomputes the display from retained readings; no
 *   page re-read needed.
 */

export interface MeterSettings {
  windowSize: number
  thresholds: Thresholds
}

/** A token reading of a conversation, however it was obtained. */
export interface Reading {
  messages: ChatMessage[]
  /** Token count for `messages` — exact or heuristic per `exact`. */
  tokens: number
  exact: boolean
}

export type MeterEvent =
  | { type: 'snapshot'; url: string; messages: ChatMessage[] }
  | {
      type: 'fullRead'
      readId: number
      url: string
      messages: ChatMessage[]
      /** Exact token count if available; null when counting failed. */
      tokens: number | null
      /** Whether `tokens` is exact (true only where the platform allows it). */
      exact: boolean
    }
  | { type: 'settings'; settings: Partial<MeterSettings> }

export interface MeterRequest {
  readId: number
  url: string
  /** initial = first read of this conversation (fast); settled = re-read after changes (debounced). */
  urgency: 'initial' | 'settled'
}

export interface MeterEngineCallbacks {
  /** Called whenever the display value changes. */
  onDisplay: (state: MeterState) => void
  /** The engine wants a full conversation read. The shell schedules it. */
  onRequestFullRead: (request: MeterRequest) => void
}

export interface MeterEngine {
  dispatch(event: MeterEvent): void
  getDisplayed(): MeterState | null
}

interface EngineState {
  platform: PlatformId
  settings: MeterSettings
  url: string | null
  live: Reading | null
  best: Reading | null
  readId: number
  lastAcceptedReadId: number
  emptyStreak: number
  lastSnapshotSignature: string | null
  displayed: MeterState | null
}

const EMPTY_STREAK_REQUIRED = 2

function heuristicReading(messages: ChatMessage[]): Reading {
  return { messages, tokens: messages.reduce((n, m) => n + estimateTokens(m.text), 0), exact: false }
}

function signatureOf(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]
  return `${messages.length}|${last?.text.length ?? 0}`
}

export function createMeterEngine(
  options: { platform: PlatformId; settings: MeterSettings } & MeterEngineCallbacks,
): MeterEngine {
  const state: EngineState = {
    platform: options.platform,
    settings: options.settings,
    url: null,
    live: null,
    best: null,
    readId: 0,
    lastAcceptedReadId: 0,
    emptyStreak: 0,
    lastSnapshotSignature: null,
    displayed: null,
  }

  function emit(next: MeterState): void {
    if (state.displayed && sameDisplay(state.displayed, next)) return
    state.displayed = next
    options.onDisplay(next)
  }

  function sameDisplay(a: MeterState, b: MeterState): boolean {
    return (
      a.tokens === b.tokens &&
      a.exact === b.exact &&
      a.window === b.window &&
      a.messages === b.messages &&
      a.measuring === b.measuring
    )
  }

  /** Display derived from the baseline (exact) plus live delta. */
  function renderAnchored(): void {
    const { best, live, settings } = state
    if (!best) {
      // No baseline yet — correctness-first: measuring, not a wrong number.
      emit({
        tokens: 0,
        exact: false,
        window: settings.windowSize,
        pct: 0,
        level: 'ok',
        messages: live?.messages.length ?? 0,
        measuring: true,
      })
      return
    }

    if (!live || live.messages.length <= best.messages.length) {
      // Baseline only: DOM is a virtualized tail of the same conversation.
      emit(
        computeState(
          best.messages,
          settings.windowSize,
          best.exact ? best.tokens : null,
          settings.thresholds,
        ),
      )
      return
    }

    // Conversation grew: baseline + estimated delta for the newest messages.
    // The rendered DOM is suffix-aligned, so the newest
    // (live − baseline) messages are the ones added since the full read.
    const deltaMessages = live.messages.slice(best.messages.length)
    const deltaTokens = deltaMessages.reduce((n, m) => n + estimateTokens(m.text), 0)
    const tokens = best.tokens + deltaTokens
    const pct = settings.windowSize > 0 ? Math.min(1, tokens / settings.windowSize) : 0
    emit({
      tokens,
      exact: best.exact && deltaTokens === 0,
      window: settings.windowSize,
      pct,
      level: classify(pct, settings.thresholds),
      messages: live.messages.length,
      measuring: false,
    })
  }

  function requestFullRead(): void {
    state.readId += 1
    options.onRequestFullRead({
      readId: state.readId,
      url: state.url as string,
      urgency: state.best ? 'settled' : 'initial',
    })
  }

  function enterConversation(url: string): void {
    state.url = url
    state.live = null
    state.best = null
    state.emptyStreak = 0
    state.lastSnapshotSignature = null
  }

  function handleSnapshot(url: string, messages: ChatMessage[]): void {
    if (state.url !== null && url !== state.url) enterConversation(url)
    state.url = url

    if (messages.length === 0) {
      state.emptyStreak++
      const firstLookAtThisUrl = state.lastSnapshotSignature === null && state.live === null
      const flickerSettled = state.emptyStreak >= EMPTY_STREAK_REQUIRED
      if (firstLookAtThisUrl || flickerSettled) {
        // An empty chat is a KNOWN state — show it (no measuring needed).
        state.live = null
        state.best = null
        state.lastSnapshotSignature = null
        emit(computeState([], state.settings.windowSize, null, state.settings.thresholds))
      }
      return
    }

    state.emptyStreak = 0
    const signature = signatureOf(messages)
    if (signature === state.lastSnapshotSignature) return // nothing changed
    state.lastSnapshotSignature = signature

    state.live = heuristicReading(messages)
    renderAnchored()
    requestFullRead()
  }

  function handleFullRead(event: Extract<MeterEvent, { type: 'fullRead' }>): void {
    if (state.url === null || event.url !== state.url) return // switched mid-read
    if (event.readId < state.lastAcceptedReadId) return // out-of-order completion
    state.lastAcceptedReadId = event.readId

    const reading: Reading = {
      messages: event.messages,
      tokens: event.tokens ?? heuristicReading(event.messages).tokens,
      exact: event.tokens !== null && event.exact,
    }
    if (!state.best || reading.messages.length >= state.best.messages.length) {
      state.best = reading
    }
    renderAnchored()
  }

  function handleSettings(patch: Partial<MeterSettings>): void {
    state.settings = { ...state.settings, ...patch }
    if (state.displayed === null) return
    if (state.best || state.live) renderAnchored()
    else emit(computeState([], state.settings.windowSize, null, state.settings.thresholds))
  }

  return {
    dispatch(event: MeterEvent): void {
      switch (event.type) {
        case 'snapshot':
          handleSnapshot(event.url, event.messages)
          return
        case 'fullRead':
          handleFullRead(event)
          return
        case 'settings':
          handleSettings(event.settings)
          return
      }
    },
    getDisplayed(): MeterState | null {
      return state.displayed
    },
  }
}
