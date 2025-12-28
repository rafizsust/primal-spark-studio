import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { loadGeneratedTestAsync, GeneratedTest } from '@/types/aiPractice';
import { useToast } from '@/hooks/use-toast';

import { useGeminiLiveAudio } from '@/hooks/useGeminiLiveAudio';
import { AIExaminerAvatar } from '@/components/speaking/AIExaminerAvatar';
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
  Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PracticeModelAnswer {
  partNumber: number;
  question: string;
  modelAnswer: string;
  keyFeatures: string[];
}

// IELTS Official Timings
const PART_TIMINGS = {
  1: { totalMinutes: 5, questionTime: 45 },
  2: { prepTime: 60, speakTime: 120, roundingQuestions: 30 },
  3: { totalMinutes: 5, questionTime: 60 }
};

type TestPhase = 
  | 'connecting' 
  | 'identity_check'
  | 'part1_intro'
  | 'part1_questions'
  | 'part2_intro'
  | 'part2_prep'
  | 'part2_speaking'
  | 'part2_rounding'
  | 'part3_intro'
  | 'part3_questions'
  | 'submitting'
  | 'done';

interface PartRecording {
  partNumber: number;
  chunks: Blob[];
  startTime: number;
  transcript: string;
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
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [partRecordings, setPartRecordings] = useState<Record<number, PartRecording>>({});
  const [isMuted, setIsMuted] = useState(false);
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const testStartTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Gemini Live Audio Hook
  const gemini = useGeminiLiveAudio({
    partType: 'FULL_TEST',
    difficulty: test?.difficulty || 'medium',
    topic: test?.topic,
    onTranscriptReceived: (text) => {
      if (text) {
        console.log('AI transcript:', text);
      }
    },
    onError: (error) => {
      console.error('Gemini error:', error);
      toast({
        title: 'Connection Error',
        description: error.message,
        variant: 'destructive'
      });
    },
    onConnectionChange: (connected) => {
      if (connected && phase === 'connecting') {
        startIdentityCheck();
      }
    }
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

  // Timer effect
  useEffect(() => {
    if (timeLeft <= 0) return;
    
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });
      setTotalTestTime(prev => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLeft, phase]);

  // Handle time up for different phases
  const handleTimeUp = useCallback(() => {
    switch (phase) {
      case 'part2_prep':
        setPhase('part2_speaking');
        setTimeLeft(PART_TIMINGS[2].speakTime);
        gemini.sendText("The candidate's preparation time is over. Please tell them to start speaking now.");
        break;
      case 'part2_speaking':
        setPhase('part2_rounding');
        setTimeLeft(PART_TIMINGS[2].roundingQuestions);
        gemini.sendText("The candidate has finished their long turn. Please ask 1-2 brief rounding-off questions.");
        break;
      case 'part2_rounding':
        transitionToPart3();
        break;
      default:
        break;
    }
  }, [phase, gemini]);

  // Start identity check
  const startIdentityCheck = useCallback(() => {
    setPhase('identity_check');
    gemini.sendText("Please begin the IELTS Speaking test with the standard identity check. Greet the candidate and ask for their name.");
  }, [gemini]);

  // Start Part 1
  const startPart1 = useCallback(() => {
    setPhase('part1_intro');
    setCurrentPart(1);
    initializePartRecording(1);
    
    gemini.sendText("Identity check complete. Please proceed to Part 1. Ask questions about 2 familiar topics (e.g., home, work, studies, hobbies).");
    
    setTimeout(() => {
      setPhase('part1_questions');
      startRecording();
    }, 2000);
  }, [gemini]);

  // Transition to Part 2
  const transitionToPart2 = useCallback(() => {
    stopRecording();
    uploadPartAudio(1); // Three-envelope: upload Part 1 immediately
    
    setPhase('part2_intro');
    setCurrentPart(2);
    initializePartRecording(2);

    gemini.sendText(`Now introduce Part 2. Tell the candidate: "Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say."`);
    
    setTimeout(() => {
      setPhase('part2_prep');
      setTimeLeft(PART_TIMINGS[2].prepTime);
    }, 4000);
  }, [gemini, test]);

  // Start Part 2 speaking
  const startPart2Speaking = useCallback(() => {
    setPhase('part2_speaking');
    setTimeLeft(PART_TIMINGS[2].speakTime);
    startRecording();
    gemini.sendText("The candidate is ready. Say: 'All right? Remember, you have one to two minutes for this. I'll tell you when the time is up. Can you start speaking now, please?'");
  }, [gemini]);

  // Transition to Part 3
  const transitionToPart3 = useCallback(() => {
    stopRecording();
    uploadPartAudio(2); // Three-envelope: upload Part 2 immediately
    
    setPhase('part3_intro');
    setCurrentPart(3);
    initializePartRecording(3);

    gemini.sendText("Part 2 is complete. Please transition to Part 3. Say: 'We've been talking about [the Part 2 topic], and I'd like to discuss some related questions.' Then ask 4-6 abstract discussion questions.");
    
    setTimeout(() => {
      setPhase('part3_questions');
      startRecording();
    }, 3000);
  }, [gemini]);

  // Initialize recording for a part
  const initializePartRecording = (partNumber: number) => {
    setPartRecordings(prev => ({
      ...prev,
      [partNumber]: {
        partNumber,
        chunks: [],
        startTime: Date.now(),
        transcript: ''
      }
    }));
    audioChunksRef.current = [];
  };

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      
      recorder.start(1000); // Collect data every second
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      // Also start Gemini listening
      await gemini.startListening();
    } catch (err) {
      console.error('Recording error:', err);
      toast({
        title: 'Microphone Error',
        description: 'Could not access microphone',
        variant: 'destructive'
      });
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    gemini.stopListening();
    setIsRecording(false);

    // Save chunks to current part
    setPartRecordings(prev => {
      const current = prev[currentPart];
      if (current) {
        return {
          ...prev,
          [currentPart]: {
            ...current,
            chunks: [...current.chunks, ...audioChunksRef.current]
          }
        };
      }
      return prev;
    });
  };

