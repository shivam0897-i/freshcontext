import { COMPOSER_WAIT_MS } from './core/constants'
import { buildHandoffText } from './core/brief'
import { clearPendingBrief, getPendingBrief, getSettings } from './core/storage'
import { detectPlatform } from './platforms'
import type { PlatformAdapter } from './platforms/types'
import { sleep } from './platforms/dom'
import { startMeter } from './meter-runtime'
import { mountBadge } from './ui/badge'
import { mountToast } from './ui/toast'
import type { ToastController } from './ui/toast'
import { runFreshStart } from './flow'

/**
 * Content-script entry — the composition root. It wires pure core, adapters,
 * and UI together and owns nothing itself:
 *
 *   meter-runtime  → pure MeterEngine + adapter reads + background counting
 *   flow           → the FreshContext flow state sequence
 *   pending brief  → insertion on arrival at the destination chat
 *
 * The guard makes injection idempotent: Chrome injects the declared content
 * script on navigation, AND the background worker injects into tabs that
 * were already open when the extension was installed/updated. Without the
 * guard those two paths would stack two badges on one page.
 */

interface FreshStartWindow {
  __freshStartLoaded?: boolean
}

const guard = window as FreshStartWindow
if (guard.__freshStartLoaded) {
  // Already running on this page — do not mount a second badge.
} else {
  guard.__freshStartLoaded = true
  void main()
}

async function handlePendingBrief(adapter: PlatformAdapter, toast: ToastController): Promise<void> {
  const pending = await getPendingBrief()
  if (!pending || pending.destPlatform !== adapter.id) return

  const deadline = Date.now() + COMPOSER_WAIT_MS
  while (Date.now() < deadline && !adapter.getComposer()) {
    await sleep(400)
  }

  const inserted = await adapter.insertText(buildHandoffText(pending.text))
  if (!inserted) {
    toast.show("Brief couldn't be inserted yet — it stays saved. Reload to retry.", 'error')
    return
  }
  await clearPendingBrief()

  if (pending.autoSend) {
    const sent = await adapter.submit()
    toast.show(
      sent.ok
        ? 'Brief sent — continuing in the fresh chat.'
        : 'Brief inserted — press Enter to send it.',
    )
  } else {
    toast.show('Brief inserted — review it and press Enter when ready.')
  }
}

async function main(): Promise<void> {
  const detected = detectPlatform()
  if (!detected) return
  const adapter: PlatformAdapter = detected

  const settings = await getSettings()
  const toast = mountToast()

  let meter: ReturnType<typeof startMeter> | null = null
  const badge = mountBadge({
    onFreshStart: () => {
      void runFreshStart(adapter, {
        badge,
        toast,
        pct: meter?.getDisplayed()?.pct ?? 0,
      })
    },
    onCardOpen: () => {
      // Refresh the platform's limit status whenever the card is expanded —
      // event-driven, no polling.
      void adapter.readLimits().then((info) => badge.setLimit(info))
    },
  })

  meter = startMeter(adapter, badge, settings)

  // Settings changed in the side panel apply immediately — no tab reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['settings']) {
      void getSettings().then((next) => meter?.updateSettings(next))
    }
  })

  await handlePendingBrief(adapter, toast)
}
