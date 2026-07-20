# Realtime translation architecture

## Decision

Sther is a browser-native WebRTC application with one microphone stream and two
concurrent `gpt-realtime-translate` sessions:

| Session | Input | Output | Transcription |
| --- | --- | --- | --- |
| English to Portuguese | Shared microphone track | Brazilian Portuguese audio and text | `gpt-realtime-whisper` |
| Portuguese to English | Shared microphone track | English audio and text | Disabled |

Each peer connection attaches its remote stream directly to its own autoplaying
`<audio>` element. Output audio never passes through Web Audio. This keeps
Chromium's native WebRTC playback path available to its acoustic echo
cancellation reference.

The browser state machine owns microphone capture, both peer connections, both
event data channels, transcript aggregation, expiry timers, reconnect attempts,
and cleanup. A run identifier makes late events from a stopped or replaced run
inert.

## Authentication

The production site is a Cloudflare Worker with Vite's static output bound as
assets. `POST /api/session` accepts a target language and whether the session
should transcribe input. The Worker reads `OPENAI_API_KEY` from a Worker secret
and returns a short-lived OpenAI client secret. Local `wrangler dev` reads the
same binding from an ignored `.dev.vars`. The development worktree links that
file to its existing ignored `.env.local`.

The standard API key is never sent to, stored by, or bundled into the browser.
The Worker route is same-origin and the response is not cacheable.

Cloudflare recommends Workers Static Assets for new full-stack applications.
The static asset configuration can run the Worker first only for `/api/*`
routes. Local secrets can live in `.env` or `.dev.vars`, with only one of those
files used at a time.

## Protocol

For each target language:

1. Request a short-lived client secret from `/api/session`.
2. Create an `RTCPeerConnection` and an `oai-events` data channel.
3. Attach the existing microphone track.
4. Create and install the local SDP offer.
5. POST the offer to
   `https://api.openai.com/v1/realtime/translations/calls` with the client
   secret.
6. Install the returned SDP answer.
7. Attach the remote track to the session's `<audio>` element.
8. Append input, output, and timing transcript deltas from the data channel.

Translation sessions do not use conversational response events. The documented
server event set is `session.created`, `session.updated`, `session.closed`,
input transcript delta, output transcript delta, output audio delta, and
`error`. There is no response completion or output cancellation event.

Stop closes both data channels and peer connections, stops the shared
microphone, clears timers and pending requests, and detaches both audio
elements. Reconnection is sequential and happens before the earliest advertised
session expiry, so two generations never translate the microphone at the same
time.

## Supported behavior and limits

- A translation session has one target language. Two target languages require
  two sessions.
- The model supports Portuguese as target code `pt`. Prior live listening
  confirmed Brazilian Portuguese output.
- Same-language speech is expected to produce no translated output. Prior live
  probes confirmed this for Portuguese input into a Portuguese-target session.
- Input transcription is optional. Enabling it on one of the identical input
  sessions avoids duplicate transcript work and cost.
- The current Tier 1 model limit is 50 minutes of audio per minute. Higher tiers
  list 200, 400, 650, and 850.
- Current output pricing is USD 0.034 per translation audio minute and USD 0.017
  per transcription audio minute. Two translation sessions plus one
  transcription session therefore cost about USD 0.085 per wall-clock minute,
  or USD 5.10 per hour, while all three are continuously receiving audio.
- Translation event fixtures captured in July 2026 advertise session expiry
  roughly one hour after creation.

## Evidence

Official documentation:

- [Realtime translation guide](https://developers.openai.com/api/docs/guides/realtime-translation)
- [Realtime translation cookbook](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide)
- [Translation server events](https://developers.openai.com/api/reference/resources/realtime/translation-server-events)
- [Translation client events](https://developers.openai.com/api/reference/resources/realtime/translation-client-events)
- [`gpt-realtime-translate` model limits](https://developers.openai.com/api/docs/models/gpt-realtime-translate)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing#audio-tokens)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare local secrets](https://developers.cloudflare.com/workers/local-development/environment-variables/)

Live evidence:

- The parked WebSocket probes measured median translated speech onset at about
  2.35 seconds in both directions, confirmed simultaneous output before long
  utterances ended, and confirmed same-language suppression.
- On 2026-07-20, headed Chrome posted an SDP offer directly to the translation
  calls endpoint with a standard API key. The CORS preflight returned 200 and
  negotiation returned 201 when the model query parameter was present. Direct
  use is technically possible, but it is rejected as an application
  architecture because OpenAI requires standard keys to remain server-side and
  recommends short-lived browser client secrets.
- The same Chrome probe reported a real 48 kHz mono microphone track with echo
  cancellation, noise suppression, and automatic gain control enabled.
- On 2026-07-20, the one-direction short-lived-secret spike connected in headed
  Chrome in about three seconds. The data channel opened about 0.24 seconds
  later and `session.created` arrived about 0.23 seconds after that.
- The spike played the existing English fixture through the real Sennheiser
  speaker. The C922 webcam microphone captured it, and the native remote WebRTC
  track produced Brazilian Portuguese audio and transcript output. Source and
  translation transcript deltas began 82 milliseconds apart.
- The microphone later transcribed some Portuguese remote speaker output, which
  proves the physical acoustic return path was active. The Portuguese-target
  session suppressed that same-language input, so it did not create a runaway
  translation loop.
- The live WebRTC data channel also emitted `output_audio_buffer.started`, which
  is not listed in the current translation server event reference. The client
  treats unknown events as diagnostics and does not depend on this event.
- Stop closed the data channel, peer connection, microphone track, and remote
  audio attachment.
- On 2026-07-20, the final bidirectional app connected both sessions in headed
  Chrome in about 3.3 seconds. The English fixture produced only Brazilian
  Portuguese translation, and the Portuguese fixture produced only English
  translation.
- The final acoustic isolation run played only the English fixture, then
  observed the physical speaker and microphone path for one minute. Chromium's
  native WebRTC echo cancellation removed almost all speaker return. The
  opposite session emitted one bounded two-word English fragment after about 30
  seconds, then remained silent for the rest of the observation window. There
  was no repeated audio, retransmission into Portuguese, or growing feedback.
- Final Stop testing left both remote audio elements paused with `srcObject`
  cleared. A following Start created a fresh pair successfully.
