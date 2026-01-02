# FluentHour Premium — Companion Bridge (local test)

This folder is a **ready-to-run local build** of FluentHour Premium with the **FluentHour Companion Bridge** enabled.

What the bridge adds:
- A small **“Send to FluentHour Companion”** card on the **Session** screen
- Buttons to **Copy this phase**, **Copy whole session**, or **Copy + Open**
- A link to the Companion GPT:
  - https://chatgpt.com/g/g-6958040e8ce881918400c643c84bbfc1-fluenthour-companion

> Browsers don’t allow reliably auto-pasting into ChatGPT. The flow is:
> **Copy → Open Companion GPT → Paste → Enter**

---

## Run locally (Windows / PowerShell)

```powershell
cd "C:\Users\Kevin-Duplechin\Downloads\fluenthourpremium_companion_bridge_local"

npm install
npm run dev
```

Then open:
- http://localhost:5173

---

## Build for Netlify

This project includes a build step that creates a **dist/** folder that Netlify can publish.

```powershell
npm install
npm run build
```

Netlify settings (already included in `netlify.toml`):
- Build command: `npm run build`
- Publish directory: `dist`

---

## Files

- `index.html` loads the main app bundle from `assets/` and loads `companion-bridge.js`
- `assets/` contains the bundled app JS/CSS
- `library/perfect-hour-data.txt` contains the default session library

