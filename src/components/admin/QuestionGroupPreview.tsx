import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Eye } from 'lucide-react';

// Import question components from reading module
import { TrueFalseNotGiven } from '@/components/reading/questions/TrueFalseNotGiven';
import { MultipleChoice } from '@/components/reading/questions/MultipleChoice';
import { FillInBlank } from '@/components/reading/questions/FillInBlank';
import { MatchingFeatures } from '@/components/reading/questions/MatchingFeatures';
import { TableSelection } from '@/components/reading/questions/TableSelection';
import { MatchingInformation } from '@/components/reading/questions/MatchingInformation';
import { ReadingTableCompletion } from '@/components/reading/questions/ReadingTableCompletion';
import { MultipleChoiceMultiple } from '@/components/reading/questions/MultipleChoiceMultiple';
import { NoteStyleFillInBlank } from '@/components/listening/questions/NoteStyleFillInBlank';
import { FlowchartCompletion } from '@/components/reading/questions/FlowchartCompletion';
import { MapLabeling } from '@/components/reading/questions/MapLabeling';

// Helper function to get option label (A, B, C or i, ii, iii etc.)
const getOptionLabel = (index: number, format: string) => {
  if (format === '1') return String(index + 1);
  if (format === 'i') {
    const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
    return romanNumerals[index] || String(index + 1);
  }
  return String.fromCharCode(65 + index);
};


interface Question {
  id?: string;
  question_number: number;
  question_text: string;
  options: string[];
  correct_answer: string;
  option_format: string;
  heading?: string;
  sub_group_start?: number;
  sub_group_end?: number;
}

interface QuestionGroup {
  id?: string;
  passage_id?: string;
  question_type: string;
  instruction: string;
  start_question: number;
  end_question: number;
  options: string[];
  questions: Question[];
  max_answers?: number;
  option_format?: string;
  show_option_labels?: boolean;
  display_as_paragraph?: boolean;
  show_bullets?: boolean;
  show_headings?: boolean;
  use_dropdown?: boolean;
  group_title?: string;
  title_centered?: boolean;
  title_colored?: boolean;
  note_style_enabled?: boolean;
  note_categories?: any[];
  table_data?: any;
  use_letter_headings?: boolean;
  options_title?: string;
  map_labeling_options?: {
    imageUrl: string | null;
    dropZones: { questionNumber: number; xPercent: number; yPercent: number; }[];
    options: string[];
    correctAnswers: Record<number, string>;
    maxImageWidth: number | null;
    maxImageHeight: number | null;
  };
}

interface QuestionGroupPreviewProps {
  group: QuestionGroup;
  paragraphLabels?: string[];
}

// Simple rich text renderer
function renderRichText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-2">$1</h2>');
}

