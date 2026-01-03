import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ReadingPassage } from '@/components/reading/ReadingPassage';
import { ReadingQuestions } from '@/components/reading/ReadingQuestions';
import { ReadingTimer } from '@/components/reading/ReadingTimer';
import { ReadingNavigation } from '@/components/reading/ReadingNavigation';
import { TestOptionsMenu, ContrastMode, TextSizeMode } from '@/components/reading/TestOptionsMenu';
import { TestStartOverlay } from '@/components/common/TestStartOverlay';
import { ExitTestConfirmDialog } from '@/components/common/ExitTestConfirmDialog';
import { StickyNote, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from '@/lib/utils';
import { checkAnswer } from '@/lib/ieltsAnswerValidation';
import { HighlightNoteProvider } from '@/hooks/useHighlightNotes';
import { NoteSidebar } from '@/components/common/NoteSidebar';
import { SubmitConfirmDialog } from '@/components/common/SubmitConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useTopicCompletions } from '@/hooks/useTopicCompletions';
import { 
  loadGeneratedTest,
  loadGeneratedTestAsync,
  savePracticeResultAsync,
  GeneratedTest,
  PracticeResult,
  QuestionResult 
} from '@/types/aiPractice';
import { renderRichText } from '@/components/admin/RichTextEditor';

// Interfaces matching ReadingQuestions component
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
  table_data?: any; // For TABLE_COMPLETION
}

interface Passage {
  id: string;
  passage_number: number;
  title: string;
  content: string;
  show_labels?: boolean;
}

interface QuestionGroup {
  id: string;
  question_type: string;
  options: any;
  start_question: number;
  end_question: number;
  instruction?: string | null;
}

