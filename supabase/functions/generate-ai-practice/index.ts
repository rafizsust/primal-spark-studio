import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decrypt user's Gemini API key
async function decryptApiKey(encryptedValue: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  const combined = Uint8Array.from(atob(encryptedValue), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const encryptedData = combined.slice(12);
  
  const keyData = encoder.encode(encryptionKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData.slice(0, 32),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  
  const decryptedData = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encryptedData
  );
  
  return decoder.decode(decryptedData);
}

// IELTS Topics for random selection
const IELTS_TOPICS = [
  'Climate change and environmental conservation',
  'The impact of technology on modern society',
  'Education systems around the world',
  'Health and wellness in the 21st century',
  'Urbanization and city planning',
  'Wildlife conservation and biodiversity',
  'The role of art and culture in society',
  'Space exploration and scientific discovery',
  'Global tourism and its effects',
  'Sustainable energy solutions',
  'Ancient civilizations and archaeology',
  'Marine ecosystems and ocean conservation',
  'The future of transportation',
  'Digital communication and social media',
  'Food security and agriculture',
];

// Listening scenario types
const LISTENING_SCENARIOS = [
  { type: 'conversation', description: 'a casual conversation between two people' },
  { type: 'lecture', description: 'a short educational lecture or presentation' },
  { type: 'interview', description: 'an interview about a specific topic' },
  { type: 'tour', description: 'a guided tour of a facility or location' },
  { type: 'phone_call', description: 'a phone conversation about booking or inquiry' },
];

// Gemini models for IELTS text generation - sorted by performance & suitability
// 1. gemini-2.5-flash: Stable, best speed/quality balance for structured text generation (June 2025)
// 2. gemini-2.5-pro: Highest quality reasoning, best for complex question generation (fallback)
// 3. gemini-2.0-flash: Fast & reliable, good general-purpose fallback
// 4. gemini-2.0-flash-lite: Fastest, lightweight fallback for emergencies
// EXCLUDED: TTS models, embedding models, image/video generation, experimental/preview, Gemma (smaller context)
const GEMINI_MODELS = [
  'gemini-2.5-flash',      // Primary: best balance for IELTS generation
  'gemini-2.5-pro',        // High quality fallback 
  'gemini-2.0-flash',      // Fast reliable fallback
  'gemini-2.0-flash-lite', // Emergency fallback (lower quality but fast)
];

// Store last error for better error messages
let lastGeminiError: string | null = null;

async function callGemini(apiKey: string, prompt: string): Promise<string | null> {
  lastGeminiError = null;
  
  for (const model of GEMINI_MODELS) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`Gemini ${model} failed:`, JSON.stringify(errorData));
        
        // Parse error message for user-friendly display
        const errorMessage = errorData?.error?.message || '';
        const errorStatus = errorData?.error?.status || '';
        
        if (response.status === 429 || errorStatus === 'RESOURCE_EXHAUSTED') {
          lastGeminiError = 'API quota exceeded. Your Gemini API has reached its rate limit. Please wait a few minutes and try again, or check your Google AI Studio billing.';
          continue;
        } else if (response.status === 403 || errorStatus === 'PERMISSION_DENIED') {
          lastGeminiError = 'API access denied. Please verify your Gemini API key is valid and has the correct permissions.';
          continue;
        } else if (response.status === 400) {
          lastGeminiError = 'Invalid request to AI. The generation request was rejected. Please try again with different settings.';
          continue;
        } else {
          lastGeminiError = `AI service error (${response.status}): ${errorMessage.slice(0, 100)}`;
        }
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`Success with ${model}`);
        return text;
      } else {
        // Check for content filtering or safety issues
        const finishReason = data.candidates?.[0]?.finishReason;
        if (finishReason === 'SAFETY') {
          lastGeminiError = 'Content was filtered by safety settings. Please try a different topic.';
        } else {
          lastGeminiError = 'AI returned empty response. Please try again.';
        }
      }
    } catch (err) {
      console.error(`Error with ${model}:`, err);
      lastGeminiError = `Connection error: Unable to reach AI service. Please check your internet connection and try again.`;
      continue;
    }
  }
  return null;
}

function getLastGeminiError(): string {
  return lastGeminiError || 'Failed to generate content. Please try again.';
}

// Robust JSON extraction from Gemini response
// Handles: raw JSON, ```json...```, ```...```, and mixed content
function extractJsonFromResponse(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty or invalid response from AI');
  }
  
  // Try to find JSON in markdown code blocks first
  // Match ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const extracted = codeBlockMatch[1].trim();
    // Validate it looks like JSON
    if (extracted.startsWith('{') || extracted.startsWith('[')) {
      return extracted;
    }
  }
  
  // Try finding JSON object directly (starts with { and ends with })
  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }
  
  // Try finding JSON array directly
  const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    return jsonArrayMatch[0];
  }
  
  // Last resort: try trimming and returning as-is
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  
  throw new Error('Could not extract valid JSON from AI response');
}

// Generate map image using Gemini (via Lovable AI Gateway)
async function generateMapImage(mapDescription: string, mapLabels: Array<{id: string; text: string}>): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  try {
    console.log('Generating map image with Gemini image model...');

    // Build a detailed prompt for map generation
    const labelsList = mapLabels.map(l => `${l.id}: ${l.text}`).join(', ');
    const imagePrompt = `Create a simple, clean map diagram for an IELTS listening test. 
The map shows: ${mapDescription}
Include these labeled locations: ${labelsList}
Style: Top-down view, simple line art with clear labels (A, B, C, etc.), easy to read, educational diagram style.
Make it look like a professional test map with clear pathways and building outlines.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          { role: 'user', content: imagePrompt }
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Map image generation failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (imageData && imageData.startsWith('data:image/')) {
      console.log('Map image generated successfully');
      return imageData;
    }
    
    console.error('No image data in response');
    return null;
  } catch (err) {
    console.error('Map image generation error:', err);
    return null;
  }
}

// Generate flowchart image using Gemini (via Lovable AI Gateway)
async function generateFlowchartImage(
  title: string, 
  steps: Array<{label?: string; text?: string; isBlank?: boolean; questionNumber?: number}>
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  try {
    console.log('Generating flowchart image with Gemini image model...');
    
    // Build step descriptions for the prompt
    const stepDescriptions = steps.map((step, idx) => {
      const stepText = step.label || step.text || '';
      if (step.isBlank) {
        return `Step ${idx + 1}: [BLANK ${step.questionNumber || idx + 1}] (empty box for answer)`;
      }
      return `Step ${idx + 1}: ${stepText}`;
    }).join('\n');
    
    const imagePrompt = `Create a clean, professional flowchart diagram for an IELTS listening test.
Title: ${title || 'Process Flowchart'}
The flowchart has the following steps connected by arrows flowing downward:
${stepDescriptions}

Style requirements:
- Vertical flow from top to bottom
- Each step in a rounded rectangle box
- Clear arrows connecting steps
- Blank steps should show an empty box with a question number
- Clean, educational diagram style
- Easy to read text
- Professional appearance suitable for a test`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          { role: 'user', content: imagePrompt }
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Flowchart image generation failed:', response.status, errorText);
      
      // Log specific error types for debugging
      if (response.status === 429) {
        console.error('Rate limit exceeded for image generation');
      } else if (response.status === 402) {
        console.error('Payment required for image generation');
      }
      return null;
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (imageData && imageData.startsWith('data:image/')) {
      console.log('Flowchart image generated successfully');
      return imageData;
    }
    
    console.error('No image data in flowchart response');
    return null;
  } catch (err) {
    console.error('Flowchart image generation error:', err);
    return null;
  }
}

// Upload base64 image to Supabase storage and return public URL
async function uploadGeneratedImage(
  supabaseClient: any, 
  imageDataUrl: string, 
  testId: string,
  folder: string = 'ai-practice-images'
): Promise<string | null> {
  try {
    // Extract base64 data and mime type
    const matches = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      console.error('Invalid image data URL format');
      return null;
    }
    
    const [, extension, base64Data] = matches;
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    const fileName = `${folder}/${testId}-${Date.now()}.${extension}`;
    
    const { data, error } = await supabaseClient.storage
      .from('listening-images')
      .upload(fileName, binaryData, {
        contentType: `image/${extension}`,
        upsert: true,
      });
    
    if (error) {
      console.error('Failed to upload map image:', error);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('listening-images')
      .getPublicUrl(fileName);
    
    console.log('Map image uploaded:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    console.error('Map image upload error:', err);
    return null;
  }
}

// Speaker configuration interface
interface SpeakerVoiceConfig {
  gender: 'male' | 'female';
  accent: string;
  voiceName: string;
}

interface SpeakerConfigInput {
  speaker1: SpeakerVoiceConfig;
  speaker2?: SpeakerVoiceConfig;
  useTwoSpeakers: boolean;
}

// Store last TTS error for user-friendly messages
let lastTTSError: string | null = null;

function getLastTTSError(): string {
  return lastTTSError || 'Audio generation failed. Please try again.';
}

// Generate TTS audio using Gemini with retry logic and configurable voices
async function generateAudio(
  apiKey: string, 
  script: string, 
  speakerConfig?: SpeakerConfigInput,
  maxRetries = 3
): Promise<{ audioBase64: string; sampleRate: number } | null> {
  lastTTSError = null;
  
  // Get voice names from config or use defaults
  const speaker1Voice = speakerConfig?.speaker1?.voiceName || 'Kore';
  const speaker2Voice = speakerConfig?.speaker2?.voiceName || 'Puck';
  const useTwoSpeakers = speakerConfig?.useTwoSpeakers !== false;

  const ttsPrompt = useTwoSpeakers
    ? `Read the following conversation slowly and clearly, as if for a language listening test. 
Use a moderate speaking pace with natural pauses between sentences. 
Pause briefly (about 1-2 seconds) after each speaker finishes their turn.
The two speakers should have distinct, clear voices:

${script}`
    : `Read the following monologue slowly and clearly, as if for a language listening test. 
Use a moderate speaking pace with natural pauses between sentences.

${script}`;

  // Build speech config based on whether we have 1 or 2 speakers
  // For single speaker (monologue), use voiceConfig instead of multiSpeakerVoiceConfig
  let speechConfig;
  if (useTwoSpeakers) {
    speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: "Speaker1", voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker1Voice } } },
          { speaker: "Speaker2", voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker2Voice } } },
        ],
      },
    };
  } else {
    // Single speaker - use simple voiceConfig (NOT multiSpeakerVoiceConfig)
    speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: speaker1Voice }
      },
    };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating TTS audio (attempt ${attempt}/${maxRetries}) with voices: ${speaker1Voice}${useTwoSpeakers ? `, ${speaker2Voice}` : ' (monologue)'}...`);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: ttsPrompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`TTS failed (attempt ${attempt}):`, errorText);
        
        // Parse error for user-friendly message
        try {
          const errorData = JSON.parse(errorText);
          const errorMessage = errorData?.error?.message || '';
          const errorCode = errorData?.error?.code || response.status;
          
          if (response.status === 429 || errorCode === 429) {
            lastTTSError = 'API quota exceeded. Your Gemini API has reached its rate limit for audio generation. Please wait a few minutes and try again, or upgrade your Google AI Studio plan.';
          } else if (response.status === 403) {
            lastTTSError = 'API access denied for audio generation. Please verify your Gemini API key has TTS permissions enabled.';
          } else if (response.status === 400) {
            lastTTSError = `Audio generation request was rejected: ${errorMessage.slice(0, 100)}. Please try again.`;
          } else {
            lastTTSError = `Audio generation failed (error ${errorCode}): ${errorMessage.slice(0, 100)}`;
          }
        } catch {
          lastTTSError = `Audio generation failed with status ${response.status}. Please try again.`;
        }
        
        if ((response.status === 500 || response.status === 503) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Retrying TTS in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return null;
      }

      const data = await response.json();
      const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (audioData) {
        console.log("TTS audio generated successfully");
        return { audioBase64: audioData, sampleRate: 24000 };
      } else {
        lastTTSError = 'Audio generation returned empty response. Please try again.';
      }
    } catch (err) {
      console.error(`TTS error (attempt ${attempt}):`, err);
      lastTTSError = `Connection error during audio generation: ${err instanceof Error ? err.message : 'Unknown error'}`;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  return null;
}

