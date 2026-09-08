import { describe, expect, it } from 'vitest'
import { createMeterEngine, type MeterRequest } from '../src/core/meter-engine'
import type { MeterState } from '../src/core/meter'
import type { ChatMessage } from '../src/platforms/types'

/**
 * Every scenario here is a real bug reported during development:
 * fluctuating readings, stale counts after chat switches, virtualized tails,
 * mid-render flicker, out-of-order reads, settings changes needing reload.
 */

function harness(windowSize = 1000) {
  const displays: MeterState[] = []
  const requests: MeterRequest[] = []
  const engine = createMeterEngine({
    platform: 'chatgpt',
    settings: { windowSize, thresholds: { amber: 0.7, red: 0.85 } },
    onDisplay: (d) => displays.push({ ...d }),
    onRequestFullRead: (r) => requests.push({ ...r }),
  })
  const last = (): MeterState => displays[displays.length - 1] as MeterState
  const msg = (text: string, role: 'user' | 'assistant' = 'user'): ChatMessage => ({ role, text })
  // 'x'.repeat(450) is exactly 100 heuristic tokens.
  const big = (n = 1) => msg('x'.repeat(450 * n))
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? big() : big()))
  return { engine, displays, requests, last, msg, msgs }
}

describe('correctness-first: measuring before the first full read', () => {
  it('shows measuring — never a number — until the first full read lands', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(3) })
    expect(h.last().measuring).toBe(true)
    expect(h.last().pct).toBe(0)
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]?.urgency).toBe('initial')
  })

  it('replaces measuring with the exact reading once the full read lands', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(3) })
    h.engine.dispatch({
      type: 'fullRead',
      readId: 1,
      url: 'u1',
      messages: h.msgs(10),
      tokens: 1000,
      exact: true,
    })
    expect(h.last().measuring).toBe(false)
    expect(h.last().tokens).toBe(1000)
    expect(h.last().exact).toBe(true)
    expect(h.last().messages).toBe(10)
    expect(h.last().pct).toBe(1)
    expect(h.last().level).toBe('red')
  })
})

describe('anti-fluctuation (virtualized tails must not downgrade the reading)', () => {
  it('keeps the full reading when a later DOM snapshot sees only the rendered tail', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(4) })
    h.engine.dispatch({
      type: 'fullRead',
      readId: 1,
      url: 'u1',
      messages: h.msgs(10),
      tokens: 1000,
      exact: true,
    })
    const before = h.last()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(4) }) // virtualized tail
    expect(h.last().tokens).toBe(before.tokens)
    expect(h.last().messages).toBe(10)
    expect(h.last().exact).toBe(true)
  })

  it('anchors growth to the baseline: exact baseline + estimated delta', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(10) })
    h.engine.dispatch({
      type: 'fullRead',
      readId: 1,
      url: 'u1',
      messages: h.msgs(10),
      tokens: 1000,
      exact: true,
    })
    // Two new messages beyond the baseline: 1000 + 2×100 estimated.
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(12) })
    expect(h.last().tokens).toBe(1200)
    expect(h.last().messages).toBe(12)
    expect(h.last().exact).toBe(false) // anchored, but the delta is an estimate
  })

  it('re-baselines to exact after the next full read of a grown conversation', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(10) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(10), tokens: 1000, exact: true })
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(12) })
    h.engine.dispatch({ type: 'fullRead', readId: 2, url: 'u1', messages: h.msgs(12), tokens: 1200, exact: true })
    expect(h.last().tokens).toBe(1200)
    expect(h.last().exact).toBe(true)
  })
})

describe('staleness is rejected at one choke point', () => {
  it('drops a full read that completed after the user switched chats', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(5) })
    h.engine.dispatch({
      type: 'fullRead',
      readId: 1,
      url: 'u1',
      messages: h.msgs(20),
      tokens: 2000,
      exact: true,
    })
    h.engine.dispatch({ type: 'snapshot', url: 'u2', messages: h.msgs(2) })
    // Late result for the OLD conversation arrives now:
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(21), tokens: 2100, exact: true })
    expect(h.last().measuring).toBe(true) // u2 still waiting on its own read
  })

  it('drops out-of-order full reads (older readId after a newer accepted one)', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(5) })
    h.engine.dispatch({ type: 'fullRead', readId: 2, url: 'u1', messages: h.msgs(20), tokens: 2000, exact: true })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(10), tokens: 1000, exact: true })
    expect(h.last().tokens).toBe(2000) // newer reading kept
  })

  it('never lets a less complete read replace a fuller baseline of the same conversation', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(5) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(20), tokens: 2000, exact: true })
    h.engine.dispatch({ type: 'fullRead', readId: 2, url: 'u1', messages: h.msgs(15), tokens: 1500, exact: true })
    expect(h.last().tokens).toBe(2000)
    expect(h.last().messages).toBe(20)
  })
})

