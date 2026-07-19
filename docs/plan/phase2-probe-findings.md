# Phase 2 findings: probe rig vs gpt-realtime-translate

Results from `server/probe.py` streaming the interim TTS fixtures
(`fixtures/en_greeting.wav`, `fixtures/pt_greeting.wav`) through real
`gpt-realtime-translate` sessions on 2026-07-19. Reproduce any row with
`just probe --fixture <wav> --target <lang> [--runs N] [--noise ...]`.

## The four empirical questions

| Question | Answer |
| --- | --- |
| **Latency** | Onset lag (start speaking → first translated audio) ~2.3s median both directions. Translation is *simultaneous*: first audio lands ~3.5s **before** the utterance ends, not after. See table below. |
| **Dialect** | **Brazilian**, clearly. `você`, `me ouvir`, `Eu chego lá`, `sete e meia`, `tá`, `42`. No European markers (`estás`, `a ouvir-me`, `telemóvel`). Judge by ear: `fixtures/probe/en_greeting__to-pt__near_field.out.wav`. |
| **Same-language silence** | **Holds.** PT into a PT-target session produced max output RMS 4 (silence) and zero output-transcript deltas across the whole run. The no-gate design's load-bearing assumption is safe. |
| **Noise reduction A/B** | Inconclusive on clean TTS audio: `near_field` and `far_field` gave near-identical latency and transcripts. A real A/B needs the phone-speaker → room → laptop-mic recording. `--noise` is wired for when that fixture exists. |

### Latency (onset lag = speech-start in → first translated speech out)

| Direction | Runs (s) | Median | End lag (s) |
| --- | --- | --- | --- |
| EN → PT (near) | 2.36, 2.45, 1.94 | **2.36** | −3.5 (audio starts before utterance ends) |
| PT → EN (near) | 2.35, 1.54, 2.93 | **2.35** | −3.7 |

Numbers to beat: the old Gemini app was "too slow for conversation". ~2.3s to
*first* audio while the speaker is still talking, with the rest streaming behind
it, is a different regime. Final judgement is garyj's live call test.

## Two behaviours that shape Phases 3–4

1. **Simultaneous interpretation.** Output transcript + audio begin ~2s into the
   utterance and stream alongside it - the model does not wait for end-of-turn.
   The plan's "utterance-end → first audio" metric therefore goes negative; the
   useful number is *onset lag* (see above). Implication: the relay must forward
   audio/transcript frames as they arrive (no buffering-until-done), and the UI
   should render partial transcripts live.

2. **Continuous output stream.** The model emits 400 ms output-audio frames for
   as long as it is fed input, padding with **silence frames (RMS 0)** once the
   speech is done, and it front-loads them faster than real time (it flushed
   ~20s of silence frames on close in early runs). Implications:
   - Termination cannot key off "audio stopped" - it keys off the output
     *transcript* going quiet. (This is why `probe.py` waits on `last_output_at`,
     not `last_audio_at`.)
   - Playback in Phase 4 must gate on frame energy or it will schedule endless
     silence.
   - Saved fixtures are silence-trimmed (`trim_silence`, `prune_silence_frames`)
     so a ~6s translation is ~450 KB of JSONL, not multiple MB.

## Sample transcripts (for a sanity read; quality is garyj's ear call)

- EN → PT: *"Hey, can you hear me okay? I'll be there around seven thirty, at
  forty-two Bourke Street."* → *"Ei, você consegue me ouvir bem? Eu chego aí por
  volta das sete e meia, na 42 da Burke Street."* (numbers + address survive;
  "Bourke" wobbles between "Burke/Burk/Birk" run to run.)
- PT → EN: *"Oi, tudo bem? Cheguei em casa agora. Me liga quando você puder, tá
  bom?"* → *"Hi, how are you? I just got home. Call me when you can, okay?"*

## Artifacts (replay fixtures for Phase 3)

`fixtures/probe/<stem>__to-<target>__<noise>.{out.wav,events.jsonl}` - the
translated audio (silence-trimmed) and the raw server event stream. The JSONL is
what `tests/test_translator.py` will replay offline in Phase 3.

## Caveats

- Fixtures are **interim TTS**, not the real acoustic path. Numbers will shift
  with real phone-speaker audio; re-run then. The noise A/B especially is moot
  until then.
- The model is nondeterministic; transcripts and exact latency vary run to run.
- No CI hits this - it is an on-demand, paid rig, per the plan.
