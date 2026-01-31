# DuoVoice Live

Real-time bilingual voice translator for English and Portuguese conversations. Captures microphone audio, streams it to
Google Gemini's native audio model, and plays back translated speech in real time.

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

**Prerequisites:** Node.js, a [Gemini API key](https://aistudio.google.com/apikey)

1. Install dependencies:

   ```
   npm install
   ```

2. Copy the example env file and add your API key:

   ```
   cp .env.example .env.local
   ```

   Then edit `.env.local` and set your `GEMINI_API_KEY`.

3. Start the dev server:

   ```
   npm run dev
   ```

The app runs at `http://localhost:3000`.

> ⚠️ **This app is designed for local use only.** Your Gemini API key is bundled into the client at build time. Do not
> deploy this to a public server in the current state or your API key will be exposed.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Your [Gemini API key](https://aistudio.google.com/apikey) |
| `SILENCE_DURATION_MS` | No | `500` | Milliseconds of silence before Gemini considers speech finished |

## Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run preview   # Preview production build
```

## License

[MIT](LICENSE)
