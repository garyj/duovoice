# Sther

Real-time English ↔ Portuguese voice translator, built to run alongside a
phone call: speak in one language, the other side hears theirs.

Mid-rewrite: FastAPI relay (`server/`) + Svelte 5 SPA (`frontend/`) targeting
OpenAI's `gpt-realtime-translate`. The plan, architecture, and decisions live
in `docs/plan/rewrite-fastapi-browser-translate.md`.

## Quick start

```bash
just install   # uv sync + npm install + prek hooks
just           # dev stack: api (:8000) + web (:5173) + client watcher + live type-check
just serve     # production mode: build + single-port FastAPI (:8000)
```

Requires `OPENAI_API_KEY` in `.env.local` (see `.env.example`).

## Stack

FastAPI (uv-managed, ruff + ty, prek hooks) · Svelte 5 + Vite + Tailwind 4 +
daisyUI (custom theme) + Bits UI · typed API client generated from the
OpenAPI schema via `@hey-api/openapi-ts` (`just client`).
