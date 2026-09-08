import { DEFAULT_PROMPT } from './brief'
import { planById } from './presets'
import { DEFAULT_THRESHOLDS, DEFAULT_WINDOWS } from './constants'
import type { PlatformId, Thresholds } from './constants'

export interface Settings {
  thresholds: Thresholds
  /** Effective fallback window per platform (used when detection can't read
   *  the active model — the plan selection below is the source of truth). */
  windows: Record<PlatformId, number>
  /** Selected plan id per platform (see core/presets PLAN_PRESETS). */
  plans: Record<PlatformId, string>
  autoSend: boolean
  promptTemplate: string
  /** Master switch for the floating badge. */
  badgeVisible: boolean
  /** Per-platform kill switch — a platform set to false is fully inert. */
  enabledPlatforms: Record<PlatformId, boolean>
}

export interface PendingBrief {
  destPlatform: PlatformId
  text: string
  autoSend: boolean
  createdAt: number
}

export interface SavedBrief {
  id: string
  sourcePlatform: PlatformId
  text: string
  createdAt: number
}

const DEFAULT_SETTINGS: Settings = {
  thresholds: DEFAULT_THRESHOLDS,
  windows: { ...DEFAULT_WINDOWS },
  plans: { chatgpt: 'free', claude: 'default', gemini: 'free' },
  autoSend: false,
  promptTemplate: DEFAULT_PROMPT,
  badgeVisible: true,
  enabledPlatforms: { chatgpt: true, claude: true, gemini: true },
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get('settings')
  const s = (raw?.['settings'] ?? {}) as Partial<Settings>
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s.thresholds ?? {}) },
    windows: { ...DEFAULT_SETTINGS.windows, ...(s.windows ?? {}) },
    plans: { ...DEFAULT_SETTINGS.plans, ...(s.plans ?? {}) },
    enabledPlatforms: { ...DEFAULT_SETTINGS.enabledPlatforms, ...(s.enabledPlatforms ?? {}) },
    promptTemplate: s.promptTemplate?.trim() ? s.promptTemplate : DEFAULT_PROMPT,
  }
  // Migration: installs from before plan selection stored only a window
  // number. A window that matches no plan default is the user's custom
  // choice — keep it authoritative instead of silently re-plan-ing them.
  if (!s.plans) {
    for (const platform of Object.keys(merged.windows) as PlatformId[]) {
      const plan = planById(platform, merged.plans[platform])
      const fallback = plan ? plan.instantWindow : DEFAULT_WINDOWS[platform]
      if (merged.windows[platform] !== fallback) merged.plans[platform] = 'custom'
    }
  }
  return merged
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings()
  await chrome.storage.local.set({ settings: { ...cur, ...patch } })
}

export async function savePendingBrief(p: PendingBrief): Promise<void> {
  await chrome.storage.local.set({ pendingBrief: p })
}

export async function getPendingBrief(): Promise<PendingBrief | null> {
  const raw = await chrome.storage.local.get('pendingBrief')
  return (raw?.['pendingBrief'] as PendingBrief | undefined) ?? null
}

export async function clearPendingBrief(): Promise<void> {
  await chrome.storage.local.remove('pendingBrief')
}

/** Keep the last 20 briefs so nothing is ever silently lost. */
export async function saveBrief(sourcePlatform: PlatformId, text: string): Promise<SavedBrief> {
  const raw = await chrome.storage.local.get('briefs')
  const briefs = (raw?.['briefs'] ?? []) as SavedBrief[]
  const brief: SavedBrief = {
    id: String(Date.now()),
    sourcePlatform,
    text,
    createdAt: Date.now(),
  }
  await chrome.storage.local.set({ briefs: [brief, ...briefs].slice(0, 20) })
  return brief
}

export async function listBriefs(): Promise<SavedBrief[]> {
  const raw = await chrome.storage.local.get('briefs')
  return (raw?.['briefs'] ?? []) as SavedBrief[]
}
