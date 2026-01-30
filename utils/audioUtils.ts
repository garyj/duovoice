import { BlobData } from '../types';

// Decodes base64 string to Uint8Array
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Encodes Uint8Array to base64 string
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Decodes raw PCM data into an AudioBuffer
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Simple linear interpolation downsampler
function downsampleTo16k(buffer: Float32Array, inputRate: number): Float32Array {
  if (!inputRate || inputRate <= 0 || buffer.length === 0) return buffer;
  if (inputRate === 16000) return buffer;
  
  const outputRate = 16000;
  const ratio = inputRate / outputRate;
  
  if (ratio <= 0) return buffer;

  const newLength = Math.ceil(buffer.length / ratio);
  if (newLength === 0) return new Float32Array(0);
  
  const result = new Float32Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const originalIndex = i * ratio;
    const index1 = Math.floor(originalIndex);
    const index2 = Math.min(index1 + 1, buffer.length - 1);
    const fraction = originalIndex - index1;
    
    // Linear interpolation
    result[i] = buffer[index1] * (1 - fraction) + buffer[index2] * fraction;
  }
  
  return result;
}

// Converts Float32 input from microphone to Int16 PCM base64 blob for Gemini
export function createPcmBlob(data: Float32Array, inputSampleRate: number): BlobData {
  const rate = (inputSampleRate && inputSampleRate > 0) ? inputSampleRate : 16000;
  const downsampledData = downsampleTo16k(data, rate);
  
  const l = downsampledData.length;
  const int16 = new Int16Array(l);
  
  for (let i = 0; i < l; i++) {
    // Hard clamp values to prevent overflows that cause network glitches
    let s = downsampledData[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  return {
    data: encodeBase64(new Uint8Array(int16.buffer)),
    mimeType: "audio/pcm;rate=16000",
  };
}
