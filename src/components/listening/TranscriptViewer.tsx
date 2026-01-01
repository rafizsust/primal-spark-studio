import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, ChevronDown, ChevronUp, User, Users, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AddToFlashcardButton } from '@/components/common/AddToFlashcardButton';

interface TranscriptLine {
  speaker: string;
  text: string;
  speakerIndex: number;
}

interface TranscriptViewerProps {
  transcripts: {
    part1?: string | null;
    part2?: string | null;
    part3?: string | null;
    part4?: string | null;
  };
  defaultExpanded?: boolean;
  className?: string;
}

const SPEAKER_COLORS = [
  { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-700 dark:text-blue-400', badge: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-700 dark:text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
  { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-700 dark:text-purple-400', badge: 'bg-purple-500/20 text-purple-700 dark:text-purple-300' },
  { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' },
  { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-700 dark:text-rose-400', badge: 'bg-rose-500/20 text-rose-700 dark:text-rose-300' },
];

function parseTranscript(transcript: string): TranscriptLine[] {
  if (!transcript) return [];
  
  const lines: TranscriptLine[] = [];
  const speakerMap = new Map<string, number>();
  let speakerCounter = 0;
  
  // Split by newlines and process each line
  const rawLines = transcript.split('\n').filter(line => line.trim());
  
  // First pass: extract actual speaker names from the dialogue
  // Pattern: "Name (role):" or just "Name:" where Name is a proper name
  const speakerNamePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:\([^)]+\))?\s*:\s*/;
  const genericSpeakerPattern = /^(Speaker\s*\d+|Speaker\s*[A-Z]|Speaker1|Speaker2|Narrator|Interviewer|Host|Guest\s*\d*|Man|Woman|Male|Female|Student\s*\d*|Teacher|Professor|Examiner|Candidate)\s*:\s*/i;
  
  for (const line of rawLines) {
    // Try to match a proper name first (e.g., "Sarah:", "John Smith:", "Emma (receptionist):")
    let speakerMatch = line.match(speakerNamePattern);
    let speaker = '';
    let text = '';
    
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = line.slice(speakerMatch[0].length).trim();
    } else {
      // Fall back to generic speaker patterns
      const genericMatch = line.match(genericSpeakerPattern);
      if (genericMatch) {
        // Convert "Speaker1" to "Speaker 1" for better display
        speaker = genericMatch[1].replace(/Speaker(\d+)/i, 'Speaker $1').trim();
        text = line.slice(genericMatch[0].length).trim();
      }
    }
    
    if (speaker && text) {
      if (!speakerMap.has(speaker.toLowerCase())) {
        speakerMap.set(speaker.toLowerCase(), speakerCounter++);
      }
      
      lines.push({
        speaker,
        text,
        speakerIndex: speakerMap.get(speaker.toLowerCase()) || 0,
      });
    } else if (lines.length > 0 && line.trim()) {
      // Continue previous speaker's dialogue
      lines[lines.length - 1].text += ' ' + line.trim();
    } else if (line.trim()) {
      // No speaker identified, treat as narration
      lines.push({
        speaker: 'Narrator',
        text: line.trim(),
        speakerIndex: speakerMap.get('narrator') ?? (speakerMap.set('narrator', speakerCounter++), speakerCounter - 1),
      });
    }
  }
  
  return lines;
}

function TranscriptPart({ transcript, partNumber }: { transcript: string; partNumber: number }) {
  const lines = parseTranscript(transcript);
  const [selectedText, setSelectedText] = useState<string>('');
  const [showFlashcardButton, setShowFlashcardButton] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
  
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    
    if (text && text.length > 1 && text.length < 100) {
      setSelectedText(text);
      const range = selection?.getRangeAt(0);
      if (range) {
        const rect = range.getBoundingClientRect();
        setButtonPosition({ x: rect.left + rect.width / 2, y: rect.top - 40 });
        setShowFlashcardButton(true);
      }
    } else {
      setShowFlashcardButton(false);
    }
  }, []);

  const handleFlashcardSuccess = useCallback(() => {
    setShowFlashcardButton(false);
    window.getSelection()?.removeAllRanges();
  }, []);
  
  if (lines.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No transcript available for Part {partNumber}</p>
      </div>
    );
  }
  
  // Get unique speakers
  const uniqueSpeakers = [...new Set(lines.map(l => l.speaker))];
  
  return (
    <div className="space-y-4 relative" onMouseUp={handleMouseUp}>
      {/* Floating Add to Flashcard Button */}
      {showFlashcardButton && selectedText && (
        <div 
          className="fixed z-50 animate-in fade-in-0 zoom-in-95"
          style={{
            left: `${buttonPosition.x}px`,
            top: `${buttonPosition.y}px`,
            transform: 'translateX(-50%)'
          }}
        >
          <AddToFlashcardButton 
            word={selectedText}
            variant="button"
            className="shadow-lg"
            onSuccess={handleFlashcardSuccess}
          />
        </div>
      )}
      
      {/* Speaker Legend */}
      {uniqueSpeakers.length > 1 && (
        <div className="flex flex-wrap gap-2 pb-3 border-b border-border/50">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users size={14} />
            Speakers:
          </span>
          {uniqueSpeakers.map((speaker, idx) => {
            const colorIdx = idx % SPEAKER_COLORS.length;
            return (
              <Badge 
                key={speaker} 
                variant="outline" 
                className={cn("text-xs", SPEAKER_COLORS[colorIdx].badge)}
              >
                {speaker}
              </Badge>
            );
          })}
        </div>
      )}
      
      {/* Transcript Lines */}
      <div className="space-y-3">
        {lines.map((line, idx) => {
          const colorIdx = line.speakerIndex % SPEAKER_COLORS.length;
          const colors = SPEAKER_COLORS[colorIdx];
          
          return (
            <div 
              key={idx} 
              className={cn(
                "p-3 rounded-lg border-l-4 transition-colors",
                colors.bg,
                colors.border
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <User size={14} className={colors.text} />
                <span className={cn("text-sm font-medium", colors.text)}>
                  {line.speaker}
                </span>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed pl-6">
                {line.text}
              </p>
            </div>
          );
        })}
      </div>
      
      {/* Tip for adding to flashcards */}
      <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
        <BookOpen size={12} />
        <span>Select any word or phrase to add to flashcards</span>
      </div>
    </div>
  );
}

export function TranscriptViewer({ transcripts, defaultExpanded = false, className }: TranscriptViewerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  const availableParts = [
    { key: 'part1', label: 'Part 1', transcript: transcripts.part1 },
    { key: 'part2', label: 'Part 2', transcript: transcripts.part2 },
    { key: 'part3', label: 'Part 3', transcript: transcripts.part3 },
    { key: 'part4', label: 'Part 4', transcript: transcripts.part4 },
  ].filter(p => p.transcript);
  
  if (availableParts.length === 0) {
    return null;
  }
  
  const defaultTab = availableParts[0]?.key || 'part1';
  
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={className}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText size={20} />
                Audio Transcripts
                <Badge variant="secondary" className="ml-2">
                  {availableParts.length} {availableParts.length === 1 ? 'part' : 'parts'}
                </Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" className="gap-1">
                {isExpanded ? (
                  <>
                    <ChevronUp size={16} />
                    <span className="text-xs">Hide</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    <span className="text-xs">Show</span>
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0">
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${availableParts.length}, 1fr)` }}>
                {availableParts.map(part => (
                  <TabsTrigger key={part.key} value={part.key}>
                    {part.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              
              {availableParts.map(part => (
                <TabsContent key={part.key} value={part.key} className="mt-4">
                  <ScrollArea className="h-[400px] pr-4">
                    <TranscriptPart 
                      transcript={part.transcript!} 
                      partNumber={parseInt(part.key.replace('part', ''))} 
                    />
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default TranscriptViewer;
