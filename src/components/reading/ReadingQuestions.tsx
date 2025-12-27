import { cn } from '@/lib/utils';
import {
  TrueFalseNotGiven,
  MultipleChoice,
  MultipleChoiceMultiple,
  FillInBlank,
  TableCompletion,
  SentenceCompletion,
  FlowchartCompletion,
  MapLabeling,
  NoteCompletion,
  SummaryWordBank,
} from './questions';
import { MatchingFeatures } from './questions/MatchingFeatures';
import { MatchingInformation } from './questions/MatchingInformation';
import { ReadingTableCompletion } from './questions/ReadingTableCompletion';
import { TableSelection } from './questions/TableSelection';
import { MatchingHeadingsDragDrop } from './questions/MatchingHeadingsDragDrop';
import { MatchingSentenceEndingsDragDrop } from './questions/MatchingSentenceEndingsDragDrop';
import { QuestionTextWithTools } from '@/components/common/QuestionTextWithTools';
import { NoteStyleFillInBlank } from '@/components/listening/questions/NoteStyleFillInBlank';
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
  question_type: string;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  instruction: string | null;
  passage_id: string;
  question_group_id: string | null;
  heading?: string | null;
  table_data?: any;
  // For MCQ Multiple sub-groups
  sub_group_start?: number;
  sub_group_end?: number;
}

interface HeadingOption {
  id: string;
  text: string;
}

interface ReadingQuestionsProps {
  testId: string;
  questions: Question[];
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  currentQuestion: number;
  setCurrentQuestion: (num: number) => void;
  fontSize?: number;
  // Matching headings props
  headingOptions?: HeadingOption[];
  headingAnswers?: Record<string, string>;
  paragraphLabels?: string[];
  onHeadingAnswerChange?: (paragraphLabel: string, headingId: string | null) => void;
  getMaxAnswers?: (questionGroupId: string | null) => number;
  getMatchingSentenceEndingsGroupOptions?: (questionGroupId: string | null) => string[];
  getTableSelectionOptions?: (questionGroupId: string | null) => string[];
  getQuestionGroupOptions?: (questionGroupId: string | null) => any;
  renderRichText: (text: string) => string; // Accept renderRichText prop
  // Click-to-select props for matching headings
  selectedHeading?: string | null;
  onSelectedHeadingChange?: (headingId: string | null) => void;
}

