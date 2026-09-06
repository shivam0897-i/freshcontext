import { POLL_MS, RESPONSE_TIMEOUT_MS, STABLE_MS } from '../core/constants'
import {
  composerText,
  elementText,
  findClickableButton,
  insertViaExecCommand,
  insertViaInnerHTML,
  insertViaPaste,
  pressEnter,
  sleep,
  verifyContains,
  waitForNewAssistantMessage,
} from './dom'
import { scanForLimitText } from './chatgpt'
import type { ChatMessage, LimitInfo, PlatformAdapter, SubmitResult } from './types'

const COMPOSER_SELECTOR = '.ql-editor[contenteditable="true"], .ql-editor'
const SEND_BUTTON =
  'button[aria-label*="Send" i], button.send-button, button[mattooltip*="Send"]'
const STOP_BUTTON = 'button[aria-label*="Stop" i], button[mattooltip*="Stop"]'
const HISTORY_CONTAINERS = [
  '.chat-history-scroll-container',
  '#chat-history',
  '.chat-history',
  'infinite-scroller',
  'main',
]

function getComposer(): HTMLElement | null {
  const el = document.querySelector(COMPOSER_SELECTOR)
  return el instanceof HTMLElement ? el : null
}

function readViaDom(): ChatMessage[] {
  const out: ChatMessage[] = []
  document.querySelectorAll('user-query, model-response').forEach((el) => {
    const role = el.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant'
    const content =
      el.querySelector('.query-text-line, .query-text, message-content .markdown, .markdown') ?? el
    const text = elementText(content)
    if (text.trim()) out.push({ role, text })
  })
  return out
}

/**
 * Gemini virtualizes long chats — only rendered messages exist in the DOM.
 * Scroll upward until the message count stabilizes (gemini-chat-exporter's
 * pattern: up to 40 attempts, stop after the count stops growing).
 */
async function scrollToLoadAll(): Promise<void> {
  const container = HISTORY_CONTAINERS.map((s) => document.querySelector(s)).find(Boolean) as
    | HTMLElement
    | undefined
  if (!container) return
  let previousCount = -1
  for (let i = 0; i < 40; i++) {
    const count = document.querySelectorAll('user-query, model-response').length
    if (count === previousCount) break
    previousCount = count
    container.scrollTop = 0
    await sleep(250)
  }
}

function lastAssistantText(): string | null {
  const els = document.querySelectorAll('model-response')
  const last = els[els.length - 1]
  if (!last) return null
  const content = last.querySelector('message-content .markdown, .markdown') ?? last
  return elementText(content) || null
}

export const gemini: PlatformAdapter = {
  id: 'gemini',
  label: 'Gemini',
  newChatUrl: 'https://gemini.google.com/app',

  detect() {
    return location.hostname === 'gemini.google.com'
  },

  getComposer,

  async insertText(text: string): Promise<boolean> {
    const el = getComposer()
    if (!el) return false
    // Quill: paste and execCommand both work; direct DOM write is the
    // Gemini-specific fallback from the multi-platform injection gist.
    if (await insertViaPaste(el, text)) return true
    if (insertViaExecCommand(el, text)) {
      await sleep(60)
      return verifyContains(el, text)
    }
    return insertViaInnerHTML(el, text)
  },

  async submit(): Promise<SubmitResult> {
    const composer = getComposer()
    const btn = findClickableButton(SEND_BUTTON)
    if (btn) {
      btn.click()
      await sleep(400)
      if (composerText(getComposer()).trim() === '') return { ok: true }
      return { ok: false, reason: 'Send clicked but the composer did not clear.' }
    }
    if (composer) {
      pressEnter(composer)
      await sleep(400)
      if (composerText(getComposer()).trim() === '') return { ok: true }
      return { ok: false, reason: 'Enter pressed but the composer did not clear.' }
    }
    return { ok: false, reason: 'No composer or send button found.' }
  },

  async readConversation(): Promise<ChatMessage[]> {
    await scrollToLoadAll()
    return readViaDom()
  },

  readConversationFast(): ChatMessage[] {
    return readViaDom()
  },

  async waitForResponse(timeoutMs: number): Promise<string | null> {
    return waitForNewAssistantMessage({
      previousLastText: lastAssistantText() ?? '',
      readLast: () => lastAssistantText(),
      stopButtonSelector: STOP_BUTTON,
      stableMs: STABLE_MS,
      pollMs: POLL_MS,
      timeoutMs: timeoutMs || RESPONSE_TIMEOUT_MS,
    })
  },

  async readLimits(): Promise<LimitInfo | null> {
    // Gemini's near/at-limit notifications carry the signal. The persistent
    // view lives in Settings → Usage Limits; we surface hits when the
    // platform shows them and stay silent otherwise — no invented numbers.
    return scanForLimitText(
      '[role="status"], [aria-live], [class*="notification" i], [class*="toast" i]',
      /limit/i,
    )
  },
}