describe('new-chat reset (SPA navigation)', () => {
  it('resets immediately when switching to an empty conversation', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(10) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(10), tokens: 1000, exact: true })
    h.engine.dispatch({ type: 'snapshot', url: 'u2', messages: [] })
    const s = h.last()
    expect(s.messages).toBe(0)
    expect(s.tokens).toBe(0)
    expect(s.measuring).toBe(false) // empty chat is a KNOWN state, not "measuring"
  })

  it('does not flash "New chat" on a single mid-render empty blip', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(6) })
    h.engine.dispatch({
      type: 'fullRead',
      readId: 1,
      url: 'u1',
      messages: h.msgs(6),
      tokens: 600,
      exact: true,
    })
    const before = h.last()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: [] }) // transient blip
    expect(h.last()).toEqual(before)
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: [] }) // still empty next poll
    expect(h.last().messages).toBe(0)
  })

  it('shows measuring again after switching to a different non-empty conversation', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(6) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(6), tokens: 600, exact: true })
    h.engine.dispatch({ type: 'snapshot', url: 'u2', messages: h.msgs(3) })
    expect(h.last().measuring).toBe(true)
    expect(h.requests[h.requests.length - 1]?.urgency).toBe('initial')
  })
})

describe('poll churn', () => {
  it('does nothing when consecutive snapshots are identical', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(5) })
    const displays = h.displays.length
    const requests = h.requests.length
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(5) })
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(5) })
    expect(h.displays.length).toBe(displays)
    expect(h.requests.length).toBe(requests)
  })
})

describe('settings changes apply live (no page re-read)', () => {
  it('recomputes the display when the window size changes', () => {
    const h = harness(1000)
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(10) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(10), tokens: 800, exact: true })
    expect(h.last().pct).toBe(0.8)
    expect(h.last().level).toBe('amber')
    h.engine.dispatch({ type: 'settings', settings: { windowSize: 2000 } })
    expect(h.last().pct).toBe(0.4)
    expect(h.last().level).toBe('ok')
    expect(h.last().window).toBe(2000)
  })

  it('re-renders the warning level on a thresholds-only change (level is compared)', () => {
    const h = harness(1000)
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(10) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(10), tokens: 800, exact: true })
    expect(h.last().level).toBe('amber') // 0.8 with balanced thresholds
    // Switch to Strict (amber 0.55, red 0.7): tokens/window/messages unchanged.
    h.engine.dispatch({
      type: 'settings',
      settings: { thresholds: { amber: 0.55, red: 0.7 } },
    })
    expect(h.last().level).toBe('red') // must re-render, not suppress as a no-op
  })

  it('empty-chat states carry the window provenance label', () => {
    const h = harness(1000)
    h.engine.dispatch({
      type: 'settings',
      settings: { windowSize: 1_000_000, windowLabel: '1M · DETECTED' },
    })
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: [] })
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: [] })
    expect(h.last().messages).toBe(0)
    expect(h.last().windowLabel).toBe('1M · DETECTED')
  })

  it('carries the window provenance label through to the display', () => {
    const h = harness(1000)
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(10) })
    h.engine.dispatch({ type: 'fullRead', readId: 1, url: 'u1', messages: h.msgs(10), tokens: 800, exact: true })
    h.engine.dispatch({
      type: 'settings',
      settings: { windowSize: 500_000, windowLabel: '500K DETECTED' },
    })
    expect(h.last().window).toBe(500_000)
    expect(h.last().windowLabel).toBe('500K DETECTED')
    expect(h.last().pct).toBeCloseTo(800 / 500_000)
  })
})

describe('degraded counting', () => {
  it('falls back to a heuristic baseline when exact counting fails (tokens null)', () => {
    const h = harness()
    h.engine.dispatch({ type: 'snapshot', url: 'u1', messages: h.msgs(3) })
    h.engine.dispatch({
      type: 'fullRead',
      readId: 1,
      url: 'u1',
      messages: h.msgs(10),
      tokens: null,
      exact: false,
    })
    expect(h.last().tokens).toBe(1000) // 10 × 100 heuristic
    expect(h.last().exact).toBe(false)
  })
})
