import { useCallback, useRef, useState } from 'react';
import { pcm16Base64ToWavUrl } from '@/lib/audio/pcmToWav';

export type PcmClip = {
  key: string;
  text?: string;
  url?: string;          // R2 URL (new optimization)
  audioBase64?: string;  // Base64 fallback (legacy)
  sampleRate?: number;
};

export function useAudioClipQueue({ muted }: { muted: boolean }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const playSessionRef = useRef(0);

  const stop = useCallback(() => {
    playSessionRef.current += 1;
    setIsSpeaking(false);
  }, []);

  const playClips = useCallback(
    async (clips: PcmClip[]) => {
      if (!clips.length) return;

      const sessionId = ++playSessionRef.current;
      setIsSpeaking(true);

      for (const clip of clips) {
        if (playSessionRef.current !== sessionId) break;

        let audioUrl: string;
        let shouldRevoke = false;

        // OPTIMIZATION: Use R2 URL if available (saves bandwidth)
        if (clip.url) {
          audioUrl = clip.url;
          shouldRevoke = false;
        } else if (clip.audioBase64) {
          // Legacy fallback: convert base64 to blob URL
          audioUrl = pcm16Base64ToWavUrl(clip.audioBase64, clip.sampleRate ?? 24000);
          shouldRevoke = true;
        } else {
          console.warn('Clip has no audio source:', clip.key);
          continue;
        }

        try {
          await new Promise<void>((resolve, reject) => {
            const audio = new Audio(audioUrl);
            audio.volume = muted ? 0 : 1;
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error('Audio playback failed'));
            audio.play().catch(reject);
          });
        } finally {
          // Only revoke blob URLs, not R2 URLs
          if (shouldRevoke) {
            URL.revokeObjectURL(audioUrl);
          }
        }
      }

      if (playSessionRef.current === sessionId) {
        setIsSpeaking(false);
      }
    },
    [muted]
  );

  return { isSpeaking, playClips, stop };
}
