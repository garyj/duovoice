/**
 * AudioWorkletProcessor that captures microphone audio in ~42 ms chunks and
 * converts Float32 → Int16 PCM before posting to the main thread.
 *
 * The AudioContext that loads this worklet runs at 24 kHz (the translation
 * endpoint's native rate), so no resampling happens here - the browser
 * resamples the hardware stream into the context. `sampleRate` is asserted,
 * not adapted: a mismatch is a bug in the context setup, not a case to
 * handle silently.
 *
 * Uses a pre-allocated ring buffer to avoid GC pressure on the real-time
 * audio thread (see docs/solutions/performance-issues/
 * audio-pipeline-latency-optimization-20260131.md). All per-chunk DSP runs
 * here so the main thread only needs to base64-encode and send.
 */
const TARGET_RATE = 24000;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 1024; // ~42 ms at 24 kHz
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
    // sampleRate is a read-only global in AudioWorkletGlobalScope
    if (sampleRate !== TARGET_RATE) {
      throw new Error(`audio-processor expects a ${TARGET_RATE} Hz context, got ${sampleRate}`);
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    let offset = 0;

    while (offset < channelData.length) {
      const remaining = this._bufferSize - this._writeIndex;
      const toCopy = Math.min(remaining, channelData.length - offset);

      this._buffer.set(channelData.subarray(offset, offset + toCopy), this._writeIndex);
      this._writeIndex += toCopy;
      offset += toCopy;

      if (this._writeIndex >= this._bufferSize) {
        const pcmData = this._processChunk();
        this.port.postMessage({ pcmData }, [pcmData.buffer]);
        this._writeIndex = 0;
      }
    }

    return true;
  }

  /**
   * Convert the float buffer to Int16 PCM with a hard clamp.
   * Returns a Uint8Array view over the Int16 data for transferability.
   */
  _processChunk() {
    const int16 = new Int16Array(this._bufferSize);
    for (let i = 0; i < this._bufferSize; i++) {
      let s = this._buffer[i];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return new Uint8Array(int16.buffer);
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
