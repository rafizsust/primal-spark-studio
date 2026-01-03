import { useState, useCallback, useEffect } from 'react';
import { WebAudioScheduledPlayer } from './WebAudioScheduledPlayer';
import { SimulatedAudioPlayer } from './SimulatedAudioPlayer';
import { cn } from '@/lib/utils';

interface WebAudioScheduledPlayerSafeProps {
  audioUrls: {
    part1?: string | null;
    part2?: string | null;
    part3?: string | null;
    part4?: string | null;
  };
  transcripts?: {
    part1?: string | null;
    part2?: string | null;
    part3?: string | null;
    part4?: string | null;
  };
  initialStartTime?: number;
  initialPart?: number;
  onPartChange?: (partNumber: number) => void;
  onTestComplete?: () => void;
  onReviewStart?: () => void;
  accent?: 'US' | 'GB' | 'AU';
  className?: string;
}

/**
 * A wrapper around WebAudioScheduledPlayer that provides:
 * 1. TTS fallback via SimulatedAudioPlayer when audio fails to load
 * 2. NO transcript display (prevents cheating)
 * 3. Error recovery with user-friendly player UI
 */
export function WebAudioScheduledPlayerSafe({
  audioUrls,
  transcripts,
  initialStartTime = 0,
  initialPart,
  onPartChange,
  onTestComplete,
  onReviewStart,
  accent = 'GB',
  className,
}: WebAudioScheduledPlayerSafeProps) {
  const [audioError, setAudioError] = useState<string | null>(null);
  const [currentPart, setCurrentPart] = useState(initialPart || 1);
  const [useTTS, setUseTTS] = useState(false);

  // Check if audio URLs are valid
  const hasAudioUrls = Boolean(
    audioUrls.part1 || audioUrls.part2 || audioUrls.part3 || audioUrls.part4
  );
  
  const hasTranscripts = Boolean(
    transcripts?.part1 || transcripts?.part2 || transcripts?.part3 || transcripts?.part4
  );

  // Get the combined transcript for TTS
  const getCombinedTranscript = useCallback(() => {
    if (!transcripts) return '';
    const parts = [
      transcripts.part1,
      transcripts.part2,
      transcripts.part3,
      transcripts.part4,
    ].filter(Boolean);
    return parts.join('\n\n');
  }, [transcripts]);

  // Get transcript for current part
  const getCurrentPartTranscript = useCallback(() => {
    if (!transcripts) return '';
    const transcriptMap: Record<number, string | null | undefined> = {
      1: transcripts.part1,
      2: transcripts.part2,
      3: transcripts.part3,
      4: transcripts.part4,
    };
    return transcriptMap[currentPart] || '';
  }, [currentPart, transcripts]);

  // Handle audio error - switch to TTS mode
  const handleAudioError = useCallback((errorMsg: string) => {
    console.error('Audio error in safe player:', errorMsg);
    setAudioError(errorMsg);
    
    if (hasTranscripts) {
      setUseTTS(true);
    }
  }, [hasTranscripts]);

  // Expose handleAudioError for potential external use
  void handleAudioError;

  // Track part changes
  const handlePartChange = useCallback((partNumber: number) => {
    setCurrentPart(partNumber);
    onPartChange?.(partNumber);
  }, [onPartChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup handled by SimulatedAudioPlayer
    };
  }, []);

  // If no audio URLs at all, use SimulatedAudioPlayer with transcript
  if (!hasAudioUrls) {
    if (hasTranscripts) {
      const transcript = getCombinedTranscript();
      return (
        <div className={cn("space-y-4", className)}>
          <SimulatedAudioPlayer
            text={transcript}
            accentHint={accent}
            onComplete={onTestComplete}
          />
        </div>
      );
    }
    
    // No audio and no transcript - show minimal error
    return (
      <div className={cn("flex items-center justify-center p-4 bg-destructive/10 text-destructive rounded-md", className)}>
        <span className="text-sm">Audio content not available. Please contact support.</span>
      </div>
    );
  }

  // If using TTS fallback mode (audio failed but transcript available)
  if (useTTS && hasTranscripts) {
    const transcript = getCurrentPartTranscript() || getCombinedTranscript();
    return (
      <div className={cn("space-y-4", className)}>
        <SimulatedAudioPlayer
          text={transcript}
          accentHint={accent}
          onComplete={onTestComplete}
        />
      </div>
    );
  }

  // Normal mode - use WebAudioScheduledPlayer
  return (
    <div className={cn("space-y-4", className)}>
      <WebAudioScheduledPlayer
        audioUrls={audioUrls}
        initialStartTime={initialStartTime}
        initialPart={initialPart}
        onPartChange={handlePartChange}
        onTestComplete={onTestComplete}
        onReviewStart={onReviewStart}
      />
      
      {/* Show SimulatedAudioPlayer if there's an error but we have transcripts */}
      {audioError && hasTranscripts && !useTTS && (
        <SimulatedAudioPlayer
          text={getCombinedTranscript()}
          accentHint={accent}
          onComplete={onTestComplete}
        />
      )}
    </div>
  );
}

export default WebAudioScheduledPlayerSafe;
