# FreshContext Privacy Policy

**Effective date:** 2026-09-07

FreshContext is a browser extension that measures context-window usage in AI chats and continues conversations in fresh chats. This policy describes exactly what it does and does not do with your data. Its entire design principle is that **your conversations never leave your device**.

## Data collection: none

FreshContext does not collect, transmit, sell, or share any data. Specifically, it has:

- **No servers** — there is no backend, API, or account system operated by the developer
- **No analytics or telemetry** — no usage statistics, no crash reports, no tracking of any kind
- **No third parties** — no advertising networks, no SDKs, no data processors
- **No authentication data** — the extension never handles your passwords or API keys

## Data processed locally

To function, FreshContext reads the conversation visible on **chatgpt.com**, **claude.ai**, and **gemini.google.com** — the sites it is designed for. This happens entirely within your browser, on your device:

- **Conversation text** is read to estimate and count tokens for the context meter, and to build handoff briefs when you request one. It is never transmitted anywhere by the extension. The only network requests it makes are to the chat platform you are already using, within your own logged-in session, to read your own conversation history.
- **Token counting** is performed locally in the extension's own code.

## Data stored locally

The extension stores a small amount of data in `chrome.storage.local` on your device only:

- Your settings (plan selections, thresholds, prompt template, toggles)
- Your last 20 handoff briefs, so nothing is ever silently lost
- The badge's screen position

You can delete stored handoffs at any time via **Clear all handoffs** in the extension's side panel. Removing the extension from Chrome deletes all of this data.

## Permissions and why they are needed

- **Host access to chatgpt.com, claude.ai, gemini.google.com** — the only sites the extension runs on; needed to read the conversation and insert handoff text into the chat composer
- **Storage** — settings and handoff history, on your device
- **Scripting** — to attach to chat tabs that were already open when the extension was installed
- **Side panel** — the settings panel

## Open source

The entire source code is public and auditable: https://github.com/shivam0897-i/freshcontext (MIT license). You do not have to trust this policy — you can verify every claim in the code.

## Contact

Questions or concerns: https://github.com/shivam0897-i/freshcontext/issues
