import type { PlatformId } from './constants'

/**
 * Promise wrappers around chrome.runtime messaging. All resolve to null/false
 * on any failure — the UI treats "no exact count" as an estimate and keeps
 * working; nothing here is allowed to break the flow.
 */

export interface TokenCountResult {
  tokens: number
  exact: boolean
}

export function countTokensViaBackground(
  platform: PlatformId,
  text: string,
): Promise<TokenCountResult | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'countTokens', platform, text }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) return resolve(null)
        resolve({ tokens: res.tokens as number, exact: res.exact as boolean })
      })
    } catch {
      resolve(null)
    }
  })
}

export function openNewChat(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Preferred path: window.open straight from the confirm click — works
    // even when the service worker is asleep or failed to start. (Run inside
    // the user-gesture window; strip opener manually since 'noopener' makes
    // window.open return null on success.)
    try {
      const win = window.open(url, '_blank')
      if (win) {
        win.opener = null
        resolve(true)
        return
      }
    } catch {
      /* popup blocked or not in a gesture — fall through */
    }
    // Fallback: the service worker's tabs.create (no gesture requirement).
    try {
      chrome.runtime.sendMessage({ type: 'openNewChat', url }, (res) => {
        resolve(Boolean(!chrome.runtime.lastError && res?.ok))
      })
    } catch {
      resolve(false)
    }
  })
}
