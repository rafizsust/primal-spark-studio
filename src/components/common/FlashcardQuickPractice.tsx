import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Brain, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Flashcard {
  id: string;
  word: string;
  meaning: string;
  status: 'learning' | 'reviewing' | 'mastered';
  review_count: number;
  correct_count: number;
}

interface FlashcardQuickPracticeProps {
  className?: string;
}

export function FlashcardQuickPractice({ className }: FlashcardQuickPracticeProps) {
  const { user } = useAuth();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionStats, setSessionStats] = useState({ correct: 0, incorrect: 0 });

  // Load user's flashcards that need review (learning and reviewing status)
  useEffect(() => {
    const loadCards = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('flashcard_cards')
          .select('id, word, meaning, status, review_count, correct_count')
          .eq('user_id', user.id)
          .in('status', ['learning', 'reviewing'])
          .order('correct_count', { ascending: true })
          .limit(20);

        if (error) throw error;

        if (data && data.length > 0) {
          // Shuffle and take random cards
          const shuffled = [...data].sort(() => Math.random() - 0.5);
          setCards(shuffled.map(c => ({
            ...c,
            status: c.status as 'learning' | 'reviewing' | 'mastered'
          })));
        }
      } catch (err) {
        console.error('Error loading flashcards for quick practice:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCards();
  }, [user]);

  const handleResponse = useCallback(async (knewIt: boolean) => {
    const currentCard = cards[currentIndex];
    if (!currentCard) return;

    // Update session stats
    setSessionStats(prev => ({
      correct: prev.correct + (knewIt ? 1 : 0),
      incorrect: prev.incorrect + (knewIt ? 0 : 1),
    }));

    // Update card in database
    let newStatus: 'learning' | 'reviewing' | 'mastered' = currentCard.status;
    const newReviewCount = currentCard.review_count + 1;
    const newCorrectCount = knewIt ? currentCard.correct_count + 1 : currentCard.correct_count;

    if (knewIt) {
      if (currentCard.status === 'learning') {
        newStatus = 'reviewing';
      } else if (currentCard.status === 'reviewing' && newCorrectCount >= 3) {
        newStatus = 'mastered';
      }
    } else {
      if (currentCard.status === 'mastered' || currentCard.status === 'reviewing') {
        newStatus = 'learning';
      }
    }

    try {
      await supabase
        .from('flashcard_cards')
        .update({
          status: newStatus,
          review_count: newReviewCount,
          correct_count: newCorrectCount,
        })
        .eq('id', currentCard.id);

      // Update local state
      setCards(prev => prev.map(c => 
        c.id === currentCard.id 
          ? { ...c, status: newStatus, review_count: newReviewCount, correct_count: newCorrectCount }
          : c
      ));
    } catch (err) {
      console.error('Error updating flashcard:', err);
    }

    // Move to next card
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsFlipped(false);
    } else {
      // Restart with shuffled cards
      setCards(prev => [...prev].sort(() => Math.random() - 0.5));
      setCurrentIndex(0);
      setIsFlipped(false);
    }
  }, [cards, currentIndex]);

  // If no cards or still loading, return null (parent will show tips instead)
  if (loading || cards.length === 0) {
    return null;
  }

  const currentCard = cards[currentIndex];

  return (
    <div className={cn("w-full max-w-sm mx-auto", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="w-3 h-3" />
          <span>Quick Flashcard Practice</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-success">{sessionStats.correct}✓</span>
          <span className="text-destructive">{sessionStats.incorrect}✗</span>
        </div>
      </div>

      {/* Flashcard - Shows WORD first, reveals MEANING on tap */}
      <div 
        className="relative h-36 cursor-pointer perspective-1000 mb-3"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <div className={cn(
          "absolute inset-0 transition-transform duration-300 transform-style-3d",
          isFlipped && "rotate-y-180"
        )}>
          {/* Front - Shows the WORD (key) */}
          <Card className={cn(
            "absolute inset-0 backface-hidden flex items-center justify-center overflow-hidden",
            "bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20"
          )}>
            <CardContent className="text-center p-3 w-full h-full flex flex-col items-center justify-center relative">
              <Badge 
                variant="outline" 
                className={cn(
                  "absolute top-2 left-2 text-[10px]",
                  currentCard.status === 'learning' && "border-amber-500 text-amber-600",
                  currentCard.status === 'reviewing' && "border-blue-500 text-blue-600"
                )}
              >
                {currentCard.status === 'learning' ? <Brain className="w-2.5 h-2.5 mr-1" /> : null}
                {currentCard.status}
              </Badge>
              <p className="text-lg font-bold line-clamp-2 px-2">{currentCard.word}</p>
              <p className="text-[10px] text-muted-foreground mt-2">Tap to reveal meaning</p>
            </CardContent>
          </Card>

          {/* Back - Shows the MEANING (value) */}
          <Card className={cn(
            "absolute inset-0 backface-hidden rotate-y-180 flex items-center justify-center overflow-hidden",
            "bg-gradient-to-br from-accent/5 to-primary/5 border-accent/20"
          )}>
            <CardContent className="text-center p-3 w-full h-full flex flex-col items-center justify-center overflow-y-auto">
              <p className="text-xs text-muted-foreground mb-1">{currentCard.word}</p>
              <p className="text-sm font-medium line-clamp-4 px-2">{currentCard.meaning}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Response Buttons - only show when flipped */}
      {isFlipped && (
        <div className="flex items-center justify-center gap-3 animate-fade-in">
          <Button 
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleResponse(false);
            }}
            className="gap-1 border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <X size={14} />
            <span className="text-xs">Don't Know</span>
          </Button>
          <Button 
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              handleResponse(true);
            }}
            className="gap-1 border-success/50 text-success hover:bg-success/10"
          >
            <Check size={14} />
            <span className="text-xs">Know It</span>
          </Button>
        </div>
      )}

      <p className="text-[10px] text-center text-muted-foreground mt-2">
        Card {currentIndex + 1} of {cards.length} • Progress synced automatically
      </p>
    </div>
  );
}