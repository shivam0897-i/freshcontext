import { DEFAULT_PROMPT } from './brief'
import { DEFAULT_THRESHOLDS, DEFAULT_WINDOWS } from './constants'
import type { PlatformId, Thresholds } from './constants'

export interface Settings {
  thresholds: Thresholds
  windows: Record<PlatformId, number>
  autoSend: boolean
  promptTemplate: string
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
  autoSend: false,
  promptTemplate: DEFAULT_PROMPT,
}

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get('settings')
  const s = (raw?.['settings'] ?? {}) as Partial<Settings>
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s.thresholds ?? {}) },
    windows: { ...DEFAULT_SETTINGS.windows, ...(s.windows ?? {}) },
    promptTemplate: s.promptTemplate?.trim() ? s.promptTemplate : DEFAULT_PROMPT,
  }
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
