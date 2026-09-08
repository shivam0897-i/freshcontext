import { POLL_MS, RESPONSE_TIMEOUT_MS, STABLE_MS } from '../core/constants'
import {
  composerText,
  elementText,
  extractByRoleAttribute,
  findClickableButton,
  insertViaExecCommand,
  insertViaPaste,
  pressEnter,
  sleep,
  verifyContains,
  waitForNewAssistantMessage,
} from './dom'
import type { ChatMessage, ChatSummary, LimitInfo, PlatformAdapter, SubmitResult } from './types'

const SEND_BUTTON =
  'button[data-testid="send-button"], button[aria-label*="Send" i], form button[type="submit"]'
const STOP_BUTTON = 'button[data-testid="stop-button"], button[aria-label*="Stop" i]'
const CONTENT_SELECTORS = ['[data-message-content]', '.markdown', '.prose', '.whitespace-pre-wrap']

function conversationId(): string | null {
  const m = location.pathname.match(/^\/(?:c|share|g\/[a-z0-9-]+\/c)\/([a-z0-9-]+)/i)
  return m?.[1] ?? null
}

function lastAssistantText(): string | null {
  const els = document.querySelectorAll('[data-message-author-role="assistant"]')
  const last = els[els.length - 1]
  if (!last) return null
  const content = last.querySelector('[data-message-content]') ?? last
  return elementText(content) || null
}

/**
 * Same-session backend-api access — the pattern ChatGPT Exporter ships with.
 * Used both for the currently-open conversation (readConversation) and, via
 * listChats/readConversationById, for the history picker.
 */
async function getSessionToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' })
    if (!res.ok) return null
    const session = (await res.json()) as { accessToken?: string }
    return session.accessToken ?? null
  } catch {
    return null
  }
}

interface ChatGptConversationNode {
  message?: {
    author?: { role?: string }
    create_time?: number
    content?: { parts?: unknown[] }
  }
}

function parseConversationData(data: { mapping?: Record<string, ChatGptConversationNode> }): ChatMessage[] {
  const nodes = Object.values(data.mapping ?? {}).sort(
    (a, b) => (a?.message?.create_time ?? 0) - (b?.message?.create_time ?? 0),
  )
  const out: ChatMessage[] = []
  for (const node of nodes) {
    const role = node?.message?.author?.role
    if (role !== 'user' && role !== 'assistant') continue
    const parts = node?.message?.content?.parts ?? []
    const text = parts.filter((p): p is string => typeof p === 'string').join('\n')
    if (text.trim()) out.push({ role, text })
  }
  return out
}

