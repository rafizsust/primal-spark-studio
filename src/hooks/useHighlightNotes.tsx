import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface Highlight {
  id: string;
  testId: string;
  contentId: string; // passageId or questionId
  text: string;
  color: 'yellow' | 'red'; // 'yellow' for highlight, 'red' for note
  startOffset: number;
  endOffset: number;
  isNote: boolean; // True if it's a note, false if just a highlight
}

export interface Note {
  id: string;
  highlightId: string; // Links to a specific highlight
  text: string;
  createdAt: number;
  updatedAt: number;
}

interface HighlightNoteContextType {
  highlights: Highlight[];
  notes: Note[];
  addHighlight: (highlight: Omit<Highlight, 'id' | 'color' | 'isNote'>, color?: 'yellow' | 'red') => Highlight;
  updateHighlight: (id: string, updates: Partial<Highlight>) => void;
  removeHighlight: (id: string) => void;
  addOrUpdateNote: (highlightId: string, noteText: string) => void;
  removeNote: (highlightId: string) => void;
  getNoteForHighlight: (highlightId: string) => Note | undefined;
  getHighlightsForContent: (testId: string, contentId: string) => Highlight[];
  getAllNotesForTest: (testId: string) => { highlight: Highlight; note: Note }[];
}

const HighlightNoteContext = createContext<HighlightNoteContextType | undefined>(undefined);

interface HighlightNoteProviderProps {
  children: ReactNode;
  testId: string;
}

export const HighlightNoteProvider = ({ children, testId }: HighlightNoteProviderProps) => {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const savedHighlights = localStorage.getItem(`ieltsai-highlights-${testId}`);
    const savedNotes = localStorage.getItem(`ieltsai-notes-${testId}`);
    if (savedHighlights) {
      setHighlights(JSON.parse(savedHighlights));
    }
    if (savedNotes) {
      setNotes(JSON.parse(savedNotes));
    }
  }, [testId]);

  // Save to localStorage whenever highlights or notes change (quota-safe)
  useEffect(() => {
    import('@/lib/storage').then(({ safeLocalStorageSetItem }) => {
      safeLocalStorageSetItem(`ieltsai-highlights-${testId}`, JSON.stringify(highlights));
    });
  }, [highlights, testId]);

  useEffect(() => {
    import('@/lib/storage').then(({ safeLocalStorageSetItem }) => {
      safeLocalStorageSetItem(`ieltsai-notes-${testId}`, JSON.stringify(notes));
    });
  }, [notes, testId]);

  const addHighlight = useCallback((
    highlightData: Omit<Highlight, 'id' | 'color' | 'isNote'>,
    color: 'yellow' | 'red' = 'yellow'
  ): Highlight => {
    const newHighlight: Highlight = {
      id: crypto.randomUUID(),
      ...highlightData,
      color,
      isNote: color === 'red',
    };
    setHighlights(prev => [...prev, newHighlight]);
    return newHighlight;
  }, []);

  const updateHighlight = useCallback((id: string, updates: Partial<Highlight>) => {
    setHighlights(prev =>
      prev.map(h => (h.id === id ? { ...h, ...updates } : h))
    );
  }, []);

  const removeHighlight = useCallback((id: string) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
    setNotes(prev => prev.filter(n => n.highlightId !== id)); // Remove associated note
  }, []);

  const addOrUpdateNote = useCallback((highlightId: string, noteText: string) => {
    const now = Date.now();
    setNotes(prev => {
      const existingNoteIndex = prev.findIndex(n => n.highlightId === highlightId);
      if (existingNoteIndex !== -1) {
        // Update existing note
        const newNotes = [...prev];
        newNotes[existingNoteIndex] = { ...newNotes[existingNoteIndex], text: noteText, updatedAt: now };
        return newNotes;
      } else {
        // Add new note
        return [...prev, { id: crypto.randomUUID(), highlightId, text: noteText, createdAt: now, updatedAt: now }];
      }
    });
    // Ensure the highlight is marked as a note (red)
    updateHighlight(highlightId, { color: 'red', isNote: true });
  }, [updateHighlight]);

  const removeNote = useCallback((highlightId: string) => {
    setNotes(prev => prev.filter(n => n.highlightId !== highlightId));
    // Revert highlight color to yellow if it was a note
    updateHighlight(highlightId, { color: 'yellow', isNote: false });
  }, [updateHighlight]);

  const getNoteForHighlight = useCallback((highlightId: string) => {
    return notes.find(n => n.highlightId === highlightId);
  }, [notes]);

  const getHighlightsForContent = useCallback((currentTestId: string, contentId: string) => {
    return highlights.filter(h => h.testId === currentTestId && h.contentId === contentId);
  }, [highlights]);

  const getAllNotesForTest = useCallback((currentTestId: string) => {
    const testHighlights = highlights.filter(h => h.testId === currentTestId && h.isNote);
    return testHighlights
      .map(h => {
        const note = notes.find(n => n.highlightId === h.id);
        return note ? { highlight: h, note } : null;
      })
      .filter(Boolean) as { highlight: Highlight; note: Note }[];
  }, [highlights, notes]);

  return (
    <HighlightNoteContext.Provider
      value={{
        highlights,
        notes,
        addHighlight,
        updateHighlight,
        removeHighlight,
        addOrUpdateNote,
        removeNote,
        getNoteForHighlight,
        getHighlightsForContent,
        getAllNotesForTest,
      }}
    >
      {children}
    </HighlightNoteContext.Provider>
  );
};

export const useHighlightNotes = () => {
  const context = useContext(HighlightNoteContext);
  if (context === undefined) {
    throw new Error('useHighlightNotes must be used within a HighlightNoteProvider');
  }
  return context;
};

// Optional hook that returns null if not inside provider (for admin/preview use)
export const useHighlightNotesOptional = () => {
  return useContext(HighlightNoteContext);
};