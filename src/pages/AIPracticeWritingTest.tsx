import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  loadGeneratedTest, 
  savePracticeResult, 
  GeneratedTest, 
  PracticeResult,
  GeneratedWritingSingleTask,
  isWritingFullTest 
} from '@/types/aiPractice';
import { useToast } from '@/hooks/use-toast';
import { useTopicCompletions } from '@/hooks/useTopicCompletions';
import { supabase } from '@/integrations/supabase/client';
import { describeApiError } from '@/lib/apiErrors';
import { AILoadingScreen } from '@/components/common/AILoadingScreen';
import { TestStartOverlay } from '@/components/common/TestStartOverlay';
import { WritingTestControls } from '@/components/writing/WritingTestControls';
import { Clock, Send, PenTool, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AIPracticeWritingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { incrementCompletion } = useTopicCompletions('writing');
  
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [submissionText1, setSubmissionText1] = useState('');
  const [submissionText2, setSubmissionText2] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testStarted, setTestStarted] = useState(false);
  const [showStartOverlay, setShowStartOverlay] = useState(true);
  const [activeTask, setActiveTask] = useState<'task1' | 'task2'>('task1');
  const [fontSize, setFontSize] = useState(16);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  // Determine if this is a full test
  const writingTask = test?.writingTask;
  const isFullTest = writingTask && isWritingFullTest(writingTask);
  
  // Get the current task(s)
  const task1 = isFullTest ? writingTask.task1 : (!isFullTest && writingTask ? writingTask as GeneratedWritingSingleTask : null);
  const task2 = isFullTest ? writingTask.task2 : null;

  const wordCount1 = submissionText1.trim().split(/\s+/).filter(Boolean).length;
  const wordCount2 = submissionText2.trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => {
    if (!testId) { navigate('/ai-practice'); return; }
    const loadedTest = loadGeneratedTest(testId);
    if (!loadedTest || !loadedTest.writingTask) {
      toast({ title: 'Test Not Found', variant: 'destructive' });
      navigate('/ai-practice');
      return;
    }
    setTest(loadedTest);
    setTimeLeft(loadedTest.timeMinutes * 60);
    startTimeRef.current = Date.now();
  }, [testId, navigate, toast]);

  useEffect(() => {
    if (isPaused || !test || !testStarted) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); handleSubmit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPaused, test, testStarted]);

  const handleSubmit = async () => {
    const totalWords = isFullTest ? wordCount1 + wordCount2 : wordCount1;
    
    if (totalWords < 50) {
      toast({ title: 'Please write at least 50 words', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);

    try {
      // Call evaluation function
      const { data, error } = await supabase.functions.invoke('evaluate-ai-practice-writing', {
        body: {
          submissionText: isFullTest ? undefined : submissionText1,
          submissionText1: isFullTest ? submissionText1 : undefined,
          submissionText2: isFullTest ? submissionText2 : undefined,
          isFullTest,
          taskType: isFullTest ? 'full_test' : task1?.task_type,
          instruction: isFullTest ? undefined : task1?.instruction,
          instruction1: isFullTest ? task1?.instruction : undefined,
          instruction2: isFullTest ? task2?.instruction : undefined,
          imageDescription: isFullTest ? task1?.image_description : task1?.image_description,
          imageBase64: isFullTest ? task1?.image_base64 : task1?.image_base64,
        },
      });

      if (error) throw error;

      const result: PracticeResult = {
        testId: test!.id,
        answers: isFullTest ? { 1: submissionText1, 2: submissionText2 } : { 1: submissionText1 },
        score: data?.overall_band || 0,
        totalQuestions: isFullTest ? 2 : 1,
        bandScore: data?.overall_band || 5,
        completedAt: new Date().toISOString(),
        timeSpent,
        questionResults: [{
          questionNumber: 1,
          userAnswer: isFullTest ? `Task 1: ${submissionText1}\n\nTask 2: ${submissionText2}` : submissionText1,
          correctAnswer: 'N/A',
          isCorrect: true,
          explanation: JSON.stringify(data?.evaluation_report || {}),
        }],
      };

      savePracticeResult(result);
      // Track topic completion
      if (test?.topic) {
        incrementCompletion(test.topic);
      }
      navigate(`/ai-practice/results/${test!.id}`);
    } catch (err: any) {
      console.error('Evaluation error:', err);
      const errDesc = describeApiError(err);
      toast({ title: errDesc.title, description: errDesc.description, variant: 'destructive' });
      
      // Save without AI evaluation
      const result: PracticeResult = {
        testId: test!.id,
        answers: isFullTest ? { 1: submissionText1, 2: submissionText2 } : { 1: submissionText1 },
        score: 0,
        totalQuestions: isFullTest ? 2 : 1,
        bandScore: 0,
        completedAt: new Date().toISOString(),
        timeSpent,
        questionResults: [{ questionNumber: 1, userAnswer: submissionText1, correctAnswer: 'N/A', isCorrect: true, explanation: 'Evaluation not available' }],
      };
      savePracticeResult(result);
      navigate(`/ai-practice/results/${test!.id}`);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle test start from overlay
  const handleStartTest = useCallback(() => {
    setShowStartOverlay(false);
    setTestStarted(true);
    startTimeRef.current = Date.now();
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleTimeChange = (minutes: number) => {
    setTimeLeft(minutes * 60);
  };

  if (isSubmitting) {
    return <AILoadingScreen title="Evaluating Your Writing" description="AI is analyzing your response..." progressSteps={['Reading submission', 'Analyzing content', 'Scoring criteria', 'Generating feedback']} currentStepIndex={0} />;
  }

  if (!test?.writingTask) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  // Show start overlay before test begins
  if (showStartOverlay) {
    const testTitle = isFullTest 
      ? 'AI Practice: Full Writing Test (Task 1 + Task 2)'
      : `AI Practice: ${task1?.task_type === 'task1' ? 'Task 1 (Report)' : 'Task 2 (Essay)'}`;
    
    return (
      <TestStartOverlay
        module="writing"
        testTitle={testTitle}
        timeMinutes={test.timeMinutes}
        totalQuestions={isFullTest ? 2 : 1}
        questionType={isFullTest ? 'FULL TEST' : (task1?.task_type === 'task1' ? 'TASK 1' : 'TASK 2')}
        difficulty={test.difficulty}
        wordLimit={isFullTest ? 400 : (task1?.word_limit_min || 150)}
        onStart={handleStartTest}
        onCancel={() => navigate('/ai-practice')}
      />
    );
  }

  // Render single task UI
  const renderSingleTask = (task: GeneratedWritingSingleTask, submission: string, setSubmission: (s: string) => void, wordCount: number) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-bold">{task.task_type === 'task1' ? 'Writing Task 1' : 'Writing Task 2'}</h2>
          <p className="text-sm leading-relaxed" style={{ fontSize }}>{task.instruction}</p>
          {task.image_base64 && (
            <div className="flex justify-center py-4">
              <img src={task.image_base64.startsWith('data:') ? task.image_base64 : `data:image/png;base64,${task.image_base64}`} alt="Task visual" className="max-w-full rounded-lg border" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">Write at least {task.word_limit_min} words.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 flex flex-col h-full">
          <div className="flex items-center justify-between mb-2">
            <Badge variant="secondary">Words: {wordCount}</Badge>
            {wordCount >= task.word_limit_min && <Badge variant="default" className="bg-success">Minimum met!</Badge>}
          </div>
          <Textarea 
            value={submission} 
            onChange={(e) => setSubmission(e.target.value)} 
            placeholder="Start writing your response here..." 
            className="flex-1 min-h-[400px] resize-none"
            style={{ fontSize }}
          />
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 bg-background border-b border-border px-4 py-3">
        <div className="container max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PenTool className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-semibold text-sm md:text-base">
                {isFullTest ? 'Full Writing Test' : (task1?.task_type === 'task1' ? 'Writing Task 1' : 'Writing Task 2')}
              </h1>
              <p className="text-xs text-muted-foreground">
                {isFullTest ? '400+ words total' : `${task1?.word_limit_min}+ words required`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isFullTest && (
              <Badge variant="outline">
                T1: {wordCount1} | T2: {wordCount2}
              </Badge>
            )}
            <Badge variant="secondary">Words: {isFullTest ? wordCount1 + wordCount2 : wordCount1}</Badge>
            <button 
              onClick={() => setIsPaused(!isPaused)} 
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-bold",
                isPaused ? "bg-warning/20 text-warning" : timeLeft < 300 ? "bg-destructive/10 text-destructive" : "bg-muted"
              )}
            >
              <Clock className="w-4 h-4" />{formatTime(timeLeft)}
            </button>
            <WritingTestControls
              fontSize={fontSize}
              setFontSize={setFontSize}
              isFullscreen={isFullscreen}
              toggleFullscreen={toggleFullscreen}
              isPaused={isPaused}
              togglePause={() => setIsPaused(!isPaused)}
              customTime={Math.ceil(timeLeft / 60)}
              setCustomTime={() => {}}
              onTimeChange={handleTimeChange}
            />
            <Button onClick={handleSubmit} className="gap-2"><Send className="w-4 h-4" /><span className="hidden sm:inline">Submit</span></Button>
          </div>
        </div>
      </header>

      <div className="flex-1 container max-w-6xl mx-auto px-4 py-6">
        {isFullTest && task1 && task2 ? (
          <div className="space-y-4">
            <Tabs value={activeTask} onValueChange={(v) => setActiveTask(v as 'task1' | 'task2')}>
              <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
                <TabsTrigger value="task1" className="flex items-center gap-2">
                  Task 1
                  {wordCount1 >= (task1.word_limit_min || 150) && <Badge variant="secondary" className="bg-success text-success-foreground text-xs">✓</Badge>}
                </TabsTrigger>
                <TabsTrigger value="task2" className="flex items-center gap-2">
                  Task 2
                  {wordCount2 >= (task2.word_limit_min || 250) && <Badge variant="secondary" className="bg-success text-success-foreground text-xs">✓</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="task1" className="mt-4">
                {renderSingleTask(task1, submissionText1, setSubmissionText1, wordCount1)}
              </TabsContent>

              <TabsContent value="task2" className="mt-4">
                {renderSingleTask(task2, submissionText2, setSubmissionText2, wordCount2)}
              </TabsContent>
            </Tabs>

            {/* Quick navigation */}
            <div className="flex justify-center gap-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setActiveTask('task1')}
                disabled={activeTask === 'task1'}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Task 1
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setActiveTask('task2')}
                disabled={activeTask === 'task2'}
              >
                Task 2
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        ) : task1 ? (
          renderSingleTask(task1, submissionText1, setSubmissionText1, wordCount1)
        ) : null}
      </div>
    </div>
  );
}