// Reading configuration interface
interface ReadingConfig {
  passagePreset?: string;
  paragraphCount?: number;
  wordCount?: number;
  useWordCountMode?: boolean;
}

// Listening configuration interface
// Gemini free tier limits: ~15 min audio/day, keep each request to max ~2 min (70% of capacity)
// ~150 words per minute of speech at normal pace
interface SpellingModeConfig {
  enabled: boolean;
  testScenario: 'phone_call' | 'hotel_booking' | 'job_inquiry';
  spellingDifficulty: 'low' | 'high';
  numberFormat: 'phone_number' | 'date' | 'postcode';
}

interface ListeningConfig {
  transcriptPreset?: string;
  durationSeconds?: number;
  wordCount?: number;
  useWordCountMode?: boolean;
  speakerConfig?: SpeakerConfigInput;
  spellingMode?: SpellingModeConfig;
  monologueMode?: boolean; // Single speaker mode like IELTS Part 4
}

// Reading question type prompts - generate structured data matching DB schema
function getReadingPrompt(
  questionType: string, 
  topic: string, 
  difficulty: string, 
  questionCount: number,
  readingConfig?: ReadingConfig
): string {
  const difficultyDesc = difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8';
  
  // Determine passage specifications based on config
  let paragraphCount = readingConfig?.paragraphCount || 6;
  let wordCount = readingConfig?.wordCount || 750;
  
  // If using word count mode, estimate paragraphs (avg ~100-120 words per paragraph)
  if (readingConfig?.useWordCountMode && readingConfig.wordCount) {
    paragraphCount = Math.max(3, Math.min(10, Math.ceil(wordCount / 110)));
  } else if (!readingConfig?.useWordCountMode && readingConfig?.paragraphCount) {
    // If using paragraph mode, estimate word count
    wordCount = paragraphCount * 110;
  }

  // Generate paragraph labels
  const paragraphLabels = Array.from({ length: paragraphCount }, (_, i) => 
    String.fromCharCode(65 + i) // A, B, C, ...
  );
  const labelList = paragraphLabels.map(l => `[${l}]`).join(', ');
  
  const basePrompt = `Generate an IELTS Academic Reading test with the following specifications:

Topic: ${topic}
Difficulty: ${difficulty} (${difficultyDesc})

Requirements:
1. Create a reading passage with these specifications:
   - Total word count: approximately ${wordCount} words (strict: between ${wordCount - 50} and ${wordCount + 100} words)
   - Number of paragraphs: ${paragraphCount} paragraphs, labeled ${labelList}
   - Each paragraph should be 80-150 words (official IELTS standard)
   - Academic in tone and style
   - Well-structured with clear paragraph labels [A], [B], etc.
   - Contains specific information that can be tested
   - Appropriate for the ${difficulty} difficulty level

`;

  switch (questionType) {
    case 'TRUE_FALSE_NOT_GIVEN':
    case 'YES_NO_NOT_GIVEN':
      return basePrompt + `2. Create ${questionCount} ${questionType === 'YES_NO_NOT_GIVEN' ? 'Yes/No/Not Given' : 'True/False/Not Given'} questions based on the passage.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Do the following statements agree with the information given in the passage? Write ${questionType === 'YES_NO_NOT_GIVEN' ? 'YES, NO, or NOT GIVEN' : 'TRUE, FALSE, or NOT GIVEN'}.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Statement about the passage",
      "correct_answer": "${questionType === 'YES_NO_NOT_GIVEN' ? 'YES' : 'TRUE'}",
      "explanation": "Why this is the correct answer"
    }
  ]
}`;

    case 'MULTIPLE_CHOICE':
    case 'MULTIPLE_CHOICE_SINGLE':
      return basePrompt + `2. Create ${questionCount} multiple choice questions (single answer) based on the passage.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Choose the correct letter, A, B, C or D.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "The question about the passage?",
      "options": ["A First option", "B Second option", "C Third option", "D Fourth option"],
      "correct_answer": "A",
      "explanation": "Why A is correct"
    }
  ]
}`;

    case 'MULTIPLE_CHOICE_MULTIPLE':
      // For MCQ Multiple, we create ONE question "set" where test-takers must pick N answers.
      // We represent it as a single question group spanning N question numbers (e.g., Questions 1-2) so UI counts correctly.
      // questionCount here represents the number of answers to select (e.g., 2 or 3)
      const numAnswersToSelect = Math.min(questionCount, 3); // Cap at 3 to keep it reasonable
      const answerWord = numAnswersToSelect === 2 ? 'TWO' : numAnswersToSelect === 3 ? 'THREE' : String(numAnswersToSelect);

      return basePrompt + `2. Create ONE multiple choice question where test-takers must select ${answerWord} correct answers from the options.

IMPORTANT:
- The question group spans ${numAnswersToSelect} question numbers: 1 to ${numAnswersToSelect}
- Return ${numAnswersToSelect} question objects with question_number 1..${numAnswersToSelect}
- ALL question objects must have the SAME question_text, SAME options, SAME correct_answer, SAME explanation
- The correct_answer must be a comma-separated list of ${numAnswersToSelect} letters (e.g., "B,D" or "A,C,E")
- DO NOT always use the same letters - randomize which options are correct
- Provide 5-6 options total so there are distractors

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Questions 1-${numAnswersToSelect}. Choose ${answerWord} letters, A-E.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Which ${answerWord} of the following statements are supported by information in the passage?",
      "options": ["A First option", "B Second option", "C Third option", "D Fourth option", "E Fifth option"],
      "correct_answer": "B,D",
      "explanation": "B is correct because... D is correct because...",
      "max_answers": ${numAnswersToSelect}
    },
    {
      "question_number": ${numAnswersToSelect},
      "question_text": "Which ${answerWord} of the following statements are supported by information in the passage?",
      "options": ["A First option", "B Second option", "C Third option", "D Fourth option", "E Fifth option"],
      "correct_answer": "B,D",
      "explanation": "B is correct because... D is correct because...",
      "max_answers": ${numAnswersToSelect}
    }
  ]
}`;

    case 'MATCHING_HEADINGS':
      return basePrompt + `2. Create a matching headings question where test-takers match paragraphs to headings.
   - Provide MORE headings than paragraphs (at least 2-3 extra distractors)

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], [C], [D], [E]"
  },
  "instruction": "The passage has five paragraphs, A-E. Choose the correct heading for each paragraph from the list of headings below.",
  "headings": [
    {"id": "i", "text": "First heading option"},
    {"id": "ii", "text": "Second heading option"},
    {"id": "iii", "text": "Third heading option"},
    {"id": "iv", "text": "Fourth heading option"},
    {"id": "v", "text": "Fifth heading option"},
    {"id": "vi", "text": "Sixth heading (distractor)"},
    {"id": "vii", "text": "Seventh heading (distractor)"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Paragraph A", "correct_answer": "ii", "explanation": "Why ii matches A"},
    {"question_number": 2, "question_text": "Paragraph B", "correct_answer": "v", "explanation": "Why v matches B"},
    {"question_number": 3, "question_text": "Paragraph C", "correct_answer": "i", "explanation": "Why i matches C"},
    {"question_number": 4, "question_text": "Paragraph D", "correct_answer": "iv", "explanation": "Why iv matches D"},
    {"question_number": 5, "question_text": "Paragraph E", "correct_answer": "iii", "explanation": "Why iii matches E"}
  ]
}`;

    case 'MATCHING_INFORMATION':
      return basePrompt + `2. Create ${questionCount} matching information questions where test-takers match statements to paragraphs.
   - The passage has multiple paragraphs labeled A, B, C, D, E
   - Each question asks which paragraph contains specific information
   - Provide paragraph options with descriptions (not just letters)

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], [C], [D], [E]"
  },
  "instruction": "Which paragraph contains the following information? Write the correct letter, A-E.",
  "options": [
    {"letter": "A", "text": "Introduction and background"},
    {"letter": "B", "text": "Historical development"},
    {"letter": "C", "text": "Current applications"},
    {"letter": "D", "text": "Future implications"},
    {"letter": "E", "text": "Conclusion and summary"}
  ],
  "questions": [
    {
      "question_number": 1,
      "question_text": "A description of the early origins of the subject",
      "correct_answer": "B",
      "explanation": "This information is found in paragraph B where the historical development is discussed..."
    }
  ]
}`;

    case 'FILL_IN_BLANK':
    case 'SHORT_ANSWER':
      // Randomly select a display variation for fill-in-the-blank questions
      // Variations: standard, paragraph, bullets, headings, note_style
      const fillVariations = ['standard', 'paragraph', 'bullets', 'headings', 'note_style'];
      const selectedVariation = fillVariations[Math.floor(Math.random() * fillVariations.length)];
      
      // Randomly select word limit (1, 2, or 3 words)
      const wordLimitOptions = [1, 2, 3];
      const selectedWordLimit = wordLimitOptions[Math.floor(Math.random() * wordLimitOptions.length)];
      const wordLimitText = selectedWordLimit === 1 ? 'ONE WORD ONLY' : 
                            selectedWordLimit === 2 ? 'NO MORE THAN TWO WORDS' : 
                            'NO MORE THAN THREE WORDS';
      
      let variationInstructions = '';
      let variationFormat = '';
      
      if (selectedVariation === 'paragraph') {
        variationInstructions = `
   - Format the questions as a flowing paragraph with blanks numbered in parentheses
   - The paragraph should be a coherent summary of part of the passage`;
        variationFormat = `
  "display_options": {
    "display_as_paragraph": true,
    "paragraph_text": "The study found that (1) _____ was the primary factor, which led to (2) _____ in the region. Researchers concluded that (3) _____ would be necessary..."
  },`;
      } else if (selectedVariation === 'bullets') {
        variationInstructions = `
   - Format each question as a bullet point item`;
        variationFormat = `
  "display_options": {
    "show_bullets": true
  },`;
      } else if (selectedVariation === 'headings') {
        variationInstructions = `
   - Group questions under 2-3 thematic headings based on the passage content
   - Each question should have a "heading" field indicating which heading it belongs to`;
        variationFormat = `
  "display_options": {
    "show_headings": true,
    "group_title": "Summary of Key Points"
  },`;
      } else if (selectedVariation === 'note_style') {
        variationInstructions = `
   - Format as note-taking style with categories
   - Group questions into 2-3 note categories
   - Each category has a title and list of items with blanks`;
        variationFormat = `
  "display_options": {
    "note_style_enabled": true,
    "note_categories": [
      {
        "title": "Main Findings",
        "items": [
          {"text_before": "Primary cause:", "question_number": 1, "text_after": ""},
          {"text_before": "Effect on population:", "question_number": 2, "text_after": ""}
        ]
      }
    ]
  },`;
      } else {
        variationFormat = `
  "display_options": {},`;
      }
      
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank/sentence completion questions.

CRITICAL WORD LIMIT RULE - STRICTLY ENFORCED:
- Maximum word limit: ${selectedWordLimit} word(s) per answer
- Every answer MUST be ${selectedWordLimit === 1 ? 'exactly 1 word' : selectedWordLimit === 2 ? '1 or 2 words (never 3+)' : '1, 2, or 3 words (never 4+)'}
- NEVER exceed the word limit - this violates IELTS standards
- If word limit is 3, vary lengths naturally: some 1-word, some 2-word, some 3-word answers
- If word limit is 2, use mix of 1-word and 2-word answers
- If word limit is 1, ALL answers must be exactly 1 word${variationInstructions}

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the sentences below. Choose ${wordLimitText} from the passage for each answer.",${variationFormat}
  "questions": [
    {
      "question_number": 1,
      "question_text": "According to the passage, the main cause of _____ is pollution.",
      "correct_answer": "${selectedWordLimit === 1 ? 'pollution' : selectedWordLimit === 2 ? 'climate change' : 'global climate change'}",
      "explanation": "Found in paragraph A: 'the main cause of climate change is pollution'"${selectedVariation === 'headings' ? ',\n      "heading": "Environmental Impact"' : ''}
    }
  ]
}`;

    case 'SENTENCE_COMPLETION':
      return basePrompt + `2. Create ${questionCount} sentence completion questions with a word bank.
   - Provide a list of words/phrases (options A-H) that test-takers must choose from
   - Each question is a sentence with a blank that must be completed using one of the given words
   - Provide more options than questions as distractors

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the sentences below. Choose the correct letter, A-H, from the list of words below.",
  "word_bank": [
    {"id": "A", "text": "technology"},
    {"id": "B", "text": "environment"},
    {"id": "C", "text": "research"},
    {"id": "D", "text": "education"},
    {"id": "E", "text": "climate"},
    {"id": "F", "text": "innovation"},
    {"id": "G", "text": "development"},
    {"id": "H", "text": "sustainability"}
  ],
  "questions": [
    {
      "question_number": 1,
      "question_text": "The main focus of the study was on _____.",
      "correct_answer": "A",
      "explanation": "The passage mentions technology as the main focus in paragraph B"
    },
    {
      "question_number": 2,
      "question_text": "Scientists emphasized the importance of _____ in modern society.",
      "correct_answer": "F",
      "explanation": "Innovation is discussed as crucial in paragraph C"
    }
  ]
}`;

    case 'TABLE_COMPLETION':
      return basePrompt + `2. Create a table completion task with ${questionCount} blanks to fill.

