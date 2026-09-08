import { DEFAULT_PROMPT } from '../core/brief'
import { DEFAULT_THRESHOLDS, DEFAULT_WINDOWS } from '../core/constants'
import type { PlatformId } from '../core/constants'
import {
  PLAN_PRESETS,
  WARNING_PRESETS,
  fallbackModeForPlan,
  formatWindow,
  planById,
  planForWindow,
  presetForThresholds,
  type PlanPreset,
} from '../core/presets'
import { getSettings, listBriefs, setSettings, type SavedBrief, type Settings } from '../core/storage'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el as T
}

const input = (id: string): HTMLInputElement => $<HTMLInputElement>(id)
const textarea = (id: string): HTMLTextAreaElement => $<HTMLTextAreaElement>(id)

let settings: Settings
let savedTimer: ReturnType<typeof setTimeout> | null = null

/** Auto-save is the whole point — there is no Save button to forget. */
async function save(patch: Partial<Settings>): Promise<void> {
  await setSettings(patch)
  const el = $('saved')
  el.classList.add('show')
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => el.classList.remove('show'), 1400)
}

function setSwitch(el: HTMLElement, on: boolean): void {
  el.classList.toggle('on', on)
}

// --- general ---------------------------------------------------------------

function bindSwitch(id: string, get: (s: Settings) => boolean, patch: (on: boolean) => Partial<Settings>): void {
  const el = $(id)
  el.addEventListener('click', () => {
    const next = !el.classList.contains('on')
    setSwitch(el, next)
    void save(patch(next))
  })
  setSwitch(el, get(settings))
}

// --- platforms ----------------------------------------------------------------

interface PlatformRefs {
  select: HTMLSelectElement
  customWrap: HTMLElement
  custom: HTMLInputElement
}

const platformRefs = new Map<PlatformId, PlatformRefs>()

function renderPlatforms(): void {
  const container = $('platforms')
  container.innerHTML = ''

  for (const [platform, plans] of Object.entries(PLAN_PRESETS) as [PlatformId, typeof PLAN_PRESETS.chatgpt][]) {
    const row = document.createElement('div')
    row.className = 'row'
    row.style.flexWrap = 'wrap'

    const info = document.createElement('div')
    info.className = 'grow'
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = plans[0]?.label ? platformLabel(platform) : platform
    const hint = document.createElement('div')
    hint.className = 'hint'
    const active = settings.enabledPlatforms[platform] !== false
    hint.textContent = active ? planForWindow(platform, settings.windows[platform])?.source === 'official' ? 'Official window sizes' : 'Community-measured sizes' : 'Off — reload tabs to apply'
    info.append(name, hint)

    const toggle = document.createElement('button')
    toggle.className = `switch${active ? ' on' : ''}`
    toggle.setAttribute('aria-label', `Toggle ${name.textContent}`)
    toggle.innerHTML = '<span class="knob"></span>'
    toggle.addEventListener('click', () => {
      const next = !(settings.enabledPlatforms[platform] !== false)
      settings.enabledPlatforms[platform] = next
      toggle.classList.toggle('on', next)
      hint.textContent = next
        ? planForWindow(platform, settings.windows[platform])?.source === 'official'
          ? 'Official window sizes'
          : 'Community-measured sizes'
        : 'Off — reload tabs to apply'
      void save({ enabledPlatforms: { ...settings.enabledPlatforms } })
    })

    row.append(info, toggle)
    container.appendChild(row)

    // Plan selector row
    const planRow = document.createElement('div')
    planRow.className = 'row'
    const planLabel = document.createElement('div')
    planLabel.className = 'grow'
    planLabel.innerHTML = '<div class="name" style="font-size:11.5px;color:var(--muted)">Your plan</div>'

    const select = document.createElement('select')
    for (const plan of plans) {
      const opt = document.createElement('option')
      opt.value = plan.id
      opt.textContent = planOptionLabel(plan)
      select.appendChild(opt)
    }
    const customOpt = document.createElement('option')
    customOpt.value = 'custom'
    customOpt.textContent = 'Custom size'
    select.appendChild(customOpt)
    const selectedPlan = planById(platform, settings.plans[platform])
    select.value = selectedPlan?.id ?? 'custom'

    const customWrap = document.createElement('span')
    customWrap.style.display = select.value === 'custom' ? '' : 'none'
    const custom = document.createElement('input')
    custom.type = 'number'
    custom.min = '1000'
    custom.step = '1000'
    custom.value = String(settings.windows[platform])
    customWrap.appendChild(custom)

    select.addEventListener('change', () => {
      const chosen = plans.find((p) => p.id === select.value)
      customWrap.style.display = chosen ? 'none' : ''
      if (chosen) {
        // The plan id is the source of truth; the stored window is the
        // fallback used when the active model can't be detected — the
        // plan's default mode (Reasoning on paid ChatGPT tiers).
        const mode = fallbackModeForPlan(chosen)
        settings.plans[platform] = chosen.id
        settings.windows[platform] = mode === 'instant' ? chosen.instantWindow : chosen.reasoningWindow
        custom.value = String(settings.windows[platform])
        void save({ plans: { ...settings.plans }, windows: { ...settings.windows } })
      } else {
        settings.plans[platform] = 'custom'
        void save({ plans: { ...settings.plans } })
        custom.focus()
      }
    })

    custom.addEventListener('change', () => {
      // A cleared or zero-filled input must not silently become the
      // platform default (Number('') || default is the falsy-zero trap) —
      // invalid input restores the current value and saves nothing.
      const parsed = Number(custom.value)
      if (!Number.isFinite(parsed) || parsed < 1000) {
        custom.value = String(settings.windows[platform])
        return
      }
      settings.windows[platform] = Math.round(parsed)
      settings.plans[platform] = 'custom'
      select.value = 'custom'
      void save({ windows: { ...settings.windows }, plans: { ...settings.plans } })
    })

    planRow.append(planLabel, select, customWrap)
    container.appendChild(planRow)

    platformRefs.set(platform, { select, customWrap, custom })
  }
}

