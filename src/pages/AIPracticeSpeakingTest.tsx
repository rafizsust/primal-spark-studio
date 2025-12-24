import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { loadGeneratedTest, savePracticeResult, GeneratedTest, PracticeResult } from '@/types/aiPractice';
import { useToast } from '@/hooks/use-toast';
import { Clock, Mic, MicOff, ArrowRight, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AIPracticeSpeakingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<'listening' | 'preparing' | 'speaking' | 'done'>('listening');
  const [isRecording, setIsRecording] = useState(false);
  const [, setRecordings] = useState<Record<string, Blob>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!testId) { navigate('/ai-practice'); return; }
    const loadedTest = loadGeneratedTest(testId);
    if (!loadedTest || !loadedTest.speakingParts?.length) {
      toast({ title: 'Test Not Found', variant: 'destructive' });
      navigate('/ai-practice');
      return;
    }
    setTest(loadedTest);
    startTimeRef.current = Date.now();
  }, [testId, navigate, toast]);

  const currentPart = test?.speakingParts?.[currentPartIndex];
  const currentQuestion = currentPart?.questions?.[currentQuestionIndex];

  // PCM to WAV conversion
  const pcmToWav = (pcmData: Uint8Array, sampleRate: number): Blob => {
    const bufferSize = 44 + pcmData.length;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    const writeString = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeString(0, 'RIFF'); view.setUint32(4, bufferSize - 8, true); writeString(8, 'WAVE'); writeString(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeString(36, 'data'); view.setUint32(40, pcmData.length, true);
    new Uint8Array(buffer).set(pcmData, 44);
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const playQuestionAudio = useCallback(() => {
    if (!currentQuestion?.audio_base64) {
      setPhase(currentPart?.part_number === 2 ? 'preparing' : 'speaking');
      if (currentPart?.part_number === 2) setTimeLeft(currentPart.preparation_time_seconds || 60);
      return;
    }
    const pcmBytes = Uint8Array.from(atob(currentQuestion.audio_base64), c => c.charCodeAt(0));
    const wavBlob = pcmToWav(pcmBytes, 24000);
    const url = URL.createObjectURL(wavBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentPart?.part_number === 2) {
        setPhase('preparing');
        setTimeLeft(currentPart.preparation_time_seconds || 60);
      } else {
        setPhase('speaking');
        setTimeLeft(currentPart?.time_limit_seconds ? Math.floor(currentPart.time_limit_seconds / (currentPart.questions?.length || 1)) : 60);
      }
    };
    audio.play();
  }, [currentQuestion, currentPart]);

  useEffect(() => {
    if (phase === 'listening' && currentQuestion) playQuestionAudio();
  }, [phase, currentQuestion, playQuestionAudio]);

  useEffect(() => {
    if ((phase !== 'preparing' && phase !== 'speaking') || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (phase === 'preparing') { setPhase('speaking'); return currentPart?.speaking_time_seconds || 120; }
          if (isRecording) stopRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, timeLeft, isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordings(prev => ({ ...prev, [`p${currentPart?.part_number}-q${currentQuestion?.question_number}`]: blob }));
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      toast({ title: 'Microphone access denied', variant: 'destructive' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const nextQuestion = () => {
    if (isRecording) stopRecording();
    const parts = test?.speakingParts || [];
    const questions = currentPart?.questions || [];
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setPhase('listening');
    } else if (currentPartIndex < parts.length - 1) {
      setCurrentPartIndex(prev => prev + 1);
      setCurrentQuestionIndex(0);
      setPhase('listening');
    } else {
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!test) return;
    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const result: PracticeResult = {
      testId: test.id,
      answers: {},
      score: 0,
      totalQuestions: test.speakingParts?.reduce((acc, p) => acc + (p.questions?.length || 0), 0) || 0,
      bandScore: 0,
      completedAt: new Date().toISOString(),
      timeSpent,
      questionResults: [],
    };
    savePracticeResult(result);
    navigate(`/ai-practice/results/${test.id}`);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  if (!test?.speakingParts?.length) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 bg-background border-b px-4 py-3">
        <div className="container max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mic className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-semibold">Speaking Part {currentPart?.part_number}</h1>
              <p className="text-xs text-muted-foreground">Question {currentQuestionIndex + 1} of {currentPart?.questions?.length}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {(phase === 'preparing' || phase === 'speaking') && (
              <Badge className={cn(phase === 'preparing' ? 'bg-warning/20 text-warning' : 'bg-primary/20 text-primary')}>
                <Clock className="w-3 h-3 mr-1" />{formatTime(timeLeft)}
              </Badge>
            )}
            <Button onClick={handleSubmit} variant="outline" size="sm"><Send className="w-4 h-4 mr-1" />End Test</Button>
          </div>
        </div>
      </header>

      <div className="flex-1 container max-w-4xl mx-auto px-4 py-8">
        <Card className="mb-6">
          <CardContent className="p-6 text-center">
            <Badge variant="outline" className="mb-4">Part {currentPart?.part_number}</Badge>
            {currentPart?.part_number === 2 && currentPart.cue_card_topic && (
              <div className="bg-muted p-4 rounded-lg mb-4 text-left">
                <h3 className="font-bold mb-2">{currentPart.cue_card_topic}</h3>
                <p className="text-sm whitespace-pre-line">{currentPart.cue_card_content}</p>
              </div>
            )}
            <p className="text-lg mb-6">{currentQuestion?.question_text}</p>
            
            {phase === 'listening' && <p className="text-muted-foreground animate-pulse">Playing question...</p>}
            {phase === 'preparing' && <p className="text-warning font-medium">Preparation time - think about your answer</p>}
            {phase === 'speaking' && (
              <div className="space-y-4">
                <Button size="lg" onClick={isRecording ? stopRecording : startRecording} className={cn("gap-2", isRecording && "bg-destructive hover:bg-destructive/90")}>
                  {isRecording ? <><MicOff className="w-5 h-5" />Stop Recording</> : <><Mic className="w-5 h-5" />Start Recording</>}
                </Button>
                {isRecording && <p className="text-sm text-muted-foreground animate-pulse">Recording...</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center">
          <Button onClick={nextQuestion} size="lg" className="gap-2">
            Next <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}