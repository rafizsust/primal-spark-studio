import { useEffect, useState } from 'react';
import { Clock, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ListeningTimerProps {
  timeLeft: number;
  setTimeLeft: (time: number | ((prev: number) => number)) => void;
  isPaused?: boolean;
  onTogglePause?: () => void;
}

export function ListeningTimer({ timeLeft, setTimeLeft, isPaused = false, onTogglePause }: ListeningTimerProps) {
  const [showPauseWarning, setShowPauseWarning] = useState(false);

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

  const handleTimerClick = () => {
    if (!onTogglePause) return;
    
    if (!isPaused) {
      setShowPauseWarning(true);
    } else {
      onTogglePause();
    }
  };

  const confirmPause = () => {
    setShowPauseWarning(false);
    onTogglePause?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleTimerClick}
        className={cn(
          "flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1 md:py-2 rounded-lg transition-all cursor-pointer hover:opacity-80",
          isPaused 
            ? "bg-amber-500/20 border-2 border-amber-500 animate-pulse" 
            : isLowTime 
              ? "bg-destructive/10 border border-destructive/30" 
              : "bg-primary/10 border border-primary/30"
        )}
      >
        {isPaused ? (
          <Play size={16} className="md:w-5 md:h-5 text-amber-500" />
        ) : (
          <Clock size={16} className={cn("md:w-5 md:h-5", isLowTime ? "text-destructive" : "text-primary")} />
        )}
        <span className={cn(
          "font-mono font-bold text-sm md:text-lg",
          isPaused ? "text-amber-500" : isLowTime ? "text-destructive" : "text-primary"
        )}>
          {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
        </span>
        {isPaused && (
          <span className="hidden md:inline text-xs font-medium text-amber-500 uppercase tracking-wider">
            PAUSED (Click to Resume)
          </span>
        )}
      </button>

      {/* Pause Warning Dialog */}
      <Dialog open={showPauseWarning} onOpenChange={setShowPauseWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={20} />
              Practice Mode Warning
            </DialogTitle>
            <DialogDescription className="pt-4">
              <div className="space-y-3">
                <p>
                  You are about to <strong>pause the timer</strong>. This feature is only 
                  available in practice mode.
                </p>
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <p className="text-amber-800 dark:text-amber-200 text-sm font-medium">
                    ⚠️ In the real IELTS exam, you will NOT be able to pause the test!
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Use this feature wisely for learning purposes only.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setShowPauseWarning(false)}>
              Cancel
            </Button>
            <Button onClick={confirmPause} className="bg-amber-500 hover:bg-amber-600">
              Pause Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
