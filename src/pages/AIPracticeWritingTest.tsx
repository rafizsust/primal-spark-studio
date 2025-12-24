import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { loadGeneratedTest, savePracticeResult, GeneratedTest, PracticeResult } from '@/types/aiPractice';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AILoadingScreen } from '@/components/common/AILoadingScreen';
import { Clock, Send, PenTool } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AIPracticeWritingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  const wordCount = submissionText.trim().split(/\s+/).filter(Boolean).length;

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
    if (isPaused || !test) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); handleSubmit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPaused, test]);

  const handleSubmit = async () => {
    if (!test?.writingTask || wordCount < 50) {
      toast({ title: 'Please write at least 50 words', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);

    try {
      // Call evaluation function
      const { data, error } = await supabase.functions.invoke('evaluate-ai-practice-writing', {
        body: {
          submissionText,
          taskType: test.writingTask.task_type,
          instruction: test.writingTask.instruction,
          imageDescription: test.writingTask.image_description,
        },
      });

      if (error) throw error;

      const result: PracticeResult = {
        testId: test.id,
        answers: { 1: submissionText },
        score: data?.overall_band || 0,
        totalQuestions: 1,
        bandScore: data?.overall_band || 5,
        completedAt: new Date().toISOString(),
        timeSpent,
        questionResults: [{
          questionNumber: 1,
          userAnswer: submissionText,
          correctAnswer: 'N/A',
          isCorrect: true,
          explanation: JSON.stringify(data?.evaluation_report || {}),
        }],
      };

      savePracticeResult(result);
      navigate(`/ai-practice/results/${test.id}`);
    } catch (err: any) {
      console.error('Evaluation error:', err);
      // Save without AI evaluation
      const result: PracticeResult = {
        testId: test.id,
        answers: { 1: submissionText },
        score: 0,
        totalQuestions: 1,
        bandScore: 0,
        completedAt: new Date().toISOString(),
        timeSpent,
        questionResults: [{ questionNumber: 1, userAnswer: submissionText, correctAnswer: 'N/A', isCorrect: true, explanation: 'Evaluation not available' }],
      };
      savePracticeResult(result);
      navigate(`/ai-practice/results/${test.id}`);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (isSubmitting) {
    return <AILoadingScreen title="Evaluating Your Writing" description="AI is analyzing your response..." progressSteps={['Reading submission', 'Analyzing content', 'Scoring criteria', 'Generating feedback']} currentStepIndex={0} />;
  }

  if (!test?.writingTask) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  const task = test.writingTask;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 bg-background border-b border-border px-4 py-3">
        <div className="container max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PenTool className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-semibold text-sm md:text-base">Writing {task.task_type === 'task1' ? 'Task 1' : 'Task 2'}</h1>
              <p className="text-xs text-muted-foreground">{task.word_limit_min}+ words required</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">Words: {wordCount}</Badge>
            <button onClick={() => setIsPaused(!isPaused)} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-bold", isPaused ? "bg-warning/20 text-warning" : timeLeft < 300 ? "bg-destructive/10 text-destructive" : "bg-muted")}>
              <Clock className="w-4 h-4" />{formatTime(timeLeft)}
            </button>
            <Button onClick={handleSubmit} className="gap-2"><Send className="w-4 h-4" /><span className="hidden sm:inline">Submit</span></Button>
          </div>
        </div>
      </header>

      <div className="flex-1 container max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="text-lg font-bold">{task.task_type === 'task1' ? 'Writing Task 1' : 'Writing Task 2'}</h2>
              <p className="text-sm leading-relaxed">{task.instruction}</p>
              {task.image_base64 && (
                <div className="flex justify-center py-4">
                  <img src={`data:image/png;base64,${task.image_base64}`} alt="Task visual" className="max-w-full rounded-lg border" />
                </div>
              )}
              <p className="text-sm text-muted-foreground">Write at least {task.word_limit_min} words.</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 flex flex-col h-full">
              <Textarea value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} placeholder="Start writing your response here..." className="flex-1 min-h-[400px] resize-none" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}