import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MatchingInformationQuestion {
  question_number: number;
  statement_before: string;
  statement_after?: string;
}

interface MatchingOption {
  letter: string;
  text: string;
}

interface MatchingInformationProps {
  questions: MatchingInformationQuestion[];
  options: MatchingOption[];
  optionsTitle?: string;
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  currentQuestion?: number;
  onSetActive?: (questionNumber: number) => void;
  fontSize?: number;
}

export function MatchingInformation({
  questions,
  options,
  optionsTitle = 'List of Information',
  answers,
  onAnswerChange,
  currentQuestion,
  onSetActive,
  fontSize = 14,
}: MatchingInformationProps) {
  return (
    <div className="space-y-3" style={{ fontSize: `${fontSize}px`, fontFamily: 'var(--font-ielts)' }}>
      {/* Options Reference List */}
      <div className="pb-3">
        <h4 className="font-bold text-sm mb-2">{optionsTitle}</h4>
        <div className="grid gap-0.5">
          {options.map((option) => (
            <div key={option.letter} className="text-sm">
              <span className="font-bold">{option.letter}.</span>{' '}
              {option.text}
            </div>
          ))}
        </div>
      </div>

      {/* Questions with Inline Dropdown */}
      <div className="space-y-2">
        {questions.map((q) => {
          const isActive = currentQuestion === q.question_number;
          const answer = answers[q.question_number] || '';

          return (
            <div
              key={q.question_number}
              className={cn(
                "py-1 cursor-pointer transition-colors",
                isActive && "bg-[hsl(var(--ielts-option-hover,0_0%_96%))]"
              )}
              onClick={() => onSetActive?.(q.question_number)}
            >
              {/* Question text with inline dropdown - question number inside dropdown */}
              <span className="leading-relaxed text-sm">
                {q.statement_before}
                <span className="inline-flex items-center mx-1 align-baseline">
                  <Select
                    value={answer || ''}
                    onValueChange={(value) => onAnswerChange(q.question_number, value)}
                  >
                    <SelectTrigger 
                      className={cn(
                        "w-28 h-7 text-sm px-2 rounded-[3px]",
                        "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
                        "focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
                        answer && "border-[hsl(var(--ielts-input-focus))]"
                      )}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <SelectValue placeholder={String(q.question_number)} />
                    </SelectTrigger>
                    <SelectContent className="bg-background border border-[hsl(var(--ielts-input-border))] rounded-[3px]">
                      {options.map((option) => (
                        <SelectItem key={option.letter} value={option.letter}>
                          {option.letter}. {option.text}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </span>
                {q.statement_after && <span>{q.statement_after}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}