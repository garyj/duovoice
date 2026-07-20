# Sther repository guide

Sther is a framework-free TypeScript browser tool for simultaneous English and
Brazilian Portuguese speech translation. It is a critical communication tool,
so audio, lifecycle, and credential changes require real browser verification.

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

- `src/realtime.ts` owns one OpenAI translation WebRTC session.
- `src/controller.ts` owns the shared microphone, two concurrent sessions,
  lifecycle state, bounded reconnects, expiry refresh, and cleanup.
- `src/transcripts.ts` owns rolling transcript text.
- `src/main.ts` binds the controller to the small DOM interface.
- `worker/index.ts` mints short-lived translation client secrets.
- `docs/architecture/realtime-translation.md` records protocol and live-test
  evidence.

One microphone stream is attached to separate English-target and
Portuguese-target peer connections. Each remote stream must play through a
native `<audio>` element. Do not route output through Web Audio because Chromium
needs its native WebRTC playback path for acoustic echo cancellation.

The standard OpenAI API key belongs only in `.dev.vars` locally or a Cloudflare
Worker secret in production. Never expose it to client code, browser storage, or
Vite environment substitution.

## Verification

Before reporting completion:

1. Run strict TypeScript, Biome, Vitest, and the Vite production build.
2. Run the app through Wrangler, not Vite alone.
3. Exercise Start, both translation directions, Stop, and restart in headed
   desktop Chrome.
4. Check browser errors, native remote audio playback, transcript routing, and
   microphone cleanup.
5. For audio-path changes, use the actual Linux speaker and microphone stack.
