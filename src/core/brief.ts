export const SECTION_LABELS = [
  'GOAL',
  'DECISIONS',
  'ARTIFACTS',
  'STATE',
  'OPEN QUESTIONS',
  'PREFERENCES',
] as const

export type SectionName = (typeof SECTION_LABELS)[number]

export const DEFAULT_PROMPT = `I'm about to start a fresh conversation because this one has grown long.

Write a handoff brief that captures everything needed to continue seamlessly. Use exactly these sections:

GOAL — my goal(s) in this conversation
DECISIONS — key decisions made, and why
ARTIFACTS — important artifacts (code, text, plans); reproduce them in full
STATE — current state; what we were working on right now
OPEN QUESTIONS — unresolved issues and open threads
PREFERENCES — my preferences and constraints (style, tone, requirements)

Include anything else that matters for continuity. Output only the brief — no preamble.`

export interface BriefSections {
  [key: string]: string
}

/**
 * Lenient section parser — real models reformat headers (## GOAL, **GOAL**,
 * "Goal:", "GOAL —"), so match case-insensitively with optional markdown and
 * trailing punctuation. If nothing matches, the whole text is kept as one blob.
 */
export function parseBrief(text: string): BriefSections {
  const cleaned = text.replace(/[​‎‏]/g, '').trim()
  const sections: BriefSections = {}
  const labels = new Set<string>(SECTION_LABELS)
  let current: string | null = null
  let buf: string[] = []

  const flush = () => {
    if (current && buf.join('\n').trim()) sections[current] = buf.join('\n').trim()
    else if (current && !sections[current]) sections[current] = ''
  }

  for (const line of cleaned.split('\n')) {
    // Form 1: the header is the whole line — "## GOAL", "**GOAL:**", "GOAL —"
    const whole = line.match(/^\s*(?:#+\s*)?\**\[?([A-Za-z][A-Za-z ?]*?)\]?\**\s*[:—-]?\s*$/)
    const wholeCandidate = whole?.[1]?.toUpperCase().replace(/\s+/g, ' ').trim()
    if (wholeCandidate && labels.has(wholeCandidate)) {
      flush()
      current = wholeCandidate
      buf = []
      continue
    }
    // Form 2: inline header — "GOAL — build a dashboard" / "Goal: build it"
    const inline = line.match(/^\s*(?:#+\s*)?\**\[?([A-Za-z][A-Za-z ?]*?)\]?\**\s*[:—-]\s+(.+)$/)
    const inlineCandidate = inline?.[1]?.toUpperCase().replace(/\s+/g, ' ').trim()
    if (inlineCandidate && labels.has(inlineCandidate)) {
      flush()
      current = inlineCandidate
      buf = [inline?.[2] ?? '']
      continue
    }
    if (current) buf.push(line)
  }
  flush()

  if (Object.keys(sections).length === 0) sections['BRIEF'] = cleaned
  return sections
}

/** Rebuild a clean, canonical brief text from parsed sections. */
export function briefToText(sections: BriefSections): string {
  const parts = SECTION_LABELS
    .filter((s) => (sections[s] ?? '').trim())
    .map((s) => `${s}\n${(sections[s] ?? '').trim()}`)
  const blob = (sections['BRIEF'] ?? '').trim()
  if (parts.length === 0 && blob) return blob
  return parts.join('\n\n')
}

/** Header the receiving chat gets above the brief so it treats it as context. */
export function buildHandoffText(briefText: string): string {
  return `I'm continuing from a previous conversation. Below is a handoff brief — treat it as full context, then continue from STATE.\n\n${briefText.trim()}`
}