  // Upload part audio (three-envelope system)
  const uploadPartAudio = async (partNumber: number) => {
    const recording = partRecordings[partNumber];
    if (!recording || recording.chunks.length === 0) return;

    try {
      const audioBlob = new Blob(recording.chunks, { type: 'audio/webm' });
      const reader = new FileReader();
      
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        
        // Store for final submission
        setPartRecordings(prev => ({
          ...prev,
          [partNumber]: {
            ...prev[partNumber],
            audioBase64: base64,
            duration: Math.floor((Date.now() - recording.startTime) / 1000)
          }
        }));

        console.log(`Part ${partNumber} audio prepared for upload (${audioBlob.size} bytes)`);
      };
      
      reader.readAsDataURL(audioBlob);
    } catch (err) {
      console.error(`Failed to prepare Part ${partNumber} audio:`, err);
    }
  };

  // Handle test completion
  const handleCompleteTest = async () => {
    stopRecording();
    uploadPartAudio(3);
    
    setPhase('submitting');
    gemini.sendText("The test is now complete. Thank you for taking this IELTS Speaking test.");
    
    // Wait a moment for final audio to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    gemini.disconnect();

    try {
      // Prepare submission data
      const partAudios = Object.values(partRecordings).map(r => ({
        partNumber: r.partNumber,
        audioBase64: (r as any).audioBase64 || '',
        duration: (r as any).duration || 0
      })).filter(p => p.audioBase64);

      const transcripts = Object.fromEntries(
        Object.entries(partRecordings).map(([k, v]) => [k, v.transcript])
      );

      // Submit for evaluation
      const { error } = await supabase.functions.invoke('evaluate-ai-speaking', {
        body: {
          testId,
          partAudios,
          transcripts,
          topic: test?.topic,
          difficulty: test?.difficulty
        }
      });

      if (error) throw error;

      toast({
        title: 'Test Submitted',
        description: 'Your speaking test is being evaluated'
      });

      navigate(`/ai-practice/speaking/results/${testId}`);
    } catch (err) {
      console.error('Submission error:', err);
      toast({
        title: 'Submission Failed',
        description: 'Please try again',
        variant: 'destructive'
      });
      setPhase('part3_questions');
    }
  };

  // Handle start test
  const handleStartTest = useCallback(async () => {
    setShowStartOverlay(false);
    testStartTimeRef.current = Date.now();
    setPhase('connecting');
    
    try {
      await gemini.connect();
    } catch (err) {
      console.error('Failed to connect:', err);
      toast({
        title: 'Connection Failed',
        description: 'Could not connect to AI examiner',
        variant: 'destructive'
      });
    }
  }, [gemini, toast]);

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get current cue card content
  const getCueCard = () => {
    const part2 = test?.speakingParts?.find(p => p.part_number === 2);
    return {
      topic: part2?.cue_card_topic || 'Describe a memorable experience.',
      content: part2?.cue_card_content || 'You should say:\n- what the experience was\n- when it happened\n- who was involved\n- and explain why it was memorable'
    };
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
              Practice answering {practiceModelAnswers.length} questions from your previous test. 
              You can reveal the model answer after attempting each question.
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
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigate(`/ai-practice/speaking/results/${testId}`)}
            >
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
            <Card className={cn(
              "transition-all duration-300",
              showModelAnswer ? "bg-success/5 border-success/20" : ""
            )}>
              <CardContent className="py-6">
                {showModelAnswer ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-medium">Band 8+ Model Answer</span>
                    </div>
                    
                    <p className="text-foreground leading-relaxed">
                      {currentQuestion.modelAnswer}
                    </p>

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
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setShowModelAnswer(true)}
                  >
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
                  setCurrentPracticeIndex(prev => Math.max(0, prev - 1));
                }}
                disabled={currentPracticeIndex === 0}
              >
                Previous
              </Button>
              
              <div className="flex gap-2">
                {showModelAnswer && (
                  <Button
                    variant="ghost"
                    onClick={() => setShowModelAnswer(false)}
                  >
                    <EyeOff className="w-4 h-4 mr-2" />
                    Hide Answer
                  </Button>
                )}
                
                {currentPracticeIndex < practiceModelAnswers.length - 1 ? (
                  <Button
                    onClick={() => {
                      setShowModelAnswer(false);
                      setCurrentPracticeIndex(prev => prev + 1);
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
                {phase.includes('prep') ? 'Preparation' : 
                 phase.includes('speaking') || phase.includes('questions') ? 'Speaking' : 
                 'Transition'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Timer */}
            {timeLeft > 0 && (
              <Badge 
                className={cn(
                  "font-mono text-sm px-3 py-1",
                  timeLeft <= 30 ? "bg-destructive/20 text-destructive" :
                  timeLeft <= 60 ? "bg-warning/20 text-warning" :
                  "bg-primary/20 text-primary"
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
            <span className="text-xs text-muted-foreground">
              Total: {formatTime(totalTestTime)}
            </span>

            {/* End test button */}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleCompleteTest}
              disabled={phase === 'submitting'}
            >
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
            <AIExaminerAvatar
              isListening={isRecording}
              isSpeaking={gemini.isSpeaking}
              className="w-full h-48 lg:h-64"
            />

            {/* Connection status */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {gemini.isConnected ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-success" />
                        <span className="text-sm text-success">Connected</span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Connecting...</span>
                      </>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMuted(!isMuted)}
                  >
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
                    {[1, 2, 3].map(part => (
                      <div 
                        key={part}
                        className={cn(
                          "text-center py-1 rounded",
                          currentPart === part ? "bg-primary/20 text-primary font-medium" :
                          currentPart > part ? "bg-success/20 text-success" :
                          "bg-muted text-muted-foreground"
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
                      <p className="text-sm whitespace-pre-line text-muted-foreground">
                        {cueCard.content}
                      </p>
                    </div>

                    {phase === 'part2_prep' && (
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground mb-3">
                          Use this time to think about what you want to say
                        </p>
                        <Button onClick={startPart2Speaking}>
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
                      <p className="text-muted-foreground">Connecting to AI Examiner...</p>
                    </div>
                  )}

                  {phase === 'identity_check' && (
                    <div className="text-center py-8">
                      <AlertCircle className="w-8 h-8 mx-auto mb-4 text-primary" />
                      <h3 className="font-semibold mb-2">Identity Check</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        The examiner will ask for your name and verify your identity.
                      </p>
                      <Button onClick={startPart1}>
                        Continue to Part 1
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  )}

                  {(phase === 'part1_intro' || phase === 'part1_questions') && (
                    <div>
                      <h3 className="font-semibold mb-2">Part 1: Introduction & Interview</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Answer questions about familiar topics. Speak naturally for about 4-5 minutes.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant={isRecording ? "destructive" : "default"}
                          onClick={isRecording ? stopRecording : startRecording}
                          className="gap-2"
                        >
                          {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                          {isRecording ? 'Pause' : 'Resume'}
                        </Button>
                        <Button variant="outline" onClick={transitionToPart2}>
                          Next: Part 2
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {(phase === 'part3_intro' || phase === 'part3_questions') && (
                    <div>
                      <h3 className="font-semibold mb-2">Part 3: Discussion</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Discuss abstract ideas related to Part 2. Express and justify opinions.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant={isRecording ? "destructive" : "default"}
                          onClick={isRecording ? stopRecording : startRecording}
                          className="gap-2"
                        >
                          {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                          {isRecording ? 'Pause' : 'Resume'}
                        </Button>
                        <Button onClick={handleCompleteTest}>
                          Complete Test
                          <Send className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {phase === 'submitting' && (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
                      <h3 className="font-semibold mb-2">Submitting Test</h3>
                      <p className="text-sm text-muted-foreground">
                        Your responses are being evaluated...
                      </p>
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
