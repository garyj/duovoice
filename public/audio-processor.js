/**
 * AudioWorkletProcessor that captures microphone audio in chunks,
 * downsamples to 16kHz, and converts to Int16 PCM before posting
 * to the main thread.
 *
 * Uses a pre-allocated ring buffer to avoid GC pressure on the
 * real-time audio thread. All per-chunk DSP runs here so the
 * main thread only needs to base64-encode and send.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 2048;
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
    // sampleRate is a read-only global in AudioWorkletGlobalScope
    this._inputRate = sampleRate;
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
   * Downsample the float buffer to 16kHz and convert to Int16 PCM.
   * Returns a Uint8Array view over the Int16 data for transferability.
   */
  _processChunk() {
    const inputRate = this._inputRate;
    let samples;

    if (inputRate === 16000) {
      samples = this._buffer;
    } else {
      const ratio = inputRate / 16000;
      const newLength = Math.ceil(this._bufferSize / ratio);
      samples = new Float32Array(newLength);

      for (let i = 0; i < newLength; i++) {
        const pos = i * ratio;
        const idx = Math.floor(pos);
        const next = Math.min(idx + 1, this._bufferSize - 1);
        const frac = pos - idx;
        samples[i] = this._buffer[idx] * (1 - frac) + this._buffer[next] * frac;
      }
    }

    // Float32 → Int16 PCM with hard clamp
    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      let s = samples[i];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return new Uint8Array(int16.buffer);
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