export default function AIPracticeReadingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { incrementCompletion } = useTopicCompletions('reading');
  
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionGroups, setQuestionGroups] = useState<QuestionGroup[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  // Matching headings state (needed for drag/drop UI)
  const [headingAnswers, setHeadingAnswers] = useState<Record<string, string>>({}); // paragraphLabel -> headingId
  const [selectedHeading, setSelectedHeading] = useState<string | null>(null);
  
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [currentPassageIndex, setCurrentPassageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [testStarted, setTestStarted] = useState(false);
  const [showStartOverlay, setShowStartOverlay] = useState(true);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'passage' | 'questions'>('passage');
  const [flaggedQuestions] = useState<Set<number>>(new Set());
  
  // Theme settings
  const [contrastMode, setContrastMode] = useState<ContrastMode>('black-on-white');
  const [textSizeMode, setTextSizeMode] = useState<TextSizeMode>('regular');
  
  const startTimeRef = useRef<number>(Date.now());

  // Helper to initialize state from test data
  const initializeTest = useCallback((loadedTest: GeneratedTest) => {
    setTest(loadedTest);
    setTimeLeft(loadedTest.timeMinutes * 60);
    startTimeRef.current = Date.now();

    // Convert AI passage to expected format
    // Check if this is a matching headings test - show labels if so
    const isMatchingHeadings = loadedTest.questionGroups?.some(g => g.question_type === 'MATCHING_HEADINGS');

    // NOTE: Admin/bulk presets may omit passage.id; the renderer relies on passage.id to
    // associate questions with the passage. So we generate a stable fallback id.
    const passageId = (loadedTest.passage as any)?.id || loadedTest.id || 'passage-1';

    if (loadedTest.passage) {
      const passage: Passage = {
        id: passageId,
        passage_number: 1,
        title: loadedTest.passage.title,
        content: loadedTest.passage.content,
        show_labels: isMatchingHeadings, // Enable labels for matching headings
      };
      setPassages([passage]);
    }

    // Convert AI questions to expected format
    if (loadedTest.questionGroups && loadedTest.questionGroups.length > 0) {
      // Normalize question type - DO NOT use fallback, invalid types should be rejected upstream
      const normalizeType = (raw: unknown) => {
        const t = String(raw ?? '').trim();
        if (!t) {
          console.error('Missing question_type in AI payload - test is malformed');
          return null; // Return null to indicate invalid
        }
        const upper = t.toUpperCase();
        // Reading renderer expects MULTIPLE_CHOICE for single-select
        if (upper === 'MULTIPLE_CHOICE_SINGLE') return 'MULTIPLE_CHOICE';
        // Normalize British spelling and variants
        if (upper === 'MAP_LABELLING') return 'MAP_LABELING';
        if (upper === 'SUMMARY_WORD_BANK') return 'SUMMARY_WORD_BANK';
        return upper;
      };

      const convertedQuestions: Question[] = [];
      const convertedGroups: QuestionGroup[] = [];

      loadedTest.questionGroups.forEach((group) => {
        const groupType = normalizeType(group.question_type);

        // Skip groups with invalid/missing question_type
        if (!groupType) {
          console.error('Skipping question group with missing question_type:', group.id);
          return;
        }

        convertedGroups.push({
          id: group.id,
          question_type: groupType,
          options: group.options,
          start_question: group.start_question,
          end_question: group.end_question,
          instruction: group.instruction || null,
        });

        group.questions.forEach((q) => {
          // For TABLE_COMPLETION, get table_data from group options if not on question
          const tableData = q.table_data || (group.options as any)?.table_data || null;
          const questionType = normalizeType(q.question_type) || groupType;

          convertedQuestions.push({
            id: q.id,
            question_number: q.question_number,
            question_type: questionType,
            question_text: q.question_text,
            options: (q as any).options || null,
            correct_answer: q.correct_answer,
            instruction: null,
            passage_id: passageId,
            question_group_id: group.id,
            heading: q.heading || null,
            table_data: tableData,
          });
        });
      });

      setQuestions(convertedQuestions.sort((a, b) => a.question_number - b.question_number));
      setQuestionGroups(convertedGroups);

      if (convertedQuestions.length > 0) {
        setCurrentQuestion(convertedQuestions[0].question_number);
      }
    }

    setLoading(false);
  }, []);

  // Load AI-generated test: first from memory cache, else from Supabase
  useEffect(() => {
    if (!testId) {
      navigate('/ai-practice');
      return;
    }

    // Try memory cache first
    const cachedTest = loadGeneratedTest(testId);
    if (cachedTest && cachedTest.module === 'reading') {
      initializeTest(cachedTest);
      return;
    }

    // Fallback: load from Supabase
    loadGeneratedTestAsync(testId).then((t) => {
      if (!t || t.module !== 'reading') {
        toast.error('Reading test not found');
        navigate('/ai-practice');
        return;
      }
      initializeTest(t);
    });
  }, [testId, navigate, initializeTest]);

  const currentPassage = passages[currentPassageIndex];
  const currentPassageQuestions = currentPassage
    ? questions.filter(q => q.passage_id === currentPassage.id)
    : questions;

  // ───────────────────────────────────────────────────────────────────────────
  // Matching Headings (AI practice) - replicate standard ReadingTest wiring
  // ───────────────────────────────────────────────────────────────────────────
  const matchingHeadingsQuestions = useMemo(
    () => currentPassageQuestions.filter(q => q.question_type === 'MATCHING_HEADINGS'),
    [currentPassageQuestions]
  );

  const hasMatchingHeadings = matchingHeadingsQuestions.length > 0;

  const toRomanNumeral = (num: number) => {
    const roman: Record<number, string> = {
      1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X',
      11: 'XI', 12: 'XII', 13: 'XIII', 14: 'XIV', 15: 'XV',
    };
    return roman[num] || String(num);
  };

  // Extract just the paragraph letter from question_text (e.g., "Paragraph A" -> "A")
  // Also create a mapping from extracted label back to question for answer syncing
  const { headingParagraphLabels, labelToQuestionMap } = useMemo(() => {
    const labels: string[] = [];
    const mapping: Record<string, Question> = {};
    
    matchingHeadingsQuestions.forEach(q => {
      // Try to extract just the letter from "Paragraph A" format
      const match = q.question_text.match(/(?:Paragraph\s+)?([A-Z])$/i);
      const label = match ? match[1].toUpperCase() : q.question_text.toUpperCase();
      labels.push(label);
      mapping[label] = q;
    });
    
    return { headingParagraphLabels: labels, labelToQuestionMap: mapping };
  }, [matchingHeadingsQuestions]);

  const headingOptions = useMemo(() => {
    if (!hasMatchingHeadings) return [];

    const matchingGroup = questionGroups.find(
      (g) =>
        g.question_type === 'MATCHING_HEADINGS' &&
        matchingHeadingsQuestions.some((q) => q.question_group_id === g.id)
    );

    const raw = (matchingGroup?.options || {}) as any;
    const headingsList: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.headings)
        ? raw.headings
        : Array.isArray(raw?.options)
          ? raw.options
          : [];

    return headingsList.map((opt: any, idx: number) => {
      if (typeof opt === 'string') return { id: toRomanNumeral(idx + 1), text: opt };
      const id = typeof opt?.id === 'string' ? opt.id : toRomanNumeral(idx + 1);
      const text = typeof opt?.text === 'string' ? opt.text : typeof opt?.label === 'string' ? opt.label : String(opt ?? '');
      return { id, text };
    });
  }, [hasMatchingHeadings, matchingHeadingsQuestions, questionGroups]);

  const headingQuestionNumbers = useMemo(() => {
    if (!hasMatchingHeadings) return {} as Record<string, number>;

    const matchingGroup = questionGroups.find(
      (g) =>
        g.question_type === 'MATCHING_HEADINGS' &&
        matchingHeadingsQuestions.some((q) => q.question_group_id === g.id)
    );

    const startQuestion = matchingGroup?.start_question ?? 1;
    const mapping: Record<string, number> = {};
    headingParagraphLabels.forEach((label, index) => {
      mapping[label] = startQuestion + index;
    });
    return mapping;
  }, [hasMatchingHeadings, headingParagraphLabels, matchingHeadingsQuestions, questionGroups]);

  const handleHeadingDrop = useCallback((paragraphLabel: string, headingId: string) => {
    setHeadingAnswers(prev => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k] === headingId) delete next[k];
      });
      next[paragraphLabel] = headingId;
      return next;
    });

    // Use direct lookup from pre-computed mapping - paragraphLabel is "A", "B", etc.
    const normalizedLabel = paragraphLabel.toUpperCase();
    const matchingQ = labelToQuestionMap[normalizedLabel];
    if (matchingQ) {
      setAnswers(prev => ({ ...prev, [matchingQ.question_number]: headingId }));
    }
  }, [labelToQuestionMap]);

  const handleHeadingRemove = useCallback((paragraphLabel: string) => {
    setHeadingAnswers(prev => {
      const next = { ...prev };
      delete next[paragraphLabel];
      return next;
    });

    // Use direct lookup from pre-computed mapping
    const normalizedLabel = paragraphLabel.toUpperCase();
    const matchingQ = labelToQuestionMap[normalizedLabel];
    if (matchingQ) {
      setAnswers(prev => ({ ...prev, [matchingQ.question_number]: '' }));
    }
  }, [labelToQuestionMap]);

  const handleSelectPlace = useCallback((paragraphLabel: string) => {
    if (!selectedHeading) return;
    handleHeadingDrop(paragraphLabel, selectedHeading);
    setSelectedHeading(null);
  }, [handleHeadingDrop, selectedHeading]);

  const handleHeadingAnswerChange = useCallback((paragraphLabel: string, headingId: string | null) => {
    if (!headingId) {
      handleHeadingRemove(paragraphLabel);
      return;
    }
    handleHeadingDrop(paragraphLabel, headingId);
  }, [handleHeadingDrop, handleHeadingRemove]);

  const handleAnswerChange = (questionNumber: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionNumber]: answer }));
  };

  const handleSubmit = async () => {
    if (!test) return;

    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);
    
    // Build question results with MCMA group handling
    const questionResults: QuestionResult[] = [];
    const processedQuestionNumbers = new Set<number>();
    
    // Process MCMA groups first (one result per group with partial scoring)
    for (const group of questionGroups) {
      if (group.question_type === 'MULTIPLE_CHOICE_MULTIPLE') {
        const rangeNumbers: number[] = [];
        for (let n = group.start_question; n <= group.end_question; n++) {
          rangeNumbers.push(n);
          processedQuestionNumbers.add(n);
        }
        
        // User's answer is stored on start_question only
        const userAnswerRaw = answers[group.start_question]?.trim() || '';
        const userLetters = userAnswerRaw
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean);
        
        // Always read correct answers from the saved ai_practice_tests payload (never from user input)
        const firstQFromTest = test.questionGroups?.flatMap(g => g.questions).find(
          (oq) => oq.question_number === group.start_question
        );
        const correctAnswerRaw = firstQFromTest?.correct_answer || '';
        const correctLetters = correctAnswerRaw
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean);
        
        // Partial scoring: count how many user selections are correct
        const correctSelections = userLetters.filter(l => correctLetters.includes(l));
        const partialScore = correctSelections.length;
        const maxScore = correctLetters.length;
        const isFullyCorrect = partialScore === maxScore && userLetters.length === maxScore;
        
        // Get explanation from original test data
        const originalQ = test.questionGroups?.flatMap(g => g.questions).find(
          oq => oq.question_number === group.start_question
        );
        
        questionResults.push({
          questionNumber: group.start_question,
          questionNumbers: rangeNumbers,
          userAnswer: userLetters.join(','),
          correctAnswer: correctLetters.join(','),
          isCorrect: isFullyCorrect,
          partialScore,
          maxScore,
          explanation: originalQ?.explanation || '',
          questionType: 'MULTIPLE_CHOICE_MULTIPLE',
        });
      }
    }
    
    // Process remaining questions (non-MCMA)
    for (const q of questions) {
      if (processedQuestionNumbers.has(q.question_number)) continue;
      
      const userAnswer = answers[q.question_number]?.trim() || '';
      const correctAnswer =
        test.questionGroups?.flatMap(g => g.questions).find(
          (oq) => oq.question_number === q.question_number
        )?.correct_answer ?? q.correct_answer;

      const questionType = q.question_type || 
        test.questionGroups?.find(g => 
          g.questions.some(gq => gq.question_number === q.question_number)
        )?.question_type;

      const isCorrect = checkAnswer(userAnswer, correctAnswer, questionType);
      
      const originalQ = test.questionGroups?.flatMap(g => g.questions).find(
        oq => oq.question_number === q.question_number
      );
      
      questionResults.push({
        questionNumber: q.question_number,
        userAnswer,
        correctAnswer,
        isCorrect,
        explanation: originalQ?.explanation || '',
        questionType,
      });
    }

    // Sort by question number
    questionResults.sort((a, b) => a.questionNumber - b.questionNumber);

    // Calculate score: sum partial scores for MCMA, 1 for correct others
    let score = 0;
    let total = 0;
    for (const r of questionResults) {
      if (r.questionType === 'MULTIPLE_CHOICE_MULTIPLE' && r.maxScore !== undefined) {
        score += r.partialScore || 0;
        total += r.maxScore;
      } else {
        if (r.isCorrect) score += 1;
        total += 1;
      }
    }
    
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

    const result: PracticeResult = {
      testId: test.id,
      answers,
      score,
      totalQuestions: total,
      bandScore,
      completedAt: new Date().toISOString(),
      timeSpent,
      questionResults,
    };

    // Save result to Supabase
    if (user) {
      await savePracticeResultAsync(result, user.id, 'reading');
      // Track topic completion
      if (test.topic) {
        incrementCompletion(test.topic);
      }
    }
    navigate(`/ai-practice/results/${test.id}`);
  };

  // Font size based on text size mode
  const fontSize = useMemo(() => {
    return { 'regular': 14, 'large': 16, 'extra-large': 18 }[textSizeMode];
  }, [textSizeMode]);

  // Get theme classes
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

  // Submit stats (group-aware)
  // For MULTIPLE_CHOICE_MULTIPLE we store the selected letters only on start_question,
  // but the group represents N answers (max_answers). The submit dialog should reflect that.
  const submitStats = useMemo(() => {
    if (!questionGroups.length) {
      const totalCount = questions.length;
      const answeredCount = Object.keys(answers).filter((k) => answers[Number(k)]?.trim().length > 0).length;
      return { totalCount, answeredCount };
    }

    let totalCount = 0;
    let answeredCount = 0;

    for (const group of questionGroups) {
      const rangeCount = Math.max(0, (group.end_question ?? 0) - (group.start_question ?? 0) + 1);

      if (group.question_type === 'MULTIPLE_CHOICE_MULTIPLE') {
        const maxAnswers = Number(group.options?.max_answers ?? rangeCount ?? 2) || 2;
        totalCount += maxAnswers;

        const selected = (answers[group.start_question] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        answeredCount += Math.min(selected.length, maxAnswers);
        continue;
      }

      totalCount += rangeCount;
      for (let qNum = group.start_question; qNum <= group.end_question; qNum++) {
        if (answers[qNum]?.trim()) answeredCount += 1;
      }
    }

    return { totalCount, answeredCount };
  }, [answers, questions.length, questionGroups]);

  const getQuestionGroupOptions = useCallback((questionGroupId: string | null): any => {
    if (!questionGroupId) return null;
    return questionGroups.find(g => g.id === questionGroupId) || null;
  }, [questionGroups]);

  const getMaxAnswers = useCallback((questionGroupId: string | null) => {
    if (!questionGroupId) return 2;
    const group = questionGroups.find(g => g.id === questionGroupId);
    if (group?.options?.max_answers) {
      return group.options.max_answers;
    }
    return 2;
  }, [questionGroups]);

  const getMatchingSentenceEndingsGroupOptions = useCallback((questionGroupId: string | null): string[] => {
    if (!questionGroupId) return [];
    const group = questionGroups.find(g => g.id === questionGroupId);
    const raw = (group?.options || {}) as any;
    
    // Handle sentence_endings array (AI-generated format: [{id, text}] or string[])
    if (Array.isArray(raw?.sentence_endings)) {
      return raw.sentence_endings.map((e: any) => 
        typeof e === 'string' ? e : `${e.id || ''} ${e.text || ''}`.trim()
      );
    }
    // Handle direct array format
    if (Array.isArray(group?.options)) {
      return (group.options as any[]).map((e: any) => 
        typeof e === 'string' ? e : `${e.id || ''} ${e.text || ''}`.trim()
      );
    }
    if (Array.isArray(raw?.options)) {
      return raw.options.map((e: any) => 
        typeof e === 'string' ? e : `${e.id || ''} ${e.text || ''}`.trim()
      );
    }
    return [];
  }, [questionGroups]);

  const getTableSelectionOptions = useCallback((questionGroupId: string | null): string[] => {
    if (!questionGroupId) return [];
    const group = questionGroups.find(g => g.id === questionGroupId);
    if (!group?.options) return [];
    if (Array.isArray(group.options)) return group.options as any;
    if (Array.isArray((group.options as any).options)) return (group.options as any).options as string[];
    return [];
  }, [questionGroups]);

  // Get question range for display
  const getPassageQuestionRange = () => {
    if (currentPassageQuestions.length === 0) return '';
    const nums = currentPassageQuestions.map(q => q.question_number).sort((a, b) => a - b);
    if (nums.length === 0) return '';
    if (nums.length === 1) return `${nums[0]}`;
    return `${nums[0]}-${nums[nums.length - 1]}`;
  };

  // Apply theme classes to body
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

  // Handle test start from overlay
  const handleStartTest = useCallback(() => {
    setShowStartOverlay(false);
    setTestStarted(true);
    startTimeRef.current = Date.now();
  }, []);

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

  // Show start overlay before test begins
  if (showStartOverlay) {
    return (
      <TestStartOverlay
        module="reading"
        testTitle={`AI Practice: ${test.questionType?.replace(/_/g, ' ') || 'Reading Test'}`}
        timeMinutes={test.timeMinutes}
        totalQuestions={test.totalQuestions}
        questionType={test.questionType || 'Reading'}
        difficulty={test.difficulty}
        onStart={handleStartTest}
        onCancel={() => navigate('/ai-practice')}
      />
    );
  }

  return (
    <HighlightNoteProvider testId={testId!}>
      <div className={cn("h-screen flex flex-col overflow-hidden", getThemeClasses(), "ielts-test-content")}>
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header - IELTS Official Style with AI Practice badge */}
          <header className="border-b border-border bg-white px-2 md:px-4 py-1 md:py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4">
              <button 
                onClick={() => setShowExitDialog(true)}
                className="p-2 rounded hover:bg-muted transition-colors"
                title="Exit Test"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <ExitTestConfirmDialog
                open={showExitDialog}
                onOpenChange={setShowExitDialog}
                onConfirm={() => navigate('/ai-practice')}
                testType="Reading Test"
              />
              <div className="ielts-logo">
                <span className="text-lg md:text-xl font-black tracking-tight text-[#c8102e]">IELTS</span>
              </div>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" />
                AI Practice
              </Badge>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <ReadingTimer 
                timeLeft={timeLeft} 
                setTimeLeft={setTimeLeft} 
                isPaused={!testStarted || isPaused} 
                onTogglePause={() => setIsPaused(!isPaused)} 
              />
              <button 
                className="ielts-icon-btn p-2 rounded hover:bg-muted transition-colors"
                onClick={() => setIsNoteSidebarOpen(true)}
                title="Notes"
              >
                <StickyNote className="w-5 h-5 text-foreground/70" />
              </button>
              <TestOptionsMenu
                contrastMode={contrastMode}
                setContrastMode={setContrastMode}
                textSizeMode={textSizeMode}
                setTextSizeMode={setTextSizeMode}
                onSubmit={() => setShowSubmitDialog(true)}
              />
            </div>
          </header>

          {/* Topic/Difficulty Banner */}
          <div className="bg-primary/5 border-b border-primary/20 px-4 py-2 flex items-center gap-2">
            <span className="text-sm font-medium">{test.topic}</span>
            <Badge variant="outline" className="text-xs capitalize">{test.difficulty}</Badge>
            <Badge variant="secondary" className="text-xs">{test.questionType.replace(/_/g, ' ')}</Badge>
          </div>

          {/* Mobile Tabs */}
          <div className="md:hidden flex border-b border-border bg-muted/40">
            <button
              className={cn(
                "flex-1 py-1.5 text-xs font-medium text-center transition-colors",
                mobileView === 'passage'
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              onClick={() => setMobileView('passage')}
            >
              Passage
            </button>
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

          {/* Part Header */}
          <div className="ielts-part-header">
            <h2>Part 1</h2>
            <p>Read the text and answer questions {getPassageQuestionRange()}.</p>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Desktop: Resizable Panels */}
            <div className="hidden md:block h-full">
              <ResizablePanelGroup direction="horizontal" className="h-full">
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
                          showLabels={hasMatchingHeadings}
                          onQuestionFocus={setCurrentQuestion}
                        />
                      )}
                    </div>
                  </div>
                </ResizablePanel>
                
                <ResizableHandle className="relative w-px bg-border cursor-col-resize select-none">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center border-2 border-border bg-background">
                    <svg viewBox="0 0 24 12" className="h-4 w-6 text-foreground/80" fill="none">
                      <path d="M6 2 L2 6 L6 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M2 6 H22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M18 2 L22 6 L18 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </ResizableHandle>
                
                <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
                  <div className="h-full flex flex-col relative">
                    <div
                      className={cn(
                        "flex-1 overflow-y-auto overflow-x-hidden p-6 pb-20 ielts-card question-text",
                        "scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent hover:scrollbar-thumb-primary/40",
                        "font-[var(--font-ielts)]"
                      )}
                    >
                      <ReadingQuestions 
                        testId={testId!}
                        questions={currentPassageQuestions}
                        answers={answers}
                        onAnswerChange={handleAnswerChange}
                        currentQuestion={currentQuestion}
                        setCurrentQuestion={setCurrentQuestion}
                        fontSize={fontSize}
                        renderRichText={renderRichText}
                        getMaxAnswers={getMaxAnswers}
                        getQuestionGroupOptions={getQuestionGroupOptions}
                        getMatchingSentenceEndingsGroupOptions={getMatchingSentenceEndingsGroupOptions}
                        getTableSelectionOptions={getTableSelectionOptions}
                        headingOptions={headingOptions}
                        headingAnswers={headingAnswers}
                        paragraphLabels={headingParagraphLabels}
                        onHeadingAnswerChange={handleHeadingAnswerChange}
                        selectedHeading={selectedHeading}
                        onSelectedHeadingChange={setSelectedHeading}
                      />
                    </div>
                    
                    {/* Floating Navigation Arrows */}
                    <div className="absolute bottom-2 right-4 flex items-center gap-2 z-10">
                      <button 
                        className={cn(
                          "ielts-nav-arrow",
                          questions.findIndex(q => q.question_number === currentQuestion) === 0 && "opacity-40 cursor-not-allowed"
                        )}
                        onClick={() => {
                          const idx = questions.findIndex(q => q.question_number === currentQuestion);
                          if (idx > 0) {
                            setCurrentQuestion(questions[idx - 1].question_number);
                          }
                        }}
                        disabled={questions.findIndex(q => q.question_number === currentQuestion) === 0}
                      >
                        <ArrowLeft size={24} strokeWidth={2.5} />
                      </button>
                      <button 
                        className="ielts-nav-arrow ielts-nav-arrow-primary"
                        onClick={() => {
                          const idx = questions.findIndex(q => q.question_number === currentQuestion);
                          if (idx < questions.length - 1) {
                            setCurrentQuestion(questions[idx + 1].question_number);
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

            {/* Mobile: Single Panel View */}
            <div className="md:hidden h-full flex flex-col relative">
              {mobileView === 'passage' ? (
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
                      showLabels={hasMatchingHeadings}
                      onQuestionFocus={setCurrentQuestion}
                    />
                  )}
                </div>
              ) : (
                <div 
                  className={cn(
                    "flex-1 overflow-y-auto overflow-x-hidden p-4 pb-20 ielts-card question-text",
                    "font-[var(--font-ielts)]"
                  )}
                >
                  <ReadingQuestions 
                    testId={testId!}
                    questions={currentPassageQuestions}
                    answers={answers}
                    onAnswerChange={handleAnswerChange}
                    currentQuestion={currentQuestion}
                    setCurrentQuestion={setCurrentQuestion}
                    fontSize={fontSize}
                    renderRichText={renderRichText}
                    getMaxAnswers={getMaxAnswers}
                    getQuestionGroupOptions={getQuestionGroupOptions}
                    getMatchingSentenceEndingsGroupOptions={getMatchingSentenceEndingsGroupOptions}
                    getTableSelectionOptions={getTableSelectionOptions}
                    headingOptions={headingOptions}
                    headingAnswers={headingAnswers}
                    paragraphLabels={headingParagraphLabels}
                    onHeadingAnswerChange={handleHeadingAnswerChange}
                    selectedHeading={selectedHeading}
                    onSelectedHeadingChange={setSelectedHeading}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Navigation - stays fixed */}
        <ReadingNavigation
          questions={questions}
          passages={passages}
          answers={answers}
          currentQuestion={currentQuestion}
          setCurrentQuestion={setCurrentQuestion}
          currentPassageIndex={currentPassageIndex}
          onPassageChange={setCurrentPassageIndex}
          onSubmit={() => setShowSubmitDialog(true)}
          questionGroups={questionGroups}
          flaggedQuestions={flaggedQuestions}
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
    </HighlightNoteProvider>
  );
}