CRITICAL RULES - FOLLOW EXACTLY:
1. WORD LIMIT: Maximum TWO words per answer. STRICTLY ENFORCED.
   - Every answer MUST be 1 or 2 words maximum
   - NEVER use 3+ word answers - this violates IELTS standards
   - Vary the lengths naturally: mix of 1-word and 2-word answers
   - Example valid answers: "pollution" (1 word), "water supply" (2 words)
   - Example INVALID: "clean water supply" (3 words - NEVER DO THIS)
2. Tables MUST have EXACTLY 3 COLUMNS (no more, no less).
3. Use inline blanks with __ (double underscores) within cell content, NOT separate cells for blanks.
   - Example: "Clean air and water, pollination of crops, and __" where __ is the blank
4. DISTRIBUTE blanks across BOTH column 2 AND column 3. Do NOT put all blanks only in column 2.
   - Alternate between putting blanks in the 2nd column and the 3rd column
   - At least 1/3 of blanks MUST be in the 3rd column

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the table below. Choose NO MORE THAN TWO WORDS from the passage for each answer.",
  "table_data": [
    [{"content": "Category", "is_header": true}, {"content": "Details", "is_header": true}, {"content": "Impact", "is_header": true}],
    [{"content": "First item"}, {"content": "Description text and __", "has_question": true, "question_number": 1}, {"content": "Positive effect"}],
    [{"content": "Second item"}, {"content": "More text here"}, {"content": "Results in __", "has_question": true, "question_number": 2}],
    [{"content": "Third item"}, {"content": "Additional info about __", "has_question": true, "question_number": 3}, {"content": "Significant"}]
  ],
  "questions": [
    {"question_number": 1, "question_text": "Fill in blank 1", "correct_answer": "resources", "explanation": "Found in paragraph B"},
    {"question_number": 2, "question_text": "Fill in blank 2", "correct_answer": "water scarcity", "explanation": "Found in paragraph C"},
    {"question_number": 3, "question_text": "Fill in blank 3", "correct_answer": "deforestation", "explanation": "Found in paragraph D"}
  ]
}`;

    case 'FLOWCHART_COMPLETION':
      return basePrompt + `2. Create a flowchart completion task describing a process with ${questionCount} blanks.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text describing a process with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the flow chart below. Choose NO MORE THAN TWO WORDS from the passage for each answer.",
  "flowchart_title": "Process of...",
  "flowchart_steps": [
    {"id": "step1", "label": "First step: gathering materials", "isBlank": false},
    {"id": "step2", "label": "", "isBlank": true, "questionNumber": 1},
    {"id": "step3", "label": "Third step: processing", "isBlank": false},
    {"id": "step4", "label": "", "isBlank": true, "questionNumber": 2},
    {"id": "step5", "label": "Final step: completion", "isBlank": false}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Step 2", "correct_answer": "mixing ingredients", "explanation": "Found in paragraph B"},
    {"question_number": 2, "question_text": "Step 4", "correct_answer": "quality testing", "explanation": "Found in paragraph D"}
  ]
}`;

    case 'SUMMARY_COMPLETION':
    case 'SUMMARY_WORD_BANK':
      return basePrompt + `2. Create a summary completion task with a word bank.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the summary using the list of words, A-H, below.",
  "summary_text": "The passage discusses how {{1}} affects modern society. Scientists have found that {{2}} plays a crucial role in this process. Furthermore, {{3}} has been identified as a key factor.",
  "word_bank": [
    {"id": "A", "text": "technology"},
    {"id": "B", "text": "environment"},
    {"id": "C", "text": "research"},
    {"id": "D", "text": "education"},
    {"id": "E", "text": "climate"},
    {"id": "F", "text": "innovation"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Gap 1", "correct_answer": "A", "explanation": "Technology is discussed as affecting society"},
    {"question_number": 2, "question_text": "Gap 2", "correct_answer": "C", "explanation": "Research is mentioned as crucial"},
    {"question_number": 3, "question_text": "Gap 3", "correct_answer": "E", "explanation": "Climate is identified as key factor"}
  ]
}`;

    case 'MATCHING_SENTENCE_ENDINGS':
      return basePrompt + `2. Create ${questionCount} matching sentence endings questions.
   - Provide more endings than questions as distractors

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete each sentence with the correct ending, A-G, below.",
  "sentence_beginnings": [
    {"number": 1, "text": "Scientists discovered that"},
    {"number": 2, "text": "The research team found that"},
    {"number": 3, "text": "Experts believe that"}
  ],
  "sentence_endings": [
    {"id": "A", "text": "pollution has increased significantly."},
    {"id": "B", "text": "new methods are needed."},
    {"id": "C", "text": "the results were unexpected."},
    {"id": "D", "text": "further study is required."},
    {"id": "E", "text": "improvements can be made."}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Scientists discovered that", "correct_answer": "C", "explanation": "The passage states..."},
    {"question_number": 2, "question_text": "The research team found that", "correct_answer": "A", "explanation": "Found in paragraph B..."}
  ]
}`;

    case 'MAP_LABELING':
      return basePrompt + `2. Create a map/diagram labeling task with ${questionCount} labels to identify.
   - The passage should describe locations or parts of a place/facility in detail
   - Each question asks which labeled area (A, B, C, etc.) matches a description
   - IMPORTANT: The passage MUST clearly state which label corresponds to which location
   - Make sure answers are definitively correct based on the passage content
   - CRITICAL: DO NOT make answers sequential (e.g., Q1=A, Q2=B, Q3=C is WRONG)
   - RANDOMIZE the correct answers across questions (e.g., Q1=D, Q2=A, Q3=F, Q4=B)
   - Questions should ask about locations in a non-sequential order relative to their labels

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text describing a location. Example: 'The reception area, labeled A on the map, is the first stop for visitors. The computer lab, marked as C, provides internet access. Study rooms are designated as B and offer quiet spaces. The café, marked D, serves refreshments.'"
  },
  "instruction": "Label the map below. Choose the correct letter, A-H.",
  "map_description": "A floor plan of a library showing: reception (A), study rooms (B), computer lab (C), café (D), meeting rooms (E), quiet zone (F), children's section (G), magazine area (H)",
  "map_labels": [
    {"id": "A", "text": "Reception"},
    {"id": "B", "text": "Study Rooms"},
    {"id": "C", "text": "Computer Lab"},
    {"id": "D", "text": "Café"},
    {"id": "E", "text": "Meeting Rooms"},
    {"id": "F", "text": "Quiet Zone"},
    {"id": "G", "text": "Children's Section"},
    {"id": "H", "text": "Magazine Area"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Where can visitors access the internet?", "correct_answer": "C", "explanation": "The passage states 'The computer lab, marked as C, provides internet access.'"},
    {"question_number": 2, "question_text": "Where should visitors go first when entering?", "correct_answer": "A", "explanation": "The passage states 'The reception area, labeled A on the map, is the first stop for visitors.'"},
    {"question_number": 3, "question_text": "Where can visitors get food or drinks?", "correct_answer": "D", "explanation": "The passage states 'The café, marked D, serves refreshments.'"},
    {"question_number": 4, "question_text": "Where are the quiet study spaces located?", "correct_answer": "B", "explanation": "The passage states 'Study rooms are designated as B and offer quiet spaces.'"}
  ]
}`;

    case 'NOTE_COMPLETION':
      return basePrompt + `2. Create a note completion task with ${questionCount} blanks.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the notes below. Choose NO MORE THAN TWO WORDS from the passage for each answer.",
  "note_sections": [
    {
      "title": "Main Topic",
      "items": [
        {"text_before": "The primary cause is", "question_number": 1, "text_after": ""},
        {"text_before": "This leads to", "question_number": 2, "text_after": "in urban areas"}
      ]
    }
  ],
  "questions": [
    {"question_number": 1, "question_text": "Note 1", "correct_answer": "pollution", "explanation": "Found in paragraph A"},
    {"question_number": 2, "question_text": "Note 2", "correct_answer": "health problems", "explanation": "Found in paragraph B"}
  ]
}`;

    default:
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions based on the passage.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the sentences below using words from the passage.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Complete this sentence: _____",
      "correct_answer": "the answer",
      "explanation": "Why this is correct"
    }
  ]
}`;
  }
}

