import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loadingPromise: Promise<void> | null = null;

/**
 * Load FFmpeg WASM (singleton pattern to avoid reloading)
 */
async function ensureFFmpegLoaded(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) {
    return ffmpeg;
  }

  if (loadingPromise) {
    await loadingPromise;
    return ffmpeg!;
  }

  ffmpeg = new FFmpeg();
  
  loadingPromise = (async () => {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg!.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  })();

  await loadingPromise;
  return ffmpeg!;
}

/**
 * Compress audio file for efficient storage.
 * Converts to MP3 with: Mono (1 channel), 24kHz sample rate, 64kbps bitrate.
 * Optimized for spoken word/IELTS content.
 * 
 * @param file - The audio file to compress
 * @param onProgress - Optional progress callback (0-100)
 * @returns Compressed audio file as MP3
 */
export async function compressAudio(
  file: File,
  onProgress?: (progress: number) => void
): Promise<File> {
  const ff = await ensureFFmpegLoaded();

  // Get file extension and create input/output names
  const inputExt = file.name.substring(file.name.lastIndexOf('.')) || '.mp3';
  const inputName = `input${inputExt}`;
  const outputName = 'output.mp3';

  // Track progress if callback provided
  if (onProgress) {
    ff.on('progress', ({ progress }) => {
      onProgress(Math.round(progress * 100));
    });
  }

  try {
    // Write input file to FFmpeg virtual filesystem
    await ff.writeFile(inputName, await fetchFile(file));

    // Compress: Mono (ac 1), 24kHz (ar 24000), 64kbps (b:a 64k)
    // These settings are optimized for spoken word/IELTS content
    await ff.exec([
      '-i', inputName,
      '-ac', '1',           // Mono channel
      '-ar', '24000',       // 24kHz sample rate
      '-b:a', '64k',        // 64kbps bitrate
      '-map_metadata', '-1', // Strip metadata to save space
      outputName
    ]);

    // Read the compressed output
    const data = await ff.readFile(outputName);
    
    // Clean up files from virtual filesystem
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);

    // Convert FileData to ArrayBuffer for File constructor compatibility
    let arrayBuffer: ArrayBuffer;
    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      arrayBuffer = encoder.encode(data).buffer;
    } else {
      // Create a new ArrayBuffer from the Uint8Array to avoid SharedArrayBuffer issues
      arrayBuffer = new ArrayBuffer(data.length);
      new Uint8Array(arrayBuffer).set(data);
    }

    // Create new file with .mp3 extension
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return new File([arrayBuffer], `${baseName}.mp3`, { type: 'audio/mpeg' });
  } catch (error) {
    console.error('Audio compression failed:', error);
    throw new Error(`Failed to compress audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get approximate compression ratio estimate
 * @param originalSize - Original file size in bytes
 * @returns Estimated compressed size in bytes
 */
export function estimateCompressedSize(originalSize: number): number {
  // 64kbps mono MP3 is typically 80-90% smaller than uncompressed audio
  // Conservative estimate: 15% of original size
  return Math.round(originalSize * 0.15);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
