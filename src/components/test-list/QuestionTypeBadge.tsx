import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Abbreviated labels for question types to keep UI clean
export const QUESTION_TYPE_ABBR: Record<string, { short: string; full: string }> = {
  // Reading types
  'TRUE_FALSE_NOT_GIVEN': { short: 'TFNG', full: 'True/False/Not Given' },
  'YES_NO_NOT_GIVEN': { short: 'YNNG', full: 'Yes/No/Not Given' },
  'MULTIPLE_CHOICE': { short: 'MCQ', full: 'Multiple Choice' },
  'MULTIPLE_CHOICE_SINGLE': { short: 'MCQ', full: 'Multiple Choice (Single)' },
  'MULTIPLE_CHOICE_MULTIPLE': { short: 'MCQ+', full: 'Multiple Choice (Multiple)' },
  'MATCHING_HEADINGS': { short: 'MH', full: 'Matching Headings' },
  'MATCHING_INFORMATION': { short: 'MI', full: 'Matching Information' },
  'MATCHING_SENTENCE_ENDINGS': { short: 'MSE', full: 'Matching Sentence Endings' },
  'MATCHING_FEATURES': { short: 'MF', full: 'Matching Features' },
  'SENTENCE_COMPLETION': { short: 'SC', full: 'Sentence Completion' },
  'SUMMARY_COMPLETION': { short: 'SUM', full: 'Summary Completion' },
  'SUMMARY_WORD_BANK': { short: 'SWB', full: 'Summary with Word Bank' },
  'FILL_IN_BLANK': { short: 'FIB', full: 'Fill in the Blank' },
  'NOTE_COMPLETION': { short: 'NC', full: 'Note Completion' },
  'SHORT_ANSWER': { short: 'SA', full: 'Short Answer' },
  'TABLE_COMPLETION': { short: 'TBL', full: 'Table Completion' },
  'TABLE_SELECTION': { short: 'TS', full: 'Table Selection' },
  'FLOWCHART_COMPLETION': { short: 'FC', full: 'Flowchart Completion' },
  'DIAGRAM_LABELLING': { short: 'DL', full: 'Diagram Labelling' },
  
  // Listening types
  'MATCHING_CORRECT_LETTER': { short: 'MCL', full: 'Matching Correct Letter' },
  'MAPS': { short: 'MAP', full: 'Map Labelling' },
  'MAP_LABELING': { short: 'MAP', full: 'Map Labelling' },
  'DRAG_AND_DROP_OPTIONS': { short: 'D&D', full: 'Drag and Drop' },
};

// Convert DB format to URL format for links
export const toUrlFormat = (type: string): string => {
  return type.toLowerCase().replace(/_/g, '-');
};

export const getQuestionTypeInfo = (type: string): { short: string; full: string } => {
  return QUESTION_TYPE_ABBR[type] || { 
    short: type.slice(0, 4).toUpperCase(), 
    full: type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  };
};

interface QuestionTypeBadgeProps {
  type: string;
  clickable?: boolean;
  testId?: string;
  testType?: 'reading' | 'listening';
  partNumber?: number;
  className?: string;
}

export function QuestionTypeBadge({
  type,
  clickable = false,
  testId,
  testType,
  partNumber,
  className,
}: QuestionTypeBadgeProps) {
  const info = getQuestionTypeInfo(type);
  
  const badge = (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-tight",
        "bg-primary/10 text-primary border border-primary/20",
        clickable && "hover:bg-primary/20 hover:scale-105 transition-all cursor-pointer",
        className
      )}
    >
      {info.short}
    </span>
  );

  if (clickable && testId && testType) {
    const href = partNumber 
      ? `/${testType}/test/${testId}?part=${partNumber}&type=${toUrlFormat(type)}`
      : `/${testType}/test/${testId}?type=${toUrlFormat(type)}`;
    
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <a href={href} onClick={(e) => e.stopPropagation()}>
              {badge}
            </a>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {info.full}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {info.full}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
