import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { loadGeneratedTestAsync, GeneratedTest } from '@/types/aiPractice';
import { useToast } from '@/hooks/use-toast';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { TestStartOverlay } from '@/components/common/TestStartOverlay';
import { supabase } from '@/integrations/supabase/client';
import {
  Clock,
  Mic,
  Volume2,
  VolumeX,
  Loader2,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// IELTS Official Timings
const TIMING = {
  PART1_QUESTION: 30, // 30 seconds per Part 1 question
  PART2_PREP: 60,     // 1 minute preparation
  PART2_SPEAK: 120,   // 2 minutes speaking
  PART3_QUESTION: 45, // 45 seconds per Part 3 question
} as const;

// Minimum Part 2 speaking for fluency flag
const PART2_MIN_SPEAKING = 80;

type TestPhase =
  | 'loading'
  | 'ready'
  | 'part1_intro'
  | 'part1_question'
  | 'part1_recording'
  | 'part1_transition'
  | 'part2_intro'
  | 'part2_prep'
  | 'part2_recording'
  | 'part2_transition'
  | 'part3_intro'
  | 'part3_question'
  | 'part3_recording'
  | 'ending'
  | 'submitting'
  | 'done';

interface AudioSegmentMeta {
  key: string;
  partNumber: 1 | 2 | 3;
  questionId: string;
  questionNumber: number;
  questionText: string;
  chunks: Blob[];
  duration: number;
}

interface PartRecordingMeta {
  startTime: number;
  duration?: number;
}

export default function AIPracticeSpeakingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Test data
  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStartOverlay, setShowStartOverlay] = useState(true);

  // Test state
  const [phase, setPhase] = useState<TestPhase>('loading');
  const [currentPart, setCurrentPart] = useState<1 | 2 | 3>(1);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);

  // TTS state
  const [isMuted, setIsMuted] = useState(false);
  const [currentSpeakingText, setCurrentSpeakingText] = useState('');

  // Recording state
  const [isRecording, setIsRecording] = useState(false);

  const [recordings, setRecordings] = useState<Record<number, PartRecordingMeta>>({
    1: { startTime: 0 },
    2: { startTime: 0 },
    3: { startTime: 0 },
  });

  // Store audio per question (so we can transcribe + show transcript question-by-question)
  const [audioSegments, setAudioSegments] = useState<Record<string, AudioSegmentMeta>>({});

  // Refs for state access in callbacks (avoid stale closures)
  const phaseRef = useRef<TestPhase>(phase);
  const questionIndexRef = useRef(questionIndex);
  const currentPartRef = useRef(currentPart);
  const isMutedRef = useRef(isMuted);
  const currentSpeakingTextRef = useRef(currentSpeakingText);
  
  // Update refs when state changes
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { questionIndexRef.current = questionIndex; }, [questionIndex]);
  useEffect(() => { currentPartRef.current = currentPart; }, [currentPart]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { currentSpeakingTextRef.current = currentSpeakingText; }, [currentSpeakingText]);

  // Other refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const part2SpeakStartRef = useRef<number>(0);

  const activeAudioKeyRef = useRef<string | null>(null);
  const activeAudioStartRef = useRef<number>(0);
  const pendingStopMetaRef = useRef<{ key: string; meta: Omit<AudioSegmentMeta, 'chunks' | 'duration'>; startMs: number } | null>(null);

  const recordingsRef = useRef(recordings);
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  const audioSegmentsRef = useRef(audioSegments);
  useEffect(() => {
    audioSegmentsRef.current = audioSegments;
  }, [audioSegments]);

  // Get current part data
  const speakingParts = useMemo(() => {
    const parts = test?.speakingParts || [];
    return {
      part1: parts.find((p) => p.part_number === 1) || null,
      part2: parts.find((p) => p.part_number === 2) || null,
      part3: parts.find((p) => p.part_number === 3) || null,
    };
  }, [test]);

  // Keep a ref to speakingParts for callbacks
  const speakingPartsRef = useRef(speakingParts);
  useEffect(() => { speakingPartsRef.current = speakingParts; }, [speakingParts]);

  // Browser TTS - create handler ref first
  const handleTTSCompleteRef = useRef<() => void>(() => {});
  
  const tts = useSpeechSynthesis({
    voiceName: sessionStorage.getItem('speaking_voice_preference') || undefined,
    onEnd: () => {
      setCurrentSpeakingText('');
      handleTTSCompleteRef.current();
    },
  });

  // Forward declarations for functions (to handle circular dependencies)
  const getActiveSegmentMeta = (): Omit<AudioSegmentMeta, 'chunks' | 'duration'> | null => {
    const part = currentPartRef.current;
    const parts = speakingPartsRef.current;
    const qIdx = questionIndexRef.current;

    if (part === 1) {
      const q = parts.part1?.questions?.[qIdx];
      if (!q) return null;
      return {
        key: `part1-q${q.id}`,
        partNumber: 1,
        questionId: q.id,
        questionNumber: q.question_number,
        questionText: q.question_text,
      };
    }

    if (part === 2) {
      const q = parts.part2?.questions?.[0];
      if (!q) return null;
      return {
        key: `part2-q${q.id}`,
        partNumber: 2,
        questionId: q.id,
        questionNumber: q.question_number,
        questionText: q.question_text,
      };
    }

    const q = parts.part3?.questions?.[qIdx];
    if (!q) return null;
    return {
      key: `part3-q${q.id}`,
      partNumber: 3,
      questionId: q.id,
      questionNumber: q.question_number,
      questionText: q.question_text,
    };
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      const meta = getActiveSegmentMeta();
      if (!meta) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('Could not determine which question to record.');
      }

      activeAudioKeyRef.current = meta.key;
      activeAudioStartRef.current = Date.now();

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      // Update part recording start time
      const part = currentPartRef.current;
      setRecordings((prev) => ({
        ...prev,
        [part]: {
          ...prev[part],
          startTime: Date.now(),
        },
      }));
    } catch (err) {
      console.error('Recording error:', err);
      toast({
        title: 'Microphone Error',
        description: 'Could not access microphone',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    const meta = getActiveSegmentMeta();
    const key = activeAudioKeyRef.current ?? meta?.key;
    if (!recorder || !key || !meta) {
      setIsRecording(false);
      return;
    }

    // Save after MediaRecorder flushes the final dataavailable event.
    pendingStopMetaRef.current = {
      key,
      meta,
      startMs: activeAudioStartRef.current,
    };

    recorder.onstop = () => {
      try {
        const pending = pendingStopMetaRef.current;
        if (!pending) return;

        const duration = Math.max(0, (Date.now() - pending.startMs) / 1000);

        setAudioSegments((prev) => ({
          ...prev,
          [pending.key]: {
            ...pending.meta,
            chunks: [...audioChunksRef.current],
            duration,
          },
        }));
      } finally {
        pendingStopMetaRef.current = null;
      }
    };

    if (recorder.state === 'recording') {
      recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
    }

    setIsRecording(false);
  };

  const speakText = (text: string) => {
    if (isMutedRef.current) {
      setCurrentSpeakingText(text);
      // Simulate TTS duration based on text length
      setTimeout(() => {
        setCurrentSpeakingText('');
        handleTTSCompleteRef.current();
      }, Math.max(2000, text.length * 50));
    } else {
      setCurrentSpeakingText(text);
      tts.speak(text);
    }
  };

  const endTest = () => {
    setTimeLeft(0);
    setPhase('ending');
    speakText('Thank you. That is the end of the speaking test.');
  };

  const submitTest = async () => {
    setPhase('submitting');

    try {
      const segments = audioSegmentsRef.current;
      const keys = Object.keys(segments);

      if (!keys.length) {
        toast({
          title: 'No Recording Found',
          description: 'No audio was recorded. Please try again and ensure your microphone is working.',
          variant: 'destructive',
        });
        setPhase('done');
        return;
      }

      // Convert segments to data URLs (send per-question audio)
      const audioData: Record<string, string> = {};
      const durations: Record<string, number> = {};

      for (const key of keys) {
        const seg = segments[key];
        const blob = new Blob(seg.chunks, { type: 'audio/webm' });
        durations[key] = seg.duration;

        // Skip empty blobs
        if (blob.size < 512) continue;

        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });

        audioData[key] = dataUrl;
      }

      // Calculate Part 2 speaking duration for fluency flag
      const part2Duration = Object.entries(segments)
        .filter(([, s]) => s.partNumber === 2)
        .reduce((acc, [, s]) => acc + (s.duration || 0), 0);

      const fluencyFlag = part2Duration > 0 && part2Duration < PART2_MIN_SPEAKING;

      console.log(`[AIPracticeSpeakingTest] Submitting ${Object.keys(audioData).length} audio segments`);
      
      const { data, error } = await supabase.functions.invoke('evaluate-ai-speaking', {
        body: {
          testId,
          audioData,
          durations,
          topic: test?.topic,
          difficulty: test?.difficulty,
          part2SpeakingDuration: part2Duration,
          fluencyFlag,
        },
      });

      if (error) {
        console.error('[AIPracticeSpeakingTest] Supabase invoke error:', error);
        throw new Error(error.message || 'Network error during submission');
      }
      
      if (data?.error) {
        console.error('[AIPracticeSpeakingTest] Edge function error:', data.error, data.code);
        throw new Error(data.error);
      }

      console.log('[AIPracticeSpeakingTest] Submission successful, model used:', data?.usedModel);
      setPhase('done');
      navigate(`/ai-practice/speaking/results/${testId}`);
    } catch (err: any) {
      console.error('[AIPracticeSpeakingTest] Submission error:', err);
      
      const errorMessage = err?.message || 'Could not submit test for evaluation.';
      const isTimeout = errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('abort');
      
      toast({
        title: 'Submission Failed',
        description: isTimeout 
          ? 'The evaluation is taking too long. Please try again with a shorter recording.'
          : errorMessage,
        variant: 'destructive',
      });
      setPhase('done');
    }
  };


  const startPart3 = () => {
    setCurrentPart(3);
    setQuestionIndex(0);
    const part3 = speakingPartsRef.current.part3;
    
    if (part3) {
      setPhase('part3_intro');
      speakText(part3.instruction);
    } else {
      endTest();
    }
  };

  const transitionToPart3 = () => {
    setPhase('part2_transition');

    if (speakingPartsRef.current.part3) {
      speakText("Thank you. That is the end of Part 2. Now we will move on to Part 3.");
    } else {
      endTest();
    }
  };

  const transitionAfterPart1 = () => {
    const parts = speakingPartsRef.current;

    if (parts.part2) {
      setPhase('part1_transition');
      speakText("Thank you. That is the end of Part 1. Now we will move on to Part 2.");
      return;
    }

    if (parts.part3) {
      setPhase('part1_transition');
      speakText("Thank you. That is the end of Part 1. Now we will move on to Part 3.");
      return;
    }

    endTest();
  };

  const startPart2 = () => {
    setCurrentPart(2);
    setQuestionIndex(0);
    const part2 = speakingPartsRef.current.part2;
    
    if (part2) {
      setPhase('part2_intro');
      speakText(part2.instruction);
    } else if (speakingPartsRef.current.part3) {
      startPart3();
    } else {
      endTest();
    }
  };

  const startPart2Speaking = () => {
    // User clicked to start speaking early.
    // IMPORTANT: timer should start after the examiner finishes speaking.
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setTimeLeft(0);

    // Keep phase as part2_prep so onEnd starts recording + timer after TTS finishes
    speakText("Please start speaking now. You have two minutes.");
  };

  // Handle stopping recording early and moving to next question/part
  const handleStopAndNext = () => {
    const currentPhase = phaseRef.current;
    const parts = speakingPartsRef.current;
    const qIdx = questionIndexRef.current;

    // Clear any running timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setTimeLeft(0);

    if (currentPhase === 'part1_recording') {
      stopRecording();
      const part1 = parts.part1;
      const nextIdx = qIdx + 1;
      
      if (part1?.questions && nextIdx < part1.questions.length) {
        setQuestionIndex(nextIdx);
        setPhase('part1_question');
        speakText(part1.questions[nextIdx].question_text);
      } else {
        transitionAfterPart1();
      }
    } else if (currentPhase === 'part2_recording') {
      stopRecording();
      const duration = (Date.now() - part2SpeakStartRef.current) / 1000;
      setRecordings((prev) => ({
        ...prev,
        2: { ...prev[2], duration },
      }));
      transitionToPart3();
    } else if (currentPhase === 'part3_recording') {
      stopRecording();
      const part3 = parts.part3;
      const nextIdx = qIdx + 1;
      
      if (part3?.questions && nextIdx < part3.questions.length) {
        setQuestionIndex(nextIdx);
        setPhase('part3_question');
        speakText(part3.questions[nextIdx].question_text);
      } else {
        endTest();
      }
    }
  };

  // Handle TTS completion - update ref with latest function
  handleTTSCompleteRef.current = () => {
    const currentPhase = phaseRef.current;
    const parts = speakingPartsRef.current;

    if (currentPhase === 'part1_intro') {
      // Start first Part 1 question
      const part1 = parts.part1;
      if (part1?.questions?.[0]) {
        setPhase('part1_question');
        speakText(part1.questions[0].question_text);
      }
    } else if (currentPhase === 'part1_question') {
      // Start recording for Part 1
      setPhase('part1_recording');
      setTimeLeft(TIMING.PART1_QUESTION);
      startRecording();
    } else if (currentPhase === 'part1_transition') {
      // Start the next part after Part 1 (based on which parts exist)
      if (parts.part2) {
        startPart2();
      } else if (parts.part3) {
        startPart3();
      } else {
        endTest();
      }
    } else if (currentPhase === 'part2_intro') {
      // Show cue card and start prep timer
      setPhase('part2_prep');
      setTimeLeft(TIMING.PART2_PREP);
    } else if (currentPhase === 'part2_prep') {
      // Start Part 2 recording after TTS completes (either prep-over or early start message)
      setPhase('part2_recording');
      part2SpeakStartRef.current = Date.now();
      startRecording();
      // Set timeLeft AFTER starting recording to ensure timer effect triggers
      setTimeout(() => setTimeLeft(TIMING.PART2_SPEAK), 0);
    } else if (currentPhase === 'part2_transition') {
      // Start Part 3 if it exists, otherwise end.
      if (parts.part3) {
        startPart3();
      } else {
        endTest();
      }
    } else if (currentPhase === 'part3_intro') {
      // Start first Part 3 question
      const part3 = parts.part3;
      if (part3?.questions?.[0]) {
        setPhase('part3_question');
        speakText(part3.questions[0].question_text);
      }
    } else if (currentPhase === 'part3_question') {
      // Start recording for Part 3
      setPhase('part3_recording');
      setTimeLeft(TIMING.PART3_QUESTION);
      startRecording();
    } else if (currentPhase === 'ending') {
      submitTest();
    }
  };

  // Handle timer completion
  const handleTimerComplete = () => {
    const currentPhase = phaseRef.current;
    const parts = speakingPartsRef.current;
    const qIdx = questionIndexRef.current;

    if (currentPhase === 'part1_recording') {
      stopRecording();
      const part1 = parts.part1;
      const nextIdx = qIdx + 1;
      
      if (part1?.questions && nextIdx < part1.questions.length) {
        setQuestionIndex(nextIdx);
        setPhase('part1_question');
        speakText(part1.questions[nextIdx].question_text);
      } else {
        transitionAfterPart1();
      }
    } else if (currentPhase === 'part2_prep') {
      // Start Part 2 recording
      speakText("Your one minute preparation time is over. Please start speaking now. You have two minutes.");
    } else if (currentPhase === 'part2_recording') {
      stopRecording();
      const duration = (Date.now() - part2SpeakStartRef.current) / 1000;
      setRecordings((prev) => ({
        ...prev,
        2: { ...prev[2], duration },
      }));
      transitionToPart3();
    } else if (currentPhase === 'part3_recording') {
      stopRecording();
      const part3 = parts.part3;
      const nextIdx = qIdx + 1;
      
      if (part3?.questions && nextIdx < part3.questions.length) {
        setQuestionIndex(nextIdx);
        setPhase('part3_question');
        speakText(part3.questions[nextIdx].question_text);
      } else {
        endTest();
      }
    }
  };

  // Load test data
  useEffect(() => {
    async function loadTest() {
      if (!testId) {
        navigate('/ai-practice/speaking');
        return;
      }

      const loadedTest = await loadGeneratedTestAsync(testId);
      if (!loadedTest) {
        toast({ title: 'Test Not Found', variant: 'destructive' });
        navigate('/ai-practice/speaking');
        return;
      }

      setTest(loadedTest);
      setLoading(false);
      setPhase('ready');
    }

    loadTest();
  }, [testId, navigate, toast]);

  // Timer effect - use timeLeft as dependency to restart when set to new value
  useEffect(() => {
    // Clear any existing timer first
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (timeLeft <= 0) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Use setTimeout to call handleTimerComplete outside the setState
          setTimeout(() => handleTimerComplete(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [timeLeft]); // Trigger on any timeLeft change

  // Start test function
  const startTest = () => {
    setShowStartOverlay(false);
    
    // Determine which part to start with
    if (speakingParts.part1) {
      setCurrentPart(1);
      setPhase('part1_intro');
      speakText(speakingParts.part1.instruction);
    } else if (speakingParts.part2) {
      startPart2();
    } else if (speakingParts.part3) {
      startPart3();
    }
  };

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get current question
  const getCurrentQuestion = () => {
    if (currentPart === 1 && speakingParts.part1?.questions) {
      return speakingParts.part1.questions[questionIndex];
    }
    if (currentPart === 3 && speakingParts.part3?.questions) {
      return speakingParts.part3.questions[questionIndex];
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showStartOverlay && test) {
    return (
      <TestStartOverlay
        module="speaking"
        testTitle={test.topic}
        timeMinutes={test.timeMinutes}
        totalQuestions={test.totalQuestions}
        questionType={test.questionType}
        difficulty={test.difficulty}
        onStart={startTest}
        onCancel={() => navigate('/ai-practice/speaking')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono">
              Part {currentPart}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {test?.topic}
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Timer */}
            {timeLeft > 0 && (
              <div className={cn(
                "flex items-center gap-2 px-3 py-1 rounded-full font-mono text-lg",
                timeLeft <= 10 ? "bg-destructive/20 text-destructive animate-pulse" : "bg-muted"
              )}>
                <Clock className="w-4 h-4" />
                {formatTime(timeLeft)}
              </div>
            )}
            
            {/* Mute button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setIsMuted(!isMuted);
                if (!isMuted) tts.cancel();
              }}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        {/* Current speaking text display */}
        {currentSpeakingText && (
          <Card className="mb-6 border-primary/50 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Volume2 className="w-5 h-5 text-primary mt-1 animate-pulse" />
                <p className="text-lg">{currentSpeakingText}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Part 2 Cue Card */}
        {currentPart === 2 && (phase === 'part2_prep' || phase === 'part2_recording') && speakingParts.part2 && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <h3 className="font-bold text-xl mb-4">{speakingParts.part2.cue_card_topic}</h3>
              <div className="whitespace-pre-line text-muted-foreground">
                {speakingParts.part2.cue_card_content}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Current Question Display */}
        {(phase.includes('question') || phase.includes('recording')) && getCurrentQuestion() && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Badge>Question {getCurrentQuestion()?.question_number}</Badge>
              </div>
              <p className="text-lg">{getCurrentQuestion()?.question_text}</p>
            </CardContent>
          </Card>
        )}

        {/* Recording indicator with Stop & Next button */}
        {isRecording && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
                <Mic className="w-10 h-10 text-destructive animate-pulse" />
              </div>
              <div className="absolute inset-0 rounded-full border-4 border-destructive animate-ping opacity-30" />
            </div>
            <p className="text-muted-foreground">Recording your response...</p>
            <p className="text-sm text-muted-foreground">Time remaining: {formatTime(timeLeft)}</p>
            
            {/* Stop & Next button */}
            <Button 
              onClick={handleStopAndNext} 
              variant="outline" 
              size="lg"
              className="mt-4"
            >
              Stop & Move to Next
            </Button>
          </div>
        )}

        {/* Part 2 - Start Speaking Early Button */}
        {phase === 'part2_prep' && (
          <div className="flex justify-center py-4">
            <Button onClick={startPart2Speaking} size="lg">
              <Play className="w-5 h-5 mr-2" />
              Start Speaking Now
            </Button>
          </div>
        )}

        {/* Submitting state */}
        {phase === 'submitting' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg">Submitting your test for evaluation...</p>
            <p className="text-sm text-muted-foreground">This may take a moment</p>
          </div>
        )}

        {/* Progress indicator */}
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4">
          <div className="container mx-auto max-w-3xl">
            {(() => {
              const available = [
                speakingParts.part1 ? 1 : null,
                speakingParts.part2 ? 2 : null,
                speakingParts.part3 ? 3 : null,
              ].filter(Boolean) as Array<1 | 2 | 3>;

              const total = Math.max(1, available.length);
              const idx = Math.max(0, available.indexOf(currentPart));
              const pct = ((idx + 1) / total) * 100;

              return (
                <>
                  <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                    <span>Test Progress</span>
                    <span>Part {idx + 1} of {total}</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </>
              );
            })()}
          </div>
        </div>
      </main>
    </div>
  );
}
