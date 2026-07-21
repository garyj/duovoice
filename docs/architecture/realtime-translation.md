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

## Echo control and interruption

Chrome captures the microphone with echo cancellation, noise suppression, and
automatic gain control. The remote audio remains on the native WebRTC playback
path so Chromium can use its normal acoustic echo cancellation reference.

Sther keeps the microphone live during output so either person can interrupt:

1. Semantic VAD detects speech while `interrupt_response` is enabled.
2. OpenAI clears the WebRTC output buffer and truncates unplayed audio when a
   new speaker interrupts.
3. Automatic response creation remains disabled.
4. After the interrupted turn is committed, the browser requests the next
   response. If the previous response is still closing, that request waits for
   `response.done`.
5. A committed item without a matching speech-start event is deleted rather
   than translated.

Keeping the microphone open also keeps Chrome's acoustic echo canceller active
instead of forcing it to settle after every translation. This restores natural
barge-in while retaining explicit control over which committed turns receive a
response. It still depends on the browser and physical audio path suppressing
speaker return, so acoustic loop testing is required for every change here.

## Authentication and protocol

The app uses OpenAI's unified WebRTC interface:

1. Chrome captures one microphone track.
2. The browser creates one `RTCPeerConnection`, one remote `<audio>` element,
   and one `oai-events` data channel.
3. The browser combines its SDP offer and the session configuration in
   multipart form data.
4. The browser posts that form directly to OpenAI's
   `POST /v1/realtime/calls` endpoint using the API key saved in local storage.
5. OpenAI returns the SDP answer to the browser.
6. The browser installs the answer and then relies on the WebRTC media path for
   microphone input and translated audio output.

This browser-held key is a deliberate personal-tool tradeoff. A public copy of
the static app has no shared credential, so every visitor must supply their own
key.

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
- [OpenAI interruption and truncation guide](https://developers.openai.com/api/docs/guides/realtime-conversations#interruption-and-truncation)
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

The half-duplex headed Chrome run used a PipeWire null sink as both the browser's
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

Real conversation use then showed that muting capture made turn-taking too slow.
The barge-in replacement was tested in headed Chrome with the same direct
PipeWire loop:

- A long English turn began playing its Brazilian Portuguese translation.
- A Brazilian Portuguese turn started before that output finished.
- The first translation stopped mid-sentence instead of continuing to play.
- The Portuguese input was transcribed and produced one English translation.
- Directly looped output produced no additional turn during a 20 second watch.
- Chrome reported no console errors or page errors.
