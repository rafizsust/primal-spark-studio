import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AILoadingScreen } from '@/components/common/AILoadingScreen';
import { useToast } from '@/hooks/use-toast';
import { describeApiError } from '@/lib/apiErrors';
import { useAuth } from '@/hooks/useAuth';
import { useTopicCompletions } from '@/hooks/useTopicCompletions';
import { supabase } from '@/integrations/supabase/client';
import { playCompletionSound, playErrorSound } from '@/lib/sounds';
import { 
  READING_TOPICS, 
  LISTENING_TOPICS, 
  WRITING_TASK1_TOPICS, 
  WRITING_TASK2_TOPICS,
  SPEAKING_TOPICS_PART1,
  SPEAKING_TOPICS_PART2,
  SPEAKING_TOPICS_PART3,
  SPEAKING_TOPICS_FULL,
} from '@/lib/ieltsTopics';
import { 
  BookOpen, 
  Headphones, 
  Sparkles, 
  Clock, 
  Target, 
  Zap,
  Brain,
  Settings2,
  PenTool,
  Mic,
  Volume2
} from 'lucide-react';
import { 
  PracticeModule, 
  DifficultyLevel, 
  ReadingQuestionType, 
  ListeningQuestionType,
  WritingTaskType,
  SpeakingPartType,
  QUESTION_COUNTS,
  getDefaultTime,
  saveGeneratedTestAsync,
  setCurrentTest,
  GeneratedTest
} from '@/types/aiPractice';
import { Link } from 'react-router-dom';

