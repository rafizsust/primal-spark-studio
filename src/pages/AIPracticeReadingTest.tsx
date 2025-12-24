import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ReadingPassage } from '@/components/reading/ReadingPassage';
import { ReadingQuestions } from '@/components/reading/ReadingQuestions';
import { ReadingTimer } from '@/components/reading/ReadingTimer';
import { ReadingNavigation } from '@/components/reading/ReadingNavigation';
import { TestOptionsMenu, ContrastMode, TextSizeMode } from '@/components/reading/TestOptionsMenu';
import { StickyNote, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from '@/lib/utils';
import { HighlightNoteProvider } from '@/hooks/useHighlightNotes';
import { NoteSidebar } from '@/components/common/NoteSidebar';
import { SubmitConfirmDialog } from '@/components/common/SubmitConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
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
}

export default function AIPracticeReadingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionGroups, setQuestionGroups] = useState<QuestionGroup[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [currentPassageIndex, setCurrentPassageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [testStarted] = useState(true);
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
    if (loadedTest.passage) {
      const passage: Passage = {
        id: loadedTest.passage.id,
        passage_number: 1,
        title: loadedTest.passage.title,
        content: loadedTest.passage.content,
        show_labels: false,
      };
      setPassages([passage]);
    }

    // Convert AI questions to expected format
    if (loadedTest.questionGroups && loadedTest.questionGroups.length > 0) {
      const convertedQuestions: Question[] = [];
      const convertedGroups: QuestionGroup[] = [];

      loadedTest.questionGroups.forEach((group) => {
        convertedGroups.push({
          id: group.id,
          question_type: group.question_type,
          options: group.options,
          start_question: group.start_question,
          end_question: group.end_question,
        });

        group.questions.forEach((q) => {
          convertedQuestions.push({
            id: q.id,
            question_number: q.question_number,
            question_type: q.question_type,
            question_text: q.question_text,
            options: q.options || null,
            correct_answer: q.correct_answer,
            instruction: null,
            passage_id: loadedTest.passage?.id || '',
            question_group_id: group.id,
            heading: q.heading || null,
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

  const handleAnswerChange = (questionNumber: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionNumber]: answer }));
  };

  const handleSubmit = async () => {
    if (!test) return;

    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);
    
    const questionResults: QuestionResult[] = questions.map(q => {
      const userAnswer = answers[q.question_number]?.trim() || '';
      const correctAnswer = q.correct_answer;
      
      const normalizedUser = userAnswer.toLowerCase().trim();
      const acceptableAnswers = correctAnswer.split('/').map(a => a.trim().toLowerCase());
      const isCorrect = acceptableAnswers.some(a => a === normalizedUser);
      
      // Get explanation from original test data
      const originalQ = test.questionGroups?.flatMap(g => g.questions).find(
        oq => oq.question_number === q.question_number
      );
      
      return {
        questionNumber: q.question_number,
        userAnswer,
        correctAnswer,
        isCorrect,
        explanation: originalQ?.explanation || '',
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

    // Save result to Supabase (async)
    if (user) {
      savePracticeResultAsync(result, user.id, 'reading');
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

  // Submit stats
  const submitStats = useMemo(() => {
    const totalCount = questions.length;
    const answeredCount = Object.keys(answers).filter(k => 
      answers[Number(k)]?.trim().length > 0
    ).length;
    return { totalCount, answeredCount };
  }, [answers, questions]);

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
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header - IELTS Official Style with AI Practice badge */}
          <header className="border-b border-border bg-white px-2 md:px-4 py-1 md:py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4">
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
                          hasMatchingHeadings={false}
                          headingOptions={[]}
                          headingAnswers={{}}
                          headingQuestionNumbers={{}}
                          onHeadingDrop={() => {}}
                          onHeadingRemove={() => {}}
                          renderRichText={renderRichText}
                          selectedHeading={null}
                          onSelectPlace={() => {}}
                          showLabels={false}
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
                      hasMatchingHeadings={false}
                      headingOptions={[]}
                      headingAnswers={{}}
                      headingQuestionNumbers={{}}
                      onHeadingDrop={() => {}}
                      onHeadingRemove={() => {}}
                      renderRichText={renderRichText}
                      selectedHeading={null}
                      onSelectPlace={() => {}}
                      showLabels={false}
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
