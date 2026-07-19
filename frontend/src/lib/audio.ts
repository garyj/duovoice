/**
 * Audio pipeline + WebSocket client for the translation relay behind /ws.
 *
 * Capture: getUserMedia → 24 kHz AudioContext → audio-processor worklet
 * (Float32→Int16 off the main thread) → base64 → relay. echoCancellation is
 * load-bearing: it is what stops the mic from hearing this page's own output
 * (plan "Audio topology"; empirically confirmed the hard way in issue #3).
 *
 * Playback: the relay forwards both sessions' continuous output streams,
 * silence padding included, so frames are energy-gated here and only speech
 * is scheduled, as chained AudioBufferSources on the same 24 kHz context.
 *
 * The audio pipeline and the WebSocket have separate lifecycles (setupAudio /
 * connect) so a future reconnect never re-prompts for the mic - the pattern
 * from docs/solutions/performance-issues/audio-pipeline-latency-optimization-*.
 */

const SAMPLE_RATE = 24_000
// Same threshold the server tooling uses: silence frames are all-zero,
// real speech runs into the 1000s (int16 RMS).
const SPEECH_RMS = 200

/** Non-audio frames from the relay, forwarded to the UI verbatim. */
export type RelayFrame =
  | { type: 'transcript_in'; text: string }
  | { type: 'transcript_out'; lang: string; text: string }
  | { type: 'status'; state: string; lang?: string }
  | { type: 'error'; message: string; lang?: string }

type ServerFrame = RelayFrame | { type: 'audio'; lang: string; pcm16: string }

export class TranslatorSession {
  onframe: (frame: RelayFrame) => void = () => {}
  /** Fires when the relay socket closes after a successful start. */
  onclose: () => void = () => {}

  private ctx: AudioContext | null = null
  private mic: MediaStream | null = null
  private ws: WebSocket | null = null
  private ready = false
  private stopped = false
  private nextPlayTime = 0

  /** Mic + worklet + socket; resolves once the relay reports ready.
   * A session is one-shot: once stopped it cannot be started again. */
  async start(): Promise<void> {
    try {
      if (this.stopped) throw new Error('session already stopped')
      await this.setupAudio()
      // stop() may have run while getUserMedia was pending; re-running it
      // releases the mic that was acquired after the fact.
      if (this.stopped) throw new Error('session stopped during setup')
      await this.connect()
    } catch (err) {
      this.stop()
      throw err
    }
  }

  stop(): void {
    this.stopped = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.mic?.getTracks().forEach((track) => track.stop())
    this.mic = null
    void this.ctx?.close()
    this.ctx = null
    this.ready = false
    this.nextPlayTime = 0
  }

  private async setupAudio(): Promise<void> {
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: SAMPLE_RATE },
      },
    })
    // The context runs at the endpoint's native rate, so the worklet never
    // resamples; the browser resamples the hardware stream into the context.
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    await ctx.audioWorklet.addModule('/audio-processor.js')
    const source = ctx.createMediaStreamSource(this.mic)
    const node = new AudioWorkletNode(ctx, 'audio-capture-processor')
    node.port.onmessage = (event: MessageEvent<{ pcmData: Uint8Array }>) => {
      this.sendAudio(event.data.pcmData)
    }
    source.connect(node)
    this.ctx = ctx
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${scheme}://${location.host}/ws`)
      ws.onmessage = (event: MessageEvent<string>) => {
        const frame = JSON.parse(event.data) as ServerFrame
        if (frame.type === 'audio') {
          this.schedule(frame.pcm16)
        } else if (!this.ready) {
          // Only two frames can precede ready: the ready status or a fatal
          // error (missing key, upstream failure).
          if (frame.type === 'status' && frame.state === 'ready') {
            this.ready = true
            resolve()
          } else {
            reject(new Error(frame.type === 'error' ? frame.message : JSON.stringify(frame)))
          }
        } else {
          this.onframe(frame)
        }
      }
      ws.onclose = () => {
        if (!this.ready) reject(new Error('relay connection closed before ready'))
        else if (!this.stopped) this.onclose()
      }
      this.ws = ws
    })
  }

  private sendAudio(pcm: Uint8Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'audio', pcm16: encodeBase64(pcm) }))
  }

  private schedule(pcm16: string): void {
    const ctx = this.ctx
    if (!ctx) return
    const samples = decodePcm16(pcm16)
    if (rms(samples) <= SPEECH_RMS) return
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    // Chain frames back to back; when the chain has lapsed (a silence gap),
    // restart slightly ahead of now so the frame's onset isn't clipped.
    this.nextPlayTime = Math.max(this.nextPlayTime, ctx.currentTime + 0.06)
    source.start(this.nextPlayTime)
    this.nextPlayTime += buffer.duration
  }
}

// Chunked conversion: avoids O(n²) string building on the per-chunk hot path
// (latency doc §7).
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

function decodePcm16(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1)
}

function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const s of samples) sum += s * s
  return Math.sqrt(sum / samples.length)
}
