import type { PlatformId } from '../core/constants'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface LimitInfo {
  /** True when the platform says the user cannot send right now. */
  hit: boolean
  /** Reset information the platform surfaced, verbatim-ish. */
  resetHint?: string
  detail?: string
}

export interface SubmitResult {
  ok: boolean
  /** Human-readable reason when verification failed — shown in error states. */
  reason?: string
}

/**
 * The isolation boundary: every site-specific selector and behavior lives
 * behind this interface. Nothing outside src/platforms may query platform DOM.
 *
 * All techniques are evidence-backed from shipping open-source extensions —
 * see .firecrawl/research/technical.md for the source of each selector/method.
 */
export interface PlatformAdapter {
  readonly id: PlatformId
  readonly label: string
  readonly newChatUrl: string

  /** True when this adapter owns the current page. */
  detect(): boolean

  getComposer(): HTMLElement | null

  /** Insert text with a verified cascade; resolves true only if text landed. */
  insertText(text: string): Promise<boolean>

  /** Send the composed message; resolves true only if the composer cleared. */
  submit(): Promise<SubmitResult>

  /**
   * Full conversation, API-first where a same-session endpoint is proven
   * (ChatGPT backend-api, Claude chat_conversations), DOM fallback otherwise.
   * API-first matters: all three sites virtualize long chats, and long chats
   * are exactly what this extension exists for.
   */
  readConversation(): Promise<ChatMessage[]>

  /**
   * Cheap synchronous DOM-only read for the live meter. May under-count on
   * virtualized long chats — that's acceptable for a meter that is always
   * labeled as an estimate; the exact read happens in the FreshContext flow.
   */
  readConversationFast(): ChatMessage[]

  /** Wait for the next assistant response to finish; returns its text or null. */
  waitForResponse(timeoutMs: number): Promise<string | null>

  /** Whatever limit info the platform actually exposes. Null when it doesn't. */
  readLimits(): Promise<LimitInfo | null>
}
