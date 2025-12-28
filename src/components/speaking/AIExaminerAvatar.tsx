import { useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface AIExaminerAvatarProps {
  isListening: boolean;
  isSpeaking: boolean;
  audioData?: Float32Array;
  className?: string;
}

// Abstract waveform visualizer that responds to audio output
export function AIExaminerAvatar({ 
  isListening, 
  isSpeaking, 
  audioData,
  className 
}: AIExaminerAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const phaseRef = useRef(0);

  // Generate smooth wave parameters
  const waveParams = useMemo(() => ({
    waves: [
      { amplitude: 30, frequency: 0.02, speed: 0.03, color: 'hsl(var(--primary))' },
      { amplitude: 20, frequency: 0.03, speed: 0.02, color: 'hsl(var(--primary) / 0.6)' },
      { amplitude: 15, frequency: 0.04, speed: 0.04, color: 'hsl(var(--primary) / 0.3)' },
    ]
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const width = rect.width;
      const height = rect.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Calculate amplitude multiplier based on state
      let amplitudeMultiplier = 0.3; // Idle state
      if (isSpeaking) {
        // When speaking, use audio data if available, otherwise animate
        if (audioData && audioData.length > 0) {
          const avgAmplitude = audioData.reduce((a, b) => a + Math.abs(b), 0) / audioData.length;
          amplitudeMultiplier = 0.5 + avgAmplitude * 3;
        } else {
          // Animated speaking without audio data
          amplitudeMultiplier = 0.8 + Math.sin(phaseRef.current * 5) * 0.4;
        }
      } else if (isListening) {
        amplitudeMultiplier = 0.5 + Math.sin(phaseRef.current * 2) * 0.2;
      }

      // Draw each wave layer
      waveParams.waves.forEach((wave, index) => {
        ctx.beginPath();
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = 3 - index * 0.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let x = 0; x < width; x++) {
          const y = centerY + 
            Math.sin(x * wave.frequency + phaseRef.current * wave.speed * 100 + index) * 
            wave.amplitude * amplitudeMultiplier;
          
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });

      // Draw center glow when speaking
      if (isSpeaking) {
        const gradient = ctx.createRadialGradient(
          width / 2, centerY, 0,
          width / 2, centerY, 80
        );
        gradient.addColorStop(0, 'hsl(var(--primary) / 0.3)');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      // Draw listening indicator
      if (isListening && !isSpeaking) {
        const pulseSize = 40 + Math.sin(phaseRef.current * 3) * 10;
        ctx.beginPath();
        ctx.arc(width / 2, centerY, pulseSize, 0, Math.PI * 2);
        ctx.strokeStyle = 'hsl(var(--success) / 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      phaseRef.current += 0.05;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isSpeaking, isListening, audioData, waveParams]);

  return (
    <div className={cn(
      "relative rounded-2xl overflow-hidden bg-gradient-to-b from-muted/50 to-muted",
      className
    )}>
      {/* Background glow effect */}
      <div className={cn(
        "absolute inset-0 transition-opacity duration-500",
        isSpeaking ? "opacity-100" : "opacity-0"
      )}>
        <div className="absolute inset-0 bg-gradient-to-t from-primary/20 to-transparent" />
      </div>

      {/* Waveform canvas */}
      <canvas 
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Status indicator */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className={cn(
          "w-2 h-2 rounded-full transition-colors duration-300",
          isSpeaking ? "bg-primary animate-pulse" : 
          isListening ? "bg-success animate-pulse" : 
          "bg-muted-foreground/50"
        )} />
        <span className="text-xs text-muted-foreground font-medium">
          {isSpeaking ? 'Speaking' : isListening ? 'Listening' : 'Ready'}
        </span>
      </div>

      {/* Examiner label */}
      <div className="absolute top-3 left-3 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-md">
        <span className="text-xs font-medium text-foreground">AI Examiner</span>
      </div>
    </div>
  );
}
