/**
 * "Precision instrument" design system — shared by badge, review overlay,
 * toasts, and the side panel. Dark surfaces, hairline borders, monospace
 * data, one radius, semantic color only as instrument readings.
 */
export const TOKENS = {
  bg: '#0a0a0b',
  card: '#131314',
  border: '#26262a',
  borderBright: '#4d4d55',
  text: '#f2f2f3',
  muted: '#a0a0a8',
  faint: '#6e6e76',
  green: '#4caf82',
  amber: '#d6a335',
  red: '#e06c5e',
  white: '#ffffff',
  radius: '8px',
  mono:
    'ui-monospace, "SF Mono", "Cascadia Code", Consolas, "Roboto Mono", monospace',
  sans: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
} as const

export const RESET_CSS = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  button {
    font: inherit; color: inherit; background: none; border: none;
    padding: 0; cursor: pointer;
  }
  textarea { font: inherit; color: inherit; background: none; border: none; padding: 0; resize: vertical; }
`

/** Creates a closed Shadow DOM host fixed-positioned over the page. */
export function createShadowHost(zIndex: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div')
  host.setAttribute('data-fresh-start', '')
  host.style.position = 'fixed'
  host.style.zIndex = zIndex
  document.documentElement.appendChild(host)
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = RESET_CSS
  root.appendChild(style)
  return { host, root }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
