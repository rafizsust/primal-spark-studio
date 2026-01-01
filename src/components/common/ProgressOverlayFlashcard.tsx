import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FlashcardItem {
  key: string;
  value: string;
  isCorrect?: boolean;
}

interface ProgressOverlayFlashcardProps {
  items: FlashcardItem[];
  title?: string;
  className?: string;
}

export function ProgressOverlayFlashcard({ 
  items, 
  title = 'Review',
  className 
}: ProgressOverlayFlashcardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ known: 0, unknown: 0 });

  if (items.length === 0) {
    return null;
  }

  const currentItem = items[currentIndex];
  const progress = ((currentIndex + 1) / items.length) * 100;

  const handleReveal = () => {
    setRevealed(true);
  };

  const handleNext = (knewIt: boolean) => {
    setStats(prev => ({
      known: prev.known + (knewIt ? 1 : 0),
      unknown: prev.unknown + (knewIt ? 0 : 1),
    }));
    
    if (currentIndex < items.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setRevealed(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setRevealed(false);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setRevealed(false);
    setStats({ known: 0, unknown: 0 });
  };

  const isComplete = currentIndex === items.length - 1 && revealed;

  return (
    <div className={cn("w-full max-w-md mx-auto", className)}>
      {/* Header with progress */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-success">{stats.known}✓</span>
          <span className="text-destructive">{stats.unknown}✗</span>
          <span className="text-muted-foreground">
            {currentIndex + 1}/{items.length}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted rounded-full mb-4 overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Flashcard */}
      <Card 
        className={cn(
          "relative min-h-[180px] cursor-pointer transition-all duration-300",
          "bg-gradient-to-br from-card to-accent/5 border-2",
          revealed ? "border-accent/30" : "border-primary/30",
          currentItem.isCorrect === true && "border-l-4 border-l-success",
          currentItem.isCorrect === false && "border-l-4 border-l-destructive"
        )}
        onClick={!revealed ? handleReveal : undefined}
      >
        <div className="p-6 flex flex-col items-center justify-center min-h-[180px]">
          {!revealed ? (
            // Front - Show KEY
            <div className="text-center">
              {currentItem.isCorrect !== undefined && (
                <Badge 
                  variant="outline" 
                  className={cn(
                    "absolute top-3 right-3 text-xs",
                    currentItem.isCorrect ? "border-success text-success" : "border-destructive text-destructive"
                  )}
                >
                  {currentItem.isCorrect ? "Correct" : "Incorrect"}
                </Badge>
              )}
              <p className="text-lg font-semibold mb-3">{currentItem.key}</p>
              <p className="text-xs text-muted-foreground animate-pulse">
                Tap to reveal answer
              </p>
            </div>
          ) : (
            // Back - Show VALUE
            <div className="text-center w-full">
              <p className="text-xs text-muted-foreground mb-2">{currentItem.key}</p>
              <p className="text-base font-medium text-primary">{currentItem.value}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          className="gap-1"
        >
          <ChevronLeft size={16} />
          Previous
        </Button>

        {revealed && !isComplete && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleNext(false)}
              className="gap-1 border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <X size={14} />
              Didn't Know
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleNext(true)}
              className="gap-1 border-success/50 text-success hover:bg-success/10"
            >
              <Check size={14} />
              Knew It
            </Button>
          </div>
        )}

        {isComplete && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestart}
            className="gap-1"
          >
            <RotateCcw size={14} />
            Restart
          </Button>
        )}

        {!revealed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (currentIndex < items.length - 1) {
                setCurrentIndex(currentIndex + 1);
              }
            }}
            disabled={currentIndex === items.length - 1}
            className="gap-1"
          >
            Skip
            <ChevronRight size={16} />
          </Button>
        )}
      </div>

      {/* Completion summary */}
      {isComplete && (
        <div className="mt-4 p-4 rounded-lg bg-muted/50 text-center">
          <p className="text-sm font-medium mb-1">Review Complete!</p>
          <p className="text-xs text-muted-foreground">
            {stats.known} known, {stats.unknown} need review
          </p>
        </div>
      )}
    </div>
  );
}
