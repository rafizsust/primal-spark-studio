import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { QuestionTextWithTools } from '@/components/common/QuestionTextWithTools';

interface Question {
  id: string;
  question_number: number;
  question_text: string;
  options: string[] | null;
  option_format?: string | null;
}

interface MultipleChoiceMultipleProps {
  testId: string;
  renderRichText: (text: string) => string;
  question: Question;
  answer: string | undefined;
  onAnswerChange: (answer: string) => void;
  isActive: boolean;
  maxAnswers?: number;
  onSetActive?: () => void;
}

// Helper function to get option label (A, B, C or 1, 2, 3 etc.)
const getOptionLabel = (index: number, format: string | null | undefined) => {
  if (format === '1') return String(index + 1);
  if (format === 'i') {
    const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
    return romanNumerals[index] || String(index + 1);
  }
  return String.fromCharCode(65 + index); // Default to 'A' format
};

export function MultipleChoiceMultiple({
  testId,
  renderRichText,
  question,
  answer,
  onAnswerChange,
  isActive: _isActive,
  maxAnswers = 2,
  onSetActive
}: MultipleChoiceMultipleProps) {
  const options = (question.options || []).map((opt) => {
    // Avoid duplicated labels like "A. A ..." when option already contains its own prefix.
    const m = opt.match(/^\s*([A-Za-z])\s*[\.|\)]?\s*(.+)$/);
    return m && m[2] ? m[2].trim() : opt;
  });
  const selectedAnswers = answer ? answer.split(',').filter(Boolean) : [];
  const optionFormat = question.option_format || 'A';

  const handleCheckboxChange = (optionText: string, checked: boolean) => {
    const optionLabel = getOptionLabel(options.indexOf(optionText), optionFormat);
    let newAnswers: string[];

    if (checked) {
      if (selectedAnswers.length >= maxAnswers) {
        return;
      }
      newAnswers = [...selectedAnswers, optionLabel];
    } else {
      newAnswers = selectedAnswers.filter(a => a !== optionLabel);
    }
    onAnswerChange(newAnswers.join(','));
  };

  const isMaxReached = selectedAnswers.length >= maxAnswers;

  return (
    <div className="space-y-0.5 mt-2" onClick={(e) => { e.stopPropagation(); onSetActive?.(); }}>
      <div className="text-xs text-muted-foreground mb-2">
        Select {maxAnswers} answer{maxAnswers > 1 ? 's' : ''} ({selectedAnswers.length}/{maxAnswers} selected)
      </div>
      {options.map((option, idx) => {
        const optionLabel = getOptionLabel(idx, optionFormat);
        const isChecked = selectedAnswers.includes(optionLabel);
        const isDisabled = !isChecked && isMaxReached;

        return (
          <label 
            key={idx}
            htmlFor={`q${question.question_number}-${idx}`}
            className={cn(
              "ielts-mcq-option",
              isChecked && "ielts-mcq-option--selected",
              isDisabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <Checkbox
              id={`q${question.question_number}-${idx}`}
              checked={isChecked}
              disabled={isDisabled}
              onCheckedChange={(checked) => handleCheckboxChange(option, checked as boolean)}
              className="ielts-checkbox"
            />
            <span className="text-sm leading-relaxed flex-1">
              <QuestionTextWithTools
                testId={testId}
                contentId={`${question.id}-option-${idx}`}
                text={option}
                fontSize={14}
                renderRichText={renderRichText}
                isActive={false}
                as="span"
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}
