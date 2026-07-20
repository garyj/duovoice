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

`npm run dev` builds the Vite client and serves it with the local Cloudflare
Worker at `http://localhost:3000`.

## Architecture

- `src/realtime.ts` owns the single OpenAI Realtime WebRTC session, transcript
  events, native remote audio, and microphone echo gate.
- `src/controller.ts` owns microphone capture, lifecycle state, bounded
  reconnects, expiry refresh, and cleanup.
- `src/transcripts.ts` owns rolling source and translation text.
- `src/main.ts` binds the controller to the small DOM interface.
- `worker/index.ts` proxies the browser's SDP offer with the server-owned
  interpreter session configuration.
- `docs/architecture/realtime-translation.md` records the architecture decision
  and evidence.

Use one prompted `gpt-realtime-2.1` conversation session. Do not recreate the
former pair of fixed-target `gpt-realtime-translate` sessions. Both sessions
heard the same mixed room microphone and could translate each other's speaker
output, causing missed Portuguese turns and feedback loops.

The remote stream must play through a native `<audio>` element. The microphone
sender is disabled from `response.created` until translated audio has drained,
plus an acoustic tail. VAD must not create responses automatically. The browser
requests responses only for turns that began while capture was open and deletes
turns detected during playback. This deliberate half-duplex behavior prevents
model output from becoming a new user turn. Do not restore barge-in without a
real acoustic test that proves it cannot self-translate.

The standard OpenAI API key belongs only in `.dev.vars` locally or a Cloudflare
Worker secret in production. Never expose it to client code, browser storage, or
Vite environment substitution.

## Verification

Before reporting completion:

1. Run strict TypeScript, Biome, Vitest, and the Vite production build.
2. Run the app through Wrangler, not Vite alone.
3. Exercise Start, English to Portuguese, Portuguese to English, Stop, and
   restart in headed desktop Chrome.
4. Check source and translation transcript events, native audio playback,
   microphone gating, browser errors, and microphone cleanup.
5. For audio-path changes, use the actual Linux speaker and microphone stack.
