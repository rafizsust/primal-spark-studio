import { useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Question {
  id: string;
  question_number: number;
  question_type: string;
  passage_id?: string;
  question_group_id?: string | null;
  table_data?: any; // For TABLE_COMPLETION questions
}

interface QuestionGroup {
  id: string;
  question_type: string;
  passage_id?: string;
  start_question: number;
  end_question: number;
  options?: {
    max_answers?: number;
    [key: string]: any;
  } | null;
}

interface ReadingNavigationProps {
  questions: Question[];
  answers: Record<number, string>;
  currentQuestion: number;
  setCurrentQuestion: (num: number) => void;
  currentPassageIndex?: number;
  passages?: { id: string; passage_number: number }[];
  onPassageChange?: (passageIndex: number) => void;
  flaggedQuestions?: Set<number>;
  onToggleFlag?: (num: number) => void;
  onSubmit?: () => void;
  questionGroups?: QuestionGroup[];
}

interface QuestionItem {
  type: "single" | "grouped";
  numbers: number[];
  startNum: number;
  endNum: number;
  maxAnswers?: number;
}

// Constants for consistent sizing
const BAR_HEIGHT = 3;
const SEGMENT_GAP = 1.5;
const QUESTION_BUTTON_SIZE = 25; // Square buttons
const MOBILE_VISIBLE_ITEMS = 7; // Number of items visible on mobile

const PART_LABEL_MIN_WIDTH = 60;
const NAV_HORIZONTAL_PADDING = 12;

export function ReadingNavigation({
  questions,
  answers,
  currentQuestion,
  setCurrentQuestion,
  currentPassageIndex = 0,
  passages = [],
  onPassageChange,
  flaggedQuestions: externalFlaggedQuestions,
  onSubmit,
  questionGroups = [],
}: ReadingNavigationProps) {
  const flaggedQuestions = externalFlaggedQuestions ?? new Set<number>();
  const isMobile = useIsMobile();

  const questionNumbers = useMemo(() => {
    const nums = new Set<number>();

    // Helper to extract question numbers from table_data (used by TABLE_COMPLETION, FLOWCHART_COMPLETION, etc.)
    const extractFromTableData = (tableData: any) => {
      if (!tableData) return;
      const rows = Array.isArray(tableData) ? tableData : (tableData.rows || []);
      rows.forEach((row: any[]) => {
        if (!Array.isArray(row)) return;
        row.forEach((cell: any) => {
          if (cell?.has_question && cell?.question_number) {
            nums.add(cell.question_number);
          }
        });
      });
    };

    // Real question numbers from rows
    for (const q of questions) {
      nums.add(q.question_number);
      
      // For TABLE_COMPLETION, FLOWCHART_COMPLETION, MAP_LABELING, etc., extract all question numbers from table_data
      if (q.table_data) {
        extractFromTableData(q.table_data);
      }
    }

    // Add all question numbers from question groups (covers cases where questions are in group range but not in questions array)
    for (const g of questionGroups) {
      // For MULTIPLE_CHOICE_MULTIPLE, TABLE_COMPLETION, FLOWCHART_COMPLETION, MAP_LABELING, DIAGRAM_LABELING
      // add all numbers in the range to ensure correct counting
      const groupTypesWithRanges = [
        'MULTIPLE_CHOICE_MULTIPLE',
        'TABLE_COMPLETION', 
        'FLOWCHART_COMPLETION',
        'MAP_LABELING',
        'DIAGRAM_LABELING',
      ];
      
      if (groupTypesWithRanges.includes(g.question_type)) {
        for (let n = g.start_question; n <= g.end_question; n++) {
          nums.add(n);
        }
      }
    }

    return Array.from(nums).sort((a, b) => a - b);
  }, [questions, questionGroups]);

  // Build part ranges from passages (prefer questionGroups ranges when available)
  const partRanges = useMemo(() => {
    if (!passages?.length) {
      // Fallback to default ranges
      return [
        { label: 'Part 1', start: 1, end: 13 },
        { label: 'Part 2', start: 14, end: 26 },
        { label: 'Part 3', start: 27, end: 40 },
      ];
    }

    return passages.map((p, idx) => {
      const groupsForPassage = questionGroups.filter((g) => g.passage_id === p.id);
      if (groupsForPassage.length > 0) {
        const starts = groupsForPassage.map((g) => g.start_question);
        const ends = groupsForPassage.map((g) => g.end_question);
        return {
          label: `Part ${idx + 1}`,
          start: Math.min(...starts),
          end: Math.max(...ends),
        };
      }

      const passageQuestions = questions
        .filter((q) => q.passage_id === p.id)
        .map((q) => q.question_number)
        .sort((a, b) => a - b);

      return {
        label: `Part ${idx + 1}`,
        start: passageQuestions[0] ?? 1,
        end: passageQuestions[passageQuestions.length - 1] ?? 1,
      };
    });
  }, [passages, questions, questionGroups]);

  const partQuestions = useMemo(() => {
    return partRanges.map((range) =>
      questionNumbers.filter((n) => n >= range.start && n <= range.end)
    );
  }, [partRanges, questionNumbers]);

  // Helper to check if a question number is answered, considering grouped questions
  const isQuestionAnswered = useCallback((qNum: number): boolean => {
    // Check direct answer first
    if (answers[qNum]) return true;
    
    // Check if this question is part of a MULTIPLE_CHOICE_MULTIPLE group
    // where answer is stored on the first question of the group
    const group = questionGroups.find(
      (g) => g.question_type === 'MULTIPLE_CHOICE_MULTIPLE' && 
             qNum >= g.start_question && 
             qNum <= g.end_question
    );
    
    if (group) {
      // For MCQ Multiple, answer is stored as comma-separated at start_question
      const groupAnswer = answers[group.start_question] || "";
      const selectedCount = groupAnswer ? groupAnswer.split(',').filter(Boolean).length : 0;
      const requiredCount = (group.options as any)?.max_answers ?? 
                           (group.options as any)?.num_sub_questions ?? 
                           (group.end_question - group.start_question + 1);
      // Consider answered if we have enough selections
      return selectedCount >= requiredCount;
    }
    
    return false;
  }, [answers, questionGroups]);

  const getGroupedQuestionItems = useCallback(
    (partNums: number[], partStart: number, partEnd: number): QuestionItem[] => {
      const items: QuestionItem[] = [];
      const processedNums = new Set<number>();

      const partGroups = questionGroups.filter(
        (g) => g.start_question >= partStart && g.end_question <= partEnd
      );

      // Group ALL MCQ Multiple questions (not just those with 2 questions)
      const multiGroups = partGroups.filter((g) => 
        g.question_type === "MULTIPLE_CHOICE_MULTIPLE"
      );

      multiGroups.forEach((group) => {
        for (let n = group.start_question; n <= group.end_question; n++) {
          processedNums.add(n);
        }

        const rangeLen = Math.max(0, group.end_question - group.start_question + 1);
        const groupNumbers = Array.from({ length: rangeLen }, (_, i) => group.start_question + i);

        // Get maxAnswers from group options
        const maxAnswers = (group.options as any)?.max_answers ?? rangeLen;

        items.push({
          type: "grouped",
          numbers: groupNumbers,
          startNum: group.start_question,
          endNum: group.end_question,
          maxAnswers,
        });
      });

      partNums.forEach((num) => {
        if (processedNums.has(num)) return;
        processedNums.add(num);
        items.push({
          type: "single",
          numbers: [num],
          startNum: num,
          endNum: num,
        });
      });

      return items.sort((a, b) => a.startNum - b.startNum);
    },
    [questionGroups],
  );

  const partItems = useMemo(
    () => partQuestions.map((nums, idx) => 
      getGroupedQuestionItems(nums, partRanges[idx]?.start || 0, partRanges[idx]?.end || 0)
    ),
    [partQuestions, getGroupedQuestionItems, partRanges],
  );

  const scrollToQuestion = (num: number) => {
    const element = document.getElementById(`question-${num}`);
    if (element) {
      const scrollContainer = element.closest(".overflow-y-auto");
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top + scrollContainer.scrollTop;
        scrollContainer.scrollTo({
          top: relativeTop - containerRect.height / 3,
          behavior: "smooth",
        });
      }
    }
  };

  const handleQuestionClick = (num: number) => {
    setCurrentQuestion(num);
    const newPartIndex = partRanges.findIndex(
      (range) => num >= range.start && num <= range.end
    );
    if (newPartIndex !== -1 && newPartIndex !== currentPassageIndex && onPassageChange) {
      onPassageChange(newPartIndex);
    }
    scrollToQuestion(num);
  };

  const handlePartClick = (partIndex: number) => {
    if (!onPassageChange) return;
    onPassageChange(partIndex);
    const firstQuestion = partQuestions[partIndex]?.[0];
    if (firstQuestion) {
      setCurrentQuestion(firstQuestion);
      scrollToQuestion(firstQuestion);
    }
  };

  const isItemAnswered = (item: QuestionItem): boolean => {
    if (item.type === "single") return !!answers[item.numbers[0]];
    
    // For grouped MCQ Multiple: check if all required answers are selected
    // The answer is stored as comma-separated values on the first question number
    const answer = answers[item.startNum] || "";
    const selectedCount = answer ? answer.split(',').filter(Boolean).length : 0;
    const requiredCount = item.maxAnswers ?? (item.endNum - item.startNum + 1);
    
    return selectedCount >= requiredCount;
  };

  type PartSpec = {
    key: string;
    index: number;
    title: string;
    questions: number[];
    totalQuestions: number;
    items: QuestionItem[];
    answered: number;
    complete: boolean;
  };

  const parts: PartSpec[] = useMemo(() => {
    const getItemQuestionCount = (item: QuestionItem) => Math.max(1, item.endNum - item.startNum + 1);

    const getItemAnsweredCount = (item: QuestionItem) => {
      if (item.type === "single") return isQuestionAnswered(item.numbers[0]) ? 1 : 0;

      // For grouped questions, count how many individual question numbers are answered
      let count = 0;
      for (let n = item.startNum; n <= item.endNum; n++) {
        if (isQuestionAnswered(n)) count++;
      }
      return count;
    };

    return partRanges
      .map((range, index) => {
        const items = partItems[index] || [];
        const totalQuestions = items.reduce((sum, item) => sum + getItemQuestionCount(item), 0);
        const answered = items.reduce((sum, item) => sum + getItemAnsweredCount(item), 0);
        const complete = totalQuestions > 0 && answered >= totalQuestions;

        return {
          key: `p${index + 1}`,
          index,
          title: range.label,
          questions: partQuestions[index] || [],
          totalQuestions,
          items,
          answered,
          complete,
        };
      })
      .filter((p) => p.questions.length > 0);
  }, [partRanges, partItems, partQuestions, isQuestionAnswered]);

  const allQuestionsAnswered = parts.length > 0 && parts.every((p) => p.complete);

  // Compute sliding window for mobile - show items around current question
  const getMobileVisibleItems = useCallback((items: QuestionItem[]): { 
    visibleItems: QuestionItem[]; 
    hasMore: { left: boolean; right: boolean };
  } => {
    if (!isMobile || items.length <= MOBILE_VISIBLE_ITEMS) {
      return { visibleItems: items, hasMore: { left: false, right: false } };
    }

    // Find index of item containing current question
    const currentIndex = items.findIndex(item => 
      item.numbers.includes(currentQuestion) || 
      (currentQuestion >= item.startNum && currentQuestion <= item.endNum)
    );

    const idx = currentIndex === -1 ? 0 : currentIndex;
    const half = Math.floor(MOBILE_VISIBLE_ITEMS / 2);
    
    let start = Math.max(0, idx - half);
    let end = start + MOBILE_VISIBLE_ITEMS;
    
    // Adjust if we're near the end
    if (end > items.length) {
      end = items.length;
      start = Math.max(0, end - MOBILE_VISIBLE_ITEMS);
    }

    return {
      visibleItems: items.slice(start, end),
      hasMore: {
        left: start > 0,
        right: end < items.length,
      }
    };
  }, [isMobile, currentQuestion]);

  return (
    <footer className="bg-card shrink-0">
      {/* Progress indicator bars - at top edge */}
      <div className="flex w-full" style={{ paddingLeft: NAV_HORIZONTAL_PADDING, paddingRight: NAV_HORIZONTAL_PADDING }}>
        <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none">
          {parts.map((p) => {
            const isActive = currentPassageIndex === p.index;
            
            return (
              <div 
                key={`bar-${p.key}`}
                className={cn("flex min-w-0", !isActive && "shrink")}
                style={{ 
                  flex: isActive ? `0 0 auto` : `1 1 0`,
                  minWidth: isActive ? 'auto' : 0,
                }}
              >
                {isActive ? (
                  /* Active part bars - sliding window on mobile */
                  <div className="flex items-center">
                    <div 
                      className={cn("shrink-0", p.complete ? "bg-green-600" : "bg-[#c8c8c8]")}
                      style={{ width: PART_LABEL_MIN_WIDTH, height: BAR_HEIGHT }}
                    />
                    {(() => {
                      const { visibleItems, hasMore } = getMobileVisibleItems(p.items);
                      return (
                        <>
                          {/* Left indicator spacer */}
                          {hasMore.left && (
                            <div className="shrink-0" style={{ width: 16, height: BAR_HEIGHT }} />
                          )}
                          
                          {visibleItems.map((item) => {
                            const answered = isItemAnswered(item);
                            const isGrouped = item.type === "grouped";
                            const questionCount = Math.max(1, item.endNum - item.startNum + 1);
                            const itemWidth = isGrouped
                              ? questionCount * QUESTION_BUTTON_SIZE + (questionCount - 1) * SEGMENT_GAP
                              : QUESTION_BUTTON_SIZE;

                            return (
                              <div
                                key={`bar-${item.startNum}`}
                                className={cn("shrink-0", answered ? "bg-green-600" : "bg-[#c8c8c8]")}
                                style={{ width: itemWidth, height: BAR_HEIGHT, marginLeft: SEGMENT_GAP }}
                              />
                            );
                          })}
                          
                          {/* Right indicator spacer */}
                          {hasMore.right && (
                            <div className="shrink-0" style={{ width: 16 + SEGMENT_GAP, height: BAR_HEIGHT }} />
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  /* Inactive part bar */
                  <div 
                    className={cn("w-full shrink-0", p.complete ? "bg-green-600" : "bg-transparent")}
                    style={{ height: BAR_HEIGHT }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Spacer for submit button alignment */}
        <div className="shrink-0 ml-2 md:ml-8" style={{ width: isMobile ? 36 : 64 }} />
      </div>
      
      {/* Content row - numbers centered */}
      <div className="flex w-full items-center" style={{ paddingLeft: NAV_HORIZONTAL_PADDING, paddingRight: NAV_HORIZONTAL_PADDING }}>
        {/* Parts container */}
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-none">
          {parts.map((p) => {
            const isActive = currentPassageIndex === p.index;

            return (
              <div 
                key={p.key} 
                className={cn("flex min-w-0 flex-col", !isActive && "shrink")}
                style={{ 
                  flex: isActive ? `0 0 auto` : `1 1 0`,
                  minWidth: isActive ? 'auto' : 0,
                }}
              >
                {isActive ? (
                  /* Active part - show question numbers (sliding window on mobile) */
                  <div className="flex min-w-0 flex-col">
                    {/* Content row: Part label + question numbers */}
                    <div className="flex items-center">
                      {/* Part label */}
                      <button
                        onClick={() => handlePartClick(p.index)}
                        className={cn(
                          "shrink-0 flex items-center justify-start text-sm font-semibold whitespace-nowrap",
                          p.complete ? "text-green-600" : "text-foreground"
                        )}
                        style={{ 
                          width: PART_LABEL_MIN_WIDTH,
                          height: QUESTION_BUTTON_SIZE,
                        }}
                      >
                        {p.complete && <Check size={14} className="mr-1 text-green-600" strokeWidth={2.5} />}
                        {p.title}
                      </button>
                      
                      {/* Question numbers - sliding window on mobile */}
                      {(() => {
                        const { visibleItems, hasMore } = getMobileVisibleItems(p.items);
                        return (
                          <>
                            {/* Left indicator - more items exist */}
                            {hasMore.left && (
                              <div 
                                className="shrink-0 flex items-center justify-center text-muted-foreground"
                                style={{ width: 16, height: QUESTION_BUTTON_SIZE }}
                              >
                                <ChevronLeft size={14} strokeWidth={2} />
                              </div>
                            )}
                            
                            {visibleItems.map((item) => {
                              const isCurrent = item.numbers.includes(currentQuestion);
                              const isFlagged = item.numbers.some((n) => flaggedQuestions.has(n));
                              const isGrouped = item.type === "grouped";
                              const questionCount = Math.max(1, item.endNum - item.startNum + 1);
                              const itemWidth = isGrouped
                                ? questionCount * QUESTION_BUTTON_SIZE + (questionCount - 1) * SEGMENT_GAP
                                : QUESTION_BUTTON_SIZE;
                              
                              // Format label - plain numbers only
                              const label = isGrouped 
                                ? `${item.startNum}–${item.endNum}` 
                                : String(item.numbers[0]);

                              return (
                                <button
                                  key={`btn-${item.startNum}`}
                                  onClick={() => handleQuestionClick(item.startNum)}
                                  className={cn(
                                    "shrink-0 relative flex items-center justify-center text-sm transition-colors",
                                    isGrouped ? "px-1.5" : "px-0.5",
                                    isCurrent 
                                      ? "border-[2.5px] border-[#5BA4C9] text-foreground font-semibold rounded-[3px]" 
                                      : "text-foreground/80 hover:text-foreground",
                                  )}
                                  style={{ 
                                    width: itemWidth,
                                    height: QUESTION_BUTTON_SIZE,
                                    marginLeft: SEGMENT_GAP,
                                  }}
                                >
                                  {isFlagged && (
                                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500" />
                                  )}
                                  <span className="tabular-nums whitespace-nowrap">{label}</span>
                                </button>
                              );
                            })}
                            
                            {/* Right indicator - more items exist */}
                            {hasMore.right && (
                              <div 
                                className="shrink-0 flex items-center justify-center text-muted-foreground"
                                style={{ width: 16, height: QUESTION_BUTTON_SIZE, marginLeft: SEGMENT_GAP }}
                              >
                                <ChevronRight size={14} strokeWidth={2} />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  /* Inactive part - show only part label */
                  <div className="flex min-w-0 flex-col">
                    {/* Part label with count */}
                    <button
                      onClick={() => handlePartClick(p.index)}
                      className={cn(
                        "flex w-full min-w-0 items-center justify-center whitespace-nowrap text-sm px-2",
                        p.complete ? "text-green-600 font-semibold" : "text-muted-foreground"
                      )}
                      style={{ height: QUESTION_BUTTON_SIZE }}
                    >
                      {p.complete && <Check size={14} className="mr-1 text-green-600" strokeWidth={2.5} />}
                      <span className="min-w-0 truncate">{p.title}</span>
                      {!p.complete && (
                        <span className="ml-2 tabular-nums hidden md:inline">
                          {p.answered} of {p.totalQuestions}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit button - fixed position on mobile */}
        <div className="flex shrink-0 items-center ml-2 md:ml-8">
          <button
            className={cn(
              "transition-colors flex items-center justify-center ielts-submit-btn",
              allQuestionsAnswered
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
            onClick={onSubmit}
            title="Submit test"
          >
            <Check size={18} className="md:hidden" strokeWidth={2.5} />
            <Check size={24} className="hidden md:block" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </footer>
  );
}
