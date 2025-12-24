import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


interface Question {
  id: string;
  question_number: number;
  question_text: string;
  options: string[] | null;
}

interface SummaryCompletionProps {
  question: Question;
  answer: string | undefined;
  onAnswerChange: (answer: string) => void;
  isActive: boolean;
  onSetActive?: () => void;
}

// Helper to render basic formatting
function renderText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

export function SummaryCompletion({ question, answer, onAnswerChange, isActive, onSetActive }: SummaryCompletionProps) {
  const options = question.options;
  const hasWordBox = options && options.length > 0;
  
  // Check for inline blanks: _____ or numbered blanks like 34_____ or _____34
  const hasInlineBlank = question.question_text.includes('_____');
  
  // If there's an inline blank, render with input in the text
  if (hasInlineBlank) {
    // Split by the blank pattern and filter out empty/underscore-only parts
    const parts = question.question_text.split('_____');
    
    return (
      <div 
        onClick={(e) => { e.stopPropagation(); onSetActive?.(); }}
        className="mt-0"
        style={{ fontFamily: 'var(--font-ielts)' }}
      >
        <span className="leading-relaxed text-foreground">
          {parts.map((part, idx) => {
            // Clean up the part - remove leading question numbers and trailing underscores
            let cleanedPart = part
              .replace(/^\s*\d+\s*/, '') // Remove leading question number
              .replace(/_+$/, '') // Remove trailing underscores
              .replace(/^_+/, ''); // Remove leading underscores
            
            return (
              <span key={idx}>
                {cleanedPart && (
                  <span dangerouslySetInnerHTML={{ __html: renderText(cleanedPart) }} />
                )}
                {idx < parts.length - 1 && (
                  hasWordBox ? (
                    <Select value={answer || ''} onValueChange={onAnswerChange}>
                      <SelectTrigger 
                        className={cn(
                          "w-28 h-7 text-sm px-2 inline-flex mx-1 rounded-[3px]",
                          "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
                          "focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
                          isActive && "border-[hsl(var(--ielts-input-focus))] border-2"
                        )}
                        style={{ display: 'inline-flex', verticalAlign: 'baseline', fontFamily: 'var(--font-ielts)' }}
                      >
                        <SelectValue placeholder={String(question.question_number)} />
                      </SelectTrigger>
                      <SelectContent className="bg-background border border-[hsl(var(--ielts-input-border))] rounded-[3px]">
                        {options!.map((option, optIdx) => (
                          <SelectItem key={optIdx} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="ielts-input-with-number inline-flex items-center mx-1">
                      <span className="ielts-input-number-inside">{question.question_number}</span>
                      <input
                        type="text"
                        value={answer || ''}
                        onChange={(e) => onAnswerChange(e.target.value)}
                        placeholder={String(question.question_number)}
                        className={cn(
                          "ielts-input h-7 text-sm pl-7 pr-2 min-w-[174px] max-w-full rounded-[3px]",
                          "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
                          "focus:outline-none focus:border-[hsl(var(--ielts-input-focus))] focus:border-2",
                          "placeholder:font-bold placeholder:text-foreground/70",
                          isActive && "border-[hsl(var(--ielts-input-focus))] border-2"
                        )}
                        style={{ verticalAlign: 'baseline' }}
                      />
                    </span>
                  )
                )}
              </span>
            );
          })}
        </span>
      </div>
    );
  }

  // Fallback: No inline blank - show input below (legacy behavior)
  if (hasWordBox) {
    return (
      <div 
        onClick={(e) => { e.stopPropagation(); onSetActive?.(); }}
        style={{ fontFamily: 'var(--font-ielts)' }}
      >
        <Select value={answer || ''} onValueChange={onAnswerChange}>
          <SelectTrigger 
            className={cn(
              "w-28 h-7 text-sm px-2 rounded-[3px]",
              "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
              "focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
              isActive && "border-[hsl(var(--ielts-input-focus))] border-2"
            )}
            style={{ fontFamily: 'var(--font-ielts)' }}
          >
            <SelectValue placeholder={String(question.question_number)} />
          </SelectTrigger>
          <SelectContent className="bg-background border border-[hsl(var(--ielts-input-border))] rounded-[3px]">
            {options.map((option, idx) => (
              <SelectItem key={idx} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div 
      onClick={(e) => { e.stopPropagation(); onSetActive?.(); }}
      style={{ fontFamily: 'var(--font-ielts)' }}
    >
      <span className="ielts-input-with-number inline-flex items-center">
        <span className="ielts-input-number-inside">{question.question_number}</span>
        <input
          type="text"
          value={answer || ''}
          onChange={(e) => onAnswerChange(e.target.value)}
          className={cn(
            "ielts-input min-w-[174px] h-7 text-sm pl-7 pr-2",
            isActive && "border-[hsl(var(--ielts-input-focus))] border-2"
          )}
        />
      </span>
    </div>
  );
}
