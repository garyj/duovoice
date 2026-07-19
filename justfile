# default: run the full dev stack
_default:
    just dev

# install all dependencies defined in pyproject.toml and package.json
install:
    uv sync
    npm --prefix frontend install

# run api + frontend + client-regen watcher together (Ctrl-C stops all)
dev:
    ./frontend/node_modules/.bin/concurrently -k \
        -n api,web,client -c cyan,green,magenta \
        "just api" "just web" "just watch-client"

# run the FastAPI dev server alone (:8000, auto-reload on python changes)
api:
    uv run uvicorn server.main:app --port 8000 --reload

# run the Vite dev server alone (:5173, HMR, proxies /api and /ws to :8000)
web:
    cd frontend && npm run dev

# regenerate the typed TS client from the FastAPI schema (one-shot)
client:
    cd frontend && npm run generate-client

# regenerate the client automatically whenever server/ changes
watch-client:
    uv run watchfiles 'just client' server

# type-check the frontend (svelte-check + tsc)
check:
    cd frontend && npm run check

# production build of the frontend
build:
    cd frontend && npm run build

# serve the production build single-port from FastAPI (:8000)
serve: build
    uv run uvicorn server.main:app --port 8000
