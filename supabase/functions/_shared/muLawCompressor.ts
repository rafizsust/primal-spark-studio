/**
 * Mu-Law (G.711) Audio Compression for Edge Functions
 * 
 * Converts 16-bit linear PCM to 8-bit Mu-Law format.
 * Benefits:
 * - 50% file size reduction (16-bit → 8-bit)
 * - Very fast (simple formula, no CPU-heavy encoding)
 * - Wide browser compatibility (WAV with Mu-Law is well-supported)
 * - Perfect for speech audio (designed for voice telephony)
 */

const BIAS = 0x84;  // 132
const CLIP = 32635; // Maximum amplitude for 14-bit precision

/**
 * Convert a single 16-bit linear sample to 8-bit Mu-Law
 * Uses the standard G.711 algorithm without lookup tables for reliability
 */
function linearToMuLaw(sample: number): number {
  // Get sign bit
  const sign = (sample < 0) ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  
  // Clip to maximum
  if (sample > CLIP) sample = CLIP;
  
  // Add bias for better dynamic range
  sample += BIAS;
  
  // Find the segment (exponent) - count leading zeros
  let exponent = 7;
  let expMask = 0x4000;
  while ((sample & expMask) === 0 && exponent > 0) {
    exponent--;
    expMask >>= 1;
  }
  
  // Extract 4-bit mantissa from the appropriate position
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  
  // Combine and invert (Mu-Law uses inverted bits for better transmission)
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

/**
 * Convert 16-bit PCM audio to 8-bit Mu-Law
 * @param pcmBytes - Raw 16-bit PCM data (little-endian)
 * @returns 8-bit Mu-Law encoded data
 */
export function pcmToMuLaw(pcmBytes: Uint8Array): Uint8Array {
  const numSamples = Math.floor(pcmBytes.length / 2);
  const muLawBytes = new Uint8Array(numSamples);
  
  for (let i = 0; i < numSamples; i++) {
    // Read 16-bit little-endian sample
    const low = pcmBytes[i * 2];
    const high = pcmBytes[i * 2 + 1];
    const sample = (high << 8) | low;
    // Convert to signed
    const signedSample = sample < 32768 ? sample : sample - 65536;
    
    muLawBytes[i] = linearToMuLaw(signedSample);
  }
  
  return muLawBytes;
}

/**
 * Create a WAV file with Mu-Law encoded audio
 * WAV Header for Mu-Law:
 * - AudioFormat: 7 (Mu-Law)
 * - BitsPerSample: 8
 * 
 * @param pcmBytes - Raw 16-bit PCM data (little-endian)
 * @param sampleRate - Sample rate (typically 24000 for Gemini TTS)
 * @returns Complete WAV file with Mu-Law audio
 */
export function createMuLawWav(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  // Convert PCM to Mu-Law
  const muLawData = pcmToMuLaw(pcmBytes);
  
  const numChannels = 1;        // Mono
  const bitsPerSample = 8;      // 8-bit Mu-Law
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = muLawData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;
  
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  
  // Write string helper
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeString(8, "WAVE");
  
  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);         // Chunk size
  view.setUint16(20, 7, true);          // AudioFormat: 7 = Mu-Law
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  
  // Copy Mu-Law audio data
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(muLawData, headerSize);
  
  return wavBytes;
}

/**
 * Convert base64 PCM to Mu-Law WAV
 * Convenience function for edge function use
 */
export function pcmBase64ToMuLawWav(pcmBase64: string, sampleRate: number): Uint8Array {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  return createMuLawWav(pcmBytes, sampleRate);
}