function planOptionLabel(plan: PlanPreset): string {
  if (plan.instantWindow === plan.reasoningWindow) {
    return `${plan.label} — ${formatWindow(plan.instantWindow)}`
  }
  return `${plan.label} — ${formatWindow(plan.instantWindow)} / ${formatWindow(plan.reasoningWindow)}`
}

function platformLabel(platform: PlatformId): string {
  return platform === 'chatgpt' ? 'ChatGPT' : platform === 'claude' ? 'Claude' : 'Gemini'
}

// --- warnings -------------------------------------------------------------------

function renderWarnings(): void {
  const container = $('warningPresets')
  container.innerHTML = ''
  const active = presetForThresholds(settings.thresholds)

  for (const preset of WARNING_PRESETS) {
    const btn = document.createElement('button')
    btn.textContent = preset.label
    btn.classList.toggle('active', active?.id === preset.id)
    btn.addEventListener('click', () => {
      settings.thresholds = { ...preset.thresholds }
      input('thrAmber').value = String(Math.round(preset.thresholds.amber * 100))
      input('thrRed').value = String(Math.round(preset.thresholds.red * 100))
      $('warningHint').textContent = preset.hint
      renderWarnings()
      void save({ thresholds: { ...preset.thresholds } })
    })
    container.appendChild(btn)
  }

  $('warningHint').textContent = active
    ? active.hint
    : `Custom thresholds — amber ${Math.round(settings.thresholds.amber * 100)}%, red ${Math.round(settings.thresholds.red * 100)}%`
}

function bindAdvancedThresholds(): void {
  const commit = () => {
    const amber = clamp(Number(input('thrAmber').value) / 100, 0.1, 0.98)
    const red = clamp(Number(input('thrRed').value) / 100, amber + 0.01, 1)
    settings.thresholds = { amber, red }
    input('thrAmber').value = String(Math.round(amber * 100))
    input('thrRed').value = String(Math.round(red * 100))
    renderWarnings()
    void save({ thresholds: { amber, red } })
  }
  input('thrAmber').addEventListener('change', commit)
  input('thrRed').addEventListener('change', commit)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// --- handoff history --------------------------------------------------------

function renderBriefs(): void {
  const container = $('briefs')
  void listBriefs().then((briefs) => {
    container.innerHTML = ''
    if (briefs.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = 'No handoffs yet — they appear here after each Fresh start.'
      container.appendChild(empty)
      return
    }
    for (const brief of briefs) renderBrief(container, brief)
  })
}

function renderBrief(container: HTMLElement, brief: SavedBrief): void {
  const card = document.createElement('div')
  card.className = 'brief'
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

// --- boot ----------------------------------------------------------------------

async function main(): Promise<void> {
  settings = await getSettings()

  bindSwitch('badgeVisible', (s) => s.badgeVisible, (on) => ({ badgeVisible: on }))
  bindSwitch('autoSend', (s) => s.autoSend, (on) => ({ autoSend: on }))

  $('resetBadgePos').addEventListener('click', () => {
    void chrome.storage.local.remove('badgePos') // content scripts react and reposition
  })

  renderPlatforms()
  renderWarnings()
  bindAdvancedThresholds()

  input('thrAmber').value = String(Math.round(settings.thresholds.amber * 100))
  input('thrRed').value = String(Math.round(settings.thresholds.red * 100))
  textarea('prompt').value = settings.promptTemplate

  textarea('prompt').addEventListener('change', () => {
    const value = textarea('prompt').value.trim()
    settings.promptTemplate = value || DEFAULT_PROMPT
    void save({ promptTemplate: settings.promptTemplate })
  })
  $('resetPrompt').addEventListener('click', () => {
    textarea('prompt').value = DEFAULT_PROMPT
    settings.promptTemplate = DEFAULT_PROMPT
    void save({ promptTemplate: DEFAULT_PROMPT })
  })

  $('clearBriefs').addEventListener('click', () => {
    if (!confirm('Delete all saved handoffs from this device?')) return
    void chrome.storage.local.set({ briefs: [] }).then(renderBriefs)
  })

  $('version').textContent = `V${chrome.runtime.getManifest().version} · MIT`
  renderBriefs()
}

void main()