// Listening question type prompts
function getListeningPrompt(
  questionType: string, 
  topic: string, 
  difficulty: string, 
  questionCount: number, 
  scenario: any,
  listeningConfig?: ListeningConfig
): string {
  const difficultyDesc = difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8';
  
  // Determine transcript specifications based on config
  // Default: ~225 words (~90 seconds of audio)
  let targetWordCount = listeningConfig?.wordCount || 225;
  let targetDurationSeconds = listeningConfig?.durationSeconds || 90;
  
  // If using word count mode, estimate duration (150 words/minute)
  if (listeningConfig?.useWordCountMode && listeningConfig.wordCount) {
    targetWordCount = listeningConfig.wordCount;
    targetDurationSeconds = Math.round((targetWordCount / 150) * 60);
  } else if (!listeningConfig?.useWordCountMode && listeningConfig?.durationSeconds) {
    // If using duration mode, estimate word count
    targetDurationSeconds = listeningConfig.durationSeconds;
    targetWordCount = Math.round((targetDurationSeconds / 60) * 150);
  }
  
  // Clamp to safe limits (max ~1200 words / 480 seconds = 8 minutes at 85% of Gemini capacity)
  targetWordCount = Math.min(1200, Math.max(100, targetWordCount));
  targetDurationSeconds = Math.min(480, Math.max(30, targetDurationSeconds));
  
  const wordRange = `${targetWordCount - 30}-${targetWordCount + 30}`;

  // Determine if we use 1 or 2 speakers based on config
  const useTwoSpeakers = listeningConfig?.speakerConfig?.useTwoSpeakers !== false;

  // Build prompt for realistic character names
  const characterInstructions = useTwoSpeakers
    ? `1. Create a dialogue script between two characters that is:
   - ${wordRange} words total (approximately ${targetDurationSeconds} seconds when spoken)
   - Natural and conversational with realistic names/roles (e.g., "Receptionist", "Mark", "Dr. Smith", "Sarah")
   - In the output JSON dialogue field, you MUST use "Speaker1:" and "Speaker2:" prefixes for TTS processing
   - ALSO include a "speaker_names" object in your JSON that maps Speaker1/Speaker2 to their real names
   - Contains specific details (names, numbers, dates, locations)
   
   CRITICAL OUTPUT FORMAT:
   - dialogue: Use "Speaker1:" and "Speaker2:" prefixes (required for audio generation)
   - speaker_names: {"Speaker1": "Real Name or Role", "Speaker2": "Real Name or Role"}
   - Example: speaker_names: {"Speaker1": "Sarah", "Speaker2": "Receptionist"}`
    : `1. Create a monologue script by a single speaker that is:
   - ${wordRange} words total (approximately ${targetDurationSeconds} seconds when spoken)
   - Clear and informative, like a tour guide, lecturer, or announcer
   - Use "Speaker1:" prefix for all lines (required for TTS)
   - ALSO include a "speaker_names" object: {"Speaker1": "Appropriate Role/Title"}
   - Example: speaker_names: {"Speaker1": "Tour Guide"} or {"Speaker1": "Professor Williams"}
   - Contains specific details (names, numbers, dates, locations)`;

  const basePrompt = `Generate an IELTS Listening test section with the following specifications:

Topic: ${topic}
Scenario: ${scenario.description}
Difficulty: ${difficulty} (${difficultyDesc})

Requirements:
${characterInstructions}

`;

  // Handle FILL_IN_BLANK with optional Spelling Mode or Monologue Mode
  if (questionType === 'FILL_IN_BLANK') {
    const spellingMode = listeningConfig?.spellingMode;
    const isMonologue = listeningConfig?.monologueMode === true;
    
    // Monologue mode (IELTS Part 4 style) - single speaker, no spelling
    if (isMonologue) {
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions in IELTS Part 4 monologue style.

CRITICAL RULES FOR MONOLOGUE MODE:
- This is a SINGLE SPEAKER monologue (like a lecture, tour guide, or presentation)
- Use "Speaker1:" prefix for ALL lines (required for TTS)
- NO spelling of names - the listener must infer from context
- Names should NOT be given as blanks UNLESS the speaker explicitly spells them out
- Blanks should contain common nouns, dates, numbers, or descriptive phrases - NOT proper names

CRITICAL BLANK POSITIONING:
- VARY the position of blanks in sentences - do NOT always put them at the end
- Use a mix of these patterns across questions:
  - Start of sentence: "_____ is the most important factor in..."
  - Middle of sentence: "The main attraction, called _____, was built in..."
  - End of sentence: "The building was completed in _____."
- Each question MUST have the blank ("_____") positioned RANDOMLY - approximately 1/3 at start, 1/3 in middle, 1/3 at end

ANSWER VARIETY:
- IMPORTANT: Vary answer lengths - use ONE word, TWO words, or THREE words AND/OR a number
- Some answers should be exactly 1 word (e.g., "Tuesday", "registration")
- Some answers should be exactly 2 words (e.g., "next Monday", "room three")
- Some answers can be 3 words (e.g., "main conference hall")
- Numbers are acceptable answers: "1985", "15", "222"
- Maximum allowed is 3 words AND/OR a number

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Welcome to today's lecture on ancient architecture...\\nSpeaker1: The technique, known as barrel vaulting, was first developed...\\nSpeaker1: Our main focus today will be on three important structures...",
  "speaker_names": {"Speaker1": "Professor Williams"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "_____ was the primary building material used.",
      "correct_answer": "Limestone",
      "explanation": "Speaker mentions limestone as the primary material"
    },
    {
      "question_number": 2,
      "question_text": "The construction method, called _____, required special skills.",
      "correct_answer": "barrel vaulting",
      "explanation": "Speaker names barrel vaulting as the construction method"
    },
    {
      "question_number": 3,
      "question_text": "The temple was completed in _____.",
      "correct_answer": "450 BC",
      "explanation": "Speaker states the completion date"
    }
  ]
}`;
    }
    
    if (spellingMode?.enabled) {
      // IELTS Part 1 Style with spelling/number patterns
      const scenarioMap = {
        phone_call: 'a phone call inquiry (e.g., booking service, requesting information)',
        hotel_booking: 'a hotel reservation phone call',
        job_inquiry: 'a job application or recruitment inquiry call',
      };
      const difficultyDesc = spellingMode.spellingDifficulty === 'high' 
        ? 'unusual or foreign-sounding names (e.g., "Cholmondeley", "Ankita Sharma")' 
        : 'common but still spellings required names (e.g., "Thompson", "Catherine")';
      const numberDesc = spellingMode.numberFormat === 'phone_number' 
        ? 'phone numbers using "double" or "triple" patterns (e.g., "double seven, five, nine")' 
        : spellingMode.numberFormat === 'date' 
        ? 'dates (e.g., "the fifteenth of March")' 
        : 'postcodes with letters and numbers mixed (e.g., "SW1A 1AA")';
      
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions in IELTS Part 1 style.

CRITICAL SPELLING & NUMBER RULES:
- The dialogue MUST be ${scenarioMap[spellingMode.testScenario]}.
- For at least one blank, the speaker MUST SPELL OUT the answer letter-by-letter using dashes.
- IMPORTANT SPELLING RULE: Only spell the part that appears IN THE BLANK, not the part already visible in the question text.
  - Example: If question is "Name: Dr. ____ Reed", and full name is "Evelyn Reed", spell "Evelyn" (E-V-E-L-Y-N) NOT "Reed"
  - The blank should contain what needs to be written, so spell ONLY that missing word/name
- CRITICAL: Names should only be blank answers if they are SPELLED OUT by a speaker. If not spelled, use common nouns instead.
- Use ${difficultyDesc} for names.
- Include ${numberDesc} for number-based gaps.
- Create realistic "distractor and correction" patterns (e.g., "Oh wait, it's 4, not 5").

CRITICAL BLANK POSITIONING:
- VARY the position of blanks in sentences - do NOT always put them at the end
- Use a mix of these patterns across questions:
  - Start/Label style: "Name: _____" or "Address: _____"
  - Middle of phrase: "The booking is for _____ on Tuesday"
  - End of phrase: "The postcode is _____"

ANSWER VARIETY:
- IMPORTANT: Vary answer lengths - use ONE word, TWO words, or THREE words AND/OR numbers:
  - Some answers should be exactly 1 word (e.g., "Tuesday", "Sharma")
  - Some answers should be exactly 2 words (e.g., "next Monday", "room three")
  - Some answers can be 3 words (e.g., "conference room B")
  - Numbers are acceptable: "222", "15", "March 5th"
  - Maximum allowed is 3 words AND/OR a number

CRITICAL FOR NUMBER ANSWERS:
- When numbers are spoken as "triple two" or "double seven", the CORRECT ANSWER must be the NUMERIC form (e.g., "222" or "77")
- Both "222" and "triple two" should be considered correct (put the numeric form as correct_answer)

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Hello, I'd like to book an appointment...\\nSpeaker2: Certainly, can I take your name please?\\nSpeaker1: Yes, it's Dr. Evelyn Reed. Evelyn is spelled E-V-E-L-Y-N.\\nSpeaker2: Thank you. And your phone number?\\nSpeaker1: It's oh-seven-seven, triple two, five, nine.",
  "speaker_names": {"Speaker1": "Dr. Evelyn Reed", "Speaker2": "Receptionist"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Doctor's first name: _____",
      "correct_answer": "Evelyn",
      "explanation": "Speaker1 spells out E-V-E-L-Y-N for Evelyn (the blank portion)"
    },
    {
      "question_number": 2,
      "question_text": "Phone number last three digits: _____",
      "correct_answer": "259",
      "explanation": "Speaker says 'five, nine' for the last digits"
    }
  ]
}`;
    }
    
    // Standard Fill-in-Blank (no spelling mode, dialogue with two speakers)
    return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions.

