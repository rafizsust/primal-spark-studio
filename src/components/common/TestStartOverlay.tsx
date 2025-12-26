import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  BookOpen, 
  Headphones, 
  Clock, 
  Target, 
  AlertCircle,
  Play,
  Volume2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TestStartOverlayProps {
  module: 'reading' | 'listening';
  testTitle?: string;
  timeMinutes: number;
  totalQuestions: number;
  questionType: string;
  difficulty: string;
  onStart: () => void;
  onCancel: () => void;
}

export function TestStartOverlay({
  module,
  testTitle,
  timeMinutes,
  totalQuestions,
  questionType,
  difficulty,
  onStart,
  onCancel,
}: TestStartOverlayProps) {
  const [hasAgreed, setHasAgreed] = useState(false);
  const [hasTestedAudio, setHasTestedAudio] = useState(module !== 'listening');

  const isReady = hasAgreed && (module !== 'listening' || hasTestedAudio);

  const testAudio = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 440;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.5);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
      
      setTimeout(() => {
        audioContext.close();
        setHasTestedAudio(true);
      }, 600);
    } catch (error) {
      console.warn('Audio test failed:', error);
      setHasTestedAudio(true); // Allow to proceed anyway
    }
  };

  const ModuleIcon = module === 'reading' ? BookOpen : Headphones;
  const difficultyColor = 
    difficulty === 'easy' ? 'bg-success/20 text-success border-success/30' :
    difficulty === 'medium' ? 'bg-warning/20 text-warning border-warning/30' :
    'bg-destructive/20 text-destructive border-destructive/30';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm animate-fade-in">
      <Card className="max-w-lg w-full mx-4 shadow-2xl border-primary/20">
        <CardHeader className="text-center pb-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <ModuleIcon className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            Ready to Start Your {module === 'reading' ? 'Reading' : 'Listening'} Test?
          </CardTitle>
          <CardDescription className="text-base">
            {testTitle || 'AI-Generated Practice Test'}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Test Info */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <Clock className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-lg font-bold">{timeMinutes} min</div>
              <div className="text-xs text-muted-foreground">Time Limit</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <Target className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-lg font-bold">{totalQuestions}</div>
              <div className="text-xs text-muted-foreground">Questions</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <Badge variant="outline" className={cn("text-xs", difficultyColor)}>
                {difficulty}
              </Badge>
              <div className="text-xs text-muted-foreground mt-1">Difficulty</div>
            </div>
          </div>

          <div className="text-sm text-center text-muted-foreground">
            Question Type: <span className="font-medium text-foreground">{questionType.replace(/_/g, ' ')}</span>
          </div>

          {/* Audio Test for Listening */}
          {module === 'listening' && (
            <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium">Test Your Audio</span>
                </div>
                <Button 
                  size="sm" 
                  variant={hasTestedAudio ? "secondary" : "default"}
                  onClick={testAudio}
                >
                  {hasTestedAudio ? '✓ Audio Works' : 'Play Test Sound'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Make sure your speakers or headphones are working before starting.
              </p>
            </div>
          )}

          {/* Important Notice */}
          <div className="p-4 rounded-lg bg-warning/5 border border-warning/20">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground mb-1">Before you begin:</p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Timer will start immediately when you click Start</li>
                  <li>You cannot pause the test once started</li>
                  <li>Make sure you're in a quiet environment</li>
                  {module === 'listening' && (
                    <li>Audio will play automatically - listen carefully</li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          {/* Consent Checkbox */}
          <div className="flex items-start gap-3 p-3 rounded-lg border">
            <Checkbox 
              id="consent"
              checked={hasAgreed}
              onCheckedChange={(checked) => setHasAgreed(checked === true)}
            />
            <label htmlFor="consent" className="text-sm cursor-pointer">
              I understand that the timer will start immediately and I'm ready to take the test.
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={onCancel}
            >
              Go Back
            </Button>
            <Button 
              className="flex-1 gap-2"
              onClick={onStart}
              disabled={!isReady}
            >
              <Play className="w-4 h-4" />
              Start Test
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
