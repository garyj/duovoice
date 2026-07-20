# Sther

Live English and Brazilian Portuguese interpretation in a desktop browser.
Sther listens to the conversation through one microphone and uses one OpenAI
Realtime session to translate each spoken turn into the other language.

The page is intentionally small. It has Start and Stop controls, a connection
status, the speech that was heard, the latest translations, and native WebRTC
audio playback.

## How it works

```text
Microphone → one gpt-realtime-2.1 WebRTC session → opposite-language speech
```

- Chrome captures one microphone track with echo cancellation, noise
  suppression, and automatic gain control.
- A single conversation session identifies whether each turn is English or
  Brazilian Portuguese and interprets it into the other language.
- Semantic VAD determines when each speaker has finished. The browser decides
  whether that turn is genuine before requesting a response.
- `gpt-realtime-whisper` supplies the source transcript.
- The remote stream plays through one native `<audio>` element.
- The microphone remains live during translated audio. New speech interrupts
  and truncates the current translation so conversation can continue naturally.
- Chrome's WebRTC echo cancellation prevents interpreter audio from becoming a
  new user turn, while the browser retains control of response creation.
- A small Cloudflare Worker proxies the WebRTC offer to OpenAI so the standard
  API key remains server-side.

See [the architecture note](docs/architecture/realtime-translation.md) for the
failed dual-session design, the replacement decision, protocol details, and
test evidence.

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

## Cost

`gpt-realtime-2.1` is billed from realtime audio and text tokens. Cost therefore
depends on turn length, conversation history, and cache use rather than a fixed
per-minute translation rate. Check the
[current OpenAI pricing](https://developers.openai.com/api/docs/pricing#audio-tokens)
before sustained use.

## License

[MIT](LICENSE)
