import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingBrief,
  getPendingBrief,
  getSettings,
  saveBrief,
  savePendingBrief,
  setSettings,
} from '../src/core/storage'
import { DEFAULT_PROMPT } from '../src/core/brief'

function installChromeMock(): void {
  const store = new Map<string, unknown>()
  ;(globalThis as Record<string, unknown>)['chrome'] = {
    storage: {
      local: {
        get: (keys: string | string[]) =>
          Promise.resolve(
            typeof keys === 'string' ? { [keys]: store.get(keys) } : Object.fromEntries(keys.map((k) => [k, store.get(k)])),
          ),
        set: (items: Record<string, unknown>) => {
          Object.entries(items).forEach(([k, v]) => store.set(k, v))
          return Promise.resolve()
        },
        remove: (keys: string | string[]) => {
          ;(typeof keys === 'string' ? [keys] : keys).forEach((k) => store.delete(k))
          return Promise.resolve()
        },
      },
    },
  }
}

beforeEach(() => {
  installChromeMock()
})

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    const s = await getSettings()
    expect(s.thresholds.amber).toBe(0.7)
    expect(s.windows.chatgpt).toBe(27_000)
    expect(s.promptTemplate).toBe(DEFAULT_PROMPT)
    expect(s.autoSend).toBe(false)
    expect(s.badgeVisible).toBe(true)
    expect(s.enabledPlatforms).toEqual({ chatgpt: true, claude: true, gemini: true })
    expect(s.plans).toEqual({ chatgpt: 'free', claude: 'default', gemini: 'free' })
  })

  it('migrates pre-plan installs: legacy plan selections map to their successors', async () => {
    // 32K was the old Plus/Business preset — an engaged Plus user, not a custom choice.
    await chrome.storage.local.set({
      settings: { windows: { chatgpt: 32_000, claude: 200_000, gemini: 32_000 } },
    })
    const s = await getSettings()
    expect(s.plans.chatgpt).toBe('plus')
    expect(s.plans.claude).toBe('default')
    expect(s.plans.gemini).toBe('free')
  })

  it('migrates old Free and Pro windows to their plans', async () => {
    await chrome.storage.local.set({
      settings: { windows: { chatgpt: 16_000, claude: 500_000, gemini: 1_000_000 } },
    })
    const s = await getSettings()
    expect(s.plans.chatgpt).toBe('free')
    expect(s.plans.claude).toBe('newer')
    expect(s.plans.gemini).toBe('aipro')
  })

  it('keeps a genuinely custom window custom', async () => {
    await chrome.storage.local.set({
      settings: { windows: { chatgpt: 64_000, claude: 200_000, gemini: 32_000 } },
    })
    const s = await getSettings()
    expect(s.plans.chatgpt).toBe('custom')
    expect(s.windows.chatgpt).toBe(64_000)
  })

  it('merges partial patches with defaults', async () => {
    await setSettings({ windows: { chatgpt: 128_000, claude: 200_000, gemini: 32_000 } })
    const s = await getSettings()
    expect(s.windows.chatgpt).toBe(128_000)
    expect(s.thresholds.red).toBe(0.85) // untouched default survives
  })

  it('keeps new fields defaulted when stored settings predate them', async () => {
    // Simulates an upgrade from a version without badgeVisible/enabledPlatforms.
    await chrome.storage.local.set({
      settings: { autoSend: true, thresholds: { amber: 0.8, red: 0.9 } },
    })
    const s = await getSettings()
    expect(s.autoSend).toBe(true)
    expect(s.thresholds.amber).toBe(0.8)
    expect(s.badgeVisible).toBe(true)
    expect(s.enabledPlatforms.claude).toBe(true)
  })
})

describe('pending brief', () => {
  it('round-trips a pending brief', async () => {
    await savePendingBrief({
      destPlatform: 'claude',
      text: 'GOAL\nDo the thing.',
      autoSend: false,
      createdAt: 1_000,
    })
    const pending = await getPendingBrief()
    expect(pending?.destPlatform).toBe('claude')
    expect(pending?.text).toContain('GOAL')

    await clearPendingBrief()
    expect(await getPendingBrief()).toBeNull()
  })
})

describe('saved briefs', () => {
  it('stores briefs most-recent-first and caps the history at 20', async () => {
    for (let i = 0; i < 25; i++) {
      await saveBrief('chatgpt', `brief ${i}`)
    }
    const raw = await chrome.storage.local.get('briefs')
    const briefs = raw['briefs'] as { text: string }[]
    expect(briefs).toHaveLength(20)
    expect(briefs[0]?.text).toBe('brief 24')
  })
})
