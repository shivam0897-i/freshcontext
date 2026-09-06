# FreshContext

[![CI](https://github.com/shivam0897-i/freshcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/shivam0897-i/freshcontext/actions/workflows/ci.yml)

**Watch your AI chat's context. Warn before quality drops. Continue in a fresh chat — same AI or another — with a handoff brief written by the AI itself.**

Local-only, open source (MIT), Chrome/Edge (Chromium, Manifest V3). Works on **ChatGPT**, **Claude**, and **Gemini**.

## The problem it solves

Long AI chats silently degrade — "context rot". On ChatGPT, when a conversation outgrows its context window, **nothing fails and nothing warns you**: the oldest messages just fall out of view. Gemini's free tier (32K window) degrades the same way, officially. Claude auto-summarizes near the limit, but invisibly and only under some settings.

You're left with a bad choice: stay in a degrading chat, or start over and lose everything.

FreshContext gives you a third option: **one click asks the AI to write a structured handoff brief** (goal, decisions, artifacts, state, open questions, preferences), then opens a fresh chat — here or on another platform — with that brief ready to go. The AI writes the brief because the AI understands its own conversation; nothing is lost, and the new chat starts with a compact, clean context instead of a giant transcript that would refill the window.

## Install (developer mode)

1. Build it: `npm install && npm run build` (outputs `dist/`)
2. Open `chrome://extensions` → enable **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Open any chat on chatgpt.com, claude.ai, or gemini.google.com — the FreshContext badge appears bottom-right

## Use it

- **The badge** shows how full the conversation's context window is: green → amber (~70%) → red (~85%). Click it for details.
- **Fresh start** — the button injects the brief request into your current chat, waits for the AI to write it, then shows a review overlay where you can edit the brief, pick a destination (same platform, or ChatGPT/Claude/Gemini), and continue. The brief is **saved locally and copied to your clipboard automatically** before anything navigates — you can never lose it.
- **Side panel** (toolbar icon): set your plan's context-window sizes, warning thresholds, the brief-request prompt, auto-send behavior, and revisit your last 20 briefs.
- **Auto-send is off by default** — the brief lands in the composer and you press Enter. Automation you can see and control.

## Offline demo harness

Exercise the entire flow with no accounts:

```bash
npx serve demo -p 8000        # or: python -m http.server 8000 --directory demo
npm run build:dev             # dev build adds localhost to the content-script matches
```

Load `dist.dev/` in chrome://extensions, open `http://localhost:8000/chatgpt-mock.html`, then:

1. Watch the badge track the seeded conversation
2. Click **+30 messages** — the badge climbs to red
3. Click the badge → **Fresh start** — the harness "AI" writes a brief, the review overlay opens
4. Confirm — a new tab opens with the brief inserted into the composer

## Architecture

```
manifest.json (MV3) — storage + sidePanel permissions; host_permissions for
                      exactly the three chat origins; local-only, no remote code
src/
  platforms/   ALL site-specific knowledge, behind one adapter interface:
               chatgpt.ts claude.ts gemini.ts (composer, insertion cascade,
               submit, conversation read, response-complete detection)
  core/        estimator (calibrated heuristic), meter (thresholds),
               brief (prompt template + lenient section parser),
               storage (settings, pending briefs, history), rpc
  ui/          badge (closed Shadow DOM chip), review overlay, toast
  background/  service worker — token counting (gpt-tokenizer o200k) so the
               content script stays ~29KB; tab navigation
  flow.ts      FreshContext state machine — every step verified, every failure
               degrades to a manual clipboard fallback
```

**Techniques are evidence-backed** from shipping open-source extensions: ProseMirror insertion via paste-ClipboardEvent → `execCommand('insertText')` cascade; send-button click with enabled/visible checks and Enter fallback; API-first conversation reading (ChatGPT `backend-api`, Claude `chat_conversations`) because all three sites virtualize long chats; DOM fallback everywhere.

## Honesty by design

- Token counts are labeled **EXACT** only where they are (ChatGPT via o200k tokenizer). Claude counts are a labeled cross-model estimate; Gemini counts use a calibrated heuristic. Never a fake number.
- Context-window sizes default to documented/community-measured values (ChatGPT's are community-measured — OpenAI publishes none) and are **user-editable** in the side panel.
- Automation never hides: every write is verified (insert read-back, submit-clear check), failures surface explicit error states, and the fallback is always "your brief is on the clipboard."

## Privacy

- No servers, no accounts, no analytics, no telemetry. Conversation text never leaves the browser.
- Reads only the three chat sites declared in host_permissions, only for the features above.
- The brief is stored in `chrome.storage.local` on your machine and cleared when you discard it.

## Development

```bash
npm test          # 63 unit tests (Vitest + jsdom): estimator calibration vs the
                  # real tokenizer, brief parsing, meter thresholds, adapter DOM
                  # contracts, storage round-trips
npm run build     # production → dist/
npm run build:dev # dev build with the demo origin → dist.dev/
npm run icons     # regenerate icons (Windows PowerShell / GDI+)
```

## Live-site verification checklist

Selector-level behavior is implemented from documented, code-verified techniques, but these sites change their DOM frequently. Before relying on it day-to-day, verify on each platform:

- [ ] Badge appears and meter tracks a real conversation (ChatGPT / Claude / Gemini)
- [ ] FreshContext injects and sends the brief request
- [ ] Response-complete detection captures the brief (not mid-stream)
- [ ] Same-platform restart inserts the brief into the new chat
- [ ] Cross-platform restart works for all 6 directions
- [ ] Claude paid: usage limits surface; ChatGPT: limit-hit dialog detected

If a site changed its DOM and something breaks, the badge shows an error state instead of silently misbehaving — file the selector in an issue; adapters are the only place selectors live.

## Behavior notes & troubleshooting

How the extension handles the situations you'll actually run into:

- **Installed with chat tabs already open** — the badge is injected into existing ChatGPT/Claude/Gemini tabs automatically on install and update; no reload needed. (If you *disable and re-enable* the extension, Chrome tears scripts down — reload those tabs.)
- **Starting a new chat** — the badge resets to "New chat / 0%" as soon as the empty conversation is detected (chat switching is SPA navigation; the meter watches the URL, not page loads).
- **Switching between chats** — the meter re-reads whenever the URL or message structure changes.
- **Old, long chats (virtualized)** — the DOM only holds the rendered tail of a long conversation, so the meter first shows a quick estimate, then (~3s after the conversation settles) performs a full API read and replaces it with an exact count. The brief request in a FreshContext also uses the full API read, so nothing is missed.
- **Streaming replies** — the badge updates live; the exact count lands a few seconds after the reply finishes.
- **Changed settings in the side panel** — thresholds, window sizes, and the prompt apply immediately to open tabs; no reload.
- **Badge covers a site's own buttons** — drag the badge anywhere; the position is remembered per browser.
- **Not logged into the destination platform** — the pending brief waits (saved + on your clipboard); it inserts once you're logged in and the destination chat page loads.
- **Known limits:** old Gemini chats stay DOM-based (Gemini exposes no same-session API; loading full history would hijack your scrolling), so their meter is a labeled estimate. Token counts for Claude and Gemini are labeled estimates by design — only ChatGPT counts are exact.

## License

MIT — see [LICENSE](LICENSE).
