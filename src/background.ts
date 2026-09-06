import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { estimateTokens } from './core/estimator'
import type { PlatformId } from './core/constants'

/**
 * Service worker. Exact tokenizers live here — never in the content script —
 * so the per-page bundle stays tiny and tokenizer data loads once, lazily,
 * when the first count request arrives.
 *
 * Counting strategy (honest instrumentation):
 * - chatgpt: o200k_base — exact for GPT-4o/GPT-5 family models.
 * - claude:  o200k_base as a cross-model approximation, labeled as an
 *   estimate. (Anthropic's own tokenizer is exact only for Claude ≤ 2 per
 *   their docs, and it ships WASM that cannot bundle into an MV3 worker.)
 * - gemini:  calibrated heuristic, labeled as an estimate.
 */

const CHAT_ORIGINS = [
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
]

/**
 * Chrome does not inject content scripts into tabs that were already open
 * when the extension was installed or updated — so the very chat the user is
 * looking at would have no badge until they reload. Inject explicitly instead.
 * (content.ts guards against double injection.)
 */
async function injectIntoOpenTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: CHAT_ORIGINS })
    await Promise.all(
      tabs
        .filter((t) => t.id != null)
        .map((t) =>
          chrome.scripting
            .executeScript({ target: { tabId: t.id as number }, files: ['content.js'] })
            .catch(() => undefined),
        ),
    )
  } catch {
    // "scripting" unavailable or tabs API blocked — user reloads tabs manually.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.warn('sidePanel behavior failed', err))
  void injectIntoOpenTabs()
})

function countForPlatform(platform: PlatformId, text: string): { tokens: number; exact: boolean } {
  // Guard: encoding megabytes of conversation synchronously would block the
  // service worker for seconds (delaying every other message, including
  // tab-opening). Fall back to the heuristic for absurdly large inputs.
  if (text.length > 2_000_000) return { tokens: estimateTokens(text), exact: false }
  if (platform === 'chatgpt') return { tokens: encode(text).length, exact: true }
  if (platform === 'claude') return { tokens: encode(text).length, exact: false }
  return { tokens: estimateTokens(text), exact: false }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  try {
    const message = msg as { type?: string; platform?: PlatformId; text?: string; url?: string } | null
    if (!message?.type) return false

    if (message.type === 'countTokens') {
      if (!message.platform || typeof message.text !== 'string') {
        sendResponse({ ok: false, error: 'platform and text required' })
        return true
      }
      const { tokens, exact } = countForPlatform(message.platform, message.text)
      sendResponse({ ok: true, tokens, exact })
      return true
    }

    if (message.type === 'openNewChat') {
      if (typeof message.url !== 'string') {
        sendResponse({ ok: false, error: 'url required' })
        return true
      }
      chrome.tabs.create({ url: message.url, active: true }, () => {
        sendResponse({ ok: !chrome.runtime.lastError })
      })
      return true
    }

    return false
  } catch (err) {
    // Never let a handler crash leave the caller hanging on a dead channel.
    try {
      sendResponse({ ok: false, error: String(err) })
    } catch {
      /* channel already closed */
    }
    return true
  }
})
