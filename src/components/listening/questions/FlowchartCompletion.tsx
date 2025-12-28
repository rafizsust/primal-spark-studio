import { useState, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ArrowDown } from 'lucide-react';
import { QuestionTextWithTools } from '@/components/common/QuestionTextWithTools';

const TRANSPARENT_DRAG_IMAGE = typeof Image !== 'undefined'
  ? (() => {
      const img = new Image();
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
      return img;
    })()
  : null;

function hideDragGhost(e: React.DragEvent) {
  if (TRANSPARENT_DRAG_IMAGE && e.dataTransfer?.setDragImage) {
    e.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0);
  }
}

interface FlowchartStep {
  id: string;
  text: string;
  hasBlank: boolean;
  blankNumber?: number;
  alignment?: 'left' | 'center' | 'right';
}

interface FlowchartCompletionProps {
  testId: string;
  groupId: string;
  instruction: string;
  title?: string;
  flowchartSteps: FlowchartStep[];
  groupOptions: string[];
  groupOptionFormat: string;
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  onQuestionFocus?: (questionNumber: number) => void;
  fontSize: number;
  renderRichText: (text: string) => string;
  questionRange: string;
}

export function FlowchartCompletion({
  testId,
  title,
  flowchartSteps,
  groupOptions,
  answers,
  onAnswerChange,
  onQuestionFocus,
  fontSize,
  renderRichText,
}: FlowchartCompletionProps) {
  const [pressedOption, setPressedOption] = useState<string | null>(null);
  const [isDraggingBack, setIsDraggingBack] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Filter out empty options
  const validOptions = groupOptions.filter(opt => opt && opt.trim());

  // Steps that contain blanks (these are the only question numbers this component owns)
  const stepsWithBlanks = useMemo(
    () => flowchartSteps.filter((s) => s.hasBlank && s.blankNumber),
    [flowchartSteps]
  );

  const groupQuestionNumbers = useMemo(
    () => new Set(stepsWithBlanks.map((s) => s.blankNumber!).filter(Boolean)),
    [stepsWithBlanks]
  );

  // Track used options (only within THIS flowchart group)
  const usedOptions = new Set(
    Object.entries(answers)
      .filter(([qNum]) => groupQuestionNumbers.has(parseInt(qNum)))
      .map(([, opt]) => opt)
      .filter(Boolean)
  );

  // Check if any question in this group has been answered
  const hasAnyAnswer = Object.entries(answers).some(
    ([qNum, a]) => groupQuestionNumbers.has(parseInt(qNum)) && a && a !== ''
  );

  // Get first question number for initial highlight
  const firstQuestionNumber = stepsWithBlanks.length > 0
    ? Math.min(...stepsWithBlanks.map((s) => s.blankNumber!))
    : 0;

  const handleDragStart = (e: React.DragEvent, option: string, source: 'options' | 'dropzone') => {
    setPressedOption(null);
    hideDragGhost(e);
    e.dataTransfer.setData('option', option);
    e.dataTransfer.setData('source', source);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setPressedOption(null);
    setIsDraggingBack(false);
  };

  const handleDrop = useCallback((e: React.DragEvent, questionNumber: number) => {
    e.preventDefault();
    const option = e.dataTransfer.getData('option');
    const source = e.dataTransfer.getData('source');

    if (option) {
      // If dragging from another dropzone, clear that one first (ONLY within this group)
      if (source === 'dropzone') {
        const sourceQuestion = Object.entries(answers).find(
          ([qNum, opt]) => groupQuestionNumbers.has(parseInt(qNum)) && opt === option
        );
        if (sourceQuestion) {
          onAnswerChange(parseInt(sourceQuestion[0]), '');
        }
      }
      onAnswerChange(questionNumber, option);
      onQuestionFocus?.(questionNumber);
    }
  }, [answers, groupQuestionNumbers, onAnswerChange, onQuestionFocus]);

  // Handle dropping option back to the list
  const handleListDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggingBack(true);
  };

  const handleListDragLeave = (e: React.DragEvent) => {
    const listRect = listContainerRef.current?.getBoundingClientRect();
    if (listRect) {
      const { clientX, clientY } = e;
      const isOutside =
        clientX < listRect.left ||
        clientX > listRect.right ||
        clientY < listRect.top ||
        clientY > listRect.bottom;
      if (isOutside) {
        setIsDraggingBack(false);
      }
    }
  };

  const handleListDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingBack(false);
    const option = e.dataTransfer.getData('option');
    const source = e.dataTransfer.getData('source');

    if (option && source === 'dropzone') {
      const sourceQuestion = Object.entries(answers).find(
        ([qNum, opt]) => groupQuestionNumbers.has(parseInt(qNum)) && opt === option
      );
      if (sourceQuestion) {
        onAnswerChange(parseInt(sourceQuestion[0]), '');
      }
    }
  };

  // Parse step text to extract blanks and clean up formatting
  const parseStepText = (text: string, step: FlowchartStep) => {
    // First, strip parenthesized question numbers like "(1)", "(2)" etc. - they shouldn't display
    let cleanedText = text.replace(/\s*\(\d+\)\s*/g, ' ').trim();
    
    const blankRegex = /_{2,}\d*_{0,}/g;
    const parts: (string | { type: 'blank'; number: number })[] = [];
    let lastIndex = 0;
    let match;

    while ((match = blankRegex.exec(cleanedText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(cleanedText.substring(lastIndex, match.index).trim());
      }
      const numMatch = match[0].match(/\d+/);
      const blankNum = numMatch ? parseInt(numMatch[0]) : step.blankNumber || 1;
      parts.push({ type: 'blank', number: blankNum });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < cleanedText.length) {
      parts.push(cleanedText.substring(lastIndex).trim());
    }

    // Filter out empty string parts
    const filteredParts = parts.filter(p => p !== '');
    return filteredParts.length > 0 ? filteredParts : [cleanedText];
  };

  // Get alignment class
  const getAlignmentClass = (alignment?: 'left' | 'center' | 'right') => {
    switch (alignment) {
      case 'center': return 'text-center';
      case 'right': return 'text-right';
      default: return 'text-left';
    }
  };

  return (
    <div className="mb-6">
      {/* Flowchart Title */}
      {title && (
        <h4 className="font-bold text-foreground mb-4 text-base">
          {title}
        </h4>
      )}

      {/* Main Content - Flowchart on left, Options on right */}
      <div className="flex flex-col lg:flex-row lg:flex-wrap gap-6 lg:gap-8 items-start w-full min-w-0">
        {/* Left: Flowchart */}
        <div className="flex-1 max-w-md">
          {flowchartSteps.map((step, idx) => (
            <div key={step.id} className="relative">
              {/* Flowchart Box */}
              <div 
                className={cn(
                  "border border-foreground/40 bg-white px-4 py-3",
                  "text-sm leading-relaxed",
                  getAlignmentClass(step.alignment)
                )}
              >
                <span style={{ fontSize: `${fontSize}px` }}>
                  {parseStepText(step.text, step).map((part, partIdx) => {
                    if (typeof part === 'string') {
                      return (
                        <QuestionTextWithTools
                          key={partIdx}
                          testId={testId}
                          contentId={`${step.id}-part-${partIdx}`}
                          text={part}
                          fontSize={fontSize}
                          renderRichText={renderRichText}
                          isActive={false}
                          as="span"
                        />
                      );
                    }
                    // It's a blank - render drop zone
                    const questionNumber = part.number;
                    const answer = answers[questionNumber];
                    const showBlueBorder = !hasAnyAnswer && questionNumber === firstQuestionNumber;
                    return (
                      <FlowchartDropZone
                        key={`blank-${questionNumber}`}
                        questionNumber={questionNumber}
                        assignedOption={answer || null}
                        onDrop={handleDrop}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        fontSize={fontSize}
                        showBlueBorder={showBlueBorder}
                      />
                    );
                  })}
                </span>
              </div>

              {/* Arrow between boxes */}
              {idx < flowchartSteps.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="text-foreground/60" size={20} strokeWidth={2} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: Draggable Options - matches DragAndDropOptions exactly */}
        <div className="relative">
          <div
            ref={listContainerRef}
            className={cn(
              "relative z-10 flex flex-col gap-2 transition-all duration-200 rounded-lg p-4",
              isDraggingBack 
                ? "bg-[hsl(var(--ielts-ghost))]" 
                : "bg-transparent"
            )}
            onDragOver={handleListDragOver}
            onDragLeave={handleListDragLeave}
            onDrop={handleListDrop}
          >
            {validOptions.map((option, index) => {
              const isUsed = usedOptions.has(option);
              const isPressed = pressedOption === option;

              return (
                <div
                  key={`${option}-${index}`}
                  className="min-h-[32px]"
                >
                  {!isUsed ? (
                    <div
                      draggable
                      onMouseDown={() => setPressedOption(option)}
                      onMouseUp={() => setPressedOption(null)}
                      onMouseLeave={() => setPressedOption(null)}
                      onDragStart={(e) => handleDragStart(e, option, 'options')}
                      onDragEnd={handleDragEnd}
                      className="cursor-move"
                    >
                      <span
                        className={cn(
                          "ielts-drag-option inline-block text-sm text-foreground border border-[hsl(var(--ielts-drag-border))] px-2 py-1 transition-colors hover:border-[hsl(var(--ielts-drag-hover))] hover:border-2",
                          isPressed && "opacity-60"
                        )}
                        style={{ fontSize: `${fontSize}px`, fontFamily: 'var(--font-ielts)' }}
                      >
                        {option}
                      </span>
                    </div>
                  ) : (
                    <div className="h-full" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface FlowchartDropZoneProps {
  questionNumber: number;
  assignedOption: string | null;
  onDrop: (e: React.DragEvent, questionNumber: number) => void;
  onDragStart: (e: React.DragEvent, option: string, source: 'options' | 'dropzone') => void;
  onDragEnd: () => void;
  fontSize: number;
  showBlueBorder: boolean;
}

function FlowchartDropZone({ 
  questionNumber, 
  assignedOption, 
  onDrop, 
  onDragStart,
  onDragEnd,
  fontSize,
  showBlueBorder,
}: FlowchartDropZoneProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [isPressed, setIsPressed] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (spanRef.current) {
      spanRef.current.classList.add('border-sky-400', 'border-2');
      spanRef.current.classList.remove('border-dashed', 'border-foreground/40', 'border-muted-foreground/40');
    }
  };

  const handleDragLeave = () => {
    if (spanRef.current) {
      spanRef.current.classList.remove('border-sky-400', 'border-2');
      if (!assignedOption) {
        spanRef.current.classList.add('border-dashed', showBlueBorder ? 'border-sky-400' : 'border-muted-foreground/40');
      } else {
        spanRef.current.classList.add('border-foreground/40');
      }
    }
  };

  const handleDropLocal = (e: React.DragEvent) => {
    onDrop(e, questionNumber);
    if (spanRef.current) {
      spanRef.current.classList.remove('border-sky-400', 'border-2');
      spanRef.current.classList.add('border-foreground/40');
    }
  };

  const handleFilledDragStart = (e: React.DragEvent) => {
    if (!assignedOption) return;
    setIsPressed(false);
    onDragStart(e, assignedOption, 'dropzone');
  };

  const handleFilledDragEnd = () => {
    setIsPressed(false);
    onDragEnd();
  };

  // Filled state: draggable option - allow dragging back to options list
  if (assignedOption) {
    return (
      <span
        ref={spanRef}
        id={`question-${questionNumber}`}
        draggable={true}
        onMouseDown={(e) => {
          e.stopPropagation();
          setIsPressed(true);
        }}
        onMouseUp={() => setIsPressed(false)}
        onMouseLeave={() => setIsPressed(false)}
        onDragStart={(e) => {
          e.stopPropagation();
          handleFilledDragStart(e);
        }}
        onDragEnd={handleFilledDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropLocal}
        className={cn(
          "ielts-drop-zone--filled inline-block text-sm text-foreground border border-[hsl(var(--ielts-drag-border))] px-2 py-1 transition-colors cursor-move hover:border-[hsl(var(--ielts-drag-hover))] hover:border-2 mx-1",
          isPressed && "opacity-60"
        )}
        style={{ fontSize: `${fontSize}px`, fontFamily: 'var(--font-ielts)', userSelect: 'none' }}
      >
        {assignedOption}
      </span>
    );
  }

  // Empty state - drop zone
  return (
    <span
      ref={spanRef}
      id={`question-${questionNumber}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropLocal}
      className={cn(
        "ielts-drop-zone inline-flex items-center justify-center text-sm px-3 py-1 transition-colors min-w-[120px] text-center border mx-1",
        showBlueBorder
          ? "border-dashed border-[hsl(var(--ielts-drag-hover))]"
          : "border-dashed border-[hsl(var(--ielts-drag-border))]"
      )}
      style={{ fontSize: `${fontSize}px`, fontFamily: 'var(--font-ielts)' }}
    >
      <span className={cn(
        "select-none",
        showBlueBorder ? "text-foreground font-bold" : "text-muted-foreground/60"
      )}>{questionNumber}</span>
    </span>
  );
}