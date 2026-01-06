/**
 * Standard 16-bit PCM WAV Encoder for Edge Functions
 * 
 * Converts raw 16-bit PCM data to standard WAV format.
 * Unlike Mu-Law, this preserves full audio quality.
 */

/**
 * Create a standard 16-bit PCM WAV file
 * @param pcmBytes - Raw 16-bit PCM data (little-endian)
 * @param sampleRate - Sample rate (e.g., 24000 for Gemini TTS)
 * @returns Complete WAV file with 16-bit PCM audio
 */
export function createPcmWav(
  pcmBytes: Uint8Array,
  sampleRate: number
): Uint8Array {
  const numChannels = 1;        // Mono
  const bitsPerSample = 16;     // 16-bit for full quality
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
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
  view.setUint16(20, 1, true);          // AudioFormat: 1 = PCM (not Mu-Law)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Copy PCM audio data
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmBytes, headerSize);

  return wavBytes;
}

/**
 * Convert base64 PCM to standard WAV
 * Convenience function for edge function use
 */
export function pcmBase64ToWav(pcmBase64: string, sampleRate: number): Uint8Array {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  return createPcmWav(pcmBytes, sampleRate);
}
