import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Question {
  id: string;
  question_number: number;
  question_text: string;
  options: string[] | null;
  instruction?: string | null;
}

interface FillInBlankProps {
  question: Question;
  answer: string | undefined;
  onAnswerChange: (answer: string) => void;
  isActive: boolean;
  onSetActive?: () => void;
  useDropdown?: boolean;
  wordBank?: string[];
}

export function FillInBlank({
  question,
  answer,
  onAnswerChange,
  isActive,
  onSetActive,
  useDropdown = false,
  wordBank = [],
}: FillInBlankProps) {
  // Match any sequence of 2 or more underscores as a blank
  const blankPattern = /_{2,}/;
  const hasInlineBlank = blankPattern.test(question.question_text);

  const renderControl = () => {
    if (useDropdown) {
      return (
        <Select value={answer || ''} onValueChange={(v) => onAnswerChange(v)}>
          <SelectTrigger
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex w-28 h-7 px-2 text-sm font-bold align-baseline mx-0.5 rounded-[3px]",
              "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
              "focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
              isActive && "border-[hsl(var(--ielts-input-focus))]"
            )}
            style={{ verticalAlign: 'baseline' }}
          >
            <SelectValue placeholder={String(question.question_number)} />
          </SelectTrigger>
          <SelectContent className="z-50 bg-background border border-[hsl(var(--ielts-input-border))] rounded-[3px]">
            {wordBank.length > 0 ? (
              wordBank.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))
            ) : (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No options available</div>
            )}
          </SelectContent>
        </Select>
      );
    }

    return (
      <span className="relative inline-flex items-center mx-0.5">
        <input
          type="text"
          value={answer || ''}
          onChange={(e) => onAnswerChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onFocus={(e) => e.stopPropagation()}
          placeholder={String(question.question_number)}
          className={cn(
            "ielts-input h-7 text-sm font-normal text-center min-w-[174px] max-w-full rounded-[3px]",
            "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
            "focus:outline-none focus:border-[hsl(var(--ielts-input-focus))] focus:border-2",
            "transition-colors placeholder:text-center placeholder:font-bold placeholder:text-foreground/70",
            isActive && "border-[hsl(var(--ielts-input-focus))] border-2"
          )}
          style={{ verticalAlign: 'baseline', fontFamily: 'var(--font-ielts)' }}
        />
      </span>
    );
  };

  const controlElement = renderControl();

  if (hasInlineBlank) {
    // Split by any sequence of 2+ underscores
    const parts = question.question_text.split(/_{2,}/);

    return (
      <div onClick={() => { onSetActive?.(); }} className="mt-2">
        <p
          className={cn(
            "leading-relaxed",
            isActive ? "text-foreground" : "text-foreground"
          )}
          style={{ lineHeight: '2' }}
        >
          {parts.map((part, idx) => {
            // Remove trailing question number (e.g., "32." or "32") before the blank
            const cleanedPart = idx < parts.length - 1 
              ? part.replace(/\s*\d+\.?\s*$/, ' ')
              : part;
            return (
              <span key={idx}>
                <span dangerouslySetInnerHTML={{ __html: renderText(cleanedPart) }} />
                {idx < parts.length - 1 && controlElement}
              </span>
            );
          })}
        </p>
      </div>
    );
  }

  return (
    <span onClick={() => onSetActive?.()} className="inline-flex items-baseline">
      {controlElement}
    </span>
  );
}

function renderText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

