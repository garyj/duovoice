"""Two-session relay for gpt-realtime-translate (issue #2, plan Phase 3).

The browser is a dumb terminal: it sends mic audio up one WebSocket and gets
translated audio + transcripts back. This module is the brain behind /ws: a
Relay owns one TranslationSession per target language (EN <-> PT = two), fans
the same mic frames out to both, and merges what comes back into
browser-ready frames.

Design facts from the Phase 2 probe (docs/plan/phase2-probe-findings.md):

- The model interprets *simultaneously*, so frames are forwarded the moment
  they arrive in both directions; nothing buffers until an utterance ends.
- Same-language input stays silent (a PT-target session fed PT emits no
  translation), so the relay needs no language gate.
- The output audio stream is continuous (silence frames pad it forever), so
  nothing here keys off "audio stopped"; completion belongs to transcripts.
- Every session transcribes the input it hears even while staying silent, so
  input transcripts are forwarded from one designated session only or the
  browser would see every line twice.

Wire protocol to the browser (plan "Architecture" section):

    up   {"type": "audio", "pcm16": "<base64>"}
    down {"type": "audio", "lang": ..., "pcm16": ...}
         {"type": "transcript_out", "lang": ..., "text": ...}
         {"type": "transcript_in", "text": ...}   (source language is
             auto-detected upstream, so this frame carries no lang)
         {"type": "status", "state": ...} | {"type": "error", "message": ...}
"""

import asyncio
import contextlib
import hashlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Protocol

import websockets

WS_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"
LANGS = ("pt", "en")  # one upstream session per target language
NOISE = "near_field"
READY_TIMEOUT = 15.0  # connect -> session.updated
CLOSE_TIMEOUT = 5.0  # session.close -> session.closed, which may never arrive


class TranslatorError(RuntimeError):
    """A protocol-level failure on an upstream translation socket."""


def session_update(target: str, noise: str) -> dict[str, object]:
    return {
        "type": "session.update",
        "session": {
            "audio": {
                "input": {
                    "transcription": {"model": "gpt-realtime-whisper"},
                    "noise_reduction": {"type": noise},
                },
                "output": {"language": target},
            }
        },
    }


class UpstreamSocket(Protocol):
    """The slice of a websockets client connection the relay relies on."""

    def __aiter__(self) -> AsyncIterator[str | bytes]: ...

    async def send(self, message: str) -> None: ...

    async def close(self) -> None: ...


Connect = Callable[[str], Awaitable[UpstreamSocket]]


async def open_upstream(key: str) -> websockets.ClientConnection:
    """Open one real translation socket (the network boundary tests fake out)."""
    return await websockets.connect(
        WS_URL,
        additional_headers={
            "Authorization": f"Bearer {key}",
            # The realtime-translation guide asks for a stable, opaque
            # end-user identifier: a hash of the paying key, never the key.
            "OpenAI-Safety-Identifier": hashlib.sha256(key.encode()).hexdigest(),
        },
        max_size=None,
    )


