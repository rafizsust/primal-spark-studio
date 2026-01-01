import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface GenerationOptions {
  module: string;
  questionType: string;
  difficulty: string;
  topicPreference?: string;
  questionCount: number;
  timeMinutes: number;
  readingConfig?: any;
  listeningConfig?: any;
  writingConfig?: any;
}

interface GenerationResult {
  success: boolean;
  data?: any;
  error?: string;
  usedFallback?: boolean;
}

export function useAIGenerationWithFallback() {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (options: GenerationOptions): Promise<GenerationResult> => {
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsGenerating(true);
    setProgress(10);

    try {
      // Attempt AI generation
      setProgress(30);
      
      const { data, error } = await supabase.functions.invoke('generate-ai-practice', {
        body: options,
      });

      // Check if aborted
      if (signal.aborted) {
        return { success: false, error: 'Generation cancelled' };
      }

      setProgress(70);

      // Handle credit limit error specifically
      if (data?.errorCode === 'CREDIT_LIMIT_EXCEEDED') {
        // Try fallback to test_presets
        console.log('Credit limit reached, attempting fallback...');
        return await tryFallback(options.module, signal);
      }

      // Handle other errors
      if (error || data?.error) {
        console.error('AI generation failed:', error || data?.error);
        // Try fallback
        return await tryFallback(options.module, signal);
      }

      setProgress(100);
      return { success: true, data, usedFallback: false };

    } catch (err: any) {
      if (signal.aborted) {
        return { success: false, error: 'Generation cancelled' };
      }

      console.error('Generation error:', err);
      // Try fallback on any error
      return await tryFallback(options.module, signal);
    } finally {
      setIsGenerating(false);
      setProgress(0);
    }
  }, [user]);

  const tryFallback = async (module: string, signal: AbortSignal): Promise<GenerationResult> => {
    try {
      if (signal.aborted) {
        return { success: false, error: 'Generation cancelled' };
      }

      console.log(`Attempting fallback for module: ${module}`);

      // Fetch a random published preset for this module
      const { data: presets, error } = await supabase
        .from('test_presets')
        .select('*')
        .eq('module', module)
        .eq('is_published', true);

      if (error) throw error;

      if (!presets || presets.length === 0) {
        return { 
          success: false, 
          error: 'No fallback tests available. Please try again later or add your own API key.' 
        };
      }

      // Pick random preset
      const randomIndex = Math.floor(Math.random() * presets.length);
      const preset = presets[randomIndex];

      console.log(`Using fallback preset: ${preset.topic}`);

      const payload = typeof preset.payload === 'object' && preset.payload !== null 
        ? preset.payload as Record<string, unknown>
        : {};

      return {
        success: true,
        data: {
          ...payload,
          testId: `fallback-${preset.id}-${Date.now()}`,
          topic: preset.topic,
          isFallback: true,
        },
        usedFallback: true,
      };
    } catch (err) {
      console.error('Fallback error:', err);
      return { 
        success: false, 
        error: 'Generation failed and no fallback available. Please try again.' 
      };
    }
  };

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setProgress(0);
  }, []);

  return {
    generate,
    cancel,
    isGenerating,
    progress,
  };
}