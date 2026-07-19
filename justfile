# default: run the full dev stack
_default:
    just dev

# install all dependencies defined in pyproject.toml and package.json
install:
    uv sync
    npm --prefix frontend install
    uv run prek install

# run api + frontend + client-regen watcher + live type-check (Ctrl-C stops all)
dev:
    ./frontend/node_modules/.bin/concurrently -k \
        -n api,web,client,check -c cyan,green,magenta,red \
        "just api" "just web" "just watch-client" "just check-watch"

# regenerate the client on server/ changes; each run completes before the
# next starts (see server/watch_client.py — safe, unlike the watchfiles CLI)
watch-client:
    uv run python -m server.watch_client

# continuously type-check the frontend as files change
check-watch:
    cd frontend && npx svelte-check --tsconfig ./tsconfig.app.json --watch

# run the FastAPI dev server alone (:8000, auto-reload on python changes)
api:
    uv run uvicorn server.main:app --port 8000 --reload

# run the Vite dev server alone (:5173, HMR, proxies /api and /ws to :8000)
web:
    cd frontend && npm run dev

# regenerate the typed TS client from the FastAPI schema (one-shot)
client:
    cd frontend && npm run generate-client

# type-check the frontend (svelte-check + tsc)
check:
    cd frontend && npm run check

# production build of the frontend
build:
    cd frontend && npm run build

# serve the production build single-port from FastAPI (:8000)
serve: build
    uv run uvicorn server.main:app --port 8000

# stream a fixture WAV through one real translation session (hits the paid API)
# e.g. just probe --fixture fixtures/en_greeting.wav --target pt --runs 3
probe *ARGS:
    uv run python -m server.probe {{ARGS}}

# (re)generate the interim TTS probe fixtures (calls OpenAI TTS, a few cents)
fixtures:
    uv run python fixtures/generate.py

# run the python test suite (offline; no paid API)
test:
    uv run pytest
