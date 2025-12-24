import { useEffect } from 'react';
import { Clock, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReadingTimerProps {
  timeLeft: number;
  setTimeLeft: (time: number | ((prev: number) => number)) => void;
  isPaused?: boolean;
  onTogglePause?: () => void;
}

export function ReadingTimer({ timeLeft, setTimeLeft, isPaused = false, onTogglePause }: ReadingTimerProps) {
  useEffect(() => {
    if (isPaused) return;
    
    const timer = setInterval(() => {
      setTimeLeft((prev: number) => {
        if (prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [setTimeLeft, isPaused]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const isLowTime = timeLeft < 300; // Less than 5 minutes

  return (
    <button
      onClick={onTogglePause}
      className={cn(
        "flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1 md:py-2 rounded-lg transition-all timer-container cursor-pointer hover:opacity-80",
        isPaused 
          ? "bg-amber-500/20 border-2 border-amber-500 animate-pulse" 
          : isLowTime 
            ? "bg-destructive/10 border border-destructive/30" 
            : "bg-foreground/10 border border-foreground/30"
      )}
    >
      {isPaused ? (
        <Pause size={16} className="md:w-5 md:h-5 text-amber-500" />
      ) : (
        <Clock size={16} className={cn("md:w-5 md:h-5 timer-icon", isLowTime ? "text-destructive" : "text-foreground")} />
      )}
      <span className={cn(
        "font-mono font-bold text-sm md:text-lg timer-text",
        isPaused ? "text-amber-500" : isLowTime ? "text-destructive" : "text-foreground"
      )}>
        {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
      </span>
      {isPaused && (
        <span className="hidden md:inline text-xs font-medium text-amber-500 uppercase tracking-wider">
          PAUSED
        </span>
      )}
    </button>
  );
}