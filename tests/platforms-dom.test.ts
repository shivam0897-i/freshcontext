import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatgpt } from '../src/platforms/chatgpt'
import { claude } from '../src/platforms/claude'
import { gemini } from '../src/platforms/gemini'

const CHATGPT_DOM = `
  <main>
    <div data-message-author-role="user"><div data-message-content>Build a dashboard.</div></div>
    <div data-message-author-role="assistant"><div data-message-content>Sure — Vite and Recharts?</div></div>
    <div data-message-author-role="assistant"><div data-message-content>Let me scaffold it for you.</div></div>
  </main>
  <footer>
    <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
    <button data-testid="send-button">Send</button>
  </footer>
`

// Current Claude markup: user-message / assistant-message testids, with
// .font-claude-response as the legacy assistant fallback that can NEST inside
// an assistant-message (the reader must drop the nested duplicate).
const CLAUDE_DOM = `
  <main>
    <div data-testid="user-message">Build a dashboard.</div>
    <div data-testid="assistant-message">
      <div class="font-claude-response">Sure — Vite and Recharts?</div>
    </div>
    <div data-testid="assistant-message">Let me scaffold it for you.</div>
  </main>
  <footer>
    <div data-placeholder="How can I help?" contenteditable="true"></div>
    <button data-testid="send-button">Send</button>
  </footer>
`

// Current Gemini markup: user text wraps in user-query-content (legacy bare
// user-query may nest inside it — the reader drops the duplicate), assistant
// text in model-response > message-content > .markdown.
const GEMINI_DOM = `
  <main class="chat-history">
    <user-query-content>
      <user-query><div class="query-content"><span class="query-text">Build a dashboard.</span></div></user-query>
    </user-query-content>
    <model-response><message-content><div class="markdown">Sure — Vite and Recharts?</div></message-content></model-response>
    <model-response><message-content><div class="markdown">Let me scaffold it for you.</div></message-content></model-response>
  </main>
  <footer>
    <div class="ql-editor" contenteditable="true"></div>
    <button aria-label="Send message">Send</button>
  </footer>
`

function load(html: string): void {
  document.body.innerHTML = html
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('chatgpt adapter (DOM contract)', () => {
  it('extracts messages via readConversationFast', () => {
    load(CHATGPT_DOM)
    const messages = chatgpt.readConversationFast()
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({ role: 'user', text: 'Build a dashboard.' })
    expect(messages[2]?.text).toBe('Let me scaffold it for you.')
  })

  it('finds the composer', () => {
    load(CHATGPT_DOM)
    expect(chatgpt.getComposer()?.id).toBe('prompt-textarea')
  })

  it('submits by clicking the send button and verifies the composer cleared', async () => {
    load(CHATGPT_DOM)
    const composer = chatgpt.getComposer() as HTMLElement
    composer.textContent = 'hello'
    document
      .querySelector('[data-testid="send-button"]')
      ?.addEventListener('click', () => {
        composer.textContent = ''
      })
    const result = await chatgpt.submit()
    expect(result.ok).toBe(true)
  })

  it('reports failure when the composer does not clear', async () => {
    load(CHATGPT_DOM)
    ;(chatgpt.getComposer() as HTMLElement).textContent = 'hello'
    const result = await chatgpt.submit()
    expect(result.ok).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('falls back to the DOM read when the API path is unavailable', async () => {
    load(CHATGPT_DOM)
    const messages = await chatgpt.readConversation()
    expect(messages).toHaveLength(3)
  })
})

describe('claude adapter (DOM contract)', () => {
  it('extracts turns with roles via readConversationFast', () => {
    load(CLAUDE_DOM)
    const messages = claude.readConversationFast()
    expect(messages).toHaveLength(3)
    expect(messages[0]?.role).toBe('user')
    expect(messages[1]?.role).toBe('assistant')
    expect(messages[2]?.text).toContain('scaffold')
  })

  it('finds the bottom-most contenteditable composer', () => {
    load(CLAUDE_DOM)
    expect(claude.getComposer()?.getAttribute('data-placeholder')).toBe('How can I help?')
  })
})

describe('gemini adapter (DOM contract)', () => {
  it('extracts user-query and model-response turns', () => {
    load(GEMINI_DOM)
    const messages = gemini.readConversationFast()
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({ role: 'user', text: 'Build a dashboard.' })
    expect(messages[1]?.role).toBe('assistant')
  })

  it('finds the Quill composer', () => {
    load(GEMINI_DOM)
    expect(gemini.getComposer()?.className).toContain('ql-editor')
  })
})

describe('limit detection', () => {
  it('chatgpt: detects the limit-hit dialog and its reset hint', async () => {
    load(CHATGPT_DOM)
    const alert = document.createElement('div')
    alert.setAttribute('role', 'alert')
    alert.textContent = "You've hit your usage limit. Please try again at 3:00 PM."
    document.body.appendChild(alert)
    const info = await chatgpt.readLimits()
    expect(info?.hit).toBe(true)
    expect(info?.resetHint).toMatch(/3:00 PM/)
  })

  it('chatgpt: returns null when no limit UI is present', async () => {
    load(CHATGPT_DOM)
    expect(await chatgpt.readLimits()).toBeNull()
  })

  it('claude: detects the in-chat limit banner', async () => {
    load(CLAUDE_DOM)
    const banner = document.createElement('div')
    banner.className = 'bg-amber-200 error-banner'
    banner.textContent = 'You have hit your usage limit. Your limit resets at 5 PM.'
    document.body.appendChild(banner)
    const info = await claude.readLimits()
    expect(info?.hit).toBe(true)
    expect(info?.resetHint).toMatch(/5 PM/)
  })

  it('gemini: ignores unrelated status messages', async () => {
    load(GEMINI_DOM)
    const status = document.createElement('div')
    status.setAttribute('role', 'status')
    status.textContent = 'Response generated'
    document.body.appendChild(status)
    expect(await gemini.readLimits()).toBeNull()
  })
})

describe('waitForNewAssistantMessage', () => {
  it('resolves when the new assistant text stabilizes', async () => {
    vi.useFakeTimers()
    const dom = await import('../src/platforms/dom')
    const responses = ['', '', 'GOAL\nDo the', 'GOAL\nDo the thing.', 'GOAL\nDo the thing.']
    let calls = 0
    const readLast = () => responses[Math.min(calls++, responses.length - 1)] ?? ''
    const promise = dom.waitForNewAssistantMessage({
      previousLastText: '',
      readLast,
      stableMs: 300,
      pollMs: 100,
      timeoutMs: 5000,
    })
    const resolved = await vi.advanceTimersByTimeAsync(1600)
    void resolved
    const result = await promise
    expect(result).toContain('Do the thing.')
  })

  it('returns null on timeout when nothing new appeared', async () => {
    vi.useFakeTimers()
    const dom = await import('../src/platforms/dom')
    const promise = dom.waitForNewAssistantMessage({
      previousLastText: 'same old',
      readLast: () => 'same old',
      stableMs: 300,
      pollMs: 50,
      timeoutMs: 500,
    })
    await vi.advanceTimersByTimeAsync(800)
    const result = await promise
    expect(result).toBeNull()
  })
})
