import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface HeadingOption {
  id: string;
  text: string;
}

interface MatchingHeadingsDragDropProps {
  options: HeadingOption[];
  paragraphLabels: string[];
  answers: Record<string, string>; // paragraphLabel -> headingId
  onAnswerChange: (paragraphLabel: string, headingId: string | null) => void;
  onQuestionFocus?: (questionNumber: number) => void;
  isQuestionPanel?: boolean;
  // Click-to-select props - controlled from parent
  selectedHeading?: string | null;
  onSelectedHeadingChange?: (headingId: string | null) => void;
}

export function MatchingHeadingsDragDrop({ 
  options,
  paragraphLabels,
  answers, 
  onAnswerChange,
  isQuestionPanel = true,
  selectedHeading: controlledSelectedHeading,
  onSelectedHeadingChange
}: MatchingHeadingsDragDropProps) {
  const [draggedHeading, setDraggedHeading] = useState<string | null>(null);
  const [pressedHeading, setPressedHeading] = useState<string | null>(null);
  const [isDragOverList, setIsDragOverList] = useState(false);
  // Use controlled or internal state for click-to-select
  const [internalSelectedHeading, setInternalSelectedHeading] = useState<string | null>(null);
  
  const selectedHeading = controlledSelectedHeading !== undefined ? controlledSelectedHeading : internalSelectedHeading;
  const setSelectedHeading = onSelectedHeadingChange || setInternalSelectedHeading;

  // Get used headings ONLY within THIS group (paragraph labels are not globally unique across the test)
  const usedHeadings = paragraphLabels
    .map((label) => answers[label])
    .filter((id): id is string => !!id);

  // Handle click selection
  const handleHeadingClick = useCallback((headingId: string) => {
    if (selectedHeading === headingId) {
      // Deselect if clicking same heading
      setSelectedHeading(null);
    } else {
      setSelectedHeading(headingId);
    }
  }, [selectedHeading]);

  // Clear selection when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.matching-headings-container')) {
        setSelectedHeading(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  const handleDragStart = (e: React.DragEvent, headingId: string, fromParagraph?: string) => {
    setPressedHeading(null);
    setDraggedHeading(headingId);
    setSelectedHeading(null); // Clear click selection on drag
    e.dataTransfer.setData('headingId', headingId);
    if (fromParagraph) {
      e.dataTransfer.setData('fromParagraph', fromParagraph);
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedHeading(null);
    setPressedHeading(null);
    setIsDragOverList(false);
  };

  // Handle dropping heading back to the list
  const handleListDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOverList(true);
  };

  const handleListDragLeave = () => {
    setIsDragOverList(false);
  };

  const handleListDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverList(false);
    setDraggedHeading(null);
    setPressedHeading(null);
    const fromParagraph = e.dataTransfer.getData('fromParagraph');
    if (fromParagraph) {
      onAnswerChange(fromParagraph, null);
    }
  };

  if (isQuestionPanel) {
    return (
      <div className="matching-headings-container space-y-2" style={{ fontFamily: 'var(--font-ielts)' }}>
        {/* List of Headings - Official IELTS Style */}
        <h4 className="text-sm font-bold text-foreground">
          List of Headings
        </h4>
        <p className="text-xs text-muted-foreground mb-2">
          Click to select, then click on a drop zone. Or drag and drop.
        </p>

        {/* Drop/hover area should be ONLY the list box */}
        <div
          className={cn(
            "inline-block max-w-full p-2 transition-colors",
            isDragOverList && "bg-[hsl(var(--ielts-ghost))]"
          )}
          onDragOver={handleListDragOver}
          onDragLeave={handleListDragLeave}
          onDrop={handleListDrop}
        >
          <div className="space-y-1.5">
            {options.map((option) => {
              const isUsed = usedHeadings.includes(option.id);
              const isPressed = pressedHeading === option.id;
              const isDragging = draggedHeading === option.id;
              const isSelected = selectedHeading === option.id;

              return (
                <div key={option.id} className="min-h-[32px]">
                  {!isUsed ? (
                    <div
                      draggable
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHeadingClick(option.id);
                      }}
                      onMouseDown={() => setPressedHeading(option.id)}
                      onMouseUp={() => setPressedHeading(null)}
                      onMouseLeave={() => setPressedHeading(null)}
                      onDragStart={(e) => handleDragStart(e, option.id)}
                      onDragEnd={handleDragEnd}
                      className="cursor-pointer"
                    >
                      <span
                        className={cn(
                          "ielts-drag-option",
                          "hover:border-[hsl(var(--ielts-drag-hover))]",
                          isPressed && "opacity-60",
                          isDragging && "opacity-40 scale-95",
                          isSelected && "border-2 border-[hsl(var(--ielts-drag-hover))] bg-[hsl(var(--ielts-input-focus)/0.1)] shadow-sm"
                        )}
                      >
                        {option.text}
                      </span>
                    </div>
                  ) : (
                    // Empty placeholder to maintain fixed slot position
                    <div className="h-full" />
                  )}
                </div>
              );
            })}
          </div>

        </div>

        {selectedHeading && (
          <div className="text-xs text-[hsl(var(--ielts-input-focus))] text-center py-1 font-medium">
            Now click on a paragraph drop zone to place this heading
          </div>
        )}
      </div>
    );
  }

  return null;
}