export function QuestionGroupPreview({ group, paragraphLabels = [] }: QuestionGroupPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<number, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(group.start_question);

  const handleAnswerChange = (questionNumber: number, answer: string) => {
    setPreviewAnswers(prev => ({ ...prev, [questionNumber]: answer }));
  };

  const getQuestionTypeLabel = (type: string) => {
    switch (type) {
      case 'TRUE_FALSE_NOT_GIVEN': return 'True / False / Not Given';
      case 'YES_NO_NOT_GIVEN': return 'Yes / No / Not Given';
      case 'MATCHING_HEADINGS': return 'Matching Headings';
      case 'MATCHING_INFORMATION': return 'Matching Information';
      case 'MATCHING_SENTENCE_ENDINGS': return 'Matching Sentence Endings';
      case 'MATCHING_FEATURES': return 'Matching Features';
      case 'MULTIPLE_CHOICE': return 'Multiple Choice';
      case 'MULTIPLE_CHOICE_MULTIPLE': return 'Multiple Choice (Multiple Answers)';
      case 'FILL_IN_BLANK': return 'Fill in Gap / Sentence Completion';
      case 'TABLE_SELECTION': return 'Matching Grid';
      default: return type.replace(/_/g, ' ');
    }
  };

  // Convert group questions to the format expected by test-taker components
  const previewQuestions = (group.questions || []).map(q => ({
    id: q.id || `preview-${q.question_number}`,
    question_number: q.question_number,
    question_type: group.question_type,
    question_text: q.question_text,
    options: q.options || [],
    correct_answer: q.correct_answer,
    instruction: group.instruction,
    passage_id: group.passage_id || '',
    question_group_id: group.id || null,
    heading: q.heading,
    sub_group_start: q.sub_group_start,
    sub_group_end: q.sub_group_end,
  }));

  const renderPreviewContent = () => {
    const type = group.question_type;

    // Check if we have questions to preview
    if (previewQuestions.length === 0 && type !== 'TABLE_COMPLETION' && type !== 'MAP_LABELING') {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No questions added yet.</p>
          <p className="text-sm mt-2">Add questions to see the preview.</p>
        </div>
      );
    }

    // TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN
    if (type === 'TRUE_FALSE_NOT_GIVEN' || type === 'YES_NO_NOT_GIVEN') {
      return (
        <div className="space-y-1">
          {previewQuestions.map(q => {
            const isActive = currentQuestion === q.question_number;
            return (
              <article
                key={q.question_number}
                className="py-2 cursor-pointer"
                onClick={() => setCurrentQuestion(q.question_number)}
              >
                <div className="flex items-start gap-2">
                  {/* Question number badge */}
                  <span className={cn(
                    "flex-shrink-0 text-base font-bold text-foreground inline-flex items-center justify-center",
                    isActive 
                      ? "border-2 border-primary px-2 py-0.5 rounded-[3px] min-w-[32px]" 
                      : "min-w-[28px]"
                  )}>
                    {q.question_number}
                  </span>
                  <div className="flex-1 space-y-1">
                    {/* Question text */}
                    <p 
                      className="text-sm text-foreground"
                      dangerouslySetInnerHTML={{ __html: renderRichText(q.question_text) }}
                    />
                    {/* Answer options */}
                    <TrueFalseNotGiven
                      testId="preview"
                      renderRichText={renderRichText}
                      question={q}
                      answer={previewAnswers[q.question_number]}
                      onAnswerChange={(value) => handleAnswerChange(q.question_number, value)}
                      isActive={isActive}
                      onSetActive={() => setCurrentQuestion(q.question_number)}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      );
    }

    // Multiple Choice (Single)
    if (type === 'MULTIPLE_CHOICE') {
      return (
        <div className="space-y-4">
          {previewQuestions.map(q => (
            <MultipleChoice
              key={q.question_number}
              testId="preview"
              renderRichText={renderRichText}
              question={q}
              answer={previewAnswers[q.question_number]}
              onAnswerChange={(value) => handleAnswerChange(q.question_number, value)}
              isActive={currentQuestion === q.question_number}
              maxAnswers={1}
              onSetActive={() => setCurrentQuestion(q.question_number)}
            />
          ))}
        </div>
      );
    }

    // Multiple Choice Multiple
    // Multiple Choice Multiple - EXACT same as Listening: single group, single question, single set of options
    if (type === 'MULTIPLE_CHOICE_MULTIPLE') {
      const maxAnswers = group.max_answers || 2;
      const groupQuestion = previewQuestions[0];
      
      if (!groupQuestion) {
        return (
          <div className="text-center py-8 text-muted-foreground">
            <p>No questions added yet.</p>
            <p className="text-sm mt-2">Add a question to see the preview.</p>
          </div>
        );
      }
      
      return (
        <div className="p-4">
          <MultipleChoiceMultiple
            testId="preview"
            renderRichText={renderRichText}
            question={{
              id: groupQuestion.id || `preview-${groupQuestion.question_number}`,
              question_number: groupQuestion.question_number,
              question_text: groupQuestion.question_text,
              options: group.options || [],
              option_format: group.option_format || 'A'
            }}
            answer={previewAnswers[groupQuestion.question_number]}
            onAnswerChange={(value) => handleAnswerChange(groupQuestion.question_number, value)}
            isActive={true}
            maxAnswers={maxAnswers}
          />
        </div>
      );
    }

    // Fill in Blank / Sentence Completion
    if (['FILL_IN_BLANK', 'SENTENCE_COMPLETION', 'SHORT_ANSWER', 'SUMMARY_COMPLETION'].includes(type)) {
      // Note-style layout
      if (group.note_style_enabled && group.note_categories && group.note_categories.length > 0) {
        return (
          <NoteStyleFillInBlank
            questions={previewQuestions.map(q => ({
              id: q.id,
              question_number: q.question_number,
              question_text: q.question_text,
              correct_answer: q.correct_answer,
              is_given: false,
              heading: q.heading,
              instruction: q.instruction,
            }))}
            answers={previewAnswers}
            onAnswerChange={handleAnswerChange}
            noteCategories={group.note_categories}
          />
        );
      }


      if (group.show_bullets) {
        return (
          <div className="space-y-4">
            {group.group_title && (
              <h4 className={cn(
                "font-bold text-base",
                group.title_centered && "text-center",
                group.title_colored && "text-primary"
              )}>
                {group.group_title}
              </h4>
            )}
            <ul className="list-disc pl-6 space-y-1 marker:text-muted-foreground">
              {previewQuestions.map(q => {
                const parts = q.question_text.split(/_{2,}/);
                const hasInlineBlank = parts.length > 1;

                return (
                  <li key={q.question_number} className="pl-1 leading-[1.8]">
                    {group.show_headings && q.heading?.trim() && (
                      <strong className={cn("font-bold block mb-1", group.title_colored && "text-primary")}>
                        {q.heading}
                      </strong>
                    )}
                    {hasInlineBlank ? (
                      parts.map((part, partIdx) => (
                        <span key={partIdx}>
                          <span dangerouslySetInnerHTML={{ __html: renderRichText(part) }} />
                          {partIdx < parts.length - 1 && (
                            <input
                              type="text"
                              value={previewAnswers[q.question_number] || ''}
                              onChange={(e) => handleAnswerChange(q.question_number, e.target.value)}
                              placeholder={String(q.question_number)}
                              className="ielts-input inline w-28 h-7 text-sm text-center font-medium rounded-[3px] border mx-1 bg-background border-border text-foreground focus:outline-none focus:border-primary"
                              style={{ verticalAlign: 'baseline' }}
                            />
                          )}
                        </span>
                      ))
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: renderRichText(q.question_text) }} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }

      return (
        <div className="space-y-4">
          {group.group_title && (
            <h4 className={cn(
              "font-bold text-base",
              group.title_centered && "text-center",
              group.title_colored && "text-primary"
            )}>
              {group.group_title}
            </h4>
          )}
          {previewQuestions.map(q => (
            <FillInBlank
              key={q.question_number}
              question={q}
              answer={previewAnswers[q.question_number]}
              onAnswerChange={(value) => handleAnswerChange(q.question_number, value)}
              isActive={currentQuestion === q.question_number}
              onSetActive={() => setCurrentQuestion(q.question_number)}
              useDropdown={group.use_dropdown}
              wordBank={group.options || []}
            />
          ))}
        </div>
      );
    }

    // Matching Headings - show as dropdown list (simplified for preview)
    if (type === 'MATCHING_HEADINGS') {
      const headingOptions = (group.options || []).map((opt, idx) => ({
        id: getOptionLabel(idx, 'i'),
        text: `${getOptionLabel(idx, 'i')} - ${opt}`
      }));

      return (
        <div className="space-y-3">
          <div className="pb-2">
            <h4 className="font-semibold mb-2 text-sm">List of Headings</h4>
            <div className="grid gap-0.5">
              {(group.options || []).map((opt, idx) => (
                <div key={idx} className="text-sm">
                  <span className="font-bold text-primary">{getOptionLabel(idx, 'i')}.</span>{' '}
                  {opt}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {previewQuestions.map(q => {
              const isActive = currentQuestion === q.question_number;
              return (
                <div
                  key={q.question_number}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded cursor-pointer transition-colors",
                    isActive && "bg-primary/5"
                  )}
                  onClick={() => setCurrentQuestion(q.question_number)}
                >
                  <span className={cn(
                    "w-6 h-6 rounded flex items-center justify-center text-xs font-bold",
                    isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}>
                    {q.question_number}
                  </span>
                  <span className="flex-1 text-sm">Paragraph {q.question_text}</span>
                  <select
                    value={previewAnswers[q.question_number] || ''}
                    onChange={(e) => handleAnswerChange(q.question_number, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 px-2 text-sm border rounded bg-background"
                  >
                    <option value="">Select...</option>
                    {headingOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.text}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Matching Sentence Endings
    if (type === 'MATCHING_SENTENCE_ENDINGS') {
      const endingOptions = (group.options || []).map((opt, idx) => ({
        letter: getOptionLabel(idx, 'A'),
        text: opt
      }));

      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {previewQuestions.map(q => {
              const isActive = currentQuestion === q.question_number;
              return (
                <div
                  key={q.question_number}
                  className={cn(
                    "p-2 rounded cursor-pointer transition-colors",
                    isActive && "bg-primary/5"
                  )}
                  onClick={() => setCurrentQuestion(q.question_number)}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className={cn(
                      "w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}>
                      {q.question_number}
                    </span>
                    <span className="text-sm" dangerouslySetInnerHTML={{ __html: renderRichText(q.question_text) }} />
                  </div>
                  <select
                    value={previewAnswers[q.question_number] || ''}
                    onChange={(e) => handleAnswerChange(q.question_number, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-8 h-8 px-2 text-sm border rounded bg-background w-auto min-w-[200px]"
                  >
                    <option value="">Select ending...</option>
                    {endingOptions.map(opt => (
                      <option key={opt.letter} value={opt.letter}>{opt.letter}. {opt.text}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t">
            <h4 className="font-semibold mb-2 text-sm">List of Sentence Endings</h4>
            <div className="grid gap-0.5">
              {endingOptions.map(opt => (
                <div key={opt.letter} className="text-sm">
                  <span className="font-bold text-primary">{opt.letter}.</span>{' '}
                  {opt.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Matching Features
    if (type === 'MATCHING_FEATURES') {
      const featureOptions = (group.options || []).map((opt, idx) => ({
        letter: String.fromCharCode(65 + idx),
        text: opt
      }));

      const matchingQuestions = previewQuestions.map(q => ({
        question_number: q.question_number,
        statement_before: q.question_text,
      }));

      return (
        <MatchingFeatures
          questions={matchingQuestions}
          options={featureOptions}
          optionsTitle={group.options_title || 'List of People'}
          answers={previewAnswers}
          onAnswerChange={handleAnswerChange}
          currentQuestion={currentQuestion}
          onSetActive={setCurrentQuestion}
          fontSize={14}
        />
      );
    }

    // Matching Information / Table Selection (Grid)
    if (type === 'MATCHING_INFORMATION' || type === 'TABLE_SELECTION') {
      if (type === 'TABLE_SELECTION') {
        return (
          <TableSelection
            questions={previewQuestions.map(q => ({
              question_number: q.question_number,
              question_text: q.question_text,
            }))}
            options={group.options?.length ? group.options : ['A', 'B', 'C', 'D', 'E']}
            answers={previewAnswers}
            onAnswerChange={handleAnswerChange}
            fontSize={14}
            useLetterHeadings={group.use_letter_headings}
            optionsTitle={group.options_title || 'List of Options'}
            currentQuestion={currentQuestion}
            onSetActive={setCurrentQuestion}
          />
        );
      }

      // Get options - handle both array format and object format with letter/text
      const rawOptions: unknown[] = group.options || [];
      let matchingOptions: Array<{letter: string; text: string}> = [];
      
      if (Array.isArray(rawOptions) && rawOptions.length > 0) {
        const firstOpt = rawOptions[0];
        // Check if options have letter/text format already
        if (typeof firstOpt === 'object' && firstOpt !== null && 'letter' in firstOpt) {
          matchingOptions = rawOptions as Array<{letter: string; text: string}>;
        } else {
          // Simple string array - convert to letter/text format
          matchingOptions = rawOptions.map((opt, idx) => ({
            letter: String.fromCharCode(65 + idx),
            text: String(opt)
          }));
        }
      } else if (paragraphLabels.length > 0) {
        // Fall back to paragraph labels
        matchingOptions = paragraphLabels.map((label, idx) => ({
          letter: String.fromCharCode(65 + idx),
          text: `Paragraph ${label}`
        }));
      }

      // Transform questions to MatchingInformationQuestion format
      const matchingQuestions = previewQuestions.map(q => ({
        question_number: q.question_number,
        statement_before: q.question_text,
      }));

      return (
        <MatchingInformation
          questions={matchingQuestions}
          options={matchingOptions}
          optionsTitle={group.options_title || 'List of Paragraphs'}
          answers={previewAnswers}
          onAnswerChange={handleAnswerChange}
          currentQuestion={currentQuestion}
          onSetActive={setCurrentQuestion}
          fontSize={14}
        />
      );
    }

    // TABLE_COMPLETION
    if (type === 'TABLE_COMPLETION' && group.table_data) {
      const rawTableData = group.table_data;
      const tableRows = Array.isArray(rawTableData) ? rawTableData : rawTableData.rows;
      const tableHeading = !Array.isArray(rawTableData) ? rawTableData.heading : undefined;
      const tableHeadingAlignment = !Array.isArray(rawTableData) ? rawTableData.headingAlignment : undefined;

      return (
        <ReadingTableCompletion
          testId="preview"
          questionId={group.id || 'preview-table'}
          tableData={tableRows || []}
          answers={previewAnswers}
          onAnswerChange={handleAnswerChange}
          currentQuestion={currentQuestion}
          setCurrentQuestion={setCurrentQuestion}
          fontSize={14}
          renderRichText={renderRichText}
          tableHeading={tableHeading}
          tableHeadingAlignment={tableHeadingAlignment}
        />
      );
    }

    // Flowchart Completion
    if (type === 'FLOWCHART_COMPLETION') {
      // Create steps from questions
      const steps = previewQuestions.map(q => ({
        id: q.id,
        label: q.question_text.includes('_') ? q.question_text.split('_')[0] : 'Step',
        questionNumber: q.question_number,
        isBlank: true,
      }));

      return (
        <FlowchartCompletion
          steps={steps}
          answers={previewAnswers}
          onAnswerChange={handleAnswerChange}
          currentQuestion={currentQuestion}
          fontSize={14}
        />
      );
    }

    // Map Labeling (Drag & Drop)
    if (type === 'MAP_LABELING' && group.map_labeling_options) {
      const { imageUrl, dropZones, options, maxImageWidth, maxImageHeight } = group.map_labeling_options;
      
      if (!imageUrl) {
        return (
          <div className="text-center py-8 text-muted-foreground">
            <p>No image uploaded for map labeling.</p>
            <p className="text-sm mt-2">Upload an image and configure drop zones to preview.</p>
          </div>
        );
      }

      return (
        <MapLabeling
          imageUrl={imageUrl}
          dropZones={dropZones || []}
          options={options || []}
          answers={previewAnswers}
          onAnswerChange={handleAnswerChange}
          maxImageWidth={maxImageWidth}
          maxImageHeight={maxImageHeight}
          fontSize={14}
        />
      );
    }

    // Default: show a message for unsupported preview types
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Preview not available for this question type.</p>
        <p className="text-sm mt-2">The test-taker view may differ.</p>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Eye size={14} />
          Preview
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye size={18} />
            Test-Taker Preview
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {/* Question Group Header - mimics test-taker view */}
          <div className="question-group-header">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary/70">
                {getQuestionTypeLabel(group.question_type)}
              </span>
            </div>
            <h3 className="font-semibold text-sm mb-2">
              Questions {group.start_question} to {group.end_question}
            </h3>
            {group.instruction && (
              <p 
                className="text-sm text-foreground" 
                dangerouslySetInnerHTML={{ __html: renderRichText(group.instruction) }}
              />
            )}
          </div>

          {/* Preview Content */}
          <div className="border rounded-lg p-4 bg-muted/20">
            {renderPreviewContent()}
          </div>

          {/* Preview Answers Summary */}
          {Object.keys(previewAnswers).length > 0 && (
            <div className="text-xs text-muted-foreground border-t pt-4">
              <p className="font-medium mb-2">Your preview answers:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(previewAnswers).map(([qNum, answer]) => (
                  <span key={qNum} className="px-2 py-1 bg-muted rounded text-foreground">
                    Q{qNum}: {answer || '(empty)'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
