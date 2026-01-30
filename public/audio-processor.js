/**
 * AudioWorkletProcessor that captures microphone audio in chunks
 * and posts it to the main thread for encoding and streaming to Gemini.
 *
 * This replaces the deprecated ScriptProcessorNode.
 * It runs in its own thread so it won't cause UI jank.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4096; // Match the old ScriptProcessorNode buffer size
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Copy the input samples into our buffer
    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    // When we have enough samples, send them to the main thread
    if (this._buffer.length >= this._bufferSize) {
      const chunk = new Float32Array(this._buffer.splice(0, this._bufferSize));
      this.port.postMessage({ audioData: chunk }, [chunk.buffer]);
    }

    return true; // Keep the processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