// Separate component for drop zones in passage
interface ParagraphDropZoneProps {
  label: string;
  questionNumber?: number;
  assignedHeading: { id: string; text: string } | null;
  onDrop: (headingId: string) => void;
  onRemove: () => void;
  onQuestionFocus?: (questionNumber: number) => void;
  selectedHeading?: string | null;
  onSelectPlace?: () => void;
}

export function ParagraphDropZone({ 
  label, 
  questionNumber, 
  assignedHeading, 
  onDrop, 
  onRemove,
  onQuestionFocus,
  selectedHeading,
  onSelectPlace
}: ParagraphDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  // Reset pressed state when assignedHeading changes
  useEffect(() => {
    setIsPressed(false);
  }, [assignedHeading?.id]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const headingId = e.dataTransfer.getData('headingId');
    if (headingId) {
      onDrop(headingId);
      // Focus the question in navigation after drop
      if (questionNumber) {
        onQuestionFocus?.(questionNumber);
      }
    }
  };

  // Handle click-to-place
  const handleClick = () => {
    if (selectedHeading && onSelectPlace) {
      onSelectPlace();
      // Focus the question in navigation after click-to-place
      if (questionNumber) {
        onQuestionFocus?.(questionNumber);
      }
    }
  };

  const handleFilledDragStart = (e: React.DragEvent) => {
    if (!assignedHeading) return;
    setIsPressed(false);
    e.dataTransfer.setData('headingId', assignedHeading.id);
    e.dataTransfer.setData('fromParagraph', label);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFilledDragEnd = () => {
    setIsPressed(false);
  };

  // Filled state: draggable heading that matches the heading item shape
  if (assignedHeading) {
    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="mb-3"
      >
        <span 
          draggable
          onMouseDown={() => setIsPressed(true)}
          onMouseUp={() => setIsPressed(false)}
          onMouseLeave={() => setIsPressed(false)}
          onDragStart={handleFilledDragStart}
          onDragEnd={handleFilledDragEnd}
          onClick={onRemove}
          title="Click to remove, or drag to move"
          className={cn(
            "ielts-drag-option cursor-pointer",
            "hover:border-[hsl(var(--ielts-drag-hover))]",
            isPressed && "opacity-60",
            isDragOver && "border-[hsl(var(--ielts-drag-hover))] border-2"
          )}
        >
          {assignedHeading.text}
        </span>
      </div>
    );
  }

  // Empty state - click-to-place enabled when a heading is selected
  const canClickToPlace = !!selectedHeading;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className="mb-3"
    >
      <span 
        className={cn(
          "ielts-drop-zone block w-full",
          isDragOver && "ielts-drop-zone--active",
          canClickToPlace && "border-[hsl(var(--ielts-drag-hover))] cursor-pointer hover:bg-[hsl(var(--ielts-input-focus)/0.15)]"
        )}
        style={{ fontFamily: 'var(--font-ielts)' }}
      >
        {isDragOver ? (
          <span className="text-[hsl(var(--ielts-input-focus))] text-sm font-medium">Drop heading here</span>
        ) : canClickToPlace ? (
          <span className="text-[hsl(var(--ielts-input-focus))] text-sm font-medium">Click to place heading</span>
        ) : (
          <span className="text-muted-foreground/60 select-none text-sm">Question {questionNumber ?? '?'} - Drop heading here</span>
        )}
      </span>
    </div>
  );
}
