import { TOKENS, createShadowHost } from './overlay-lib'

export interface ToastController {
  show(message: string, kind?: 'info' | 'error'): void
}

export function mountToast(): ToastController {
  const { root } = createShadowHost('2147483646')
  const box = document.createElement('div')
  root.appendChild(box)

  const style = document.createElement('style')
  style.textContent = `
    .toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: ${TOKENS.card}; color: ${TOKENS.text};
      border: 1px solid ${TOKENS.border}; border-radius: ${TOKENS.radius};
      padding: 10px 16px; font: 12px/1.4 ${TOKENS.sans};
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      opacity: 0; transition: opacity 0.18s ease, transform 0.18s ease;
      max-width: 420px; text-align: center;
    }
    .toast.visible { opacity: 1; }
    .toast.error { border-color: ${TOKENS.red}; }
    .toast .mono { font-family: ${TOKENS.mono}; font-size: 10px; letter-spacing: 1px; color: ${TOKENS.faint}; display: block; margin-top: 4px; }
  `
  root.appendChild(style)

  const el = document.createElement('div')
  el.className = 'toast'
  box.appendChild(el)

  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    show(message: string, kind: 'info' | 'error' = 'info') {
      el.className = `toast visible${kind === 'error' ? ' error' : ''}`
      el.textContent = message
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        el.className = 'toast'
      }, 4200)
    },
  }
}
