import type { PlatformId } from '../core/constants'
import { countTokensViaBackground } from '../core/rpc'
import { estimateTokens } from '../core/estimator'
import { copyToClipboard, TOKENS, createShadowHost } from './overlay-lib'
import { ADAPTERS } from '../platforms'

export interface ReviewOptions {
  sourcePlatform: PlatformId
  sourceLabel: string
  pctFull: number
  briefText: string
  autoSend: boolean
  /**
   * 'brief' — normal flow: the AI wrote a handoff brief.
   * 'handoff' — quota-recovery: locally-built transcript handoff, where the
   * destination AI digests the conversation as its first act.
   */
  variant?: 'brief' | 'handoff'
  /** Reset hint surfaced by the platform's limit UI, if any. */
  limitResetHint?: string
  /** Context-window sizes per destination, for the fit readouts. */
  windows: Record<PlatformId, number>
  onConfirm: (dest: PlatformId, editedText: string, autoSend: boolean) => void
  onClose: () => void
}

export interface ReviewController {
  close(): void
}

/**
 * The review overlay — the moment of trust. Brief is editable, token count
 * and per-destination fit update live, destination is explicit, nothing
 * sends itself unless the user asked for exactly that.
 */
export function openReview(options: ReviewOptions): ReviewController {
  const { host, root } = createShadowHost('2147483647')
  const variant = options.variant ?? 'brief'
  const isHandoff = variant === 'handoff'

  const headerText = isHandoff
    ? {
        eyebrow: 'QUOTA REACHED',
        title: 'Continue on another AI',
        briefLabel: 'CONVERSATION HANDOFF — THE DESTINATION AI DIGESTS IT',
      }
    : {
        eyebrow: 'FRESHCONTEXT',
        title: 'Handoff brief',
        briefLabel: 'BRIEF — EDIT BEFORE CONTINUING',
      }

  const style = document.createElement('style')
  style.textContent = `
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: ${TOKENS.sans};
    }
    .panel {
      width: 400px; max-height: 86vh; overflow-y: auto;
      background: ${TOKENS.bg}; border: 1px solid ${TOKENS.border};
      border-radius: 12px; padding: 18px 20px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .eyebrow { font-family: ${TOKENS.mono}; font-size: 9px; letter-spacing: 1.2px; color: ${TOKENS.faint}; }
    .eyebrow.limit { color: ${TOKENS.red}; }
    .title { font-size: 16px; font-weight: 600; letter-spacing: -0.2px; color: ${TOKENS.text}; }
    .sub { font-size: 11px; color: ${TOKENS.muted}; line-height: 1.5; }
    .readout {
      display: flex; align-items: center; justify-content: space-between;
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 10px 12px;
    }
    .readout .num { font-family: ${TOKENS.mono}; font-size: 14px; color: ${TOKENS.text}; }
    .readout .meta { font-family: ${TOKENS.mono}; font-size: 8px; letter-spacing: 0.8px; color: ${TOKENS.muted}; text-align: right; line-height: 1.6; }
    textarea.brief {
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 12px; min-height: 200px;
      font: 11.5px/1.5 ${TOKENS.sans}; color: ${TOKENS.text}; outline: none;
    }
    textarea.brief:focus { border-color: ${TOKENS.borderBright}; }
    .label { font-family: ${TOKENS.mono}; font-size: 9px; letter-spacing: 1.2px; color: ${TOKENS.faint}; }
    .dest {
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 10px 12px;
      display: flex; gap: 10px; align-items: center; width: 100%; text-align: left;
      opacity: 1;
    }
    .dest.selected { border-color: ${TOKENS.borderBright}; }
    .dest.unavailable { opacity: 0.45; cursor: not-allowed; }
    .radio { width: 14px; height: 14px; border-radius: 50%; border: 1px solid ${TOKENS.borderBright}; flex: none; display: flex; align-items: center; justify-content: center; }
    .radio .on { width: 6px; height: 6px; border-radius: 50%; background: ${TOKENS.white}; }
    .dest .name { font-size: 12px; font-weight: 500; color: ${TOKENS.text}; }
    .dest .sub { font-family: ${TOKENS.mono}; font-size: 9px; }
    .dest .sub .tight { color: ${TOKENS.amber}; }
    .dest .sub .nofit { color: ${TOKENS.red}; }
    .toggleRow {
      background: ${TOKENS.card}; border-radius: ${TOKENS.radius}; padding: 10px 12px;
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
    }
    .toggleRow .name { font-size: 11.5px; font-weight: 500; color: ${TOKENS.text}; }
    .toggleRow .sub { font-size: 10px; }
    .switch { width: 28px; height: 16px; border-radius: 8px; background: #2e2e33; border: 1px solid ${TOKENS.border}; position: relative; flex: none; }
    .switch .knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: ${TOKENS.muted}; transition: left 0.15s ease; }
    .switch.on { background: #3a3a41; }
    .switch.on .knob { left: 14px; background: ${TOKENS.white}; }
    .primary {
      background: ${TOKENS.white}; color: #0a0a0b; border-radius: ${TOKENS.radius};
      padding: 11px 16px; font-size: 12.5px; font-weight: 600; width: 100%; text-align: center;
    }
    .primary:hover { opacity: 0.92; }
    .ghost {
      border: 1px solid ${TOKENS.border}; color: ${TOKENS.muted};
      border-radius: ${TOKENS.radius}; padding: 10px 16px; font-size: 12px; width: 100%; text-align: center;
    }
    .safety { font-family: ${TOKENS.mono}; font-size: 8px; letter-spacing: 1px; color: ${TOKENS.faint}; text-align: center; }
  `
  root.appendChild(style)

  const backdrop = document.createElement('div')
  backdrop.className = 'backdrop'
  root.appendChild(backdrop)
  const panel = document.createElement('div')
  panel.className = 'panel'
  backdrop.appendChild(panel)

  // Header
  const eyebrow = document.createElement('div')
  eyebrow.className = `eyebrow${isHandoff ? ' limit' : ''}`
  eyebrow.textContent = headerText.eyebrow
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = headerText.title
  const sub = document.createElement('div')
  sub.className = 'sub'
  const resetNote = options.limitResetHint ? ` · ${options.limitResetHint}` : ''
  sub.textContent = isHandoff
    ? `${options.sourceLabel} can't respond right now${resetNote} — carry the conversation to another AI, which digests it and continues.`
    : `From ${options.sourceLabel} — chat ${Math.round(options.pctFull * 100)}% full`
  panel.append(eyebrow, title, sub)

  // Readout
  const readout = document.createElement('div')
  readout.className = 'readout'
  const num = document.createElement('div')
  num.className = 'num'
  num.textContent = '~0'
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.innerHTML = 'TOKENS<br>ESTIMATE'
  readout.append(num, meta)
  panel.appendChild(readout)

  // Brief editor
  const briefLabel = document.createElement('div')
  briefLabel.className = 'label'
  briefLabel.textContent = headerText.briefLabel
  const textarea = document.createElement('textarea')
  textarea.className = 'brief'
  textarea.value = options.briefText
  panel.append(briefLabel, textarea)

  // Destinations — with live per-destination fit readouts
  const destLabel = document.createElement('div')
  destLabel.className = 'label'
  destLabel.textContent = 'CONTINUE IN'
  panel.appendChild(destLabel)

  interface DestRow {
    id: PlatformId
    btn: HTMLButtonElement
    sub: HTMLElement
    radio: HTMLElement
  }
  const rows: DestRow[] = []
  let selected: PlatformId = options.sourcePlatform
  for (const adapter of ADAPTERS) {
    const unavailable = isHandoff && adapter.id === options.sourcePlatform
    const btn = document.createElement('button')
    btn.className = 'dest'
    const radio = document.createElement('span')
    radio.className = 'radio'
    const nameCol = document.createElement('span')
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = adapter.label
    const destSub = document.createElement('div')
    destSub.className = 'sub'
    nameCol.append(name, destSub)
    btn.append(radio, nameCol)
    if (!unavailable) {
      btn.addEventListener('click', () => {
        selected = adapter.id
        renderDests()
        refreshReadout()
      })
    }
    rows.push({ id: adapter.id, btn, sub: destSub, radio })
    panel.appendChild(btn)
  }

  function fitPct(dest: PlatformId, tokens: number): number | null {
    const window = options.windows[dest]
    if (!window || window <= 0) return null
    return (tokens / window) * 100
  }

  function destSubText(dest: PlatformId, tokens: number): string {
    if (isHandoff && dest === options.sourcePlatform) return 'quota exhausted'
    const pct = fitPct(dest, tokens)
    if (pct === null) return adapterForLabel(dest)
    return `${adapterForLabel(dest)} · fills ~${Math.round(pct)}% of a new window`
  }

  function adapterForLabel(dest: PlatformId): string {
    return ADAPTERS.find((a) => a.id === dest)?.newChatUrl.replace('https://', '') ?? dest
  }

  function renderDests(): void {
    const tokens = estimateTokens(textarea.value)
    for (const row of rows) {
      const unavailable = isHandoff && row.id === options.sourcePlatform
      const pct = fitPct(row.id, tokens)
      row.btn.classList.toggle('selected', row.id === selected)
      row.btn.classList.toggle('unavailable', unavailable)
      row.btn.disabled = unavailable
      row.radio.innerHTML = row.id === selected && !unavailable ? '<span class="on"></span>' : ''
      row.sub.textContent = destSubText(row.id, tokens)
      if (pct !== null && pct >= 85) {
        const warn = document.createElement('span')
        warn.className = pct >= 105 ? 'nofit' : 'tight'
        warn.textContent = pct >= 105 ? ' · won’t fit' : ' · tight'
        row.sub.appendChild(warn)
      }
    }
  }

  // Default destination: in handoff mode the source platform is unavailable.
  if (isHandoff) {
    const firstAvailable = ADAPTERS.find((a) => a.id !== options.sourcePlatform)
    if (firstAvailable) selected = firstAvailable.id
  }
  renderDests()

  // Auto-send toggle
  let autoSend = options.autoSend
  const toggleRow = document.createElement('div')
  toggleRow.className = 'toggleRow'
  const toggleCol = document.createElement('div')
  const toggleName = document.createElement('div')
  toggleName.className = 'name'
  toggleName.textContent = 'Send automatically after inserting'
  const toggleSub = document.createElement('div')
  toggleSub.className = 'sub'
  toggleSub.textContent = autoSend ? 'On — the handoff is sent for you' : 'Off — you review and press Enter'
  toggleCol.append(toggleName, toggleSub)
  const sw = document.createElement('button')
  sw.className = `switch${autoSend ? ' on' : ''}`
  sw.innerHTML = '<span class="knob"></span>'
  sw.addEventListener('click', () => {
    autoSend = !autoSend
    sw.classList.toggle('on', autoSend)
    toggleSub.textContent = autoSend
      ? 'On — the handoff is sent for you'
      : 'Off — you review and press Enter'
  })
  toggleRow.append(toggleCol, sw)
  panel.appendChild(toggleRow)

  // Actions
  const primary = document.createElement('button')
  primary.className = 'primary'
  primary.textContent = isHandoff ? 'Open new chat on another AI' : 'Open new chat'
  primary.addEventListener('click', () => {
    options.onConfirm(selected, textarea.value, autoSend)
  })
  const ghost = document.createElement('button')
  ghost.className = 'ghost'
  ghost.textContent = 'Copy handoff'
  ghost.addEventListener('click', () => {
    void copyToClipboard(textarea.value).then((ok) => {
      ghost.textContent = ok ? 'Copied ✓' : 'Copy failed'
      setTimeout(() => (ghost.textContent = 'Copy handoff'), 1600)
    })
  })
  panel.append(primary, ghost)

  const safety = document.createElement('div')
  safety.className = 'safety'
  safety.textContent = 'SAVED LOCALLY · AUTO-COPIED TO CLIPBOARD'
  panel.appendChild(safety)

  // Live token count + per-destination fit: instant heuristic, reconciled
  // with the exact count from the background service worker.
  let exactTimer: ReturnType<typeof setTimeout> | null = null
  function refreshReadout(): void {
    const text = textarea.value
    const heuristic = estimateTokens(text)
    num.textContent = `~${heuristic.toLocaleString()}`
    const selectedPct = fitPct(selected, heuristic)
    meta.innerHTML = `TOKENS · ${selectedPct !== null ? `~${Math.round(selectedPct)}% OF NEW WINDOW` : 'NEW WINDOW UNKNOWN'}<br>ESTIMATE`
    renderDests()
    if (exactTimer) clearTimeout(exactTimer)
    exactTimer = setTimeout(() => {
      void countTokensViaBackground(selected, text).then((res) => {
        if (!res) return
        num.textContent = `${res.tokens.toLocaleString()}`
        const pct = fitPct(selected, res.tokens)
        meta.innerHTML = `TOKENS · ${pct !== null ? `~${Math.round(pct)}% OF NEW WINDOW` : 'NEW WINDOW UNKNOWN'}<br>${res.exact ? 'EXACT' : 'ESTIMATE'}`
      })
    }, 500)
  }
  textarea.addEventListener('input', refreshReadout)
  refreshReadout()

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

  return { close }
}
