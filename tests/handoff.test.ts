import { describe, expect, it } from 'vitest'
import { buildTranscriptHandoff } from '../src/core/handoff'
import type { ChatMessage } from '../src/platforms/types'

const CONV: ChatMessage[] = [
  { role: 'user', text: 'Build a finance dashboard.' },
  { role: 'assistant', text: 'Sure — Vite and Recharts?' },
  { role: 'user', text: 'Yes. Also add CSV import.' },
  { role: 'assistant', text: 'Done. Here is the importer:\n\n```ts\nexport function importCsv(f: File) {}\n```' },
]

describe('buildTranscriptHandoff', () => {
  it('instructs the destination AI to digest the transcript and continue', () => {
    const h = buildTranscriptHandoff('ChatGPT', CONV)
    expect(h).toContain("I'm continuing a conversation from **ChatGPT**")
    expect(h).toMatch(/write a short recap/i)
    expect(h).toMatch(/continue from where/i)
  })

  it('is Markdown-structured with role labels and a transcript section', () => {
    const h = buildTranscriptHandoff('ChatGPT', CONV)
    expect(h).toContain('## Conversation transcript (from ChatGPT)')
    expect(h).toContain('**User**: Build a finance dashboard.')
    expect(h).toContain('**ChatGPT**: Sure — Vite and Recharts?')
  })

  it('preserves code fences from the conversation (artifacts survive)', () => {
    const h = buildTranscriptHandoff('ChatGPT', CONV)
    expect(h).toContain('```ts')
  })

  it('skips empty messages', () => {
    const h = buildTranscriptHandoff('ChatGPT', [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: '   ' },
    ])
    expect(h).not.toContain('**ChatGPT**:')
  })

  it('drops the OLDEST turns when the transcript overflows and notes it', () => {
    const big: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({
      role: 'user' as const,
      text: `message-${i}: ${'x'.repeat(100)}`,
    }))
    // maxChars fits only the newest ~3 turns.
    const h = buildTranscriptHandoff('ChatGPT', big, 350)
    expect(h).toContain('message-5')
    expect(h).toContain('message-4')
    expect(h).not.toContain('message-0')
    expect(h).toMatch(/\[\d+ earlier messages omitted/)
  })

  it('always keeps at least one turn even if it alone overflows', () => {
    const h = buildTranscriptHandoff('ChatGPT', [{ role: 'user', text: 'x'.repeat(500) }], 100)
    expect(h).toContain('x'.repeat(500))
  })
})
