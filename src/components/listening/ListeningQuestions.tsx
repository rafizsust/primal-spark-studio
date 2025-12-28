import { cn } from '@/lib/utils';
import { FillInBlank, ListeningTableCompletion, MatchingCorrectLetter, Maps, MapLabeling, MapLabelingTable, MultipleChoiceSingle, MultipleChoiceMultiple, DragAndDropOptions, FlowchartCompletion, NoteStyleFillInBlank } from './questions';
import { QuestionTextWithTools } from '@/components/common/QuestionTextWithTools';
import { TableData, TableEditorData } from '@/components/admin/ListeningQuestionGroupEditor'; // Import types from admin editor

interface Question {
  id: string;
  question_number: number;
  question_type: string; // Added back
  question_text: string;
  correct_answer: string;
  instruction: string | null; // Added back
  group_id: string; // Added back
  is_given: boolean;
  heading: string | null; // Added heading for fill-in-blank questions
  table_data?: TableData | TableEditorData; // Support both formats
  options?: string[] | null; // Added options for MCQ
  option_format?: string | null; // Added option_format
}

interface QuestionGroup {
  id: string;
  question_type: string;
  instruction: string | null;
  start_question: number;
  end_question: number;
  options: any; // Group-level options (can be structured JSON)
  option_format?: string; // Group-level option format
  num_sub_questions?: number; // Added num_sub_questions for multiple choice multiple
  questions: Question[]; // Added this line to the interface
  group_heading?: string | null; // Heading for the entire question group
  group_heading_alignment?: 'left' | 'center' | 'right'; // Alignment for the group heading
}

interface ListeningQuestionsProps {
  testId: string;
  questions: Question[];
  questionGroups: QuestionGroup[];
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  currentQuestion: number;
  setCurrentQuestion: (num: number) => void;
  fontSize?: number;
  renderRichText: (text: string) => string; // Accept renderRichText prop
}

// Helper to strip leading question number (e.g., "1. ", "2. ")
const stripLeadingQuestionNumber = (text: string, questionNumber: number): string => {
  const regex = new RegExp(`^${questionNumber}\\.\\s*`);
  return text.replace(regex, '').trim();
};

