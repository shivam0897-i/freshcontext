import type { MeterState } from '../core/meter'
import { messagesLeftEstimate } from '../core/meter'
import type { LimitInfo } from '../platforms/types'
import { formatWindow } from '../core/presets'
import { TOKENS, createShadowHost } from './overlay-lib'

export interface BadgeController {
  update(state: MeterState): void
  setBusy(text: string): void
  setError(text: string): void
  reset(): void
  /** Surface the platform's limit status inside the expanded card. */
  setLimit(info: LimitInfo | null): void
  /** Show/hide the whole badge (settings master switch). */
  setVisible(visible: boolean): void
  /** Return the badge to its default bottom-right position. */
  resetPosition(): void
}

export interface BadgeOptions {
  onFreshStart: () => void
  /** Fired whenever the card is expanded — the host refreshes limit info. */
  onCardOpen?: () => void
  /** Open the older-chat picker. Provided only when the platform supports it. */
  onPickChat?: () => void
}

/**
 * Percentages readable at 1M-window scale: below 0.1% show "<0.1%" (a bare
 * "0.0%" reads as broken), below 10% keep one decimal, above that integers.
 * The fill bar renders a 2% minimum sliver for any non-empty chat so text
 * and bar never imply "empty".
 */
function formatPct(pct: number): string {
  const value = pct * 100
  if (value <= 0) return '0'
  if (value < 0.1) return '<0.1'
  if (value < 10) return value.toFixed(1)
  return String(Math.round(value))
}

const LEVEL_COLOR: Record<string, string> = {
  ok: TOKENS.green,
  amber: TOKENS.amber,
  red: TOKENS.red,
}

const POSITION_KEY = 'badgePos'
const DEFAULT_MARGIN = 16
const DRAG_THRESHOLD_PX = 6

interface BadgePosition {
  left: number
  top: number
}

function defaultPosition(): BadgePosition {
  return {
    left: window.innerWidth - 200 - DEFAULT_MARGIN,
    top: window.innerHeight - 60 - DEFAULT_MARGIN,
  }
}

function clampToViewport(pos: BadgePosition): BadgePosition {
  return {
    left: Math.min(Math.max(8, pos.left), Math.max(8, window.innerWidth - 60)),
    top: Math.min(Math.max(8, pos.top), Math.max(8, window.innerHeight - 60)),
  }
}

async function loadPosition(): Promise<BadgePosition | null> {
  try {
    const raw = await chrome.storage.local.get(POSITION_KEY)
    const pos = raw?.[POSITION_KEY] as BadgePosition | undefined
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') return clampToViewport(pos)
    return null
  } catch {
    return null
  }
}

async function savePosition(pos: BadgePosition): Promise<void> {
  try {
    await chrome.storage.local.set({ [POSITION_KEY]: pos })
  } catch {
    /* position persistence is best-effort */
  }
}

/**
 * The floating context chip — closed Shadow DOM, bottom-right by default,
 * draggable anywhere (some site layouts put their own controls in the
 * corner), position persisted locally.
 */
