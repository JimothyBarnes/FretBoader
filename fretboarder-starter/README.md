# FretBoarder (Vite + React + Tailwind + Tone.js)

This is a ready-to-run local project that contains your latest App code.
It uses Tailwind for styling and Tone.js (with CDN guitar samples) for audio.

## 1) Prereqs
- Node.js 18+ (LTS) and npm (or pnpm/yarn)

## 2) Install & Run
```bash
npm install
npm run dev
```
Open the URL that Vite prints (usually http://localhost:5173).

## 3) Where things live
- `src/App.jsx` — your main app (imported from our chat)
- `src/index.css` — Tailwind entry
- `tailwind.config.js` — Tailwind config
- `vite.config.js` — Vite config

## 4) Notes
- The audio engine attempts to load clean electric guitar samples
  from a public CDN first. If blocked, it falls back to a local path
  `/samples/clean-electric/` (you can add the six files there), then
  to a pluck synth as a last resort.
- If you run this locally in Chrome/Edge/Safari, the sampler should load
  and sound like a guitar.
