# Sther

Live English and Brazilian Portuguese speech translation in a desktop browser.
Sther captures one shared microphone and sends it to two independent OpenAI
translation sessions, one for each output language.

The page is intentionally small. It has Start and Stop controls, a connection
status, live text in both languages, and native WebRTC audio playback.

## How it works

```text
                                  ┌─ gpt-realtime-translate → Portuguese
Microphone → two WebRTC sessions ─┤
                                  └─ gpt-realtime-translate → English
```

- Chrome captures one 48 kHz microphone track with echo cancellation, noise
  suppression, and automatic gain control.
- The same track is attached to two `RTCPeerConnection` instances.
- Each translated remote stream plays through its own native `<audio>` element.
- One session also runs `gpt-realtime-whisper` for the English source
  transcript.
- A small Cloudflare Worker keeps the standard API key server-side and returns
  short-lived client secrets to the browser.

See [the architecture note](docs/architecture/realtime-translation.md) for the
protocol, limits, measured latency, pricing, and acoustic test results.

## Local setup

Requirements:

- Node.js 24
- A standard [OpenAI API key](https://platform.openai.com/api-keys)
- Desktop Chrome with microphone access

Install dependencies:

```bash
npm install
```

Create Wrangler's ignored local secret file:

```bash
cp .env.example .dev.vars
```

Set `OPENAI_API_KEY` in `.dev.vars`. If the key already lives in an ignored
`.env.local`, a local symlink also works:

```bash
ln -s .env.local .dev.vars
```

Start the production build through the local Cloudflare Worker:

```bash
npm run dev
```

Open `http://localhost:3000`, allow microphone access, and select **Start
listening**.

The standard API key never enters the browser bundle, browser storage, request
logs, or page UI.

## Cloudflare deployment

The same Worker serves Vite's static output and runs first for `/api/*`.
Configure the production secret once:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Build and deploy:

```bash
npm run deploy
```

`wrangler.jsonc` contains the Worker and static-assets configuration. Production
deployment is intentionally a user-run operation because it changes external
state.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build and run the complete app locally through Wrangler |
| `npm run typecheck` | Run strict TypeScript 7 checks |
| `npm run lint` | Run Biome CI checks |
| `npm run format` | Apply Biome formatting and safe fixes |
| `npm test` | Run the Vitest suite once |
| `npm run build` | Create the Vite production build |
| `npm run verify` | Run typecheck, lint, tests, and build |
| `npm run deploy` | Build and deploy the Cloudflare Worker |

## Current operating cost

OpenAI currently lists USD 0.034 per translation audio minute and USD 0.017 per
transcription audio minute. Two translation sessions and one transcription
session cost about USD 0.085 per wall-clock minute, or USD 5.10 per hour, while
listening continuously.

## License

[MIT](LICENSE)
