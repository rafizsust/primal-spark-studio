import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { ArrowDown, ArrowRight } from 'lucide-react';

interface FlowchartStep {
  id: string;
  label: string;
  questionNumber?: number; // If has a blank to fill
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
                {/* Question number badge removed - the input placeholder shows the number */}

                {/* Content */}
                {step.isBlank && step.questionNumber ? (
                  <div className="text-muted-foreground text-sm leading-relaxed">
                    {(() => {
                      // Parse label to find blank marker like (3) or similar patterns
                      const blankPattern = new RegExp(`\\(${step.questionNumber}\\)|\\[${step.questionNumber}\\]|_{2,}|\\.\\.\\.|______`);
                      const match = step.label.match(blankPattern);
                      
                      if (match && match.index !== undefined) {
                        const before = step.label.substring(0, match.index);
                        const after = step.label.substring(match.index + match[0].length);
                        
                        return (
                          <span className="inline">
                            {before}
                            <Input
                              type="text"
                              value={answer || ''}
                              onChange={(e) => onAnswerChange(step.questionNumber!, e.target.value)}
                              placeholder={String(step.questionNumber)}
                              className={cn(
                                "inline-block h-6 w-20 text-xs rounded-[3px] text-center placeholder:font-bold placeholder:text-foreground/70 mx-1 align-baseline",
                                isActive
                                  ? "border-primary focus:ring-primary"
                                  : "border-border"
                              )}
                              onClick={(e) => e.stopPropagation()}
                            />
                            {after}
                          </span>
                        );
                      }
                      
                      // Fallback: show label with input below if no marker found
                      return (
                        <>
                          <span>{step.label}</span>
                          <Input
                            type="text"
                            value={answer || ''}
                            onChange={(e) => onAnswerChange(step.questionNumber!, e.target.value)}
                            placeholder={String(step.questionNumber)}
                            className={cn(
                              "h-7 text-sm min-w-[100px] max-w-full rounded-[3px] text-center placeholder:font-bold placeholder:text-foreground/70 mt-2",
                              isActive
                                ? "border-primary focus:ring-primary"
                                : "border-border"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </>
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
