import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface GeminiLiveConfig {
  partType: 'PART_1' | 'PART_2' | 'PART_3' | 'FULL_TEST';
  difficulty: string;
  topic?: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTranscriptReceived?: (text: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
}

interface GeminiMessage {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          data: string;
          mimeType: string;
        };
        text?: string;
      }>;
    };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  setupComplete?: boolean;
  error?: { message: string };
}

export function useGeminiLiveAudio(config: GeminiLiveConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize audio context
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  }, []);

  // Play audio from queue
  const playNextAudio = useCallback(async () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current) {
      if (audioQueueRef.current.length === 0) {
        setIsSpeaking(false);
      }
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);

    const audioData = audioQueueRef.current.shift()!;
    const audioContext = initAudioContext();

    try {
      // Convert PCM16 to AudioBuffer
      const int16Array = new Int16Array(audioData);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      currentSourceRef.current = source;

      source.onended = () => {
        isPlayingRef.current = false;
        currentSourceRef.current = null;
        playNextAudio();
      };

      source.start();
      config.onAudioReceived?.(audioData);
    } catch (err) {
      console.error('Error playing audio:', err);
      isPlayingRef.current = false;
      playNextAudio();
    }
  }, [config, initAudioContext]);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: GeminiMessage = JSON.parse(event.data);
      
      if (message.setupComplete) {
        console.log('Gemini Live session setup complete');
        setIsConnected(true);
        config.onConnectionChange?.(true);
        return;
      }

      if (message.error) {
        console.error('Gemini error:', message.error);
        setError(new Error(message.error.message));
        config.onError?.(new Error(message.error.message));
        return;
      }

      if (message.serverContent?.interrupted) {
        // Clear audio queue on interruption (barge-in)
        audioQueueRef.current = [];
        if (currentSourceRef.current) {
          currentSourceRef.current.stop();
          currentSourceRef.current = null;
        }
        setIsSpeaking(false);
        return;
      }

      if (message.serverContent?.modelTurn?.parts) {
        for (const part of message.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            // Audio data received
            const audioBytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
            audioQueueRef.current.push(audioBytes.buffer);
            playNextAudio();
          }
          if (part.text) {
            // Text transcript received
            setTranscript(prev => prev + part.text);
            config.onTranscriptReceived?.(part.text, false);
          }
        }
      }

      if (message.serverContent?.turnComplete) {
        config.onTranscriptReceived?.('', true);
      }
    } catch (err) {
      console.error('Error parsing Gemini message:', err);
    }
  }, [config, playNextAudio]);

  // Connect to Gemini Live API
  const connect = useCallback(async () => {
    try {
      setError(null);
      
      // Get session config from edge function
      const { data, error: fetchError } = await supabase.functions.invoke('ai-speaking-session', {
        body: {
          partType: config.partType,
          difficulty: config.difficulty,
          topic: config.topic
        }
      });

      if (fetchError || !data?.success) {
        throw new Error(fetchError?.message || data?.error || 'Failed to create session');
      }

      const { apiKey, wsEndpoint, sessionConfig } = data;

      // Connect to WebSocket
      const wsUrl = `${wsEndpoint}?key=${apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected, sending setup message');
        // Send setup message
        ws.send(JSON.stringify({ setup: sessionConfig }));
      };

      ws.onmessage = handleMessage;

      ws.onerror = (e) => {
        console.error('WebSocket error:', e);
        setError(new Error('Connection error'));
        config.onError?.(new Error('Connection error'));
      };

      ws.onclose = (e) => {
        console.log('WebSocket closed:', e.reason);
        setIsConnected(false);
        config.onConnectionChange?.(false);
      };

    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err : new Error('Connection failed'));
      config.onError?.(err instanceof Error ? err : new Error('Connection failed'));
    }
  }, [config, handleMessage]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
    setIsSpeaking(false);
    setIsListening(false);
    audioQueueRef.current = [];
  }, []);

  // Start listening (microphone)
  const startListening = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send as base64
        const base64 = btoa(String.fromCharCode(...new Uint8Array(int16Data.buffer)));
        wsRef.current.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{
              data: base64,
              mimeType: 'audio/pcm;rate=16000'
            }]
          }
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsListening(true);

      // Store for cleanup
      (mediaRecorderRef as any).current = { stream, audioContext, processor, source };

    } catch (err) {
      console.error('Microphone error:', err);
      throw err;
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    const recorder = (mediaRecorderRef as any).current;
    if (recorder) {
      recorder.stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      recorder.processor.disconnect();
      recorder.source.disconnect();
      recorder.audioContext.close();
      mediaRecorderRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Send text message
  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    wsRef.current.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }]
        }],
        turnComplete: true
      }
    }));
  }, []);

  // Interrupt AI (barge-in)
  const interrupt = useCallback(() => {
    audioQueueRef.current = [];
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isSpeaking,
    isListening,
    transcript,
    error,
    connect,
    disconnect,
    startListening,
    stopListening,
    sendText,
    interrupt
  };
}
