import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ListeningQuestions,
  ListeningNavigation,
  ListeningTimer,
} from '@/components/listening';
import { TestOptionsMenu, ContrastMode, TextSizeMode } from '@/components/reading/TestOptionsMenu';
import { StickyNote, ArrowLeft, ArrowRight, Sparkles, Volume2, Play, Pause, AlertCircle } from 'lucide-react';
import {
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from '@/lib/utils';
import { HighlightNoteProvider } from '@/hooks/useHighlightNotes';
import { NoteSidebar } from '@/components/common/NoteSidebar';
import { SubmitConfirmDialog } from '@/components/common/SubmitConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';
import { 
  loadGeneratedTest,
  loadGeneratedTestAsync,
  savePracticeResultAsync,
  GeneratedTest,
  PracticeResult,
  QuestionResult 
} from '@/types/aiPractice';

// Helper to render rich text
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

// Convert PCM to WAV
function pcmToWav(pcmData: Uint8Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const wavHeaderSize = 44;
  const wavBuffer = new ArrayBuffer(wavHeaderSize + pcmData.length);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length, true);

  const wavBytes = new Uint8Array(wavBuffer);
  wavBytes.set(pcmData, wavHeaderSize);

  return new Blob([wavBytes], { type: 'audio/wav' });
}

// Interfaces matching ListeningQuestions component
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
  questions: Question[];
}

