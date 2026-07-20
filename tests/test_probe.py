"""Offline tests for the probe's pure helpers (no network, no paid API).

The probe's live behaviour is verified by running it against the real API
(that is the whole point of the rig). These cover the deterministic audio/event
bookkeeping - framing, RMS, and the silence trimming that keeps fixtures small.
"""

import array
import base64
import wave

import pytest

from server.probe import (
    SAMPLE_RATE,
    frame_bytes,
    iter_frames,
    pcm_seconds,
    prune_silence_frames,
    read_fixture,
    rms,
    trim_silence,
)


def _tone(n_samples: int, amplitude: int = 5000) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


def _silence(n_samples: int) -> bytes:
    return bytes(n_samples * 2)


def _audio_event(t: float, pcm: bytes) -> dict[str, object]:
    delta = base64.b64encode(pcm).decode()
    return {"t": t, "event": {"type": "session.output_audio.delta", "delta": delta}}


def _plain_event(t: float, typ: str) -> dict[str, object]:
    return {"t": t, "event": {"type": typ}}


def test_frame_bytes_and_seconds_are_inverse() -> None:
    assert frame_bytes(40) == 1920  # 40 ms at 24 kHz / 16-bit mono
    assert frame_bytes(200) == 9600
    assert pcm_seconds(_silence(SAMPLE_RATE)) == 1.0


def test_iter_frames_covers_all_bytes_including_a_short_tail() -> None:
    pcm = bytes(1920 * 2 + 100)  # two full frames plus a stub
    frames = iter_frames(pcm, 1920)
    assert [len(f) for f in frames] == [1920, 1920, 100]
    assert b"".join(frames) == pcm


def test_rms_is_zero_for_silence_and_the_amplitude_for_a_tone() -> None:
    assert rms(_silence(480)) == 0
    assert rms(_tone(480, amplitude=1000)) == 1000


def test_trim_silence_clips_both_ends_and_empties_pure_silence() -> None:
    pcm = _silence(SAMPLE_RATE) + _tone(4800) + _silence(SAMPLE_RATE)  # 1s / 200ms / 1s
    trimmed = trim_silence(pcm)  # keeps 120 ms lead + speech + 400 ms tail
    assert pcm_seconds(trimmed) == pytest.approx(0.72, abs=0.02)
    assert trim_silence(_silence(SAMPLE_RATE)) == b""


def test_prune_keeps_speech_span_and_all_non_audio_events() -> None:
    speech, silence = _tone(960), _silence(960)
    events = [
        _plain_event(0.0, "session.created"),
        _plain_event(0.1, "session.updated"),
        _audio_event(0.2, silence),  # leading silence -> dropped
        _audio_event(0.3, silence),  # leading silence -> dropped
        _audio_event(0.4, speech),  # first speech -> kept
        _audio_event(0.5, speech),  # last speech  -> kept
        _audio_event(0.6, silence),  # tail frame 1 -> kept
        _audio_event(0.7, silence),  # tail frame 2 -> kept
        _audio_event(0.8, silence),  # beyond tail  -> dropped
        _plain_event(0.9, "session.closed"),
    ]
    pruned = prune_silence_frames(events, tail_frames=2)

    kinds = [rec["event"]["type"] for rec in pruned]  # type: ignore[index]
    assert kinds.count("session.output_audio.delta") == 4
    assert kinds[0] == "session.created"
    assert kinds[1] == "session.updated"
    assert kinds[-1] == "session.closed"


def test_prune_keeps_a_few_frames_when_fully_silent() -> None:
    events = [_audio_event(i / 10, _silence(960)) for i in range(8)]
    pruned = prune_silence_frames(events, silent_keep=5)
    assert len(pruned) == 5


def test_read_fixture_accepts_the_canonical_format(tmp_path) -> None:
    path = tmp_path / "ok.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(_tone(2400))
    assert len(read_fixture(path)) == 2400 * 2


def test_read_fixture_rejects_the_wrong_sample_rate(tmp_path) -> None:
    path = tmp_path / "bad.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(_tone(2400))
    with pytest.raises(SystemExit):
        read_fixture(path)
