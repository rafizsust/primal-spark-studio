import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { uploadToR2 } from "../_shared/r2Client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Prefer models that work reliably on v1beta and support multi-modal inputs.
const GEMINI_MODELS_FALLBACK_ORDER = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
];

interface PartEvaluationRequest {
  testId: string;
  partNumber: 1 | 2 | 3;
  audioData: Record<string, string>; // dataURL or base64
  durations?: Record<string, number>;
  questions: Array<{
    id: string;
    question_number: number;
    question_text: string;
  }>;
  cueCardTopic?: string;
  cueCardContent?: string;
  instruction?: string;
  topic?: string;
  difficulty?: string;
}

serve(async (req) => {
  const startTime = Date.now();
  console.log(`[evaluate-ai-speaking-part] Request received at ${new Date().toISOString()}`);
  
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
      console.error('[evaluate-ai-speaking-part] Auth error:', authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log(`[evaluate-ai-speaking-part] User authenticated: ${user.id}`);

    if (!appEncryptionKey) {
      console.error('[evaluate-ai-speaking-part] app_encryption_key not set');
      return new Response(JSON.stringify({
        error: 'Server configuration error: encryption key not set.',
        code: 'SERVER_CONFIG_ERROR'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's Gemini API key
    const { data: userSecret, error: secretError } = await supabaseClient
      .from('user_secrets')
      .select('encrypted_value')
      .eq('user_id', user.id)
      .eq('secret_name', 'GEMINI_API_KEY')
      .single();

    if (secretError || !userSecret) {
      console.error('[evaluate-ai-speaking-part] Gemini API key not found for user:', user.id);
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
      ["decrypt"],
    );

    const encryptedBytes = Uint8Array.from(atob(userSecret.encrypted_value), (c) => c.charCodeAt(0));
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    const decryptedData = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );

    const geminiApiKey = decoder.decode(decryptedData);
    console.log('[evaluate-ai-speaking-part] Gemini API key decrypted successfully');

    // Parse request body
    const body: PartEvaluationRequest = await req.json();
    const { testId, partNumber, audioData, durations, questions, cueCardTopic, cueCardContent, instruction, topic, difficulty } = body;

    if (!testId || !partNumber || !audioData || typeof audioData !== 'object') {
      console.error('[evaluate-ai-speaking-part] Bad request: missing required fields');
      return new Response(JSON.stringify({ error: 'Missing required fields', code: 'BAD_REQUEST' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const audioKeys = Object.keys(audioData);
    console.log(`[evaluate-ai-speaking-part] Test: ${testId}, Part: ${partNumber}, User: ${user.id}`);
    console.log(`[evaluate-ai-speaking-part] Audio segments: ${audioKeys.length}`);

    // Upload audio to R2 and get URLs
    const audioUrls: Record<string, string> = {};
    
    for (const key of audioKeys) {
      try {
        const value = audioData[key];
        const { mimeType, base64 } = parseDataUrl(value);
        if (!base64 || base64.length < 1000) continue;

        const audioBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const ext = mimeType === 'audio/mpeg' ? 'mp3' : 'webm';
        const r2Key = `speaking-audios/ai-speaking/${user.id}/${testId}/${key}.${ext}`;

        const result = await uploadToR2(r2Key, audioBytes, mimeType);
        if (result.success && result.url) {
          audioUrls[key] = result.url;
          console.log(`[evaluate-ai-speaking-part] Uploaded audio to R2: ${r2Key}`);
        } else {
          console.warn(`[evaluate-ai-speaking-part] Upload failed for ${key}:`, result.error);
        }
      } catch (err) {
        console.error(`Failed to upload audio for ${key}:`, err);
      }
    }

    // Build Gemini prompt for this single part
    const contents = buildPartEvaluationContents({
      partNumber,
      audioData,
      questions,
      cueCardTopic,
      cueCardContent,
      instruction,
      topic,
      difficulty,
    });

    // Call Gemini API
    let evaluationRaw: any = null;
    let usedModel: string | null = null;
    const GEMINI_TIMEOUT_MS = 90_000;

    console.log(`[evaluate-ai-speaking-part] Starting Gemini API call for Part ${partNumber}`);

    for (const modelName of GEMINI_MODELS_FALLBACK_ORDER) {
      console.log(`[evaluate-ai-speaking-part] Attempting model: ${modelName}`);
      const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
        
        const geminiResponse = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.3, // Same as full test for consistency
              maxOutputTokens: 6000, // Increased for complete model answers
              responseMimeType: 'application/json',
            },
          }),
        });
        
        clearTimeout(timeoutId);
        console.log(`[evaluate-ai-speaking-part] Gemini ${modelName} response status: ${geminiResponse.status}`);

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.error(`[evaluate-ai-speaking-part] Gemini ${modelName} error:`, errorText.slice(0, 300));

          if (geminiResponse.status === 429 || geminiResponse.status === 503) {
            continue;
          }

          if (geminiResponse.status === 400 && errorText.includes('API_KEY')) {
            return new Response(JSON.stringify({
              error: 'Invalid Gemini API key.',
              code: 'INVALID_API_KEY',
            }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          continue;
        }

        const data = await geminiResponse.json();
        const responseText = data?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text)
          .filter(Boolean)
          .join('\n');

        if (!responseText) {
          console.error(`[evaluate-ai-speaking-part] No response text from ${modelName}`);
          continue;
        }

        evaluationRaw = parseJsonFromResponse(responseText);
        if (evaluationRaw) {
          usedModel = modelName;
          console.log(`[evaluate-ai-speaking-part] Successfully evaluated Part ${partNumber} with model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.error(`[evaluate-ai-speaking-part] Timeout with model ${modelName}`);
        } else {
          console.error(`[evaluate-ai-speaking-part] Error with model ${modelName}:`, err.message);
        }
        continue;
      }
    }

    if (!evaluationRaw) {
      console.error('[evaluate-ai-speaking-part] All models failed to evaluate');
      throw new Error('Failed to evaluate speaking part. Please try again.');
    }

    // Build the partial result
    const partResult = {
      partNumber,
      audioUrls,
      transcripts: evaluationRaw.transcripts || {},
      criteriaScores: {
        fluencyCoherence: evaluationRaw.fluencyCoherence || { score: 0, feedback: '' },
        lexicalResource: evaluationRaw.lexicalResource || { score: 0, feedback: '' },
        grammaticalRange: evaluationRaw.grammaticalRange || { score: 0, feedback: '' },
        pronunciation: evaluationRaw.pronunciation || { score: 0, feedback: '' },
      },
      partAnalysis: {
        strengths: evaluationRaw.strengths || [],
        improvements: evaluationRaw.improvements || [],
        feedback: evaluationRaw.partFeedback || '',
      },
      modelAnswers: evaluationRaw.modelAnswers || [],
      usedModel,
    };

    const elapsed = Date.now() - startTime;
    console.log(`[evaluate-ai-speaking-part] Part ${partNumber} completed in ${elapsed}ms`);

    return new Response(JSON.stringify({
      success: true,
      partResult,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const elapsed = Date.now() - startTime;
    console.error(`[evaluate-ai-speaking-part] Error after ${elapsed}ms:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Evaluation failed';
    return new Response(JSON.stringify({ error: errorMessage, code: 'EVALUATION_ERROR' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parseDataUrl(value: string): { mimeType: string; base64: string } {
  if (!value) return { mimeType: 'audio/webm', base64: '' };

  if (value.startsWith('data:')) {
    const commaIdx = value.indexOf(',');
    const header = commaIdx >= 0 ? value.slice(5, commaIdx) : value.slice(5);
    const base64 = commaIdx >= 0 ? value.slice(commaIdx + 1) : '';

    const semiIdx = header.indexOf(';');
    const mimeType = (semiIdx >= 0 ? header.slice(0, semiIdx) : header).trim() || 'audio/webm';

    return { mimeType, base64 };
  }

  return { mimeType: 'audio/webm', base64: value };
}

function parseJsonFromResponse(responseText: string): any {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(responseText);
  } catch (err) {
    console.error('Error parsing evaluation response:', err);
    return null;
  }
}

function buildPartEvaluationContents(input: {
  partNumber: 1 | 2 | 3;
  audioData: Record<string, string>;
  questions: Array<{ id: string; question_number: number; question_text: string }>;
  cueCardTopic?: string;
  cueCardContent?: string;
  instruction?: string;
  topic?: string;
  difficulty?: string;
}): Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> {
  const { partNumber, audioData, questions, cueCardTopic, cueCardContent, instruction, topic, difficulty } = input;

  const contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = [];

  // System prompt for single part evaluation - MATCHES FULL TEST SCORING GUIDELINES
  contents.push({
    parts: [{
      text: `You are an expert IELTS Speaking examiner (2025 standard). You will evaluate Part ${partNumber} of a speaking test.

${topic ? `TEST TOPIC: ${topic}` : ''}
${difficulty ? `DIFFICULTY: ${difficulty}` : ''}

Listen to the audio for each question and:
1. Transcribe the candidate's speech accurately
2. Evaluate based on IELTS criteria
3. Provide specific feedback for this part
4. Generate a model answer for EVERY question

CRITICAL SCORING GUIDELINES (USE CONSISTENTLY - SAME SCALE AS FULL TEST):
Score each criterion INDEPENDENTLY. Use the same scoring standard as a full test evaluation:
- Band 9: Native-level performance
- Band 7: Good user with occasional inaccuracies  
- Band 5: Modest user with noticeable limitations
- Band 3: Limited user with frequent errors

IMPORTANT: Do NOT inflate scores just because this is a single part. Apply the EXACT same standards as a full test.
Use half-band scores (5.5, 6.5, 7.5) when appropriate.

MODEL ANSWERS REQUIREMENT:
You MUST provide a model answer for EVERY question in this part. Show:
- What the candidate actually said
- An exemplary Band 8-9 model answer
- Key features that make the model answer strong

Respond with JSON in this exact format:
{
  "fluencyCoherence": { "score": number, "feedback": string },
  "lexicalResource": { "score": number, "feedback": string },
  "grammaticalRange": { "score": number, "feedback": string },
  "pronunciation": { "score": number, "feedback": string },
  "strengths": string[],
  "improvements": string[],
  "partFeedback": string,
  "modelAnswers": [{"questionNumber": number, "question": string, "candidateResponse": string, "modelAnswer": string, "keyFeatures": string[]}],
  "transcripts": { "part${partNumber}-q<id>": string }
}

CRITICAL: The "modelAnswers" array MUST contain an entry for EVERY question in this part.`,
    }],
  });

  // Part context
  contents.push({
    parts: [{
      text: `\n=== PART ${partNumber} ===\n${instruction ? `Instruction: ${instruction}\n` : ''}`,
    }],
  });

  // Part 2 cue card
  if (partNumber === 2) {
    if (cueCardTopic) {
      contents.push({ parts: [{ text: `Cue Card Topic: ${cueCardTopic}\n` }] });
    }
    if (cueCardContent) {
      contents.push({ parts: [{ text: `Cue Card Content:\n${cueCardContent}\n` }] });
    }
  }

  // Questions and audio
  for (const q of questions) {
    const audioKey = `part${partNumber}-q${q.id}`;
    contents.push({
      parts: [{ text: `\nQuestion ${q.question_number}: ${q.question_text}\nAudio key: ${audioKey}\n` }],
    });

    const rawAudio = audioData[audioKey];
    const { mimeType, base64 } = parseDataUrl(rawAudio || '');

    if (base64 && base64.length > 1000) {
      contents.push({ parts: [{ inlineData: { mimeType, data: base64 } }] });
      contents.push({
        parts: [{
          text: `Transcribe and evaluate this audio for key "${audioKey}".`,
        }],
      });
    } else {
      contents.push({
        parts: [{
          text: `No usable audio for ${audioKey}. Set transcripts["${audioKey}"] = "No speech detected".`,
        }],
      });
    }
  }

  contents.push({
    parts: [{
      text: `\nReturn ONLY a single valid JSON object. Do not add markdown.`,
    }],
  });

  return contents;
}
