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

2. Copy the example env file and add your API key:

   ```
   cp .env.example .env.local
   ```

   Then edit `.env.local` and set your `GEMINI_API_KEY`. If you want to use the OpenAI provider, also set
   `OPENAI_API_KEY`.

3. Start the dev server:

   ```
   npm run dev
   ```

The app runs at `http://localhost:3000`.

Use the provider toggle in the header to switch between Gemini and OpenAI.

## Low Latency Mode

Toggle "Low Latency" in the header to trade transcription for speed. When enabled:

- **Silence detection drops from 500ms to 250ms** — the model begins translating sooner after you stop speaking.
- **Transcription is disabled** — no text appears in the chat log, but translated audio still plays back normally.
- **Gemini reconnects automatically** when toggled mid-session; for OpenAI, a lightweight session update is sent without reconnecting.

Use this when you need the fastest possible turn-around during a live call and don't need a written record of the conversation.

> ⚠️ **This app is designed for local use only.** Your API keys are bundled into the client at build time. Do not deploy
> this to a public server in the current state or your keys will be exposed.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Your [Gemini API key](https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | No | — | OpenAI API key for the OpenAI Realtime provider |
| `OPENAI_REALTIME_MODEL` | No | `gpt-realtime` | OpenAI Realtime model name |
| `SILENCE_DURATION_MS` | No | `500` | Milliseconds of silence before speech is considered finished |

## Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run preview   # Preview production build
```

## License

[MIT](LICENSE)
