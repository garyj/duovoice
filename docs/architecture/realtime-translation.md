# Realtime interpretation architecture

## Decision

Sther uses one browser-native WebRTC conversation session with
`gpt-realtime-2.1`. The session receives a mixed room microphone and uses an
interpreter prompt to translate each English turn into Brazilian Portuguese and
each Brazilian Portuguese turn into English.

The session configuration follows the working OpenAI Playground shape:

- one `type: realtime` session
- explicit interpreter instructions
- `gpt-realtime-whisper` input transcription
- near-field noise reduction
- semantic VAD with automatic eagerness
- `marin` output voice
- audio-only output
- low reasoning effort
- no tools

The browser attaches the microphone to one peer connection and attaches the
single remote stream directly to one native `<audio>` element.

## Why the dual-session design failed

The earlier rewrite used two concurrent `gpt-realtime-translate` sessions. One
always targeted Portuguese and one always targeted English. Both received the
same room microphone.

That architecture was unsuitable for a couple speaking through one physical
microphone:

1. The microphone is already a mix of both people and anything returning from
   the speakers. There is no source-speaker routing.
2. Portuguese output from one peer connection can leak into the microphone and
   become input to the English-target connection. The English result can then
   leak back into the Portuguese-target connection.
3. Two independent models have no shared turn history and cannot know that the
   other connection produced the audio they just heard.
4. The fixed-target translation model does not accept the custom interpreter
   prompt or selected voice that made the Playground behavior successful.

OpenAI's translation guide recommends preserving separate speaker tracks for
multi-party translation and says mixed speakers are harder to handle. A room
microphone cannot satisfy that recommendation. The dedicated translation model
is a strong fit for one-way listening, broadcasts, or routed call participants,
not this mixed two-way room conversation.

## Echo control

Chrome captures the microphone with echo cancellation, noise suppression, and
automatic gain control. The remote audio remains on the native WebRTC playback
path so Chromium can use its normal acoustic echo cancellation reference.

Browser echo cancellation is still imperfect with physical speakers. Sther
therefore adds a deterministic half-duplex gate:

1. Keep semantic VAD enabled, but disable its automatic response creation.
2. Request a response only for a turn that began while microphone capture was
   open and no response was active.
3. Disable the outgoing microphone track before requesting that response.
4. Delete any turn detected while capture is closed instead of responding to
   it.
5. Keep capture closed while the remote output buffer is playing and for two
   seconds afterward, giving the speaker and echo canceller time to settle.
6. If a response has no audio, apply the same tail after `response.done`.

This prevents the interpreter from translating itself even when speaker output
reaches the microphone. The tradeoff is intentional: a person cannot interrupt
while the translation is speaking. Reliability is more important than barge-in
for this application.

## Authentication and protocol

The app uses OpenAI's unified WebRTC interface:

1. Chrome captures one microphone track.
2. The browser creates one `RTCPeerConnection`, one remote `<audio>` element,
   and one `oai-events` data channel.
3. The browser creates an SDP offer and sends it to `POST /api/session` as
   `application/sdp`.
4. The Cloudflare Worker combines the offer with the server-owned session
   configuration in multipart form data.
5. The Worker posts that form to `POST /v1/realtime/calls` using the standard
   API key.
6. The Worker returns OpenAI's SDP answer to the browser.
7. The browser installs the answer and then relies on the WebRTC media path for
   microphone input and translated audio output.

The standard API key never enters the browser. The Worker route and its response
are not cacheable.

## Transcript events

Source speech uses:

- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed`

Translated speech uses:

- `response.output_audio_transcript.delta`
- `response.output_audio_transcript.done`

Each final transcript replaces its accumulated deltas for the same item. New
item identifiers begin a new paragraph in the rolling display.

## Reference implementations

The browser capture pattern was compared against current official sources:

- [OpenAI Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [OpenAI Realtime Console](https://github.com/openai/openai-realtime-console)
- [OpenAI Realtime Voice Component](https://github.com/openai/realtime-voice-component)
- [OpenAI Realtime translation cookbook](https://github.com/openai/openai-cookbook/tree/main/examples/voice_solutions/realtime_translation_guide)
- [OpenAI semantic VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad#semantic-vad)
- [OpenAI Realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations#keep-vad-but-disable-automatic-responses)
- [OpenAI Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events)

The official Realtime Console and Realtime Voice Component both use ordinary
`getUserMedia({ audio: true })`, one microphone track, one peer connection, and
one native autoplaying audio element. Sther's browser capture is the same shape,
with explicit standard Chrome audio-processing constraints. No custom PCM
resampler or AudioWorklet is required for WebRTC.

## Verification record

The first dual-session acoustic experiment translated both prepared fixtures,
but it also captured speaker return and produced an opposite-session fragment.
Real conversation use subsequently showed missed Portuguese speech and repeated
English and Portuguese output. That real failure supersedes the earlier limited
fixture result.

The first single-session acoustic run translated English correctly, but VAD
automatically created another response after output reached the physical room
microphone. That proved one session and browser echo cancellation were not
sufficient by themselves. Automatic response creation was then disabled and
the browser became responsible for accepting or rejecting detected turns.

The final headed Chrome run used a PipeWire null sink as both the browser's
speaker and microphone source. This deliberately fed every output sample back
toward Chrome without making sound in the room. The run verified:

- English input produced one Brazilian Portuguese output turn.
- Brazilian Portuguese input produced one English output turn.
- Capture was disabled before each requested response and stayed disabled
  through remote playback.
- Directly looped output produced no additional turn during a 20 second watch
  after each translation.
- Stop released the microphone and cleared the remote audio stream.
- Start established a fresh session after Stop.
- Chrome reported no console errors or page errors.
