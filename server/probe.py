"""Probe rig for gpt-realtime-translate (issue #1, plan Phase 2).

Streams a fixture WAV into one *real* translation session, prints a timestamped
event timeline, and saves the translated audio + the raw server event stream as
JSONL. Those artifacts are what the Phase 3 relay tests replay offline, so the
paid API is hit here and nowhere else.

    # EN -> PT, one run, save artifacts + listen to the dialect by ear
    uv run python -m server.probe --fixture fixtures/en_greeting.wav --target pt

    # latency, several runs (utterance-end -> first translated audio)
    uv run python -m server.probe --fixture fixtures/en_greeting.wav --target pt --runs 5

    # same-language silence: PT into a PT-target session should stay silent
    uv run python -m server.probe --fixture fixtures/pt_greeting.wav --target pt

    # noise-reduction A/B
    uv run python -m server.probe --fixture fixtures/en_greeting.wav --target pt --noise far_field

The four empirical questions from the plan map onto flags: latency (--runs),
dialect (listen to the saved .out.wav), same-language silence (same-language
fixture + target), noise A/B (--noise).

Protocol (verified against the OpenAI realtime-translation guide + a working
2026 client): connect, wait for `session.created`, send `session.update`, wait
for `session.updated`, then append PCM16/24 kHz/mono frames continuously
(silence included) while translated `session.output_audio.delta` frames stream
back. Close with `session.close` and drain until `session.closed`.
"""

import argparse
import array
import asyncio
import base64
import contextlib
import json
import os
import statistics
import sys
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import websockets
from dotenv import load_dotenv

from server.translator import open_upstream, session_update

SAMPLE_RATE = 24_000
BYTES_PER_SAMPLE = 2
INPUT_FRAME_MS = 40  # how much audio each append carries; a live mic sends ~this
# The model emits a *continuous* output stream: silence frames keep arriving as
# long as we feed input. RMS above this marks a frame as actual translated
# speech (silence frames are all-zero, rms 0); real speech runs into the 1000s.
SPEECH_RMS = 200


class ProbeError(RuntimeError):
    """A protocol-level failure surfaced by the probe (server error or timeout)."""


# ── pure helpers (no network; the parts Phase 3 can unit-test) ────────────────


def frame_bytes(ms: int) -> int:
    return int(SAMPLE_RATE * BYTES_PER_SAMPLE * ms / 1000)


def pcm_seconds(pcm: bytes) -> float:
    return len(pcm) / (SAMPLE_RATE * BYTES_PER_SAMPLE)


def iter_frames(pcm: bytes, frame_len: int) -> list[bytes]:
    return [pcm[i : i + frame_len] for i in range(0, len(pcm), frame_len)]


def rms(pcm: bytes) -> int:
    """Root-mean-square amplitude of a PCM16 little-endian frame (0 for silence)."""
    usable = pcm[: len(pcm) - (len(pcm) % 2)]
    if not usable:
        return 0
    samples = array.array("h")
    samples.frombytes(usable)
    return int((sum(s * s for s in samples) / len(samples)) ** 0.5)


def read_fixture(path: Path) -> bytes:
    """Read a WAV fixture, enforcing the exact format the endpoint expects."""
    with contextlib.closing(wave.open(str(path), "rb")) as w:
        fmt = (w.getnchannels(), w.getsampwidth(), w.getframerate())
        if fmt != (1, 2, SAMPLE_RATE):
            sys.exit(
                f"{path}: need mono / 16-bit / {SAMPLE_RATE} Hz, got "
                f"{fmt[0]}ch / {fmt[1] * 8}bit / {fmt[2]} Hz "
                "(regenerate with fixtures/generate.py)"
            )
        return w.readframes(w.getnframes())


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)


# ── run state + result ────────────────────────────────────────────────────────


@dataclass
class _State:
    """Mutable state a single session accumulates, all times relative to t0."""

    t0: float
    created: asyncio.Event = field(default_factory=asyncio.Event)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    closed: asyncio.Event = field(default_factory=asyncio.Event)
    error: dict[str, object] | None = None
    updated_at: float | None = None
    first_audio_at: float | None = None
    first_speech_at: float | None = None
    last_speech_at: float | None = None
    last_output_at: float | None = None
    frames: int = 0
    input_parts: list[str] = field(default_factory=list)
    output_parts: list[str] = field(default_factory=list)
    audio: bytearray = field(default_factory=bytearray)
    events: list[dict[str, object]] = field(default_factory=list)


