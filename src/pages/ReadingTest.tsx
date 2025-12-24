import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ReadingPassage } from '@/components/reading/ReadingPassage';
import { ReadingQuestions } from '@/components/reading/ReadingQuestions';
import { ReadingTimer } from '@/components/reading/ReadingTimer';
import { ReadingNavigation } from '@/components/reading/ReadingNavigation';
import { TestOptionsMenu, ContrastMode, TextSizeMode } from '@/components/reading/TestOptionsMenu';
import { StickyNote, Filter, X, ArrowLeft, ArrowRight } from 'lucide-react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from '@/lib/utils';
import { HighlightNoteProvider } from '@/hooks/useHighlightNotes';
import { NoteSidebar } from '@/components/common/NoteSidebar';
import { SubmitConfirmDialog } from '@/components/common/SubmitConfirmDialog';
import { RestoreTestStateDialog } from '@/components/common/RestoreTestStateDialog';
import { TestEntryOverlay } from '@/components/common/TestEntryOverlay';
import { PullToRefreshIndicator } from '@/components/common/PullToRefreshIndicator';
import { Badge } from '@/components/ui/badge';
import { useFullscreenTest } from '@/hooks/useFullscreenTest';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useIsMobile } from '@/hooks/use-mobile';


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
  // For MCQ Multiple sub-groups
  sub_group_start?: number;
  sub_group_end?: number;
}

interface Passage {
  id: string;
  passage_number: number;
  title: string;
  content: string;
  show_labels?: boolean;
}

interface Paragraph {
  id: string;
  label: string;
  content: string;
  is_heading: boolean;
  order_index: number;
}

interface QuestionGroup {
  id: string;
  question_type: string;
  options: any; // Can be string[] or { headings: string[], paragraph_answers: Record<string, string> }
  start_question: number;
  end_question: number;
}

interface Test {
  id: string;
  title: string;
  book_name: string;
  test_number: number;
  time_limit: number;
  total_questions: number;
}

// Import renderRichText from the shared module
import { renderRichText } from '@/components/admin/RichTextEditor';

