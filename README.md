# DuoVoice Live

Real-time bilingual voice translator for English and Portuguese conversations. Captures microphone audio, streams it to
Google Gemini's native audio model (or OpenAI Realtime), and plays back translated speech in real time.

Built for live use alongside phone calls, speak in one language, hear the translation instantly.

## How It Works

```
Microphone → AudioWorklet (16kHz PCM) → Gemini 2.5 Flash Native Audio → Translated speech playback
```

- Audio captured and downsampled on a dedicated real-time thread via AudioWorklet
- Streamed to Gemini's native audio model over WebSocket
- Translated audio played back through a separate output AudioContext
- Live transcription displayed for both input and output

## Setup

**Prerequisites:** Node.js, a [Gemini API key](https://aistudio.google.com/apikey) (and optionally an OpenAI API key)

1. Install dependencies:

   ```
   npm install
   ```

2. Start the dev server:

   ```
   npm run dev
   ```

The app runs at `http://localhost:3000`.

Use the Settings button in the header to enter your Gemini/OpenAI API keys. Keys are stored in your browser
localStorage and are never sent to our servers.

### Optional: local dev env fallback

If you prefer, you can still use `.env.local` for **localhost development only**:

```
cp .env.example .env.local
```

Then edit `.env.local` and set `GEMINI_API_KEY` and/or `OPENAI_API_KEY`. These are only used by the dev server,
and are intentionally ignored in production builds.

## Low Latency Mode

Toggle "Low Latency" in the header to trade transcription for speed. When enabled:

- **Silence detection drops from 500ms to 250ms** — the model begins translating sooner after you stop speaking.
- **Transcription is disabled** — no text appears in the chat log, but translated audio still plays back normally.
- **Gemini reconnects automatically** when toggled mid-session; for OpenAI, a lightweight session update is sent without reconnecting.

Use this when you need the fastest possible turn-around during a live call and don't need a written record of the conversation.

> ✅ **Public deployment is supported.** Keys are stored locally in the user's browser and are never sent to our servers.
> Requests go directly from the user's device to the provider APIs.

## Public Deployment (Cloudflare Pages)

This app is static and can be deployed to Cloudflare Pages.

- Build command: `npm run build`
- Output directory: `dist`

Users enter their own API keys in the Settings panel after loading the site.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | No (dev only) | — | Local dev fallback for Gemini key |
| `OPENAI_API_KEY` | No (dev only) | — | Local dev fallback for OpenAI Realtime |
| `OPENAI_REALTIME_MODEL` | No | `gpt-realtime` | OpenAI Realtime model name |
| `SILENCE_DURATION_MS` | No | `600` | Milliseconds of silence before speech is considered finished |

## Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run preview   # Preview production build
```

## License

[MIT](LICENSE)
