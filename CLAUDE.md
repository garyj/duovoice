# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

DuoVoice Live is a real-time bilingual voice translator for English ↔ Portuguese conversations. It captures microphone audio, streams it to Google Gemini 2.5 Flash native audio, and plays back the translated speech. This is a critical communication tool, it's the primary way the developer communicates with their friend across a language barrier (typically over WhatsApp calls with this app running alongside). Changes must be made carefully and tested thoroughly to avoid breaking live conversations.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:3000 (binds 0.0.0.0)
npm run build     # Production build to /dist
npm run preview   # Preview production build
```

No test or lint tooling is configured.

## Environment Setup

Requires `GEMINI_API_KEY` in `.env.local`. Vite injects it via `vite.config.ts` as both `process.env.API_KEY` and `process.env.GEMINI_API_KEY`.

## Architecture

### Core Flow

```
Microphone → AudioWorklet (downsample to 16kHz PCM) → Gemini streaming → Translated audio playback
```

**App.tsx** (~560 lines) is the central orchestrator. It manages two independent lifecycles:

1. **Audio pipeline** — mic capture, AudioWorklet, input/output AudioContexts, analyzers, gain nodes. Expensive to set up (mic permissions, worklet loading). Persists across Gemini reconnects.
2. **Gemini session** — WebSocket connection to `gemini-2.5-flash-native-audio-preview-09-2025`. Cheap to reconnect. Wired to the audio pipeline via the worklet's `port.onmessage`.

This separation means Gemini reconnects (health timeout, network blip) are fast — the audio pipeline stays alive.

### AudioWorklet (`public/audio-processor.js`)

Runs on a dedicated real-time thread. Uses a pre-allocated ring buffer (Float32Array(2048)) to avoid GC pauses. Performs downsampling (linear interpolation to 16kHz) and Float32→Int16 PCM conversion on the worklet thread, keeping the main thread free.

Buffer size of 2048 samples = ~42ms latency at 48kHz input. This is a deliberate tradeoff — smaller buffers increase CPU overhead, larger ones add perceptible delay.

### Performance-Critical Patterns

- **DOM refs for partial transcriptions**: Gemini sends 10-30 partial transcription updates per second during speech. These update DOM directly via refs, bypassing React re-renders entirely. Only final transcriptions commit to React state.
- **Cached resolved session ref** (`resolvedSessionRef`): The Gemini session promise is resolved once and cached, eliminating promise microtask overhead on every audio chunk.
- **Chunked base64 encoding**: Prevents O(n²) string concatenation in `encodeBase64`.
- **Health monitoring**: Checks every 5s, reconnects Gemini if no response in 15s (detects silent WebSocket failures).

### Components

- **AudioVisualizer.tsx** — Canvas-based frequency spectrum, used for both input and output audio
- **ChatMessage.tsx** — Message bubble with partial/final state display
- **Sidebar.tsx** — Conversation history and session switching

### Types (`types.ts`)

Defines `ConnectionState` (DISCONNECTED/CONNECTING/CONNECTED/ERROR), `Message`, `BlobData`, `ChatSession`.

### Audio Configuration

- Input: echoCancellation, noiseSuppression, autoGainControl enabled; ideal 16kHz mono
- Output: 24kHz AudioContext, mono, through GainNode for volume control
- Gemini voice: "Kore", audio-only response modality

## Key Constraints

- The system instruction tells Gemini to ONLY translate, never respond conversationally. Do not modify this behavior.
- Two separate AudioContexts (input at mic sample rate, output at 24kHz) — do not merge them.
- The audio pipeline / Gemini session lifecycle separation is intentional for fast reconnects. Do not couple them.
- Ring buffer in the worklet must remain a pre-allocated typed array (no JS arrays, no push/shift) to prevent GC clicks in real-time audio.

## Documentation

`docs/solutions/performance-issues/audio-pipeline-latency-optimization-20260131.md` contains a detailed write-up of all latency optimizations applied, including before/after analysis. Consult this before making audio pipeline changes.