CRITICAL RULES FOR STANDARD FILL-IN-BLANK:
- Names should NOT be given as blanks UNLESS the speaker explicitly spells them out letter by letter
- If a name is mentioned but NOT spelled, do NOT make it a blank answer
- Blanks should contain common nouns, dates, numbers, locations, or descriptive phrases

CRITICAL BLANK POSITIONING:
- VARY the position of blanks in sentences - do NOT always put them at the end
- Use a mix of these patterns across questions:
  - Start of sentence: "_____ is required for registration."
  - Middle of sentence: "The session on _____ will be held in Room 3."
  - End of sentence: "The museum was founded in _____."
- Approximately 1/3 of blanks should be at the start, 1/3 in the middle, and 1/3 at the end

ANSWER VARIETY:
- IMPORTANT: Vary answer lengths - use ONE word, TWO words, or THREE words AND/OR a number
- Some answers should be exactly 1 word (e.g., "Tuesday", "registration")
- Some answers should be exactly 2 words (e.g., "next Monday", "room three")
- Some answers can be 3 words (e.g., "main conference hall")
- Numbers are acceptable answers: "1985", "15", "222"
- Maximum allowed is 3 words AND/OR a number, but do NOT make all answers the same length

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Hello, welcome to the museum...\\nSpeaker2: Thank you...",
  "speaker_names": {"Speaker1": "Tour Guide", "Speaker2": "Visitor"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "_____ is the most popular exhibit.",
      "correct_answer": "Ancient pottery",
      "explanation": "Speaker1 mentions ancient pottery as most popular"
    },
    {
      "question_number": 2,
      "question_text": "The guided tour starts at _____.",
      "correct_answer": "10:30",
      "explanation": "Speaker1 says the tour starts at 10:30"
    },
    {
      "question_number": 3,
      "question_text": "Visitors need a _____ to enter the special exhibition.",
      "correct_answer": "membership card",
      "explanation": "Speaker2 mentions membership card is required"
    }
  ]
}`;
  }

  switch (questionType) {
    case 'TABLE_COMPLETION':
      return basePrompt + `2. Create a table completion task with ${questionCount} blanks.

CRITICAL RULES:
1. Tables MUST have EXACTLY 3 COLUMNS (no more, no less).
2. Use inline blanks with __ (double underscores) within cell content.
   - Example: "Morning session starts with __" where __ is the blank