export function ReadingQuestions({ 
  testId,
  questions, 
  answers, 
  onAnswerChange,
  currentQuestion,
  setCurrentQuestion,
  fontSize = 14,
  headingOptions = [],
  headingAnswers = {},
  paragraphLabels = [],
  onHeadingAnswerChange,
  getMaxAnswers,
  getMatchingSentenceEndingsGroupOptions,
  getTableSelectionOptions,
  getQuestionGroupOptions,
  renderRichText, // Accept renderRichText prop
  selectedHeading,
  onSelectedHeadingChange
}: ReadingQuestionsProps) {
  // Removed expandedTFNQ state as options will always be visible

  // Group questions by type and also by question_group_id for types that need it
  const groupedQuestionsByGroup: Record<string, Record<string, Question[]>> = {};

  questions.forEach(q => {
    if (!groupedQuestionsByGroup[q.question_type]) {
      groupedQuestionsByGroup[q.question_type] = {};
    }
    const groupId = q.question_group_id || '_no_group_id';
    if (!groupedQuestionsByGroup[q.question_type][groupId]) {
      groupedQuestionsByGroup[q.question_type][groupId] = [];
    }
    groupedQuestionsByGroup[q.question_type][groupId].push(q);
  });

  const getQuestionTypeLabel = (type: string) => {
    switch (type) {
      case 'TRUE_FALSE_NOT_GIVEN':
        return 'True / False / Not Given';
      case 'YES_NO_NOT_GIVEN':
        return 'Yes / No / Not Given';
      case 'MATCHING_HEADINGS':
        return 'Matching Headings';
      case 'MATCHING_INFORMATION':
        return 'Matching Information';
      case 'MATCHING_SENTENCE_ENDINGS':
        return 'Matching Sentence Endings';
      case 'MULTIPLE_CHOICE':
        return 'Multiple Choice';
      case 'MULTIPLE_CHOICE_MULTIPLE':
        return 'Multiple Choice (Multiple Answers)';
      case 'FILL_IN_BLANK':
      case 'SENTENCE_COMPLETION':
      case 'SHORT_ANSWER':
      case 'SUMMARY_COMPLETION':
        return 'Fill in Gap / Sentence Completion';
      case 'NOTE_COMPLETION':
        return 'Note Completion';
      case 'SUMMARY_WORD_BANK':
        return 'Summary Completion (Word Bank)';
      case 'TABLE_COMPLETION':
        return 'Table Completion';
      case 'FLOWCHART_COMPLETION':
        return 'Flow-chart Completion';
      case 'MAP_LABELING':
        return 'Map Labeling';
      case 'TABLE_SELECTION':
        return 'Matching Grid';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const getQuestionRange = (typeQuestions: Question[]) => {
    // For MCQ Multiple with sub-groups, use sub_group_start/end
    const hasSubGroups = typeQuestions.some(q => q.sub_group_start !== undefined && q.sub_group_end !== undefined);
    
    if (hasSubGroups) {
      const allStarts = typeQuestions.map(q => q.sub_group_start || q.question_number);
      const allEnds = typeQuestions.map(q => q.sub_group_end || q.question_number);
      const minStart = Math.min(...allStarts);
      const maxEnd = Math.max(...allEnds);
      if (minStart === maxEnd) return `${minStart}`;
      return `${minStart} to ${maxEnd}`;
    }
    
    // For TABLE_COMPLETION, extract question numbers from table_data
    const firstQ = typeQuestions[0];
    if (firstQ?.question_type === 'TABLE_COMPLETION' && firstQ?.table_data) {
      const tableDataRaw = firstQ.table_data;
      const rows = Array.isArray(tableDataRaw) ? tableDataRaw : (tableDataRaw.rows || []);
      const questionNumbers: number[] = [];
      
      rows.forEach((row: any[]) => {
        row.forEach((cell: any) => {
          if (cell?.has_question && cell?.question_number) {
            questionNumbers.push(cell.question_number);
          }
        });
      });
      
      if (questionNumbers.length > 0) {
        const sorted = questionNumbers.sort((a, b) => a - b);
        if (sorted.length === 1) return `${sorted[0]}`;
        return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
      }
    }
    
    const numbers = typeQuestions.map(q => q.question_number).sort((a, b) => a - b);
    if (numbers.length === 0) return '';
    if (numbers.length === 1) return `${numbers[0]}`;
    return `${numbers[0]} to ${numbers[numbers.length - 1]}`;
  };

  const renderQuestionInput = (question: Question, isActive: boolean, onSetActive: () => void) => {
    const answer = answers[question.question_number];
    const handleChange = (value: string) => onAnswerChange(question.question_number, value);

    switch (question.question_type) {
      case 'TRUE_FALSE_NOT_GIVEN':
      case 'YES_NO_NOT_GIVEN':
        return (
          <TrueFalseNotGiven
            testId={testId}
            renderRichText={renderRichText}
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={isActive}
            onSetActive={onSetActive}
          />
        );
      
      case 'MULTIPLE_CHOICE':
        // Single select (maxAnswers = 1)
        return (
          <MultipleChoice
            testId={testId}
            renderRichText={renderRichText}
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={isActive}
            maxAnswers={1}
            onSetActive={onSetActive}
          />
        );
      
      case 'MULTIPLE_CHOICE_MULTIPLE':
        // Handled at group level - return null for individual rendering
        return null;
      
      case 'MATCHING_HEADINGS':
      case 'MATCHING_SENTENCE_ENDINGS':
        return null;

      case 'MATCHING_INFORMATION':
      case 'MATCHING_FEATURES':
        // Handled at group level - return null for individual rendering
        return null;
      
      case 'SENTENCE_COMPLETION': {
        // Use dedicated SentenceCompletion component that properly handles _____ patterns
        return (
          <SentenceCompletion
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={isActive}
            onSetActive={onSetActive}
          />
        );
      }
      
      case 'SHORT_ANSWER':
      case 'SUMMARY_COMPLETION':
      case 'NOTE_COMPLETION':
      case 'SUMMARY_WORD_BANK':
        // legacy types: treated as Fill in Blank
      case 'FILL_IN_BLANK': {
        const groupMeta = getQuestionGroupOptions
          ? getQuestionGroupOptions(question.question_group_id || null)
          : null;

        const groupOptions = groupMeta?.options || {};
        const useDropdown = !!groupMeta?.use_dropdown || !!groupOptions?.use_dropdown;
        
        // Extract word bank - handle both DB format (options.options) and AI format (options.word_bank)
        let wordBank: string[] = [];
        if (Array.isArray(groupOptions?.word_bank)) {
          // AI-generated format: word_bank is array of {id, text} objects - extract just IDs
          wordBank = groupOptions.word_bank.map((w: any) => 
            typeof w === 'string' ? w : w.id || ''
          );
        } else if (Array.isArray(groupOptions?.options)) {
          wordBank = groupOptions.options;
        } else if (Array.isArray(groupOptions)) {
          wordBank = groupOptions;
        }

        return (
          <FillInBlank
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={isActive}
            onSetActive={onSetActive}
            useDropdown={useDropdown}
            wordBank={wordBank}
          />
        );
      }
      
      case 'TABLE_COMPLETION':
        return (
          <TableCompletion
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={isActive}
            onSetActive={onSetActive}
          />
        );
      
      default:
        // Default to single-select multiple choice
        return (
          <MultipleChoice
            testId={testId}
            renderRichText={renderRichText}
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={isActive}
            maxAnswers={1}
            onSetActive={onSetActive}
          />
        );
    }
  };

  // Define question types that should NOT have active container highlighting
  const noHighlightTypes = [
    'MULTIPLE_CHOICE',
    'MULTIPLE_CHOICE_MULTIPLE',
  ];

  return (
    <div className="space-y-10" style={{ fontSize: `${fontSize}px`, fontFamily: 'var(--font-ielts)' }}>
      {Object.entries(groupedQuestionsByGroup).map(([type, groupsOfType]) => {
        const groupEntries = Object.entries(groupsOfType);
        const hasMultipleGroups = groupEntries.length > 1;
        
        // For MULTIPLE_CHOICE_MULTIPLE with multiple groups, show ONE section header
        const isMCQMultipleWithMultipleGroups = type === 'MULTIPLE_CHOICE_MULTIPLE' && hasMultipleGroups;
        
        // Calculate overall range for multiple groups
        const allQuestionsInType = groupEntries.flatMap(([_, qs]) => qs);
        const overallQuestionRange = getQuestionRange(allQuestionsInType);
        
        // Get instruction from first group for section header
        const firstGroupQuestions = groupEntries[0]?.[1] || [];
        const firstGroupMeta = getQuestionGroupOptions 
          ? getQuestionGroupOptions(firstGroupQuestions[0]?.question_group_id || null) 
          : null;
        const sectionMaxAnswers = firstGroupMeta?.options?.max_answers || 2;
        
        const numberToWordSection = (n: number) => {
          switch (n) {
            case 1: return 'ONE';
            case 2: return 'TWO';
            case 3: return 'THREE';
            case 4: return 'FOUR';
            case 5: return 'FIVE';
            default: return String(n);
          }
        };
        
        return (
          <div key={type} className="space-y-6">
            {/* Section header for MCQ Multiple with multiple groups */}
            {isMCQMultipleWithMultipleGroups && (
              <div className="question-group-header mb-4">
                <h3 className="font-semibold text-sm mb-2">
                  Questions {overallQuestionRange}
                </h3>
                <p className="text-sm text-foreground">
                  Choose <strong>{numberToWordSection(sectionMaxAnswers)}</strong> correct answers.
                </p>
              </div>
            )}
            
            {groupEntries.map(([groupId, typeQuestions], _groupIndex) => {
            const firstQuestionInGroup = typeQuestions[0];
            const instruction = firstQuestionInGroup.instruction;
            const questionRange = getQuestionRange(typeQuestions);
            const isActiveGroup = typeQuestions.some(q => q.question_number === currentQuestion);

            const groupMeta = getQuestionGroupOptions
              ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
              : null;

            // Fill-in-gap display options (stored on reading_question_groups)
            // Title options are inside groupMeta.options (the JSON options column)
            const groupOptions = groupMeta?.options || {};
            
            // Extract word bank - handle both DB format (options.options) and AI format (options.word_bank)
            const extractWordBank = () => {
              // AI-generated format: word_bank is array of {id, text} objects
              if (Array.isArray(groupOptions?.word_bank)) {
                return groupOptions.word_bank.map((w: any) => 
                  typeof w === 'string' ? w : w.id || ''
                );
              }
              // DB format: options array
              if (Array.isArray(groupOptions?.options)) return groupOptions.options;
              if (Array.isArray(groupOptions)) return groupOptions;
              return [];
            };
            
            const fillDisplay = {
              // Check both DB format (groupMeta.field) and AI-generated format (groupOptions.field)
              displayAsParagraph: !!groupMeta?.display_as_paragraph || !!groupOptions?.display_as_paragraph,
              showBullets: !!groupMeta?.show_bullets || !!groupOptions?.show_bullets,
              showHeadings: !!groupMeta?.show_headings || !!groupOptions?.show_headings,
              groupTitle: groupOptions?.group_title || '',
              titleCentered: !!groupOptions?.title_centered,
              titleColored: !!groupOptions?.title_colored,
              useDropdown: !!groupMeta?.use_dropdown || !!groupOptions?.use_dropdown,
              wordBank: extractWordBank(),
              wordBankWithText: Array.isArray(groupOptions?.word_bank) ? groupOptions.word_bank : [], // For displaying with text
              noteStyleEnabled: !!groupOptions?.note_style_enabled,
              noteCategories: groupOptions?.note_categories || [],
              paragraphText: groupOptions?.paragraph_text || '', // For paragraph display mode
            };


            const numberToWord = (n: number) => {
              switch (n) {
                case 1:
                  return 'ONE';
                case 2:
                  return 'TWO';
                case 3:
                  return 'THREE';
                case 4:
                  return 'FOUR';
                case 5:
                  return 'FIVE';
                default:
                  return String(n);
              }
            };

            const defaultInstruction = (() => {
              switch (type) {
                case 'TRUE_FALSE_NOT_GIVEN':
                  return "Choose **TRUE** if the statement agrees with the information given in the text, choose **FALSE** if the statement contradicts the information, or choose **NOT GIVEN** if there is no information on this.";
                case 'YES_NO_NOT_GIVEN':
                  return "Choose **YES** if the statement agrees with the information given in the text, choose **NO** if the statement contradicts the information, or choose **NOT GIVEN** if there is no information on this.";
                case 'MULTIPLE_CHOICE_MULTIPLE': {
                  const max = getMaxAnswers ? getMaxAnswers(firstQuestionInGroup.question_group_id || null) : 2;
                  return `Choose **${numberToWord(max)}** correct answers.`;
                }
                case 'FILL_IN_BLANK':
                case 'SENTENCE_COMPLETION':
                case 'SHORT_ANSWER':
                case 'SUMMARY_COMPLETION':
                case 'SUMMARY_WORD_BANK':
                case 'NOTE_COMPLETION':
                  return "Write **NO MORE THAN TWO WORDS** from the passage for each answer.";
                default:
                  return `Answer the following ${getQuestionTypeLabel(type).toLowerCase()} questions.`;
              }
            })();

            const instructionText = instruction || defaultInstruction;

            // Determine if this question type should have the active container highlight
            const shouldHighlightContainer = !noHighlightTypes.includes(type);

            // Skip individual headers for MCQ Multiple when there are multiple groups (we show section header instead)
            const skipIndividualHeader = isMCQMultipleWithMultipleGroups;

            return (
              <div key={groupId} className="question-group-container">
                {/* Question Type Header - IELTS Official beige/gray style (skip for MCQ Multiple with multiple groups) */}
                {!skipIndividualHeader && (
                  <div className="ielts-question-header">
                    <h3>
                      Questions {questionRange}
                    </h3>
                    <div className="instruction-text">
                      <QuestionTextWithTools
                        testId={testId}
                        contentId={groupId + '-instruction'}
                        text={instructionText}
                        fontSize={fontSize}
                        renderRichText={renderRichText}
                        isActive={false}
                      />
                    </div>
                  </div>
                )}

                {/* Group Title (for Fill in Gap type) */}
                {fillDisplay.groupTitle && (
                  <h4 
                    className={cn(
                      "font-bold text-base mt-4 mb-3",
                      fillDisplay.titleCentered && "text-center",
                      fillDisplay.titleColored && "text-primary"
                    )}
                  >
                    {fillDisplay.groupTitle}
                  </h4>
                )}

                {/* Special handling for Matching Headings */}
                {type === 'MATCHING_HEADINGS' && onHeadingAnswerChange ? (
                  <MatchingHeadingsDragDrop
                    options={headingOptions}
                    paragraphLabels={paragraphLabels}
                    answers={headingAnswers}
                    onAnswerChange={onHeadingAnswerChange}
                    isQuestionPanel={true}
                    selectedHeading={selectedHeading}
                    onSelectedHeadingChange={onSelectedHeadingChange}
                  />
                ) : type === 'MULTIPLE_CHOICE_MULTIPLE' ? (
                  /* Multiple Choice Multiple - Using EXACT same approach as Listening section */
                  /* This renders as a SINGLE group with ONE question text, ONE answer counter, ONE set of options */
                  (() => {
                    const groupData = getQuestionGroupOptions
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;
                    
                    // Get options from group
                    const groupOptionsData = groupData?.options || {};
                    const mcqOptions = Array.isArray(groupOptionsData?.options) 
                      ? groupOptionsData.options 
                      : Array.isArray(groupOptionsData) 
                        ? groupOptionsData 
                        : [];
                    const optionFormat = groupOptionsData?.option_format || groupData?.option_format || 'A';

                    // Prefer explicit max_answers from group options; otherwise infer from question text ("Which TWO/THREE...").
                    const inferMaxAnswersFromText = (text: string | undefined): number | null => {
                      if (!text) return null;
                      const m = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b\s+(?:statements|answers|options|letters?)\b/i)
                        || text.match(/\bwhich\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
                      if (!m) return null;
                      const raw = m[1].toLowerCase();
                      const map: Record<string, number> = {
                        one: 1,
                        two: 2,
                        three: 3,
                        four: 4,
                        five: 5,
                        six: 6,
                        seven: 7,
                        eight: 8,
                        nine: 9,
                        ten: 10,
                      };
                      if (raw in map) return map[raw];
                      const asNum = Number(raw);
                      return Number.isFinite(asNum) && asNum > 0 ? asNum : null;
                    };

                    const inferred = inferMaxAnswersFromText(firstQuestionInGroup?.question_text);
                    const maxAnswersForGroup =
                      groupOptionsData?.max_answers || groupData?.max_answers || inferred || 2;
                    
                    // Calculate question range based on max_answers
                    const startQ = firstQuestionInGroup.question_number;
                    const endQ = startQ + maxAnswersForGroup - 1;
                    const mcqQuestionRange = maxAnswersForGroup > 1 ? `${startQ}-${endQ}` : `${startQ}`;
                    
                    // Get the first (and only) question for this group
                    const groupQuestion = typeQuestions[0];
                    
                    return (
                      <div 
                        id={`question-${startQ}`}
                        className="p-4 transition-all cursor-pointer mt-4"
                        onClick={() => setCurrentQuestion(startQ)}
                      >
                        <div className="flex-1 space-y-3">
                          {/* Group Heading (if any) - with proper range */}
                          {groupQuestion?.heading && (
                            <div className="mb-2 font-bold text-foreground">
                              <QuestionTextWithTools
                                testId={testId}
                                contentId={`${groupQuestion.id}-heading`}
                                text={groupQuestion.heading.replace(/Questions?\s+\d+/i, `Questions ${mcqQuestionRange}`)}
                                fontSize={fontSize}
                                renderRichText={renderRichText}
                                isActive={false} 
                              />
                            </div>
                          )}
                          {/* Main Question Text */}
                          <QuestionTextWithTools
                            contentId={groupQuestion?.id || `mcq-${startQ}`}
                            testId={testId}
                            text={groupQuestion?.question_text || ''}
                            fontSize={fontSize}
                            renderRichText={renderRichText}
                            isActive={isActiveGroup}
                          />
                          {/* Multiple Choice Multiple Answers Component - ONE set of options */}
                          <MultipleChoiceMultiple
                            testId={testId}
                            renderRichText={renderRichText}
                            question={{
                              id: groupQuestion?.id || `mcq-${startQ}`,
                              question_number: startQ,
                              question_text: groupQuestion?.question_text || '',
                              options: mcqOptions,
                              option_format: optionFormat,
                            }}
                            answer={answers[startQ]}
                            onAnswerChange={(value) => onAnswerChange(startQ, value)}
                            isActive={isActiveGroup}
                            maxAnswers={maxAnswersForGroup}
                            onSetActive={() => setCurrentQuestion(startQ)}
                          />
                        </div>
                      </div>
                    );
                  })()
                ) : type === 'MATCHING_FEATURES' ? (
                  /* Matching Features - statements with list of people/options */
                  (() => {
                    const groupData = getQuestionGroupOptions 
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;
                    const groupOptions = groupData?.options as any;
                    
                    // Get options array - could be stored as array directly or as options.options
                    const optionsArray = Array.isArray(groupOptions) 
                      ? groupOptions 
                      : Array.isArray(groupOptions?.options) 
                        ? groupOptions.options 
                        : [];
                    
                    // Transform to FeatureOption format {letter, text}
                    const featureOptions = optionsArray.map((opt: string, idx: number) => ({
                      letter: String.fromCharCode(65 + idx), // A, B, C, D...
                      text: opt
                    }));
                    
                    const optionsTitle = groupOptions?.options_title || 'List of People';
                    
                    // Transform questions to MatchingFeaturesQuestion format
                    const matchingQuestions = typeQuestions.map(q => ({
                      question_number: q.question_number,
                      statement_before: q.question_text,
                    }));
                    
                    return (
                      <MatchingFeatures
                        questions={matchingQuestions}
                        options={featureOptions}
                        optionsTitle={optionsTitle}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        currentQuestion={currentQuestion}
                        onSetActive={setCurrentQuestion}
                        fontSize={fontSize}
                      />
                    );
                  })()
                ) : type === 'MATCHING_SENTENCE_ENDINGS' && getMatchingSentenceEndingsGroupOptions ? (
                  <MatchingSentenceEndingsDragDrop
                    questions={typeQuestions}
                    groupOptions={getMatchingSentenceEndingsGroupOptions(firstQuestionInGroup.question_group_id || null)}
                    answers={answers}
                    onAnswerChange={onAnswerChange}
                    onQuestionFocus={setCurrentQuestion}
                    isActive={isActiveGroup}
                  />
                ) : type === 'MATCHING_INFORMATION' ? (
                  /* Matching Information - Dropdown View */
                  (() => {
                    const groupData = getQuestionGroupOptions 
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;
                    const groupOptions = groupData?.options as any;
                    const optionsTitle = groupOptions?.options_title || 'List of Paragraphs';
                    
                    // Get options array - AI format: {options: [{letter, text}]} or [{letter, text}] directly
                    let optionsArray: any[] = [];
                    if (Array.isArray(groupOptions)) {
                      optionsArray = groupOptions;
                    } else if (Array.isArray(groupOptions?.options)) {
                      optionsArray = groupOptions.options;
                    } else if (paragraphLabels && paragraphLabels.length > 0) {
                      optionsArray = paragraphLabels;
                    }
                    
                    // Transform to MatchingOption format {letter, text}
                    // Handle both object format {letter, text} and string format
                    const matchingOptions = optionsArray.map((opt: any, idx: number) => {
                      if (typeof opt === 'object' && opt?.letter && opt?.text) {
                        return { letter: opt.letter, text: opt.text };
                      }
                      // Fallback for string-only options
                      return {
                        letter: String.fromCharCode(65 + idx), // A, B, C, D...
                        text: typeof opt === 'string' ? opt : String(opt)
                      };
                    });
                    
                    // If no options found, show error
                    if (matchingOptions.length === 0) {
                      return (
                        <div className="text-destructive text-sm">
                          No paragraph options found for Matching Information questions.
                        </div>
                      );
                    }
                    
                    // Transform questions to MatchingInformationQuestion format
                    const matchingQuestions = typeQuestions.map(q => ({
                      question_number: q.question_number,
                      statement_before: q.question_text,
                    }));
                    
                    return (
                      <MatchingInformation
                        questions={matchingQuestions}
                        options={matchingOptions}
                        optionsTitle={optionsTitle}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        currentQuestion={currentQuestion}
                        onSetActive={setCurrentQuestion}
                        fontSize={fontSize}
                      />
                    );
                  })()
                ) : type === 'TABLE_SELECTION' ? (
                  /* Table Selection View */
                  (() => {
                    // Get full group data including display options
                    const groupData = getQuestionGroupOptions 
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;
                    const groupOptionsData = groupData?.options as any;
                    
                    // Get column options
                    const groupOptions = getTableSelectionOptions
                      ? getTableSelectionOptions(firstQuestionInGroup.question_group_id || null)
                      : [];

                    const questionOptions = Array.isArray(firstQuestionInGroup.options)
                      ? firstQuestionInGroup.options
                      : null;

                    const options =
                      groupOptions.length > 0
                        ? groupOptions
                        : questionOptions && questionOptions.length > 0
                          ? questionOptions
                          : ['A', 'B', 'C', 'D', 'E'];

                    // Get display options
                    const useLetterHeadings = groupOptionsData?.use_letter_headings || false;
                    const optionsTitle = groupOptionsData?.options_title || 'List of Options';

                    return (
                      <TableSelection
                        questions={typeQuestions.map((q) => ({
                          question_number: q.question_number,
                          question_text: q.question_text,
                        }))}
                        options={options}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        fontSize={fontSize}
                        useLetterHeadings={useLetterHeadings}
                        optionsTitle={optionsTitle}
                        currentQuestion={currentQuestion}
                        onSetActive={setCurrentQuestion}
                      />
                    );
                  })()
                ) : type === 'NOTE_COMPLETION' ? (
                  /* Note Completion with bullet list */
                  (() => {
                    const group = getQuestionGroupOptions
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;

                    const groupData = group?.options || null;
                    // Handle both formats: AI generates note_sections, DB uses sections
                    const rawSections = groupData?.sections || groupData?.note_sections || [];
                    
                    // Convert note_sections format to expected sections format
                    const sections = rawSections.map((sec: any) => ({
                      heading: sec.heading || sec.title || '',
                      items: (sec.items || []).map((item: any) => ({
                        question_number: item.question_number,
                        text_before: item.text_before || '',
                        text_after: item.text_after || '',
                      })),
                    }));
                    
                    const title = groupData?.title || '';

                    return (
                      <NoteCompletion
                        title={title}
                        sections={sections}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        currentQuestion={currentQuestion}
                        fontSize={fontSize}
                      />
                    );
                  })()
                ) : type === 'SUMMARY_WORD_BANK' || (type === 'SUMMARY_COMPLETION' && fillDisplay.wordBankWithText?.length > 0) ? (
                  /* Summary with Word Bank sidebar */
                  (() => {
                    const groupData = getQuestionGroupOptions 
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;

                    const opts = (groupData?.options || {}) as any;
                    const title = opts?.title || opts?.summary_title || '';
                    const content = opts?.content || opts?.summary_text || '';
                    
                    // Word bank should be {id, text} objects for proper display
                    let wordBank = opts?.wordBank || opts?.word_bank || [];
                    // Ensure we pass objects with id and text
                    if (Array.isArray(wordBank) && wordBank.length > 0 && typeof wordBank[0] === 'string') {
                      // Legacy string format - convert to objects
                      wordBank = wordBank.map((w: string, idx: number) => ({
                        id: String.fromCharCode(65 + idx),
                        text: w
                      }));
                    }
                    
                    return (
                      <SummaryWordBank
                        title={title}
                        content={content}
                        wordBank={wordBank}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        onQuestionFocus={setCurrentQuestion}
                        currentQuestion={currentQuestion}
                        fontSize={fontSize}
                      />
                    );
                  })()
                ) : type === 'FLOWCHART_COMPLETION' ? (
                  /* Flowchart Completion */
                  (() => {
                    const groupData = getQuestionGroupOptions 
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;

                    const opts = (groupData?.options || {}) as any;
                    const title = opts?.title || opts?.flowchart_title || '';

                    const rawSteps = opts?.steps || opts?.flowchart_steps;
                    
                    // Helper to clean underscore patterns from labels (e.g., "_____" or "___")
                    const cleanUnderscores = (text: string): string => {
                      return text.replace(/_+/g, '').trim();
                    };
                    
                    const steps = Array.isArray(rawSteps)
                      ? rawSteps.map((s: any, idx: number) => ({
                          id: String(s?.id ?? `step-${idx + 1}`),
                          // Remove underscores from labels - the input field handles the blank
                          label: cleanUnderscores(String(s?.label ?? s?.text ?? '')),
                          questionNumber: typeof s?.questionNumber === 'number' ? s.questionNumber : undefined,
                          isBlank: !!s?.isBlank,
                        }))
                      : typeQuestions.map((q) => ({
                          id: q.id,
                          label: cleanUnderscores(q.question_text),
                          questionNumber: q.question_number,
                          isBlank: true,
                        }));

                    const direction = opts?.direction || 'vertical';
                    
                    return (
                      <FlowchartCompletion
                        title={title}
                        steps={steps}
                        direction={direction}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        currentQuestion={currentQuestion}
                        fontSize={fontSize}
                      />
                    );
                  })()
                ) : type === 'MAP_LABELING' ? (
                  /* Map Labeling with drag & drop */
                  (() => {
                    const groupData = getQuestionGroupOptions 
                      ? getQuestionGroupOptions(firstQuestionInGroup.question_group_id || null)
                      : null;

                    const groupOptions = (groupData?.options || {}) as any;

                    const imageUrl = groupOptions?.imageUrl || groupOptions?.image_url || '';

                    // Preferred format
                    let dropZones = Array.isArray(groupOptions?.dropZones) ? groupOptions.dropZones : [];
                    let optionsList = Array.isArray(groupOptions?.options) ? groupOptions.options : [];

                    // Back-compat for AI practice payloads
                    if (dropZones.length === 0 && Array.isArray(groupOptions?.map_labels)) {
                      // Create deterministic placeholder drop zones (until generator provides real coordinates)
                      const startX = 22;
                      const startY = 18;
                      const colGap = 30;
                      const rowGap = 16;
                      dropZones = typeQuestions.map((q, idx) => ({
                        questionNumber: q.question_number,
                        xPercent: startX + (idx % 2) * colGap,
                        yPercent: startY + Math.floor(idx / 2) * rowGap,
                      }));

                      // Default options are label letters (A, B, C...)
                      optionsList = groupOptions.map_labels
                        .map((l: any) => String(l?.id ?? l))
                        .filter(Boolean);
                    }

                    const maxImageWidth = groupOptions?.maxImageWidth || null;
                    const maxImageHeight = groupOptions?.maxImageHeight || null;

                    return (
                      <MapLabeling
                        imageUrl={imageUrl}
                        dropZones={dropZones}
                        options={optionsList}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        onQuestionFocus={setCurrentQuestion}
                        maxImageWidth={maxImageWidth}
                        maxImageHeight={maxImageHeight}
                        fontSize={fontSize}
                      />
                    );
                  })()
                ) : type === 'TABLE_COMPLETION' ? (
                  /* Table Completion - Official IELTS Style */
                  (() => {
                    // Get table data from the first question in the group (stored on question record)
                    // Also check groupOptions for AI-generated tests where table_data is in group.options
                    const tableDataRaw = firstQuestionInGroup.table_data || groupOptions?.table_data;
                    let tableData: any[] = [];
                    let tableHeading = '';
                    let tableHeadingAlignment: 'left' | 'center' | 'right' = 'left';
                    
                    if (tableDataRaw) {
                      if (Array.isArray(tableDataRaw)) {
                        // Legacy format - array of rows
                        tableData = tableDataRaw;
                      } else if (tableDataRaw.rows) {
                        // New format - object with rows, heading, headingAlignment
                        tableData = tableDataRaw.rows;
                        tableHeading = tableDataRaw.heading || '';
                        tableHeadingAlignment = tableDataRaw.headingAlignment || 'left';
                      }
                    }
                    
                    // If no table data, fall back to regular questions rendering
                    if (!tableData || tableData.length === 0) {
                      return null;
                    }
                    
                    return (
                      <ReadingTableCompletion
                        testId={testId}
                        questionId={groupId}
                        tableData={tableData}
                        answers={answers}
                        onAnswerChange={onAnswerChange}
                        currentQuestion={currentQuestion}
                        setCurrentQuestion={setCurrentQuestion}
                        fontSize={fontSize}
                        renderRichText={renderRichText}
                        tableHeading={tableHeading}
                        tableHeadingAlignment={tableHeadingAlignment}
                      />
                    );
                  })()
                ) : (
                  /* Regular Questions */
                  (() => {
                    const fillInGapTypes = [
                      'FILL_IN_BLANK',
                      'SENTENCE_COMPLETION',
                      'SHORT_ANSWER',
                      'SUMMARY_COMPLETION',
                    ];
                    const isFillInGapGroup = fillInGapTypes.includes(type);

                    if (isFillInGapGroup) {
                      // Note-style layout (Official IELTS format with categories)
                      if (fillDisplay.noteStyleEnabled && fillDisplay.noteCategories.length > 0) {
                        return (
                          <section className="mt-4">
                            <NoteStyleFillInBlank
                              questions={typeQuestions.map(q => ({
                                id: q.id,
                                question_number: q.question_number,
                                question_text: q.question_text,
                                correct_answer: q.correct_answer,
                                is_given: false,
                                heading: q.heading,
                                instruction: q.instruction,
                              }))}
                              answers={answers}
                              onAnswerChange={onAnswerChange}
                              fontSize={fontSize}
                              noteCategories={fillDisplay.noteCategories}
                            />
                          </section>
                        );
                      }

                      // When showBullets is enabled, ALWAYS use a native list marker for perfect baseline alignment
                      if (fillDisplay.showBullets) {

                        return (
                          <section className="mt-4">
                            <ul className="list-disc pl-6 space-y-1 marker:text-muted-foreground">
                              {typeQuestions.map((question) => {
                                const isActive = currentQuestion === question.question_number;
                                const answer = answers[question.question_number];
                                const handleChange = (value: string) => onAnswerChange(question.question_number, value);
                                const handleSetActive = () => setCurrentQuestion(question.question_number);

                                const parts = question.question_text.split(/_{2,}/);
                                const hasInlineBlank = parts.length > 1;

                                const useDropdown = fillDisplay.useDropdown;
                                const wordBank = fillDisplay.wordBank;

                                return (
                                  <li
                                    key={question.id}
                                    id={`question-${question.question_number}`}
                                    className="pl-1 leading-[1.8]"
                                    onPointerDownCapture={handleSetActive}
                                  >
                                    {fillDisplay.showHeadings && question.heading?.trim() && (
                                      <strong
                                        className={cn(
                                          "font-bold block mb-1",
                                          fillDisplay.titleColored && "text-primary"
                                        )}
                                      >
                                        {question.heading}
                                      </strong>
                                    )}

                                    {hasInlineBlank ? (
                                      parts.map((part, partIdx) => (
                                        <span key={partIdx}>
                                          <span dangerouslySetInnerHTML={{ __html: renderRichText(part) }} />
                                          {partIdx < parts.length - 1 && (
                                            useDropdown && wordBank.length > 0 ? (
                                              <Select value={answer || ''} onValueChange={handleChange}>
                                                <SelectTrigger
                                                  className={cn(
                                                    "inline-flex w-28 h-7 text-sm text-center font-medium mx-1 rounded-[3px]",
                                                    "bg-[hsl(var(--ielts-input-bg,0_0%_100%))] border border-[hsl(var(--ielts-input-border))] text-foreground",
                                                    "focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
                                                    isActive && "border-[hsl(var(--ielts-input-focus))]"
                                                  )}
                                                  style={{ verticalAlign: 'baseline', fontFamily: 'var(--font-ielts)' }}
                                                  onClick={(e) => e.stopPropagation()}
                                                  onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                  <SelectValue placeholder={String(question.question_number)} />
                                                </SelectTrigger>
                                                <SelectContent className="bg-background border border-[hsl(var(--ielts-input-border))] rounded-[3px]">
                                                  {wordBank.map((w: string) => (
                                                    <SelectItem key={w} value={w}>{w}</SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                            ) : (
                                              <input
                                                type="text"
                                                value={answer || ''}
                                                onChange={(e) => handleChange(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onPointerDown={(e) => e.stopPropagation()}
                                                placeholder={String(question.question_number)}
                                                className={cn(
                                                  "ielts-input inline min-w-[174px] h-7 text-sm text-center font-medium rounded-[3px] border mx-1",
                                                  "bg-[hsl(var(--ielts-card-bg,0_0%_100%))] border-[hsl(var(--ielts-input-border))] text-foreground",
                                                  "placeholder:text-center placeholder:font-bold placeholder:text-foreground/70",
                                                  "focus:outline-none focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
                                                  isActive && "border-[hsl(var(--ielts-input-focus))]"
                                                )}
                                                style={{ verticalAlign: 'baseline' }}
                                              />
                                            )
                                          )}
                                        </span>
                                      ))
                                    ) : (
                                      <>
                                        <span dangerouslySetInnerHTML={{ __html: renderRichText(question.question_text) }} />
                                        <input
                                          type="text"
                                          value={answer || ''}
                                          onChange={(e) => handleChange(e.target.value)}
                                          onClick={(e) => e.stopPropagation()}
                                          onMouseDown={(e) => e.stopPropagation()}
                                          onPointerDown={(e) => e.stopPropagation()}
                                          placeholder={String(question.question_number)}
                                          className={cn(
                                            "ielts-input inline min-w-[174px] h-7 text-sm text-center font-medium rounded-[3px] border mx-1",
                                            "bg-[hsl(var(--ielts-card-bg,0_0%_100%))] border-[hsl(var(--ielts-input-border))] text-foreground",
                                            "placeholder:text-center placeholder:font-bold placeholder:text-foreground/70",
                                            "focus:outline-none focus:border-[hsl(var(--ielts-input-focus))] focus:ring-0",
                                            isActive && "border-[hsl(var(--ielts-input-focus))]"
                                          )}
                                          style={{ verticalAlign: 'baseline' }}
                                        />
                                      </>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        );
                      }
                    }


                    return (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          {typeQuestions.map((question, qIdx) => {
                            const isActive = currentQuestion === question.question_number;
                            const handleSetActive = () => setCurrentQuestion(question.question_number);
                            const questionInput = renderQuestionInput(question, isActive, handleSetActive);

                            // Skip rendering if no input (like matching headings or matching sentence endings individual questions)
                            if (questionInput === null && (type === 'MATCHING_HEADINGS' || type === 'MATCHING_SENTENCE_ENDINGS')) {
                              return null;
                            }

                            // For fill in blank, summary, sentence completion, short answer with inline blanks, only show the input (not the question text separately)
                            const inlineBlankTypes = ['FILL_IN_BLANK', 'SUMMARY_COMPLETION', 'SENTENCE_COMPLETION', 'SHORT_ANSWER'];
                            const hasInlineBlank = inlineBlankTypes.includes(type) && /_{2,}/.test(question.question_text);

                            // For fill-in-gap types *without* inline blanks (i.e. question text + separate input), keep text + input on the same line
                            const showInlineSentenceLayout =
                              ['FILL_IN_BLANK', 'SUMMARY_COMPLETION', 'SENTENCE_COMPLETION', 'SHORT_ANSWER'].includes(type) && !hasInlineBlank;

                            // Check if we need to show a section heading (only when it changes from previous question)
                            const prevQuestion = qIdx > 0 ? typeQuestions[qIdx - 1] : null;
                            const showSectionHeading = fillDisplay.showHeadings && 
                              question.heading?.trim() && 
                              question.heading !== prevQuestion?.heading;

                            return (
                              <div key={question.id}>
                                {/* Section heading as separator */}
                                {showSectionHeading && (
                                  <h5 className={cn(
                                    "font-bold text-sm mb-2 mt-4",
                                    fillDisplay.titleColored && "text-primary"
                                  )}>
                                    {question.heading}
                                  </h5>
                                )}
                                <article
                                  id={`question-${question.question_number}`}
                                  className="py-2 transition-all cursor-pointer"
                                  onPointerDownCapture={() => {
                                    setCurrentQuestion(question.question_number);
                                  }}
                                  onClick={() => {
                                    setCurrentQuestion(question.question_number);
                                  }}
                                >
                                  <div className="flex items-start gap-2">
                                    {/* Question number badge - only show for non-fill-in-blank types, or when no inline blank */}
                                    {/* For fill-in-blank types, the input placeholder already shows the number */}
                                    {!hasInlineBlank && !isFillInGapGroup && (
                                      <span className={cn(
                                        "flex-shrink-0 text-base font-bold text-foreground inline-flex items-center justify-center",
                                        isActive 
                                          ? "border-2 border-[#5DADE2] px-2 py-0.5 rounded-[3px] min-w-[32px]" 
                                          : "min-w-[28px]"
                                      )}>
                                        {question.question_number}
                                      </span>
                                    )}
                                    {fillDisplay.showBullets && !isFillInGapGroup && (
                                      <span className="mt-1 text-muted-foreground" aria-hidden="true">
                                        ▪
                                      </span>
                                    )}
                                    <div
                                      className={cn(
                                        "flex-1",
                                        showInlineSentenceLayout
                                          ? "flex flex-wrap items-baseline gap-x-1 gap-y-1"
                                          : "space-y-1"
                                      )}
                                    >
                                      {!hasInlineBlank && (
                                        <QuestionTextWithTools
                                          contentId={question.id}
                                          testId={testId}
                                          text={question.question_text}
                                          fontSize={fontSize}
                                          renderRichText={renderRichText}
                                          isActive={isActive && shouldHighlightContainer}
                                          as={showInlineSentenceLayout ? "span" : undefined}
                                        />
                                      )}

                                      {questionInput}
                                    </div>
                                  </div>
                                </article>
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* Word Bank Table for SENTENCE_COMPLETION with word list */}
                        {type === 'SENTENCE_COMPLETION' && fillDisplay.wordBankWithText.length > 0 && (
                          <div className="mt-6 p-4 border border-border rounded-md bg-muted/30">
                            <h4 className="font-bold text-sm mb-3 text-foreground">Word List</h4>
                            <div className="grid gap-2">
                              {(fillDisplay.wordBankWithText as Array<{id: string; text: string}>).map((item) => (
                                <div key={item.id} className="flex items-baseline gap-2 text-sm">
                                  <span className="font-bold text-primary min-w-[24px]">{item.id}</span>
                                  <span className="text-foreground">{item.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}