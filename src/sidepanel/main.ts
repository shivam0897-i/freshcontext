import { DEFAULT_PROMPT } from '../core/brief'
import { DEFAULT_THRESHOLDS, DEFAULT_WINDOWS } from '../core/constants'
import { getSettings, listBriefs, setSettings, type SavedBrief } from '../core/storage'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el as T
}

const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id)
const textarea = (id: string): HTMLTextAreaElement => $<HTMLTextAreaElement>(id)

async function loadSettings(): Promise<void> {
  const s = await getSettings()
  input('win-chatgpt').value = String(s.windows.chatgpt)
  input('win-claude').value = String(s.windows.claude)
  input('win-gemini').value = String(s.windows.gemini)
  input('thr-amber').value = String(Math.round(s.thresholds.amber * 100))
  input('thr-red').value = String(Math.round(s.thresholds.red * 100))
  textarea('prompt').value = s.promptTemplate
  setSwitch($('autosend'), s.autoSend)
}

function setSwitch(el: HTMLElement, on: boolean): void {
  el.classList.toggle('on', on)
}

async function save(): Promise<void> {
  const amber = clamp(Number(input('thr-amber').value) / 100, 0.1, 0.99)
  const red = clamp(Number(input('thr-red').value) / 100, amber + 0.01, 1)
  await setSettings({
    windows: {
      chatgpt: Math.max(1000, Number(input('win-chatgpt').value) || DEFAULT_WINDOWS.chatgpt),
      claude: Math.max(1000, Number(input('win-claude').value) || DEFAULT_WINDOWS.claude),
      gemini: Math.max(1000, Number(input('win-gemini').value) || DEFAULT_WINDOWS.gemini),
    },
    thresholds: { amber, red },
    autoSend: $('autosend').classList.contains('on'),
    promptTemplate: textarea('prompt').value.trim() || DEFAULT_PROMPT,
  })
  const note = $('saved-note')
  note.textContent = 'SAVED'
  setTimeout(() => (note.textContent = ''), 1600)
  await loadSettings()
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

async function renderBriefs(): Promise<void> {
  const container = $('briefs')
  const briefs = await listBriefs()
  container.innerHTML = ''
  if (briefs.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No handoffs yet — they appear here after each fresh start.'
    container.appendChild(empty)
    return
  }
  for (const brief of briefs) renderBrief(container, brief)
}

function renderBrief(container: HTMLElement, brief: SavedBrief): void {
  const card = document.createElement('div')
  card.className = 'card brief'
  const head = document.createElement('div')
  head.className = 'head'
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${brief.sourcePlatform.toUpperCase()} · ${new Date(brief.createdAt).toLocaleString()}`
  const copy = document.createElement('button')
  copy.className = 'ghost'
  copy.textContent = 'Copy'
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(brief.text).then(() => {
      copy.textContent = 'Copied ✓'
      setTimeout(() => (copy.textContent = 'Copy'), 1500)
    })
  })
  head.append(meta, copy)
  const preview = document.createElement('div')
  preview.className = 'preview'
  preview.textContent = brief.text.split('\n').slice(0, 3).join(' ')
  card.append(head, preview)
  container.appendChild(card)
}

$('autosend').addEventListener('click', () => {
  setSwitch($('autosend'), !$('autosend').classList.contains('on'))
})
$('save').addEventListener('click', () => void save())
$('reset').addEventListener('click', async () => {
  await setSettings({
    windows: { ...DEFAULT_WINDOWS },
    thresholds: { ...DEFAULT_THRESHOLDS },
    autoSend: false,
    promptTemplate: DEFAULT_PROMPT,
  })
  await loadSettings()
  await renderBriefs()
})

void loadSettings()
void renderBriefs()
