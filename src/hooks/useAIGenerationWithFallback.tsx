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

// Validate that a generated/preset test has proper structure
function validateTestPayload(data: any, module: string): { valid: boolean; reason?: string } {
  if (!data) return { valid: false, reason: 'Empty payload' };
  
  // Check for questionGroups
  const questionGroups = data.questionGroups;
  if (!questionGroups || !Array.isArray(questionGroups) || questionGroups.length === 0) {
    return { valid: false, reason: 'Missing or empty questionGroups' };
  }
  
  // Validate each group has required fields
  for (let i = 0; i < questionGroups.length; i++) {
    const group = questionGroups[i];
    
    // Must have question_type
    if (!group.question_type || typeof group.question_type !== 'string' || group.question_type.trim() === '') {
      return { valid: false, reason: `Group ${i + 1} missing question_type` };
    }
    
    // Must have questions array
    if (!group.questions || !Array.isArray(group.questions) || group.questions.length === 0) {
      return { valid: false, reason: `Group ${i + 1} has no questions` };
    }
    
    // Validate each question has required fields
    for (let j = 0; j < group.questions.length; j++) {
      const q = group.questions[j];
      if (!q.question_number || !q.correct_answer) {
        return { valid: false, reason: `Group ${i + 1} question ${j + 1} missing required fields` };
      }
    }
  }
  
  // Module-specific validation
  if (module === 'reading') {
    if (!data.passage || !data.passage.content) {
      return { valid: false, reason: 'Reading test missing passage content' };
    }
  }
  
  if (module === 'listening') {
    // Listening tests should have audio or transcript
    // (audio might be generated separately, so just check questionGroups for now)
  }
  
  return { valid: true };
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
    setProgress(5);

    // OPTIMIZATION: Check database cache first (saves Edge Function quotas)
    try {
      console.log('Checking DB cache for existing test...');
      const { data: cachedTests, error: cacheError } = await supabase
        .from('generated_test_audio')
        .select('*')
        .eq('module', options.module)
        .eq('is_published', true)
        .eq('status', 'ready')
        .limit(10);

      if (!cacheError && cachedTests && cachedTests.length > 0) {
        // Filter by topic if specified
        let matchingTests = cachedTests;
        if (options.topicPreference) {
          const topicMatches = cachedTests.filter(t => 
            t.topic.toLowerCase().includes(options.topicPreference!.toLowerCase())
          );
          if (topicMatches.length > 0) matchingTests = topicMatches;
        }

        // Filter by difficulty if possible
        const difficultyMatches = matchingTests.filter(t => t.difficulty === options.difficulty);
        if (difficultyMatches.length > 0) matchingTests = difficultyMatches;

        // Filter by question type if possible
        if (options.questionType) {
          const typeMatches = matchingTests.filter(t => t.question_type === options.questionType);
          if (typeMatches.length > 0) matchingTests = typeMatches;
        }

        // Pick a random matching test
        if (matchingTests.length > 0) {
          const randomTest = matchingTests[Math.floor(Math.random() * matchingTests.length)];
          const payload = randomTest.content_payload as Record<string, unknown>;
          
          // Validate the cached payload
          const validation = validateTestPayload(payload, options.module);
          if (validation.valid) {
            console.log('Cache hit! Using pre-generated test:', randomTest.id);
            setProgress(100);
            setIsGenerating(false);
            
            return {
              success: true,
              data: {
                ...payload,
                testId: `cached-${randomTest.id}-${Date.now()}`,
                presetId: randomTest.id,
                topic: randomTest.topic,
                audioUrl: randomTest.audio_url,
                isCached: true,
              },
              usedFallback: false,
            };
          }
        }
      }
    } catch (cacheErr) {
      // DB check failed, proceed with fresh generation
      console.log('DB cache check failed, proceeding with generation:', cacheErr);
    }

    setProgress(10);

    // Retry generation up to 2 times before falling back
    const MAX_GENERATION_RETRIES = 2;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
      try {
        if (signal.aborted) {
          return { success: false, error: 'Generation cancelled' };
        }

        console.log(`AI generation attempt ${attempt}/${MAX_GENERATION_RETRIES}...`);
        setProgress(10 + (attempt - 1) * 25);
        
        const { data, error } = await supabase.functions.invoke('generate-ai-practice', {
          body: options,
        });

        if (signal.aborted) {
          return { success: false, error: 'Generation cancelled' };
        }

        setProgress(50 + (attempt - 1) * 20);

        // Handle credit limit error - don't retry, go straight to fallback
        if (data?.errorCode === 'CREDIT_LIMIT_EXCEEDED') {
          console.log('Credit limit reached, attempting fallback...');
          return await tryFallback(options.module, signal);
        }

        // Handle generation errors
        if (error || data?.error) {
          lastError = error?.message || data?.error || 'Generation failed';
          console.error(`AI generation attempt ${attempt} failed:`, lastError);
          
          // If this is the last attempt, try fallback
          if (attempt === MAX_GENERATION_RETRIES) {
            console.log('All generation attempts failed, trying fallback...');
            return await tryFallback(options.module, signal);
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        // Validate the response
        const validation = validateTestPayload(data, options.module);
        if (!validation.valid) {
          lastError = `Invalid AI response: ${validation.reason}`;
          console.error(`AI generation attempt ${attempt} returned invalid data:`, validation.reason);
          
          // If this is the last attempt, try fallback
          if (attempt === MAX_GENERATION_RETRIES) {
            console.log('All generation attempts returned invalid data, trying fallback...');
            return await tryFallback(options.module, signal);
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        // Success!
        setProgress(100);
        return { success: true, data, usedFallback: false };

      } catch (err: any) {
        if (signal.aborted) {
          return { success: false, error: 'Generation cancelled' };
        }

        lastError = err.message || 'Unknown error';
        console.error(`Generation attempt ${attempt} error:`, err);
        
        // If this is the last attempt, try fallback
        if (attempt === MAX_GENERATION_RETRIES) {
          console.log('All generation attempts threw errors, trying fallback...');
          return await tryFallback(options.module, signal);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Should not reach here, but just in case
    return { success: false, error: lastError || 'Generation failed after all retries' };
  }, [user]);

  const tryFallback = async (module: string, signal: AbortSignal): Promise<GenerationResult> => {
    try {
      if (signal.aborted) {
        return { success: false, error: 'Generation cancelled' };
      }

      console.log(`Attempting fallback for module: ${module}`);
      setProgress(75);

      // Fetch published presets for this module
      const { data: presets, error } = await supabase
        .from('test_presets')
        .select('*')
        .eq('module', module)
        .eq('is_published', true);

      if (error) throw error;

      if (!presets || presets.length === 0) {
        return { 
          success: false, 
          error: 'Generation failed and no fallback tests available. Please try again later or add your own API key.' 
        };
      }

      // Filter presets to only include valid ones
      const validPresets = presets.filter(preset => {
        const payload = typeof preset.payload === 'object' && preset.payload !== null 
          ? preset.payload as Record<string, unknown>
          : null;
        
        if (!payload) return false;
        
        const validation = validateTestPayload(payload, module);
        if (!validation.valid) {
          console.warn(`Preset ${preset.id} (${preset.topic}) is invalid: ${validation.reason}`);
          return false;
        }
        
        return true;
      });

      if (validPresets.length === 0) {
        return { 
          success: false, 
          error: 'Generation failed and no valid fallback tests available. Please try again later.' 
        };
      }

      // Pick random valid preset
      const randomIndex = Math.floor(Math.random() * validPresets.length);
      const preset = validPresets[randomIndex];

      console.log(`Using valid fallback preset: ${preset.topic}`);

      const payload = preset.payload as Record<string, unknown>;

      setProgress(100);
      
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
        error: 'Generation failed. Please try again later.' 
      };
    } finally {
      setIsGenerating(false);
      setProgress(0);
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