export default function ReadingTest() {
  const { testId } = useParams<{ testId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Get filter params from URL
  const filterType = searchParams.get('type');
  const filterPart = searchParams.get('part');
  
  const [test, setTest] = useState<Test | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [_paragraphs, setParagraphs] = useState<Record<string, Paragraph[]>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionGroups, setQuestionGroups] = useState<QuestionGroup[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [currentPassageIndex, setCurrentPassageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // Matching headings state: paragraphLabel -> headingId
  const [headingAnswers, setHeadingAnswers] = useState<Record<string, string>>({});
  // Click-to-select state for matching headings
  const [selectedHeading, setSelectedHeading] = useState<string | null>(null);
  
  // Test controls state
  const [fontSize, _setFontSize] = useState(14);
  const [isPaused, setIsPaused] = useState(false);
  const [_customTime, setCustomTime] = useState(60);
  
  // Fullscreen mode
  const { enterFullscreen } = useFullscreenTest();
  
  // IELTS official options menu state
  const [contrastMode, setContrastMode] = useState<ContrastMode>('black-on-white');
  const [textSizeMode, setTextSizeMode] = useState<TextSizeMode>('regular');

  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [restoredTimeLeft, setRestoredTimeLeft] = useState<number | null>(null);
  const [flaggedQuestions, setFlaggedQuestions] = useState<Set<number>>(new Set());
  const [showEntryOverlay, setShowEntryOverlay] = useState(true);
  const [testStarted, setTestStarted] = useState(false);
  const hasAutoSubmitted = useRef(false);
  
  // Mobile view state - 'passage' or 'questions'
  const [mobileView, setMobileView] = useState<'passage' | 'questions'>('passage');
  const isMobile = useIsMobile();

  // Swipe gesture to navigate between parts on mobile
  const swipeHandlers = useSwipeGesture({
    onSwipeLeft: () => {
      if (isMobile && currentPassageIndex < passages.length - 1) {
        const newIndex = currentPassageIndex + 1;
        setCurrentPassageIndex(newIndex);
        const passageQuestions = questions
          .filter(q => q.passage_id === passages[newIndex]?.id)
          .sort((a, b) => a.question_number - b.question_number);
        if (passageQuestions.length > 0) {
          setCurrentQuestion(passageQuestions[0].question_number);
        }
      }
    },
    onSwipeRight: () => {
      if (isMobile && currentPassageIndex > 0) {
        const newIndex = currentPassageIndex - 1;
        setCurrentPassageIndex(newIndex);
        const passageQuestions = questions
          .filter(q => q.passage_id === passages[newIndex]?.id)
          .sort((a, b) => a.question_number - b.question_number);
        if (passageQuestions.length > 0) {
          setCurrentQuestion(passageQuestions[0].question_number);
        }
      }
    },
    minSwipeDistance: 80,
  });

  // Pull-to-refresh for mobile
  const handlePullRefresh = useCallback(async () => {
    toast.info('Refreshing test data...');
    await fetchTestData();
    toast.success('Test data refreshed');
  }, []);

  const {
    pullHandlers,
    isRefreshing,
    pullDistance,
    progress,
  } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    disabled: !isMobile || !testStarted,
  });
  const questionTypeMap: Record<string, string> = {
    'true-false-not-given': 'TRUE_FALSE_NOT_GIVEN',
    'yes-no-not-given': 'YES_NO_NOT_GIVEN',
    'multiple-choice-single': 'MULTIPLE_CHOICE',
    'multiple-choice-multiple': 'MULTIPLE_CHOICE_MULTIPLE',
    'matching-headings': 'MATCHING_HEADINGS',
    'matching-information': 'MATCHING_INFORMATION',
    'matching-sentence-endings': 'MATCHING_SENTENCE_ENDINGS',
    'sentence-completion': 'SENTENCE_COMPLETION',
    'summary-completion': 'SUMMARY_COMPLETION',
    'fill-in-blank': 'FILL_IN_BLANK',
    'short-answer': 'SHORT_ANSWER',
    'table-completion': 'TABLE_COMPLETION',
  };

  // Clear filter
  const clearFilter = () => {
    setSearchParams({});
  };

  // Keep URL "part" filter in sync with the visible passage
  useEffect(() => {
    if (!filterPart || passages.length === 0) return;
    const partIndex = Number.parseInt(filterPart, 10) - 1;
    if (Number.isNaN(partIndex)) return;
    if (partIndex >= 0 && partIndex < passages.length && partIndex !== currentPassageIndex) {
      setCurrentPassageIndex(partIndex);
    }
  }, [filterPart, passages, currentPassageIndex]);

  // Restore pending submission state after login
  useEffect(() => {
    if (!testId) return;

    const restorePendingState = async () => {
      const savedState = localStorage.getItem('pendingTestSubmission');
      if (!savedState) {
        fetchTestData();
        return;
      }

      try {
        const state = JSON.parse(savedState);
        if (state.testId !== testId || state.testType !== 'reading') {
          fetchTestData();
          return;
        }

        // Check if user is now logged in
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          // Restore answers and other state
          if (state.answers) setAnswers(state.answers);
          if (state.currentQuestion) setCurrentQuestion(state.currentQuestion);
          if (state.currentPassageIndex !== undefined) setCurrentPassageIndex(state.currentPassageIndex);
          
          // Store the restored time for the dialog
          const savedTime = state.timeLeft !== undefined ? state.timeLeft : 0;
          setRestoredTimeLeft(savedTime);
          setTimeLeft(savedTime);
          
          // Show the restore dialog to let user choose
          setShowRestoreDialog(true);
        } else {
          // User still not logged in, just restore state silently
          if (state.answers) setAnswers(state.answers);
          if (state.currentQuestion) setCurrentQuestion(state.currentQuestion);
          if (state.currentPassageIndex !== undefined) setCurrentPassageIndex(state.currentPassageIndex);
          if (state.timeLeft !== undefined) setTimeLeft(state.timeLeft);
        }
      } catch (e) {
        localStorage.removeItem('pendingTestSubmission');
      }

      fetchTestData();
    };

    restorePendingState();
  }, [testId]);

  // Handler for test entry - enter fullscreen on consent
  const handleEnterTest = useCallback(() => {
    setShowEntryOverlay(false);
    setTestStarted(true);
    enterFullscreen();
  }, [enterFullscreen]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft <= 0 && !hasAutoSubmitted.current && questions.length > 0) {
      hasAutoSubmitted.current = true;
      setShowSubmitDialog(true);
    }
  }, [timeLeft, questions.length]);

  // Update current passage based on current question
  useEffect(() => {
    if (questions.length > 0 && passages.length > 0) {
      const currentQ = questions.find(q => q.question_number === currentQuestion);
      if (currentQ) {
        const passageIdx = passages.findIndex(p => p.id === currentQ.passage_id);
        if (passageIdx !== -1 && passageIdx !== currentPassageIndex) {
          setCurrentPassageIndex(passageIdx);
        }
      }
    }
  }, [currentQuestion, currentPassageIndex, questions, passages]);

  const fetchTestData = async () => {
    try {
      const { data: testData, error: testError } = await supabase
        .from('reading_tests')
        .select('*')
        .eq('id', testId!)
        .single();

      if (testError) throw testError;
      setTest(testData);
      setTimeLeft(testData.time_limit * 60);
      setCustomTime(testData.time_limit);

      const { data: passageData, error: passageError } = await supabase
        .from('reading_passages')
        .select('*')
        .eq('test_id', testId!)
        .order('passage_number');

      if (passageError) throw passageError;
      setPassages(passageData);

      // Fetch all paragraphs in a single query (fixes N+1 problem)
      if (passageData.length > 0) {
        const passageIds = passageData.map(p => p.id);
        
        const { data: allParagraphData } = await supabase
          .from('reading_paragraphs')
          .select('*')
          .in('passage_id', passageIds)
          .order('order_index');
        
        // Group paragraphs by passage_id
        const paragraphsMap: Record<string, Paragraph[]> = {};
        for (const paragraph of (allParagraphData || [])) {
          if (!paragraphsMap[paragraph.passage_id]) {
            paragraphsMap[paragraph.passage_id] = [];
          }
          paragraphsMap[paragraph.passage_id].push(paragraph);
        }
        setParagraphs(paragraphsMap);

        // Fetch question groups
        const { data: groupsData } = await supabase
          .from('reading_question_groups')
          .select('*')
          .in('passage_id', passageIds)
          .order('start_question');
        
        if (groupsData) {
          setQuestionGroups(groupsData);
        }

        const { data: questionData, error: questionError } = await supabase
          .from('reading_questions')
          .select('*')
          .in('passage_id', passageIds)
          .order('question_number');

        if (questionError) throw questionError;
        setQuestions(questionData.map(q => {
          const qOptions = q.options as any;
          // Check if options is an object with sub_group fields (for MCQ Multiple)
          const isOptionsObject = qOptions && typeof qOptions === 'object' && !Array.isArray(qOptions);
          return {
            ...q,
            options: isOptionsObject ? (qOptions.options || null) : (qOptions as string[] | null),
            sub_group_start: isOptionsObject ? qOptions.sub_group_start : undefined,
            sub_group_end: isOptionsObject ? qOptions.sub_group_end : undefined,
          };
        }));
      }
    } catch (error) {
      console.error('Error fetching test data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionNumber: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionNumber]: answer }));
  };

  // Filter questions based on URL params
  const filteredQuestions = useMemo(() => {
    let filtered = questions;
    
    // Filter by question type
    if (filterType) {
      const dbType = questionTypeMap[filterType];
      if (dbType) {
        filtered = filtered.filter(q => q.question_type === dbType);
      }
    }
    
    // Filter by part (passage number)
    if (filterPart && passages.length > 0) {
      const partIndex = parseInt(filterPart) - 1;
      if (partIndex >= 0 && partIndex < passages.length) {
        const passageId = passages[partIndex].id;
        filtered = filtered.filter(q => q.passage_id === passageId);
      }
    }
    
    return filtered;
  }, [questions, filterType, filterPart, passages, questionTypeMap]);

  // Use filtered questions for display
  const displayQuestions = filterType || filterPart ? filteredQuestions : questions;

  const firstNonEmptyPassageIndex = useMemo(() => {
    if (passages.length === 0) return 0;
    const idx = passages.findIndex((p) => questions.some((q) => q.passage_id === p.id));
    return idx === -1 ? 0 : idx;
  }, [passages, questions]);

  // Check if current passage has matching headings questions
  const currentPassage = passages[currentPassageIndex];
  const currentPassageQuestions = currentPassage
    ? displayQuestions.filter(q => q.passage_id === currentPassage.id)
    : [];

  const matchingHeadingsQuestions = currentPassageQuestions.filter(
    q => q.question_type === 'MATCHING_HEADINGS'
  );
  const hasMatchingHeadings = matchingHeadingsQuestions.length > 0;

  // Get paragraph labels from matching headings questions (admin-selected paragraph labels)
  // Each MATCHING_HEADINGS question's question_text contains the paragraph label (e.g., "A", "B", etc.)
  const headingParagraphLabels = useMemo(() => {
    return matchingHeadingsQuestions.map(q => q.question_text);
  }, [matchingHeadingsQuestions]);

  // Extract heading options from question groups
  const headingOptions = useMemo(() => {
    if (!hasMatchingHeadings) return [];

    // Find the matching headings question group
    const matchingGroup = questionGroups.find(
      (g) =>
        g.question_type === 'MATCHING_HEADINGS' &&
        matchingHeadingsQuestions.some((q) => q.question_group_id === g.id)
    );

    if (matchingGroup?.options) {
      const opts: any = matchingGroup.options;
      const headingsList: any[] = Array.isArray(opts) ? opts : opts?.headings || opts || [];

      // DB can store headings as string[] OR as [{ id, text }]
      return headingsList.map((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          return { id: toRomanNumeral(idx + 1), text: opt };
        }

        const id = typeof opt?.id === 'string' ? opt.id : toRomanNumeral(idx + 1);
        const text =
          typeof opt?.text === 'string'
            ? opt.text
            : typeof opt?.label === 'string'
              ? opt.label
              : String(opt ?? '');

        return { id, text };
      });
    }

    // Fallback: get from question options
    const allOptions: { id: string; text: string }[] = [];
    matchingHeadingsQuestions.forEach(q => {
      if (q.options) {
        q.options.forEach((opt, idx) => {
          const romanNumeral = toRomanNumeral(idx + 1);
          if (!allOptions.find(o => o.text === opt)) {
            allOptions.push({ id: romanNumeral, text: opt });
          }
        });
      }
    });
    return allOptions;
  }, [matchingHeadingsQuestions, hasMatchingHeadings, questionGroups]);

  // Map paragraph labels to question numbers based on the question group's start_question
  const headingQuestionNumbers = useMemo(() => {
    if (!hasMatchingHeadings) return {};

    // Find the matching headings question group
    const matchingGroup = questionGroups.find(
      (g) =>
        g.question_type === 'MATCHING_HEADINGS' &&
        matchingHeadingsQuestions.some((q) => q.question_group_id === g.id)
    );

    const startQuestion = matchingGroup?.start_question ?? 1;
    
    // Create mapping: each heading paragraph gets a question number
    const mapping: Record<string, number> = {};
    headingParagraphLabels.forEach((label, index) => {
      mapping[label] = startQuestion + index;
    });
    
    return mapping;
  }, [hasMatchingHeadings, questionGroups, matchingHeadingsQuestions, headingParagraphLabels]);

  // Handle heading drop on paragraph
  const handleHeadingDrop = useCallback((paragraphLabel: string, headingId: string) => {
    setHeadingAnswers(prev => {
      const newAnswers = { ...prev };
      // Remove this heading from any other paragraph
      Object.keys(newAnswers).forEach(key => {
        if (newAnswers[key] === headingId) {
          delete newAnswers[key];
        }
      });
      // Assign to new paragraph
      newAnswers[paragraphLabel] = headingId;
      return newAnswers;
    });

    // Also update the question answers
    const matchingQ = matchingHeadingsQuestions.find(q => {
      return q.question_text === paragraphLabel || 
             q.question_text.includes(`Paragraph ${paragraphLabel}`) || 
             q.question_text.includes(`paragraph ${paragraphLabel}`);
    });
    
    if (matchingQ) {
      const heading = headingOptions.find(h => h.id === headingId);
      if (heading) {
        handleAnswerChange(matchingQ.question_number, headingId);
      }
    }
  }, [matchingHeadingsQuestions, headingOptions]);

  const handleHeadingRemove = useCallback((paragraphLabel: string) => {
    setHeadingAnswers(prev => {
      const newAnswers = { ...prev };
      delete newAnswers[paragraphLabel];
      return newAnswers;
    });

    // Clear the answer
    const matchingQ = matchingHeadingsQuestions.find(q => {
      return q.question_text === paragraphLabel || 
             q.question_text.includes(`Paragraph ${paragraphLabel}`) || 
             q.question_text.includes(`paragraph ${paragraphLabel}`);
    });
    
    if (matchingQ) {
      handleAnswerChange(matchingQ.question_number, '');
    }
  }, [matchingHeadingsQuestions]);

  // Handle click-to-select placement for matching headings
  const handleSelectPlace = useCallback((paragraphLabel: string) => {
    if (selectedHeading) {
      handleHeadingDrop(paragraphLabel, selectedHeading);
      setSelectedHeading(null); // Clear selection after placing
    }
  }, [selectedHeading, handleHeadingDrop]);

  const handleSubmit = async () => {
    // Get current user first
    const { data: { user } } = await supabase.auth.getUser();
    
    // If user is not logged in, save state and redirect to login
    if (!user) {
      localStorage.setItem('pendingTestSubmission', JSON.stringify({
        testId,
        testType: 'reading',
        answers,
        currentQuestion,
        currentPassageIndex,
        timeLeft,
        returnPath: `/reading/test/${testId}`,
        savedAt: new Date().toISOString(),
        autoSubmitOnReturn: true,
      }));
      navigate(`/auth?returnTo=${encodeURIComponent(`/reading/test/${testId}`)}&pendingSubmission=true`);
      return;
    }

    const questionResults = questions.map(q => {
      const userAnswer = answers[q.question_number]?.trim() || '';
      const correctAnswer = q.correct_answer.trim();
      const correctOptions = correctAnswer.toLowerCase().split('/').map(a => a.trim());
      const isCorrect = correctOptions.some(opt => opt === userAnswer.toLowerCase());
      
      return {
        questionNumber: q.question_number,
        questionText: q.question_text,
        userAnswer,
        correctAnswer,
        isCorrect
      };
    });

    const score = questionResults.filter(r => r.isCorrect).length;
    const total = questionResults.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    
    // Calculate band score
    const calculateBandScore = (pct: number): number => {
      if (pct >= 93) return 9;
      if (pct >= 85) return 8.5;
      if (pct >= 78) return 8;
      if (pct >= 70) return 7.5;
      if (pct >= 63) return 7;
      if (pct >= 55) return 6.5;
      if (pct >= 48) return 6;
      if (pct >= 40) return 5.5;
      if (pct >= 33) return 5;
      if (pct >= 25) return 4.5;
      if (pct >= 18) return 4;
      if (pct >= 13) return 3.5;
      if (pct >= 8) return 3;
      return 2.5;
    };

    const bandScore = calculateBandScore(percentage);
    
    let submissionId = crypto.randomUUID();
    
    // Save to database
    const { data: submission, error } = await supabase
      .from('reading_test_submissions')
      .insert({
        user_id: user.id,
        test_id: testId!,
        answers: answers,
        score,
        total_questions: total,
        band_score: bandScore
      })
      .select()
      .single();
    
    if (!error && submission) {
      submissionId = submission.id as `${string}-${string}-${string}-${string}-${string}`;
    } else {
      console.error('Error saving submission:', error);
    }
    
    // Clear any pending submission data
    localStorage.removeItem('pendingTestSubmission');
    
    // Store result in sessionStorage for the results page
    const resultData = {
      id: submissionId,
      score,
      total,
      percentage,
      bandScore,
      testTitle: test?.title || 'Reading Test',
      bookName: test?.book_name || '',
      testNumber: test?.test_number || 1,
      completedAt: new Date().toISOString(),
      questionResults
    };
    
    sessionStorage.setItem(`test_result_${submissionId}`, JSON.stringify(resultData));
    
    // Navigate to results page
    navigate(`/results/${submissionId}?type=reading&testId=${testId}`);
  };

  // Get question range for current passage
  const getPassageQuestionRange = () => {
    if (currentPassageQuestions.length === 0) return '';
    const nums = currentPassageQuestions.map(q => q.question_number).sort((a, b) => a - b);
    if (nums.length === 0) return '';
    if (nums.length === 1) return `${nums[0]}`;
    return `${nums[0]}-${nums[nums.length - 1]}`;
  };

  // Get max answers for MCQ Multiple from question group
  const getMaxAnswers = useCallback((questionGroupId: string | null) => {
    if (!questionGroupId) return 2;
    const group = questionGroups.find(g => g.id === questionGroupId);
    if (group?.options?.max_answers) {
      return group.options.max_answers;
    }
    return 2;
  }, [questionGroups]);

  // Get group options for Matching Sentence Endings
  const getMatchingSentenceEndingsGroupOptions = useCallback((questionGroupId: string | null): string[] => {
    if (!questionGroupId) return [];
    const group = questionGroups.find(g => g.id === questionGroupId);
    if (group?.options && Array.isArray(group.options)) {
      return group.options as string[];
    }
    return [];
  }, [questionGroups]);

  // Get column options for Matching Grid (TABLE_SELECTION)
  const getTableSelectionOptions = useCallback((questionGroupId: string | null): string[] => {
    if (!questionGroupId) return [];
    const group = questionGroups.find(g => g.id === questionGroupId);
    if (!group?.options) return [];

    // In DB this can be either an array (['A','B',...]) or an object (e.g. { options: [...] })
    if (Array.isArray(group.options)) return group.options as string[];
    if (Array.isArray((group.options as any).options)) return (group.options as any).options as string[];

    return [];
  }, [questionGroups]);

  // Get full question group (used for group-level display config + specialized question types)
  const getQuestionGroupOptions = useCallback((questionGroupId: string | null): any => {
    if (!questionGroupId) return null;
    return questionGroups.find(g => g.id === questionGroupId) || null;
  }, [questionGroups]);

  // Apply theme classes to body for portal elements (dropdowns, modals, etc.)
  useEffect(() => {
    const themeClasses = ['ielts-theme-black-on-white', 'ielts-theme-white-on-black', 'ielts-theme-yellow-on-black'];
    const textClasses = ['ielts-text-regular', 'ielts-text-large', 'ielts-text-extra-large'];
    
    // Remove all theme classes first
    document.body.classList.remove(...themeClasses, ...textClasses);
    
    // Add current theme classes
    const currentTheme = {
      'black-on-white': 'ielts-theme-black-on-white',
      'white-on-black': 'ielts-theme-white-on-black',
      'yellow-on-black': 'ielts-theme-yellow-on-black',
    }[contrastMode];
    
    const currentTextSize = {
      'regular': 'ielts-text-regular',
      'large': 'ielts-text-large',
      'extra-large': 'ielts-text-extra-large',
    }[textSizeMode];
    
    document.body.classList.add(currentTheme, currentTextSize);
    
    // Cleanup on unmount
    return () => {
      document.body.classList.remove(...themeClasses, ...textClasses);
    };
  }, [contrastMode, textSizeMode]);

  // NOTE: Early returns moved below all hooks to avoid "Rendered more hooks" error

  // Get theme classes based on contrast mode and text size
  const getThemeClasses = () => {
    const contrastClass = {
      'black-on-white': 'ielts-theme-black-on-white',
      'white-on-black': 'ielts-theme-white-on-black',
      'yellow-on-black': 'ielts-theme-yellow-on-black',
    }[contrastMode];
    
    const textSizeClass = {
      'regular': 'ielts-text-regular',
      'large': 'ielts-text-large',
      'extra-large': 'ielts-text-extra-large',
    }[textSizeMode];
    
    return `${contrastClass} ${textSizeClass}`;
  };

  // Submit/restore dialog counts (handles grouped MCQ multiple)
  const submitStats = useMemo(() => {
    const numericKey = (k: string) => /^\d+$/.test(k);
    const normalizeAnswerValue = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    const isAnsweredValue = (v: string) => v.trim().length > 0;

    const normalizedAnswers: Record<number, string> = {};
    for (const [k, v] of Object.entries(answers as unknown as Record<string, unknown>)) {
      if (!numericKey(k)) continue;
      normalizedAnswers[Number(k)] = normalizeAnswerValue(v);
    }

    const totalCount = (() => {
      const maxFromGroups =
        questionGroups.length > 0 ? Math.max(...questionGroups.map((g) => g.end_question)) : 0;
      const maxFromQuestions =
        questions.length > 0 ? Math.max(...questions.map((q) => q.question_number)) : 0;
      const derivedMax = Math.max(maxFromGroups, maxFromQuestions);
      if (derivedMax > 0) return derivedMax;

      const fromTest = test?.total_questions;
      if (typeof fromTest === 'number' && fromTest > 0) return fromTest;

      return questions.length;
    })();

    // MCQ multiple stores all selections on the FIRST question number (comma-separated)
    const mcqMultipleNumbers = new Set<number>();
    let answeredCount = 0;

    const mcqMultipleGroups = questionGroups.filter((g) => g.question_type === 'MULTIPLE_CHOICE_MULTIPLE');
    for (const g of mcqMultipleGroups) {
      const rangeLen = Math.max(0, g.end_question - g.start_question + 1);
      for (let n = g.start_question; n <= g.end_question; n++) mcqMultipleNumbers.add(n);

      const raw = normalizedAnswers[g.start_question] || '';
      const selectedCount = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean).length : 0;
      answeredCount += Math.min(selectedCount, rangeLen);
    }

    // Everything else: count per question number
    for (let n = 1; n <= totalCount; n++) {
      if (mcqMultipleNumbers.has(n)) continue;
      if (isAnsweredValue(normalizedAnswers[n] || '')) answeredCount++;
    }

    answeredCount = Math.min(answeredCount, totalCount);

    return { totalCount, answeredCount };
  }, [answers, questionGroups, questions, test?.total_questions]);

  // Early returns - must be after all hooks
  if (loading) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading test...</div>
      </div>
    );
  }

  if (!test) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center">
        <div className="text-destructive">Test not found</div>
      </div>
    );
  }

  return (
    <HighlightNoteProvider testId={testId!}>
      <div className={cn("h-screen flex flex-col overflow-hidden", getThemeClasses(), "ielts-test-content")}>
        {/* Fixed Container for Header and Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header - IELTS Official Style */}
          <header className="border-b border-border bg-white px-2 md:px-4 py-1 md:py-3 flex items-center justify-between">
            {/* Left - IELTS Logo and Test Taker ID */}
            <div className="flex items-center gap-2 md:gap-4">
              <div className="ielts-logo">
                <span className="text-lg md:text-xl font-black tracking-tight text-[#c8102e]">IELTS</span>
              </div>
              <span className="text-sm text-foreground hidden md:inline">Test taker ID</span>
            </div>

            {/* Center - Empty for reading (no audio player) */}
            <div className="flex-1" />

            {/* Right - Timer, Notes, and Menu - matching official IELTS */}
            <div className="flex items-center gap-1">
              <ReadingTimer 
                timeLeft={timeLeft} 
                setTimeLeft={setTimeLeft} 
                isPaused={!testStarted || isPaused} 
                onTogglePause={() => setIsPaused(!isPaused)} 
              />
              {/* Notes/Bell Button */}
              <button 
                className="ielts-icon-btn p-2 rounded hover:bg-muted transition-colors"
                onClick={() => setIsNoteSidebarOpen(true)}
                title="Notes"
              >
                <StickyNote className="w-5 h-5 text-foreground/70" />
              </button>
              {/* Hamburger Menu */}
              <TestOptionsMenu
                contrastMode={contrastMode}
                setContrastMode={setContrastMode}
                textSizeMode={textSizeMode}
                setTextSizeMode={setTextSizeMode}
                onSubmit={() => setShowSubmitDialog(true)}
              />
            </div>
          </header>

        {/* Filter Indicator */}
        {(filterType || filterPart) && (
          <div className="bg-primary/10 border-b border-primary/20 px-6 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-primary" />
              <span className="text-sm font-medium">
                Filtered: {filterType && filterType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                {filterPart && ` - Part ${filterPart}`}
              </span>
              <Badge variant="secondary" className="text-xs">
                {displayQuestions.length} questions
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFilter} className="gap-1 text-primary hover:text-primary/80">
              <X size={14} />
              Clear Filter
            </Button>
          </div>
        )}

          {/* Mobile Part/Questions Tabs - compact, right below header - hidden on desktop */}
          <div className="md:hidden flex border-b border-border bg-muted/40">
            {passages.map((p, idx) => (
              <button
                key={p.id}
                className={cn(
                  "flex-1 py-1.5 text-xs font-medium text-center transition-colors",
                  idx === currentPassageIndex && mobileView === 'passage'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
                onClick={() => {
                  setCurrentPassageIndex(idx);
                  setMobileView('passage');
                  // Jump to first question of this passage
                  const passageQuestions = questions
                    .filter(q => q.passage_id === p.id)
                    .sort((a, b) => a.question_number - b.question_number);
                  if (passageQuestions.length > 0) {
                    setCurrentQuestion(passageQuestions[0].question_number);
                  }
                }}
              >
                Part {p.passage_number}
              </button>
            ))}
            <button
              className={cn(
                "flex-1 py-1.5 text-xs font-medium text-center transition-colors",
                mobileView === 'questions'
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              onClick={() => setMobileView('questions')}
            >
              Questions
            </button>
          </div>

          {/* Part Header - IELTS Official Style with left border */}
          <div className="ielts-part-header">
            <h2>Part {currentPassageIndex + 1}</h2>
            <p>Read the text and answer questions {getPassageQuestionRange()}.</p>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Desktop: Resizable Panels - hidden on mobile */}
            <div className="hidden md:block h-full">
              <ResizablePanelGroup direction="horizontal" className="h-full">
                {/* Left Panel - Passage (Independent Scroll) */}
                <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
                  <div className="h-full flex flex-col">
                    <div 
                      className={cn(
                        "flex-1 overflow-y-auto overflow-x-hidden p-6 ielts-card reading-passage",
                        "scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent hover:scrollbar-thumb-primary/40",
                        "font-[var(--font-ielts)]"
                      )}
                    >
                      {currentPassage && (
                        <ReadingPassage 
                          testId={testId!}
                          passage={currentPassage} 
                          fontSize={fontSize}
                          hasMatchingHeadings={hasMatchingHeadings}
                          headingOptions={headingOptions}
                          headingAnswers={headingAnswers}
                          headingQuestionNumbers={headingQuestionNumbers}
                          onHeadingDrop={handleHeadingDrop}
                          onHeadingRemove={handleHeadingRemove}
                          renderRichText={renderRichText}
                          selectedHeading={selectedHeading}
                          onSelectPlace={handleSelectPlace}
                          showLabels={currentPassage.show_labels !== false}
                          onQuestionFocus={setCurrentQuestion}
                        />
                      )}
                    </div>
                  </div>
                </ResizablePanel>
                
                {/* Resizable Handle */}
                <ResizableHandle
                  className="relative w-px bg-border cursor-col-resize select-none before:content-[''] before:absolute before:inset-y-0 before:left-1/2 before:w-6 before:-translate-x-1/2"
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center border-2 border-border bg-background">
                    <svg
                      viewBox="0 0 24 12"
                      aria-hidden="true"
                      className="h-4 w-6 text-foreground/80"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M6 2 L2 6 L6 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 6 H22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M18 2 L22 6 L18 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </ResizableHandle>
                
                {/* Right Panel - Questions (Independent Scroll) */}
                <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
                  <div className="h-full flex flex-col relative">
                    <div
                      className={cn(
                        "flex-1 overflow-y-auto overflow-x-hidden p-6 pb-20 ielts-card question-text",
                        "scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent hover:scrollbar-thumb-primary/40",
                        "font-[var(--font-ielts)]"
                      )}
                    >
                      {currentPassageQuestions.length === 0 ? (
                        <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6 text-center animate-fade-in">
                          <h3 className="text-base font-semibold text-foreground">This part has no questions yet</h3>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Part {currentPassageIndex + 1} doesn't have any questions in the database for this test.
                          </p>
                          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                            <Button variant="outline" onClick={clearFilter}>Clear filters</Button>
                            <Button
                              onClick={() => {
                                const targetIndex = firstNonEmptyPassageIndex;
                                const targetPassageId = passages[targetIndex]?.id;
                                const firstQ = questions.find((q) => q.passage_id === targetPassageId)?.question_number;
                                setCurrentPassageIndex(targetIndex);
                                setSearchParams({ part: String(targetIndex + 1) });
                                if (firstQ) setCurrentQuestion(firstQ);
                              }}
                            >
                              Go to available part
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <ReadingQuestions 
                          testId={testId!}
                          questions={currentPassageQuestions}
                          answers={answers}
                          onAnswerChange={handleAnswerChange}
                          currentQuestion={currentQuestion}
                          setCurrentQuestion={setCurrentQuestion}
                          fontSize={fontSize}
                          headingOptions={headingOptions}
                          headingAnswers={headingAnswers}
                          paragraphLabels={headingParagraphLabels}
                          onHeadingAnswerChange={(label, headingId) => {
                            if (headingId) handleHeadingDrop(label, headingId);
                            else handleHeadingRemove(label);
                          }}
                          getMaxAnswers={getMaxAnswers}
                          getMatchingSentenceEndingsGroupOptions={getMatchingSentenceEndingsGroupOptions}
                          getTableSelectionOptions={getTableSelectionOptions}
                          getQuestionGroupOptions={getQuestionGroupOptions}
                          renderRichText={renderRichText}
                          selectedHeading={selectedHeading}
                          onSelectedHeadingChange={setSelectedHeading}
                        />
                      )}
                    </div>
                    
                    {/* Floating Navigation Arrows */}
                    <div className="absolute bottom-2 right-4 flex items-center gap-2 z-10">
                      <button 
                        className={cn(
                          "ielts-nav-arrow",
                          displayQuestions.findIndex(q => q.question_number === currentQuestion) === 0 && "opacity-40 cursor-not-allowed"
                        )}
                        onClick={() => {
                          const idx = displayQuestions.findIndex(q => q.question_number === currentQuestion);
                          if (idx > 0) {
                            const prevQ = displayQuestions[idx - 1];
                            setCurrentQuestion(prevQ.question_number);
                            const passageIdx = passages.findIndex(p => p.id === prevQ.passage_id);
                            if (passageIdx !== -1) setCurrentPassageIndex(passageIdx);
                          }
                        }}
                        disabled={displayQuestions.findIndex(q => q.question_number === currentQuestion) === 0}
                      >
                        <ArrowLeft size={24} strokeWidth={2.5} />
                      </button>
                      <button 
                        className="ielts-nav-arrow ielts-nav-arrow-primary"
                        onClick={() => {
                          const idx = displayQuestions.findIndex(q => q.question_number === currentQuestion);
                          if (idx < displayQuestions.length - 1) {
                            const nextQ = displayQuestions[idx + 1];
                            setCurrentQuestion(nextQ.question_number);
                            const passageIdx = passages.findIndex(p => p.id === nextQ.passage_id);
                            if (passageIdx !== -1) setCurrentPassageIndex(passageIdx);
                          }
                        }}
                      >
                        <ArrowRight size={24} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>

            {/* Mobile: Single Panel View - hidden on desktop */}
            <div 
              className="md:hidden h-full flex flex-col relative"
              {...swipeHandlers}
              {...pullHandlers}
            >
              {/* Pull-to-refresh indicator */}
              <PullToRefreshIndicator 
                pullDistance={pullDistance}
                isRefreshing={isRefreshing}
                progress={progress}
              />
              {/* Mobile Passage View */}
              {mobileView === 'passage' && (
                <div 
                  className={cn(
                    "flex-1 overflow-y-auto overflow-x-hidden p-4 ielts-card reading-passage",
                    "font-[var(--font-ielts)]"
                  )}
                >
                  {currentPassage && (
                    <ReadingPassage 
                      testId={testId!}
                      passage={currentPassage} 
                      fontSize={fontSize}
                      hasMatchingHeadings={hasMatchingHeadings}
                      headingOptions={headingOptions}
                      headingAnswers={headingAnswers}
                      headingQuestionNumbers={headingQuestionNumbers}
                      onHeadingDrop={handleHeadingDrop}
                      onHeadingRemove={handleHeadingRemove}
                      renderRichText={renderRichText}
                      selectedHeading={selectedHeading}
                      onSelectPlace={handleSelectPlace}
                      showLabels={currentPassage.show_labels !== false}
                      onQuestionFocus={(qNum) => {
                        setCurrentQuestion(qNum);
                        setMobileView('questions');
                      }}
                    />
                  )}
                </div>
              )}

              {/* Mobile Questions View */}
              {mobileView === 'questions' && (
                <div
                  className={cn(
                    "flex-1 overflow-y-auto overflow-x-hidden p-4 pb-20 ielts-card question-text",
                    "font-[var(--font-ielts)]"
                  )}
                >
                  {currentPassageQuestions.length === 0 ? (
                    <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-4 text-center animate-fade-in">
                      <h3 className="text-base font-semibold text-foreground">This part has no questions yet</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Part {currentPassageIndex + 1} doesn't have any questions.
                      </p>
                    </div>
                  ) : (
                    <ReadingQuestions 
                      testId={testId!}
                      questions={currentPassageQuestions}
                      answers={answers}
                      onAnswerChange={handleAnswerChange}
                      currentQuestion={currentQuestion}
                      setCurrentQuestion={setCurrentQuestion}
                      fontSize={fontSize}
                      headingOptions={headingOptions}
                      headingAnswers={headingAnswers}
                      paragraphLabels={headingParagraphLabels}
                      onHeadingAnswerChange={(label, headingId) => {
                        if (headingId) handleHeadingDrop(label, headingId);
                        else handleHeadingRemove(label);
                      }}
                      getMaxAnswers={getMaxAnswers}
                      getMatchingSentenceEndingsGroupOptions={getMatchingSentenceEndingsGroupOptions}
                      getTableSelectionOptions={getTableSelectionOptions}
                      getQuestionGroupOptions={getQuestionGroupOptions}
                      renderRichText={renderRichText}
                      selectedHeading={selectedHeading}
                      onSelectedHeadingChange={setSelectedHeading}
                    />
                  )}
                </div>
              )}
              
              {/* Mobile Floating Navigation Arrows */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5 z-10">
                <button 
                  className={cn(
                    "ielts-nav-arrow",
                    displayQuestions.findIndex(q => q.question_number === currentQuestion) === 0 && "opacity-40 cursor-not-allowed"
                  )}
                  onClick={() => {
                    const idx = displayQuestions.findIndex(q => q.question_number === currentQuestion);
                    if (idx > 0) {
                      const prevQ = displayQuestions[idx - 1];
                      setCurrentQuestion(prevQ.question_number);
                      const passageIdx = passages.findIndex(p => p.id === prevQ.passage_id);
                      if (passageIdx !== -1) setCurrentPassageIndex(passageIdx);
                      setMobileView('questions');
                    }
                  }}
                  disabled={displayQuestions.findIndex(q => q.question_number === currentQuestion) === 0}
                >
                  <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <button 
                  className="ielts-nav-arrow ielts-nav-arrow-primary"
                  onClick={() => {
                    const idx = displayQuestions.findIndex(q => q.question_number === currentQuestion);
                    if (idx < displayQuestions.length - 1) {
                      const nextQ = displayQuestions[idx + 1];
                      setCurrentQuestion(nextQ.question_number);
                      const passageIdx = passages.findIndex(p => p.id === nextQ.passage_id);
                      if (passageIdx !== -1) setCurrentPassageIndex(passageIdx);
                      setMobileView('questions');
                    }
                  }}
                >
                  <ArrowRight size={20} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Navigation - stays fixed */}
        <ReadingNavigation
          questions={displayQuestions}
          answers={answers}
          currentQuestion={currentQuestion}
          setCurrentQuestion={setCurrentQuestion}
          currentPassageIndex={currentPassageIndex}
          passages={passages}
          onPassageChange={setCurrentPassageIndex}
          flaggedQuestions={flaggedQuestions}
          onToggleFlag={(num) => {
            setFlaggedQuestions(prev => {
              const newSet = new Set(prev);
              if (newSet.has(num)) {
                newSet.delete(num);
              } else {
                newSet.add(num);
              }
              return newSet;
            });
          }}
          onSubmit={() => setShowSubmitDialog(true)}
          questionGroups={questionGroups}
        />
      </div>
      {testId && (
        <NoteSidebar 
          testId={testId} 
          isOpen={isNoteSidebarOpen} 
          onOpenChange={setIsNoteSidebarOpen} 
          renderRichText={renderRichText}
        />
      )}
      <SubmitConfirmDialog
        open={showSubmitDialog}
        onOpenChange={setShowSubmitDialog}
        onConfirm={handleSubmit}
        timeRemaining={timeLeft}
        answeredCount={submitStats.answeredCount}
        totalCount={submitStats.totalCount}
        contrastMode={contrastMode}
      />
      <RestoreTestStateDialog
        open={showRestoreDialog}
        timeLeft={restoredTimeLeft ?? 0}
        answeredCount={submitStats.answeredCount}
        totalQuestions={submitStats.totalCount}
        onContinue={() => {
          localStorage.removeItem('pendingTestSubmission');
          setShowRestoreDialog(false);
          toast.success('Test resumed. Good luck!');
        }}
        onSubmit={async () => {
          localStorage.removeItem('pendingTestSubmission');
          setShowRestoreDialog(false);
          await handleSubmit();
        }}
      />
      <TestEntryOverlay
        onEnter={handleEnterTest}
        isVisible={showEntryOverlay && !testStarted}
        testType="reading"
        testTitle={test?.title}
      />
    </HighlightNoteProvider>
  );
}

// Helper function to convert number to roman numeral
function toRomanNumeral(num: number): string {
  const romanNumerals: [number, string][] = [
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ];
  let result = '';
  for (const [value, numeral] of romanNumerals) {
    while (num >= value) {
      result += numeral;
      num -= value;
    }
  }
  return result;
}