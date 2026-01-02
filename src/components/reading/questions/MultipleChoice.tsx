import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { QuestionTextWithTools } from '@/components/common/QuestionTextWithTools';

// Options can be either plain strings or objects with label/text
type OptionItem = string | { label: string; text: string };

interface Question {
  id: string;
  question_number: number;
  question_text: string;
  options: OptionItem[] | null;
  option_format?: string | null;
}

// Helper to extract text from option (handles both string and object formats)
const getOptionText = (option: OptionItem): string => {
  const raw = typeof option === 'string' ? option : (option.text || '');

  // Avoid duplicated labels like "A. A ..." when the generated option already includes a prefix.
  // Examples handled: "A Recommended", "A. Recommended", "A) Recommended"
  const m = raw.match(/^\s*([A-Za-z])\s*[\.|\)]?\s*(.+)$/);
  if (m && m[2]) return m[2].trim();

  return raw;
};

// Helper to get the label from option (for object format) or generate from index
const getOptionLabelFromOption = (option: OptionItem, index: number, format: string | null | undefined): string => {
  if (typeof option === 'object' && option.label) {
    return option.label;
  }
  return getOptionLabel(index, format);
};

interface MultipleChoiceProps {
  testId: string;
  renderRichText: (text: string) => string;
  question: Question;
  answer: string | undefined;
  onAnswerChange: (answer: string) => void;
  isActive: boolean;
  maxAnswers?: number; // 1 = single select (radio), >1 = multi-select (checkboxes)
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

export function MultipleChoice({
  testId,
  renderRichText,
  question,
  answer,
  onAnswerChange,
  isActive: _isActive,
  maxAnswers = 1,
  onSetActive
}: MultipleChoiceProps) {
  const options = question.options || [];
  const optionFormat = question.option_format || 'A';
  const isSingleSelect = maxAnswers === 1;

  // For single select, answer is a single value
  // For multi select, answer is comma-separated values
  const selectedAnswers = isSingleSelect
    ? (answer ? [answer] : [])
    : (answer ? answer.split(',').filter(Boolean) : []);

  // Single Select (Radio Buttons)
  if (isSingleSelect) {
    return (
      <div 
        className="space-y-0.5 mt-1" 
        onClick={(e) => { e.stopPropagation(); onSetActive?.(); }}
        style={{ fontFamily: 'var(--font-ielts)' }}
      >
        <RadioGroup
          value={answer || ''}
          onValueChange={(value) => onAnswerChange(value)}
          className="space-y-0.5"
        >
          {options.map((option, idx) => {
            const optionLabel = getOptionLabelFromOption(option, idx, optionFormat);
            const optionText = getOptionText(option);
            const isSelected = answer === optionLabel;

            return (
              <label
                key={idx}
                htmlFor={`q${question.question_number}-${idx}`}
                className={cn(
                  "ielts-mcq-option",
                  isSelected && "ielts-mcq-option--selected"
                )}
              >
                <RadioGroupItem
                  value={optionLabel}
                  id={`q${question.question_number}-${idx}`}
                  className="ielts-mcq-indicator"
                />
                <span className="text-sm leading-relaxed flex-1">
                  <span className="font-medium">{optionLabel}.</span>{' '}
                  <QuestionTextWithTools
                    testId={testId}
                    contentId={`${question.id}-option-${idx}`}
                    text={optionText}
                    fontSize={14}
                    renderRichText={renderRichText}
                    isActive={false}
                    as="span"
                  />
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </div>
    );
  }

  // Multi Select (Checkboxes)
  const handleCheckboxChange = (option: OptionItem, checked: boolean) => {
    const optionIdx = options.indexOf(option);
    const optionLabel = getOptionLabelFromOption(option, optionIdx, optionFormat);
    let newAnswers: string[];

    if (checked) {
      if (selectedAnswers.length >= maxAnswers) {
        return; // Don't allow more selections
      }
      newAnswers = [...selectedAnswers, optionLabel];
    } else {
      newAnswers = selectedAnswers.filter(a => a !== optionLabel);
    }
    onAnswerChange(newAnswers.join(','));
  };

  const isMaxReached = selectedAnswers.length >= maxAnswers;

  return (
    <div 
      className="space-y-0.5 mt-1" 
      onClick={(e) => { e.stopPropagation(); onSetActive?.(); }}
      style={{ fontFamily: 'var(--font-ielts)' }}
    >
      <div className="text-xs text-muted-foreground mb-1">
        Select {maxAnswers} answer{maxAnswers > 1 ? 's' : ''} ({selectedAnswers.length}/{maxAnswers} selected)
      </div>
        {options.map((option, idx) => {
          const optionLabel = getOptionLabelFromOption(option, idx, optionFormat);
          const optionText = getOptionText(option);
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
              <span className="font-medium">{optionLabel}.</span>{' '}
              <QuestionTextWithTools
                testId={testId}
                contentId={`${question.id}-option-${idx}`}
                text={optionText}
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