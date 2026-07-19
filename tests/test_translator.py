"""Offline replay tests for the two-session relay (no network, no paid API).

FakeUpstream is the network boundary: it stands in for one OpenAI translation
socket and replays an event stream recorded by server/probe.py against the
real endpoint (fixtures/probe/*.events.jsonl), gated by the same protocol the
real endpoint enforces (created before anything, updated only after
session.update, output only after audio arrives). Everything above it -
TranslationSession, Relay, the /ws endpoint - is the real code.
"""

import asyncio
import base64
import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from server import translator
from server.main import app
from server.translator import Relay, TranslationSession, TranslatorError

PROBE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "probe"

# en->pt near_field is the recording where session.closed never arrived; it
# doubles as the proof the relay survives an upstream that just ends.
EN_TO_PT = "en_greeting__to-pt__near_field"
PT_TO_EN = "pt_greeting__to-en__near_field"
PT_SILENT = "pt_greeting__to-pt__near_field"

FRAME_B64 = base64.b64encode(bytes(1920)).decode()  # one 40 ms mic frame


def load_events(stem: str) -> list[dict[str, Any]]:
    path = PROBE_DIR / f"{stem}.events.jsonl"
    return [json.loads(line)["event"] for line in path.read_text().splitlines()]


def deltas(events: list[dict[str, Any]], typ: str) -> list[str]:
    return [str(ev["delta"]) for ev in events if ev["type"] == typ]


class FakeUpstream:
    """Replays one recorded server stream, gated by the client's own protocol.

    The recorded handshake events are re-enacted rather than replayed
    verbatim: session.created is served on connect, session.updated only once
    the client configures the session (whose output language also selects
    which recording to replay), translated events only once audio arrives,
    and session.closed - when the recording has one - only after the client
    sends session.close. A recording without session.closed simply ends the
    stream, like the real socket did.
    """

    def __init__(self, scripts: dict[str, list[dict[str, Any]]]) -> None:
        self.scripts = scripts
        self.sent: list[dict[str, Any]] = []
        self.lang: str | None = None
        self.closed = False
        self._configured = asyncio.Event()
        self._audio_started = asyncio.Event()
        self._close_requested = asyncio.Event()
        self._stream = self._serve()

    async def send(self, message: str) -> None:
        msg = json.loads(message)
        self.sent.append(msg)
        typ = msg.get("type")
        if typ == "session.update":
            self.lang = msg["session"]["audio"]["output"]["language"]
            self._configured.set()
        elif typ == "session.input_audio_buffer.append":
            self._audio_started.set()
        elif typ == "session.close":
            self._close_requested.set()

    def __aiter__(self) -> "FakeUpstream":
        return self

    async def __anext__(self) -> str:
        return await anext(self._stream)

    async def close(self) -> None:
        self.closed = True

    async def _serve(self):
        yield json.dumps({"type": "session.created"})
        await self._configured.wait()
        yield json.dumps({"type": "session.updated"})
        script = self.scripts[self.lang or ""]
        handshake = ("session.created", "session.updated", "session.closed")
        await self._audio_started.wait()
        for ev in script:
            if ev["type"] not in handshake:
                yield json.dumps(ev)
        if any(ev["type"] == "session.closed" for ev in script):
            await self._close_requested.wait()
            yield json.dumps({"type": "session.closed"})


def drain(queue: asyncio.Queue[dict[str, str]]) -> list[dict[str, str]]:
    frames = []
    while not queue.empty():
        frames.append(queue.get_nowait())
    return frames


# ── TranslationSession against single recordings ──────────────────────────────


async def _translating_session_scenario() -> None:
    events = load_events(EN_TO_PT)
    fake = FakeUpstream({"pt": events})

    async def connect(key: str) -> FakeUpstream:
        return fake

    session = TranslationSession("pt", "sk-test", connect, emit_input=True)
    out: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    await asyncio.wait_for(session.start(), 5)

    update = fake.sent[0]["session"]["audio"]
    assert update["output"]["language"] == "pt"
    assert update["input"]["transcription"] == {"model": "gpt-realtime-whisper"}
    assert update["input"]["noise_reduction"] == {"type": "near_field"}

    pump = asyncio.create_task(session.pump(out))
    await session.send_audio(FRAME_B64)
    await asyncio.wait_for(pump, 5)  # recording has no session.closed: EOF path
    frames = drain(out)

    audio = [f["pcm16"] for f in frames if f["type"] == "audio"]
    assert audio == deltas(events, "session.output_audio.delta")
    out_text = "".join(f["text"] for f in frames if f["type"] == "transcript_out")
    assert out_text == "".join(deltas(events, "session.output_transcript.delta"))
    in_text = "".join(f["text"] for f in frames if f["type"] == "transcript_in")
    assert in_text == "".join(deltas(events, "session.input_transcript.delta"))
    tagged = [f for f in frames if f["type"] in ("audio", "transcript_out")]
    assert all(f["lang"] == "pt" for f in tagged)
    assert frames[-1] == {"type": "status", "state": "ended", "lang": "pt"}


def test_session_replays_a_translation_faithfully() -> None:
    asyncio.run(_translating_session_scenario())


async def _silent_session_scenario() -> None:
    events = load_events(PT_SILENT)
    fake = FakeUpstream({"pt": events})

    async def connect(key: str) -> FakeUpstream:
        return fake

    session = TranslationSession("pt", "sk-test", connect, emit_input=False)
    out: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    await asyncio.wait_for(session.start(), 5)
    pump = asyncio.create_task(session.pump(out))
    await session.send_audio(FRAME_B64)

    n_audio = len(deltas(events, "session.output_audio.delta"))
    while out.qsize() < n_audio:  # the recording's few silent frames
        await asyncio.sleep(0)
    await session.send_close()
    await asyncio.wait_for(pump, 5)  # session.closed released by session.close
    frames = drain(out)

    kinds = Counter(f["type"] for f in frames)
    assert kinds == {"audio": n_audio, "status": 1}
    assert not any(f["type"] == "transcript_out" for f in frames)
    assert not any(f["type"] == "transcript_in" for f in frames)


