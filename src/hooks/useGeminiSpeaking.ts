import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useSpeechSynthesis } from './useSpeechSynthesis';

interface GeminiSpeakingConfig {
  partType: 'PART_1' | 'PART_2' | 'PART_3' | 'FULL_TEST';
  difficulty: string;
  topic?: string;
  onAIResponse?: (text: string) => void;
  onUserTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
  onSpeakingChange?: (isSpeaking: boolean) => void;
}

interface ConversationMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export function useGeminiSpeaking(config: GeminiSpeakingConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  
  const apiKeyRef = useRef<string | null>(null);
  const systemInstructionRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingUserInputRef = useRef<string>('');
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectedRef = useRef(false); // Track connection state synchronously
  const disconnectRef = useRef<(() => void) | null>(null);

  // Speech Recognition (STT)
  const recognition = useSpeechRecognition({
    language: 'en-GB',
    continuous: true,
    interimResults: true,
    onResult: (transcript, isFinal) => {
      config.onUserTranscript?.(transcript, isFinal);
      
      if (isFinal && transcript.trim()) {
        // Barge-in: cancel AI speech when user starts talking
        synthesis.cancel();
        
        // Accumulate final transcripts
        pendingUserInputRef.current += ' ' + transcript.trim();
        
        // Reset silence timer
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        
        // After 1.5s of silence, send to AI
        silenceTimeoutRef.current = setTimeout(() => {
          if (pendingUserInputRef.current.trim()) {
            sendToGemini(pendingUserInputRef.current.trim());
            pendingUserInputRef.current = '';
          }
        }, 1500);
      }
    },
    onError: (err) => {
      console.error('Speech recognition error:', err);
    }
  });

  // Speech Synthesis (TTS) - British English
  const synthesis = useSpeechSynthesis({
    lang: 'en-GB',
    rate: 0.95,
    onStart: () => {
      config.onSpeakingChange?.(true);
    },
    onEnd: () => {
      config.onSpeakingChange?.(false);
    },
    onError: (err) => {
      console.error('Speech synthesis error:', err);
    }
  });

  // Connect to Gemini (initialize session)
  const connect = useCallback(async () => {
    try {
      setError(null);
      
      // Get session config from edge function
      const { data, error: fetchError } = await supabase.functions.invoke('ai-speaking-session', {
        body: {
          partType: config.partType,
          difficulty: config.difficulty,
          topic: config.topic,
          mode: 'rest' // Signal we want REST mode
        }
      });

      if (fetchError || !data?.success) {
        throw new Error(fetchError?.message || data?.error || 'Failed to create session');
      }

      apiKeyRef.current = data.apiKey;
      systemInstructionRef.current = data.systemInstruction;
      
      isConnectedRef.current = true; // Update ref immediately (synchronous)
      setIsConnected(true);
      config.onConnectionChange?.(true);
      
      console.log('Gemini REST session initialized');
      
    } catch (err) {
      console.error('Connection error:', err);
      const error = err instanceof Error ? err : new Error('Connection failed');
      setError(error);
      config.onError?.(error);
    }
  }, [config]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    
    recognition.stopListening();
    synthesis.cancel();
    
    isConnectedRef.current = false;
    setIsConnected(false);
    setConversationHistory([]);
    apiKeyRef.current = null;
    
    config.onConnectionChange?.(false);
  }, [recognition, synthesis, config]);

  // Send message to Gemini via REST streaming
  const sendToGemini = useCallback(async (text: string) => {
    if (!apiKeyRef.current || isProcessing) return;

    setIsProcessing(true);

    // Add user message to history
    const userMessage: ConversationMessage = {
      role: 'user',
      parts: [{ text }]
    };
    
    const updatedHistory = [...conversationHistory, userMessage];
    setConversationHistory(updatedHistory);

    try {
      abortControllerRef.current = new AbortController();
      
      // Build request body for Gemini REST API
      const requestBody = {
        contents: updatedHistory,
        systemInstruction: {
          parts: [{ text: systemInstructionRef.current }]
        },
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024
        }
      };

      // Use streamGenerateContent endpoint
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKeyRef.current}&alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              
              if (text) {
                fullResponse += text;
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      // Add AI response to history
      if (fullResponse) {
        const aiMessage: ConversationMessage = {
          role: 'model',
          parts: [{ text: fullResponse }]
        };
        setConversationHistory(prev => [...prev, aiMessage]);
        
        // Speak the response
        synthesis.speak(fullResponse);
        config.onAIResponse?.(fullResponse);
      }

    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('Request aborted');
        return;
      }
      
      console.error('Gemini API error:', err);
      const error = err instanceof Error ? err : new Error('API request failed');
      setError(error);
      config.onError?.(error);
    } finally {
      setIsProcessing(false);
    }
  }, [conversationHistory, synthesis, config, isProcessing]);

  // Send text message (for programmatic control)
  const sendText = useCallback((text: string) => {
    // Use ref for synchronous check (handles callback timing)
    if (!isConnectedRef.current) {
      console.warn('sendText called before connected, queuing...');
      // Queue the message to be sent once connected
      setTimeout(() => {
        if (isConnectedRef.current) {
          sendToGemini(text);
        }
      }, 100);
      return;
    }
    sendToGemini(text);
  }, [isConnected, sendToGemini]);

  // Start listening
  const startListening = useCallback(() => {
    if (!isConnectedRef.current) {
      console.warn('startListening called before connected');
      return;
    }
    recognition.startListening();
  }, [isConnected, recognition]);

  // Stop listening
  const stopListening = useCallback(() => {
    recognition.stopListening();
    
    // Send any pending input
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (pendingUserInputRef.current.trim()) {
      sendToGemini(pendingUserInputRef.current.trim());
      pendingUserInputRef.current = '';
    }
  }, [recognition, sendToGemini]);

  // Interrupt AI (barge-in)
  const interrupt = useCallback(() => {
    synthesis.cancel();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, [synthesis]);

  // Keep latest disconnect for unmount cleanup without disconnecting on every re-render
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      disconnectRef.current?.();
    };
  }, []);

  return {
    // Connection state
    isConnected,
    isProcessing,
    error,
    
    // Speaking state
    isSpeaking: synthesis.isSpeaking,
    isListening: recognition.isListening,
    
    // Transcript
    transcript: recognition.fullTranscript,
    
    // Conversation
    conversationHistory,
    
    // Controls
    connect,
    disconnect,
    startListening,
    stopListening,
    sendText,
    interrupt,
    
    // Voice info
    selectedVoice: synthesis.selectedVoice?.name || 'Default',
    isSTTSupported: recognition.isSupported,
    isTTSSupported: synthesis.isSupported
  };
}
