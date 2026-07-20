"""FastAPI app: the two-session translation relay behind /ws.

URL ownership convention: /api/* and /ws belong to this server; every other
path belongs to the frontend. Path operations are always checked before the
frontend fallback, so the API can never be shadowed by a static file.
"""

import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from server.translator import Relay

_root = Path(__file__).resolve().parent.parent
load_dotenv(_root / ".env.local")
load_dotenv(_root / ".env")

# servers drives the generated client's baseUrl; "/" keeps requests same-origin
# relative so the client works in dev (via the Vite proxy) and prod unchanged.
app = FastAPI(servers=[{"url": "/"}])


class HelloReply(BaseModel):
    message: str
    docs_url: str


@app.get("/api/hello", operation_id="getHello")
async def hello() -> HelloReply:
    return HelloReply(message="Hello from FastAPI", docs_url="see /docs")


async def _forward_frames(relay: Relay, websocket: WebSocket) -> None:
    async for frame in relay.frames():
        await websocket.send_json(frame)


@app.websocket("/ws")
async def ws_translate(websocket: WebSocket) -> None:
    # Registered directly on app, not a prefixed APIRouter: prefixed routers
    # historically drop their prefix on websocket routes (fastapi#2634).
    await websocket.accept()
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        await websocket.send_json(
            {"type": "error", "message": "OPENAI_API_KEY is not set on the server"}
        )
        await websocket.close()
        return

    relay = Relay(key)
    forward: asyncio.Task[None] | None = None
    try:
        try:
            await relay.start()
        except Exception as exc:  # any upstream failure ends this call cleanly
            await websocket.send_json({"type": "error", "message": str(exc)})
            await websocket.close()
            return
        await websocket.send_json({"type": "status", "state": "ready"})
        forward = asyncio.create_task(_forward_frames(relay, websocket))
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get("type") == "audio":
                await relay.send_audio(str(msg.get("pcm16", "")))
    except WebSocketDisconnect:
        pass
    finally:
        if forward is not None:
            forward.cancel()
            # gather (not await) so whatever ended the task - cancellation or
            # a send on the already-closed browser socket - stays contained.
            await asyncio.gather(forward, return_exceptions=True)
        await relay.close()


# Frontend build, served single-port in production. The is_dir() guard lets the
# API boot in dev/CI before any frontend build exists.
_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.is_dir():
    app.frontend("/", directory=_dist, fallback="index.html")
