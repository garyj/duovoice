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
- Chrome's WebRTC echo cancellation reduces interpreter audio returning as a
  new user turn, while the browser retains control of response creation.
- Each browser supplies its own OpenAI API key and negotiates the WebRTC session
  directly with OpenAI.

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

Start the local Vite server:

```bash
npm run dev
```

Open `http://localhost:3000`, save your OpenAI API key in the page, allow
microphone access, and select **Start listening**.

The key is stored in that browser's local storage and sent only to OpenAI when
the browser creates a Realtime session. Clearing site data or selecting
**Clear** removes it. This is a deliberate personal-tool tradeoff, not an
encrypted credential store.

## Cloudflare Pages deployment

Sther is a static Vite app. Configure Cloudflare Pages to run `npm run build`
and publish `dist`. There is no server-side key or Worker. Each visitor supplies
their own key in their own browser.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the local Vite development server |
| `npm run typecheck` | Run strict TypeScript 7 checks |
| `npm run lint` | Run Biome CI checks |
| `npm run format` | Apply Biome formatting and safe fixes |
| `npm test` | Run the Vitest suite once |
| `npm run build` | Create the Vite production build |
| `npm run verify` | Run typecheck, lint, tests, and build |

## Cost

`gpt-realtime-2.1` is billed from realtime audio and text tokens. Cost therefore
depends on turn length, conversation history, and cache use rather than a fixed
per-minute translation rate. Check the
[current OpenAI pricing](https://developers.openai.com/api/docs/pricing#audio-tokens)
before sustained use.

## License

[MIT](LICENSE)