// Question type options - ALL IELTS QUESTION TYPES
const READING_QUESTION_TYPES: { value: ReadingQuestionType; label: string; description: string }[] = [
  { value: 'TRUE_FALSE_NOT_GIVEN', label: 'True/False/Not Given', description: 'Decide if statements match the passage' },
  { value: 'YES_NO_NOT_GIVEN', label: 'Yes/No/Not Given', description: 'Decide if statements agree with the views' },
  { value: 'MATCHING_HEADINGS', label: 'Matching Headings', description: 'Match paragraphs with suitable headings' },
  { value: 'MATCHING_INFORMATION', label: 'Matching Information', description: 'Match statements to paragraphs' },
  { value: 'MATCHING_SENTENCE_ENDINGS', label: 'Matching Sentence Endings', description: 'Complete sentences with correct endings' },
  { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice (Single)', description: 'Choose one correct answer' },
  { value: 'MULTIPLE_CHOICE_MULTIPLE', label: 'Multiple Choice (Multi)', description: 'Choose multiple correct answers' },
  { value: 'FILL_IN_BLANK', label: 'Fill in the Blank', description: 'Complete sentences with words from passage' },
  { value: 'SUMMARY_COMPLETION', label: 'Summary/Word Bank', description: 'Fill in a summary using word bank' },
  { value: 'TABLE_COMPLETION', label: 'Table Completion', description: 'Complete a table with information' },
  { value: 'FLOWCHART_COMPLETION', label: 'Flowchart Completion', description: 'Complete steps in a process flowchart' },
  { value: 'MAP_LABELING', label: 'Map/Diagram Labeling', description: 'Label parts of a map or diagram' },
];

const LISTENING_QUESTION_TYPES: { value: ListeningQuestionType; label: string; description: string }[] = [
  { value: 'FILL_IN_BLANK', label: 'Fill in the Blank', description: 'Complete notes while listening' },
  { value: 'MULTIPLE_CHOICE_SINGLE', label: 'Multiple Choice (Single)', description: 'Choose one correct answer' },
  { value: 'MULTIPLE_CHOICE_MULTIPLE', label: 'Multiple Choice (Multi)', description: 'Choose multiple correct answers' },
  { value: 'MATCHING_CORRECT_LETTER', label: 'Matching', description: 'Match items with options' },
  { value: 'TABLE_COMPLETION', label: 'Table Completion', description: 'Complete a table with information' },
  { value: 'FLOWCHART_COMPLETION', label: 'Flowchart Completion', description: 'Complete process steps' },
  { value: 'DRAG_AND_DROP_OPTIONS', label: 'Drag and Drop', description: 'Drag options to correct positions' },
  { value: 'MAP_LABELING', label: 'Map Labeling', description: 'Label locations on a map' },
];

const WRITING_TASK_TYPES: { value: WritingTaskType; label: string; description: string }[] = [
  { value: 'TASK_1', label: 'Task 1 (Report)', description: 'Describe visual data (chart, graph, diagram)' },
  { value: 'TASK_2', label: 'Task 2 (Essay)', description: 'Write an essay on a given topic' },
];

const SPEAKING_PART_TYPES: { value: SpeakingPartType; label: string; description: string }[] = [
  { value: 'FULL_TEST', label: 'Full Test', description: 'All 3 parts (11-14 minutes)' },
  { value: 'PART_1', label: 'Part 1 Only', description: 'Introduction and interview' },
  { value: 'PART_2', label: 'Part 2 Only', description: 'Individual long turn with cue card' },
  { value: 'PART_3', label: 'Part 3 Only', description: 'Discussion and abstract topics' },
];

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; color: string }[] = [
  { value: 'easy', label: 'Easy', color: 'bg-success/20 text-success border-success/30' },
  { value: 'medium', label: 'Medium', color: 'bg-warning/20 text-warning border-warning/30' },
  { value: 'hard', label: 'Hard', color: 'bg-destructive/20 text-destructive border-destructive/30' },
  { value: 'expert', label: 'Expert', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30' },
];

// Reading passage specifications - paragraph-based
const READING_PASSAGE_PRESETS = {
  short: { paragraphs: 2, label: 'Short (2 paragraphs)' },
  medium: { paragraphs: 4, label: 'Medium (4 paragraphs)' },
  long: { paragraphs: 6, label: 'Long (6 paragraphs)' },
};

// Listening configuration - audio length settings
const LISTENING_AUDIO_CONFIG = {
  minSeconds: 60,   // 1 min
  maxSeconds: 240,  // 4 min max
  defaultSeconds: 180, // 3 min default
};

// Speaker configuration options (Gemini TTS voices)
const SPEAKER_GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const SPEAKER_ACCENTS = [
  { value: 'en-GB', label: 'British' },
  { value: 'en-AU', label: 'Australian' },
  { value: 'en-US', label: 'US' },
  { value: 'en-CA', label: 'Canadian' },
];

// Gemini TTS voice names mapped by gender
const SPEAKER_VOICES = {
  male: [
    { value: 'Charon', label: 'Charon (Informative)' },
    { value: 'Puck', label: 'Puck (Upbeat)' },
    { value: 'Fenrir', label: 'Fenrir (Excitable)' },
    { value: 'Orus', label: 'Orus (Firm)' },
    { value: 'Iapetus', label: 'Iapetus (Clear)' },
  ],
  female: [
    { value: 'Aoede', label: 'Aoede (Breezy)' },
    { value: 'Kore', label: 'Kore (Firm)' },
    { value: 'Leda', label: 'Leda (Youthful)' },
    { value: 'Zephyr', label: 'Zephyr (Bright)' },
    { value: 'Callirrhoe', label: 'Callirrhoe (Easy-going)' },
  ],
};

// Question types that require 2 speakers
const MULTI_SPEAKER_QUESTION_TYPES: ListeningQuestionType[] = [
  'FILL_IN_BLANK',
  'MULTIPLE_CHOICE_SINGLE',
  'MULTIPLE_CHOICE_MULTIPLE',
  'MATCHING_CORRECT_LETTER',
  'DRAG_AND_DROP_OPTIONS',
];

interface SpeakerConfig {
  gender: 'male' | 'female';
  accent: string;
  voiceName: string;
}

export default function AIPractice() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  // Form state
  const [activeModule, setActiveModule] = useState<PracticeModule>('reading');
  const [readingQuestionType, setReadingQuestionType] = useState<ReadingQuestionType>('TRUE_FALSE_NOT_GIVEN');
  const [listeningQuestionType, setListeningQuestionType] = useState<ListeningQuestionType>('FILL_IN_BLANK');
  const [writingTaskType, setWritingTaskType] = useState<WritingTaskType>('TASK_1');
  const [speakingPartType, setSpeakingPartType] = useState<SpeakingPartType>('FULL_TEST');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [topicPreference, setTopicPreference] = useState('');
  const [timeMinutes, setTimeMinutes] = useState(10);
  const [audioSpeed, setAudioSpeed] = useState(1);

  // Topic completion tracking
  const readingCompletions = useTopicCompletions('reading');
  const listeningCompletions = useTopicCompletions('listening');
  const writingCompletions = useTopicCompletions('writing');
  const speakingCompletions = useTopicCompletions('speaking');

  // Get topics based on current module/subtype
  const currentTopics = useMemo(() => {
    switch (activeModule) {
      case 'reading':
        return READING_TOPICS;
      case 'listening':
        return LISTENING_TOPICS;
      case 'writing':
        return writingTaskType === 'TASK_1' ? WRITING_TASK1_TOPICS : WRITING_TASK2_TOPICS;
      case 'speaking':
        switch (speakingPartType) {
          case 'PART_1': return SPEAKING_TOPICS_PART1;
          case 'PART_2': return SPEAKING_TOPICS_PART2;
          case 'PART_3': return SPEAKING_TOPICS_PART3;
          default: return SPEAKING_TOPICS_FULL;
        }
      default:
        return [];
    }
  }, [activeModule, writingTaskType, speakingPartType]);

  // Get the completion hook for current module
  const currentCompletions = useMemo(() => {
    switch (activeModule) {
      case 'reading': return readingCompletions;
      case 'listening': return listeningCompletions;
      case 'writing': return writingCompletions;
      case 'speaking': return speakingCompletions;
      default: return readingCompletions;
    }
  }, [activeModule, readingCompletions, listeningCompletions, writingCompletions, speakingCompletions]);

  // Calculate topic select value
  const topicSelectValue = useMemo(() => {
    if (!topicPreference) return '__random__';
    // Type assertion to fix readonly array issue
    const topicsArray = currentTopics as readonly string[];
    return topicsArray.includes(topicPreference) ? topicPreference : '__custom__';
  }, [topicPreference, currentTopics]);

  // Browser TTS voices for speaking
  const [availableVoices, setAvailableVoices] = useState<{ name: string; lang: string; displayName: string }[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');

  // Load browser TTS voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      const englishVoices = voices
        .filter(v => v.lang.startsWith('en'))
        .map(v => ({
          name: v.name,
          lang: v.lang,
          displayName: `${v.name} (${v.lang})`
        }))
        .slice(0, 20);
      
      setAvailableVoices(englishVoices);
      
      if (englishVoices.length > 0 && !selectedVoice) {
        const britishVoice = englishVoices.find(v => v.lang.includes('GB')) || englishVoices[0];
        setSelectedVoice(britishVoice.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoice]);

  // Reading-specific configuration
  const [readingPassagePreset, setReadingPassagePreset] = useState<keyof typeof READING_PASSAGE_PRESETS>('medium');
  const [customQuestionCount, setCustomQuestionCount] = useState(5);

  // Listening-specific configuration
  const [listeningAudioDuration, setListeningAudioDuration] = useState(LISTENING_AUDIO_CONFIG.defaultSeconds);
  const [listeningQuestionCount, setListeningQuestionCount] = useState(5);
  
  // IELTS Part 1 Spelling Mode configuration for Fill-in-Blank
  const [spellingModeEnabled, setSpellingModeEnabled] = useState(false);
  const [spellingTestScenario, setSpellingTestScenario] = useState<'phone_call' | 'hotel_booking' | 'job_inquiry'>('phone_call');
  const [spellingDifficulty, setSpellingDifficulty] = useState<'low' | 'high'>('low');
  const [numberFormat, setNumberFormat] = useState<'phone_number' | 'date' | 'postcode'>('phone_number');
  
  // Monologue mode for Fill-in-Blank (single speaker like IELTS Part 4)
  const [monologueModeEnabled, setMonologueModeEnabled] = useState(false);
  
  // Speaker configuration
  const [speaker1Config, setSpeaker1Config] = useState<SpeakerConfig>({
    gender: 'female',
    accent: 'en-GB',
    voiceName: 'Kore',
  });
  const [speaker2Config, setSpeaker2Config] = useState<SpeakerConfig>({
    gender: 'male',
    accent: 'en-GB',
    voiceName: 'Puck',
  });

  // Determine if current question type needs 2 speakers
  // For Fill-in-Blank, this is overridden by monologue mode toggle
  const needsTwoSpeakers = listeningQuestionType === 'FILL_IN_BLANK' 
    ? !monologueModeEnabled 
    : MULTI_SPEAKER_QUESTION_TYPES.includes(listeningQuestionType);

  // Loading state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const currentQuestionType = activeModule === 'reading' ? readingQuestionType 
    : activeModule === 'listening' ? listeningQuestionType
    : activeModule === 'writing' ? writingTaskType
    : speakingPartType;
  
  // For reading and listening, use custom question count; for others, use predefined counts
  const questionCount = activeModule === 'reading' 
    ? customQuestionCount 
    : activeModule === 'listening'
    ? listeningQuestionCount
    : (QUESTION_COUNTS[currentQuestionType] || 5);

  const progressSteps = activeModule === 'reading' 
    ? ['Analyzing topic', 'Generating passage', 'Creating questions', 'Preparing explanations', 'Finalizing']
    : activeModule === 'listening'
    ? ['Analyzing topic', 'Generating dialogue', 'Creating audio', 'Generating questions', 'Finalizing']
    : activeModule === 'writing'
    ? ['Analyzing topic', 'Creating prompt', writingTaskType === 'TASK_1' ? 'Generating chart/graph' : 'Preparing task', 'Finalizing']
    : ['Analyzing topic', 'Creating questions', 'Generating audio prompts', 'Preparing cue card', 'Finalizing'];

  const handleGenerate = async () => {
    if (!user) {
      toast({
        title: 'Login Required',
        description: 'Please log in to generate AI practice tests',
        variant: 'destructive',
      });
      navigate('/auth?returnTo=/ai-practice');
      return;
    }

    setIsGenerating(true);
    setGenerationStep(0);

    // Simulate progress steps
    const stepInterval = setInterval(() => {
      setGenerationStep(prev => {
        if (prev < progressSteps.length - 1) return prev + 1;
        return prev;
      });
    }, 3000);

    try {
      // Build reading-specific configuration - simplified to paragraphs only
      const readingConfig = activeModule === 'reading' ? {
        passagePreset: readingPassagePreset,
        paragraphCount: READING_PASSAGE_PRESETS[readingPassagePreset].paragraphs,
      } : undefined;

      // Build listening-specific configuration with speaker settings
      // Calculate word count from duration (150 words per minute)
      const estimatedWordCount = Math.round((listeningAudioDuration / 60) * 150);
      const listeningConfig = activeModule === 'listening' ? {
        durationSeconds: listeningAudioDuration,
        wordCount: estimatedWordCount,
        useWordCountMode: false,
        speakerConfig: {
          speaker1: speaker1Config,
          speaker2: needsTwoSpeakers ? speaker2Config : undefined,
          useTwoSpeakers: needsTwoSpeakers,
        },
        // IELTS Part 1 Spelling Mode settings (only for Fill-in-Blank when not in monologue mode)
        spellingMode: listeningQuestionType === 'FILL_IN_BLANK' && spellingModeEnabled && !monologueModeEnabled ? {
          enabled: true,
          testScenario: spellingTestScenario,
          spellingDifficulty: spellingDifficulty,
          numberFormat: numberFormat,
        } : undefined,
        // Monologue mode for Fill-in-Blank (like IELTS Part 4)
        monologueMode: listeningQuestionType === 'FILL_IN_BLANK' && monologueModeEnabled,
      } : undefined;

      const { data, error } = await supabase.functions.invoke('generate-ai-practice', {
        body: {
          module: activeModule,
          questionType: currentQuestionType,
          difficulty,
          topicPreference: topicPreference.trim() || undefined,
          questionCount,
          timeMinutes,
          readingConfig,
          listeningConfig,
        },
      });

      clearInterval(stepInterval);

      // Check for errors - handle both edge function errors and data.error
      if (error) {
        // Try to extract more specific error message from the response
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Save to localStorage
      const generatedTest: GeneratedTest = {
        id: data.testId || crypto.randomUUID(),
        module: activeModule,
        questionType: currentQuestionType,
        difficulty,
        topic: data.topic || topicPreference || 'Random Topic',
        timeMinutes,
        passage: data.passage,
        audioBase64: data.audioBase64,
        audioFormat: data.audioFormat,
        sampleRate: data.sampleRate,
        transcript: data.transcript,
        questionGroups: data.questionGroups,
        writingTask: data.writingTask,
        speakingParts: data.speakingParts,
        totalQuestions: activeModule === 'writing' ? 1 : 
          activeModule === 'speaking' ? (data.speakingParts?.reduce((acc: number, p: any) => acc + (p.questions?.length || 0), 0) || 0) : 
          questionCount,
        generatedAt: new Date().toISOString(),
      };

      // Save to memory cache and persist to Supabase
      setCurrentTest(generatedTest);
      await saveGeneratedTestAsync(generatedTest, user.id);

      // Play completion sound
      playCompletionSound();

      toast({
        title: 'Test Generated!',
        description: `Your ${activeModule} practice test is ready`,
      });

      // Navigate to the correct practice test based on module
      if (activeModule === 'writing') {
        navigate(`/ai-practice/writing/${generatedTest.id}`);
      } else if (activeModule === 'speaking') {
        navigate(`/ai-practice/speaking/${generatedTest.id}`);
      } else if (activeModule === 'reading') {
        navigate(`/ai-practice/reading/${generatedTest.id}`);
      } else if (activeModule === 'listening') {
        navigate(`/ai-practice/listening/${generatedTest.id}`);
      } else {
        navigate(`/ai-practice/test/${generatedTest.id}`);
      }

    } catch (err: any) {
      console.error('Generation error:', err);
      clearInterval(stepInterval);
      playErrorSound();
      
      const errorDesc = describeApiError(err);
      
      toast({
        title: errorDesc.title,
        description: (
          <div className="flex flex-col gap-2">
            <span>{errorDesc.description}</span>
            {errorDesc.action && (
              <Link to={errorDesc.action.href} className="text-primary-foreground underline text-sm font-medium hover:opacity-80 mt-1">
                {errorDesc.action.label} →
              </Link>
            )}
          </div>
        ),
        variant: 'destructive',
        duration: 8000,
      });
    } finally {
      setIsGenerating(false);
      setGenerationStep(0);
    }
  };

  // Calculate estimated generation time for listening based on audio duration
  const getListeningEstimate = () => {
    const durationSec = listeningAudioDuration;
    
    if (durationSec <= 90) return { text: '60-120 seconds', seconds: 90 };
    if (durationSec <= 120) return { text: '90-150 seconds', seconds: 120 };
    if (durationSec <= 180) return { text: '2-3 minutes', seconds: 150 };
    return { text: '3-4 minutes', seconds: 210 };
  };

  // Calculate estimated generation time for reading based on passage length
  const getReadingEstimate = () => {
    const paragraphCount = READING_PASSAGE_PRESETS[readingPassagePreset].paragraphs;
    
    if (paragraphCount <= 2) return { text: '10-20 seconds', seconds: 15 };
    if (paragraphCount <= 3) return { text: '15-25 seconds', seconds: 20 };
    return { text: '20-35 seconds', seconds: 27 };
  };

  const listeningEstimate = getListeningEstimate();
  const readingEstimate = getReadingEstimate();

  // Get estimate based on active module
  const getModuleEstimate = () => {
    switch (activeModule) {
      case 'listening': return listeningEstimate;
      case 'reading': return readingEstimate;
      case 'writing': return { text: '10-20 seconds', seconds: 15 };
      case 'speaking': return { text: '15-25 seconds', seconds: 20 };
      default: return { text: '15-30 seconds', seconds: 22 };
    }
  };

  const moduleEstimate = getModuleEstimate();

  const handleAbortGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
    setIsGenerating(false);
    setGenerationStep(0);
    setAbortController(null);
    toast({
      title: 'Generation Cancelled',
      description: 'Test generation was cancelled. You can try again when ready.',
    });
  };

  if (isGenerating) {
    return (
      <AILoadingScreen
        title="Generating Your Practice Test"
        description={`Creating a personalized ${activeModule} test with ${questionCount} ${currentQuestionType.replace(/_/g, ' ').toLowerCase()} questions.`}
        progressSteps={progressSteps}
        currentStepIndex={generationStep}
        estimatedTime={moduleEstimate.text}
        estimatedSeconds={moduleEstimate.seconds}
        onAbort={handleAbortGeneration}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 py-8">
        <div className="container max-w-5xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="text-center flex-1">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-4">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm font-medium">AI-Powered Practice</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold mb-3">
                Generate Custom Practice Tests
              </h1>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Create personalized IELTS practice questions tailored to your needs. 
                AI generates unique questions, answers, and explanations instantly.
              </p>
            </div>
          </div>

          {/* History Link */}
          <div className="flex justify-end mb-4">
            <Link to="/ai-practice/history">
              <Button variant="outline" size="sm">
                <Clock className="w-4 h-4 mr-2" />
                View History
              </Button>
            </Link>
          </div>

          {!user && (
            <Card className="mb-6 border-warning/50 bg-warning/5">
              <CardContent className="py-4 flex items-center gap-4">
                <Brain className="w-8 h-8 text-warning shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Login Required</p>
                  <p className="text-sm text-muted-foreground">
                    Please log in and add your Gemini API key in Settings to generate practice tests.
                  </p>
                </div>
                <Link to="/auth?returnTo=/ai-practice">
                  <Button>Get Started</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Module Tabs */}
          <Tabs value={activeModule} onValueChange={(v) => setActiveModule(v as PracticeModule)} className="mb-6">
            <TabsList className="grid w-full grid-cols-4 h-auto p-1">
              <TabsTrigger value="reading" className="flex items-center gap-2 py-3">
                <BookOpen className="w-4 h-4" />
                <span className="hidden sm:inline">Reading</span>
              </TabsTrigger>
              <TabsTrigger value="listening" className="flex items-center gap-2 py-3">
                <Headphones className="w-4 h-4" />
                <span className="hidden sm:inline">Listening</span>
              </TabsTrigger>
              <TabsTrigger value="writing" className="flex items-center gap-2 py-3">
                <PenTool className="w-4 h-4" />
                <span className="hidden sm:inline">Writing</span>
              </TabsTrigger>
              <TabsTrigger value="speaking" className="flex items-center gap-2 py-3">
                <Mic className="w-4 h-4" />
                <span className="hidden sm:inline">Speaking</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="reading" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-primary" />
                    Reading Practice Configuration
                  </CardTitle>
                  <CardDescription>
                    Generate a reading passage with questions tailored to your skill level.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Question Type Selection */}
                  <div className="space-y-3">
                    <Label className="text-base font-medium">Question Type</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {READING_QUESTION_TYPES.map((type) => (
                        <button
                          key={type.value}
                          onClick={() => setReadingQuestionType(type.value)}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            readingQuestionType === type.value
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="font-medium">{type.label}</div>
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Passage Configuration */}
                  <div className="space-y-4 border-t pt-6">
                    <Label className="text-base font-medium flex items-center gap-2">
                      <Settings2 className="w-4 h-4" />
                      Passage Configuration
                    </Label>
                    
                    {/* Preset Selection */}
                    <RadioGroup 
                      value={readingPassagePreset} 
                      onValueChange={(v) => setReadingPassagePreset(v as keyof typeof READING_PASSAGE_PRESETS)}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                    >
                      {Object.entries(READING_PASSAGE_PRESETS).map(([key, preset]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <RadioGroupItem value={key} id={`preset-${key}`} />
                          <Label htmlFor={`preset-${key}`} className="cursor-pointer">
                            {preset.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>

                  </div>

                  {/* Question Count */}
                  <div className="space-y-3 border-t pt-6">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Number of Questions
                      </Label>
                      <Badge variant="secondary">{customQuestionCount} questions</Badge>
                    </div>
                    <Slider
                      value={[customQuestionCount]}
                      onValueChange={([v]) => setCustomQuestionCount(v)}
                      min={1}
                      max={10}
                      step={1}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1 (Quick)</span>
                      <span>5 (Default)</span>
                      <span>10 (Max)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="listening" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Headphones className="w-5 h-5 text-primary" />
                    Listening Practice Configuration
                  </CardTitle>
                  <CardDescription>
                    Generate audio dialogue with questions tailored to your skill level.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Question Type Selection */}
                  <div className="space-y-3">
                    <Label className="text-base font-medium">Question Type</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {LISTENING_QUESTION_TYPES.map((type) => (
                        <button
                          key={type.value}
                          onClick={() => setListeningQuestionType(type.value)}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            listeningQuestionType === type.value
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="font-medium">{type.label}</div>
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Monologue Toggle - Only for Fill-in-Blank */}
                  {listeningQuestionType === 'FILL_IN_BLANK' && (
                    <div className="space-y-4 border-t pt-6">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-medium flex items-center gap-2">
                          <Headphones className="w-4 h-4" />
                          Monologue Mode (IELTS Part 4 Style)
                        </Label>
                        <div 
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${monologueModeEnabled ? 'bg-primary' : 'bg-muted'}`}
                          onClick={() => {
                            setMonologueModeEnabled(!monologueModeEnabled);
                            // Disable spelling mode when monologue is enabled
                            if (!monologueModeEnabled) {
                              setSpellingModeEnabled(false);
                            }
                          }}
                        >
                          <span 
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${monologueModeEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Single speaker monologue (like a lecture or tour guide). Spelling mode is not available in this mode.
                      </p>
                    </div>
                  )}

                  {/* Speaker Configuration */}
                  <div className="space-y-4 border-t pt-6">
                    <Label className="text-base font-medium flex items-center gap-2">
                      <Mic className="w-4 h-4" />
                      Speaker Configuration
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {needsTwoSpeakers 
                        ? 'Configure both speakers for the dialogue.' 
                        : 'Configure the narrator voice for this question type.'}
                    </p>

                    {/* Speaker 1 */}
                    <div className="p-4 rounded-lg border bg-card space-y-4">
                      <div className="font-medium text-sm">Speaker 1</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Gender</Label>
                          <Select
                            value={speaker1Config.gender}
                            onValueChange={(v: 'male' | 'female') => {
                              const defaultVoice = SPEAKER_VOICES[v][0].value;
                              setSpeaker1Config(prev => ({ ...prev, gender: v, voiceName: defaultVoice }));
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SPEAKER_GENDERS.map(g => (
                                <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Accent</Label>
                          <Select
                            value={speaker1Config.accent}
                            onValueChange={(v) => setSpeaker1Config(prev => ({ ...prev, accent: v }))}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SPEAKER_ACCENTS.map(a => (
                                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Voice</Label>
                          <Select
                            value={speaker1Config.voiceName}
                            onValueChange={(v) => setSpeaker1Config(prev => ({ ...prev, voiceName: v }))}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SPEAKER_VOICES[speaker1Config.gender].map(voice => (
                                <SelectItem key={voice.value} value={voice.value}>{voice.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    {/* Speaker 2 - only shown for multi-speaker question types */}
                    {needsTwoSpeakers && (
                      <div className="p-4 rounded-lg border bg-card space-y-4">
                        <div className="font-medium text-sm">Speaker 2</div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Gender</Label>
                            <Select
                              value={speaker2Config.gender}
                              onValueChange={(v: 'male' | 'female') => {
                                const defaultVoice = SPEAKER_VOICES[v][0].value;
                                setSpeaker2Config(prev => ({ ...prev, gender: v, voiceName: defaultVoice }));
                              }}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SPEAKER_GENDERS.map(g => (
                                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Accent</Label>
                            <Select
                              value={speaker2Config.accent}
                              onValueChange={(v) => setSpeaker2Config(prev => ({ ...prev, accent: v }))}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SPEAKER_ACCENTS.map(a => (
                                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Voice</Label>
                            <Select
                              value={speaker2Config.voiceName}
                              onValueChange={(v) => setSpeaker2Config(prev => ({ ...prev, voiceName: v }))}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SPEAKER_VOICES[speaker2Config.gender].map(voice => (
                                  <SelectItem key={voice.value} value={voice.value}>{voice.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Audio Length Configuration - Slider */}
                  <div className="space-y-4 border-t pt-6">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium flex items-center gap-2">
                        <Settings2 className="w-4 h-4" />
                        Audio Length
                      </Label>
                      <span className="text-sm font-medium">{Math.floor(listeningAudioDuration / 60)} min {listeningAudioDuration % 60 > 0 ? `${listeningAudioDuration % 60}s` : ''}</span>
                    </div>
                    <Slider
                      value={[listeningAudioDuration]}
                      onValueChange={([v]) => setListeningAudioDuration(v)}
                      min={LISTENING_AUDIO_CONFIG.minSeconds}
                      max={LISTENING_AUDIO_CONFIG.maxSeconds}
                      step={30}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1 min</span>
                      <span>3 min (Default)</span>
                      <span>4 min</span>
                    </div>

                    {/* Estimated Generation Time */}
                    {(() => {
                      const durationSec = listeningAudioDuration;
                      const estimatedGenTime = durationSec <= 90 ? '60-120 sec' : durationSec <= 120 ? '90-150 sec' : durationSec <= 180 ? '2-3 min' : '3-4 min';
                      return (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                          <Clock className="w-4 h-4 text-primary" />
                          <span className="text-sm">
                            <span className="text-muted-foreground">Estimated generation time:</span>{' '}
                            <span className="font-medium text-primary">{estimatedGenTime}</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* IELTS Part 1 Spelling Mode - Only for Fill-in-Blank when NOT in monologue mode */}
                  {listeningQuestionType === 'FILL_IN_BLANK' && !monologueModeEnabled && (
                    <div className="space-y-4 border-t pt-6">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-medium flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          Spelling Mode (IELTS Part 1 Style)
                        </Label>
                        <div 
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${spellingModeEnabled ? 'bg-primary' : 'bg-muted'}`}
                          onClick={() => setSpellingModeEnabled(!spellingModeEnabled)}
                        >
                          <span 
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${spellingModeEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Include name/number spelling in dialogues (e.g., "S-H-A-R-M-A", "double seven, five, nine")
                      </p>
                      
                      {spellingModeEnabled && (
                        <div className="space-y-4 p-4 rounded-lg border bg-card">
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Test Scenario</Label>
                            <Select value={spellingTestScenario} onValueChange={(v: 'phone_call' | 'hotel_booking' | 'job_inquiry') => setSpellingTestScenario(v)}>
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="phone_call">Phone Call</SelectItem>
                                <SelectItem value="hotel_booking">Hotel Booking</SelectItem>
                                <SelectItem value="job_inquiry">Job Inquiry</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Spelling Difficulty</Label>
                            <Select value={spellingDifficulty} onValueChange={(v: 'low' | 'high') => setSpellingDifficulty(v)}>
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">Low (Common names)</SelectItem>
                                <SelectItem value="high">High (Unusual names)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Number Format</Label>
                            <Select value={numberFormat} onValueChange={(v: 'phone_number' | 'date' | 'postcode') => setNumberFormat(v)}>
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="phone_number">Phone Number</SelectItem>
                                <SelectItem value="date">Date</SelectItem>
                                <SelectItem value="postcode">Postcode</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Question Count */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium">Number of Questions</Label>
                      <span className="text-sm font-medium">{listeningQuestionCount}</span>
                    </div>
                    <Slider
                      value={[listeningQuestionCount]}
                      onValueChange={([v]) => setListeningQuestionCount(v)}
                      min={1}
                      max={10}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1 (Quick)</span>
                      <span>5 (Default)</span>
                      <span>10 (Max)</span>
                    </div>
                  </div>

                  {/* Audio Speed */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium">Audio Speed</Label>
                      <span className="text-sm text-muted-foreground">{audioSpeed}x</span>
                    </div>
                    <Slider
                      value={[audioSpeed]}
                      onValueChange={([v]) => setAudioSpeed(v)}
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.5x</span>
                      <span>1.0x</span>
                      <span>2.0x</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="writing" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PenTool className="w-5 h-5 text-primary" />
                    Writing Practice Configuration
                  </CardTitle>
                  <CardDescription>
                    Generate writing tasks with AI evaluation after submission
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-base font-medium">Task Type</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {WRITING_TASK_TYPES.map((type) => (
                        <button
                          key={type.value}
                          onClick={() => setWritingTaskType(type.value)}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            writingTaskType === type.value
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="font-medium">{type.label}</div>
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                          <Badge variant="secondary" className="mt-2">
                            {type.value === 'TASK_1' ? '150+ words' : '250+ words'}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="speaking" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="w-5 h-5 text-primary" />
                    AI Speaking Practice Configuration
                  </CardTitle>
                  <CardDescription>
                    Live conversation with AI examiner using Gemini Live Audio
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Test Parts */}
                  <div className="space-y-3">
                    <Label className="text-base font-medium">Test Parts</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {SPEAKING_PART_TYPES.map((type) => (
                        <button
                          key={type.value}
                          onClick={() => setSpeakingPartType(type.value)}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            speakingPartType === type.value
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="font-medium">{type.label}</div>
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Browser TTS Voice Selection */}
                  <div className="space-y-4 border-t pt-6">
                    <Label className="text-base font-medium flex items-center gap-2">
                      <Volume2 className="w-4 h-4" />
                      Examiner Voice
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Select the browser voice for the AI examiner
                    </p>
                    
                    {availableVoices.length > 0 ? (
                      <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                        <SelectTrigger className="max-w-md">
                          <SelectValue placeholder="Select a voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableVoices.map((voice) => (
                            <SelectItem key={voice.name} value={voice.name}>
                              {voice.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-muted-foreground">Loading voices...</p>
                    )}

                    {/* Preview button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!selectedVoice) return;
                        window.speechSynthesis.cancel();
                        const utterance = new SpeechSynthesisUtterance(
                          "Hello, I will be your IELTS Speaking examiner today."
                        );
                        const voice = window.speechSynthesis.getVoices().find(v => v.name === selectedVoice);
                        if (voice) utterance.voice = voice;
                        utterance.rate = 0.95;
                        window.speechSynthesis.speak(utterance);
                      }}
                    >
                      <Volume2 className="w-4 h-4 mr-2" />
                      Preview Voice
                    </Button>
                  </div>

                  {/* Difficulty affects question complexity */}
                  <div className="p-4 rounded-lg bg-muted/50 border">
                    <div className="flex items-start gap-3">
                      <Brain className="w-5 h-5 text-primary mt-0.5" />
                      <div>
                        <div className="font-medium text-sm">Difficulty-based Question Complexity</div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {difficulty === 'easy' && 'Simple, familiar topics with straightforward questions'}
                          {difficulty === 'medium' && 'Standard IELTS topics with moderately complex follow-ups'}
                          {difficulty === 'hard' && 'Abstract topics requiring sophisticated vocabulary and analysis'}
                          {difficulty === 'expert' && 'Highly abstract, philosophical questions demanding band 8+ responses'}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Common Settings */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-5 h-5" />
                Practice Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Difficulty */}
              <div className="space-y-3">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Difficulty Level
                </Label>
                <div className="flex gap-3">
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setDifficulty(opt.value)}
                      className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
                        difficulty === opt.value
                          ? opt.color + ' border-current'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic Preference with Dropdown */}
              <div className="space-y-3">
                <Label className="text-base font-medium">
                  Topic Preference
                </Label>
                <div className="flex flex-col gap-3 max-w-md">
                  <Select
                    value={topicSelectValue}
                    onValueChange={(v) => {
                      if (v === '__random__') {
                        setTopicPreference('');
                        return;
                      }
                      if (v === '__custom__') {
                        // Keep current custom text
                        return;
                      }
                      setTopicPreference(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__random__">Random (recommended)</SelectItem>
                      <SelectItem value="__custom__">Custom (type below)</SelectItem>
                      {currentTopics.map((t) => (
                        <SelectItem key={t} value={t}>
                          {currentCompletions.getTopicLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    id="topic"
                    value={topicPreference}
                    onChange={(e) => setTopicPreference(e.target.value.slice(0, 100))}
                    placeholder="Or type your own topic (optional)"
                    maxLength={100}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Select a common IELTS topic or type your own. Leave empty for random.
                </p>
              </div>

              {/* Time Setting - Hidden for Listening (audio length determines time) */}
              {activeModule !== 'listening' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-medium flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Time Limit
                    </Label>
                    <span className="font-medium">{timeMinutes} minutes</span>
                  </div>
                  <Slider
                    value={[timeMinutes]}
                    onValueChange={([v]) => setTimeMinutes(v)}
                    min={2}
                    max={activeModule === 'reading' ? 20 : 10}
                    step={activeModule === 'reading' ? 2 : 1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>2 min</span>
                    <span>
                      {activeModule === 'reading' 
                        ? `Recommended: ${Math.ceil(customQuestionCount * 2)} min`
                        : `Recommended: ${Math.min(10, getDefaultTime(questionCount))} min`
                      }
                    </span>
                    <span>{activeModule === 'reading' ? '20 min' : '10 min'}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Generate Button */}
          <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                  <h3 className="font-bold text-lg mb-1">Ready to Practice?</h3>
                  <p className="text-muted-foreground">
                    {questionCount} {currentQuestionType.replace(/_/g, ' ').toLowerCase()} questions • {activeModule === 'listening' ? `${Math.floor(listeningAudioDuration / 60)} min audio` : `${timeMinutes} minutes`} • {difficulty} difficulty
                  </p>
                </div>
                <Button 
                  size="lg" 
                  className="btn-ai gap-2 min-w-[200px]"
                  onClick={handleGenerate}
                  disabled={!user}
                >
                  <Zap className="w-5 h-5" />
                  Generate Test
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}
