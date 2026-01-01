import { useState } from 'react';
import { Plus, Loader2, Check, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

interface AddToFlashcardButtonProps {
  word?: string;
  meaning?: string;
  example?: string;
  variant?: 'icon' | 'button' | 'inline';
  className?: string;
  onSuccess?: () => void;
}

export function AddToFlashcardButton({ 
  word = '', 
  meaning = '', 
  example = '',
  variant = 'button',
  className,
  onSuccess 
}: AddToFlashcardButtonProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formData, setFormData] = useState({
    word: word,
    meaning: meaning,
    example: example,
    deckId: ''
  });

  // Fetch user's decks
  const { data: decks = [] } = useQuery({
    queryKey: ['flashcard-decks', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('flashcard_decks')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && open
  });

  const handleSave = async () => {
    if (!user) {
      toast.error('Please log in to save flashcards');
      return;
    }

    if (!formData.word.trim() || !formData.meaning.trim()) {
      toast.error('Word and meaning are required');
      return;
    }

    let deckId = formData.deckId;

    // If no deck selected, create a default one
    if (!deckId) {
      const { data: newDeck, error: deckError } = await supabase
        .from('flashcard_decks')
        .insert({
          user_id: user.id,
          name: 'My Vocabulary',
          description: 'Words collected from reading and listening practice'
        })
        .select('id')
        .single();

      if (deckError) {
        console.error('Error creating deck:', deckError);
        toast.error('Failed to create deck');
        return;
      }
      deckId = newDeck.id;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('flashcard_cards')
        .insert({
          user_id: user.id,
          deck_id: deckId,
          word: formData.word.trim(),
          meaning: formData.meaning.trim(),
          example: formData.example.trim() || null,
          status: 'learning'
        });

      if (error) throw error;

      setSaved(true);
      toast.success('Added to flashcards!');
      onSuccess?.();
      
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
      }, 1000);
    } catch (error) {
      console.error('Error saving flashcard:', error);
      toast.error('Failed to save flashcard');
    } finally {
      setIsSaving(false);
    }
  };

  // Reset form when opening
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setFormData({
        word: word,
        meaning: meaning,
        example: example,
        deckId: decks[0]?.id || ''
      });
      setSaved(false);
    }
  };

  const buttonContent = () => {
    if (saved) {
      return <Check size={16} className="text-success" />;
    }
    if (variant === 'icon') {
      return <Plus size={16} />;
    }
    return (
      <>
        <BookOpen size={16} />
        <span>Add to Flashcards</span>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button 
          variant={variant === 'inline' ? 'link' : 'outline'} 
          size={variant === 'icon' ? 'icon' : 'sm'}
          className={className}
        >
          {buttonContent()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen size={20} className="text-primary" />
            Add to Flashcards
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="word">Word/Phrase</Label>
            <Input 
              id="word"
              value={formData.word}
              onChange={(e) => setFormData(prev => ({ ...prev, word: e.target.value }))}
              placeholder="Enter word or phrase"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="meaning">Meaning/Definition</Label>
            <Textarea 
              id="meaning"
              value={formData.meaning}
              onChange={(e) => setFormData(prev => ({ ...prev, meaning: e.target.value }))}
              placeholder="Enter meaning or definition"
              rows={3}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="example">Example (optional)</Label>
            <Textarea 
              id="example"
              value={formData.example}
              onChange={(e) => setFormData(prev => ({ ...prev, example: e.target.value }))}
              placeholder="Enter an example sentence"
              rows={2}
            />
          </div>
          
          {decks.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="deck">Deck</Label>
              <Select 
                value={formData.deckId} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, deckId: value }))}
              >
                <SelectTrigger id="deck">
                  <SelectValue placeholder="Select a deck (or create new)" />
                </SelectTrigger>
                <SelectContent>
                  {decks.map((deck) => (
                    <SelectItem key={deck.id} value={deck.id}>
                      {deck.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          <Button 
            onClick={handleSave} 
            disabled={isSaving || saved}
            className="w-full gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <Check size={16} />
                Saved!
              </>
            ) : (
              <>
                <Plus size={16} />
                Add to Flashcards
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
