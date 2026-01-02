# FluentHour

A CEFR/ACTFL/Canadian Language Benchmarks–informed one-hour language session runner.

## What this build adds

- **Copy for AI** button (Session screen)
  - Copies a ready-to-paste prompt that turns an AI into your "language helper".
  - The prompt enforces **target-language output** with an **English translation on the next line** for every helper utterance.
  - When it's your turn to speak, the AI is instructed to give **two to four sample responses** in the same two-line format.

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Netlify

- Build command: `npm run build`
- Publish directory: `dist`

The library is served from `public/library/perfect-hour-data.txt`.
