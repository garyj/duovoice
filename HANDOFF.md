# HANDOFF: Sther rewrite, branch `fastapi-rewrite` (parked 2026-07-19)

Audience: a future session (human or AI) picking this project up, either to
resume this branch or to build the replacement. Read this before writing any
code. Sections 3 and 5 are the payload: what is verified and reusable, and
the mistakes that must not be repeated.

**Status: PARKED, not merged.** garyj is pursuing a simpler approach. The
branch is complete through Phase 4 and every layer works in isolation; the
system as a whole fails in live use because of the acoustic echo problem in
section 4. That problem is a property of the physics and the browser, not of
this codebase, so whatever replaces this must answer section 4 or it will
fail the same way.

## 1. The product and the physics

Sther is a real-time English <-> Portuguese voice translator. It is how garyj
talks with his friend across a language barrier, running next to a WhatsApp
call on his iPhone:

```
garyj speaks English ───────────► computer mic ─► app ─► PT out of computer speakers
                                       ▲                        │
her PT voice ─► iPhone speaker ────────┘                        ▼
her ◄── WhatsApp call ◄── iPhone mic ◄──────── (picks up the PT translation)
```

The load-bearing physical constraint: **one microphone hears everything**,
including both speakers AND the app's own translation output. The iPhone must
hear the computer speakers (that is how she receives the translation), so the
output cannot be headphoned away. The app therefore needs some mechanism that
makes it deaf to its own output while still hearing the room. Every
architecture decision lives or dies on this point. This branch died on it.

## 2. Timeline

1. **Legacy app (branch `master`, still usable):** "DuoVoice Live", React 18 +
   Gemini 2.5 Flash native audio, browser-only, key in localStorage. Heavily
   latency-optimized (see
   `docs/solutions/performance-issues/audio-pipeline-latency-optimization-20260131.md`,
   whose worklet/ring-buffer/DSP lessons remain valid). Failed in live use:
   Gemini was too slow for conversation, and an attempted switch to OpenAI's
   conversational realtime model failed because it injects replies despite
   translate-only instructions. Suspicion recorded after this branch's
   findings: some of that "injecting" may have been the app hearing its own
   playback (the same echo problem below), never proven.
