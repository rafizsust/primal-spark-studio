import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  WebAudioScheduledPlayer,
  ListeningQuestions,
  ListeningNavigation,
  ListeningTimer,
  AudioPlayOverlay,
} from '@/components/listening';
import { TestOptionsMenu, ContrastMode, TextSizeMode } from '@/components/reading/TestOptionsMenu';
import { Filter, X, ArrowLeft, ArrowRight, StickyNote } from 'lucide-react';
import {
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from '@/lib/utils';
import { HighlightNoteProvider } from '@/hooks/useHighlightNotes';
import { NoteSidebar } from '@/components/common/NoteSidebar';
import { SubmitConfirmDialog } from '@/components/common/SubmitConfirmDialog';
import { RestoreTestStateDialog } from '@/components/common/RestoreTestStateDialog';
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
  correct_answer: string;
  instruction: string | null;
  group_id: string;
  is_given: boolean;
  heading: string | null;
  table_data?: any;
  options?: string[] | null;
  option_format?: string | null;
}

interface QuestionGroup {
  id: string;
  question_type: string;
  instruction: string | null;
  start_question: number;
  end_question: number;
  options: any;
  option_format?: string;
  num_sub_questions?: number;
  questions: Question[];
  start_timestamp_seconds?: number | null;
}

interface Test {
  id: string;
  title: string;
  book_name: string;
  test_number: number;
  time_limit: number;
  total_questions: number;
  audio_url: string | null;
  audio_url_part1?: string | null;
  audio_url_part2?: string | null;
  audio_url_part3?: string | null;
  audio_url_part4?: string | null;
}

// Define question ranges for each part of the listening test
const LISTENING_PART_RANGES = [
  { label: 'Part 1', start: 1, end: 10 },
  { label: 'Part 2', start: 11, end: 20 },
  { label: 'Part 3', start: 21, end: 30 },
  { label: 'Part 4', start: 31, end: 40 },
];

// Helper to render rich text (markdown-like formatting)
const renderRichText = (text: string): string => {
  if (!text) return '';
  
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-2 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-3 mb-2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^• (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n/g, '<br/>');
};

