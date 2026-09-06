import { describe, expect, it } from 'vitest'
import { buildHandoffText, briefToText, parseBrief, SECTION_LABELS } from '../src/core/brief'

const PLAIN = `GOAL
Build a finance dashboard.

DECISIONS
Vite + Tailwind.

STATE
Auth done.`

const MARKDOWN = `## GOAL
Build a finance dashboard.

**DECISIONS**
Vite + Tailwind.

### State
Auth done.`

const DASHED = `GOAL — build a finance dashboard
DECISIONS — Vite + Tailwind
STATE — auth done`

const NO_SECTIONS = `The assistant ignored instructions and wrote a paragraph instead.`

describe('parseBrief', () => {
  it('parses plain uppercase section headers', () => {
    const s = parseBrief(PLAIN)
    expect(s['GOAL']).toContain('finance dashboard')
    expect(s['DECISIONS']).toContain('Vite')
    expect(s['STATE']).toContain('Auth')
  })

  it('parses markdown-Decorated headers case-insensitively', () => {
    const s = parseBrief(MARKDOWN)
    expect(s['GOAL']).toContain('finance dashboard')
    expect(s['DECISIONS']).toContain('Vite')
    expect(s['STATE']).toContain('Auth')
  })

  it('parses single-line dashed headers', () => {
    const s = parseBrief(DASHED)
    expect(s['GOAL']).toContain('finance dashboard')
    expect(s['DECISIONS']).toContain('Vite')
  })

  it('keeps unparseable text as a single BRIEF blob', () => {
    const s = parseBrief(NO_SECTIONS)
    expect(s['BRIEF']).toContain('ignored instructions')
    expect(Object.keys(s)).toEqual(['BRIEF'])
  })

  it('strips zero-width characters', () => {
    const s = parseBrief(`GOAL​\nDo the thing.`)
    expect(s['GOAL']).toContain('Do the thing')
  })
})

describe('briefToText', () => {
  it('rebuilds canonical text from parsed sections', () => {
    const text = briefToText(parseBrief(PLAIN))
    expect(text).toContain('GOAL\nBuild a finance dashboard.')
    expect(text).toContain('DECISIONS\nVite + Tailwind.')
  })

  it('falls back to the raw blob when no sections parsed', () => {
    const text = briefToText(parseBrief(NO_SECTIONS))
    expect(text).toBe(NO_SECTIONS)
  })
})

describe('buildHandoffText', () => {
  it('wraps the brief with a continuation header', () => {
    const text = buildHandoffText(PLAIN)
    expect(text.startsWith('I\'m continuing from a previous conversation.')).toBe(true)
    expect(text).toContain('GOAL')
  })
})

describe('SECTION_LABELS', () => {
  it('has the six canonical sections', () => {
    expect(SECTION_LABELS).toEqual([
      'GOAL',
      'DECISIONS',
      'ARTIFACTS',
      'STATE',
      'OPEN QUESTIONS',
      'PREFERENCES',
    ])
  })
})
