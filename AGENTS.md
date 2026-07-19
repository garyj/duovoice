# AGENTS.md

Your name on this project is **Papagaio** (the bilingual parrot). CLAUDE.md
symlinks here; keep it that way.

## What This Is

DuoVoice: a real-time English ↔ Portuguese voice translator. It is the primary
way garyj communicates with his friend across a language barrier, typically
running alongside a WhatsApp call on his iPhone (computer mic hears both
speakers; computer speakers carry both translations). This is a critical
communication tool - change carefully, verify thoroughly.

The repo is mid-rewrite on branch `fastapi-rewrite`:

- **New app**: `server/` (FastAPI relay) + `frontend/` (Svelte 5 + Vite SPA).
- **Legacy app**: the React + Gemini files at the repo root are superseded and
  slated for deletion (pending garyj's approval). Don't extend them.

Read `docs/plan/rewrite-fastapi-browser-translate.md` first - architecture,
verified API shape, audio topology, phases, deployment/BYOK memo.
`docs/plan/frontend-stack-research.md` holds the UI framework research
(shadcn-svelte recommended).

## Commands (the justfile is the interface)

```bash
just install   # uv sync + npm install + prek hooks
just           # dev stack: api (:8000) + web (:5173) + client watcher + live check
just client    # regenerate the typed TS client from the FastAPI schema
just check     # one-shot svelte-check + tsc (the definitive answer)
just serve     # production mode: build + single-port FastAPI (:8000)
```

Env: `OPENAI_API_KEY` in `.env.local`, server-side only (BYOK relay planned
for public deploys - see plan doc).

## Architecture

Browser is a dumb terminal (mic capture, playback, transcripts). FastAPI is
the brain: it will hold two concurrent `gpt-realtime-translate` WebSocket
sessions (one per direction) fed the same mic audio. `/ws` is currently an
echo placeholder - the relay is the next build phase.

Dev mode: Vite (:5173) proxies `/api` and `/ws` to uvicorn (:8000). Prod:
`app.frontend()` serves `frontend/dist` single-port.

## The schema → client loop (core invariant)

FastAPI's OpenAPI schema → `@hey-api/openapi-ts` → `frontend/src/client/`.

- `frontend/src/client/` is **generated - never hand-edit** (hooks exclude it).
- API contract changed? `just client`, or let the `just dev` watcher do it.
  The pre-commit hook regenerates whenever `server/` files are committed and
  blocks the commit on drift.
- `server/watch_client.py` uses watchfiles as a **library** (blocking
  generator: runs complete, events coalesce). Never switch it to the
  watchfiles CLI - that's a kill-and-restart supervisor and corrupts
  mid-write generation.
- Vite never type-checks. Truth comes from `just check` / the `[check]`
  stream / the editor. After a regen the Svelte language server occasionally
  holds stale types - "Svelte: Restart Language Server" fixes it.

## Toolchain

uv-managed; ruff + ty (not mypy) + hygiene hooks run via **prek**
(`.pre-commit-config.yaml`, adapted from fastapi/full-stack-fastapi-template).
`fastapi>=0.139.1` is pinned deliberately (SPA-fallback dotted-path fix).

## Gotchas that have already cost us once

- WebSocket routes go directly on `app`, never on a prefixed APIRouter
  (fastapi#2634 drops the prefix).
- `FastAPI(servers=[{"url": "/"}])` drives the generated client's baseUrl -
  don't remove it.
- `app.frontend()`'s SPA fallback fires only for GET with `Accept:
  text/html`; a curl 404 on a page path is correct behaviour, not a bug.
- garyj usually has `just` running in his own terminal: never start a
  competing stack on ports 8000/5173, and never `pkill -f` with a broad
  pattern on this machine.

## Legacy app notes

`docs/solutions/performance-issues/audio-pipeline-latency-optimization-*.md`
remains authoritative for porting `public/audio-processor.js` (pre-allocated
ring buffer - keep it a typed array; retarget 16 kHz → 24 kHz; browser echo
cancellation is load-bearing for the feedback-loop design).