def test_same_language_session_stays_silent_and_closes_cleanly() -> None:
    asyncio.run(_silent_session_scenario())


# ── Relay fan-out / fan-in ────────────────────────────────────────────────────


async def _relay_scenario() -> None:
    scripts = {"pt": load_events(EN_TO_PT), "en": load_events(PT_TO_EN)}
    fakes: list[FakeUpstream] = []

    async def connect(key: str) -> FakeUpstream:
        fake = FakeUpstream(scripts)
        fakes.append(fake)
        return fake

    relay = Relay("sk-test", connect)
    await asyncio.wait_for(relay.start(), 5)
    assert sorted(f.lang or "" for f in fakes) == ["en", "pt"]

    await relay.send_audio(FRAME_B64)
    for fake in fakes:  # fan-out: the same frame reached both sessions
        appended = [
            m for m in fake.sent if m["type"] == "session.input_audio_buffer.append"
        ]
        assert [m["audio"] for m in appended] == [FRAME_B64]

    pt_script, en_script = scripts["pt"], scripts["en"]
    expected = (
        len(deltas(pt_script, "session.output_audio.delta"))
        + len(deltas(en_script, "session.output_audio.delta"))
        + len(deltas(pt_script, "session.output_transcript.delta"))
        + len(deltas(en_script, "session.output_transcript.delta"))
        + len(deltas(pt_script, "session.input_transcript.delta"))
        + 1  # the pt recording ends without session.closed -> "ended" status
    )
    frames = []
    async with asyncio.timeout(5):
        stream = relay.frames()
        while len(frames) < expected:
            frames.append(await anext(stream))

    for lang, script in scripts.items():
        text = "".join(
            f["text"]
            for f in frames
            if f["type"] == "transcript_out" and f["lang"] == lang
        )
        assert text == "".join(deltas(script, "session.output_transcript.delta"))
    # transcript_in comes from the designated pt session only, so the en
    # session's (Portuguese) input transcript must not appear at all.
    in_text = "".join(f["text"] for f in frames if f["type"] == "transcript_in")
    assert in_text == "".join(deltas(pt_script, "session.input_transcript.delta"))

    await asyncio.wait_for(relay.close(), 10)
    assert all(f.closed for f in fakes)
    en_fake = next(f for f in fakes if f.lang == "en")
    assert any(m["type"] == "session.close" for m in en_fake.sent)


def test_relay_fans_audio_out_and_merges_frames_back() -> None:
    asyncio.run(_relay_scenario())


async def _partial_start_failure_scenario() -> None:
    scripts = {"pt": load_events(EN_TO_PT), "en": load_events(PT_TO_EN)}
    fakes: list[FakeUpstream] = []

    async def connect(key: str) -> FakeUpstream:
        if fakes:
            raise TranslatorError("second upstream refused")
        fake = FakeUpstream(scripts)
        fakes.append(fake)
        return fake

    relay = Relay("sk-test", connect)
    with pytest.raises(TranslatorError):
        await asyncio.wait_for(relay.start(), 5)
    await asyncio.wait_for(relay.close(), 5)
    assert fakes[0].closed  # the session that did come up was torn down


def test_relay_start_failure_still_cleans_up() -> None:
    asyncio.run(_partial_start_failure_scenario())


# ── the /ws endpoint end to end ───────────────────────────────────────────────


def test_ws_endpoint_translates_over_the_wire(monkeypatch) -> None:
    scripts = {"pt": load_events(EN_TO_PT), "en": load_events(PT_TO_EN)}

    async def fake_connect(key: str) -> FakeUpstream:
        return FakeUpstream(scripts)

    monkeypatch.setattr(translator, "open_upstream", fake_connect)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    with TestClient(app).websocket_connect("/ws") as ws:
        assert ws.receive_json() == {"type": "status", "state": "ready"}
        ws.send_text("not even json")  # junk from the old echo demo is ignored
        ws.send_json({"type": "audio", "pcm16": FRAME_B64})

        pt_script, en_script = scripts["pt"], scripts["en"]
        counts = Counter()
        for script in (pt_script, en_script):
            counts["audio"] += len(deltas(script, "session.output_audio.delta"))
            counts["transcript_out"] += len(
                deltas(script, "session.output_transcript.delta")
            )
        counts["transcript_in"] = len(
            deltas(pt_script, "session.input_transcript.delta")
        )
        counts["status"] = 1  # the pt recording's EOF -> "ended"

        got = Counter(ws.receive_json()["type"] for _ in range(sum(counts.values())))
        assert got == counts


def test_ws_endpoint_reports_a_missing_key(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app).websocket_connect("/ws") as ws:
        frame = ws.receive_json()
        assert frame["type"] == "error"
        assert "OPENAI_API_KEY" in frame["message"]


def test_ws_endpoint_reports_an_upstream_failure(monkeypatch) -> None:
    async def failing_connect(key: str) -> FakeUpstream:
        raise TranslatorError("upstream refused")

    monkeypatch.setattr(translator, "open_upstream", failing_connect)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    with TestClient(app).websocket_connect("/ws") as ws:
        frame = ws.receive_json()
        assert frame == {"type": "error", "message": "upstream refused"}
