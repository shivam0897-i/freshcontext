import type { ChatMessage } from '../platforms/types'

/**
 * Locally-built handoff for the quota-recovery path: when the source AI hit
 * its usage limit, it can no longer write the brief — but the conversation is
 * still readable, and the DESTINATION AI has a fresh window. So we hand over
 * a Markdown-structured transcript and the destination AI does the
 * distillation as its first act ("write a recap, then continue").
 *
 * Markdown is deliberate: platforms render it in-chat, models parse it best,
 * and fenced code blocks keep artifacts from being merged into prose.
 *
 * If the transcript overflows `maxChars`, the OLDEST turns are dropped (they
 * matter least for continuing) and the omission is noted in the handoff.
 */

export const DEFAULT_TRANSCRIPT_MAX_CHARS = 400_000

export function buildTranscriptHandoff(
  sourceLabel: string,
  messages: ChatMessage[],
  maxChars: number = DEFAULT_TRANSCRIPT_MAX_CHARS,
): string {
  // Assemble newest-first so trimming drops the oldest turns cleanly.
  const turns: string[] = []
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || !message.text.trim()) continue
    const line = `**${message.role === 'user' ? 'User' : sourceLabel}**: ${message.text.trim()}`
    if (total + line.length > maxChars && turns.length > 0) {
      const omitted = i + 1
      turns.push(
        `*[${omitted} earlier message${omitted === 1 ? '' : 's'} omitted so this handoff fits]*`,
      )
      break
    }
    turns.push(line)
    total += line.length
  }
  turns.reverse()

  return `I'm continuing a conversation from **${sourceLabel}** — its usage quota ran out mid-work, so I'm carrying the context to you.

Below is the conversation transcript. Treat it as your starting context, then:
1. First write a short recap — goal, key decisions so far, current state — so we both know you have it.
2. Then continue from where the conversation left off.

## Conversation transcript (from ${sourceLabel})

${turns.join('\n\n')}`
}
