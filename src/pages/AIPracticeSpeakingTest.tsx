import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { loadGeneratedTestAsync, GeneratedTest } from '@/types/aiPractice';
import { useToast } from '@/hooks/use-toast';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useAudioClipQueue } from '@/hooks/useAudioClipQueue';
import { AIExaminerAvatar } from '@/components/speaking/AIExaminerAvatar';
import { ClipPlayingIndicator } from '@/components/speaking/ClipPlayingIndicator';
import { getExaminerVoice } from '@/components/speaking/ExaminerVoiceSelector';
import { TestStartOverlay } from '@/components/common/TestStartOverlay';
import { supabase } from '@/integrations/supabase/client';
import {
  Clock,
  Mic,
  MicOff,
  ArrowRight,
  Send,
  Volume2,
  VolumeX,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Eye,
  EyeOff,
  RotateCcw,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PracticeModelAnswer {
  partNumber: number;
  question: string;
  modelAnswer: string;
  keyFeatures: string[];
}

// IELTS 2025 Official Timings
const PART_TIMINGS = {
  1: { totalMinutes: 5, questionTime: 30 }, // 30s per question, 4-5 min total
  2: { prepTime: 60, speakTime: 120 }, // 1-min prep, 2-min max speaking
  3: { totalMinutes: 5, questionTime: 45 }, // 45-60s per complex question (we use 45s)
} as const;

// Part 2 speaking minimum threshold for fluency flag (80 seconds = 1:20)
const PART2_MIN_SPEAKING_SECONDS = 80;

type TestPhase =
  | 'connecting'
  | 'identity_check'
  | 'part1_intro'
  | 'part1_question'
  | 'part1_answer'
  | 'part2_intro'
  | 'part2_prep'
  | 'part2_speaking'
  | 'part3_intro'
  | 'part3_question'
  | 'part3_answer'
  | 'submitting'
  | 'done';

interface PartRecording {
  partNumber: number;
  chunks: Blob[];
  startTime: number;
  transcript: string;
  speakingDuration?: number;
  audioBase64?: string;
  duration?: number;
}

type TtsItem = { key: string; text: string };

type TtsClip = { key: string; text: string; audioBase64: string; sampleRate: number };

function ensureTimeLimitText(part: 1 | 2 | 3, base: string) {
  const normalized = (base || '').trim();
  const hasMinutes = /\bminute(s)?\b/i.test(normalized) && /\babout\b/i.test(normalized);

  if (hasMinutes) return normalized;

  if (part === 1) {
    return `In this first part, I'm going to ask you some questions about yourself. This will take about 4 to 5 minutes. ${normalized}`.trim();
  }
  if (part === 2) {
    return `Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. This part will take about 3 to 4 minutes. ${normalized}`.trim();
  }
  return `We've been talking about the Part 2 topic, and I'd like to discuss some related questions. This will take about 4 to 5 minutes. ${normalized}`.trim();
}

export default function AIPracticeSpeakingTest() {
  const { testId } = useParams<{ testId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStartOverlay, setShowStartOverlay] = useState(true);

  // Practice mode state
  const isPracticeMode = searchParams.get('mode') === 'practice';
  const [practiceModelAnswers, setPracticeModelAnswers] = useState<PracticeModelAnswer[]>([]);
  const [showModelAnswer, setShowModelAnswer] = useState(false);
  const [currentPracticeIndex, setCurrentPracticeIndex] = useState(0);

  // Test state
  const [phase, setPhase] = useState<TestPhase>('connecting');
  const [currentPart, setCurrentPart] = useState(1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalTestTime, setTotalTestTime] = useState(0);

  // Examiner audio
  const [isMuted, setIsMuted] = useState(false);
  const [isExaminerReady, setIsExaminerReady] = useState(false);
  const [isPreparingExaminer, setIsPreparingExaminer] = useState(false);
  const [ttsClips, setTtsClips] = useState<Record<string, TtsClip>>({});

  const examinerAudio = useAudioClipQueue({ muted: isMuted });

  // Question indices
  const [part1Index, setPart1Index] = useState(0);
  const [part3Index, setPart3Index] = useState(0);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [partRecordings, setPartRecordings] = useState<Record<number, PartRecording>>({});

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const testStartTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const part2SpeakingStartRef = useRef<number>(0);

  const recognition = useSpeechRecognition({
    language: 'en-GB',
    continuous: true,
    interimResults: true,
    onResult: (text, isFinal) => {
      if (!isFinal) return;
      const clean = (text || '').trim();
      if (!clean) return;

      setPartRecordings((prev) => {
        const current = prev[currentPart];
        if (!current) return prev;
        return {
          ...prev,
          [currentPart]: {
            ...current,
            transcript: (current.transcript + ' ' + clean).trim(),
          },
        };
      });
    },
  });

  // Load test data and practice mode data
  useEffect(() => {
    async function loadTest() {
      if (!testId) {
        navigate('/ai-practice');
        return;
      }

      const loadedTest = await loadGeneratedTestAsync(testId);
      if (!loadedTest) {
        toast({ title: 'Test Not Found', variant: 'destructive' });
        navigate('/ai-practice');
        return;
      }

      setTest(loadedTest);

      // Load practice mode data if available
      if (isPracticeMode) {
        const practiceDataStr = sessionStorage.getItem('speaking_practice_mode');
        if (practiceDataStr) {
          try {
            const practiceData = JSON.parse(practiceDataStr);
            if (practiceData.modelAnswers && Array.isArray(practiceData.modelAnswers)) {
              setPracticeModelAnswers(practiceData.modelAnswers);
            }
          } catch (e) {
            console.error('Failed to parse practice data:', e);
          }
        }
      }

      setLoading(false);
    }

    loadTest();
  }, [testId, navigate, toast, isPracticeMode]);

  const speakingParts = useMemo(() => {
    const parts = test?.speakingParts || [];
    return {
      part1: parts.find((p) => p.part_number === 1) || null,
      part2: parts.find((p) => p.part_number === 2) || null,
      part3: parts.find((p) => p.part_number === 3) || null,
    };
  }, [test]);

  const getCueCard = useCallback(() => {
    const part2 = speakingParts.part2;
    return {
      topic: part2?.cue_card_topic || 'Describe a memorable experience.',
      content:
        part2?.cue_card_content ||
        'You should say:\n- what the experience was\n- when it happened\n- who was involved\n- and explain why it was memorable',
    };
  }, [speakingParts.part2]);

  // Timer effect
  useEffect(() => {
    if (timeLeft <= 0) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
      setTotalTestTime((prev) => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLeft]);

  const stopRecordingInternal = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    recognition.stopListening();
    setIsRecording(false);

    setPartRecordings((prev) => {
      const current = prev[currentPart];
      if (!current) return prev;
      return {
        ...prev,
        [currentPart]: {
          ...current,
          chunks: [...current.chunks, ...audioChunksRef.current],
        },
      };
    });
  }, [currentPart, recognition]);

  const startRecordingInternal = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      recognition.startListening();
    } catch (err) {
      console.error('Recording error:', err);
      toast({
        title: 'Microphone Error',
        description: 'Could not access microphone',
        variant: 'destructive',
      });
    }
  }, [recognition, toast]);

  const uploadPartAudio = useCallback(
    async (partNumber: number) => {
      const recording = partRecordings[partNumber];
      if (!recording || recording.chunks.length === 0) return;

      try {
        const audioBlob = new Blob(recording.chunks, { type: 'audio/webm' });
        const reader = new FileReader();

        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];

          setPartRecordings((prev) => ({
            ...prev,
            [partNumber]: {
              ...prev[partNumber],
              audioBase64: base64,
              duration: Math.floor((Date.now() - recording.startTime) / 1000),
            },
          }));

          console.log(`Part ${partNumber} audio prepared (${audioBlob.size} bytes)`);
        };

        reader.readAsDataURL(audioBlob);
      } catch (err) {
        console.error(`Failed to prepare Part ${partNumber} audio:`, err);
      }
    },
    [partRecordings]
  );

  const getClip = useCallback(
    (key: string) => {
      const clip = ttsClips[key];
      if (!clip) return null;
      return { key: clip.key, text: clip.text, audioBase64: clip.audioBase64, sampleRate: clip.sampleRate };
    },
    [ttsClips]
  );

  const playClipKeys = useCallback(
    async (keys: string[]) => {
      const clips = keys
        .map((k) => getClip(k))
        .filter(Boolean)
        .map((c) => ({
          key: (c as any).key,
          text: (c as any).text,
          audioBase64: (c as any).audioBase64,
          sampleRate: (c as any).sampleRate,
        }));

      await examinerAudio.playClips(clips);
    },
    [examinerAudio, getClip]
  );

  const startPart1Answer = useCallback(async () => {
    setPhase('part1_answer');
    setTimeLeft(PART_TIMINGS[1].questionTime);
    await startRecordingInternal();
  }, [startRecordingInternal]);

  const startPart3Answer = useCallback(async () => {
    setPhase('part3_answer');
    setTimeLeft(PART_TIMINGS[3].questionTime);
    await startRecordingInternal();
  }, [startRecordingInternal]);

  const startPart1Question = useCallback(
    async (idx: number) => {
      setPhase('part1_question');
      const key = `p1:q:${idx}`;
      await playClipKeys([key]);
      await startPart1Answer();
    },
    [playClipKeys, startPart1Answer]
  );

  const startPart3Question = useCallback(
    async (idx: number) => {
      setPhase('part3_question');
      const key = `p3:q:${idx}`;
      await playClipKeys([key]);
      await startPart3Answer();
    },
    [playClipKeys, startPart3Answer]
  );

  const transitionToPart2 = useCallback(async () => {
    stopRecordingInternal();
    await uploadPartAudio(1);

    setCurrentPart(2);
    setPhase('part2_intro');

    setPartRecordings((prev) => ({
      ...prev,
      2: {
        partNumber: 2,
        chunks: [],
        startTime: Date.now(),
        transcript: '',
      },
    }));
    audioChunksRef.current = [];

    await playClipKeys(['p2:intro']);
    setPhase('part2_prep');
    setTimeLeft(PART_TIMINGS[2].prepTime);
  }, [playClipKeys, stopRecordingInternal, uploadPartAudio]);

  const beginPart2Speaking = useCallback(async () => {
    // Cancel prep timer
    setTimeLeft(0);

    setPhase('part2_speaking');
    setTimeLeft(PART_TIMINGS[2].speakTime);
    part2SpeakingStartRef.current = Date.now();

    await playClipKeys(['p2:prep_over']);
    await startRecordingInternal();
  }, [playClipKeys, startRecordingInternal]);

  const transitionToPart3 = useCallback(async () => {
    stopRecordingInternal();
    await uploadPartAudio(2);

    setCurrentPart(3);
    setPhase('part3_intro');

    setPartRecordings((prev) => ({
      ...prev,
      3: {
        partNumber: 3,
        chunks: [],
        startTime: Date.now(),
        transcript: '',
      },
    }));
    audioChunksRef.current = [];

    await playClipKeys(['p3:intro']);

    const firstIdx = 0;
    setPart3Index(firstIdx);
    await startPart3Question(firstIdx);
  }, [playClipKeys, startPart3Question, stopRecordingInternal, uploadPartAudio]);

  // Handle tick reaching 0 for active phases
  useEffect(() => {
    if (timeLeft !== 0) return;

    // We only react to natural countdown completion when we're in a timed phase.
    // (We explicitly set timeLeft(0) in some transitions; those will also hit here, so we gate.)
    if (phase === 'part1_answer') {
      stopRecordingInternal();
      const next = part1Index + 1;

      const maxSeconds = PART_TIMINGS[1].totalMinutes * 60;
      const elapsed = Math.floor((Date.now() - (partRecordings[1]?.startTime || testStartTimeRef.current)) / 1000);

      if (speakingParts.part1?.questions?.length && next < speakingParts.part1.questions.length && elapsed < maxSeconds) {
        setPart1Index(next);
        void startPart1Question(next);
      } else {
        void transitionToPart2();
      }
      return;
    }

    if (phase === 'part2_prep') {
      void beginPart2Speaking();
      return;
    }

    if (phase === 'part2_speaking') {
      stopRecordingInternal();

      const speakingDuration = (Date.now() - part2SpeakingStartRef.current) / 1000;
      setPartRecordings((prev) => ({
        ...prev,
        2: { ...prev[2], speakingDuration },
      }));

      void (async () => {
        await playClipKeys(['p2:stop']);
        await transitionToPart3();
      })();
      return;
    }

    if (phase === 'part3_answer') {
      stopRecordingInternal();
      const next = part3Index + 1;

      const maxSeconds = PART_TIMINGS[3].totalMinutes * 60;
      const elapsed = Math.floor((Date.now() - (partRecordings[3]?.startTime || testStartTimeRef.current)) / 1000);

      if (speakingParts.part3?.questions?.length && next < speakingParts.part3.questions.length && elapsed < maxSeconds) {
        setPart3Index(next);
        void startPart3Question(next);
      } else {
        void handleCompleteTest();
      }
    }
  }, [
    timeLeft,
    phase,
    part1Index,
    part3Index,
    speakingParts.part1?.questions,
    speakingParts.part3?.questions,
    stopRecordingInternal,
    startPart1Question,
    startPart3Question,
    transitionToPart2,
    beginPart2Speaking,
    playClipKeys,
    transitionToPart3,
    partRecordings,
  ]);

  const startIdentityCheck = useCallback(async () => {
    setPhase('identity_check');
    setCurrentPart(1);

    setPartRecordings((prev) => ({
      ...prev,
      1: {
        partNumber: 1,
        chunks: [],
        startTime: Date.now(),
        transcript: '',
      },
    }));
    audioChunksRef.current = [];

    // Identity check clips (examiner speaks; we don't record these)
    await playClipKeys(['id:greet', 'id:call', 'id:id', 'id:thanks']);
  }, [playClipKeys]);

  const startPart1 = useCallback(async () => {
    setPhase('part1_intro');
    setCurrentPart(1);
    setPart1Index(0);

    await playClipKeys(['p1:intro']);
    await startPart1Question(0);
  }, [playClipKeys, startPart1Question]);

  const buildTtsItems = useCallback((): TtsItem[] => {
    const part1 = speakingParts.part1;
    const part2 = speakingParts.part2;
    const part3 = speakingParts.part3;

    const part1Intro = ensureTimeLimitText(1, part1?.instruction || '');
    const part2Intro = ensureTimeLimitText(2, part2?.instruction || '');
    const part3Intro = ensureTimeLimitText(3, part3?.instruction || '');

    const items: TtsItem[] = [
      {
        key: 'id:greet',
        text: 'Good morning. My name is the IELTS examiner. Could you tell me your full name, please?',
      },
      { key: 'id:call', text: 'And what should I call you?' },
      { key: 'id:id', text: 'Can I see your identification, please?' },
      { key: 'id:thanks', text: 'Thank you.' },

      { key: 'p1:intro', text: part1Intro },
      ...(part1?.questions || []).map((q, i) => ({ key: `p1:q:${i}`, text: q.question_text })),

      { key: 'p2:intro', text: part2Intro },
      {
        key: 'p2:prep_over',
        text: 'Your one minute preparation time is over. Please start speaking now. You have two minutes.',
      },
      { key: 'p2:stop', text: 'Thank you. We will now move on to Part 3.' },

      { key: 'p3:intro', text: part3Intro },
      ...(part3?.questions || []).map((q, i) => ({ key: `p3:q:${i}`, text: q.question_text })),
    ];

    // Filter empties
    return items.filter((it) => it.text.trim().length > 0);
  }, [speakingParts.part1, speakingParts.part2, speakingParts.part3]);

  const preloadExaminerAudio = useCallback(async () => {
    const items = buildTtsItems();
    if (items.length === 0) {
      throw new Error('No speaking content found to generate audio');
    }

    const voiceName = getExaminerVoice();

    const { data, error } = await supabase.functions.invoke('generate-gemini-tts', {
      body: {
        items,
        voiceName,
      },
    });

    if (error) throw error;
    if (!data?.success || !Array.isArray(data.clips)) {
      throw new Error(data?.error || 'Failed to generate examiner audio');
    }

    const map: Record<string, TtsClip> = {};
    for (const c of data.clips as TtsClip[]) {
      map[c.key] = c;
    }

    setTtsClips(map);
    setIsExaminerReady(true);
  }, [buildTtsItems]);

  const handleStartTest = useCallback(async () => {
    setShowStartOverlay(false);
    testStartTimeRef.current = Date.now();
    setPhase('connecting');

    try {
      setIsPreparingExaminer(true);
      await preloadExaminerAudio();
      setIsPreparingExaminer(false);
      await startIdentityCheck();
    } catch (err: any) {
      console.error('Failed to prepare examiner audio:', err);
      setIsPreparingExaminer(false);
      toast({
        title: 'Audio Setup Failed',
        description: err?.message || 'Could not generate examiner audio. Check your Gemini API key.',
        variant: 'destructive',
      });
      setShowStartOverlay(true);
      setPhase('connecting');
    }
  }, [preloadExaminerAudio, startIdentityCheck, toast]);

  const stopRecording = useCallback(() => {
    stopRecordingInternal();
  }, [stopRecordingInternal]);

  const handleCompleteTest = useCallback(async () => {
    examinerAudio.stop();
    stopRecordingInternal();
    await uploadPartAudio(3);

    setPhase('submitting');

    await new Promise((resolve) => setTimeout(resolve, 600));

    try {
      const partAudios = Object.values(partRecordings)
        .map((r) => ({
          partNumber: r.partNumber,
          audioBase64: r.audioBase64 || '',
          duration: r.duration || 0,
        }))
        .filter((p) => p.audioBase64);

      const transcripts = Object.fromEntries(Object.entries(partRecordings).map(([k, v]) => [k, v.transcript]));

      const part2Recording = partRecordings[2];
      const part2SpeakingDuration = part2Recording?.speakingDuration || 0;
      const fluencyFlag = part2SpeakingDuration < PART2_MIN_SPEAKING_SECONDS;

      const { error } = await supabase.functions.invoke('evaluate-ai-speaking', {
        body: {
          testId,
          partAudios,
          transcripts,
          topic: test?.topic,
          difficulty: test?.difficulty,
          part2SpeakingDuration,
          fluencyFlag,
        },
      });

      if (error) throw error;

      toast({
        title: 'Test Submitted',
        description: 'Your speaking test is being evaluated',
      });

      navigate(`/ai-practice/speaking/results/${testId}`);
    } catch (err) {
      console.error('Submission error:', err);
      toast({ title: 'Submission Failed', description: 'Please try again', variant: 'destructive' });
      setPhase('part3_question');
    }
  }, [
    examinerAudio,
    navigate,
    partRecordings,
    stopRecordingInternal,
    test?.difficulty,
    test?.topic,
    testId,
    toast,
    uploadPartAudio,
  ]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Practice mode start overlay
  if (showStartOverlay && isPracticeMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardContent className="py-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">Practice Mode</span>
            </div>
            <h2 className="text-2xl font-bold">Practice These Questions</h2>
            <p className="text-muted-foreground">
              Practice answering {practiceModelAnswers.length} questions from your previous test. You can reveal the model
              answer after attempting each question.
            </p>
            <div className="flex flex-col gap-3">
              <Button onClick={() => setShowStartOverlay(false)} size="lg">
                Start Practice
              </Button>
              <Button variant="outline" onClick={() => navigate(`/ai-practice/speaking/results/${testId}`)}>
                Back to Results
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Standard start overlay
  if (showStartOverlay) {
    return (
      <TestStartOverlay
        module="speaking"
        testTitle="AI Speaking Test"
        timeMinutes={14}
        totalQuestions={3}
        questionType="FULL_TEST"
        difficulty={test?.difficulty || 'medium'}
        onStart={handleStartTest}
        onCancel={() => navigate('/ai-practice')}
      />
    );
  }

  // Practice mode UI
  if (isPracticeMode && practiceModelAnswers.length > 0) {
    const currentQuestion = practiceModelAnswers[currentPracticeIndex];

    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Practice mode header */}
        <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b px-4 py-3">
          <div className="container max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/20 text-primary">
                <Sparkles className="w-3 h-3 mr-1" />
                Practice Mode
              </Badge>
              <Badge variant="outline">
                Question {currentPracticeIndex + 1} of {practiceModelAnswers.length}
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/ai-practice/speaking/results/${testId}`)}>
              Exit Practice
            </Button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl space-y-6">
            {/* Question Card */}
            <Card>
              <CardContent className="py-6 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="outline">Part {currentQuestion.partNumber}</Badge>
                </div>

                <h3 className="text-xl font-semibold">{currentQuestion.question}</h3>

                <p className="text-muted-foreground text-sm">
                  Try answering this question out loud, then reveal the model answer to compare.
                </p>
              </CardContent>
            </Card>

            {/* Model Answer Section */}
            <Card className={cn('transition-all duration-300', showModelAnswer ? 'bg-success/5 border-success/20' : '')}>
              <CardContent className="py-6">
                {showModelAnswer ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-medium">Band 8+ Model Answer</span>
                    </div>

                    <p className="text-foreground leading-relaxed">{currentQuestion.modelAnswer}</p>

                    {currentQuestion.keyFeatures && currentQuestion.keyFeatures.length > 0 && (
                      <div className="mt-4 p-4 bg-primary/5 rounded-lg">
                        <div className="flex items-center gap-2 text-primary text-sm font-medium mb-2">
                          <Lightbulb className="w-4 h-4" />
                          Why this works:
                        </div>
                        <ul className="space-y-1">
                          {currentQuestion.keyFeatures.map((feature, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0 mt-1" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setShowModelAnswer(true)}>
                    <Eye className="w-4 h-4 mr-2" />
                    Reveal Model Answer
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex justify-between gap-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowModelAnswer(false);
                  setCurrentPracticeIndex((prev) => Math.max(0, prev - 1));
                }}
                disabled={currentPracticeIndex === 0}
              >
                Previous
              </Button>

              <div className="flex gap-2">
                {showModelAnswer && (
                  <Button variant="ghost" onClick={() => setShowModelAnswer(false)}>
                    <EyeOff className="w-4 h-4 mr-2" />
                    Hide Answer
                  </Button>
                )}

                {currentPracticeIndex < practiceModelAnswers.length - 1 ? (
                  <Button
                    onClick={() => {
                      setShowModelAnswer(false);
                      setCurrentPracticeIndex((prev) => prev + 1);
                    }}
                  >
                    Next Question
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      sessionStorage.removeItem('speaking_practice_mode');
                      navigate(`/ai-practice/speaking/results/${testId}`);
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Back to Results
                  </Button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const cueCard = getCueCard();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="container max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Part {currentPart}
              </Badge>
              <span className="text-sm font-medium text-muted-foreground">
                {phase.includes('prep') ? 'Preparation' : phase.includes('speaking') || phase.includes('part') ? 'Speaking' : 'Transition'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Timer */}
            {timeLeft > 0 && (
              <Badge
                className={cn(
                  'font-mono text-sm px-3 py-1',
                  timeLeft <= 30 ? 'bg-destructive/20 text-destructive' : timeLeft <= 60 ? 'bg-warning/20 text-warning' : 'bg-primary/20 text-primary'
                )}
              >
                <Clock className="w-3 h-3 mr-1.5" />
                {formatTime(timeLeft)}
              </Badge>
            )}

            {/* Recording indicator */}
            {isRecording && (
              <Badge variant="destructive" className="animate-pulse">
                <Mic className="w-3 h-3 mr-1" />
                REC
              </Badge>
            )}

            {/* Total time */}
            <span className="text-xs text-muted-foreground">Total: {formatTime(totalTestTime)}</span>

            {/* End test button */}
            <Button variant="outline" size="sm" onClick={handleCompleteTest} disabled={phase === 'submitting'}>
              <Send className="w-4 h-4 mr-1" />
              End Test
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 container max-w-5xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-2 gap-6 h-full">
          {/* AI Examiner Panel */}
          <div className="space-y-4">
            <AIExaminerAvatar isListening={isRecording} isSpeaking={examinerAudio.isSpeaking} className="w-full h-48 lg:h-64" />

            {/* Current clip indicator */}
            <ClipPlayingIndicator currentClipKey={examinerAudio.currentClipKey} failedClips={examinerAudio.failedClips} />

            {/* Connection status */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isPreparingExaminer ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Generating examiner audio…</span>
                      </>
                    ) : isExaminerReady ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-success" />
                        <span className="text-sm text-success">Examiner audio ready</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-warning" />
                        <span className="text-sm text-muted-foreground">Not ready</span>
                      </>
                    )}
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => setIsMuted(!isMuted)}>
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Phase indicator */}
            <Card>
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Test Progress</span>
                    <span className="font-medium">Part {currentPart} of 3</span>
                  </div>
                  <Progress value={(currentPart / 3) * 100} className="h-2" />

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[1, 2, 3].map((part) => (
                      <div
                        key={part}
                        className={cn(
                          'text-center py-1 rounded',
                          currentPart === part ? 'bg-primary/20 text-primary font-medium' : currentPart > part ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        Part {part}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Content Panel */}
          <div className="space-y-4">
            {/* Part 2 Cue Card */}
            {(phase === 'part2_intro' || phase === 'part2_prep' || phase === 'part2_speaking') && (
              <Card className="border-primary/50 bg-primary/5">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Badge>Cue Card</Badge>
                      {phase === 'part2_prep' && (
                        <Badge variant="outline" className="bg-warning/20 text-warning border-warning/30">
                          <Clock className="w-3 h-3 mr-1" />
                          Prep: {formatTime(timeLeft)}
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-lg font-semibold">{cueCard.topic}</h3>

                    <div className="bg-background/80 rounded-lg p-4">
                      <p className="text-sm whitespace-pre-line text-muted-foreground">{cueCard.content}</p>
                    </div>

                    {phase === 'part2_prep' && (
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-3">Use this time to think about what you want to say</p>
                        <Button onClick={beginPart2Speaking}>
                          I'm Ready to Speak
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Instructions card */}
            <Card>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {phase === 'connecting' && (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                      <p className="text-muted-foreground">Preparing examiner audio…</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        This may take 1-2 minutes due to API rate limits
                      </p>
                    </div>
                  )}

                  {phase === 'identity_check' && (
                    <div className="text-center py-8">
                      <AlertCircle className="w-8 h-8 mx-auto mb-4 text-primary" />
                      <h3 className="font-semibold mb-2">Identity Check</h3>
                      <p className="text-sm text-muted-foreground mb-4">The examiner will ask for your name and verify your identity.</p>
                      <Button onClick={startPart1}>
                        Continue to Part 1
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  )}

                  {(phase === 'part1_intro' || phase === 'part1_question' || phase === 'part1_answer') && (
                    <div>
                      <h3 className="font-semibold mb-2">Part 1: Introduction & Interview</h3>
                      <p className="text-sm text-muted-foreground mb-4">30 seconds per answer. Total about 4–5 minutes.</p>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={transitionToPart2}>
                          Skip to Part 2
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {(phase === 'part3_intro' || phase === 'part3_question' || phase === 'part3_answer') && (
                    <div>
                      <h3 className="font-semibold mb-2">Part 3: Discussion</h3>
                      <p className="text-sm text-muted-foreground mb-4">45 seconds per answer. Total about 4–5 minutes.</p>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={handleCompleteTest}>
                          Complete Test
                          <Send className="w-4 h-4 ml-2" />
                        </Button>
                        {isRecording && (
                          <Button variant="destructive" onClick={stopRecording} className="gap-2">
                            <MicOff className="w-4 h-4" />
                            Stop Recording
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {phase === 'submitting' && (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                      <h3 className="font-semibold mb-2">Submitting Test</h3>
                      <p className="text-sm text-muted-foreground">Your responses are being evaluated...</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Tips card */}
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <h4 className="text-sm font-medium mb-2">Tips for Part {currentPart}</h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {currentPart === 1 && (
                    <>
                      <li>• Give extended answers, not just yes/no</li>
                      <li>• Use a variety of vocabulary</li>
                      <li>• Speak clearly and naturally</li>
                    </>
                  )}
                  {currentPart === 2 && (
                    <>
                      <li>• Cover all the bullet points on the cue card</li>
                      <li>• Speak for the full 2 minutes</li>
                      <li>• Use connectors: firstly, moreover, finally</li>
                    </>
                  )}
                  {currentPart === 3 && (
                    <>
                      <li>• Express and justify your opinions</li>
                      <li>• Consider different perspectives</li>
                      <li>• Use advanced vocabulary and structures</li>
                    </>
                  )}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
