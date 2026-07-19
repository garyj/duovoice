# Frontend stack research: Svelte UI frameworks + FastAPI `app.frontend()`

Overnight research synthesis (2026-07-19, four research agents: ecosystem survey,
fit deep-dive, GitHub adopter search, web sweep). Written to serve both DuoVoice
and the upcoming real estate project.

## Decision summary

- **DECIDED (garyj, 2026-07-19): daisyUI** - chosen over the shadcn-svelte
  recommendation below for its official MCP server (agent-assisted UI work),
  top maintenance health, and zero-friction fit for a plain Vite SPA. Custom
  theme from day one (not a stock preset) to reach the premium-dark register;
  pair with Bits UI as the behavior layer when the real estate app needs data
  tables/date pickers/comboboxes. The shadcn analysis below is kept for
  reference.
- ~~Component framework: shadcn-svelte (on Bits UI) for both projects.~~
- **DuoVoice frontend: plain Svelte 5 + Vite SPA + Tailwind v4**, served by
  `app.frontend("/", directory="frontend/dist", fallback="index.html")`.
- **FastAPI pinned `>=0.139.1`** (fallback bug with dotted paths fixed there;
  `0.139.0` added dependency support on frontend routes).
- **Real estate project: same component skill set**; Astro + Svelte islands is the
  community-favored shape for content/SEO-heavy sites, with Svelte components
  shared conceptually across both apps.

## Why shadcn-svelte (both UI agents converged independently)

- Svelte 5 runes-native, Tailwind v4-native, very active (8.9k stars, pushed this
  week). The huntabyte stack (shadcn-svelte → Bits UI) is the consensus
  "serious app" tier in 2026 roundups.
- **Copy-in model**: the CLI writes component source into your repo; you own and
  edit it. Best match for the stated goal of learning transferable patterns -
  "you edit the button by editing the button." Skills compound across projects.
- **Best premium-dark aesthetic out of the box** (Linear/Vercel register), which is
  the DuoVoice brief. No runtime style engine, no app shell: a custom waveform
  canvas and Svelte transitions sit alongside it untouched.
- DuoVoice only carries the components it uses (Button, Badge, Scroll Area, maybe
  Dialog) - minimal surface area for a critical live tool.
- Real estate needs are all present: Data Table (TanStack), Pagination, Select,
  Combobox, Slider, Calendar/Date Picker, Card, Carousel, Dialog, forms via
  Formsnap. Charts via LayerChart.
- Theming = CSS-variable token sets; two brands (dark audio / light real estate)
  are two token files. Generator: https://tweakcn.com/
- Official plain-Vite install path (no SvelteKit needed):
  https://www.shadcn-svelte.com/docs/installation/vite - requires wiring the
  `$lib` alias in tsconfig + vite.config.
- Trade-off accepted: no `npm update` for component fixes; re-run `add` and
  reconcile occasionally.

**Runners-up**: Flowbite Svelte if the real estate timeline gets tight (free
DataTables, range datepicker, most pre-built blocks; aesthetic ceiling lower).
Skeleton if a central multi-theme engine ever matters more than bespoke art
direction. daisyUI for fast/cheap marketing surfaces (CSS-only, no behavior).
**Avoid**: SvelteUI (dead, no Svelte 5), Melt UI classic repo (legacy; successor
`melt` has low momentum - Bits UI won the headless tier).

## FastAPI `app.frontend()` - state of the art

- Shipped 0.138.0 (2026-06-20, PR #15800). ~18 real adopters found; **zero using
  Svelte or Astro yet** - we'd be early, with the flagship being PrefectHQ/prefect
  (React). The docs explicitly bless Svelte and Astro.
- It serves a **built static dir only** - no HMR, no dev proxying. Dev mode is two
  processes (uvicorn + vite dev with proxy); `.frontend()` is the production/
  single-port story. This matches the plan doc's topology exactly.
- Semantics worth knowing: path operations always outrank frontend files;
  fallback fires only for GET/HEAD navigation requests with `Accept: text/html`
  (assets still 404 properly); middleware and dependencies apply to frontend
  responses (0.139.0+ → cookie-auth-gated SPAs work).

### Wiring pattern (assembled from adopters)

```python
# server/main.py
app = FastAPI()
# WS route registered normally - ordinary routes outrank the frontend fallback.
# Keep /ws directly on app: prefixed APIRouter WebSocket routes have a
# long-standing prefix bug (fastapi#2634/#2639).

dist = Path(__file__).parent.parent / "frontend" / "dist"
if dist.is_dir():                      # boot-without-build guard (dev/CI safe)
    app.frontend("/", directory=dist, fallback="index.html")
```

```ts
// frontend/vite.config.ts (dev mode)
server: {
  proxy: {
    '/ws': { target: 'ws://localhost:8000', ws: true },
  },
},
```

### Gotchas catalogued (all dodgeable)

1. **Pin `fastapi>=0.139.1`** - earlier, deep links containing a dot broke the SPA
   fallback.
2. **WebSocket + APIRouter prefix bug** - register `/ws` directly on the app.
3. **Vite ws proxy upgrade flakiness** (vitejs/vite#20223 on some versions) -
   "does /ws connect through the dev proxy" is an explicit Phase 1 check.
4. **`check_dir=True` (default) validates at app creation** - guard with
   `is_dir()` (as above) or `check_dir=False` so the API boots without a build.
5. No documented caching story (Cache-Control/ETag) - irrelevant for local use.

### Reference repos (closest to our shape)

- **coloco-kit/coloco** - plain Svelte 5 SPA (not Kit) + Tailwind v4 + FastAPI;
  the exact architecture; its static-serve helper is a one-line swap for
  `app.frontend()`. https://github.com/coloco-kit/coloco
- PrefectHQ/prefect `src/prefect/server/api/server.py` - production-grade
  multi-bundle serving. https://github.com/PrefectHQ/prefect
- getkanchi/kanchi - WS routes + frontend coexistence, runtime config injection.
  https://github.com/getkanchi/kanchi
- twtrubiks/mongo-fastapi-svelte-chat - FastAPI + Svelte 5 WebSocket realtime
  reference (SvelteKit BFF flavor). https://github.com/twtrubiks/mongo-fastapi-svelte-chat

## Svelte vs Astro (for the real estate project)

- Community consensus 2026: Svelte SPA for interactive real-time apps (DuoVoice);
  **Astro for content/SEO-heavy sites** - content collections, zero JS by default.
- **Astro officially supports Svelte 5 components as islands** (@astrojs/svelte v6,
  `client:load`/`client:visible`). One skill set covers both app shapes.
- Both build to static output FastAPI can serve. Config nuance: Svelte SPA wants
  `fallback="index.html"`; Astro builds want `fallback="auto"` or `"404.html"`
  (Astro emits one HTML file per route - an index.html catch-all is wrong there).

## Morning links (click over coffee)

- shadcn-svelte: https://www.shadcn-svelte.com/ · themes
  https://www.shadcn-svelte.com/themes · Vite install
  https://www.shadcn-svelte.com/docs/installation/vite
- tweakcn theme generator: https://tweakcn.com/
- Bits UI: https://www.bits-ui.com/
- Skeleton: https://www.skeleton.dev/ · Flowbite: https://flowbite-svelte.com/ ·
  daisyUI: https://daisyui.com/
- app.frontend() tutorial: https://fastapi.tiangolo.com/tutorial/frontend/
- coloco (closest reference): https://github.com/coloco-kit/coloco
