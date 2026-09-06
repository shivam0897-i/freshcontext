import { describe, expect, it } from 'vitest'
import { classify, computeState, messagesLeftEstimate } from '../src/core/meter'
import { DEFAULT_THRESHOLDS } from '../src/core/constants'
import type { ChatMessage } from '../src/platforms/types'

const msgs: ChatMessage[] = [
  { role: 'user', text: 'hello world, this is a message about dashboards' },
  { role: 'assistant', text: 'Sure — here is a reply about dashboards and charts.' },
]

describe('classify', () => {
  it('green below amber', () => {
    expect(classify(0.1, DEFAULT_THRESHOLDS)).toBe('ok')
    expect(classify(0.69, DEFAULT_THRESHOLDS)).toBe('ok')
  })
  it('amber between thresholds', () => {
    expect(classify(0.7, DEFAULT_THRESHOLDS)).toBe('amber')
    expect(classify(0.84, DEFAULT_THRESHOLDS)).toBe('amber')
  })
  it('red at and above red threshold', () => {
    expect(classify(0.85, DEFAULT_THRESHOLDS)).toBe('red')
    expect(classify(1, DEFAULT_THRESHOLDS)).toBe('red')
  })
})

describe('computeState', () => {
  it('uses heuristic when no exact count is given', () => {
    const s = computeState(msgs, 1000, null, DEFAULT_THRESHOLDS)
    expect(s.exact).toBe(false)
    expect(s.tokens).toBeGreaterThan(0)
    expect(s.messages).toBe(2)
  })

  it('uses exact count when provided', () => {
    const s = computeState(msgs, 1000, 750, DEFAULT_THRESHOLDS)
    expect(s.exact).toBe(true)
    expect(s.tokens).toBe(750)
    expect(s.pct).toBeCloseTo(0.75)
    expect(s.level).toBe('amber')
  })

  it('caps pct at 1 even when tokens exceed the window', () => {
    const s = computeState(msgs, 100, 999, DEFAULT_THRESHOLDS)
    expect(s.pct).toBe(1)
    expect(s.level).toBe('red')
  })

  it('handles a zero window without dividing by zero', () => {
    const s = computeState(msgs, 0, 100, DEFAULT_THRESHOLDS)
    expect(s.pct).toBe(0)
  })
})

describe('messagesLeftEstimate', () => {
  it('returns null for short conversations', () => {
    const s = computeState(msgs, 100_000, null, DEFAULT_THRESHOLDS)
    expect(messagesLeftEstimate(s)).toBeNull()
  })

  it('estimates remaining messages once there is enough history', () => {
    const many: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(450), // exactly 100 heuristic tokens each → 1000 total
    }))
    const s = computeState(many, 2000, null, DEFAULT_THRESHOLDS)
    expect(s.tokens).toBe(1000)
    expect(messagesLeftEstimate(s)).toBe(10)
  })
})