class TranslationSession:
    """One upstream socket translating everything it hears into `lang`."""

    def __init__(
        self, lang: str, key: str, connect: Connect | None = None, *, emit_input: bool
    ) -> None:
        self.lang = lang
        self._key = key
        self._connect = connect or open_upstream
        self._emit_input = emit_input
        self._ws: UpstreamSocket | None = None

    async def start(self) -> None:
        """Connect and configure; returns once the session accepts audio.

        The endpoint boots with default settings (output language "es"), so
        no audio may flow before session.updated confirms our configuration.
        """
        ws = await self._connect(self._key)
        self._ws = ws
        await self._expect(ws, "session.created")
        await ws.send(json.dumps(session_update(self.lang, NOISE)))
        await self._expect(ws, "session.updated")

    async def _expect(self, ws: UpstreamSocket, wanted: str) -> None:
        try:
            async with asyncio.timeout(READY_TIMEOUT):
                async for raw in ws:
                    ev = json.loads(raw)
                    typ = ev.get("type")
                    if typ == wanted:
                        return
                    if typ == "error":
                        raise TranslatorError(json.dumps(ev.get("error", ev)))
        except TimeoutError:
            raise TranslatorError(
                f"[{self.lang}] timed out waiting for {wanted}"
            ) from None
        raise TranslatorError(f"[{self.lang}] socket closed waiting for {wanted}")

    async def send_audio(self, pcm16_b64: str) -> None:
        """Forward one mic frame upstream.

        A dead socket drops the frame instead of killing the whole call; the
        pump's final status frame is what tells the browser about the loss.
        """
        if self._ws is None:
            return
        msg = json.dumps(
            {"type": "session.input_audio_buffer.append", "audio": pcm16_b64}
        )
        with contextlib.suppress(websockets.ConnectionClosed):
            await self._ws.send(msg)

    async def pump(self, out: asyncio.Queue[dict[str, str]]) -> None:
        """Fold upstream events into browser frames until the socket ends."""
        if self._ws is None:
            raise TranslatorError(f"[{self.lang}] pump before start")
        with contextlib.suppress(websockets.ConnectionClosed):
            async for raw in self._ws:
                ev = json.loads(raw)
                typ = ev.get("type")
                delta = str(ev.get("delta", ""))
                if typ == "session.output_audio.delta":
                    await out.put({"type": "audio", "lang": self.lang, "pcm16": delta})
                elif typ == "session.output_transcript.delta":
                    await out.put(
                        {"type": "transcript_out", "lang": self.lang, "text": delta}
                    )
                elif typ == "session.input_transcript.delta" and self._emit_input:
                    await out.put({"type": "transcript_in", "text": delta})
                elif typ == "error":
                    await out.put(
                        {
                            "type": "error",
                            "lang": self.lang,
                            "message": json.dumps(ev.get("error", ev)),
                        }
                    )
                elif typ == "session.closed":
                    break
        await out.put({"type": "status", "state": "ended", "lang": self.lang})

    async def send_close(self) -> None:
        """Best-effort session.close; the pump drains whatever follows."""
        if self._ws is None:
            return
        with contextlib.suppress(websockets.ConnectionClosed):
            await self._ws.send(json.dumps({"type": "session.close"}))

    async def drop(self) -> None:
        if self._ws is not None:
            await self._ws.close()


class Relay:
    """Two concurrent sessions (output=pt, output=en) behind one browser socket.

    The first language in LANGS doubles as the designated input-transcript
    source: both sessions hear the same mic feed, so forwarding transcripts
    from both would duplicate every spoken line.
    """

    def __init__(self, key: str, connect: Connect | None = None) -> None:
        self._sessions = [
            TranslationSession(lang, key, connect, emit_input=(i == 0))
            for i, lang in enumerate(LANGS)
        ]
        self._frames: asyncio.Queue[dict[str, str]] = asyncio.Queue()
        self._pumps: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        """Bring both sessions up; raises the first failure after both settle."""
        results = await asyncio.gather(
            *(s.start() for s in self._sessions), return_exceptions=True
        )
        failures = [r for r in results if isinstance(r, BaseException)]
        if failures:
            raise failures[0]
        self._pumps = [
            asyncio.create_task(s.pump(self._frames)) for s in self._sessions
        ]

    async def send_audio(self, pcm16_b64: str) -> None:
        for s in self._sessions:
            await s.send_audio(pcm16_b64)

    async def frames(self) -> AsyncIterator[dict[str, str]]:
        """Merged browser-ready frames from both sessions. Never ends on its
        own; the caller decides when the call is over."""
        while True:
            yield await self._frames.get()

    async def close(self) -> None:
        """Graceful shutdown: session.close both ways, drain until
        session.closed or CLOSE_TIMEOUT (a probe recording proves closed is
        not guaranteed to arrive), then drop the sockets."""
        for s in self._sessions:
            await s.send_close()
        if self._pumps:
            _, pending = await asyncio.wait(self._pumps, timeout=CLOSE_TIMEOUT)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        for s in self._sessions:
            await s.drop()
