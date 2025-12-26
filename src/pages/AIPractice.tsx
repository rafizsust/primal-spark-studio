import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AILoadingScreen } from '@/components/common/AILoadingScreen';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { playCompletionSound, playErrorSound } from '@/lib/sounds';
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
  Mic
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
  { value: 'SENTENCE_COMPLETION', label: 'Sentence Completion', description: 'Complete sentences with given words' },
  { value: 'SUMMARY_COMPLETION', label: 'Summary/Word Bank', description: 'Fill in a summary using word bank' },
  { value: 'TABLE_COMPLETION', label: 'Table Completion', description: 'Complete a table with information' },
  { value: 'FLOWCHART_COMPLETION', label: 'Flowchart Completion', description: 'Complete steps in a process flowchart' },
  { value: 'NOTE_COMPLETION', label: 'Note Completion', description: 'Complete notes with missing information' },
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
];

// Official IELTS Reading passage specifications
// Academic: 700-950 words per passage, typically 5-8 paragraphs
const READING_PASSAGE_PRESETS = {
  short: { paragraphs: 4, wordCount: 500, label: 'Short (500 words, 4 paragraphs)' },
  medium: { paragraphs: 6, wordCount: 750, label: 'Medium (750 words, 6 paragraphs)' },
  standard: { paragraphs: 7, wordCount: 900, label: 'IELTS Standard (900 words, 7 paragraphs)' },
  custom: { paragraphs: 0, wordCount: 0, label: 'Custom' },
};

