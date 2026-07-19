# Plan: FastAPI + Svelte rewrite on gpt-realtime-translate

Supersedes `rewrite-gpt-realtime-translate.md` (the browser-only TypeScript plan). The
translation model and two-session design carry over; the runtime moves to a Python
server with the browser as a thin client.

## Why

The current app fails in live use for reasons that are model problems, not code problems:

- Gemini native audio is too slow for conversation.
- OpenAI's conversational realtime model injects replies despite "translate only" instructions.

OpenAI's `gpt-realtime-translate` (May 2026) is a dedicated interpreter model: no chat
behavior, no prompting, no VAD, no turn state. Stream audio in, translated speech and
text stream out. Both failure modes are eliminated by the model itself.

Architecture goals, in order: work reliably on a live call, simplest possible code,
Python primitives owned server-side (deployable later), FastAPI + Svelte integration
as a learning exercise.

## API shape (verified against working code in the wild, not just docs)

- `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
- Auth: `Authorization: Bearer <key>` header on the WS upgrade (server-side, so no
  browser auth problem; key stays in `.env.local`, never reaches the client - the
  localStorage key UI from the old app disappears entirely).
- Audio both directions: base64 PCM16 mono 24 kHz.
- Configure per session (the only knob that matters is `output.language`):

```json
{"type": "session.update", "session": {"audio": {
  "input": {"transcription": {"model": "gpt-realtime-whisper"},
            "noise_reduction": {"type": "near_field"}},
  "output": {"language": "pt"}}}}
```

- Client → server events: `session.update`, `session.input_audio_buffer.append`,
  `session.close`. Note the `session.` prefix - this endpoint differs from the
  standard Realtime API.
- Server → client events: `session.created`, `session.updated`, `session.closed`,
  `session.input_transcript.delta`, `session.output_transcript.delta`,
  `session.output_audio.delta` (~200 ms frames), `error`.
- Source language is auto-detected. One target language per session, so bidirectional
  EN ↔ PT = two sessions fed the same audio.
- Same-language input → the model stays silent (corroborated by the official cookbook
  and independent testing). This replaces the language-gate logic entirely. Verified
  empirically in Phase 2 before the relay depends on it.
- No custom prompting, no voice selection (output mimics the source speaker's tone).
- Cost: $0.034/min per session ⇒ ~$0.068/min (~$4/hour) with both directions live.

## Audio topology (the real-world setup this must serve)

```
garyj speaks English ───────────► computer mic ─► app ─► PT out of computer speakers
                                       ▲                        │
her PT voice ─► iPhone speaker ────────┘                        ▼
her ◄── WhatsApp call ◄── iPhone mic ◄──────── (picks up the PT translation)
```

- One mic hears both languages mixed. Both sessions get the same feed; the model's
  same-language silence sorts out which one responds.
- Browser echo cancellation removes the page's own output from the mic, so the app
  never hears itself. This is why capture lives in the browser, not Python.
- Test fixtures must be recorded through the real path (phone speaker → room →
  laptop mic), not from clean audio files. Interim fixtures are TTS-generated.

## Architecture

```
Browser (dumb terminal)                FastAPI (the brain)
┌─────────────────────────┐           ┌────────────────────────────┐
│ getUserMedia @24kHz      │           │ /ws endpoint               │──► session A (output=pt)
│ worklet: Float32→Int16 ──┼── WS ───► │ relay: fan out mic frames, │──► session B (output=en)
│ playback + transcripts ◄─┼── WS ──── │ fan in audio + transcripts │
└─────────────────────────┘           └────────────────────────────┘
```

Browser↔server wire protocol: plain JSON frames, no versioned envelope.
Up: `{"type": "audio", "pcm16": "<base64>"}`.
Down: `{"type": "audio" | "transcript_in" | "transcript_out" | "status" | "error", ...}`
with a `lang` field on audio/transcript frames.

## File layout (complete)

```
pyproject.toml            # uv-managed: fastapi, uvicorn, websockets, python-dotenv
server/
  main.py                 # FastAPI app, /ws endpoint, app.frontend() wiring
  translator.py           # TranslationSession (one OpenAI WS) + Relay (two sessions)
  probe.py                # standalone test rig: fixture WAV in → events/latency/audio out
tests/
  test_translator.py      # pytest: replay recorded real event streams offline
fixtures/                 # small WAVs + recorded event JSONL (checked in)
frontend/                 # Svelte 5 + Vite scaffold
  src/App.svelte          # entire UI: start/stop, status pill, transcripts
  src/audio.ts            # mic capture, worklet load, playback scheduling
  public/audio-processor.js  # ported worklet: 24kHz, Float32→Int16 only (no resampling)