async function fetchConversationById(id: string): Promise<ChatMessage[] | null> {
  try {
    const accessToken = await getSessionToken()
    if (!accessToken) return null
    const res = await fetch(`/backend-api/conversation/${id}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Parameters<typeof parseConversationData>[0]
    const messages = parseConversationData(data)
    return messages.length ? messages : null
  } catch {
    return null
  }
}

/**
 * The history list. Response: { items: [{id, title, create_time, …}], total }.
 * Timestamps have been observed as unix seconds AND ISO strings across API
 * eras, so both are parsed defensively; titles can carry trailing newlines.
 */
async function fetchChatList(): Promise<ChatSummary[] | null> {
  try {
    const accessToken = await getSessionToken()
    if (!accessToken) return null
    const res = await fetch('/backend-api/conversations?offset=0&limit=30', {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      items?: { id?: string; title?: string; create_time?: number | string; update_time?: number | string }[]
    }
    const chats: ChatSummary[] = []
    for (const item of data.items ?? []) {
      if (!item.id) continue
      chats.push({
        id: item.id,
        title: (item.title ?? '').replace(/\s+/g, ' ').trim() || 'Untitled chat',
        updatedAt: parseTimestamp(item.update_time) ?? parseTimestamp(item.create_time),
      })
    }
    chats.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return chats.length ? chats : null
  } catch {
    return null
  }
}

function parseTimestamp(value: number | string | undefined): number | null {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export const chatgpt: PlatformAdapter = {
  id: 'chatgpt',
  label: 'ChatGPT',
  newChatUrl: 'https://chatgpt.com/',

  detect() {
    if (location.hostname === 'chatgpt.com') return true
    // Dev builds also own the local demo harness, which mirrors ChatGPT's DOM.
    return __DEV__ && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  },

  getComposer(): HTMLElement | null {
    const el = document.getElementById('prompt-textarea')
    if (el instanceof HTMLElement) return el
    const alt = document.querySelector(
      '#prompt-textarea, [contenteditable="true"][role="textbox"], textarea[data-id="root"]',
    )
    return alt instanceof HTMLElement ? alt : null
  },

  async insertText(text: string): Promise<boolean> {
    const el = this.getComposer()
    if (!el) return false
    if (await insertViaPaste(el, text)) return true
    if (insertViaExecCommand(el, text)) {
      await sleep(60)
      return verifyContains(el, text)
    }
    return false
  },

  async submit(): Promise<SubmitResult> {
    const composer = this.getComposer()
    const btn = findClickableButton(SEND_BUTTON)
    if (btn) {
      btn.click()
      await sleep(400)
      if (composerText(this.getComposer()).trim() === '') return { ok: true }
      return { ok: false, reason: 'Send clicked but the composer did not clear.' }
    }
    if (composer) {
      pressEnter(composer)
      await sleep(400)
      if (composerText(this.getComposer()).trim() === '') return { ok: true }
      return { ok: false, reason: 'Enter pressed but the composer did not clear.' }
    }
    return { ok: false, reason: 'No composer or send button found.' }
  },

  async readConversation(): Promise<ChatMessage[]> {
    const id = conversationId()
    const viaApi = id ? await fetchConversationById(id) : null
    if (viaApi) return viaApi
    return extractByRoleAttribute(CONTENT_SELECTORS)
  },

  readConversationFast(): ChatMessage[] {
    return extractByRoleAttribute(CONTENT_SELECTORS)
  },

  async listChats(): Promise<ChatSummary[]> {
    return (await fetchChatList()) ?? []
  },

  async readConversationById(id: string): Promise<ChatMessage[]> {
    return (await fetchConversationById(id)) ?? []
  },

  currentConversationId(): string | null {
    return conversationId()
  },

  detectActiveModel(): string | null {
    // Best-effort: the model picker near the composer names the active model.
    // Prefer the SHORTEST matching text: the picker label is
    // compact, while banners and marketing copy mentioning model
    // names are long.
    let best: string | null = null
    const candidates = document.querySelectorAll<HTMLElement>(
      'button, [aria-haspopup="listbox"], [data-testid*="model"]',
    )
    for (const el of candidates) {
      const text = elementText(el).trim()
      if (/\b(gpt|thinking|instant|reasoning|extended)\b/i.test(text)) {
        if (best === null || text.length < best.length) best = text
      }
    }
    return best
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
    // ChatGPT has no persistent meter; the limit-hit dialog is the signal.
    return scanForLimitText(
      '[role="alert"], [data-testid="oops-modal"], dialog',
      /usage limit|you'?ve reached|rate limit|try again (?:later|in|at)/i,
    )
  },
}

/**
 * Shared limit-dialog scanner — reads the text the platform actually shows
 * and extracts a reset hint when present. Kept generic: all three adapters
 * detect limit-hit UI with the same pattern, different selectors.
 */
export function scanForLimitText(selector: string, hitPattern: RegExp): LimitInfo | null {
  for (const el of document.querySelectorAll(selector)) {
    const text = (el.textContent ?? '').trim()
    if (!text || text.length > 600) continue
    if (hitPattern.test(text)) {
      const resetHint = text.match(
        /(?:resets?|try again)[^.!?]{0,60}(?:at|in)\s[^.!?]{1,30}/i,
      )?.[0]
      return { hit: true, resetHint, detail: text.slice(0, 200) }
    }
  }
  return null
}
