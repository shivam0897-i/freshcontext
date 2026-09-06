import { POLL_MS, RESPONSE_TIMEOUT_MS, STABLE_MS } from '../core/constants'
import {
  composerText,
  elementText,
  findClickableButton,
  insertViaExecCommand,
  insertViaPaste,
  pressEnter,
  readCookie,
  sleep,
  verifyContains,
  waitForNewAssistantMessage,
} from './dom'
import { scanForLimitText } from './chatgpt'
import type { ChatMessage, ChatSummary, LimitInfo, PlatformAdapter, SubmitResult } from './types'

const COMPOSER_SELECTOR =
  'div[data-placeholder][contenteditable="true"], [contenteditable="true"][role="textbox"]'
const SEND_BUTTON =
  'button[data-testid="send-button"], button[aria-label*="Send message" i], button[aria-label="Send" i]'
const STOP_BUTTON = 'button[data-testid="stop-button"], button[aria-label*="Stop" i]'

function conversationId(): string | null {
  const m = location.pathname.match(/\/chat\/([0-9a-f-]+)/i)
  return m?.[1] ?? null
}

function getComposer(): HTMLElement | null {
  // The composer is the bottom-most large contenteditable on the page
  // (claude-farsi-rtl's heuristic — more robust than one fragile selector).
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'div[data-placeholder][contenteditable="true"], [contenteditable="true"][role="textbox"], textarea[enterkeyhint]',
    ),
  )
  if (candidates.length === 0) return null
  return candidates.reduce((lowest, el) =>
    el.getBoundingClientRect().top > lowest.getBoundingClientRect().top ? el : lowest,
  )
}

function lastAssistantText(): string | null {
  const els = document.querySelectorAll('[data-testid="conversation-turn"]')
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i] as HTMLElement
    if (isAssistantTurn(el)) {
      const content = el.querySelector('.font-claude-message, .prose') ?? el
      return elementText(content) || null
    }
  }
  return null
}

function isAssistantTurn(turn: HTMLElement): boolean {
  if (turn.matches('[data-testid*="user" i]')) return false
  if (turn.querySelector('[data-testid="user-message"], .font-claude-user-message')) return false
  return true
}

/** DOM fallback — best-effort: pairs turns and guesses roles from testids/classes. */
function readViaDom(): ChatMessage[] {
  const out: ChatMessage[] = []
  document.querySelectorAll('[data-testid="conversation-turn"]').forEach((el) => {
    const turn = el as HTMLElement
    const role = isAssistantTurn(turn) ? 'assistant' : 'user'
    const content = turn.querySelector('.font-claude-message, .prose, .whitespace-pre-wrap') ?? turn
    const text = elementText(content)
    if (text.trim()) out.push({ role, text })
  })
  return out
}

/** Same-session internal-API access — the pattern claude-chat-exporter ships with. */
async function fetchConversationById(id: string): Promise<ChatMessage[] | null> {
  try {
    const orgId = readCookie('lastActiveOrg')
    if (!orgId) return null
    const res = await fetch(
      `/api/organizations/${orgId}/chat_conversations/${id}?tree=true&rendering_mode=messages&render_all_tools=true`,
      { credentials: 'include' },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      chat_messages?: { sender?: string; content?: { type?: string; text?: string }[] }[]
    }
    const out: ChatMessage[] = []
    for (const msg of data.chat_messages ?? []) {
      const role = msg.sender === 'human' ? 'user' : msg.sender === 'assistant' ? 'assistant' : null
      if (!role) continue
      const text = (msg.content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text ?? '')
        .join('\n')
      if (text.trim()) out.push({ role, text })
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

/**
 * The history list: GET /api/organizations/{org}/chat_conversations returns
 * a top-level JSON array of conversations (uuid, name, summary, timestamps).
 * Names can be empty — summary then title fallback keeps rows readable.
 */
async function fetchChatList(): Promise<ChatSummary[] | null> {
  try {
    const orgId = readCookie('lastActiveOrg')
    if (!orgId) return null
    const res = await fetch(`/api/organizations/${orgId}/chat_conversations`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      uuid?: string
      name?: string
      summary?: string
      created_at?: string
      updated_at?: string
    }[]
    if (!Array.isArray(data)) return null
    const chats: ChatSummary[] = []
    for (const item of data) {
      if (!item.uuid) continue
      const title = (item.name ?? '').trim() || (item.summary ?? '').trim() || 'Untitled chat'
      const updated = Date.parse(item.updated_at ?? '')
      chats.push({
        id: item.uuid,
        title,
        updatedAt: Number.isNaN(updated) ? Date.parse(item.created_at ?? '') || null : updated,
      })
    }
    chats.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    return chats.length ? chats : null
  } catch {
    return null
  }
}

export const claude: PlatformAdapter = {
  id: 'claude',
  label: 'Claude',
  newChatUrl: 'https://claude.ai/new',

  detect() {
    return location.hostname === 'claude.ai'
  },

  getComposer,

  async insertText(text: string): Promise<boolean> {
    const el = getComposer()
    if (!el) return false
    if (await insertViaPaste(el, text)) return true
    if (insertViaExecCommand(el, text)) {
      await sleep(60)
      return verifyContains(el, text)
    }
    return false
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
    const id = conversationId()
    const viaApi = id ? await fetchConversationById(id) : null
    if (viaApi) return viaApi
    return readViaDom()
  },

  readConversationFast(): ChatMessage[] {
    return readViaDom()
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
    // 1. In-chat limit banner — the immediate, always-available signal.
    const banner = scanForLimitText(
      '[class*="error" i], [role="alert"], [class*="banner" i], [class*="toast" i]',
      /usage limit|limit (?:will reset|resets)|out of (?:free )?messages|try again/i,
    )
    if (banner) return banner

    // 2. Paid plans expose /usage (the same endpoint ClaudeKit reads). Free
    // accounts return no quota values — we report nothing rather than invent.
    try {
      const orgId = readCookie('lastActiveOrg')
      if (!orgId) return null
      const res = await fetch(`/api/organizations/${orgId}/usage`, { credentials: 'include' })
      if (!res.ok) return null
      const data: unknown = await res.json()
      const atCap = findAtCapUsage(data)
      if (atCap) return { hit: true, detail: atCap }
      return null
    } catch {
      return null
    }
  },
}

/** Best-effort scan of the /usage payload for any percentage at its cap. */
function findAtCapUsage(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null || typeof value !== 'object') return null
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && entry >= 99 && /percent|usage|util|limit/i.test(key)) {
      return `${key} at ${entry}%`
    }
    const nested = findAtCapUsage(entry, depth + 1)
    if (nested) return nested
  }
  return null
}
