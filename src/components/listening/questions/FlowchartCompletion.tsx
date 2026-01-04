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
  instruction?: string; // kept for compatibility (some callers may still pass it)
  steps: FlowchartStep[];
  direction?: 'vertical' | 'horizontal';
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  currentQuestion: number;
  fontSize?: number;
}

export function FlowchartCompletion({
  title,
  // instruction is intentionally not rendered here because ListeningQuestions already renders the group instruction.
  steps,
  direction = 'vertical',
  answers,
  onAnswerChange,
  currentQuestion,
  fontSize = 14,
}: FlowchartCompletionProps) {
  const isVertical = direction === 'vertical';
  const ArrowIcon = isVertical ? ArrowDown : ArrowRight;

  // If title looks like an instruction (contains "words"), don't render it as a header
  const isTitleInstruction = title && /words|no more than/i.test(title);
  const displayTitle = isTitleInstruction ? null : title;

  const sanitizeLabel = (label: string, questionNumber?: number) => {
    if (!questionNumber) return label;

    let out = label;

    // Remove explicit question markers anywhere in the string
    out = out
      .replace(new RegExp(`\\(${questionNumber}\\)`, 'g'), '')
      .replace(new RegExp(`\\[${questionNumber}\\]`, 'g'), '')
      .replace(new RegExp(`\\bQ\\s*${questionNumber}\\b\\.?`, 'gi'), '')
      .replace(new RegExp(`^\\s*${questionNumber}\\s*[\\).:-]\\s*`, 'g'), '');
    // Note: do NOT try to rewrite underscore blank markers here; we keep them intact
    // so the inline blank detection can replace them with the input.

    return out.replace(/\s{2,}/g, ' ').trim();
  };

  return (
    <div className="space-y-3" style={{ fontSize: `${fontSize}px` }}>
      {/* Header Section */}
      {displayTitle && (
        <div className="mb-4">
          <h4 className="font-semibold text-base text-foreground mb-2">{displayTitle}</h4>
        </div>
      )}

      <div
        className={cn(
          'flex items-center justify-center gap-2',
          isVertical ? 'flex-col' : 'flex-row flex-wrap'
        )}
      >
        {steps.map((step, index) => {
          const isActive = step.questionNumber === currentQuestion;
          const answer = step.questionNumber ? answers[step.questionNumber] : undefined;
          const isLast = index === steps.length - 1;

          const displayLabel = sanitizeLabel(step.label, step.questionNumber);

          return (
            <div
              key={step.id}
              className={cn('flex items-center', isVertical ? 'flex-col' : 'flex-row')}
            >
              {/* Step Box */}
              <div
                className={cn(
                  'relative border-2 rounded-lg p-4 min-w-[180px] max-w-[280px] text-center transition-all',
                  isActive
                    ? 'border-primary bg-primary/5 shadow-md'
                    : 'border-border bg-card hover:border-muted-foreground/50'
                )}
              >
                {step.isBlank && step.questionNumber ? (
                  <div className="inline items-baseline flex-wrap">
                    {(() => {
                      // Match placeholders: (1), [1], 1__, ____, ..., ______
                      const blankPattern = new RegExp(
                        `\\(${step.questionNumber}\\)|\\[${step.questionNumber}\\]|\\b${step.questionNumber}\\s*_{1,}|_{2,}|\\.{3,}|______`
                      );
                      const match = displayLabel.match(blankPattern);

                      if (match && match.index !== undefined) {
                        const beforeRaw = displayLabel.substring(0, match.index);
                        const afterRaw = displayLabel.substring(match.index + match[0].length);

                        // If the match is just underscores ("__"), the number may remain in `beforeRaw` (e.g. "1__").
                        // Remove the trailing question number to ensure it only appears in the placeholder.
                        const before = beforeRaw
                          .replace(new RegExp(`\\b${step.questionNumber}\\b\\s*$`), '')
                          .replace(/\s{2,}/g, ' ')
                          .trimEnd();
                        
                        // Also remove leading question number patterns from after text (e.g. "1__" or "2__.")
                        const after = afterRaw
                          .replace(new RegExp(`^\\s*${step.questionNumber}\\s*_{1,}\\.?\\s*`), '')
                          .replace(/^_{1,}\\.?\\s*/, '')
                          .trimStart();

                        return (
                          <span className="text-muted-foreground text-sm">
                            {before}{before ? ' ' : null}
                            <Input
                              type="text"
                              value={answer || ''}
                              onChange={(e) => onAnswerChange(step.questionNumber!, e.target.value)}
                              placeholder={`(${step.questionNumber})`}
                              className={cn(
                                'inline-block h-7 w-[100px] text-sm rounded-[3px] text-center font-bold text-primary mx-1 align-middle',
                                isActive
                                  ? 'border-primary ring-1 ring-primary/20'
                                  : 'border-slate-300'
                              )}
                              onClick={(e) => e.stopPropagation()}
                            />
                            {after ? ` ${after}` : null}
                          </span>
                        );
                      }

                      // Fallback Layout (Label + Input)
                      return (
                        <>
                          {displayLabel && (
                            <p className="text-muted-foreground text-sm mb-2">{displayLabel}</p>
                          )}
                          <Input
                            type="text"
                            value={answer || ''}
                            onChange={(e) => onAnswerChange(step.questionNumber!, e.target.value)}
                            placeholder={`(${step.questionNumber})`}
                            className={cn(
                              'h-8 w-full text-sm font-bold text-center text-primary',
                              isActive ? 'border-primary' : 'border-slate-300'
                            )}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">{displayLabel}</span>
                )}
              </div>

              {/* Arrow Connector */}
              {!isLast && (
                <div
                  className={cn(
                    'flex items-center justify-center text-muted-foreground',
                    isVertical ? 'py-2' : 'px-2'
                  )}
                >
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
