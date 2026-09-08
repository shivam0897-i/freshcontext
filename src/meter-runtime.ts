import type { PlatformId } from './core/constants'
import type { MeterRequest, MeterSettings } from './core/meter-engine'
import { createMeterEngine } from './core/meter-engine'
import { countTokensViaBackground } from './core/rpc'
import { planById, resolveWindow } from './core/presets'
import type { Settings } from './core/storage'
import { saveLiveModel, type LiveModel } from './core/storage'
import type { MeterState } from './core/meter'
import type { PlatformAdapter } from './platforms/types'
import type { BadgeController } from './ui/badge'

/**
 * Impure shell around the pure MeterEngine: supplies DOM reads, timers, and
 * background token counting, and interprets the engine's read requests.
 *
 * Scheduling: the engine requests reads; only the LATEST request ever runs.
 * The first read of a conversation is served fast (~400ms); re-reads after
 * changes wait for the conversation to settle (~3s) so streaming replies
 * don't trigger a read per poll.
 */

const TICK_MS = 2500
const INITIAL_READ_DELAY_MS = 400
const SETTLED_READ_DEBOUNCE_MS = 3000
/** The active model changes only on explicit user action — re-scanning the
 *  picker (a layout-forcing innerText pass over every button) every tick is
 *  wasted work. Scan every Nth tick, plus immediately on URL or settings
 *  changes. */
const MODEL_SCAN_EVERY_N_TICKS = 4

export interface MeterRuntime {
  updateSettings(settings: Settings): void
  getDisplayed(): MeterState | null
  refresh(): void
}

export function startMeter(
  adapter: PlatformAdapter,
  badge: BadgeController,
  initialSettings: Settings,
): MeterRuntime {
  let settings = initialSettings
  let readTimer: ReturnType<typeof setTimeout> | null = null
  let lastDetectedModel: string | null = null
  let lastUrl: string | null = null
  let tickCount = 0
  let lastWrittenLive: LiveModel | null = null

  const engine = createMeterEngine({
    platform: adapter.id,
    settings: meterSettingsFor(adapter.id, settings),
    onDisplay: (display) => badge.update(display),
    onRequestFullRead: (request) => scheduleRead(request),
  })

  function scheduleRead(request: MeterRequest): void {
    if (readTimer) clearTimeout(readTimer)
    const delay = request.urgency === 'initial' ? INITIAL_READ_DELAY_MS : SETTLED_READ_DEBOUNCE_MS
    readTimer = setTimeout(() => {
      readTimer = null
      void runRead(request)
    }, delay)
  }

  async function runRead(request: MeterRequest): Promise<void> {
    try {
      // Gemini exposes no same-session API, and force-loading the full
      // history would hijack the user's scroll — its "full read" is the
      // rendered DOM, labeled as an estimate.
      const messages =
        adapter.id === 'gemini'
          ? adapter.readConversationFast()
          : await adapter.readConversation()
      if (messages.length === 0) return

      const joined = messages.map((m) => m.text).join('\n')
      const counted = await countTokensViaBackground(adapter.id, joined)
      engine.dispatch({
        type: 'fullRead',
        readId: request.readId,
        url: location.href,
        messages,
        tokens: counted ? counted.tokens : null,
        exact: counted ? counted.exact : false,
      })
    } catch {
      // Read failed — the engine keeps its previous baseline; the next
      // conversation change schedules a retry.
    }
  }

  /**
   * The effective window: auto-detected from the active model where the
   * model determines it (Claude), otherwise the user's plan setting. A model
   * switch mid-conversation changes the divisor, and the engine recomputes
   * the display from its retained readings — no re-read of the page needed.
   */
  /**
   * The active model's text, with hysteresis: a missed scan (picker
   * re-rendering, dropdown open — scanModelText returns null while any menu
   * is expanded) must not flip the divisor to the plan fallback and back.
   * The cache is cleared on conversation switch so a new chat never inherits
   * the previous chat's model, and the scan itself runs on a cadence because
   * the model changes only on explicit user action.
   */
  function currentModelText(forceScan: boolean): string | null {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      lastDetectedModel = null
      forceScan = true
    }
    if (forceScan || tickCount % MODEL_SCAN_EVERY_N_TICKS === 0) {
      const detected = adapter.detectActiveModel?.() ?? null
      if (detected) lastDetectedModel = detected
    }
    return lastDetectedModel
  }

  function applyWindow(forceScan = false): void {
    const modelText = currentModelText(forceScan)
    const resolved = resolveWindow(adapter.id, settings.plans[adapter.id], modelText)
    const plan = planById(adapter.id, settings.plans[adapter.id])
    const window = resolved?.window ?? settings.windows[adapter.id]
    // Provenance: detected model/mode, else the plan setting, else a custom
    // window number with no label (the badge shows the bare divisor). The
    // engine's own display dedup absorbs repeated identical dispatches, so
    // no shadow cache of "last applied window" is kept here — that second
    // source of truth is exactly what caused the divisor flicker before.
    const label =
      resolved?.label ?? (resolved && plan ? `${plan.label.toUpperCase()} · SETTING` : undefined)
    engine.dispatch({ type: 'settings', settings: { windowSize: window, windowLabel: label } })

    // Surface the live state to the side panel — written only on change so
    // the storage doesn't churn every tick.
    if (window !== lastWrittenLive?.window || label !== lastWrittenLive?.label || modelText !== lastWrittenLive?.model) {
      lastWrittenLive = { platform: adapter.id, model: modelText, window, label: label ?? null, updatedAt: Date.now() }
      void saveLiveModel(lastWrittenLive)
    }
  }

  function tick(): void {
    tickCount++
    applyWindow()
    engine.dispatch({
      type: 'snapshot',
      url: location.href,
      messages: adapter.readConversationFast(),
    })
  }

  const interval = setInterval(tick, TICK_MS)
  tick()

  return {
    updateSettings(next: Settings) {
      settings = next
      // Only thresholds here — applyWindow() is the single dispatcher of
      // window changes (forced scan: the user just changed the plan).
      engine.dispatch({ type: 'settings', settings: { thresholds: next.thresholds } })
      applyWindow(true)
    },
    getDisplayed: () => engine.getDisplayed(),
    refresh: tick,
  }
}

function meterSettingsFor(platform: PlatformId, s: Settings): MeterSettings {
  return { windowSize: s.windows[platform], thresholds: s.thresholds }
}