export default function AIPracticeListeningTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionGroups, setQuestionGroups] = useState<QuestionGroup[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [testStarted] = useState(true);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'questions' | 'audio'>('questions');
  const [flaggedQuestions] = useState<Set<number>>(new Set());
  
  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  
  // Theme settings
  const [contrastMode, setContrastMode] = useState<ContrastMode>('black-on-white');
  const [textSizeMode, setTextSizeMode] = useState<TextSizeMode>('regular');
  
  const startTimeRef = useRef<number>(Date.now());

  // Calculate part ranges based on actual questions
  const partRanges = useMemo(() => {
    if (questions.length === 0) {
      return [{ label: 'Part 1', start: 1, end: 10 }];
    }
    
    const maxQ = Math.max(...questions.map(q => q.question_number));
    
    // For AI practice, we use a single "Part 1" containing all questions
    return [{ label: 'Part 1', start: 1, end: maxQ }];
  }, [questions]);

  // Helper to initialize state from test data
  const initializeTest = useCallback((loadedTest: GeneratedTest) => {
    setTest(loadedTest);
    setTimeLeft(loadedTest.timeMinutes * 60);
    startTimeRef.current = Date.now();

    // Setup audio if available
    if (loadedTest.audioBase64) {
      try {
        const pcmBytes = Uint8Array.from(atob(loadedTest.audioBase64), c => c.charCodeAt(0));
        const wavBlob = pcmToWav(pcmBytes, loadedTest.sampleRate || 24000);
        const url = URL.createObjectURL(wavBlob);
        audioUrlRef.current = url;
        
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.addEventListener('canplaythrough', () => setAudioReady(true));
        audio.addEventListener('timeupdate', () => {
          setAudioProgress((audio.currentTime / audio.duration) * 100 || 0);
        });
        audio.addEventListener('ended', () => setIsPlaying(false));
        audio.addEventListener('error', () => setAudioError('Failed to load audio'));
      } catch {
        setAudioError('Audio generation failed. You can still practice with the transcript.');
      }
    } else {
      setAudioError('Audio not available. You can practice with the transcript below.');
    }

    // Convert AI questions to expected format
    if (loadedTest.questionGroups && loadedTest.questionGroups.length > 0) {
      const convertedQuestions: Question[] = [];
      const convertedGroups: QuestionGroup[] = [];

      loadedTest.questionGroups.forEach((group) => {
        const groupQuestions: Question[] = group.questions.map((q) => ({
          id: q.id,
          question_number: q.question_number,
          question_type: q.question_type,
          question_text: q.question_text,
          correct_answer: q.correct_answer,
          instruction: null,
          group_id: group.id,
          is_given: false,
          heading: q.heading || null,
          options: q.options || null,
          option_format: group.options?.option_format || null,
        }));

        convertedQuestions.push(...groupQuestions);

        convertedGroups.push({
          id: group.id,
          question_type: group.question_type,
          instruction: group.instruction,
          start_question: group.start_question,
          end_question: group.end_question,
          options: group.options,
          option_format: group.options?.option_format,
          questions: groupQuestions,
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
    if (cachedTest && cachedTest.module === 'listening') {
      initializeTest(cachedTest);
      return;
    }

    // Fallback: load from Supabase
    loadGeneratedTestAsync(testId).then((t) => {
      if (!t || t.module !== 'listening') {
        toast.error('Listening test not found');
        navigate('/ai-practice');
        return;
      }
      initializeTest(t);
    });

    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [testId, navigate, initializeTest]);

  const handleAnswerChange = (questionNumber: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionNumber]: answer }));
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const handleSubmit = async () => {
    if (!test) return;

    // Stop audio playback on submission
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);

    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);
    
    const questionResults: QuestionResult[] = questions.map(q => {
      const userAnswer = answers[q.question_number]?.trim() || '';
      const correctAnswer = q.correct_answer;
      
      const normalizedUser = userAnswer.toLowerCase().trim();
      const acceptableAnswers = correctAnswer.split('/').map(a => a.trim().toLowerCase());
      const isCorrect = acceptableAnswers.some(a => a === normalizedUser);
      
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

    if (user) {
      savePracticeResultAsync(result, user.id, 'listening');
    }
    navigate(`/ai-practice/results/${test.id}`);
  };

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

  const submitStats = useMemo(() => {
    const totalCount = questions.length;
    const answeredCount = Object.keys(answers).filter(k => 
      answers[Number(k)]?.trim().length > 0
    ).length;
    return { totalCount, answeredCount };
  }, [answers, questions]);

  const currentPart = partRanges[activePartIndex];

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
        <div className="text-destructive">Listening test not found</div>
      </div>
    );
  }

  return (
    <HighlightNoteProvider testId={testId!}>
      <div className={cn("h-screen flex flex-col overflow-hidden", getThemeClasses(), "ielts-test-content")}>
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header - IELTS Official Style with AI Practice badge */}
          <header className="border-b px-2 md:px-4 py-1 md:py-3 flex items-center justify-between ielts-card ielts-header">
            <div className="flex items-center gap-2 md:gap-4">
              <div className="ielts-logo">
                <span className="text-lg md:text-xl font-black tracking-tight text-[#c8102e]">IELTS</span>
              </div>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="w-3 h-3" />
                AI Practice
              </Badge>
            </div>

            {/* Audio Player in header */}
            <div className="hidden md:flex flex-1 max-w-lg mx-4 items-center gap-3">
              {audioError ? (
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertCircle className="w-4 h-4" />
                  <span className="truncate">{audioError}</span>
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={togglePlayPause}
                    disabled={!audioReady}
                    className="gap-2"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    {isPlaying ? 'Pause' : 'Play'}
                  </Button>
                  <Progress value={audioProgress} className="flex-1" />
                  
                  {/* Playback Speed Control */}
                  <select
                    value={playbackSpeed}
                    onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                    className="text-xs bg-muted border border-border rounded px-2 py-1 cursor-pointer"
                    title="Playback Speed"
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={0.75}>0.75x</option>
                    <option value={1}>1x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                  </select>
                  
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                </>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-3">
              <ListeningTimer 
                timeLeft={timeLeft} 
                setTimeLeft={setTimeLeft} 
                isPaused={!testStarted}
                onTogglePause={() => {}}
              />
              <button 
                className="p-2 rounded transition-colors ielts-icon-btn"
                onClick={() => setIsNoteSidebarOpen(true)}
                title="Notes"
              >
                <StickyNote className="w-5 h-5" />
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

          {/* Mobile Part/Questions Tabs */}
          <div className="md:hidden flex border-b border-border bg-muted/40">
            {partRanges.map((part, idx) => (
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
                {part.label}
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

          {/* Part Header - IELTS Official Style */}
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
                        "scrollbar-thin scrollbar-thumb-[hsl(0_0%_75%)] scrollbar-track-transparent",
                        "font-[var(--font-ielts)] text-foreground"
                      )}
                    >
                      {/* Transcript Section if no audio */}
                      {audioError && test.transcript && (
                        <div className="mb-6 p-4 bg-muted/50 rounded-lg border">
                          <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-600" />
                            Transcript (Audio unavailable)
                          </h3>
                          <div 
                            className="text-sm whitespace-pre-wrap"
                            dangerouslySetInnerHTML={{ __html: renderRichText(test.transcript) }}
                          />
                        </div>
                      )}

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
                    
                    {/* Floating Navigation Arrows */}
                    <div className="absolute bottom-2 right-4 flex items-center gap-2 z-10">
                      <button 
                        className={cn(
                          "ielts-nav-arrow",
                          currentQuestion === questions[0]?.question_number && "opacity-40 cursor-not-allowed"
                        )}
                        onClick={() => {
                          const idx = questions.findIndex(q => q.question_number === currentQuestion);
                          if (idx > 0) {
                            setCurrentQuestion(questions[idx - 1].question_number);
                          }
                        }}
                        disabled={currentQuestion === questions[0]?.question_number}
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

            {/* Mobile: Switch between Questions and Audio */}
            <div className="md:hidden h-full flex flex-col relative">
              {mobileView === 'questions' ? (
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-20 bg-white font-[var(--font-ielts)] text-foreground">
                  {/* Mobile Transcript if no audio */}
                  {audioError && test.transcript && (
                    <div className="mb-4 p-3 bg-muted/50 rounded-lg border">
                      <h3 className="font-semibold mb-2 text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        Transcript
                      </h3>
                      <div 
                        className="text-xs whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: renderRichText(test.transcript) }}
                      />
                    </div>
                  )}

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
                  {audioError ? (
                    <div className="flex flex-col items-center gap-2 text-amber-600">
                      <AlertCircle className="w-8 h-8" />
                      <span className="text-sm text-center">{audioError}</span>
                    </div>
                  ) : (
                    <div className="w-full max-w-md flex flex-col items-center gap-4">
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={togglePlayPause}
                        disabled={!audioReady}
                        className="gap-2"
                      >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        {isPlaying ? 'Pause' : 'Play Audio'}
                      </Button>
                      <Progress value={audioProgress} className="w-full" />
                      
                      {/* Mobile Speed Control */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Speed:</span>
                        <select
                          value={playbackSpeed}
                          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                          className="text-sm bg-muted border border-border rounded px-3 py-1.5 cursor-pointer"
                        >
                          <option value={0.5}>0.5x</option>
                          <option value={0.75}>0.75x</option>
                          <option value={1}>1x</option>
                          <option value={1.25}>1.25x</option>
                          <option value={1.5}>1.5x</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Navigation - stays fixed */}
        <ListeningNavigation
          questions={questions}
          answers={answers}
          currentQuestion={currentQuestion}
          setCurrentQuestion={setCurrentQuestion}
          activePartIndex={activePartIndex}
          onPartSelect={setActivePartIndex}
          partRanges={partRanges}
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
    </HighlightNoteProvider>
  );
}