3. DISTRIBUTE blanks across BOTH column 2 AND column 3. Do NOT put all blanks only in one column.
4. Answer length MUST VARY - use ONE word, TWO words, or THREE words AND/OR a number:
   - Some answers should be exactly 1 word (e.g., "registration")
   - Some answers should be exactly 2 words (e.g., "coffee break")
   - Some answers can be 3 words (e.g., "main conference room")
   - Numbers are acceptable: "15", "9:30", "1985"
   - Maximum allowed is 3 words AND/OR a number, but do NOT make all answers the same length

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Let me explain the schedule...\\nSpeaker2: Yes, please...",
  "speaker_names": {"Speaker1": "Tour Guide", "Speaker2": "Visitor"},
  "instruction": "Complete the table below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "table_data": [
    [{"content": "Time", "is_header": true}, {"content": "Activity", "is_header": true}, {"content": "Location", "is_header": true}],
    [{"content": "9:00 AM"}, {"content": "Session starts with __", "has_question": true, "question_number": 1}, {"content": "Main Hall"}],
    [{"content": "11:00 AM"}, {"content": "Break time"}, {"content": "Held in __", "has_question": true, "question_number": 2}]
  ],
  "questions": [
    {"question_number": 1, "question_text": "Activity at 9 AM", "correct_answer": "registration", "explanation": "Speaker mentions registration at 9"},
    {"question_number": 2, "question_text": "Location at 11 AM", "correct_answer": "main conference room", "explanation": "Main conference room mentioned for 11 AM"}
  ]
}`;

    case 'MULTIPLE_CHOICE_SINGLE':
      return basePrompt + `2. Create ${questionCount} multiple choice questions (single answer).

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: The conference will focus on...\\nSpeaker2: That sounds interesting...",
  "speaker_names": {"Speaker1": "Professor Smith", "Speaker2": "Student"},
  "instruction": "Choose the correct letter, A, B, or C.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "What is the main topic of the conference?",
      "options": ["A Environmental issues", "B Technology trends", "C Economic policies"],
      "correct_answer": "B",
      "explanation": "Speaker1 explicitly mentions technology trends"
    }
  ]
}`;

    case 'MULTIPLE_CHOICE_MULTIPLE':
      // For MCQ Multiple, we create ONE question "set" where test-takers must pick N answers.
      // questionCount here represents the number of answers to select (e.g., 2 or 3)
      const numMCQAnswers = Math.min(questionCount, 3); // Cap at 3 to keep it reasonable
      const mcqAnswerWord = numMCQAnswers === 2 ? 'TWO' : numMCQAnswers === 3 ? 'THREE' : String(numMCQAnswers);

      return basePrompt + `2. Create ONE multiple choice question where listeners must select ${mcqAnswerWord} correct answers from the options.

IMPORTANT:
- The question group spans ${numMCQAnswers} question numbers: 1 to ${numMCQAnswers}
- Return ${numMCQAnswers} question objects with question_number 1..${numMCQAnswers}
- ALL question objects must have the SAME question_text, SAME options, SAME correct_answer, SAME explanation
- The correct_answer must be a comma-separated list of ${numMCQAnswers} letters (e.g., "B,D" or "A,C,E")
- DO NOT always use the same letters - randomize which options are correct
- Provide 5-6 options total so there are distractors

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: There are several benefits to our new system...\\nSpeaker2: Can you tell me more about them?...",
  "speaker_names": {"Speaker1": "Manager", "Speaker2": "Employee"},
  "instruction": "Questions 1-${numMCQAnswers}. Choose ${mcqAnswerWord} letters, A-E.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Which ${mcqAnswerWord} benefits are mentioned by the speaker?",
      "options": ["A Cost savings", "B Time efficiency", "C Better quality", "D More flexibility", "E Improved safety"],
      "correct_answer": "B,D",
      "explanation": "B is correct because time efficiency is explicitly mentioned. D is correct because flexibility is discussed.",
      "max_answers": ${numMCQAnswers}
    },
    {
      "question_number": ${numMCQAnswers},
      "question_text": "Which ${mcqAnswerWord} benefits are mentioned by the speaker?",
      "options": ["A Cost savings", "B Time efficiency", "C Better quality", "D More flexibility", "E Improved safety"],
      "correct_answer": "B,D",
      "explanation": "B is correct because time efficiency is explicitly mentioned. D is correct because flexibility is discussed.",
      "max_answers": ${numMCQAnswers}
    }
  ]
}`;

    case 'MATCHING_CORRECT_LETTER':
      return basePrompt + `2. Create ${questionCount} matching questions where listeners match items to categories.

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Let me describe each option...\\nSpeaker2: Yes, I need to choose...",
  "speaker_names": {"Speaker1": "Advisor", "Speaker2": "Client"},
  "instruction": "What does the speaker say about each item? Choose the correct letter, A-C.",
  "options": ["A Recommended", "B Not recommended", "C Depends on situation"],
  "questions": [
    {
      "question_number": 1,
      "question_text": "Online courses",
      "correct_answer": "A",
      "explanation": "Speaker recommends online courses"
    }
  ]
}`;

    case 'FLOWCHART_COMPLETION':
      return basePrompt + `2. Create a flowchart completion task about a process with ${questionCount} blanks.

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Let me explain the process...\\nSpeaker2: Please go ahead...",
  "speaker_names": {"Speaker1": "HR Manager", "Speaker2": "Applicant"},
  "instruction": "Complete the flow chart below. Write NO MORE THAN TWO WORDS for each answer.",
  "flowchart_title": "Process of Application",
  "flowchart_steps": [
    {"id": "step1", "label": "Submit form online", "isBlank": false},
    {"id": "step2", "label": "", "isBlank": true, "questionNumber": 1},
    {"id": "step3", "label": "Attend interview", "isBlank": false}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Step 2", "correct_answer": "pay fee", "explanation": "Speaker mentions paying the fee after submission"}
  ]
}`;

    case 'DRAG_AND_DROP_OPTIONS':
      // Ensure we always have more options than questions (at least 2 extra distractor options)
      const dragOptionCount = Math.max(questionCount + 2, 5);
      return basePrompt + `2. Create ${questionCount} drag-and-drop questions with ${dragOptionCount} draggable options.

CRITICAL RULES:
- You MUST provide EXACTLY ${dragOptionCount} drag_options (more options than questions - some are distractors).
- Each question MUST include a drop zone indicated by 2+ consecutive underscores (e.g., "____").
- Use this exact pattern in question_text so the UI can render a drop box:
  "<Item> ____ ." or "Drop answer ____ here." (must contain "____").