@dataclass
class RunResult:
    target: str
    noise: str
    input_transcript: str
    output_transcript: str
    updated_at: float | None
    utterance_start_at: float
    utterance_end_at: float
    first_audio_at: float | None
    first_speech_at: float | None
    last_speech_at: float | None
    output_audio: bytes
    output_frames: int
    fixture_seconds: float
    events: list[dict[str, object]]

    @property
    def latency(self) -> float | None:
        """Utterance-end -> first translated speech (the plan's metric).

        Negative means the model was already speaking the translation before the
        utterance ended - this model interprets simultaneously, so that happens.
        """
        if self.first_speech_at is None:
            return None
        return self.first_speech_at - self.utterance_end_at

    @property
    def onset(self) -> float | None:
        """Speech-start in -> first translated speech out (the live-call feel)."""
        if self.first_speech_at is None:
            return None
        return self.first_speech_at - self.utterance_start_at

    @property
    def speech_seconds(self) -> float | None:
        """Span from first to last speech-bearing output frame."""
        if self.first_speech_at is None or self.last_speech_at is None:
            return None
        return self.last_speech_at - self.first_speech_at

    @property
    def output_seconds(self) -> float:
        return pcm_seconds(self.output_audio)


# ── the session itself ────────────────────────────────────────────────────────


def _dispatch(ev: dict[str, object], t: float, st: _State) -> str:
    """Fold one server event into state; return a one-line timeline label."""
    typ = ev.get("type", "?")
    if typ == "session.created":
        st.created.set()
        return "session.created"
    if typ == "session.updated":
        st.updated_at = t
        st.ready.set()
        return "session.updated"
    if typ == "session.input_transcript.delta":
        delta = str(ev.get("delta", ""))
        st.input_parts.append(delta)
        return f"input  {delta!r}"
    if typ == "session.output_transcript.delta":
        delta = str(ev.get("delta", ""))
        st.output_parts.append(delta)
        st.last_output_at = t
        return f"output {delta!r}"
    if typ == "session.output_audio.delta":
        pcm = base64.b64decode(str(ev.get("delta", "")))
        st.audio += pcm
        st.frames += 1
        level = rms(pcm)
        if st.first_audio_at is None:
            st.first_audio_at = t
        if level > SPEECH_RMS:
            if st.first_speech_at is None:
                st.first_speech_at = t
            st.last_speech_at = t
        return f"audio  {len(pcm):,} B  rms={level:<5} (#{st.frames})"
    if typ == "session.closed":
        st.closed.set()
        return "session.closed"
    if typ == "error":
        st.error = {"error": ev.get("error", ev)}
        st.created.set()
        st.ready.set()
        st.closed.set()
        return f"ERROR  {json.dumps(st.error)[:300]}"
    return str(typ)


async def _receive(ws: websockets.ClientConnection, st: _State, echo: bool) -> None:
    with contextlib.suppress(websockets.ConnectionClosed):
        async for raw in ws:
            t = time.perf_counter() - st.t0
            ev = json.loads(raw)
            st.events.append({"t": round(t, 4), "event": ev})
            label = _dispatch(ev, t, st)
            if echo:
                print(f"  [{t:+7.3f}s] {label}", flush=True)


async def _await(event: asyncio.Event, st: _State, timeout: float, what: str) -> None:
    try:
        await asyncio.wait_for(event.wait(), timeout)
    except TimeoutError:
        raise ProbeError(
            {"message": f"timed out waiting for {what} ({timeout}s)"}
        ) from None
    if st.error is not None:
        raise ProbeError(st.error)


async def _append(ws: websockets.ClientConnection, chunk: bytes) -> None:
    await ws.send(
        json.dumps(
            {
                "type": "session.input_audio_buffer.append",
                "audio": base64.b64encode(chunk).decode(),
            }
        )
    )


async def _stream(
    ws: websockets.ClientConnection,
    st: _State,
    pcm: bytes,
    frame_len: int,
    realtime: bool,
    caps: tuple[float, float, float],
) -> tuple[float, float]:
    """Stream the fixture (real-time paced) then silence until output settles.

    Returns (utterance_start, utterance_end) relative to t0: the moments the
    first and last speech frames left, the window latency is measured against.
    """
    no_output_timeout, quiet_period, max_wait = caps
    frame_s = frame_len / (SAMPLE_RATE * BYTES_PER_SAMPLE)

    base = time.perf_counter()
    for i, fr in enumerate(iter_frames(pcm, frame_len)):
        if st.error is not None:
            break
        await _append(ws, fr)
        if realtime:
            await asyncio.sleep(
                max(0.0, base + (i + 1) * frame_s - time.perf_counter())
            )
    utterance_end = time.perf_counter()

    # A live mic never stops: keep feeding silence so the model can finish the
    # turn and we capture the whole response. Termination keys off the output
    # *transcript*, not audio - the model streams silence audio frames forever,
    # but the transcript stops once the translated speech is done.
    silence = bytes(frame_len)
    while st.error is None:
        await _append(ws, silence)
        await asyncio.sleep(frame_s)
        since_end = time.perf_counter() - utterance_end
        if st.last_output_at is None:
            if since_end > no_output_timeout:
                break  # nothing came back - the same-language-silence case
        elif time.perf_counter() - st.t0 - st.last_output_at > quiet_period:
            break  # transcript has gone quiet - response complete
        if since_end > max_wait:
            break

    return base - st.t0, utterance_end - st.t0