```

No other modules. Anything not listed here doesn't get built.

Dev mode: `vite dev` (:5173) proxying `/ws` to uvicorn (:8000). Call mode:
`vite build` then FastAPI serves `frontend/dist` via `app.frontend()` on one port.

## Phases (each ends runnable; commit per phase; one GitHub issue per phase)

1. **Skeleton** - uv project, FastAPI + `app.frontend()`, Svelte scaffold, dev proxy,
   browser↔server WS echo. Verify: echo works in dev mode and built mode.
2. **Probe** - `probe.py` + TTS fixtures. Streams a WAV, prints a timestamped event
   timeline, saves output audio + raw event JSONL. Verify: answers the empirical
   questions below; recordings become test fixtures.
3. **Relay** - `translator.py` wired to `/ws`, two sessions, fan-out/fan-in.
   Verify: pytest replay tests green; fixture WAV through the full stack yields
   translated audio + transcripts.
4. **Frontend audio** - worklet port, playback scheduling, transcripts, status.
   Verify: E2E via Chrome fake-mic flags (`--use-file-for-fake-audio-capture`):
   fixture "spoken" into the page produces on-screen transcripts + audio.
5. **Hardening** - session reconnect on drop, clean shutdown, production build + CSP.
   Verify: kill an OpenAI socket mid-stream → auto-reconnect; `npm run build` +
   one-port mode works end to end.

## Empirical questions Phase 2 must answer (issue each)

1. **Latency**: utterance-end → first translated audio, EN→PT and PT→EN, multiple
   runs. Reports range 0.3 s–3.6 s; we need our own numbers vs the Gemini baseline.
2. **Dialect**: does `pt` come out Brazilian or European? No API knob exists; save a
   sample WAV for garyj to judge by ear.
3. **Same-language silence**: PT audio into the PT-target session must yield (near)
   silence. This is the no-gate design's load-bearing assumption. If it fails, the
   fallback is a transcript-based gate in the relay - build only if needed.
4. **Noise reduction A/B**: `near_field` vs `far_field` with the mixed near/far input
   (garyj close, iPhone across the desk).

## Verification posture

- pytest for the relay/session code, replaying real recorded event streams (mock at
  the network boundary only, per house rules).
- ruff + mypy on server code; svelte-check + tsc on frontend. (The old app had no
  tooling; the new one starts with it.)
- No CI against the paid API. `probe.py` is the on-demand rig.
- Machines verify timing and plumbing; humans judge translation quality. Final
  acceptance is a scripted 10-minute live WhatsApp test call with a checklist
  (turn-taking, overlap, numbers/addresses, mid-sentence language switch, feedback
  check with real phone-speaker acoustics) - garyj runs this, not the agent.

## Out of scope (deliberately)

- Deleting the old React app (separate reviewed commit after garyj approves; master
  stays usable for calls meanwhile).
- Two-device mode (her phone opens the page). The relay architecture keeps the door
  open; nothing is designed for it now.
- Video anything. WhatsApp keeps doing video; this app is audio + text alongside.
- Multi-conversation history, settings UI, deploy, auth. (A minimal key-entry
  dialog returns with the BYOK deploy: a Bits UI Dialog skinned with daisyUI
  classes, one field + localStorage. Deliberately the project's first Bits UI
  component, as a learning taste of the daisy+Bits pairing.)
- Language-pair configuration UI (two string constants in `translator.py`).

## Overnight guardrails

- All work on `fastapi-rewrite` in its worktree; nothing touches master.
- Draft PR at the end; issues closed by commits for the audit trail.
- API spend < $5. No destructive operations. Walls documented in issues, not
  brute-forced.
- Morning report: findings table, PT sample location, PR link, honest status.

## Deployment options (deferred; decision memo 2026-07-19)

The server is a long-lived WebSocket relay, which rules out classic FaaS and
makes always-on containers (Fargate-style) needlessly expensive. Candidates,
in preference order:

1. **Fly.io Sydney, scale-to-zero machines** - container unchanged, fly.toml +
   Dockerfile + GitHub Actions (all IaC), cents/month idle, ~12 ms from
   Melbourne. Recommended.
2. **AWS serverless re-architecture** (CDK portfolio piece): S3 + CloudFront
   static site, Lambda minting OpenAI client secrets via the translations
   `/client_secrets` flow, browser ↔ OpenAI direct WebRTC. True $0 idle, but
   the server-side relay/brain disappears - a different architecture.
3. **Cloudflare hybrid** - Pages (free) for the frontend; relay needs Python
   Workers (bleeding-edge) or Cloudflare Containers (new). Melbourne edge.
   garyj's stated preference for the eventual Cloudflare deploy: Pages
   serving the static frontend with CORS + the FastAPI relay as a separate
   container service. Single-container ships first regardless.

**Key model for public deploys: BYOK relay.** The browser keeps the user's
OpenAI key in localStorage (as the old app did) and sends it as the first
message over the established WSS connection - never in a URL or header. The
server holds it in memory for that session only (never logged, never
persisted, redacted from errors) and uses it as the Bearer token on the two
upstream sockets. Client key always wins; the server's `.env.local` key is a
local-dev fallback only. Since users spend their own money, hard auth relaxes
to a concurrent-session cap; the repo being open source makes the handling
inspectable. README wording must be honest: the key transits the relay in
memory, unlike the old browser-only app. (Endgame option if we ever want keys
out of the relay entirely: the official `/client_secrets` WebRTC flow, at the
cost of the server-side brain.)

Browser→server latency is noise vs the OpenAI leg, so region choice is about
hygiene, not speed. For the core use case, localhost (+ cloudflared tunnel
when needed) remains the $0 baseline.

## References

- Official: [realtime-translation guide](https://developers.openai.com/api/docs/guides/realtime-translation) ·
  [model page](https://developers.openai.com/api/docs/models/gpt-realtime-translate) ·
  [cookbook](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide)
- Best worked example of the native protocol: [damballa212/voice-translate](https://github.com/damballa212/voice-translate) (`openai_translator.py`)
- Async WS handler shape: [schmitech/orbit](https://github.com/schmitech/orbit) realtime translation handler
- Latency playbook (Azure variant, patterns transfer): [josemzr/acs-gpt-realtime-translate](https://github.com/josemzr/acs-gpt-realtime-translate)