// Listening configuration - Gemini TTS limits:
// - ~150 words per minute of speech at normal pace
// - Max ~10 minutes per request, using 85% capacity = 8 min max
// - Max ~1,200 words of transcript per request
const LISTENING_TRANSCRIPT_PRESETS = {
  short: { durationSeconds: 120, wordCount: 300, label: 'Short (2 min, ~300 words)' },
  standard: { durationSeconds: 300, wordCount: 750, label: 'Standard (5 min, ~750 words)' },
  full: { durationSeconds: 480, wordCount: 1200, label: 'Full (8 min, ~1,200 words)' },
  custom: { durationSeconds: 0, wordCount: 0, label: 'Custom' },
};

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

  // Reading-specific configuration
  const [readingPassagePreset, setReadingPassagePreset] = useState<keyof typeof READING_PASSAGE_PRESETS>('standard');
  const [customParagraphCount, setCustomParagraphCount] = useState(6);
  const [customWordCount, setCustomWordCount] = useState(750);
  const [useWordCountMode, setUseWordCountMode] = useState(false); // false = paragraph mode, true = word count mode
  const [customQuestionCount, setCustomQuestionCount] = useState(5);

  // Listening-specific configuration
  const [listeningTranscriptPreset, setListeningTranscriptPreset] = useState<keyof typeof LISTENING_TRANSCRIPT_PRESETS>('standard');
  const [customTranscriptDuration, setCustomTranscriptDuration] = useState(90);
  const [customTranscriptWordCount, setCustomTranscriptWordCount] = useState(225);
  const [listeningUseWordCountMode, setListeningUseWordCountMode] = useState(false);
  const [listeningQuestionCount, setListeningQuestionCount] = useState(5);

  // Loading state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);

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
      // Build reading-specific configuration
      const readingConfig = activeModule === 'reading' ? {
        passagePreset: readingPassagePreset,
        paragraphCount: readingPassagePreset === 'custom' 
          ? (useWordCountMode ? undefined : customParagraphCount)
          : READING_PASSAGE_PRESETS[readingPassagePreset].paragraphs,
        wordCount: readingPassagePreset === 'custom'
          ? (useWordCountMode ? customWordCount : undefined)
          : READING_PASSAGE_PRESETS[readingPassagePreset].wordCount,
        useWordCountMode: readingPassagePreset === 'custom' ? useWordCountMode : false,
      } : undefined;

      // Build listening-specific configuration
      const listeningConfig = activeModule === 'listening' ? {
        transcriptPreset: listeningTranscriptPreset,
        durationSeconds: listeningTranscriptPreset === 'custom'
          ? (listeningUseWordCountMode ? undefined : customTranscriptDuration)
          : LISTENING_TRANSCRIPT_PRESETS[listeningTranscriptPreset].durationSeconds,
        wordCount: listeningTranscriptPreset === 'custom'
          ? (listeningUseWordCountMode ? customTranscriptWordCount : undefined)
          : LISTENING_TRANSCRIPT_PRESETS[listeningTranscriptPreset].wordCount,
        useWordCountMode: listeningTranscriptPreset === 'custom' ? listeningUseWordCountMode : false,
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

      if (error) throw error;

      if (data.error) {
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
      toast({
        title: 'Generation Failed',
        description: err.message || 'Failed to generate practice test. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
      setGenerationStep(0);
    }
  };

  // Calculate estimated generation time for listening based on audio duration
  const getListeningEstimate = () => {
    const durationSec = listeningTranscriptPreset === 'custom'
      ? (listeningUseWordCountMode ? Math.round(customTranscriptWordCount / 150 * 60) : customTranscriptDuration)
      : LISTENING_TRANSCRIPT_PRESETS[listeningTranscriptPreset].durationSeconds;
    
    if (durationSec <= 120) return { text: '15-30 seconds', seconds: 22 };
    if (durationSec <= 300) return { text: '30-60 seconds', seconds: 45 };
    return { text: '60-90 seconds', seconds: 75 };
  };

  // Calculate estimated generation time for reading based on passage length
  const getReadingEstimate = () => {
    const wordCount = readingPassagePreset === 'custom'
      ? (useWordCountMode ? customWordCount : customParagraphCount * 120)
      : READING_PASSAGE_PRESETS[readingPassagePreset].wordCount;
    
    if (wordCount <= 500) return { text: '10-20 seconds', seconds: 15 };
    if (wordCount <= 750) return { text: '15-25 seconds', seconds: 20 };
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

  if (isGenerating) {
    return (
      <AILoadingScreen
        title="Generating Your Practice Test"
        description={`Creating a personalized ${activeModule} test with ${questionCount} ${currentQuestionType.replace(/_/g, ' ').toLowerCase()} questions.`}
        progressSteps={progressSteps}
        currentStepIndex={generationStep}
        estimatedTime={moduleEstimate.text}
        estimatedSeconds={moduleEstimate.seconds}
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
                    Official IELTS passages are 700-950 words with 5-8 paragraphs.
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

                    {/* Custom Options (shown when custom is selected) */}
                    {readingPassagePreset === 'custom' && (
                      <div className="space-y-4 pl-4 border-l-2 border-primary/30">
                        {/* Mode Toggle */}
                        <div className="flex items-center gap-4">
                          <span className={`text-sm ${!useWordCountMode ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
                            By Paragraphs
                          </span>
                          <Switch
                            checked={useWordCountMode}
                            onCheckedChange={setUseWordCountMode}
                          />
                          <span className={`text-sm ${useWordCountMode ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
                            By Word Count
                          </span>
                        </div>

                        {!useWordCountMode ? (
                          /* Paragraph Count Slider */
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <Label>Number of Paragraphs</Label>
                              <Badge variant="outline">{customParagraphCount} paragraphs</Badge>
                            </div>
                            <Slider
                              value={[customParagraphCount]}
                              onValueChange={([v]) => setCustomParagraphCount(v)}
                              min={2}
                              max={10}
                              step={1}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>2 (Short)</span>
                              <span>6 (Standard)</span>
                              <span>10 (Long)</span>
                            </div>
                          </div>
                        ) : (
                          /* Word Count Slider */
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <Label>Target Word Count</Label>
                              <Badge variant="outline">{customWordCount} words</Badge>
                            </div>
                            <Slider
                              value={[customWordCount]}
                              onValueChange={([v]) => setCustomWordCount(v)}
                              min={300}
                              max={1200}
                              step={50}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>300 (Short)</span>
                              <span>750 (Standard)</span>
                              <span>1200 (Max)</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Official IELTS Academic passages: 700-950 words
                            </p>
                          </div>
                        )}
                      </div>
                    )}
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
                      <span>5 (Standard)</span>
                      <span>10 (Comprehensive)</span>
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
                    Generate audio dialogue with questions. Limits optimized for Gemini free tier (max ~2 min audio).
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

                  {/* Transcript Configuration */}
                  <div className="space-y-4 border-t pt-6">
                    <Label className="text-base font-medium flex items-center gap-2">
                      <Settings2 className="w-4 h-4" />
                      Audio Length
                    </Label>
                    
                    {/* Preset Selection */}
                    <RadioGroup 
                      value={listeningTranscriptPreset} 
                      onValueChange={(v) => setListeningTranscriptPreset(v as keyof typeof LISTENING_TRANSCRIPT_PRESETS)}
                      className="grid grid-cols-2 gap-3"
                    >
                      {Object.entries(LISTENING_TRANSCRIPT_PRESETS).map(([key, preset]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <RadioGroupItem value={key} id={`listening-preset-${key}`} />
                          <Label 
                            htmlFor={`listening-preset-${key}`} 
                            className="cursor-pointer text-sm"
                          >
                            {preset.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>

                    {/* Custom Configuration */}
                    {listeningTranscriptPreset === 'custom' && (
                      <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">Configure by:</Label>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs ${!listeningUseWordCountMode ? 'font-medium' : 'text-muted-foreground'}`}>
                              Duration
                            </span>
                            <Switch
                              checked={listeningUseWordCountMode}
                              onCheckedChange={setListeningUseWordCountMode}
                            />
                            <span className={`text-xs ${listeningUseWordCountMode ? 'font-medium' : 'text-muted-foreground'}`}>
                              Word Count
                            </span>
                          </div>
                        </div>

                        {listeningUseWordCountMode ? (
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <Label className="text-sm">Transcript Words</Label>
                              <span className="text-sm font-medium">{customTranscriptWordCount} words</span>
                            </div>
                            <Slider
                              value={[customTranscriptWordCount]}
                              onValueChange={([v]) => setCustomTranscriptWordCount(v)}
                              min={150}
                              max={1200}
                              step={50}
                            />
                            <p className="text-xs text-muted-foreground">
                              ~{Math.round(customTranscriptWordCount / 150)} min of audio
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <Label className="text-sm">Audio Duration</Label>
                              <span className="text-sm font-medium">{customTranscriptDuration} seconds</span>
                            </div>
                            <Slider
                              value={[customTranscriptDuration]}
                              onValueChange={([v]) => setCustomTranscriptDuration(v)}
                              min={60}
                              max={480}
                              step={30}
                            />
                            <p className="text-xs text-muted-foreground">
                              ~{Math.round(customTranscriptDuration / 60 * 150)} words (~{Math.round(customTranscriptDuration / 60)} min)
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Estimated Generation Time */}
                    {(() => {
                      const durationSec = listeningTranscriptPreset === 'custom'
                        ? (listeningUseWordCountMode ? Math.round(customTranscriptWordCount / 150 * 60) : customTranscriptDuration)
                        : LISTENING_TRANSCRIPT_PRESETS[listeningTranscriptPreset].durationSeconds;
                      const estimatedGenTime = durationSec <= 120 ? '15-30' : durationSec <= 300 ? '30-60' : '60-90';
                      return (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                          <Clock className="w-4 h-4 text-primary" />
                          <span className="text-sm">
                            <span className="text-muted-foreground">Estimated generation time:</span>{' '}
                            <span className="font-medium text-primary">{estimatedGenTime} seconds</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>

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
                      max={8}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1 (Quick)</span>
                      <span>4 (Standard)</span>
                      <span>8 (Max)</span>
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
                      min={0.75}
                      max={1.25}
                      step={0.05}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Slower</span>
                      <span>Normal</span>
                      <span>Faster</span>
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
                    Speaking Practice Configuration
                  </CardTitle>
                  <CardDescription>
                    Practice with AI examiner - questions read aloud, you record responses
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
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

              {/* Topic Preference */}
              <div className="space-y-3">
                <Label htmlFor="topic" className="text-base font-medium">
                  Topic Preference (Optional)
                </Label>
                <Input
                  id="topic"
                  value={topicPreference}
                  onChange={(e) => setTopicPreference(e.target.value.slice(0, 100))}
                  placeholder="e.g., Environmental science, Technology, Education..."
                  maxLength={100}
                />
                <p className="text-sm text-muted-foreground">
                  Leave empty for a random IELTS-standard topic. Max 100 characters.
                </p>
              </div>

              {/* Time Setting */}
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
                  max={activeModule === 'reading' ? 60 : 10}
                  step={activeModule === 'reading' ? 5 : 1}
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
                  <span>{activeModule === 'reading' ? '60 min' : '10 min'}</span>
                </div>
                {activeModule === 'reading' && (
                  <p className="text-xs text-muted-foreground">
                    Official IELTS allows 60 minutes for all 3 reading passages (40 questions)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Generate Button */}
          <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                  <h3 className="font-bold text-lg mb-1">Ready to Practice?</h3>
                  <p className="text-muted-foreground">
                    {questionCount} {currentQuestionType.replace(/_/g, ' ').toLowerCase()} questions • {timeMinutes} minutes • {difficulty} difficulty
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