async def run_once(
    key: str,
    pcm: bytes,
    fixture_seconds: float,
    target: str,
    noise: str,
    realtime: bool,
    caps: tuple[float, float, float],
    echo: bool,
) -> RunResult:
    ws = await open_upstream(key)
    st = _State(t0=time.perf_counter())
    receiver = asyncio.create_task(_receive(ws, st, echo))
    try:
        await _await(st.created, st, 15, "session.created")
        await ws.send(json.dumps(session_update(target, noise)))
        await _await(st.ready, st, 15, "session.updated")
        if echo:
            print(f"  streaming {fixture_seconds:.1f}s of audio...", flush=True)
        utterance_start, utterance_end = await _stream(
            ws, st, pcm, frame_bytes(INPUT_FRAME_MS), realtime, caps
        )
        with contextlib.suppress(websockets.ConnectionClosed):
            await ws.send(json.dumps({"type": "session.close"}))
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(st.closed.wait(), timeout=5)
    finally:
        receiver.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await receiver
        await ws.close()

    if st.error is not None:
        raise ProbeError(st.error)

    return RunResult(
        target=target,
        noise=noise,
        input_transcript="".join(st.input_parts).strip(),
        output_transcript="".join(st.output_parts).strip(),
        updated_at=st.updated_at,
        utterance_start_at=utterance_start,
        utterance_end_at=utterance_end,
        first_audio_at=st.first_audio_at,
        first_speech_at=st.first_speech_at,
        last_speech_at=st.last_speech_at,
        output_audio=bytes(st.audio),
        output_frames=st.frames,
        fixture_seconds=fixture_seconds,
        events=st.events,
    )


# ── reporting + artifacts ─────────────────────────────────────────────────────


def print_summary(r: RunResult) -> None:
    print(f"  input : {r.input_transcript!r}")
    print(f"  output: {r.output_transcript!r}")
    print(
        f"  utterance            +{r.utterance_start_at:.2f}s -> "
        f"+{r.utterance_end_at:.2f}s  (spoke for {r.fixture_seconds:.1f}s)"
    )
    if r.first_speech_at is None:
        silent = "stayed SILENT (no translated speech)"
        if r.output_transcript:
            silent += f" but emitted a transcript: {r.output_transcript!r}"
        print(f"  translation          {silent}")
    else:
        print(f"  translated speech    +{r.first_speech_at:.2f}s")
        print(
            f"  ▶ onset lag          {r.onset:.2f}s  (start speaking -> hear translation)"
        )
        sign = "before" if r.latency is not None and r.latency < 0 else "after"
        print(
            f"  ▶ end lag            {r.latency:+.2f}s  (first translated audio "
            f"{sign} utterance end)"
        )
    span = (
        f", {r.speech_seconds:.1f}s of speech" if r.speech_seconds is not None else ""
    )
    print(
        f"  output stream        {r.output_frames} frames "
        f"({r.output_seconds:.1f}s, mostly trailing silence{span})"
    )


def trim_silence(pcm: bytes, lead_ms: int = 120, tail_ms: int = 400) -> bytes:
    """Clip the leading and trailing silence off the continuous output stream."""
    usable = pcm[: len(pcm) - (len(pcm) % 2)]
    samples = array.array("h")
    samples.frombytes(usable)
    loud = [i for i, s in enumerate(samples) if abs(s) > SPEECH_RMS]
    if not loud:
        return b""
    start = max(0, loud[0] - int(SAMPLE_RATE * lead_ms / 1000))
    end = min(len(samples), loud[-1] + 1 + int(SAMPLE_RATE * tail_ms / 1000))
    return samples[start:end].tobytes()


