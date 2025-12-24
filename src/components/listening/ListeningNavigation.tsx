import { useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface Question {
  id: string;
  question_number: number;
  question_type?: string;
  group_id?: string;
  table_data?: any; // For TABLE_COMPLETION, FLOWCHART_COMPLETION, etc.
}

interface QuestionGroup {
  id: string;
  question_type: string;
  start_question: number;
  end_question: number;
  options?: {
    max_answers?: number;
    [key: string]: any;
  } | null;
}

interface ListeningNavigationProps {
  questions: Question[];
  answers: Record<number, string>;
  currentQuestion: number;
  setCurrentQuestion: (num: number) => void;
  activePartIndex: number;
  onPartSelect: (partIndex: number) => void;
  partRanges: { label: string; start: number; end: number }[];
  flaggedQuestions?: Set<number>;
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
const MOBILE_VISIBLE_ITEMS = 9; // More items visible on mobile
const PART_LABEL_MIN_WIDTH = 60;
const PART_LABEL_MIN_WIDTH_MOBILE = 16; // Minimal on mobile since text is hidden
const NAV_HORIZONTAL_PADDING = 12;
const NAV_HORIZONTAL_PADDING_MOBILE = 4; // Tighter on mobile

export function ListeningNavigation({
  questions,
  answers,
  currentQuestion,
  setCurrentQuestion,
  activePartIndex,
  onPartSelect,
  partRanges,
  flaggedQuestions: externalFlaggedQuestions,
  onSubmit,
  questionGroups = [],
}: ListeningNavigationProps) {
  const flaggedQuestions = externalFlaggedQuestions ?? new Set<number>();
  const isMobile = useIsMobile();

  const questionNumbers = useMemo(() => {
    const nums = new Set<number>();

    // Helper to extract question numbers from table_data
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
      
      // Extract all question numbers from table_data if present
      if (q.table_data) {
        extractFromTableData(q.table_data);
      }
    }

    // Add all question numbers from question groups with ranges
    for (const g of questionGroups) {
      const groupTypesWithRanges = [
        'MULTIPLE_CHOICE_MULTIPLE',
        'multiple_choice_multiple',
        'TABLE_COMPLETION',
        'table_completion',
        'FLOWCHART_COMPLETION',
        'flowchart_completion',
        'MAP_LABELING',
        'MAPS',
      ];
      
      if (groupTypesWithRanges.includes(g.question_type)) {
        for (let n = g.start_question; n <= g.end_question; n++) {
          nums.add(n);
        }
      }
    }

    return Array.from(nums).sort((a, b) => a - b);
  }, [questions, questionGroups]);

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

  // Calculate part statistics based on actual question count from ranges
  const partStats = useMemo(() => {
    return partRanges.map((_range, idx) => {
      // Get all question numbers in this part's range
      const numsInPart = partQuestions[idx] || [];
      // Count how many are answered (using the helper that handles grouped questions)
      const answeredCount = numsInPart.filter((n) => isQuestionAnswered(n)).length;
      return {
        questions: numsInPart,
        answered: answeredCount,
        complete: numsInPart.length > 0 && numsInPart.every((n) => isQuestionAnswered(n)),
      };
    });
  }, [partRanges, partQuestions, isQuestionAnswered]);

  const allQuestionsAnswered = questionNumbers.length > 0 && questionNumbers.every((n) => isQuestionAnswered(n));

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
        
        const existingNums = partNums.filter(
          (n) => n >= group.start_question && n <= group.end_question
        );
        
        // Get maxAnswers from group options
        const maxAnswers = (group.options as any)?.max_answers ?? (group.end_question - group.start_question + 1);
        
        items.push({
          type: "grouped",
          numbers: existingNums.length > 0 ? existingNums : [group.start_question],
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
    if (newPartIndex !== -1 && newPartIndex !== activePartIndex) {
      onPartSelect(newPartIndex);
    }
    scrollToQuestion(num);
  };

  const handlePartClick = (partIndex: number) => {
    onPartSelect(partIndex);
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

  const parts: PartSpec[] = useMemo(
    () =>
      partRanges
        .map((range, index) => {
          const totalQuestionsInPart = range.end - range.start + 1;
          return {
            key: `p${index + 1}`,
            index,
            title: range.label,
            questions: partStats[index]?.questions || [],
            totalQuestions: totalQuestionsInPart,
            items: partItems[index] || [],
            answered: partStats[index]?.answered || 0,
            complete: partStats[index]?.complete || false,
          };
        })
        .filter((p) => p.questions.length > 0),
    [partRanges, partStats, partItems],
  );

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
      <div className="flex w-full" style={{ paddingLeft: isMobile ? NAV_HORIZONTAL_PADDING_MOBILE : NAV_HORIZONTAL_PADDING, paddingRight: isMobile ? NAV_HORIZONTAL_PADDING_MOBILE : NAV_HORIZONTAL_PADDING }}>
        <div className="flex min-w-0 flex-1 overflow-x-auto scrollbar-none">
          {parts.map((p) => {
            const isActive = activePartIndex === p.index;
            
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
                      style={{ width: isMobile ? PART_LABEL_MIN_WIDTH_MOBILE : PART_LABEL_MIN_WIDTH, height: BAR_HEIGHT }}
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
      <div className="flex w-full items-center" style={{ paddingLeft: isMobile ? NAV_HORIZONTAL_PADDING_MOBILE : NAV_HORIZONTAL_PADDING, paddingRight: isMobile ? NAV_HORIZONTAL_PADDING_MOBILE : NAV_HORIZONTAL_PADDING }}>
        {/* Parts container */}
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-none">
          {parts.map((p) => {
            const isActive = activePartIndex === p.index;

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
                        aria-label={p.title}
                        className={cn(
                          "shrink-0 flex items-center justify-start text-sm font-semibold whitespace-nowrap",
                          p.complete ? "text-green-600" : "text-foreground"
                        )}
                        style={{ 
                          width: isMobile ? PART_LABEL_MIN_WIDTH_MOBILE : PART_LABEL_MIN_WIDTH,
                          height: QUESTION_BUTTON_SIZE,
                        }}
                      >
                        {p.complete && <Check size={14} className="mr-1 text-green-600" strokeWidth={2.5} />}
                        <span className="hidden md:inline">{p.title}</span>
                      </button>
                      
                      {/* Question numbers - aligned with bars above (sliding window on mobile) */}
                      {(() => {
                        const { visibleItems, hasMore } = getMobileVisibleItems(p.items);
                        return (
                          <>
                            {/* Left indicator */}
                            {hasMore.left && (
                              <span className="shrink-0 text-muted-foreground text-xs" style={{ width: 16 }}>‹</span>
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
                            
                            {/* Right indicator */}
                            {hasMore.right && (
                              <span className="shrink-0 text-muted-foreground text-xs" style={{ width: 16 + SEGMENT_GAP, marginLeft: SEGMENT_GAP }}>›</span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  /* Inactive part - show only part label (hidden on mobile) */
                  <div className="hidden md:flex min-w-0 flex-col">
                    {/* Part label with count */}
                    <button
                      onClick={() => handlePartClick(p.index)}
                      className={cn(
                        "flex w-full items-center justify-center whitespace-nowrap text-sm px-2",
                        p.complete ? "text-green-600 font-semibold" : "text-muted-foreground"
                      )}
                      style={{ height: QUESTION_BUTTON_SIZE }}
                    >
                      {p.complete && <Check size={14} className="mr-1 text-green-600" strokeWidth={2.5} />}
                      <span>{p.title}</span>
                      {!p.complete && (
                        <span className="ml-2 tabular-nums">
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

        {/* Submit button */}
        <div className="flex shrink-0 items-center ml-2 md:ml-8">
          <button
            className={cn(
              "transition-colors flex items-center justify-center",
              allQuestionsAnswered
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
            style={{ 
              height: isMobile ? 40 : 48,
              width: isMobile ? 36 : 64,
              borderRadius: 0,
            }}
            onClick={onSubmit}
            title="Submit test"
          >
            <Check size={isMobile ? 20 : 24} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </footer>
  );
}