export default function ListeningTest() {
  const { testId } = useParams<{ testId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const filterType = searchParams.get('type');
  const filterPart = searchParams.get('part');
  
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionGroups, setQuestionGroups] = useState<QuestionGroup[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // Test controls state
  const [_fontSize, _setFontSize] = useState(14);
  const [_isPaused, _setIsPaused] = useState(false);
  const [_customTime, setCustomTime] = useState(30);
  const [isTestCompleted, setIsTestCompleted] = useState(false);
  
  // Fullscreen mode
  const { enterFullscreen } = useFullscreenTest();
  
  // IELTS official options menu state
  const [contrastMode, setContrastMode] = useState<ContrastMode>('black-on-white');
  const [textSizeMode, setTextSizeMode] = useState<TextSizeMode>('regular');

  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [restoredTimeLeft, setRestoredTimeLeft] = useState<number | null>(null);
  const [flaggedQuestions, _setFlaggedQuestions] = useState<Set<number>>(new Set());
  const [showAudioOverlay, setShowAudioOverlay] = useState(true);
  const [testStarted, setTestStarted] = useState(false);
  const hasAutoSubmitted = useRef(false);
  const [mobileView, setMobileView] = useState<'questions' | 'audio'>('questions');
  const isMobile = useIsMobile();

  // Swipe gesture to navigate between parts on mobile
  const swipeHandlers = useSwipeGesture({
    onSwipeLeft: () => {
      if (isMobile && activePartIndex < LISTENING_PART_RANGES.length - 1) {
        const newIndex = activePartIndex + 1;
        setActivePartIndex(newIndex);
        setCurrentQuestion(LISTENING_PART_RANGES[newIndex].start);
      }
    },
    onSwipeRight: () => {
      if (isMobile && activePartIndex > 0) {
        const newIndex = activePartIndex - 1;
        setActivePartIndex(newIndex);
        setCurrentQuestion(LISTENING_PART_RANGES[newIndex].start);
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
    // URL slug -> DB/renderer type (normalized)
    'fill-in-blank': 'FILL_IN_BLANK',
    'multiple-choice': 'MULTIPLE_CHOICE_SINGLE',
    'multiple-choice-single': 'MULTIPLE_CHOICE_SINGLE',
    'multiple-choice-multiple': 'MULTIPLE_CHOICE_MULTIPLE',
    'matching-correct-letter': 'MATCHING_CORRECT_LETTER',
    'map-labelling': 'MAPS',
    'map-labeling': 'MAP_LABELING',
    'map-labelling-drag-drop': 'MAP_LABELING',
    'table-completion': 'TABLE_COMPLETION',
    'note-completion': 'FILL_IN_BLANK',
    'drag-and-drop': 'DRAG_AND_DROP_OPTIONS',
    'flowchart-completion': 'FLOWCHART_COMPLETION',
  };

  const clearFilter = () => {
    setSearchParams({});
  };

  const filteredQuestions = useMemo(() => {
    let filtered = questions;
    
    if (filterType) {
      const dbType = questionTypeMap[filterType] || filterType;
      const matchingGroups = questionGroups.filter(g => g.question_type === dbType);
      const groupIds = matchingGroups.map(g => g.id);
      filtered = filtered.filter(q => groupIds.includes(q.group_id));
    }
    
    if (filterPart) {
      const partIndex = parseInt(filterPart) - 1;
      if (partIndex >= 0 && partIndex < LISTENING_PART_RANGES.length) {
        const range = LISTENING_PART_RANGES[partIndex];
        filtered = filtered.filter(q => q.question_number >= range.start && q.question_number <= range.end);
      }
    }
    
    return filtered;
  }, [questions, questionGroups, filterType, filterPart]);

  const displayQuestions = filterType || filterPart ? filteredQuestions : questions;

  // Calculate initial audio start time and part based on filtered questions
  const { initialStartTime, initialPart } = useMemo(() => {
    if (!filterType && !filterPart) {
      return { initialStartTime: 0, initialPart: undefined };
    }

    // Find the first question group that matches the filter
    let relevantGroups = questionGroups;
    
    if (filterType) {
      const dbType = questionTypeMap[filterType] || filterType;
      relevantGroups = relevantGroups.filter(g => g.question_type === dbType);
    }
    
    if (filterPart) {
      const partIndex = parseInt(filterPart) - 1;
      if (partIndex >= 0 && partIndex < LISTENING_PART_RANGES.length) {
        const range = LISTENING_PART_RANGES[partIndex];
        relevantGroups = relevantGroups.filter(
          g => g.start_question >= range.start && g.end_question <= range.end
        );
      }
    }

    // Get the first matching group with a timestamp
    const firstGroupWithTimestamp = relevantGroups.find(g => g.start_timestamp_seconds != null);
    
    if (firstGroupWithTimestamp && firstGroupWithTimestamp.start_timestamp_seconds != null) {
      // Determine which part this group belongs to
      const groupStartQ = firstGroupWithTimestamp.start_question;
      let part = 1;
      for (let i = 0; i < LISTENING_PART_RANGES.length; i++) {
        const range = LISTENING_PART_RANGES[i];
        if (groupStartQ >= range.start && groupStartQ <= range.end) {
          part = i + 1;
          break;
        }
      }
      
      return {
        initialStartTime: Number(firstGroupWithTimestamp.start_timestamp_seconds),
        initialPart: part
      };
    }

    // If filtering by part but no timestamp, at least set the correct part
    if (filterPart) {
      return {
        initialStartTime: 0,
        initialPart: parseInt(filterPart)
      };
    }

    return { initialStartTime: 0, initialPart: undefined };
  }, [questionGroups, filterType, filterPart]);

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
        if (state.testId !== testId || state.testType !== 'listening') {
          fetchTestData();
          return;
        }

        // Check if user is now logged in
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          // Restore answers and other state
          if (state.answers) setAnswers(state.answers);
          if (state.currentQuestion) setCurrentQuestion(state.currentQuestion);
          
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
          if (state.timeLeft !== undefined) setTimeLeft(state.timeLeft);
        }
      } catch (e) {
        localStorage.removeItem('pendingTestSubmission');
      }

      fetchTestData();
    };

    restorePendingState();
  }, [testId]);


  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft <= 0 && !hasAutoSubmitted.current && questions.length > 0) {
      hasAutoSubmitted.current = true;
      setShowSubmitDialog(true);
    }
  }, [timeLeft, questions.length]);

  // Update current part based on current question
  useEffect(() => {
    const currentPart = LISTENING_PART_RANGES.findIndex(range => 
      currentQuestion >= range.start && currentQuestion <= range.end
    );
    if (currentPart !== -1 && currentPart !== activePartIndex) {
      setActivePartIndex(currentPart);
    }
  }, [currentQuestion, activePartIndex]);

  // Apply theme classes to body for portal elements
  useEffect(() => {
    const themeClasses = ['ielts-theme-black-on-white', 'ielts-theme-white-on-black', 'ielts-theme-yellow-on-black'];
    const textClasses = ['ielts-text-regular', 'ielts-text-large', 'ielts-text-extra-large'];
    
    document.body.classList.remove(...themeClasses, ...textClasses);
    
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
    
    return () => {
      document.body.classList.remove(...themeClasses, ...textClasses);
    };
  }, [contrastMode, textSizeMode]);

  const fetchTestData = async () => {
    try {
      if (!testId) return;

      const normalizeQuestionType = (rawType: string): string => {
        const t = (rawType || '').trim();
        if (!t) return t;
        const upper = t.toUpperCase();

        // Historical / import compatibility
        if (upper === 'MULTIPLE_CHOICE') return 'MULTIPLE_CHOICE_SINGLE';
        if (upper === 'MULTIPLE_CHOICE_SINGLE') return 'MULTIPLE_CHOICE_SINGLE';

        // Some imports may store short/slug forms
        if (upper === 'DRAG_AND_DROP') return 'DRAG_AND_DROP_OPTIONS';

        // British spelling / legacy naming
        if (upper === 'MAP_LABELLING') return 'MAP_LABELING';

        return upper;
      };

      const { data: testData, error: testError } = await supabase
        .from('listening_tests')
        .select('*')
        .eq('id', testId)
        .single();

      if (testError) throw testError;
      setTest(testData);
      setTimeLeft(testData.time_limit * 60);
      setCustomTime(testData.time_limit);

      const { data: groupsData, error: groupsError } = await supabase
        .from('listening_question_groups')
        .select('*, listening_questions(*)')
        .eq('test_id', testId)
        .order('start_question');

      if (groupsError) throw groupsError;

      const fetchedGroups: QuestionGroup[] = (groupsData || []).map((g) => {
        const normalizedType = normalizeQuestionType(g.question_type);

        let groupOptions: any = g.options;
        if (
          normalizedType === 'MATCHING_CORRECT_LETTER' ||
          normalizedType === 'MAPS' ||
          normalizedType === 'MAP_LABELING' ||
          normalizedType === 'MULTIPLE_CHOICE_MULTIPLE' ||
          normalizedType === 'DRAG_AND_DROP_OPTIONS' ||
          normalizedType === 'FLOWCHART_COMPLETION'
        ) {
          if (Array.isArray(groupOptions)) {
            groupOptions = { type: normalizedType, options: groupOptions, option_format: 'A' };
          }
        }

        return {
          ...g,
          question_type: normalizedType,
          start_timestamp_seconds: g.start_timestamp_seconds,
          questions: (g.listening_questions || [])
            .map((q) => ({
              id: q.id,
              question_number: q.question_number,
              question_type: normalizedType,
              question_text: q.question_text,
              correct_answer: q.correct_answer,
              instruction: g.instruction,
              group_id: q.group_id,
              is_given: q.is_given,
              heading: q.heading,
              table_data: q.table_data,
              options: Array.isArray(q.options) ? (q.options as string[]) : null,
              option_format: q.option_format || 'A',
            }))
            .sort((a, b) => a.question_number - b.question_number),
          options: groupOptions,
          option_format: (groupOptions as any)?.option_format || 'A',
          num_sub_questions: (groupOptions as any)?.num_sub_questions || 2,
        };
      });
      setQuestionGroups(fetchedGroups);

      const allQuestions = fetchedGroups.flatMap((group) => group.questions);
      setQuestions(allQuestions);

      if (allQuestions.length > 0) {
        setCurrentQuestion(allQuestions[0].question_number);
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

  const handleSubmit = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      localStorage.setItem('pendingTestSubmission', JSON.stringify({
        testId,
        testType: 'listening',
        answers,
        currentQuestion,
        timeLeft,
        returnPath: `/listening/test/${testId}`,
        savedAt: new Date().toISOString(),
        autoSubmitOnReturn: true,
      }));
      navigate(`/auth?returnTo=${encodeURIComponent(`/listening/test/${testId}`)}&pendingSubmission=true`);
      return;
    }

    const questionResults = questions.map(q => {
      const userAnswer = answers[q.question_number]?.trim() || '';
      const dbCorrectAnswer = q.correct_answer || '';
      
      let isCorrect = false;
      if (dbCorrectAnswer) {
        if (q.question_type === 'MULTIPLE_CHOICE_MULTIPLE') {
          const correctOptions = new Set(dbCorrectAnswer.split(',').map(opt => opt.trim().toLowerCase()).filter(Boolean));
          const userSelectedOptions = new Set(userAnswer.split(',').map(opt => opt.trim().toLowerCase()).filter(Boolean));
          isCorrect = [...correctOptions].every(opt => userSelectedOptions.has(opt)) && 
                      [...userSelectedOptions].every(opt => correctOptions.has(opt));
        } else {
          const normalizedUserAnswer = userAnswer.toLowerCase().trim();
          const acceptableCorrectAnswers = dbCorrectAnswer.split('/').map(a => a.trim().toLowerCase());
          isCorrect = acceptableCorrectAnswers.some(opt => opt === normalizedUserAnswer);
        }
      }
      
      return {
        questionNumber: q.question_number,
        questionText: q.question_text,
        userAnswer,
        correctAnswer: dbCorrectAnswer,
        isCorrect
      };
    });

    const score = questionResults.filter(r => r.isCorrect).length;
    const total = questionResults.length;
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    
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
    
    let submissionId = crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
    
    if (!testId) {
      console.error('No test ID available');
      return;
    }
    
    const { data: submission, error } = await supabase
      .from('listening_test_submissions')
      .insert([{
        user_id: user.id,
        test_id: testId,
        answers: answers,
        score,
        total_questions: total,
        band_score: bandScore
      }])
      .select()
      .single();
    
    if (!error && submission) {
      submissionId = submission.id as `${string}-${string}-${string}-${string}-${string}`;
    } else {
      console.error('Error saving submission:', error);
    }
    
    localStorage.removeItem('pendingTestSubmission');
    
    const resultData = {
      id: submissionId,
      score,
      total,
      percentage,
      bandScore,
      testTitle: test?.title || 'Listening Test',
      bookName: test?.book_name || '',
      testNumber: test?.test_number || 1,
      completedAt: new Date().toISOString(),
      questionResults
    };
    
    sessionStorage.setItem(`test_result_${submissionId}`, JSON.stringify(resultData));
    
    navigate(`/results/${submissionId}?type=listening&testId=${testId}`);
  };


  const handleTestComplete = useCallback(() => {
    setIsTestCompleted(true);
    setShowSubmitDialog(true);
  }, []);

  const handleAudioPlay = useCallback(() => {
    setShowAudioOverlay(false);
    setTestStarted(true);
    enterFullscreen();
  }, [enterFullscreen]);

  const currentPart = LISTENING_PART_RANGES[activePartIndex];

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

  // Submit dialog counts (handles grouped questions + ignores non-numeric answer keys)
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
      const maxFromGroups = questionGroups.length > 0 ? Math.max(...questionGroups.map((g) => g.end_question)) : 0;
      const maxFromQuestions = questions.length > 0 ? Math.max(...questions.map((q) => q.question_number)) : 0;
      const derivedMax = Math.max(maxFromGroups, maxFromQuestions);
      if (derivedMax > 0) return derivedMax;

      const fromTest = test?.total_questions;
      if (typeof fromTest === 'number' && fromTest > 0) return fromTest;

      return 40;
    })();

    // MCQ multiple stores all selections on the FIRST question number (comma-separated)
    const mcqMultipleNumbers = new Set<number>();
    let answeredCount = 0;

    const mcqMultipleGroups = questionGroups.filter((g) => g.question_type === 'MULTIPLE_CHOICE_MULTIPLE');
    for (const g of mcqMultipleGroups) {
      const rangeLen = Math.max(0, g.end_question - g.start_question + 1);
      for (let n = g.start_question; n <= g.end_question; n++) mcqMultipleNumbers.add(n);

      const raw = normalizedAnswers[g.start_question] || '';
      const selectedCount = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean).length
        : 0;

      answeredCount += Math.min(selectedCount, rangeLen);
    }

    // Everything else: count per question number
    for (let n = 1; n <= totalCount; n++) {
      if (mcqMultipleNumbers.has(n)) continue;
      if (isAnsweredValue(normalizedAnswers[n] || '')) answeredCount++;
    }

    answeredCount = Math.min(answeredCount, totalCount);

    return {
      totalCount,
      answeredCount,
    };
  }, [answers, questionGroups, questions, test?.total_questions]);


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
        <div className="text-destructive">Listening test not found</div>
      </div>
    );
  }

  // Allow tests without audio for practice mode

  return (
    <HighlightNoteProvider testId={testId!}>
      <div className={cn("h-screen flex flex-col overflow-hidden", getThemeClasses(), "ielts-test-content")}>
        {/* Fixed Container for Header and Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header - IELTS Official Style */}
        <header className="border-b px-2 md:px-4 py-1 md:py-3 flex items-center justify-between ielts-card ielts-header">
          {/* Left - IELTS Logo and Test Taker ID */}
          <div className="flex items-center gap-2 md:gap-4">
            <div className="ielts-logo">
              <span className="text-lg md:text-xl font-black tracking-tight text-[#c8102e]">IELTS</span>
            </div>
            <span className="text-sm font-medium ielts-test-info hidden md:inline">Test taker ID</span>
          </div>

          {/* Center - Seamless Audio Player (official IELTS timing) - hidden on mobile */}
          {(test.audio_url || test.audio_url_part1 || test.audio_url_part2 || test.audio_url_part3 || test.audio_url_part4) && (
            <div className="hidden md:block flex-1 max-w-xl mx-4">
              <WebAudioScheduledPlayer 
                audioUrls={{
                  part1: test.audio_url_part1 || test.audio_url,
                  part2: test.audio_url_part2,
                  part3: test.audio_url_part3,
                  part4: test.audio_url_part4,
                }}
                initialStartTime={initialStartTime}
                initialPart={initialPart}
                onPartChange={(partNumber: number) => {
                  // Jump to first question of the new part
                  const partRange = LISTENING_PART_RANGES[partNumber - 1];
                  if (partRange) {
                    setCurrentQuestion(partRange.start);
                  }
                }}
                onTestComplete={handleTestComplete}
              />
            </div>
          )}

          {/* Right - Timer, Notes, and Menu */}
          <div className="flex items-center gap-1 md:gap-3">
            <ListeningTimer 
              timeLeft={timeLeft} 
              setTimeLeft={setTimeLeft} 
              isPaused={!testStarted || isTestCompleted}
              onTogglePause={() => {}}
            />
            {/* Notes Button */}
            <button 
              className="p-2 rounded transition-colors ielts-icon-btn"
              onClick={() => setIsNoteSidebarOpen(true)}
              title="Notes"
            >
              <StickyNote className="w-5 h-5" />
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
                {initialStartTime > 0 && (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                    Audio starts at {Math.floor(initialStartTime / 60)}:{String(Math.floor(initialStartTime % 60)).padStart(2, '0')}
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={clearFilter} className="gap-1 text-primary hover:text-primary/80">
                <X size={14} />
                Clear Filter
              </Button>
            </div>
          )}

          {/* Mobile Part/Questions Tabs - compact, right below header - hidden on desktop */}
          <div className="md:hidden flex border-b border-border bg-muted/40">
            {LISTENING_PART_RANGES.map((part, idx) => (
              <button
                key={part.label}
                className={cn(
                  "flex-1 py-1.5 text-xs font-medium text-center transition-colors",
                  idx === activePartIndex && mobileView === 'questions'
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
                onClick={() => {
                  setActivePartIndex(idx);
                  setMobileView('questions');
                  setCurrentQuestion(part.start);
                }}
              >
                Part {idx + 1}
              </button>
            ))}
            <button
              className={cn(
                "flex-1 py-1.5 text-xs font-medium text-center transition-colors",
                mobileView === 'audio'
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              onClick={() => setMobileView('audio')}
            >
              Audio
            </button>
          </div>

          {/* Part Header - IELTS Official Style with teal left border */}
          <div className="ielts-part-header hidden md:block">
            <h2>{currentPart.label}</h2>
            <p className="not-italic">Listen and answer questions {currentPart.start}–{currentPart.end}.</p>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Desktop: Full questions view */}
            <div className="hidden md:block h-full">
              <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel defaultSize={100} minSize={100} maxSize={100}>
                  <div className="h-full flex flex-col relative">
                    <div 
                      className={cn(
                        "flex-1 overflow-y-auto overflow-x-hidden p-6 pb-20 bg-white",
                        "scrollbar-thin scrollbar-thumb-[hsl(0_0%_75%)] scrollbar-track-transparent hover:scrollbar-thumb-[hsl(0_0%_60%)]",
                        "font-[var(--font-ielts)] text-foreground"
                      )}
                    >
                      <ListeningQuestions 
                        testId={testId!}
                        questions={questions.filter(q => q.question_number >= currentPart.start && q.question_number <= currentPart.end)}
                        questionGroups={questionGroups.filter(g => g.start_question >= currentPart.start && g.end_question <= currentPart.end)}
                        answers={answers}
                        onAnswerChange={handleAnswerChange}
                        currentQuestion={currentQuestion}
                        setCurrentQuestion={setCurrentQuestion}
                        fontSize={14}
                        renderRichText={renderRichText}
                      />
                    </div>
                    
                    {/* Floating Navigation Arrows - positioned immediately above bottom nav */}
                    <div className="absolute bottom-2 right-4 flex items-center gap-2 z-10">
                      <button 
                        className={cn(
                          "ielts-nav-arrow",
                          currentQuestion === displayQuestions[0]?.question_number && "opacity-40 cursor-not-allowed"
                        )}
                        onClick={() => {
                          const idx = displayQuestions.findIndex(q => q.question_number === currentQuestion);
                          if (idx > 0) {
                            const prevQ = displayQuestions[idx - 1];
                            setCurrentQuestion(prevQ.question_number);
                            const partIdx = LISTENING_PART_RANGES.findIndex(
                              r => prevQ.question_number >= r.start && prevQ.question_number <= r.end
                            );
                            if (partIdx !== -1) setActivePartIndex(partIdx);
                          }
                        }}
                        disabled={currentQuestion === displayQuestions[0]?.question_number}
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
                            const partIdx = LISTENING_PART_RANGES.findIndex(
                              r => nextQ.question_number >= r.start && nextQ.question_number <= r.end
                            );
                            if (partIdx !== -1) setActivePartIndex(partIdx);
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

            {/* Mobile: Switch between Questions and Audio based on mobileView */}
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
              {mobileView === 'questions' ? (
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-20 bg-white font-[var(--font-ielts)] text-foreground">
                  <ListeningQuestions 
                    testId={testId!}
                    questions={questions.filter(q => q.question_number >= currentPart.start && q.question_number <= currentPart.end)}
                    questionGroups={questionGroups.filter(g => g.start_question >= currentPart.start && g.end_question <= currentPart.end)}
                    answers={answers}
                    onAnswerChange={handleAnswerChange}
                    currentQuestion={currentQuestion}
                    setCurrentQuestion={setCurrentQuestion}
                    fontSize={14}
                    renderRichText={renderRichText}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-4 bg-white">
                  <p className="text-sm text-muted-foreground mb-4">Audio Player</p>
                  {(test.audio_url || test.audio_url_part1 || test.audio_url_part2 || test.audio_url_part3 || test.audio_url_part4) && (
                    <div className="w-full max-w-md">
                      <WebAudioScheduledPlayer 
                        audioUrls={{
                          part1: test.audio_url_part1 || test.audio_url,
                          part2: test.audio_url_part2,
                          part3: test.audio_url_part3,
                          part4: test.audio_url_part4,
                        }}
                        initialStartTime={initialStartTime}
                        initialPart={initialPart}
                        onPartChange={(partNumber: number) => {
                          const partRange = LISTENING_PART_RANGES[partNumber - 1];
                          if (partRange) {
                            setCurrentQuestion(partRange.start);
                            setActivePartIndex(partNumber - 1);
                          }
                        }}
                        onTestComplete={handleTestComplete}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Navigation - stays fixed */}
        <ListeningNavigation
          questions={displayQuestions}
          answers={answers}
          currentQuestion={currentQuestion}
          setCurrentQuestion={setCurrentQuestion}
          activePartIndex={activePartIndex}
          onPartSelect={setActivePartIndex}
          partRanges={LISTENING_PART_RANGES}
          flaggedQuestions={flaggedQuestions}
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
      {/* Audio Play Overlay - IELTS Official Style */}
      {test.audio_url && (
        <AudioPlayOverlay 
          onPlay={handleAudioPlay} 
          isVisible={showAudioOverlay} 
        />
      )}
    </HighlightNoteProvider>
  );
}
