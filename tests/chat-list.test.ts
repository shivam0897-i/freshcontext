import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatgpt } from '../src/platforms/chatgpt'
import { claude } from '../src/platforms/claude'

/**
 * The history-picker capabilities, tested against the documented response
 * shapes of each platform's same-session API (see .firecrawl research):
 * ChatGPT /backend-api/conversations → { items: [...] } with unix-second or
 * ISO timestamps and newline-padded titles; Claude
 * /api/organizations/{org}/chat_conversations → a top-level array with
 * uuid/name/summary/ISO timestamps.
 */

interface Route {
  pattern: string
  body: unknown
  status?: number
}

function stubFetch(routes: Route[]): string[] {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    for (const route of routes) {
      if (url.includes(route.pattern)) {
        return new Response(JSON.stringify(route.body), {
          status: route.status ?? 200,
        })
      }
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return calls
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  document.body.innerHTML = ''
  document.cookie = 'lastActiveOrg=; Max-Age=0'
  vi.useRealTimers()
})

describe('chatgpt history capabilities', () => {
  it('lists chats: trims newline-padded titles, sorts newest-first, parses timestamps', async () => {
    stubFetch([
      { pattern: '/api/auth/session', body: { accessToken: 'tok' } },
      {
        pattern: '/backend-api/conversations',
        body: {
          items: [
            { id: 'old', title: 'Older chat\n', create_time: 1_770_000_000 },
            { id: 'new', title: 'Newest chat', create_time: '2026-09-06T12:00:00Z', update_time: 1_780_000_000 },
            { id: 'mid', title: '', create_time: 1_775_000_000 },
          ],
          total: 3,
        },
      },
    ])
    const chats = await chatgpt.listChats!()
    expect(chats.map((c) => c.id)).toEqual(['new', 'mid', 'old'])
    expect(chats[0]?.title).toBe('Newest chat')
    expect(chats[1]?.title).toBe('Untitled chat') // empty title → fallback
    expect(chats[0]?.updatedAt).toBe(1_780_000_000 * 1000) // unix seconds → ms
    expect(chats[2]?.updatedAt).toBe(1_770_000_000 * 1000)
  })

  it('reads a conversation by id with the same message mapping as the open-chat read', async () => {
    stubFetch([
      { pattern: '/api/auth/session', body: { accessToken: 'tok' } },
      {
        pattern: '/backend-api/conversation/picked',
        body: {
          mapping: {
            a: { message: { author: { role: 'user' }, create_time: 1, content: { parts: ['Build it'] } } },
            b: { message: { author: { role: 'assistant' }, create_time: 2, content: { parts: ['Done'] } } },
            c: { message: { author: { role: 'system' }, create_time: 3, content: { parts: ['ignored'] } } },
          },
        },
      },
    ])
    const messages = await chatgpt.readConversationById!('picked')
    expect(messages).toEqual([
      { role: 'user', text: 'Build it' },
      { role: 'assistant', text: 'Done' },
    ])
  })

  it('identifies the current conversation from the URL', () => {
    window.history.pushState({}, '', '/c/abc-123-def')
    expect(chatgpt.currentConversationId!()).toBe('abc-123-def')
    window.history.pushState({}, '', '/')
    expect(chatgpt.currentConversationId!()).toBeNull()
  })

  it('returns an empty list without throwing when the API refuses', async () => {
    stubFetch([
      { pattern: '/api/auth/session', body: {}, status: 401 },
    ])
    const chats = await chatgpt.listChats!()
    expect(chats).toEqual([])
  })
})

describe('claude history capabilities', () => {
  beforeEach(() => {
    document.cookie = 'lastActiveOrg=org-1'
  })

  it('lists chats from the v2 endpoint (data-wrapped) that the app itself uses', async () => {
    stubFetch([
      {
        pattern: '/api/organizations/org-1/chat_conversations_v2',
        body: {
          data: [
            { uuid: 'u1', name: 'Dashboard work', updated_at: '2026-09-05T10:00:00Z' },
            { uuid: 'u2', name: '', summary: 'CSV import debugging', created_at: '2026-09-06T10:00:00Z' },
            { uuid: 'u3', name: '', summary: '', created_at: '2026-09-01T10:00:00Z' },
          ],
          has_more: true,
        },
      },
    ])
    const chats = await claude.listChats!()
    expect(chats.map((c) => c.id)).toEqual(['u2', 'u1', 'u3']) // sorted newest first
    expect(chats[0]?.title).toBe('CSV import debugging') // summary fallback
    expect(chats[1]?.title).toBe('Dashboard work')
    expect(chats[2]?.title).toBe('Untitled chat') // final fallback
  })

  it('falls back to the v1 bare-array endpoint when v2 is unavailable', async () => {
    stubFetch([
      { pattern: 'chat_conversations_v2', body: {}, status: 404 },
      {
        pattern: '/api/organizations/org-1/chat_conversations',
        body: [
          { uuid: 'v1-chat', name: 'From v1', updated_at: '2026-09-07T10:00:00Z' },
        ],
      },
    ])
    const chats = await claude.listChats!()
    expect(chats.map((c) => c.id)).toEqual(['v1-chat'])
  })

  it('captures the conversation model for API-first detection', async () => {
    stubFetch([
      {
        pattern: '/api/organizations/org-1/chat_conversations/uuid-9',
        body: {
          model: 'claude-sonnet-5',
          chat_messages: [
            { sender: 'human', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
      },
    ])
    document.cookie = 'lastActiveOrg=org-1'
    await claude.readConversationById!('uuid-9')
    expect(claude.detectActiveModel!()).toBe('claude-sonnet-5')
  })

  it('reads a conversation by uuid, mapping senders to roles', async () => {
    stubFetch([
      {
        pattern: '/api/organizations/org-1/chat_conversations/uuid-9',
        body: {
          chat_messages: [
            { sender: 'human', content: [{ type: 'text', text: 'Build a dashboard.' }] },
            { sender: 'assistant', content: [{ type: 'text', text: 'On it.' }] },
            { sender: 'system', content: [{ type: 'text', text: 'ignored' }] },
          ],
        },
      },
    ])
    const messages = await claude.readConversationById!('uuid-9')
    expect(messages).toEqual([
      { role: 'user', text: 'Build a dashboard.' },
      { role: 'assistant', text: 'On it.' },
    ])
  })

  it('identifies the current conversation from the URL', () => {
    window.history.pushState({}, '', '/chat/9f0c1a2b-1111-2222-3333-444455556666')
    expect(claude.currentConversationId!()).toBe('9f0c1a2b-1111-2222-3333-444455556666')
    window.history.pushState({}, '', '/new')
    expect(claude.currentConversationId!()).toBeNull()
  })
})