- The draggable options MUST be provided via drag_options.

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Each department has different responsibilities...\\nSpeaker2: I see...",
  "speaker_names": {"Speaker1": "Department Head", "Speaker2": "New Employee"},
  "instruction": "Match each person to their responsibility. Drag the correct option to each box.",
  "drag_options": ["Managing budget", "Training staff", "Customer service", "Quality control", "Marketing", "Scheduling", "Research"],
  "questions": [
    {"question_number": 1, "question_text": "John ____ .", "correct_answer": "Managing budget", "explanation": "John is responsible for budget"},
    {"question_number": 2, "question_text": "Sarah ____ .", "correct_answer": "Training staff", "explanation": "Sarah handles training"}
  ]
}`;

    case 'MAP_LABELING':
      return basePrompt + `2. Create a map labeling task with ${questionCount} locations to identify.

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Let me show you around the campus...\\nSpeaker2: Great, where is everything?...",
  "speaker_names": {"Speaker1": "Campus Guide", "Speaker2": "New Student"},
  "instruction": "Label the map below. Write the correct letter, A-F.",
  "map_description": "A campus map showing: Library (A), Science Building (B), Sports Center (C), Cafeteria (D), Administration (E), Parking (F)",
  "map_labels": [
    {"id": "A", "text": "Library"},
    {"id": "B", "text": "Science Building"},
    {"id": "C", "text": "Sports Center"},
    {"id": "D", "text": "Cafeteria"},
    {"id": "E", "text": "Administration"},
    {"id": "F", "text": "Parking"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Where can students borrow books?", "correct_answer": "A", "explanation": "The library is mentioned for books"},
    {"question_number": 2, "question_text": "Where are sports facilities?", "correct_answer": "C", "explanation": "Sports Center has the facilities"}
  ]
}`;

    case 'NOTE_COMPLETION':
      return basePrompt + `2. Create a note completion task with ${questionCount} blanks organized in categories.
   - IMPORTANT: Vary answer lengths - use ONE word, TWO words, or THREE words AND/OR a number
   - Maximum allowed is 3 words AND/OR a number, but do NOT make all answers the same length

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: Let me explain the key points...\\nSpeaker2: Please go ahead...",
  "speaker_names": {"Speaker1": "Lecturer", "Speaker2": "Moderator"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "note_sections": [
    {
      "title": "Main Topic",
      "items": [
        {"text_before": "The primary focus is on", "question_number": 1, "text_after": ""},
        {"text_before": "This relates to", "question_number": 2, "text_after": "in modern contexts"}
      ]
    },
    {
      "title": "Key Details",
      "items": [
        {"text_before": "The main benefit includes", "question_number": 3, "text_after": ""}
      ]
    }
  ],
  "questions": [
    {"question_number": 1, "question_text": "Note 1", "correct_answer": "research methods", "explanation": "Speaker mentions research methods"},
    {"question_number": 2, "question_text": "Note 2", "correct_answer": "practical applications", "explanation": "Related to practical use"},
    {"question_number": 3, "question_text": "Note 3", "correct_answer": "significant cost savings", "explanation": "Benefits discussed"}
  ]
}`;

    default:
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions.
   - Each question MUST include a blank indicated by 2+ underscores (e.g., "_____") where the answer goes.
   - IMPORTANT: Vary answer lengths - use ONE word, TWO words, or THREE words AND/OR a number
   - Maximum allowed is 3 words AND/OR a number, but do NOT make all answers the same length

Return ONLY valid JSON (no markdown code blocks) in this exact format:
{
  "dialogue": "Speaker1: dialogue...\\nSpeaker2: response...",
  "speaker_names": {"Speaker1": "Host", "Speaker2": "Guest"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "The event takes place in _____.",
      "correct_answer": "the main garden",
      "explanation": "Speaker mentions the main garden location"
    }
  ]
}`;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting generate-ai-practice function");
    
    // Auth
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get API key
    const { data: secretData } = await supabaseClient
      .from('user_secrets')
      .select('encrypted_value')
      .eq('user_id', user.id)
      .eq('secret_name', 'GEMINI_API_KEY')
      .single();

    if (!secretData) {
      return new Response(JSON.stringify({ 
        error: 'Gemini API key not found. Please add your API key in Settings.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appEncryptionKey = Deno.env.get('app_encryption_key');
    if (!appEncryptionKey) throw new Error('Encryption key not configured');
    
    const geminiApiKey = await decryptApiKey(secretData.encrypted_value, appEncryptionKey);

    // Parse request
    const { module, questionType, difficulty, topicPreference, questionCount, timeMinutes, readingConfig, listeningConfig } = await req.json();
    
    const topic = topicPreference || IELTS_TOPICS[Math.floor(Math.random() * IELTS_TOPICS.length)];
    const testId = crypto.randomUUID();

    console.log(`Generating ${module} test: ${questionType}, ${difficulty}, topic: ${topic}, questions: ${questionCount}`);
    if (readingConfig) {
      console.log(`Reading config: paragraphs=${readingConfig.paragraphCount}, words=${readingConfig.wordCount}, preset=${readingConfig.passagePreset}`);
    }
    if (listeningConfig) {
      console.log(`Listening config: duration=${listeningConfig.durationSeconds}s, words=${listeningConfig.wordCount}, preset=${listeningConfig.transcriptPreset}`);
    }

    if (module === 'reading') {
      // Generate Reading Test with specific question type prompt
      const readingPrompt = getReadingPrompt(questionType, topic, difficulty, questionCount, readingConfig);

      const result = await callGemini(geminiApiKey, readingPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: getLastGeminiError() }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonStr = extractJsonFromResponse(result);
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result?.substring(0, 500));
        return new Response(JSON.stringify({ error: 'Failed to parse generated content. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Build question group with proper structure
      const groupId = crypto.randomUUID();
      const passageId = crypto.randomUUID();

      // Build options based on question type
      let groupOptions: any = undefined;
      if (questionType === 'MATCHING_HEADINGS' && parsed.headings) {
        groupOptions = { headings: parsed.headings };
      } else if (questionType === 'MATCHING_INFORMATION' && parsed.options) {
        groupOptions = { options: parsed.options };
      } else if (questionType === 'MATCHING_SENTENCE_ENDINGS') {
        groupOptions = { 
          sentence_beginnings: parsed.sentence_beginnings,
          sentence_endings: parsed.sentence_endings 
        };
      } else if (questionType === 'SUMMARY_WORD_BANK' || questionType === 'SUMMARY_COMPLETION') {
        groupOptions = { 
          word_bank: parsed.word_bank,
          summary_text: parsed.summary_text 
        };
      } else if (questionType === 'SENTENCE_COMPLETION' && parsed.word_bank) {
        groupOptions = { 
          word_bank: parsed.word_bank,
          use_dropdown: true
        };
      } else if (questionType === 'FLOWCHART_COMPLETION') {
        // Generate flowchart image for reading tests
        let flowchartImageUrl: string | undefined;
        if (parsed.flowchart_steps) {
          console.log('Generating flowchart image for reading FLOWCHART_COMPLETION...');
          const flowchartImageData = await generateFlowchartImage(
            parsed.flowchart_title || 'Process Flowchart',
            parsed.flowchart_steps
          );
          if (flowchartImageData) {
            const uploadedUrl = await uploadGeneratedImage(supabaseClient, flowchartImageData, testId, 'ai-practice-flowcharts');
            if (uploadedUrl) {
              flowchartImageUrl = uploadedUrl;
            }
          }
        }
        groupOptions = { 
          flowchart_title: parsed.flowchart_title,
          flowchart_steps: parsed.flowchart_steps,
          imageUrl: flowchartImageUrl,
        };
      } else if (questionType === 'TABLE_COMPLETION') {
        groupOptions = { table_data: parsed.table_data };
      } else if (questionType === 'NOTE_COMPLETION') {
        groupOptions = { note_sections: parsed.note_sections };
      } else if (questionType === 'MAP_LABELING') {
        // Generate map image for reading tests
        let mapImageUrl: string | undefined;
        if (parsed.map_description && parsed.map_labels) {
          console.log('Generating map image for reading MAP_LABELING...');
          const mapImageData = await generateMapImage(parsed.map_description, parsed.map_labels);
          if (mapImageData) {
            const uploadedUrl = await uploadGeneratedImage(supabaseClient, mapImageData, testId, 'ai-practice-maps');
            if (uploadedUrl) {
              mapImageUrl = uploadedUrl;
            }
          }
        }
        groupOptions = { 
          map_description: parsed.map_description,
          map_labels: parsed.map_labels,
          imageUrl: mapImageUrl,
        };
      } else if (questionType.includes('MULTIPLE_CHOICE') && parsed.questions?.[0]?.options) {
        // For MCQ Multiple, store max_answers + option_format at GROUP level so UI + navigation can read it.
        if (questionType === 'MULTIPLE_CHOICE_MULTIPLE') {
          const maxAnswers = parsed.questions?.[0]?.max_answers || Math.min(questionCount, 3);
          groupOptions = {
            options: parsed.questions[0].options,
            max_answers: maxAnswers,
            option_format: parsed.questions?.[0]?.option_format || 'A',
          };
        } else {
          groupOptions = { options: parsed.questions[0].options };
        }
      } else if ((questionType === 'FILL_IN_BLANK' || questionType === 'SHORT_ANSWER') && parsed.display_options) {
        // Handle fill-in-blank display variations
        groupOptions = {
          ...parsed.display_options,
          paragraph_text: parsed.display_options?.paragraph_text,
        };
      }

      const questions = (() => {
        // Normalize MCQ Multiple as a single group spanning N question numbers.
        if (questionType === 'MULTIPLE_CHOICE_MULTIPLE') {
          const maxAnswers = (groupOptions as any)?.max_answers || Math.min(questionCount, 3);
          const first = parsed.questions?.[0] || {};
          const base = {
            question_text: first.question_text,
            correct_answer: first.correct_answer,
            explanation: first.explanation,
            options: first.options || null,
            heading: first.heading || null,
            table_data: parsed.table_data || null,
            max_answers: first.max_answers || maxAnswers,
          };

          return Array.from({ length: maxAnswers }, (_, i) => ({
            id: crypto.randomUUID(),
            question_number: i + 1,
            question_type: questionType,
            ...base,
          }));
        }

        return (parsed.questions || []).map((q: any, i: number) => ({
          id: crypto.randomUUID(),
          question_number: q.question_number || i + 1,
          question_text: q.question_text,
          question_type: questionType,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          options: q.options || null,
          heading: q.heading || null,
          table_data: parsed.table_data || null,
          max_answers: q.max_answers || undefined,
        }));
      })();

      return new Response(JSON.stringify({
        testId,
        topic,
        passage: {
          id: passageId,
          title: parsed.passage.title,
          content: parsed.passage.content,
          passage_number: 1,
        },
          questionGroups: [{
            id: groupId,
            instruction: parsed.instruction || `Questions 1-${questionCount}`,
            question_type: questionType,
            start_question: 1,
            end_question: questionType === 'MULTIPLE_CHOICE_MULTIPLE'
              ? ((groupOptions as any)?.max_answers || questions.length)
              : questions.length,
            options: groupOptions,
            questions: questions,
          }],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'listening') {
      // Generate Listening Test
      const scenario = LISTENING_SCENARIOS[Math.floor(Math.random() * LISTENING_SCENARIOS.length)];
      const listeningPrompt = getListeningPrompt(questionType, topic, difficulty, questionCount, scenario, listeningConfig);

      const result = await callGemini(geminiApiKey, listeningPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate listening test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonStr = extractJsonFromResponse(result);
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result?.substring(0, 500));
        return new Response(JSON.stringify({ error: 'Failed to parse generated content. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate audio with speaker configuration
      const audio = await generateAudio(geminiApiKey, parsed.dialogue, listeningConfig?.speakerConfig);
      
      // For listening tests, audio is required - return error if TTS failed
      if (!audio) {
        const ttsError = getLastTTSError();
        console.error('TTS generation failed for listening test:', ttsError);
        return new Response(JSON.stringify({ 
          error: `Audio generation failed: ${ttsError}`,
          errorType: 'TTS_FAILED',
          suggestion: 'Please check your Gemini API key quota or try again in a few minutes.'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Build group options based on question type
      let groupOptions: any = undefined;
      if (questionType === 'MATCHING_CORRECT_LETTER' && parsed.options) {
        groupOptions = { options: parsed.options, option_format: 'A' };
      } else if (questionType === 'TABLE_COMPLETION' && parsed.table_data) {
        groupOptions = { table_data: parsed.table_data };
      } else if (questionType === 'FLOWCHART_COMPLETION' && parsed.flowchart_steps) {
        // Map flowchart_steps to the format expected by FlowchartCompletion component
        // Component expects: steps[].text, steps[].hasBlank, steps[].blankNumber
        const steps = parsed.flowchart_steps.map((step: any) => ({
          text: step.label || step.text || '',
          hasBlank: step.isBlank || step.hasBlank || false,
          blankNumber: step.questionNumber || step.blankNumber,
          alignment: step.alignment || 'center',
        }));
        // Component also needs options array for drag-and-drop
        // Extract correct answers as the option pool + add distractors
        const correctAnswers = parsed.questions?.map((q: any) => q.correct_answer) || [];
        const distractors = ['Other option', 'Alternative choice']; // fallback distractors
        const flowchartOptions = [...new Set([...correctAnswers, ...distractors])];
        
        // Generate flowchart image using Lovable AI
        let flowchartImageUrl: string | undefined;
        console.log('Generating flowchart image for FLOWCHART_COMPLETION...');
        const flowchartImageData = await generateFlowchartImage(
          parsed.flowchart_title || 'Process Flowchart',
          parsed.flowchart_steps
        );
        if (flowchartImageData) {
          const uploadedUrl = await uploadGeneratedImage(supabaseClient, flowchartImageData, testId, 'ai-practice-flowcharts');
          if (uploadedUrl) {
            flowchartImageUrl = uploadedUrl;
          }
        }
        
        groupOptions = {
          title: parsed.flowchart_title,
          steps,
          options: flowchartOptions,
          option_format: 'A',
          imageUrl: flowchartImageUrl,
        };
      } else if (questionType === 'DRAG_AND_DROP_OPTIONS') {
        // UI expects group.options.options (array of strings) + option_format
        groupOptions = { options: parsed.drag_options || [], option_format: 'A' };
      } else if (questionType === 'MAP_LABELING') {
        // Generate map image using Lovable AI
        let mapImageUrl: string | undefined;
        if (parsed.map_description && parsed.map_labels) {
          console.log('Generating map image for MAP_LABELING...');
          const mapImageData = await generateMapImage(parsed.map_description, parsed.map_labels);
          if (mapImageData) {
            const uploadedUrl = await uploadGeneratedImage(supabaseClient, mapImageData, testId, 'ai-practice-maps');
            if (uploadedUrl) {
              mapImageUrl = uploadedUrl;
            }
          }
        }
        
        groupOptions = {
          map_description: parsed.map_description,
          map_labels: parsed.map_labels,
          imageUrl: mapImageUrl,
          // Add drop zones based on questions for visual placement
          dropZones: (parsed.questions || []).map((q: any, idx: number) => ({
            id: `zone-${q.question_number || idx + 1}`,
            questionNumber: q.question_number || idx + 1,
            x: 20 + (idx % 3) * 30, // Distribute across map
            y: 20 + Math.floor(idx / 3) * 25,
            width: 60,
            height: 30,
          })),
          options: parsed.map_labels?.map((l: any) => l.id) || [],
        };
      } else if (questionType === 'NOTE_COMPLETION' && parsed.note_sections) {
        // Map note_sections to noteCategories format expected by NoteStyleFillInBlank
        const noteCategories = parsed.note_sections.map((section: any) => ({
          label: section.title,
          items: (section.items || []).map((item: any) => ({
            text: item.text_before || '',
            hasBlank: true,
            suffixText: item.text_after || '',
            questionNumber: item.question_number,
          })),
        }));
        groupOptions = { 
          noteCategories, 
          display_mode: 'note_style' 
        };
      } else if (questionType === 'MULTIPLE_CHOICE_MULTIPLE' && parsed.questions?.[0]?.options) {
        // For MCQ Multiple, store max_answers + options at GROUP level matching reading approach
        const maxAnswers = parsed.questions?.[0]?.max_answers || Math.min(questionCount, 3);
        groupOptions = {
          options: parsed.questions[0].options,
          option_format: 'A',
          max_answers: maxAnswers,
        };
      } else if (questionType.includes('MULTIPLE_CHOICE') && parsed.questions?.[0]?.options) {
        groupOptions = { options: parsed.questions[0].options };
      }

      const groupId = crypto.randomUUID();

      // For DRAG_AND_DROP_OPTIONS, store correct answers as option LABELS (A/B/C...) to match UI answer values
      const dragOptionLabels = (groupOptions?.options || []).map((_: unknown, idx: number) => String.fromCharCode(65 + idx));
      const dragTextToLabel = new Map<string, string>();
      if (questionType === 'DRAG_AND_DROP_OPTIONS') {
        (groupOptions?.options || []).forEach((t: string, idx: number) => {
          dragTextToLabel.set(String(t).trim().toLowerCase(), dragOptionLabels[idx]);
        });
      }

      const questions = (parsed.questions || []).map((q: any, i: number) => {
        let correct = q.correct_answer;
        if (questionType === 'DRAG_AND_DROP_OPTIONS') {
          const asString = String(q.correct_answer ?? '').trim();
          const upper = asString.toUpperCase();
          // If Gemini already returned a label, keep it; otherwise map option text -> label
          if (upper.length === 1 && dragOptionLabels.includes(upper)) {
            correct = upper;
          } else {
            correct = dragTextToLabel.get(asString.toLowerCase()) || asString;
          }
        }

        return {
          id: crypto.randomUUID(),
          question_number: q.question_number || i + 1,
          question_text: q.question_text,
          question_type: questionType,
          correct_answer: correct,
          explanation: q.explanation,
          options: q.options || null,
          heading: q.heading || null,
          max_answers: q.max_answers || undefined,
        };
      });

      // Process transcript to replace Speaker1/Speaker2 with real names if available
      let displayTranscript = parsed.dialogue;
      const speakerNames = parsed.speaker_names || {};
      
      if (speakerNames.Speaker1 || speakerNames.Speaker2) {
        // Replace Speaker1/Speaker2 with actual names in transcript for display
        if (speakerNames.Speaker1) {
          displayTranscript = displayTranscript.replace(/Speaker1:/g, `${speakerNames.Speaker1}:`);
        }
        if (speakerNames.Speaker2) {
          displayTranscript = displayTranscript.replace(/Speaker2:/g, `${speakerNames.Speaker2}:`);
        }
      }

      // For MULTIPLE_CHOICE_MULTIPLE, end_question = start + max_answers - 1 (treat as ONE logical question with N selections)
      // This matches the reading implementation where MCMA is counted as covering N question "slots"
      let finalEndQuestion = questions.length;
      if (questionType === 'MULTIPLE_CHOICE_MULTIPLE') {
        const maxAnswers = groupOptions?.max_answers || Math.min(questionCount, 3);
        finalEndQuestion = maxAnswers; // e.g., "Choose TWO" = questions 1-2
      }

      return new Response(JSON.stringify({
        testId,
        topic,
        transcript: displayTranscript,
        speakerNames: speakerNames,
        audioBase64: audio?.audioBase64 || null,
        audioFormat: audio ? 'pcm' : null,
        sampleRate: audio?.sampleRate || null,
        questionGroups: [{
          id: groupId,
          instruction: parsed.instruction || `Questions 1-${finalEndQuestion}`,
          question_type: questionType,
          start_question: 1,
          end_question: finalEndQuestion,
          options: groupOptions,
          questions: questions.slice(0, 1), // For MCMA, only send ONE question object
        }],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'writing') {
      // Writing test generation (unchanged)
      const isTask1 = questionType === 'TASK_1';
      
      const writingPrompt = isTask1 
        ? `Generate an IELTS Academic Writing Task 1:\nTopic: ${topic}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON:\n{\n  "task_type": "task1",\n  "instruction": "The chart/graph below shows...",\n  "visual_description": "Description for image generation",\n  "visual_type": "bar chart"\n}`
        : `Generate an IELTS Academic Writing Task 2:\nTopic: ${topic}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON:\n{\n  "task_type": "task2",\n  "instruction": "The essay question..."\n}`;

      const result = await callGemini(geminiApiKey, writingPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate writing test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonStr = extractJsonFromResponse(result);
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result?.substring(0, 500));
        return new Response(JSON.stringify({ error: 'Failed to parse generated content. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        testId,
        topic,
        writingTask: {
          id: crypto.randomUUID(),
          task_type: isTask1 ? 'task1' : 'task2',
          instruction: parsed.instruction,
          image_description: parsed.visual_description,
          word_limit_min: isTask1 ? 150 : 250,
          word_limit_max: isTask1 ? 200 : 350,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'speaking') {
      // Speaking test generation (simplified)
      const speakingPrompt = `Generate IELTS Speaking test questions:\nTopic: ${topic}\nPart: ${questionType}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON with parts array containing questions.`;

      const result = await callGemini(geminiApiKey, speakingPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate speaking test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonStr = extractJsonFromResponse(result);
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result?.substring(0, 500));
        return new Response(JSON.stringify({ error: 'Failed to parse generated content. Please try again.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        testId,
        topic,
        speakingParts: parsed.parts?.map((p: any) => ({
          id: crypto.randomUUID(),
          part_number: p.part_number,
          instruction: p.instruction,
          questions: (p.questions || []).map((q: any) => ({
            id: crypto.randomUUID(),
            question_number: q.question_number,
            question_text: q.question_text,
            sample_answer: q.sample_answer,
          })),
          cue_card_topic: p.cue_card_topic,
          cue_card_content: p.cue_card_content,
          preparation_time_seconds: p.preparation_time_seconds,
          speaking_time_seconds: p.speaking_time_seconds,
          time_limit_seconds: p.time_limit_seconds,
        })) || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid module' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Edge Function error:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
