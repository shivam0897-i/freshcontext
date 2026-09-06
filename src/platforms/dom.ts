import type { ChatMessage } from './types'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Read visible text from an element. innerText is what we want in real
 * browsers (respects visibility), textContent is the fallback that also
 * works in jsdom.
 */
export function elementText(el: Element): string {
  const h = el as HTMLElement
  return h.innerText ?? el.textContent ?? ''
}

/** Read text from either a form control or a contenteditable composer. */
export function composerText(el: HTMLElement | null): string {
  if (!el) return ''
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value
  return elementText(el)
}

/** Verify inserted text actually landed (ProseMirror discards naive writes). */
export function verifyContains(el: HTMLElement | null, text: string): boolean {
  const probe = text.trim().slice(0, 60)
  if (!probe) return false
  return composerText(el).includes(probe)
}

/**
 * ProseMirror (ChatGPT, Claude) accepts a synthetic paste event with a
 * DataTransfer payload — the technique used by shipping prompt-injection
 * extensions. Direct .value/.innerHTML writes are ignored.
 */
export async function insertViaPaste(el: HTMLElement, text: string): Promise<boolean> {
  if (typeof DataTransfer === 'undefined' || typeof ClipboardEvent === 'undefined') return false
  try {
    el.focus()
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
    await sleep(80)
    return verifyContains(el, text)
  } catch {
    return false
  }
}

/** Deprecated-but-universal fallback: works on ProseMirror, TipTap, Quill, textareas. */
export function insertViaExecCommand(el: HTMLElement, text: string): boolean {
  try {
    el.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      range.selectNodeContents(el)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
    return document.execCommand('insertText', false, text)
  } catch {
    return false
  }
}

/** Quill (Gemini) accepts direct DOM writes followed by an input event. */
export function insertViaInnerHTML(el: HTMLElement, text: string): boolean {
  try {
    el.focus()
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    el.innerHTML = `<p>${escaped.replace(/\n/g, '<br>')}</p>`
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return verifyContains(el, text)
  } catch {
    return false
  }
}

/** Enter-key submit fallback — synthetic KeyboardEvents, keydown/keypress/keyup. */
export function pressEnter(el: HTMLElement): void {
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
}

/** Find a clickable, visible, enabled button among `selector` matches. */
export function findClickableButton(selector: string): HTMLButtonElement | null {
  for (const el of document.querySelectorAll(selector)) {
    const btn = el as HTMLButtonElement
    if (btn.disabled) continue
    if (btn.getAttribute('aria-disabled') === 'true') continue
    // display:none in the computed style covers ancestor-hidden buttons in
    // real Chrome while staying testable in jsdom (which has no layout).
    if (getComputedStyle(btn).display === 'none') continue
    return btn
  }
  return null
}

/** Extract turns from `[data-message-author-role]` markup (ChatGPT pattern). */
export function extractByRoleAttribute(contentSelectors: string[]): ChatMessage[] {
  const out: ChatMessage[] = []
  document.querySelectorAll('[data-message-author-role]').forEach((el) => {
    const role = el.getAttribute('data-message-author-role')
    if (role !== 'user' && role !== 'assistant') return
    const content = contentSelectors.map((s) => el.querySelector(s)).find(Boolean)
    const text = elementText(content ?? el)
    if (text.trim()) out.push({ role, text })
  })
  return out
}

export interface WaitForOptions {
  /** Text of the last assistant message before the flow started. */
  previousLastText: string
  readLast: () => string | null
  stopButtonSelector?: string
  stableMs: number
  pollMs: number
  timeoutMs: number
}

/**
 * Response-complete detection. No open-source prior art exists for this
 * (flagged UNVERIFIED in research), so we combine two independent signals:
 *
 * 1. DOM stability — the newest assistant message stops changing
 * 2. Stop-button lifecycle — a stop button appeared and then disappeared
 *
 * Whichever fires first wins; on timeout we still return the newest text if
 * it changed, because a slow-but-finished reply beats a false failure.
 */
export async function waitForNewAssistantMessage(opts: WaitForOptions): Promise<string | null> {
  const start = Date.now()
  let lastSeen = ''
  let lastChange = Date.now()
  let sawStop = false

  while (Date.now() - start < opts.timeoutMs) {
    await sleep(opts.pollMs)
    const current = opts.readLast() ?? ''
    if (current !== lastSeen) {
      lastSeen = current
      lastChange = Date.now()
    }
    const stopBtn = opts.stopButtonSelector
      ? document.querySelector(opts.stopButtonSelector)
      : null
    if (stopBtn) sawStop = true

    const isNew = current.trim() !== '' && current !== opts.previousLastText
    const stable = Date.now() - lastChange >= opts.stableMs
    const stopGone = sawStop && !stopBtn
    if (isNew && (stable || stopGone)) return current
  }

  const final = (opts.readLast() ?? '').trim()
  return final && final !== opts.previousLastText ? final : null
}

/** Read a named cookie (same-origin document.cookie only). */
export function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m?.[1] ? decodeURIComponent(m[1]) : null
}
