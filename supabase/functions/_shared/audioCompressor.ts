/**
 * Server-side audio compression utility for Supabase Edge Functions.
 * Converts PCM/WAV audio to compressed MP3 format using lamejs.
 * Optimized for speech audio: 22kHz mono @ 32kbps (80-90% size reduction).
 */

// Import lamejs from esm.sh
import lamejs from "https://esm.sh/@breezystack/lamejs@1.2.7";

/**
 * Compress PCM audio data to MP3
 * @param pcmBytes - Raw PCM audio data (16-bit signed, mono)
 * @param sampleRate - Input sample rate (typically 24000 for TTS)
 * @returns Compressed MP3 as Uint8Array
 */
export function compressPcmToMp3(
  pcmBytes: Uint8Array,
  sampleRate: number = 24000
): Uint8Array {
  const targetSampleRate = 22050; // 22kHz is sufficient for speech
  const kbps = 32; // 32kbps mono is good quality for speech

  // PCM is 16-bit samples (2 bytes per sample)
  const numSamples = pcmBytes.length / 2;

  // Convert bytes to Int16 samples
  const originalSamples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    // Little-endian 16-bit signed
    originalSamples[i] = pcmBytes[i * 2] | (pcmBytes[i * 2 + 1] << 8);
  }

  // Resample to target rate for better compression
  const resampleRatio = sampleRate / targetSampleRate;
  const resampledLength = Math.ceil(numSamples / resampleRatio);
  const resampledSamples = new Int16Array(resampledLength);

  // Simple linear interpolation resampling
  for (let i = 0; i < resampledLength; i++) {
    const srcIndex = i * resampleRatio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, numSamples - 1);
    const t = srcIndex - srcIndexFloor;
    resampledSamples[i] = Math.round(
      originalSamples[srcIndexFloor] * (1 - t) + originalSamples[srcIndexCeil] * t
    );
  }

  // Create MP3 encoder
  const mp3encoder = new lamejs.Mp3Encoder(1, targetSampleRate, kbps);
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152;

  // Encode in chunks
  let remaining = resampledSamples.length;
  let offset = 0;

  while (remaining >= sampleBlockSize) {
    const chunk = resampledSamples.subarray(offset, offset + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
    remaining -= sampleBlockSize;
    offset += sampleBlockSize;
  }

  // Handle remaining samples
  if (remaining > 0) {
    const chunk = resampledSamples.subarray(offset, offset + remaining);
    const mp3buf = mp3encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  // Finalize
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }

  // Combine all chunks
  const totalLength = mp3Data.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of mp3Data) {
    result.set(chunk, position);
    position += chunk.length;
  }

  return result;
}

/**
 * Convert WAV audio to compressed MP3
 * @param wavBytes - WAV file data (with header)
 * @returns Compressed MP3 as Uint8Array
 */
export function compressWavToMp3(wavBytes: Uint8Array): Uint8Array {
  // Parse WAV header to get sample rate
  const view = new DataView(wavBytes.buffer);

  // Check RIFF header
  const riff = String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3]);
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV file: missing RIFF header");
  }

  // Get sample rate from fmt chunk (offset 24 in standard WAV)
  const sampleRate = view.getUint32(24, true);

  // Get data chunk offset (typically at 44 for standard WAV)
  // Find "data" marker
  let dataOffset = 44;
  for (let i = 12; i < wavBytes.length - 4; i++) {
    if (wavBytes[i] === 0x64 && wavBytes[i + 1] === 0x61 &&
        wavBytes[i + 2] === 0x74 && wavBytes[i + 3] === 0x61) {
      dataOffset = i + 8; // Skip "data" + 4-byte size
      break;
    }
  }

  // Extract PCM data
  const pcmBytes = wavBytes.slice(dataOffset);

  return compressPcmToMp3(pcmBytes, sampleRate);
}

/**
 * Compress WebM audio to MP3 (for browser-recorded audio)
 * Note: This requires decoding WebM first which isn't straightforward in Deno.
 * For WebM, we'll store as-is since it's already compressed.
 * This function is a placeholder for future enhancement.
 */
export function isWebMAlreadyCompressed(): boolean {
  // WebM/Opus is already a compressed format, typically smaller than WAV
  // but can still benefit from re-encoding to MP3 for consistency
  return true;
}

/**
 * Convert PCM base64 to compressed MP3
 * @param pcmBase64 - Base64-encoded PCM audio
 * @param sampleRate - Input sample rate
 * @returns Compressed MP3 as Uint8Array
 */
export function compressPcmBase64ToMp3(
  pcmBase64: string,
  sampleRate: number = 24000
): Uint8Array {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
  return compressPcmToMp3(pcmBytes, sampleRate);
}

/**
 * Create WAV from PCM (for compatibility, if MP3 fails)
 * This is kept for fallback scenarios
 */
export function createWavFromPcm(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, totalSize - 8, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Copy PCM data
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmBytes, headerSize);

  return wavBytes;
}
