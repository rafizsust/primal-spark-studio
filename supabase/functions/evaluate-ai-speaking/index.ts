import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Gemini models in fallback order
const GEMINI_MODELS_FALLBACK_ORDER = [
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-pro-latest',
  'gemini-flash-latest',
  'gemini-2.0-flash',
];

interface PartAudio {
  partNumber: number;
  audioBase64: string;
  duration: number;
}

interface EvaluationRequest {
  testId: string;
  partAudios: PartAudio[];
  transcripts?: Record<number, string>;
  topic?: string;
  difficulty?: string;
  part2SpeakingDuration?: number;
  fluencyFlag?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appEncryptionKey = Deno.env.get('app_encryption_key');

    // Create client with user's auth
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: req.headers.get('Authorization')! },
      },
    });

    // Get user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's Gemini API key
    if (!appEncryptionKey) {
      return new Response(JSON.stringify({ 
        error: 'Server configuration error: encryption key not set.', 
        code: 'SERVER_CONFIG_ERROR' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userSecret, error: secretError } = await supabaseClient
      .from('user_secrets')
      .select('encrypted_value')
      .eq('user_id', user.id)
      .eq('secret_name', 'GEMINI_API_KEY')
      .single();

    if (secretError || !userSecret) {
      return new Response(JSON.stringify({ 
        error: 'Gemini API key not found. Please set it in Settings.', 
        code: 'API_KEY_NOT_FOUND' 
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decrypt Gemini API key
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const keyData = encoder.encode(appEncryptionKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData.slice(0, 32),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const encryptedBytes = Uint8Array.from(atob(userSecret.encrypted_value), c => c.charCodeAt(0));
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    const decryptedData = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext
    );
    const geminiApiKey = decoder.decode(decryptedData);

    // Parse request body
    const body: EvaluationRequest = await req.json();
    const { testId, partAudios, transcripts, topic, difficulty, part2SpeakingDuration, fluencyFlag } = body;

    console.log(`Evaluating AI speaking test ${testId} for user ${user.id}`);
    console.log(`Parts received: ${partAudios.length}`);
    if (fluencyFlag) {
      console.log(`Fluency flag active: Part 2 speaking duration was ${part2SpeakingDuration}s (under 80s threshold)`);
    }

    // Create service client for storage operations
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Upload audio files to storage
    const audioUrls: Record<number, string> = {};
    for (const part of partAudios) {
      try {
        const audioBytes = Uint8Array.from(atob(part.audioBase64), c => c.charCodeAt(0));
        const path = `ai-speaking/${user.id}/${testId}/part${part.partNumber}.webm`;
        
        const { error: uploadError } = await supabaseService.storage
          .from('speaking-audios')
          .upload(path, audioBytes, { contentType: 'audio/webm', upsert: true });

        if (!uploadError) {
          audioUrls[part.partNumber] = supabaseService.storage.from('speaking-audios').getPublicUrl(path).data.publicUrl;
        }
      } catch (err) {
        console.error(`Failed to upload Part ${part.partNumber} audio:`, err);
      }
    }

    // Build evaluation prompt
    const evaluationPrompt = buildEvaluationPrompt(transcripts, topic, difficulty, part2SpeakingDuration, fluencyFlag);
    const systemPrompt = getEvaluationSystemPrompt();

    // Call Gemini API with fallback models
    let evaluation: any = null;
    let usedModel: string | null = null;

    for (const modelName of GEMINI_MODELS_FALLBACK_ORDER) {
      console.log(`Attempting evaluation with Gemini model: ${modelName}`);
      const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;

      try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `${systemPrompt}\n\n${evaluationPrompt}` }]
            }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4096,
            }
          }),
        });

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.error(`Gemini ${modelName} error:`, errorText);
          if (geminiResponse.status === 429 || geminiResponse.status === 503) {
            continue; // Try next model
          }
          if (geminiResponse.status === 400 && errorText.includes('API_KEY')) {
            return new Response(JSON.stringify({ 
              error: 'Invalid Gemini API key. Please update it in Settings.',
              code: 'INVALID_API_KEY'
            }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          continue;
        }

        const data = await geminiResponse.json();
        const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
          console.error(`No response text from ${modelName}`);
          continue;
        }

        // Parse JSON from response
        evaluation = parseEvaluationResponse(responseText);
        if (evaluation) {
          usedModel = modelName;
          console.log(`Successfully evaluated with model: ${modelName}`);
          break;
        }
      } catch (err) {
        console.error(`Error with model ${modelName}:`, err);
        continue;
      }
    }

    if (!evaluation) {
      throw new Error('Failed to evaluate speaking test with any available model');
    }

    // Save to database using service client
    const { error: insertError } = await supabaseService.from('ai_practice_results').insert({
      user_id: user.id,
      test_id: testId,
      module: 'speaking',
      answers: transcripts || {},
      score: Math.round((evaluation.overallBand / 9) * 100),
      total_questions: partAudios.length,
      band_score: evaluation.overallBand,
      time_spent_seconds: partAudios.reduce((acc, p) => acc + p.duration, 0),
      question_results: evaluation,
      completed_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error('Failed to save result:', insertError);
    }

    return new Response(JSON.stringify({
      success: true,
      evaluation,
      audioUrls,
      usedModel
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Speaking Evaluation Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Evaluation failed';
    return new Response(JSON.stringify({ 
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parseEvaluationResponse(responseText: string): any {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // If no JSON found, try to parse structured data
    const evaluation: any = {
      overallBand: 0,
      fluencyCoherence: { score: 0, feedback: '', examples: [] },
      lexicalResource: { score: 0, feedback: '', examples: [], lexicalUpgrades: [] },
      grammaticalRange: { score: 0, feedback: '', examples: [] },
      pronunciation: { score: 0, feedback: '' },
      modelAnswers: [],
      summary: '',
      keyStrengths: [],
      priorityImprovements: []
    };

    // Extract overall band score
    const bandMatch = responseText.match(/overall[:\s]+(\d+\.?\d*)/i);
    if (bandMatch) {
      evaluation.overallBand = parseFloat(bandMatch[1]);
    }

    // Extract criterion scores
    const criteriaPatterns = [
      { key: 'fluencyCoherence', pattern: /fluency[^:]*:?\s*(\d+\.?\d*)/i },
      { key: 'lexicalResource', pattern: /lexical[^:]*:?\s*(\d+\.?\d*)/i },
      { key: 'grammaticalRange', pattern: /grammatical[^:]*:?\s*(\d+\.?\d*)/i },
      { key: 'pronunciation', pattern: /pronunciation[^:]*:?\s*(\d+\.?\d*)/i }
    ];

    for (const { key, pattern } of criteriaPatterns) {
      const match = responseText.match(pattern);
      if (match) {
        evaluation[key].score = parseFloat(match[1]);
      }
    }

    // If we found an overall band, consider it valid
    if (evaluation.overallBand > 0) {
      evaluation.summary = responseText.substring(0, 500);
      return evaluation;
    }

    return null;
  } catch (err) {
    console.error('Error parsing evaluation response:', err);
    return null;
  }
}

function getEvaluationSystemPrompt(): string {
  return `You are an expert IELTS Speaking examiner with extensive experience in the 2025 examination standards. You provide detailed, constructive feedback following official IELTS band descriptors.

CRITICAL 2025 PRECISION STANDARDS:
1. WORD LIMIT ENFORCEMENT: If a question required "ONE WORD" and the candidate said "A car" or "The building", mark this as a word limit violation. Only single words like "car" or "building" are acceptable.
2. LEXICAL UPGRADE TABLE: For EVERY common word used (e.g., "happy", "bad", "big", "good", "nice"), provide a Band 8+ alternative (e.g., "jubilant", "detrimental", "monumental", "exceptional", "delightful").
3. STAMINA CONSIDERATION: Consider performance consistency across all three parts.

SCORING CRITERIA (Band Descriptors):
- Fluency & Coherence: Speech flow, hesitation patterns, use of discourse markers
- Lexical Resource: Range, precision, collocations, idiomatic language
- Grammatical Range & Accuracy: Sentence variety, error frequency, complex structures
- Pronunciation: Clarity, intonation, stress patterns, connected speech

Be encouraging but honest. Provide specific examples from the transcript.

IMPORTANT: Respond with a JSON object in this exact format:
{
  "overallBand": number (0-9, can use 0.5 increments),
  "fluencyCoherence": {
    "score": number,
    "feedback": "string",
    "examples": ["string array"]
  },
  "lexicalResource": {
    "score": number,
    "feedback": "string",
    "examples": ["string array"],
    "lexicalUpgrades": [{"original": "common word", "upgraded": "band 8+ word", "context": "usage context"}]
  },
  "grammaticalRange": {
    "score": number,
    "feedback": "string",
    "examples": ["string array"],
    "errors": ["string array of grammatical errors"]
  },
  "pronunciation": {
    "score": number,
    "feedback": "string",
    "notes": ["string array"]
  },
  "partAnalysis": [
    {"partNumber": 1, "strengths": ["string array"], "improvements": ["string array"]},
    {"partNumber": 2, "strengths": ["string array"], "improvements": ["string array"]},
    {"partNumber": 3, "strengths": ["string array"], "improvements": ["string array"]}
  ],
  "modelAnswers": [
    {
      "partNumber": number,
      "question": "the question",
      "candidateResponse": "what they said (summarized)",
      "modelAnswer": "Band 8+ example response",
      "keyFeatures": ["what makes this Band 8+"]
    }
  ],
  "summary": "overall summary and advice",
  "keyStrengths": ["string array"],
  "priorityImprovements": ["string array"]
}`;
}

function buildEvaluationPrompt(
  transcripts?: Record<number, string>, 
  topic?: string, 
  difficulty?: string,
  part2SpeakingDuration?: number,
  fluencyFlag?: boolean
): string {
  let prompt = `Please evaluate this IELTS Speaking test performance.\n\n`;
  
  if (topic) {
    prompt += `TEST TOPIC: ${topic}\n`;
  }
  if (difficulty) {
    prompt += `DIFFICULTY LEVEL: ${difficulty}\n`;
  }
  
  if (part2SpeakingDuration !== undefined) {
    prompt += `\nPART 2 SPEAKING DURATION: ${Math.floor(part2SpeakingDuration)} seconds`;
    if (fluencyFlag) {
      prompt += ` (BELOW 80-SECOND THRESHOLD - FLAG FLUENCY AS POTENTIAL SCORE REDUCTION AREA)`;
    }
    prompt += '\n';
  }

  prompt += `\nCANDIDATE'S RESPONSES:\n\n`;

  if (transcripts) {
    for (const [part, text] of Object.entries(transcripts)) {
      prompt += `=== PART ${part} ===\n${text || '(No response recorded)'}\n\n`;
    }
  } else {
    prompt += '(Transcripts not available - evaluate based on general speaking criteria)\n';
  }

  prompt += `\nProvide a comprehensive evaluation including:
1. Overall band score (0-9, can use .5 increments)
2. Individual scores for all four criteria
3. Specific examples of strengths and errors
4. Lexical upgrades for common vocabulary
5. Word limit violations (if any ONE WORD questions were answered with phrases)
6. Actionable improvement suggestions
7. MODEL ANSWERS: For 2-3 key questions from each part, provide Band 8+ example responses`;

  if (fluencyFlag) {
    prompt += `\n\n**IMPORTANT**: The candidate spoke for only ${Math.floor(part2SpeakingDuration || 0)} seconds in Part 2, which is significantly below the expected 1:20 minimum (80 seconds). Flag this as a fluency concern.`;
  }

  return prompt;
}
