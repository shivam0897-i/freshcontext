import { chatgpt } from './chatgpt'
import { claude } from './claude'
import { gemini } from './gemini'
import type { PlatformAdapter } from './types'

export const ADAPTERS: PlatformAdapter[] = [chatgpt, claude, gemini]

export function detectPlatform(): PlatformAdapter | null {
  return ADAPTERS.find((a) => a.detect()) ?? null
}

export function adapterFor(id: string): PlatformAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null
}
