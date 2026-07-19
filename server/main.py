"""Minimal FastAPI + Svelte interaction demo.

URL ownership convention: /api/* and /ws belong to this server; every other
path belongs to the frontend. Path operations are always checked before the
frontend fallback, so the API can never be shadowed by a static file.
"""

from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

# servers drives the generated client's baseUrl; "/" keeps requests same-origin
# relative so the client works in dev (via the Vite proxy) and prod unchanged.
app = FastAPI(servers=[{"url": "/"}])


class HelloReply(BaseModel):
    message: str
    docs_url: str


@app.get("/api/hello", operation_id="getHello")
async def hello() -> HelloReply:
    return HelloReply(message="Hello from FastAPI", docs_url="see /docs")


@app.websocket("/ws")
async def ws_echo(websocket: WebSocket) -> None:
    # Registered directly on app, not a prefixed APIRouter: prefixed routers
    # historically drop their prefix on websocket routes (fastapi#2634).
    await websocket.accept()
    try:
        while True:
            text = await websocket.receive_text()
            await websocket.send_text(f"echo: {text}")
    except WebSocketDisconnect:
        pass


# Frontend build, served single-port in production. The is_dir() guard lets the
# API boot in dev/CI before any frontend build exists.
_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.is_dir():
    app.frontend("/", directory=_dist, fallback="index.html")
