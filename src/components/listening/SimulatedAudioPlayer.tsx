import { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from '@/lib/utils';

interface SimulatedAudioPlayerProps {
  text: string;
  accentHint?: 'US' | 'GB' | 'AU';
  onComplete?: () => void;
  className?: string;
}

const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5];

/**
 * SimulatedAudioPlayer - A TTS-based audio player that mimics the premium player UI
 * Features:
 * - Play/Pause toggle
 * - Simulated progress bar based on word count estimation
 * - Time display (0:15 / 1:45)
 * - Source badge indicating "Device Voice"
 * - Volume controls
 * - Playback speed controls
 */
export function SimulatedAudioPlayer({
  text,
  accentHint = 'GB',
  onComplete,
  className,
}: SimulatedAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isSupported, setIsSupported] = useState(true);
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  
  // Estimate duration: ~2.5 words per second for TTS
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const estimatedDuration = Math.ceil(wordCount / 2.5);

  // Get best available voice
  const getBestVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;

    const accentMap: Record<string, string[]> = {
      US: ['en-US', 'en_US'],
      GB: ['en-GB', 'en_GB', 'en-UK'],
      AU: ['en-AU', 'en_AU'],
    };

    const preferredLangs = accentMap[accentHint] || ['en-GB'];

    // Priority order for voice selection - prefer high-quality voices
    const voicePriorities = [
      // 1. Match accent + high-quality voices (Google, Microsoft, Natural)
      (v: SpeechSynthesisVoice) =>
        preferredLangs.some((l) => v.lang.includes(l.replace('_', '-'))) &&
        (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Natural')),
      // 2. Match accent
      (v: SpeechSynthesisVoice) =>
        preferredLangs.some((l) => v.lang.includes(l.replace('_', '-'))),
      // 3. Any high-quality English voice
      (v: SpeechSynthesisVoice) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Natural')),
      // 4. Any English voice
      (v: SpeechSynthesisVoice) => v.lang.startsWith('en'),
    ];

    for (const priority of voicePriorities) {
      const match = voices.find(priority);
      if (match) return match;
    }

    return voices[0];
  }, [accentHint]);

  // Animate progress bar
  const animateProgress = useCallback(() => {
    if (!startTimeRef.current) return;
    
    const now = Date.now();
    const elapsed = (now - startTimeRef.current) / 1000; // in seconds
    const adjustedElapsed = elapsed * playbackRate;
    const newProgress = Math.min((adjustedElapsed / estimatedDuration) * 100, 100);
    const newTime = Math.min(adjustedElapsed, estimatedDuration);
    
    setProgress(newProgress);
    setCurrentTime(newTime);
    
    if (newProgress < 100 && window.speechSynthesis.speaking) {
      animationFrameRef.current = requestAnimationFrame(animateProgress);
    }
  }, [estimatedDuration, playbackRate]);

  // Start speech
  const startSpeech = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSupported(false);
      return;
    }

    // Cancel any existing speech
    window.speechSynthesis.cancel();

    // FIX 4: Sanitize text to remove SSML/XML tags before browser TTS speaks
    const safeText = text
      .replace(/<[^>]*>/g, '')      // Remove <break>, <speak>, etc.
      .replace(/&[a-z]+;/gi, ' ')   // Remove HTML entities like &nbsp;
      .replace(/\s+/g, ' ')         // Collapse multiple spaces
      .trim();

    const utterance = new SpeechSynthesisUtterance(safeText);
    utteranceRef.current = utterance;

    // Set voice
    const setVoice = () => {
      const voice = getBestVoice();
      if (voice) {
        utterance.voice = voice;
      }
      utterance.rate = playbackRate * 0.9; // Slightly slower for clarity
      utterance.pitch = 1;
      utterance.volume = isMuted ? 0 : volume;
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      setVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = setVoice;
    }

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
      startTimeRef.current = Date.now() - (pausedTimeRef.current * 1000);
      animationFrameRef.current = requestAnimationFrame(animateProgress);
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setProgress(100);
      setCurrentTime(estimatedDuration);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      onComplete?.();
    };

    utterance.onerror = (e) => {
      console.error('TTS error:', e);
      setIsPlaying(false);
      setIsPaused(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [text, getBestVoice, playbackRate, isMuted, volume, animateProgress, estimatedDuration, onComplete]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (!isPlaying && !isPaused) {
      // Start fresh
      startSpeech();
    } else if (isPlaying && !isPaused) {
      // Pause
      window.speechSynthesis.pause();
      setIsPaused(true);
      pausedTimeRef.current = currentTime;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    } else if (isPaused) {
      // Resume
      window.speechSynthesis.resume();
      setIsPaused(false);
      startTimeRef.current = Date.now() - (pausedTimeRef.current * 1000 / playbackRate);
      animationFrameRef.current = requestAnimationFrame(animateProgress);
    }
  }, [isPlaying, isPaused, startSpeech, currentTime, animateProgress, playbackRate]);

  // Handle volume change
  const handleVolumeChange = useCallback((value: number[]) => {
    const v = value[0] / 100;
    setVolume(v);
    if (v === 0) setIsMuted(true);
    else if (isMuted) setIsMuted(false);
    
    // Update current utterance volume
    if (utteranceRef.current) {
      utteranceRef.current.volume = v;
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setIsMuted((m) => {
      if (utteranceRef.current) {
        utteranceRef.current.volume = m ? volume : 0;
      }
      return !m;
    });
  }, [volume]);

  // Handle playback rate change
  const handlePlaybackRateChange = useCallback((value: string) => {
    const rate = parseFloat(value);
    setPlaybackRate(rate);
    
    // Restart with new rate if currently playing
    if (isPlaying) {
      pausedTimeRef.current = currentTime;
      window.speechSynthesis.cancel();
      setTimeout(() => startSpeech(), 50);
    }
  }, [isPlaying, currentTime, startSpeech]);

  // Format time helper
  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Check support on mount
  useEffect(() => {
    setIsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  if (!isSupported) {
    return (
      <div className={cn("flex items-center justify-center p-2 bg-destructive/10 text-destructive rounded-md", className)}>
        <span className="text-sm">Audio playback not supported in this browser</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Play/Pause Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlayPause}
        className="flex-shrink-0 h-8 w-8"
      >
        {isPlaying && !isPaused ? <Pause size={20} /> : <Play size={20} />}
      </Button>

      {/* Progress Bar */}
      <div className="flex-1 flex items-center gap-1 min-w-0">
        <span className="text-xs text-muted-foreground w-10 text-right flex-shrink-0">
          {formatTime(currentTime)}
        </span>
        <Slider
          value={[progress]}
          max={100}
          step={0.1}
          disabled
          className="flex-1 min-w-[60px]"
        />
        <span className="text-xs text-muted-foreground w-10 text-left flex-shrink-0">
          {formatTime(estimatedDuration)}
        </span>
      </div>

      {/* Volume Control */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={toggleMute} className="h-7 w-7">
          {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </Button>
        <Slider
          value={[isMuted ? 0 : volume * 100]}
          max={100}
          step={1}
          onValueChange={handleVolumeChange}
          className="w-14"
        />
      </div>

      {/* Playback Speed */}
      <Select value={playbackRate.toString()} onValueChange={handlePlaybackRateChange}>
        <SelectTrigger className="w-[70px] h-7 text-xs">
          <SelectValue placeholder="Speed" />
        </SelectTrigger>
        <SelectContent>
          {playbackSpeeds.map((speed) => (
            <SelectItem key={speed} value={speed.toString()}>
              {speed}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Source Badge */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-muted rounded-full text-xs text-muted-foreground flex-shrink-0">
              <Zap size={12} className="text-amber-500" />
              <span className="hidden sm:inline">Device Voice</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Premium audio unavailable. Using system voice.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export default SimulatedAudioPlayer;
