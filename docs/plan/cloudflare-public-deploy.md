# Cloudflare Public Deployment Plan (Checklist)

## Goal
Deploy as a static Cloudflare Pages site using client-entered keys stored in localStorage, while keeping localhost dev fallback via `.env.local`.

## Checklist
- [ ] Add client key storage utility (localStorage + availability check)
- [ ] Wire runtime keys into Gemini/OpenAI connection logic
- [ ] Preserve localhost `.env.local` fallback (dev only)
- [ ] Remove baked secrets from production build output
- [ ] Add Settings panel UI (key entry, show/hide, save/forget, disclosure note)
- [ ] Update README for public deployment + localStorage note
- [ ] Update `.env.example` to clarify dev-only usage
- [ ] Run build locally and verify no keys are baked
- [ ] Browser UI check (agent-browser): layout, settings, mic button

## Notes / Decisions
- Storage: localStorage with explicit disclosure.
- Deployment: static only (no backend/proxy).
- UX: Settings panel in header.
- Local dev: `.env.local` fallback preserved (dev server only).

## Manual Test Scenarios
1. Start dev server, open UI, verify Settings panel and styling.
2. Enter Gemini/OpenAI keys, refresh, confirm persistence.
3. Forget keys and confirm errors for missing provider keys.
4. Click microphone button and confirm permissions flow.
5. Toggle Low Latency and reconnect behavior remains stable.

## Assumptions
- User will authorize microphone access during UI test.
- Production builds should not include any API key material.
