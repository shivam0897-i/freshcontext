import { RESPONSE_TIMEOUT_MS } from './core/constants'
import { buildTranscriptHandoff } from './core/handoff'
import { countTokensViaBackground, openNewChat } from './core/rpc'
import { getSettings, saveBrief, savePendingBrief, type Settings } from './core/storage'
import type { ChatMessage, ChatSummary, LimitInfo } from './platforms/types'
import { adapterFor } from './platforms'
import type { PlatformAdapter } from './platforms/types'
import type { BadgeController } from './ui/badge'
import { copyToClipboard } from './ui/overlay-lib'
import { openReview } from './ui/review'
import type { ToastController } from './ui/toast'

export interface FlowContext {
  badge: BadgeController
  toast: ToastController
  pct: number
}

/** A reply that looks like a platform error rather than a handoff brief. */
function looksLikeLimitError(text: string): boolean {
  return (
    text.length < 400 &&
    /usage limit|rate limit|try again (?:later|in|at)|at capacity|out of (?:free )?messages|reached your/i.test(
      text,
    )
  )
}

/**
 * The FreshContext flow:
 *   quota check → inject brief request → submit → wait for the AI to write
 *   the brief → review overlay → save + clipboard → open destination chat.
 *
 * Limit handling is a first-class path, not an afterthought: when the source
 * AI is out of quota it cannot write the brief, but the conversation is
 * still readable and the destination AI has a fresh window — so we hand over
 * a Markdown transcript and the destination AI does the distillation as its
 * first act. Every step still degrades to a manual clipboard path.
 */
export async function runFreshStart(adapter: PlatformAdapter, ctx: FlowContext): Promise<void> {
  const { badge, toast } = ctx
  const settings = await getSettings()

  // Pre-flight: don't waste the attempt if the platform already said no.
  badge.setBusy('Checking quota…')
  const preFlight = await adapter.readLimits()
  if (preFlight?.hit) {
    await recoverFromLimit(adapter, ctx, settings, preFlight)
    return
  }

  badge.setBusy('Requesting brief…')
  const inserted = await adapter.insertText(settings.promptTemplate)
  if (!inserted) {
    badge.reset()
    const copied = await copyToClipboard(settings.promptTemplate)
    toast.show(
      copied
        ? "Couldn't type into this page — the brief request is on your clipboard. Paste it, send it, and use its reply as your brief."
        : "Couldn't type into this page — open the side panel to copy the brief request.",
      'error',
    )
    return
  }

  const submitted = await adapter.submit()
  if (!submitted.ok) {
    // A send that doesn't go through is often the quota wall.
    const limits = await adapter.readLimits()
    if (limits?.hit) {
      await recoverFromLimit(adapter, ctx, settings, limits)
      return
    }
    toast.show(
      `${submitted.reason ?? 'Send failed'} — press Enter to send it; FreshContext is listening for the reply.`,
      'error',
    )
  }

  badge.setBusy('AI is writing the brief…')
  const brief = await adapter.waitForResponse(RESPONSE_TIMEOUT_MS)
  badge.reset()

  if (!brief || brief.trim().length < 40 || looksLikeLimitError(brief)) {
    // Timeout or an error-shaped reply — check whether quota was the cause.
    const limits = await adapter.readLimits()
    if (limits?.hit) {
      await recoverFromLimit(adapter, ctx, settings, limits)
      return
    }
    await copyToClipboard(settings.promptTemplate)
    toast.show('Timed out waiting for the brief — the request is on your clipboard.', 'error')
    return
  }

  void countTokensViaBackground(adapter.id, brief)

  openReviewOverlay(adapter, ctx, settings, {
    variant: 'brief',
    briefText: brief.trim(),
  })
}

/**
 * Quota-recovery: read the full conversation locally, build a Markdown
 * transcript handoff, and let the destination AI digest it in its fresh
 * window ("AI writes the brief" moves to the destination).
 */
async function recoverFromLimit(
  adapter: PlatformAdapter,
  ctx: FlowContext,
  settings: Settings,
  limits: LimitInfo,
): Promise<void> {
  const { badge, toast } = ctx
  badge.setBusy('Quota reached — reading conversation…')

  let messages: Awaited<ReturnType<PlatformAdapter['readConversation']>> = []
  try {
    messages = await adapter.readConversation()
  } catch {
    messages = []
  }

  badge.reset()

  if (messages.length === 0) {
    await copyToClipboard(settings.promptTemplate)
    toast.show(
      "Quota is exhausted and the conversation couldn't be read — the brief request is on your clipboard.",
      'error',
    )
    return
  }

  const handoff = buildTranscriptHandoff(adapter.label, messages)
  void countTokensViaBackground(adapter.id, handoff)

  openReviewOverlay(adapter, ctx, settings, {
    variant: 'handoff',
    briefText: handoff,
    limitResetHint: limits.resetHint,
  })
}

/**
 * History-picker transfer: read a conversation the user picked (without
 * opening it) via the platform's same-session API, build the Markdown
 * transcript handoff, and let the destination AI digest it. Same machinery
 * as quota-recovery — triggered by choice instead of by a limit.
 */
export async function runTransfer(
  adapter: PlatformAdapter,
  ctx: FlowContext,
  chat: ChatSummary,
): Promise<void> {
  const { badge, toast } = ctx
  if (!adapter.readConversationById) return

  badge.setBusy('Reading conversation…')
  let messages: ChatMessage[] = []
  try {
    messages = await adapter.readConversationById(chat.id)
  } catch {
    messages = []
  }
  badge.reset()

  if (messages.length === 0) {
    toast.show(
      `Couldn't read "${chat.title}" — the platform's API refused. Open the chat and use Fresh start instead.`,
      'error',
    )
    return
  }

  const settings = await getSettings()
  const handoff = buildTranscriptHandoff(adapter.label, messages)
  void countTokensViaBackground(adapter.id, handoff)

  openReviewOverlay(adapter, ctx, settings, {
    variant: 'handoff',
    reason: 'picked',
    briefText: handoff,
    sourceChatTitle: chat.title,
  })
}

function openReviewOverlay(
  adapter: PlatformAdapter,
  ctx: FlowContext,
  settings: Settings,
  review: {
    variant: 'brief' | 'handoff'
    briefText: string
    limitResetHint?: string
    reason?: 'quota' | 'picked'
    sourceChatTitle?: string
  },
): void {
  let closeReview: { close: () => void } | null = null
  closeReview = openReview({
    sourcePlatform: adapter.id,
    sourceLabel: adapter.label,
    pctFull: ctx.pct,
    briefText: review.briefText,
    autoSend: settings.autoSend,
    variant: review.variant,
    reason: review.reason,
    limitResetHint: review.limitResetHint,
    sourceChatTitle: review.sourceChatTitle,
    windows: settings.windows,
    onConfirm: (dest, text, autoSend) => {
      void (async () => {
        await saveBrief(adapter.id, text)
        await savePendingBrief({ destPlatform: dest, text, autoSend, createdAt: Date.now() })
        await copyToClipboard(text)
        const url = adapterFor(dest)?.newChatUrl
        const opened = url ? await openNewChat(url) : false
        if (opened) {
          closeReview?.close()
          ctx.toast.show('Opening the new chat — your handoff will be waiting in the composer.')
        } else {
          // Keep the review overlay open so the user can retry — the
          // handoff is already saved and on the clipboard either way.
          ctx.toast.show(
            "Couldn't open a tab — the handoff is saved and on your clipboard. Try again, or open the new chat yourself; it will be inserted there.",
            'error',
          )
        }
      })()
    },
    onClose: () => undefined,
  })
}