export function mountBadge(options: BadgeOptions): BadgeController {
  const { host, root } = createShadowHost('2147483647')

  const style = document.createElement('style')
  style.textContent = `
    .anchor { position: fixed; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .chip {
      display: flex; align-items: center; gap: 8px;
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 7px 10px;
      font-family: ${TOKENS.sans}; cursor: grab; touch-action: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      user-select: none;
    }
    .chip.dragging { cursor: grabbing; opacity: 0.85; }
    .track { width: 36px; height: 3px; border-radius: 2px; background: #1f1f23; overflow: hidden; }
    .fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
    .pct { font-family: ${TOKENS.mono}; font-size: 11px; font-weight: 500; }
    .lbl { font-size: 11px; color: ${TOKENS.muted}; }
    .card {
      background: ${TOKENS.card}; border: 1px solid ${TOKENS.border};
      border-radius: ${TOKENS.radius}; padding: 12px 14px; width: 264px;
      font-family: ${TOKENS.sans}; box-shadow: 0 8px 28px rgba(0,0,0,0.45);
      display: none;
    }
    .card.open { display: block; }
    .card .title { font-size: 13px; font-weight: 600; color: ${TOKENS.text}; display: flex; align-items: center; gap: 7px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; }
    .card .desc { font-size: 11px; line-height: 1.5; color: ${TOKENS.muted}; margin: 8px 0 10px; }
    .row { display: flex; gap: 8px; }
    .primary {
      background: ${TOKENS.white}; color: #0a0a0b; border-radius: ${TOKENS.radius};
      padding: 8px 14px; font-size: 12px; font-weight: 600;
    }
    .primary:hover { opacity: 0.92; }
    .ghost {
      border: 1px solid ${TOKENS.border}; color: ${TOKENS.muted};
      border-radius: ${TOKENS.radius}; padding: 8px 14px; font-size: 12px;
    }
    .pickChat {
      width: 100%; text-align: center; margin-top: 8px;
      font-size: 11.5px; color: ${TOKENS.muted};
    }
    .pickChat:hover { color: ${TOKENS.text}; }
    .meta { font-family: ${TOKENS.mono}; font-size: 9px; letter-spacing: 1px; color: ${TOKENS.faint}; margin-top: 8px; }
    .limit {
      display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid ${TOKENS.border};
      font-family: ${TOKENS.mono}; font-size: 9px; letter-spacing: 0.8px; line-height: 1.6;
      color: ${TOKENS.red};
    }
    .limit.visible { display: block; }
    .busy { font-family: ${TOKENS.mono}; font-size: 10px; color: ${TOKENS.muted}; }
    .spinner { display: inline-block; width: 8px; height: 8px; border: 1.5px solid ${TOKENS.faint}; border-top-color: ${TOKENS.text}; border-radius: 50%; animation: fs-spin 0.8s linear infinite; margin-right: 6px; }
    @keyframes fs-spin { to { transform: rotate(360deg); } }
  `
  root.appendChild(style)

  const anchor = document.createElement('div')
  anchor.className = 'anchor'
  root.appendChild(anchor)

  const chip = document.createElement('div')
  chip.className = 'chip'
  chip.title = 'FreshContext — click for details, drag to move'
  const track = document.createElement('div')
  track.className = 'track'
  const fill = document.createElement('div')
  fill.className = 'fill'
  track.appendChild(fill)
  const pct = document.createElement('span')
  pct.className = 'pct'
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  lbl.textContent = 'full'
  chip.append(track, pct, lbl)
  anchor.appendChild(chip)

  const card = document.createElement('div')
  card.className = 'card'
  const title = document.createElement('div')
  title.className = 'title'
  const dot = document.createElement('span')
  dot.className = 'dot'
  const titleText = document.createElement('span')
  title.append(dot, titleText)
  const desc = document.createElement('div')
  desc.className = 'desc'
  const row = document.createElement('div')
  row.className = 'row'
  const primary = document.createElement('button')
  primary.className = 'primary'
  primary.textContent = 'Fresh start'
  const ghost = document.createElement('button')
  ghost.className = 'ghost'
  ghost.textContent = 'Not now'
  row.append(primary, ghost)
  const pickChat = document.createElement('button')
  pickChat.className = 'pickChat'
  pickChat.textContent = 'Transfer an older chat…'
  pickChat.style.display = 'none'
  pickChat.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleCard(false)
    options.onPickChat?.()
  })
  const meta = document.createElement('div')
  meta.className = 'meta'
  const limitLine = document.createElement('div')
  limitLine.className = 'limit'
  card.append(title, desc, row, pickChat, meta, limitLine)
  anchor.appendChild(card)
  if (options.onPickChat) pickChat.style.display = ''

  let expanded = false
  let current: MeterState | null = null
  let limitInfo: LimitInfo | null = null

  const toggleCard = (open: boolean) => {
    expanded = open
    card.classList.toggle('open', expanded)
    if (expanded) options.onCardOpen?.()
  }

  // --- position: default bottom-right, persisted when dragged ---
  const initial = defaultPosition()
  anchor.style.left = `${initial.left}px`
  anchor.style.top = `${initial.top}px`
  void loadPosition().then((pos) => {
    if (pos) {
      anchor.style.left = `${pos.left}px`
      anchor.style.top = `${pos.top}px`
    }
  })

  // --- drag vs click distinction ---
  let drag: { startX: number; startY: number; left: number; top: number; moved: boolean } | null =
    null

  chip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      left: anchor.offsetLeft,
      top: anchor.offsetTop,
      moved: false,
    }
    chip.setPointerCapture(e.pointerId)
  })

  chip.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    chip.classList.add('dragging')
    toggleCard(false)
    const pos = clampToViewport({ left: drag.left + dx, top: drag.top + dy })
    anchor.style.left = `${pos.left}px`
    anchor.style.top = `${pos.top}px`
  })

  const endDrag = (e: PointerEvent) => {
    if (!drag) return
    const wasDrag = drag.moved
    drag = null
    chip.classList.remove('dragging')
    if (wasDrag) {
      void savePosition(clampToViewport({ left: anchor.offsetLeft, top: anchor.offsetTop }))
      e.stopPropagation()
    } else {
      toggleCard(!expanded)
    }
  }
  chip.addEventListener('pointerup', endDrag)
  chip.addEventListener('pointercancel', () => {
    drag = null
    chip.classList.remove('dragging')
  })

  ghost.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleCard(false)
  })
  primary.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleCard(false)
    options.onFreshStart()
  })
  // Close the card on outside clicks — but ignore clicks inside our own
  // shadow host (the chip's own click is what OPENS the card; without this
  // filter the closer fires right after the toggle and the card never opens).
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Node | null
      if (target && (target === host || host.contains(target))) return
      toggleCard(false)
    },
    true,
  )

  function render() {
    if (!current) {
      chip.style.opacity = '0.6'
      pct.textContent = '—'
      pct.style.color = TOKENS.faint
      fill.style.width = '0%'
      return
    }
    chip.style.opacity = '1'

    if (current.measuring) {
      // Correctness-first: no number until the full read lands.
      lbl.textContent = 'measuring'
      pct.textContent = '···'
      pct.style.color = TOKENS.muted
      fill.style.width = '0%'
      fill.style.background = TOKENS.muted
      dot.style.background = TOKENS.muted
      titleText.textContent = 'Measuring context…'
      desc.textContent = 'Reading the full conversation for an accurate count.'
      meta.textContent = `MEASURING · ${current.messages} MSGS SEEN`
      return
    }

    lbl.textContent = 'full'
    const color = LEVEL_COLOR[current.level] ?? TOKENS.green
    fill.style.background = color
    fill.style.width = `${Math.max(current.pct * 100, current.pct > 0 ? 2 : 0)}%`
    pct.textContent = `${formatPct(current.pct)}%`
    pct.style.color = color

    dot.style.background = color

    if (current.messages === 0) {
      titleText.textContent = 'New chat'
      desc.textContent = 'Fresh window — context is empty.'
      meta.textContent = 'NEW CHAT'
      return
    }

    titleText.textContent = `Chat is ${formatPct(current.pct)}% full`
    const left = messagesLeftEstimate(current)
    desc.textContent =
      current.level === 'red'
        ? 'Early messages may be dropping out of the window. FreshContext distills this conversation into a handoff brief and continues in a new chat — here or on another AI.'
        : current.level === 'amber'
          ? 'Quality can drop soon. A fresh start carries everything over as a compact brief.'
          : 'Plenty of context left. Nothing to do yet.'
    const windowPart = formatWindow(current.window)
    meta.textContent = `~${current.tokens.toLocaleString()} TOKENS · ${current.messages} MSGS${left !== null ? ` · ~${left} LEFT` : ''} · ÷${windowPart}${current.windowLabel ? ` · ${current.windowLabel}` : ''}${current.exact ? '' : ' · EST'}`
  }

  function renderLimit(): void {
    if (!limitInfo || !limitInfo.hit) {
      limitLine.classList.remove('visible')
      limitLine.textContent = ''
      return
    }
    limitLine.classList.add('visible')
    const hint = limitInfo.resetHint ? ` · ${limitInfo.resetHint}` : ''
    limitLine.textContent = `LIMIT REACHED${hint}`
  }

  function setBusy(text: string) {
    chip.innerHTML = ''
    const spinner = document.createElement('span')
    spinner.className = 'spinner'
    const label = document.createElement('span')
    label.className = 'busy'
    label.textContent = text
    chip.append(spinner, label)
    chip.style.opacity = '1'
  }

  function restoreChip() {
    chip.innerHTML = ''
    chip.append(track, pct, lbl)
    render()
  }

  return {
    update(state: MeterState) {
      current = state
      restoreChip()
    },
    setBusy,
    setError(text: string) {
      current = null
      restoreChip()
      chip.style.opacity = '1'
      pct.textContent = '!'
      pct.style.color = TOKENS.red
      chip.title = text
      lbl.textContent = 'error'
      toggleCard(false)
    },
    reset() {
      current = null
      restoreChip()
    },
    setLimit(info: LimitInfo | null) {
      limitInfo = info
      renderLimit()
    },
    setVisible(visible: boolean) {
      host.style.display = visible ? '' : 'none'
    },
    resetPosition() {
      const pos = defaultPosition()
      anchor.style.left = `${pos.left}px`
      anchor.style.top = `${pos.top}px`
    },
  }
}
