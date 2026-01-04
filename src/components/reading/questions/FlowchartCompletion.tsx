import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { ArrowDown, ArrowRight } from 'lucide-react';

interface FlowchartStep {
  id: string;
  label: string;
  questionNumber?: number;
  isBlank?: boolean;
}

interface FlowchartCompletionProps {
  title?: string;
  steps: FlowchartStep[];
  direction?: 'vertical' | 'horizontal';
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  currentQuestion: number;
  fontSize?: number;
}

export function FlowchartCompletion({
  title,
  steps,
  direction = 'vertical',
  answers,
  onAnswerChange,
  currentQuestion,
  fontSize = 14,
}: FlowchartCompletionProps) {
  const isVertical = direction === 'vertical';
  const ArrowIcon = isVertical ? ArrowDown : ArrowRight;

  // Parse label to extract text before/after blank marker
  const parseBlankLabel = (label: string, questionNumber: number) => {
    // Match patterns like (3), [3], __, ___, ..., ______
    const blankPattern = new RegExp(`\\(${questionNumber}\\)|\\[${questionNumber}\\]|_{2,}|\\.{3,}|______`);
    const match = label.match(blankPattern);
    
    if (match && match.index !== undefined) {
      return {
        before: label.substring(0, match.index).trim(),
        after: label.substring(match.index + match[0].length).trim(),
        hasMarker: true,
      };
    }
    
    // No marker found - just show label with input after
    return { before: label, after: '', hasMarker: false };
  };

  return (
    <div className="space-y-3" style={{ fontSize: `${fontSize}px` }}>
      {title && (
        <h4 className="font-semibold text-base text-foreground mb-3">{title}</h4>
      )}
      
      <div className={cn(
        "flex items-center justify-center gap-2",
        isVertical ? "flex-col" : "flex-row flex-wrap"
      )}>
        {steps.map((step, index) => {
          const isActive = step.questionNumber === currentQuestion;
          const answer = step.questionNumber ? answers[step.questionNumber] : undefined;
          const isLast = index === steps.length - 1;
          const showInput = step.isBlank && step.questionNumber;

          return (
            <div key={step.id} className={cn(
              "flex items-center",
              isVertical ? "flex-col" : "flex-row"
            )}>
              {/* Flowchart Box */}
              <div
                className={cn(
                  "relative border-2 rounded-lg p-4 min-w-[180px] max-w-[280px] text-center transition-all",
                  isActive
                    ? "border-primary bg-primary/5 shadow-md"
                    : "border-border bg-card hover:border-muted-foreground/50"
                )}
              >
                {showInput ? (
                  <div className="text-muted-foreground text-sm leading-relaxed">
                    {(() => {
                      const { before, after } = parseBlankLabel(step.label, step.questionNumber!);
                      
                      return (
                        <span className="inline items-baseline flex-wrap">
                          {before && <span>{before} </span>}
                          <span className="inline-flex items-baseline">
                            <Input
                              type="text"
                              value={answer || ''}
                              onChange={(e) => onAnswerChange(step.questionNumber!, e.target.value)}
                              placeholder={String(step.questionNumber)}
                              className={cn(
                                "inline-block h-7 min-w-[100px] max-w-[140px] text-sm rounded-[3px] text-center placeholder:font-bold placeholder:text-foreground/70 align-baseline",
                                isActive
                                  ? "border-primary focus:ring-primary"
                                  : "border-border"
                              )}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </span>
                          {after && <span> {after}</span>}
                        </span>
                      );
                    })()}
                  </div>
                ) : (
                  <span className="text-foreground font-medium">{step.label}</span>
                )}
              </div>

              {/* Arrow */}
              {!isLast && (
                <div className={cn(
                  "flex items-center justify-center text-muted-foreground",
                  isVertical ? "py-2" : "px-2"
                )}>
                  <ArrowIcon className="w-5 h-5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
