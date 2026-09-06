import type { ChatSummary } from '../platforms/types'
import { TOKENS, createShadowHost } from './overlay-lib'

export interface PickerOptions {
  platformLabel: string
  /** Fetch the recent-chat list; throws or returns [] on failure. */
  loadChats: () => Promise<ChatSummary[]>
  /** The conversation open in this tab — excluded from the list. */
  currentId: string | null
  onPick: (chat: ChatSummary) => void
  onClose: () => void
}

export interface PickerController {
  close(): void
}

function relativeTime(ts: number | null): string {
  if (ts === null) return ''
  const minutes = Math.floor((Date.now() - ts) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

/**
 * The chat-history picker: transfer an older conversation without opening
 * it. Present only on platforms whose same-session API can read unopened
 * conversations (ChatGPT, Claude).
 */
export function openPicker(options: PickerOptions): PickerController {
  const { host, root } = createShadowHost('2147483647')

  const style = document.createElement('style')
  style.textContent = `
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: ${TOKENS.sans};
    }
    .panel {
      width: 400px; max-height: 80vh; display: flex; flex-direction: column;
      background: ${TOKENS.bg}; border: 1px solid ${TOKENS.border};
      border-radius: 12px; padding: 18px 20px;
    }
    .eyebrow { font-family: ${TOKENS.mono}; font-size: 9px; letter-spacing: 1.2px; color: ${TOKENS.faint}; }
    .title { font-size: 16px; font-weight: 600; letter-spacing: -0.2px; color: ${TOKENS.text}; margin: 4px 0 2px; }
    .sub { font-size: 11px; color: ${TOKENS.muted}; margin: 0 0 12px; }
    input.search {
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 9px 12px; width: 100%;
      font: 12px ${TOKENS.sans}; color: ${TOKENS.text}; outline: none;
    }
    input.search:focus { border-color: ${TOKENS.borderBright}; }
    .list { overflow-y: auto; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .chat {
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 10px 12px; text-align: left;
      width: 100%; cursor: pointer;
    }
    .chat:hover { border-color: ${TOKENS.borderBright}; }
    .chat .name {
      font-size: 12.5px; color: ${TOKENS.text};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .chat .meta { font-family: ${TOKENS.mono}; font-size: 9px; letter-spacing: 0.6px; color: ${TOKENS.faint}; margin-top: 3px; }
    .status { padding: 28px 0; text-align: center; }
    .status .msg { font-family: ${TOKENS.mono}; font-size: 10px; letter-spacing: 1px; color: ${TOKENS.muted}; }
    .status button {
      margin-top: 12px; border: 1px solid ${TOKENS.border}; color: ${TOKENS.muted};
      border-radius: ${TOKENS.radius}; padding: 7px 14px; font-size: 12px;
    }
    .spinner { display: inline-block; width: 10px; height: 10px; border: 1.5px solid ${TOKENS.faint}; border-top-color: ${TOKENS.text}; border-radius: 50%; animation: fc-spin 0.8s linear infinite; }
    @keyframes fc-spin { to { transform: rotate(360deg); } }
    .safety { font-family: ${TOKENS.mono}; font-size: 8px; letter-spacing: 1px; color: ${TOKENS.faint}; text-align: center; margin-top: 12px; }
  `
  root.appendChild(style)

  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  root.appendChild(backdrop)
  const panel = document.createElement('div')
  panel.className = 'panel'
  backdrop.appendChild(panel)

  const eyebrow = document.createElement('div')
  eyebrow.className = 'eyebrow'
  eyebrow.textContent = 'FRESHCONTEXT'
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = 'Transfer an older chat'
  const sub = document.createElement('p')
  sub.className = 'sub'
  sub.textContent = `Pick a conversation from your ${options.platformLabel} history — it's handed over without opening it.`
  panel.append(eyebrow, title, sub)

  const search = document.createElement('input')
  search.className = 'search'
  search.type = 'text'
  search.placeholder = 'Search your chats…'
  panel.appendChild(search)

  const list = document.createElement('div')
  list.className = 'list'
  panel.appendChild(list)

  const safety = document.createElement('div')
  safety.className = 'safety'
  safety.textContent = 'READ LOCALLY VIA YOUR SESSION · NOTHING LEAVES THE BROWSER'
  panel.appendChild(safety)

  let chats: ChatSummary[] = []

  function status(kind: 'loading' | 'error' | 'empty'): void {
    list.innerHTML = ''
    const box = document.createElement('div')
    box.className = 'status'
    if (kind === 'loading') {
      const spinner = document.createElement('span')
      spinner.className = 'spinner'
      const msg = document.createElement('div')
      msg.className = 'msg'
      msg.style.marginTop = '10px'
      msg.textContent = 'READING YOUR CHAT LIST…'
      box.append(spinner, msg)
    } else if (kind === 'error') {
      const msg = document.createElement('div')
      msg.className = 'msg'
      msg.textContent = `COULDN'T READ YOUR ${options.platformLabel.toUpperCase()} HISTORY`
      const retry = document.createElement('button')
      retry.textContent = 'Try again'
      retry.addEventListener('click', () => void load())
      box.append(msg, retry)
    } else {
      const msg = document.createElement('div')
      msg.className = 'msg'
      msg.textContent = 'NO CHATS FOUND'
      box.appendChild(msg)
    }
    list.appendChild(box)
  }

  function render(): void {
    const query = search.value.trim().toLowerCase()
    const visible = chats.filter(
      (c) => c.id !== options.currentId && (!query || c.title.toLowerCase().includes(query)),
    )
    list.innerHTML = ''
    if (visible.length === 0) {
      const msg = document.createElement('div')
      msg.className = 'status'
      const text = document.createElement('div')
      text.className = 'msg'
      text.textContent =
        chats.length === 0 ? 'NO CHATS FOUND' : query ? 'NO MATCHES' : 'NOTHING ELSE TO TRANSFER'
      msg.appendChild(text)
      list.appendChild(msg)
      return
    }
    for (const chat of visible) {
      const btn = document.createElement('button')
      btn.className = 'chat'
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = chat.title
      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = relativeTime(chat.updatedAt) || 'unknown date'
      btn.append(name, meta)
      btn.addEventListener('click', () => {
        close()
        options.onPick(chat)
      })
      list.appendChild(btn)
    }
  }

  async function load(): Promise<void> {
    status('loading')
    try {
      const loaded = await options.loadChats()
      chats = loaded
      render()
    } catch {
      status('error')
    }
  }

  search.addEventListener('input', render)

  function close(): void {
    host.remove()
    document.removeEventListener('keydown', onKey)
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
      options.onClose()
    }
  }
  document.addEventListener('keydown', onKey)
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) {
      close()
      options.onClose()
    }
  })

  void load()

  return { close }
}
