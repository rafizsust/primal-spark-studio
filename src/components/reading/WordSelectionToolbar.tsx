import { useState } from 'react';
import { Plus, X, Languages, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AddToFlashcardButton } from '@/components/common/AddToFlashcardButton';

interface WordSelectionToolbarProps {
  position: { x: number; y: number };
  word: string;
  onAdd: () => void;
  onClose: () => void;
}

const LANGUAGE_PREF_KEY = 'user_language_preference';

export function WordSelectionToolbar({ position, word, onAdd, onClose }: WordSelectionToolbarProps) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);

  const handleTranslate = async () => {
    setIsTranslating(true);
    try {
      const targetLanguage = localStorage.getItem(LANGUAGE_PREF_KEY) || 'bn';
      
      const response = await supabase.functions.invoke('translate-word', {
        body: { word, targetLanguage }
      });

      if (response.error) throw response.error;
      
      const translatedText = response.data?.translation || 'Translation not available';
      setTranslation(translatedText);
      toast.success(`Translation: ${translatedText}`);
    } catch (error) {
      console.error('Translation error:', error);
      toast.error('Failed to translate. Please try again.');
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div
      className="word-selection-toolbar fixed z-50 animate-in fade-in-0 zoom-in-95 duration-150"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)'
      }}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl p-1 flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-3 gap-1.5 text-xs font-medium hover:bg-primary hover:text-primary-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus size={14} />
            Add "{word.length > 15 ? word.slice(0, 15) + '...' : word}"
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-3 gap-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleTranslate();
            }}
            disabled={isTranslating}
          >
            {isTranslating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Languages size={14} />
            )}
            Translate
          </Button>
          <AddToFlashcardButton 
            word={word}
            variant="icon"
            className="h-8 w-8"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          >
            <X size={14} />
          </Button>
        </div>
        {translation && (
          <div className="px-3 py-2 text-sm bg-muted/50 rounded-md border-t border-border">
            <span className="font-medium text-primary">{translation}</span>
          </div>
        )}
      </div>
      {/* Arrow */}
      <div 
        className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0"
        style={{
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid hsl(var(--border))'
        }}
      />
    </div>
  );
}