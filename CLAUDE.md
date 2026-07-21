# Sther repository guide

Sther is a framework-free TypeScript browser tool for English and Brazilian
Portuguese speech interpretation. It is a critical communication tool, so
audio, lifecycle, prompt, and credential changes require real browser
verification.

## Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run verify
```

`npm run dev` serves the Vite client at `http://localhost:3000`.

## Architecture

- `src/realtime.ts` owns the single OpenAI Realtime WebRTC session, transcript
  events, and native remote audio.
- `src/controller.ts` owns microphone capture, lifecycle state, bounded
  reconnect delays, expiry refresh, and cleanup.
- `src/api-key.ts` owns browser-local OpenAI API key persistence.
- `src/session-config.ts` owns the interpreter prompt and Realtime settings.
- `src/transcripts.ts` owns rolling source and translation text.
- `src/main.ts` binds the controller to the small DOM interface.
- `docs/architecture/realtime-translation.md` records the architecture decision
  and evidence.

Use one prompted `gpt-realtime-2.1` conversation session. Do not recreate the
former pair of fixed-target `gpt-realtime-translate` sessions. Both sessions
heard the same mixed room microphone and could translate each other's speaker
output, causing missed Portuguese turns and feedback loops.

The remote stream must play through a native `<audio>` element so Chrome can use
it as the WebRTC echo-cancellation reference. Keep the microphone live during
output so either speaker can interrupt. Semantic VAD may interrupt and truncate
output, but it must not create responses automatically. The browser requests a
response only after a detected user turn is committed.

Do not replace this with a microphone mute or acoustic delay. Do not remove the
client-controlled response step without a real acoustic test proving that the
interpreter cannot respond to its own output.

The user supplies a standard OpenAI API key in the page. The app stores it in
local storage and sends it directly to OpenAI's Realtime WebRTC endpoint. Do not
add a shared server-side key.

## Verification

Before reporting completion:

1. Run strict TypeScript, Biome, Vitest, and the Vite production build.
2. Run the app through Vite.
3. Exercise Start, English to Portuguese, Portuguese to English, Stop, and
   restart in headed desktop Chrome.
4. Check source and translation transcript events, native audio playback,
   barge-in truncation, browser errors, and microphone cleanup.
5. For audio-path changes, use the actual Linux speaker and microphone stack.