export function ListeningQuestions({ 
  testId,
  questions, 
  questionGroups,
  answers, 
  onAnswerChange,
  currentQuestion,
  setCurrentQuestion,
  fontSize = 14,
  renderRichText, // Accept renderRichText prop
}: ListeningQuestionsProps) {
  // Group questions by their group_id
  const groupedQuestions: Record<string, Question[]> = questions.reduce((acc, q) => {
    if (!acc[q.group_id]) {
      acc[q.group_id] = [];
    }
    acc[q.group_id].push(q);
    return acc;
  }, {} as Record<string, Question[]>);


  const getQuestionRange = (typeQuestions: Question[]) => {
    const numbers = typeQuestions.map(q => q.question_number).sort((a, b) => a - b);
    if (numbers.length === 0) return '';
    if (numbers.length === 1) return `${numbers[0]}`;
    return `${numbers[0]} to ${numbers[numbers.length - 1]}`;
  };

  const getOptionLabel = (index: number, format: string) => {
    if (format === '1') return String(index + 1);
    if (format === 'i') {
      const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
      return romanNumerals[index] || String(index + 1);
    }
    return String.fromCharCode(65 + index);
  };

  const renderQuestionInput = (question: Question, group: QuestionGroup) => {
    const answer = answers[question.question_number];
    const handleChange = (value: string) => onAnswerChange(question.question_number, value);
    const isActive = currentQuestion === question.question_number;

    switch (question.question_type) {
      case 'FILL_IN_BLANK':
        return (
          <FillInBlank
            testId={testId}
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            renderRichText={renderRichText}
            stripLeadingQuestionNumber={stripLeadingQuestionNumber}
          />
        );
      case 'TABLE_COMPLETION':
        return null; // Handled by ListeningTableCompletion directly below
      case 'MATCHING_CORRECT_LETTER':
        return (
          <MatchingCorrectLetter
            testId={testId}
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            groupOptions={group.options?.options || []} // Access options from structured JSON
            groupOptionFormat={group.options?.option_format || 'A'} // Access option_format from structured JSON
            fontSize={fontSize}
            renderRichText={renderRichText}
            isActive={isActive}
          />
        );
      case 'MAPS':
        return (
          <Maps
            testId={testId}
            question={question}
            answer={answer}
            onAnswerChange={handleChange}
            groupOptionLetters={group.options?.option_letters || []} // Access option_letters from structured JSON
            fontSize={fontSize}
            renderRichText={renderRichText}
            isActive={isActive}
          />
        );
      case 'MULTIPLE_CHOICE_SINGLE': // New case for MCQ Single
        return (
          <MultipleChoiceSingle
            testId={testId}
            renderRichText={renderRichText}
            question={{
              ...question,
              options: question.options || [], // Ensure options is an array
            }}
            answer={answer}
            onAnswerChange={handleChange}
            isActive={false} // Pass isActive as false to keep options text muted as per screenshot
          />
        );
      case 'MULTIPLE_CHOICE_MULTIPLE':
        return null; // Rendered at the group level
      case 'DRAG_AND_DROP_OPTIONS':
        return null; // Rendered at the group level
      case 'FLOWCHART_COMPLETION':
        return null; // Rendered at the group level
      case 'MAP_LABELING':
        return null; // Rendered at the group level
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6" style={{ fontSize: `${fontSize}px` }}>
      {questionGroups.map((group) => {
        const groupQuestions = groupedQuestions[group.id] || [];
        const isActiveGroup = groupQuestions.some(q => q.question_number === currentQuestion);

        // Calculate question range - for MCQ Multiple use max_answers (or end_question), for TABLE_COMPLETION use group range
        let questionRange: string;
        if (group.question_type === 'MULTIPLE_CHOICE_MULTIPLE') {
          // Use max_answers from group options, or calculate from end_question - start_question + 1
          const maxAnswers = group.options?.max_answers || group.num_sub_questions || (group.end_question - group.start_question + 1);
          const startQ = group.start_question;
          const endQ = startQ + maxAnswers - 1;
          questionRange = maxAnswers > 1 ? `${startQ}-${endQ}` : `${startQ}`;
        } else if (group.question_type === 'TABLE_COMPLETION') {
          // TABLE_COMPLETION stores questions in table_data, so use group's start/end range
          questionRange = group.start_question === group.end_question 
            ? `${group.start_question}` 
            : `${group.start_question} to ${group.end_question}`;
        } else {
          questionRange = getQuestionRange(groupQuestions);
        }

        // Get image dimensions for Maps type
        const maxImageWidth = group.options?.maxImageWidth;
        const maxImageHeight = group.options?.maxImageHeight;
        const imageStyle = {
          maxWidth: maxImageWidth ? `${maxImageWidth}px` : '100%',
          maxHeight: maxImageHeight ? `${maxImageHeight}px` : '60vh',
        };

        return (
          <div key={group.id} className="mb-8">
            {/* IELTS Official Style Header */}
            <div className="ielts-question-header mb-4">
              <h3 className="font-bold text-[hsl(var(--ielts-section-text))] text-base mb-1" style={{ fontFamily: 'var(--font-ielts)' }}>
                Questions {questionRange}
              </h3>
              <div className="text-[hsl(var(--ielts-section-text))] text-sm leading-relaxed" style={{ fontFamily: 'var(--font-ielts)' }}>
                <QuestionTextWithTools
                  testId={testId}
                  contentId={group.id + '-instruction'}
                  text={group.instruction || `Answer the following questions.`}
                  fontSize={fontSize}
                  renderRichText={renderRichText}
                  isActive={false} 
                />
              </div>
              {/* Group Heading - Bold, below instruction */}
              {group.group_heading && (
                <div 
                  className={cn(
                    "font-bold text-foreground mt-3",
                    group.group_heading_alignment === 'left' && 'text-left',
                    group.group_heading_alignment === 'right' && 'text-right',
                    (!group.group_heading_alignment || group.group_heading_alignment === 'center') && 'text-center'
                  )}
                >
                  <QuestionTextWithTools
                    testId={testId}
                    contentId={group.id + '-group-heading'}
                    text={group.group_heading}
                    fontSize={fontSize}
                    renderRichText={renderRichText}
                    isActive={false}
                  />
                </div>
              )}
            </div>

            {/* Maps - Image and Options Display (Group Level) */}
            {group.question_type === 'MAPS' && (
              <div className="mb-6">
                {group.options?.imageUrl && (
                  <div className={cn(
                    "mb-4 flex",
                    group.options?.imageAlignment === 'left' && 'justify-start',
                    group.options?.imageAlignment === 'right' && 'justify-end',
                    (!group.options?.imageAlignment || group.options?.imageAlignment === 'center') && 'justify-center'
                  )}>
                    <img
                      src={group.options.imageUrl}
                      alt="IELTS Listening map diagram"
                      className="h-auto object-contain rounded-md"
                      style={imageStyle}
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Map Labeling - Table-based UI for AI practice (official IELTS format) */}
            {/* Uses MapLabelingTable when map_labels exist (AI-generated tests) */}
            {group.question_type === 'MAP_LABELING' && group.options?.map_labels && (
              <div className="mb-6">
                <MapLabelingTable
                  mapDescription={group.options.map_description}
                  mapLabels={group.options.map_labels}
                  questions={groupQuestions.map(q => ({
                    question_number: q.question_number,
                    question_text: q.question_text,
                    correct_answer: q.correct_answer,
                  }))}
                  answers={answers}
                  onAnswerChange={onAnswerChange}
                  onQuestionFocus={setCurrentQuestion}
                  fontSize={fontSize}
                  imageUrl={group.options.imageUrl}
                />
              </div>
            )}

            {/* Map Labeling - Drag & Drop on Image (admin-created tests without map_labels) */}
            {group.question_type === 'MAP_LABELING' && group.options?.imageUrl && !group.options?.map_labels && (
              <div className="mb-6">
                <MapLabeling
                  imageUrl={group.options.imageUrl}
                  dropZones={group.options.dropZones || []}
                  options={group.options.options || []}
                  answers={answers}
                  onAnswerChange={onAnswerChange}
                  onQuestionFocus={setCurrentQuestion}
                  maxImageWidth={group.options.maxImageWidth}
                  maxImageHeight={group.options.maxImageHeight}
                  fontSize={fontSize}
                />
              </div>
            )}

            {/* Matching Correct Letter - Group Options Display */}
            {group.question_type === 'MATCHING_CORRECT_LETTER' && group.options?.options && group.options.options.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-semibold mb-3 text-foreground">
                  <QuestionTextWithTools
                    testId={testId}
                    contentId={`${group.id}-matching-instruction`}
                    text="Choose the correct letter:"
                    fontSize={fontSize}
                    renderRichText={renderRichText}
                    isActive={false}
                  />
                </h4>
                <div className="flex flex-col gap-y-2">
                {group.options.options.map((optionText: string, idx: number) => {
                    // Strip existing label prefix (e.g., "A.", "A ", "A. ", "B") from option text
                    // Handles: "A Recommended", "A. Recommended", "A.Recommended", or just starts with letter
                    const cleanedText = optionText.replace(/^[A-Za-z]\.?\s*/, '').trim();
                    return (
                      <div key={idx} className="text-sm text-foreground flex items-baseline">
                        <span className="font-bold text-primary mr-1">
                          {getOptionLabel(idx, group.options.option_format || 'A')}.
                        </span>
                        <QuestionTextWithTools
                          testId={testId}
                          contentId={`${group.id}-option-${idx}`}
                          text={cleanedText}
                          fontSize={fontSize}
                          renderRichText={renderRichText}
                          isActive={false}
                          as="span"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Conditional rendering for Table Completion */}
            {group.question_type === 'TABLE_COMPLETION' && (groupQuestions.length > 0 || group.options?.table_data) && (groupQuestions[0]?.table_data || group.options?.table_data) ? (
              (() => {
                // Check individual question table_data first, then fallback to group.options.table_data (AI practice)
                const rawTableData = groupQuestions[0]?.table_data || group.options?.table_data;
                // Handle both old array format (from admin) and new object format, plus AI practice flat array format
                let tableRows: any[];
                let tableHeading: string | undefined;
                let tableHeadingAlignment: 'left' | 'center' | 'right' | undefined;
                
                if (Array.isArray(rawTableData)) {
                  // Direct array format - could be from AI practice or admin
                  // AI practice format: array of arrays with objects like [{content: "...", is_header: true}, ...]
                  tableRows = rawTableData;
                  tableHeading = undefined;
                  tableHeadingAlignment = undefined;
                } else if (rawTableData?.rows) {
                  // Object format with rows property
                  tableRows = rawTableData.rows;
                  tableHeading = rawTableData.heading;
                  tableHeadingAlignment = rawTableData.headingAlignment;
                } else {
                  tableRows = [];
                }
                
                // Skip rendering if no valid table data
                if (!tableRows || tableRows.length === 0) return null;
                
                return (
                  <ListeningTableCompletion
                    testId={testId}
                    questionId={groupQuestions[0]?.id || group.id}
                    tableData={tableRows}
                    answers={answers}
                    onAnswerChange={onAnswerChange}
                    fontSize={fontSize}
                    renderRichText={renderRichText}
                    tableHeading={tableHeading}
                    tableHeadingAlignment={tableHeadingAlignment}
                  />
                );
              })()
            ) : group.question_type === 'MULTIPLE_CHOICE_MULTIPLE' ? (
              (() => {
                // Calculate question range for MCQ Multiple based on max_answers from group options
                const maxAnswers = group.options?.max_answers || group.num_sub_questions || (group.end_question - group.start_question + 1);
                const startQ = group.start_question;
                const endQ = startQ + maxAnswers - 1;
                const mcqQuestionRange = maxAnswers > 1 ? `${startQ}-${endQ}` : `${startQ}`;
                
                return (
                  <div
                    key={group.id}
                    id={`question-${group.start_question}`}
                    className="p-4 transition-all cursor-pointer"
                    onPointerDownCapture={() => setCurrentQuestion(group.start_question)}
                    onClick={() => setCurrentQuestion(group.start_question)}
                  >
                    <div className="flex items-start gap-3">
                      {/* No question number badge for this type */}
                      <div className="flex-1 space-y-3">
                        {/* Question Heading with proper range (if any) */}
                        {groupQuestions[0]?.heading && (
                          <div className="mb-2 font-bold text-foreground">
                            <QuestionTextWithTools
                              testId={testId}
                              contentId={`${groupQuestions[0].id}-heading`}
                              text={groupQuestions[0].heading.replace(/Questions?\s+\d+/i, `Questions ${mcqQuestionRange}`)}
                              fontSize={fontSize}
                              renderRichText={renderRichText}
                              isActive={false} 
                            />
                          </div>
                        )}
                        {/* Main Question Text */}
                        <QuestionTextWithTools
                          contentId={groupQuestions[0].id}
                          testId={testId}
                          text={groupQuestions[0].question_text}
                          fontSize={fontSize}
                          renderRichText={renderRichText}
                          isActive={isActiveGroup}
                        />
                        {/* Multiple Choice Multiple Answers Component */}
                        <MultipleChoiceMultiple
                          testId={testId}
                          renderRichText={renderRichText}
                          question={{
                            ...groupQuestions[0], // Pass the single logical question
                            options: group.options?.options || [], // Use group-level options
                            option_format: group.options?.option_format || 'A',
                          }}
                          answer={answers[groupQuestions[0].question_number]}
                          onAnswerChange={(value) => onAnswerChange(groupQuestions[0].question_number, value)}
                          isActive={isActiveGroup}
                          maxAnswers={maxAnswers}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : group.question_type === 'DRAG_AND_DROP_OPTIONS' ? (
              <DragAndDropOptions
                testId={testId}
                questions={groupQuestions}
                groupOptions={group.options?.options || []}
                groupOptionFormat={group.options?.option_format || 'A'}
                answers={answers}
                onAnswerChange={onAnswerChange}
                onQuestionFocus={setCurrentQuestion}
                fontSize={fontSize}
                renderRichText={renderRichText}
              />
            ) : group.question_type === 'FLOWCHART_COMPLETION' ? (
              <div className="space-y-4">
                {/* Note: We don't display flowchart image for listening - the interactive component renders the flowchart */}
                <FlowchartCompletion
                  testId={testId}
                  groupId={group.id}
                  instruction={group.instruction || 'Complete the flowchart. Choose the correct answer and move it into the gap.'}
                  title={group.options?.title}
                  flowchartSteps={(group.options?.steps || []).map((step: any, idx: number) => ({
                    id: `${group.id}-step-${idx}`,
                    text: step.text || '',
                    hasBlank: step.hasBlank || false,
                    blankNumber: step.blankNumber,
                    alignment: step.alignment,
                  }))}
                  groupOptions={group.options?.options || []}
                  groupOptionFormat={group.options?.option_format || 'A'}
                  answers={answers}
                  onAnswerChange={onAnswerChange}
                  onQuestionFocus={setCurrentQuestion}
                  fontSize={fontSize}
                  renderRichText={renderRichText}
                  questionRange={questionRange}
                />
              </div>
            ) : (group.question_type === 'FILL_IN_BLANK' && group.options?.display_mode === 'note_style') || group.question_type === 'NOTE_COMPLETION' ? (
              /* Note-style Fill-in-Blank - Official IELTS format with category labels on left */
              <NoteStyleFillInBlank
                questions={groupQuestions}
                answers={answers}
                onAnswerChange={onAnswerChange}
                fontSize={fontSize}
                noteCategories={group.options?.noteCategories}
              />
            ) : (
              /* Individual Questions - IELTS demo exact layout */
              <div className="mt-4 space-y-2">
                {groupQuestions.map((question) => {
                  // Skip individual rendering for types that are handled at group level
                  if (
                    question.question_type === 'TABLE_COMPLETION' || 
                    question.question_type === 'MAP_LABELING' ||
                    (question.is_given && question.question_type === 'FILL_IN_BLANK' && !/_{2,10}/.test(question.question_text))
                  ) {
                    return null;
                  }

                  const isActive = currentQuestion === question.question_number;

                  // For FILL_IN_BLANK and MATCHING_CORRECT_LETTER, use IELTS demo style (clean, with dash/bullet points)
                  if (question.question_type === 'FILL_IN_BLANK' || question.question_type === 'MATCHING_CORRECT_LETTER') {
                    return (
                      <div 
                        key={question.id}
                        id={`question-${question.question_number}`}
                        className="cursor-pointer"
                        onPointerDownCapture={() => setCurrentQuestion(question.question_number)}
                        onClick={() => setCurrentQuestion(question.question_number)}
                      >
                        {/* Question Heading (section header style - bold) */}
                        {question.heading && (
                          <div className="font-bold text-foreground mt-4 mb-2">
                            <QuestionTextWithTools
                              testId={testId}
                              contentId={`${question.id}-heading`}
                              text={question.heading}
                              fontSize={fontSize}
                              renderRichText={renderRichText}
                              isActive={false} 
                            />
                          </div>
                        )}
                        {/* IELTS official style: bullet point + content (compact) */}
                        <div className="flex items-start gap-2 py-1 pl-6">
                          <span className="text-foreground flex-shrink-0 mt-0.5">•</span>
                          <div className="flex-1">
                            {renderQuestionInput(question, group)}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // For MCQ and other types - simple clean layout without heavy card styling
                  return (
                    <div 
                      key={question.id}
                      id={`question-${question.question_number}`}
                      className={cn(
                        "ielts-question-row",
                        isActive ? "ielts-question-row--active" : "ielts-question-row--inactive"
                      )}
                      onPointerDownCapture={() => setCurrentQuestion(question.question_number)}
                      onClick={() => setCurrentQuestion(question.question_number)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Question number badge (skip for MAPS - Maps component controls its own layout) */}
                        {question.question_type !== 'MAPS' && (
                          <span className={cn(
                            "flex-shrink-0 text-base font-bold text-foreground inline-flex items-center justify-center",
                            isActive
                              ? "border-2 border-[#5DADE2] px-2 py-0.5 rounded-[3px] min-w-[32px]"
                              : "min-w-[28px]"
                          )}>
                            {question.question_number}
                          </span>
                        )}
                        <div className="flex-1 space-y-3">
                          {/* Question Heading (if any) */}
                          {question.heading && (
                            <div className="mb-2">
                              <QuestionTextWithTools
                                testId={testId}
                                contentId={`${question.id}-heading`}
                                text={question.heading}
                                fontSize={fontSize}
                                renderRichText={renderRichText}
                                isActive={false} 
                              />
                            </div>
                          )}
                          {/* Main Question Text */}
                          {(question.question_type === 'MULTIPLE_CHOICE_SINGLE' || question.question_type === 'MULTIPLE_CHOICE_MULTIPLE') && (
                            <QuestionTextWithTools
                              contentId={question.id}
                              testId={testId}
                              text={question.question_text}
                              fontSize={fontSize}
                              renderRichText={renderRichText}
                              isActive={isActive}
                            />
                          )}
                          {/* Question Input Based on Type */}
                          {renderQuestionInput(question, group)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}