def prune_silence_frames(
    events: list[dict[str, object]], tail_frames: int = 2, silent_keep: int = 5
) -> list[dict[str, object]]:
    """Keep only the speech span of the audio stream, dropping silence frames.

    Every non-audio event is kept verbatim; audio frames are kept from the first
    to the last speech-bearing one (plus a short tail), so a fixture carries the
    translated speech without the silence the model pads it with. A fully silent
    run keeps a few frames as evidence.
    """
    audio_type = "session.output_audio.delta"

    def is_speech(rec: dict[str, object]) -> bool:
        ev = rec["event"]
        delta = ev.get("delta", "") if isinstance(ev, dict) else ""
        return rms(base64.b64decode(str(delta))) > SPEECH_RMS

    audio_idx = [
        i
        for i, rec in enumerate(events)
        if isinstance(rec["event"], dict) and rec["event"].get("type") == audio_type
    ]
    speech_idx = [i for i in audio_idx if is_speech(events[i])]
    if speech_idx:
        first, last = speech_idx[0], speech_idx[-1]
        tail = [i for i in audio_idx if i > last][:tail_frames]
        keep = {i for i in audio_idx if first <= i <= last} | set(tail)
    else:
        keep = set(audio_idx[:silent_keep])

    return [
        rec
        for i, rec in enumerate(events)
        if not (
            isinstance(rec["event"], dict) and rec["event"].get("type") == audio_type
        )
        or i in keep
    ]


def save_artifacts(r: RunResult, out_dir: Path, stem: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"{stem}__to-{r.target}__{r.noise}"
    wav_path = out_dir / f"{base}.out.wav"
    jsonl_path = out_dir / f"{base}.events.jsonl"

    audio = trim_silence(r.output_audio)
    write_wav(wav_path, audio)
    events = prune_silence_frames(r.events)
    with jsonl_path.open("w") as f:
        for record in events:
            f.write(json.dumps(record) + "\n")

    print(
        f"  saved: {wav_path}  ({pcm_seconds(audio):.1f}s, {wav_path.stat().st_size:,} B)"
    )
    print(
        f"         {jsonl_path}  ({len(events)} events, {jsonl_path.stat().st_size:,} B)"
    )


def _stat_line(name: str, values: list[float]) -> str:
    body = ", ".join(f"{v:+.2f}" for v in values)
    return (
        f"  {name:10} [{body}]  "
        f"min {min(values):+.2f}  median {statistics.median(values):+.2f}  "
        f"max {max(values):+.2f}"
    )


def print_latency_stats(onsets: list[float], end_lags: list[float], label: str) -> None:
    print(f"\n── latency over {len(onsets)} run(s): {label} (seconds) ──")
    if not onsets:
        print("  no run produced translated speech")
        return
    print(_stat_line("onset lag", onsets))
    print(_stat_line("end lag", end_lags))


# ── CLI ───────────────────────────────────────────────────────────────────────


def load_key() -> str:
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env.local")
    load_dotenv(root / ".env")
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY not set (see .env.example)")
    return key


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--fixture", required=True, type=Path, help="input WAV (mono/16-bit/24 kHz)"
    )
    p.add_argument(
        "--target", required=True, help="target language code, e.g. pt or en"
    )
    p.add_argument("--noise", default="near_field", choices=["near_field", "far_field"])
    p.add_argument("--runs", type=int, default=1, help="repeat for latency stats")
    p.add_argument("--out-dir", type=Path, default=Path("fixtures/probe"))
    p.add_argument(
        "--no-realtime",
        action="store_true",
        help="blast input without real-time pacing (faster; latency meaningless)",
    )
    p.add_argument(
        "--quiet", action="store_true", help="suppress the per-event timeline"
    )
    p.add_argument(
        "--no-output-timeout", type=float, default=8.0, dest="no_output_timeout"
    )
    p.add_argument("--quiet-period", type=float, default=2.0, dest="quiet_period")
    p.add_argument("--max-wait", type=float, default=25.0, dest="max_wait")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    key = load_key()
    pcm = read_fixture(args.fixture)
    fixture_seconds = pcm_seconds(pcm)
    caps = (args.no_output_timeout, args.quiet_period, args.max_wait)
    stem = args.fixture.stem
    label = f"{stem} -> {args.target} ({args.noise})"

    print(f"probe: {label} · {args.runs} run(s) · fixture {fixture_seconds:.1f}s")
    onsets: list[float] = []
    end_lags: list[float] = []
    for i in range(args.runs):
        print(f"\n── run {i + 1}/{args.runs} ──────────────────────────────")
        result = asyncio.run(
            run_once(
                key,
                pcm,
                fixture_seconds,
                args.target,
                args.noise,
                realtime=not args.no_realtime,
                caps=caps,
                echo=not args.quiet,
            )
        )
        print_summary(result)
        if result.onset is not None and result.latency is not None:
            onsets.append(result.onset)
            end_lags.append(result.latency)
        if i == 0:
            save_artifacts(result, args.out_dir, stem)

    if args.runs > 1:
        print_latency_stats(onsets, end_lags, label)


if __name__ == "__main__":
    try:
        main()
    except ProbeError as exc:
        sys.exit(f"probe failed: {json.dumps(exc.args[0]) if exc.args else exc}")
    except KeyboardInterrupt:
        sys.exit(130)