2. **This branch:** FastAPI relay + Svelte 5 SPA on `gpt-realtime-translate`
   (OpenAI's dedicated interpreter model, May 2026). Plan:
   `docs/plan/rewrite-fastapi-browser-translate.md`. Phases 1-4 done, each
   verified and committed (issues #1-#3 closed, PR #5 documents the arc).
3. **The wall (2026-07-19):** live browser test loops: the app translates its
   own translations. Three fixes failed (section 4). Branch parked per the
   plan's own guardrail ("walls documented in issues, not brute-forced").
   Evidence and options: issue #6.

## 3. Verified knowledge that transfers to ANY future path

Everything here was established empirically against the real paid API and is
independent of this branch's architecture. Do not re-derive it; do not
contradict it without new evidence.

### The model: gpt-realtime-translate

- Endpoint: `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`
  (WebSocket) or the WebRTC flow via `POST /v1/realtime/translations/client_secrets`
  + `POST /v1/realtime/translations/calls` (SDP offer). Auth: Bearer key on
  the upgrade; also send `OpenAI-Safety-Identifier: <opaque hashed user id>`.
- It is a pure interpreter: no chat behavior, no prompting, no VAD, no turn
  state, no `response.create`. It cannot inject replies. This solved the
  legacy app's model problem completely.
- One target language per session (`session.update` ->
  `session.audio.output.language`). Bidirectional EN<->PT = two concurrent
  sessions fed the same audio. Sessions boot with output language "es", so
  configuring and waiting for `session.updated` before sending audio is
  mandatory.
- **Simultaneous interpretation:** translated audio starts ~2.3s after speech
  onset, ~3.5s BEFORE the utterance ends. Never buffer-until-done; forward
  frames as they arrive; render partial transcripts live.
- **Continuous output stream:** 400 ms PCM16 audio frames (docs claim 200 ms;
  treat as non-contractual) pad with silence forever. Completion must key off
  the output transcript going quiet, never off "audio stopped". Playback must
  energy-gate (silence frames are all-zero; speech RMS runs 1000s; threshold
  200 works).
- **Same-language silence holds:** PT into a PT-target session produces zero
  translation (max RMS 4 observed). No language gate is needed anywhere.
- **Both sessions transcribe all input** (even while translation-silent), so
  input transcripts must be taken from ONE designated session or every line
  appears twice.
- `session.closed` usually arrives after `session.close` but is NOT
  guaranteed (one recording never got it); drain with a timeout.
- Sessions expire ~60 min after creation (`expires_at`); long calls need a
  preemptive reconnect.
- Output dialect for `pt` is Brazilian. Cost $0.034/min per session
  (~$4/hour with both directions). Tier-1 rate limit 50 audio-min/min; two
  sessions consume 2. Audio format both ways: base64 PCM16 mono 24 kHz.
- Whisper input transcription hallucinates on garbled/degraded audio
  (produced fragments and an Arabic token when capture was mangled); treat
  bizarre transcripts as a corrupted-capture symptom, not a model bug.

### Reusable artifacts in this branch

- `fixtures/probe/*.events.jsonl`: real recorded server event streams (both
  directions + the same-language-silence case + one missing-`session.closed`
  case). Gold for offline tests on any architecture.
- `server/probe.py` + `just probe`: the on-demand paid test rig; the ONLY
  code allowed to hit the paid API. `fixtures/generate.py` makes TTS
  fixtures (interim; real phone-speaker recordings were never made).
- `server/translator.py` + `tests/test_translator.py`: a working two-session
  relay and the network-boundary test pattern (protocol-gated fake replaying
  the recordings; mock nothing else).
- `frontend/public/audio-processor.js`: 24 kHz capture worklet
  (Float32->Int16 only, pre-allocated ring buffer, ~42 ms chunks) and
  `frontend/src/lib/audio.ts` (capture pipeline, energy-gated chained
  BufferSource playback, split audio/socket lifecycles).
- E2E technique that needs no human: headless Chrome with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
  --use-file-for-fake-audio-capture=<wav>` against the built app, driven via
  CDP (agent-browser `--cdp`). Proved the whole pipeline renders transcripts.
  NOTE: this cannot test echo (fake device, no acoustics), which is exactly
  why the echo wall was found by a human, late. A future path should build
  an acoustic testbed early (see issue #6 option A).
- A terminal loopback rig existed at `tmp/mic_test.py` (gitignored, easily
  recreated: parecord/pacat piping the mic through `/ws` with energy-gated
  playback and streamed transcripts). Useful for relay checks; useless for
  echo work by design.

## 4. The wall: why it does not work live

**The false assumption this branch was built on:** "browser echo cancellation
(`echoCancellation: true` in getUserMedia) makes the page deaf to its own
output." This is FALSE for audio played through the Web Audio API. Chromium's
echo canceller only takes WebRTC and media-element playout as its reference
signal; anything scheduled to `AudioContext.destination` is invisible to it
(crbug.com/687574, open for years). The plan inherited the assumption from
the legacy app without ever verifying it under controlled conditions.

Observed live signature (screenshots 2026-07-19): user speaks English -> PT
session translates -> PT plays from speakers -> EN session back-translates
the playback ("Olá, meus amores... vocês" comes back as "Hello, folks", the
plural giveaway) -> repeat. The "heard" transcript shows only the user's
English because the echo entering the mic is post-AEC-attenuated residue
(likely re-boosted by autoGainControl), loud enough for the sensitive
interpreter model, too quiet for whisper. The relay itself behaved correctly
throughout: direction separation held even inside the loop.

Why the OpenAI Playground does NOT loop on the same desk hardware: it plays
through WebRTC, which IS in the AEC reference path. That contrast is the
single most important empirical fact for choosing the next architecture.

## 5. Mistakes. Do not go down these paths again

1. **Do not assume `echoCancellation: true` covers your playback.** It only
   covers WebRTC/media-element playout. If audio leaves via Web Audio, the
   mic hears it. This one assumption cost the branch.
2. **Do not retry OS-level echo cancellation across split USB devices.**
   PipeWire `module-echo-cancel` (real webrtc-audio-processing, verified
   installed) failed: mic (Sennheiser SP 30 conference puck) and output
   (separate USB device) sit on independent clocks, and the SP 30's onboard
   DSP/AGC nonlinearly mangles the echo before software AEC sees it.
3. **Do not retry the rtcloopbackhack blind** (MediaStreamDestination ->
   local RTCPeerConnection loopback -> audio element). On this Linux/PipeWire
   stack it made capture dramatically WORSE: near-end speech shredded to
   fragments, whisper hallucinating Arabic, model output degenerating to
   hallucinated one-liners. If ever revisited, only inside an automated
   acoustic testbed, never through a human's ears.
4. **Do not iterate acoustics through the human.** Two blind fix-test cycles
   burned the user's evening and trust. Build the virtual-device testbed
   (null sink whose monitor mixes with a fixture voice into a virtual mic)
   BEFORE attempting any echo fix, so iteration is automated.
5. **Half-duplex (mute mic while playing) does not work here.** The model
   interprets simultaneously: its output starts ~2s into the user's
   utterance, so muting the uplink during playback truncates the very speech
   being translated. Considered and rejected on those grounds.
6. **Do not key anything off the audio stream ending** (it never ends), and
   do not add a language gate (same-language silence makes it dead code).
7. Repo-mechanics traps already paid for: WebSocket routes go directly on
   `app` (prefixed APIRouter drops the prefix, fastapi#2634); keep
   `FastAPI(servers=[{"url": "/"}])` (drives the generated client baseUrl);
   `server/watch_client.py` must use watchfiles as a library, never the CLI;
   `frontend/src/client/` is generated, never hand-edited; the SPA fallback
   only answers GET with `Accept: text/html`.
8. **Do not trust "it worked in the legacy app" claims** without evidence.
   The legacy app's echo behavior was never actually verified; its reported
   model misbehavior may have been this same loop wearing a costume.

## 6. If this is ever resumed: the two candidate paths

- **A. Automated acoustic testbed first** (issue #6): virtual PipeWire
  speaker+mic pair with a controllable echo path, headed Chrome, fixture
  voice. Then iterate AEC configurations (element-only playout, NS/AGC off,
  output device pinning) machine-verified. Keeps the FastAPI relay
  architecture intact.
- **B. Native WebRTC transport (the empirically proven path):** browser
  holds two RTCPeerConnections to the translations endpoint (server mints
  ephemeral client secrets, keeping key custody server-side; transcripts ride
  the `oai-events` data channel). Playback becomes genuine WebRTC remote
  audio, so AEC applies structurally, the exact configuration the Playground
  uses loop-free on this exact desk. The cookbook recommends WebRTC for
  browser-side mics. Cost: the server stops relaying audio (less "brain",
  simpler in some ways); the plan's deployment memo already sketches this as
  option 2. If the "simpler path" garyj pursues resembles anything, it is
  probably this.

## 7. Repo state at parking

- Branch `fastapi-rewrite` (worktree `.worktrees/fastapi-rewrite`), pushed.
  PR #5 (draft) documents Phases 1-4. GitHub repo still named `duovoice`;
  project renamed Sther.
- Issues: #1, #2, #3 closed (probe, relay, frontend audio). #4 open (Phase 5
  hardening, moot while parked). #6 open (the echo wall: evidence + options).
- Key commits: `daab552` probe rig + fixtures, `e6750f0` two-session relay,
  `d9ef618` browser audio client + UI, plus docs commits after each.
- Verification state at parking: ruff, ty, pytest (15 offline tests),
  svelte-check/tsc, production build all green; fake-mic E2E renders live
  transcripts. The tree is clean; the only known defect is the echo loop.
- BYOK deferred by decision (2026-07-19): key lives server-side in
  `.env.local`; the plan's deployment memo holds the BYOK design.
- API spend across the whole branch (probes, E2E, live tests): single-digit
  dollars, within the $5-ish guardrail per session.
- Commands: `just install / just / just check / just test / just probe /
  just serve`. Tests never hit the paid API.

## 8. Reading order for a fresh session

1. This file.
2. `docs/plan/rewrite-fastapi-browser-translate.md` (architecture, verified
   API shape, deployment/BYOK memo).
3. `docs/plan/phase2-probe-findings.md` (the empirical model behavior).
4. Issue #6 (the echo wall) and PR #5 (the arc).
5. `AGENTS.md` (conventions, tooling, gotchas) if touching this repo.

The one-sentence version for whoever comes next: the model is right, the
relay is right, the UI is right, and none of it matters until the app cannot
hear itself; solve the echo question first, with machines, not ears.
