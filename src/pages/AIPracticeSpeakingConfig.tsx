import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AILoadingScreen } from '@/components/common/AILoadingScreen';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { describeApiError } from '@/lib/apiErrors';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { playCompletionSound, playErrorSound } from '@/lib/sounds';
import { 
  Mic, 
  Volume2, 
  Sparkles, 
  Clock, 
  Target,
  Settings2,
  ArrowRight,
  Loader2
} from 'lucide-react';
import { 
  DifficultyLevel, 
  SpeakingPartType,
  saveGeneratedTestAsync,
  setCurrentTest,
  GeneratedTest
} from '@/types/aiPractice';

// Speaking part types
const SPEAKING_PARTS: { value: SpeakingPartType; label: string; description: string; duration: string }[] = [
  { value: 'FULL_TEST', label: 'Full Test', description: 'Complete test with all 3 parts', duration: '11-14 min' },
  { value: 'PART_1', label: 'Part 1 Only', description: 'Introduction and interview questions', duration: '4-5 min' },
  { value: 'PART_2', label: 'Part 2 Only', description: 'Individual long turn with cue card', duration: '3-4 min' },
  { value: 'PART_3', label: 'Part 3 Only', description: 'Two-way discussion on abstract topics', duration: '4-5 min' },
];

// Difficulty options
const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string; color: string; description: string }[] = [
  { value: 'easy', label: 'Easy', color: 'bg-success/20 text-success border-success/30', description: 'Common topics, simpler vocabulary' },
  { value: 'medium', label: 'Medium', color: 'bg-warning/20 text-warning border-warning/30', description: 'Standard IELTS difficulty' },
  { value: 'hard', label: 'Hard', color: 'bg-destructive/20 text-destructive border-destructive/30', description: 'Complex topics, advanced vocabulary' },
  { value: 'expert', label: 'Expert', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30', description: 'Challenging abstract discussions' },
];

// Common IELTS speaking topics (dropdown)
const TOPICS_BY_PART: Record<SpeakingPartType, readonly string[]> = {
  PART_1: [
    'Hometown & living area',
    'Accommodation & home',
    'Work & career',
    'Study & education',
    'Daily routine',
    'Family & friends',
    'Food & cooking',
    'Shopping & spending',
    'Hobbies & leisure',
    'Sports & fitness',
    'Music & art',
    'Books & films',
    'Travel & holidays',
    'Transport',
    'Weather & seasons',
    'Technology & gadgets',
    'Social media',
    'Health & lifestyle',
    'Clothes & fashion',
    'Pets & animals',
    'Weekend plans',
    'Celebrations & festivals',
  ],
  PART_2: [
    'Describe a person you admire',
    'Describe a memorable trip',
    'Describe a place in your city',
    'Describe an important event',
    'Describe a time you helped someone',
    'Describe a challenging experience',
    'Describe an achievement you are proud of',
    'Describe a gift you received',
    'Describe a skill you learned',
    'Describe a book/movie you enjoyed',
    'Describe a piece of technology you use',
    'Describe a hobby you enjoy',
    'Describe a time you solved a problem',
    'Describe a time you learned something new',
    'Describe a time you worked in a team',
    'Describe a special meal',
    'Describe an object you use every day',
    'Describe a rule you would change',
  ],
  PART_3: [
    'Education & learning',
    'Work culture & careers',
    'Technology and society',
    'Media & communication',
    'Environment & climate',
    'Health in modern life',
    'City life vs rural life',
    'Transport and urban planning',
    'Culture & traditions',
    'Tourism & globalisation',
    'Arts and public funding',
    'Sports and wellbeing',
    'Family roles and relationships',
    'Consumerism & advertising',
    'Crime and safety',
    'The future of work',
  ],
  FULL_TEST: [
    'Hometown & living area',
    'Work & career',
    'Study & education',
    'Technology',
    'Travel & holidays',
    'Food & cooking',
    'Health & fitness',
    'Sports & leisure',
    'Music & art',
    'Books & films',
    'Shopping & spending',
    'Transport',
    'Environment',
    'Family & friends',
    'Culture & traditions',
    'Media & communication',
    'City life',
    'Education (deep dive)',
    'Technology (deep dive)',
  ],
} as const;

// Browser TTS voice categories
interface VoiceOption {
  name: string;
  lang: string;
  displayName: string;
}

export default function AIPracticeSpeakingConfig() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  // Configuration state
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [partType, setPartType] = useState<SpeakingPartType>('FULL_TEST');
  const [topicPreference, setTopicPreference] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('');

  const topicOptions = useMemo(
    () => TOPICS_BY_PART[partType] ?? TOPICS_BY_PART.FULL_TEST,
    [partType],
  );

  const topicSelectValue = useMemo(() => {
    if (!topicPreference) return '__random__';
    return topicOptions.includes(topicPreference) ? topicPreference : '__custom__';
  }, [topicPreference, topicOptions]);
  
  // Available voices from browser
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>([]);

  // Loading state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);

  const progressSteps = [
    'Analyzing topic',
    'Generating Part 1 questions',
    'Creating cue card for Part 2',
    'Preparing Part 3 discussion',
    'Finalizing test'
  ];

  // Load browser TTS voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices() || [];
      
      // Filter to English voices and create options
      const englishVoices: VoiceOption[] = voices
        .filter(v => v.lang.startsWith('en'))
        .map(v => ({
          name: v.name,
          lang: v.lang,
          displayName: `${v.name} (${v.lang})`
        }))
        .slice(0, 20); // Limit to 20 voices
      
      setAvailableVoices(englishVoices);
      
      // Set default voice (prefer British English)
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

  // Test voice preview
  const previewVoice = () => {
    if (!selectedVoice) return;
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      "Hello, I will be your IELTS Speaking examiner today."
    );
    
    const voice = window.speechSynthesis.getVoices().find(v => v.name === selectedVoice);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = 0.95;
    
    window.speechSynthesis.speak(utterance);
  };

  const handleGenerate = async () => {
    if (!user) {
      toast({
        title: 'Login Required',
        description: 'Please log in to generate AI practice tests',
        variant: 'destructive',
      });
      navigate('/auth?returnTo=/ai-practice/speaking');
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
    }, 2000);

    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-practice', {
        body: {
          module: 'speaking',
          questionType: partType,
          difficulty,
          topicPreference: topicPreference.trim() || undefined,
          questionCount: partType === 'FULL_TEST' ? 12 : partType === 'PART_2' ? 1 : 5,
          timeMinutes: partType === 'FULL_TEST' ? 14 : partType === 'PART_2' ? 4 : 5,
        },
      });

      clearInterval(stepInterval);

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Build generated test
      const generatedTest: GeneratedTest = {
        id: data.testId || crypto.randomUUID(),
        module: 'speaking',
        questionType: partType,
        difficulty,
        topic: data.topic || topicPreference || 'Random Topic',
        timeMinutes: partType === 'FULL_TEST' ? 14 : partType === 'PART_2' ? 4 : 5,
        speakingParts: data.speakingParts,
        totalQuestions: data.speakingParts?.reduce((acc: number, p: any) => acc + (p.questions?.length || 0), 0) || 0,
        generatedAt: new Date().toISOString(),
      };

      // Save to memory and database
      setCurrentTest(generatedTest);
      await saveGeneratedTestAsync(generatedTest, user.id);

      // Store voice preference in session for the test
      sessionStorage.setItem('speaking_voice_preference', selectedVoice);

      playCompletionSound();

      toast({
        title: 'Test Generated!',
        description: 'Your speaking practice test is ready',
      });

      // Navigate to speaking test
      navigate(`/ai-practice/speaking/${generatedTest.id}`);

    } catch (err: any) {
      console.error('Generation error:', err);
      clearInterval(stepInterval);
      playErrorSound();

      const d = describeApiError(err);
      const action = d.action;

      toast({
        title: d.title,
        description: d.description,
        variant: 'destructive',
        action: action ? (
          <ToastAction
            altText={action.label}
            onClick={() => {
              if (action.href === '#') return;
              if (action.external) {
                window.open(action.href, '_blank', 'noopener,noreferrer');
                return;
              }
              navigate(action.href);
            }}
          >
            {action.label}
          </ToastAction>
        ) : undefined,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (isGenerating) {
    return (
      <AILoadingScreen
        title="Generating Speaking Test"
        description="Creating your personalized IELTS Speaking practice test..."
        progressSteps={progressSteps}
        currentStepIndex={generationStep}
        estimatedSeconds={15}
        onAbort={() => {
          setIsGenerating(false);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Mic className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold">AI Speaking Practice</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Practice your IELTS Speaking with an AI examiner. Configure your test settings below.
          </p>
        </div>

        {/* Configuration Cards */}
        <div className="space-y-6">
          {/* Test Type Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Test Type
              </CardTitle>
              <CardDescription>Choose which part(s) of the speaking test to practice</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={partType}
                onValueChange={(v) => setPartType(v as SpeakingPartType)}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {SPEAKING_PARTS.map((part) => (
                  <div key={part.value} className="relative">
                    <RadioGroupItem
                      value={part.value}
                      id={part.value}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={part.value}
                      className="flex flex-col gap-2 p-4 rounded-lg border-2 cursor-pointer transition-all
                        peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5
                        hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{part.label}</span>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {part.duration}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">{part.description}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Difficulty Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Difficulty Level
              </CardTitle>
              <CardDescription>Select the complexity of questions</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={difficulty}
                onValueChange={(v) => setDifficulty(v as DifficultyLevel)}
                className="grid grid-cols-2 md:grid-cols-4 gap-3"
              >
                {DIFFICULTY_OPTIONS.map((option) => (
                  <div key={option.value} className="relative">
                    <RadioGroupItem
                      value={option.value}
                      id={`diff-${option.value}`}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={`diff-${option.value}`}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 cursor-pointer transition-all
                        peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5
                        hover:bg-muted/50`}
                    >
                      <Badge className={option.color}>{option.label}</Badge>
                      <span className="text-xs text-muted-foreground text-center mt-1">{option.description}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Topic Preference */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-5 h-5" />
                Topic Preference
              </CardTitle>
              <CardDescription>
                Pick a common IELTS topic (or type your own). Leave empty for random.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 max-w-md">
                <Select
                  value={topicSelectValue}
                  onValueChange={(v) => {
                    if (v === '__random__') {
                      setTopicPreference('');
                      return;
                    }
                    if (v === '__custom__') {
                      // keep the current custom text (typed below)
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
                    {topicOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  placeholder="Or type your own (optional)"
                  value={topicPreference}
                  onChange={(e) => setTopicPreference(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Voice Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="w-5 h-5" />
                Examiner Voice
              </CardTitle>
              <CardDescription>Choose the voice for the AI examiner</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4">
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
                <Button variant="outline" onClick={previewVoice} disabled={!selectedVoice}>
                  <Volume2 className="w-4 h-4 mr-2" />
                  Preview Voice
                </Button>
              </div>
              {availableVoices.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Loading available voices...
                </p>
              )}
            </CardContent>
          </Card>

          {/* Start Button */}
          <div className="flex justify-center pt-4">
            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={isGenerating || availableVoices.length === 0}
              className="min-w-[200px]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  Generate Test
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
}
