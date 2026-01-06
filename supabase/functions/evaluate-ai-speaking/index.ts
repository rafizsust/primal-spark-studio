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
  'gemini-2.0-flash-001',
];

interface EvaluationRequest {
  testId: string;
  audioData: Record<string, string>; // dataURL or base64
  durations?: Record<string, number>; // seconds
  topic?: string;
  difficulty?: string;
  part2SpeakingDuration?: number;
  fluencyFlag?: boolean;
}

type SpeakingQuestion = {
  id: string;
  question_number: number;
  question_text: string;
};

type SpeakingPart = {
  id: string;
  part_number: 1 | 2 | 3;
  instruction?: string;
  cue_card_topic?: string;
  cue_card_content?: string;
  questions: SpeakingQuestion[];
};

type GeneratedTestPayload = {
  id: string;
  module: string;
  topic?: string;
  difficulty?: string;
  speakingParts?: SpeakingPart[];
};

serve(async (req) => {
  const startTime = Date.now();
  console.log(`[evaluate-ai-speaking] Request received at ${new Date().toISOString()}`);
  
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
      console.error('[evaluate-ai-speaking] Auth error:', authError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log(`[evaluate-ai-speaking] User authenticated: ${user.id}`);

    if (!appEncryptionKey) {
      console.error('[evaluate-ai-speaking] app_encryption_key not set');
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
      console.error('[evaluate-ai-speaking] Gemini API key not found for user:', user.id);
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
    console.log('[evaluate-ai-speaking] Gemini API key decrypted successfully');

    // Parse request body
    const body: EvaluationRequest = await req.json();
    const { testId, audioData, durations, topic, difficulty, part2SpeakingDuration, fluencyFlag } = body;

    if (!testId || !audioData || typeof audioData !== 'object') {
      console.error('[evaluate-ai-speaking] Bad request: missing testId or audioData');
      return new Response(JSON.stringify({ error: 'Missing testId or audioData', code: 'BAD_REQUEST' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const audioKeys = Object.keys(audioData);
    const totalPayloadSize = JSON.stringify(audioData).length;
    console.log(`[evaluate-ai-speaking] Test: ${testId}, User: ${user.id}`);
    console.log(`[evaluate-ai-speaking] Audio segments: ${audioKeys.length}, Payload size: ${(totalPayloadSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`[evaluate-ai-speaking] Audio keys: ${audioKeys.join(', ')}`);

    // Load AI practice test payload (for question context)
    const { data: testRow, error: testError } = await supabaseClient
      .from('ai_practice_tests')
      .select('payload, topic, difficulty, module')
      .eq('id', testId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (testError || !testRow) {
      return new Response(JSON.stringify({ error: 'AI practice test not found', code: 'TEST_NOT_FOUND' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = (testRow.payload ?? {}) as unknown as GeneratedTestPayload;
    const speakingParts = (payload.speakingParts ?? [])
      .slice()
      .sort((a, b) => a.part_number - b.part_number);

    if (!speakingParts.length) {
      return new Response(JSON.stringify({ error: 'Speaking parts not found in test payload', code: 'INVALID_TEST' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service client for DB insert
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Upload each segment to R2 and produce public URLs
    const audioUrls: Record<string, string> = {};
    
    for (const key of audioKeys) {
      try {
        const value = audioData[key];
        const { mimeType, base64 } = parseDataUrl(value);
        // Skip tiny payloads
        if (!base64 || base64.length < 1000) continue;

        const audioBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const ext = mimeType === 'audio/mpeg' ? 'mp3' : 'webm';
        const r2Key = `speaking-audios/ai-speaking/${user.id}/${testId}/${key}.${ext}`;

        const result = await uploadToR2(r2Key, audioBytes, mimeType);
        if (result.success && result.url) {
          audioUrls[key] = result.url;
          console.log(`[evaluate-ai-speaking] Uploaded audio to R2: ${r2Key}`);
        } else {
          console.warn(`[evaluate-ai-speaking] Upload failed for ${key}:`, result.error);
        }
      } catch (err) {
        console.error(`Failed to upload audio for ${key}:`, err);
      }
    }

    // Build Gemini multi-modal prompt similar to admin evaluation (audio inline + transcripts)
    const contents = buildGeminiContents({
      speakingParts,
      audioData,
      topic: topic ?? testRow.topic ?? payload.topic,
      difficulty: difficulty ?? testRow.difficulty ?? payload.difficulty,
      part2SpeakingDuration,
      fluencyFlag,
    });

    // Call Gemini API with fallback models and timeout
    let evaluationRaw: any = null;
    let usedModel: string | null = null;
    const GEMINI_TIMEOUT_MS = 120_000; // 2 minutes timeout for large audio payloads

    console.log(`[evaluate-ai-speaking] Starting Gemini API call, timeout: ${GEMINI_TIMEOUT_MS}ms`);

    for (const modelName of GEMINI_MODELS_FALLBACK_ORDER) {
      console.log(`[evaluate-ai-speaking] Attempting model: ${modelName}`);
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
              temperature: 0.3, // Lower temperature for more consistent scoring
              maxOutputTokens: 12000, // Increased for complete model answers
              responseMimeType: 'application/json',
            },
          }),
        });
        
        clearTimeout(timeoutId);
        console.log(`[evaluate-ai-speaking] Gemini ${modelName} response status: ${geminiResponse.status}`);

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          console.error(`[evaluate-ai-speaking] Gemini ${modelName} error (${geminiResponse.status}):`, errorText.slice(0, 500));

          if (geminiResponse.status === 429 || geminiResponse.status === 503) {
            console.log(`[evaluate-ai-speaking] Rate limited or service unavailable, trying next model...`);
            continue;
          }

          if (geminiResponse.status === 400 && errorText.includes('API_KEY')) {
            return new Response(JSON.stringify({
              error: 'Invalid Gemini API key. Please update it in Settings.',
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
          console.error(`[evaluate-ai-speaking] No response text from ${modelName}, candidate:`, JSON.stringify(data?.candidates?.[0]).slice(0, 500));
          continue;
        }

        console.log(`[evaluate-ai-speaking] Response text length: ${responseText.length}`);
        evaluationRaw = parseJsonFromResponse(responseText);
        if (evaluationRaw) {
          usedModel = modelName;
          console.log(`[evaluate-ai-speaking] Successfully evaluated with model: ${modelName}`);
          break;
        } else {
          console.error(`[evaluate-ai-speaking] Failed to parse JSON from ${modelName} response`);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.error(`[evaluate-ai-speaking] Timeout with model ${modelName} after ${GEMINI_TIMEOUT_MS}ms`);
        } else {
          console.error(`[evaluate-ai-speaking] Error with model ${modelName}:`, err.message || err);
        }
        continue;
      }
    }

    if (!evaluationRaw) {
      console.error('[evaluate-ai-speaking] All models failed to evaluate');
      throw new Error('Failed to evaluate speaking test with any available model. Please try again.');
    }

    // Normalize evaluation into the frontend-friendly structure
    const evaluation = normalizeEvaluationResponse(evaluationRaw);

    // Extract transcripts (question-by-question) from model output
    const transcriptsMap = extractTranscriptsMap(evaluationRaw);

    // Build transcripts_by_question and transcripts_by_part in deterministic order
    const transcriptsByQuestion: Record<number, Array<{ question_number: number; question_text: string; transcript: string }>> = {
      1: [],
      2: [],
      3: [],
    };

    const transcriptsByPart: Record<number, string> = { 1: '', 2: '', 3: '' };

    for (const part of speakingParts) {
      const lines: string[] = [];

      for (const q of part.questions ?? []) {
        const audioKey = `part${part.part_number}-q${q.id}`;
        const transcript = String(transcriptsMap[audioKey] ?? '').trim();
        transcriptsByQuestion[part.part_number].push({
          question_number: q.question_number,
          question_text: q.question_text,
          transcript,
        });
        if (transcript) lines.push(`Q${q.question_number}: ${transcript}`);
      }

      transcriptsByPart[part.part_number] = lines.join('\n');
    }

    // Derive timeSpent
    const timeSpentSeconds = durations
      ? Math.round(Object.values(durations).reduce((acc, s) => acc + (Number(s) || 0), 0))
      : Math.round((part2SpeakingDuration ?? 0) + 60);

    const overallBand = Number(evaluation.overall_band ?? evaluation.overallBand ?? 0);

    // Save to database using service client
    const { error: insertError } = await supabaseService
      .from('ai_practice_results')
      .insert({
        user_id: user.id,
        test_id: testId,
        module: 'speaking',
        answers: {
          audio_urls: audioUrls,
          transcripts_by_part: transcriptsByPart,
          transcripts_by_question: transcriptsByQuestion,
        },
        score: Math.round(((overallBand || 0) / 9) * 100),
        total_questions: audioKeys.length,
        band_score: overallBand,
        time_spent_seconds: timeSpentSeconds,
        question_results: evaluation,
        completed_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('[evaluate-ai-speaking] Failed to save result:', insertError);
      // Don't fail the request, still return evaluation
    } else {
      console.log('[evaluate-ai-speaking] Result saved successfully');
    }

    const elapsed = Date.now() - startTime;
    console.log(`[evaluate-ai-speaking] Completed in ${elapsed}ms, overall band: ${overallBand}`);

    return new Response(JSON.stringify({
      success: true,
      evaluation,
      usedModel,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const elapsed = Date.now() - startTime;
    console.error(`[evaluate-ai-speaking] Error after ${elapsed}ms:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Evaluation failed';
    return new Response(JSON.stringify({ error: errorMessage, code: 'EVALUATION_ERROR' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parseDataUrl(value: string): { mimeType: string; base64: string } {
  if (!value) return { mimeType: 'audio/webm', base64: '' };

  // data:[mime];base64,[payload]
  if (value.startsWith('data:')) {
    const commaIdx = value.indexOf(',');
    const header = commaIdx >= 0 ? value.slice(5, commaIdx) : value.slice(5);
    const base64 = commaIdx >= 0 ? value.slice(commaIdx + 1) : '';

    const semiIdx = header.indexOf(';');
    const mimeType = (semiIdx >= 0 ? header.slice(0, semiIdx) : header).trim() || 'audio/webm';

    return { mimeType, base64 };
  }

  // Raw base64 (legacy)
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

function extractTranscriptsMap(raw: any): Record<string, string> {
  // Support a few shapes:
  // 1) { transcripts: { "part1-q...": "..." } }
  // 2) { evaluation_report: { transcripts: { ... } } }
  // 3) { evaluationReport: { transcripts: { ... } } }
  const direct = raw?.transcripts;
  const nested = raw?.evaluation_report?.transcripts ?? raw?.evaluationReport?.transcripts;

  const map = (direct && typeof direct === 'object')
    ? direct
    : (nested && typeof nested === 'object')
      ? nested
      : null;

  return map ? (map as Record<string, string>) : {};
}

function buildGeminiContents(input: {
  speakingParts: SpeakingPart[];
  audioData: Record<string, string>;
  topic?: string;
  difficulty?: string;
  part2SpeakingDuration?: number;
  fluencyFlag?: boolean;
}): Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> {
  const { speakingParts, audioData, topic, difficulty, part2SpeakingDuration, fluencyFlag } = input;

  const contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = [];

  contents.push({
    parts: [{
      text: getEvaluationSystemPrompt(topic, difficulty, part2SpeakingDuration, fluencyFlag),
    }],
  });

  for (const part of speakingParts) {
    contents.push({
      parts: [{
        text: `\nPART ${part.part_number}\n${part.instruction ? `Instruction: ${part.instruction}\n` : ''}`,
      }],
    });

    if (part.part_number === 2) {
      if (part.cue_card_topic) {
        contents.push({ parts: [{ text: `Cue Card Topic: ${part.cue_card_topic}\n` }] });
      }
      if (part.cue_card_content) {
        contents.push({ parts: [{ text: `Cue Card Content:\n${part.cue_card_content}\n` }] });
      }
    }

    for (const q of part.questions ?? []) {
      const audioKey = `part${part.part_number}-q${q.id}`;
      contents.push({
        parts: [{ text: `\nQuestion ${q.question_number}: ${q.question_text}\nAudio key: ${audioKey}\n` }],
      });

      const rawAudio = audioData[audioKey];
      const { mimeType, base64 } = parseDataUrl(rawAudio || '');

      if (base64 && base64.length > 1000) {
        contents.push({ parts: [{ inlineData: { mimeType, data: base64 } }] });
        contents.push({
          parts: [{
            text: `Transcribe the candidate's speech for this audio and store it in the JSON field "transcripts" under the key "${audioKey}". If there is no speech, write "No speech detected" for this key.`,
          }],
        });
      } else {
        contents.push({
          parts: [{
            text: `No usable audio was provided for ${audioKey}. Set transcripts["${audioKey}"] = "No speech detected".`,
          }],
        });
      }
    }
  }

  contents.push({
    parts: [{
      text: `\nReturn ONLY a single valid JSON object matching the requested schema. Do not add markdown.`,
    }],
  });

  return contents;
}

function getEvaluationSystemPrompt(
  topic?: string,
  difficulty?: string,
  part2SpeakingDuration?: number,
  fluencyFlag?: boolean,
): string {
  return `You are an expert IELTS Speaking examiner (2025 standard). You will be given:
- The test context (topic/difficulty)
- The exact questions
- Audio recordings for each question

You MUST base the score on what you hear in the audio.
If there is no speech in the audio, score appropriately and explain why.

${topic ? `TEST TOPIC: ${topic}\n` : ''}${difficulty ? `DIFFICULTY: ${difficulty}\n` : ''}${typeof part2SpeakingDuration === 'number' ? `PART 2 SPEAKING DURATION: ${Math.floor(part2SpeakingDuration)} seconds\n` : ''}${fluencyFlag ? `FLUENCY FLAG: Part 2 was below 80 seconds\n` : ''}

CRITICAL SCORING GUIDELINES (USE CONSISTENTLY - SAME SCALE FOR FULL TEST OR INDIVIDUAL PARTS):
You MUST score each criterion INDEPENDENTLY based on the specific evidence you observe. Each criterion measures DIFFERENT skills:

FLUENCY & COHERENCE (assess speech flow and organization):
- Band 9: Speaks fluently with only rare repetition or self-correction; discourse is coherent with fully appropriate cohesive features
- Band 7: Speaks at length without noticeable effort; may demonstrate language-related hesitation; uses a range of connectives
- Band 5: Usually maintains flow but uses repetition, self-correction and/or slow speech; over-uses connectives
- Band 3: Speaks with long pauses; limited ability to link simple sentences

LEXICAL RESOURCE (assess vocabulary range and precision):
- Band 9: Uses vocabulary with full flexibility and precision in all topics; uses idiomatic language naturally
- Band 7: Uses vocabulary flexibly to discuss a variety of topics; uses some less common and idiomatic vocabulary
- Band 5: Manages to talk about familiar and unfamiliar topics but uses vocabulary with limited flexibility
- Band 3: Uses simple vocabulary to convey personal information; insufficient vocabulary for less familiar topics

GRAMMATICAL RANGE & ACCURACY (assess sentence structures and error frequency):
- Band 9: Uses a full range of structures naturally and appropriately; produces consistently accurate structures
- Band 7: Uses a range of complex structures with some flexibility; frequently produces error-free sentences
- Band 5: Produces basic sentence forms with reasonable accuracy; uses complex structures but with errors
- Band 3: Attempts basic sentence forms but with limited success; errors are frequent

PRONUNCIATION (assess clarity, intonation, stress patterns):
- Band 9: Uses the full range of pronunciation features with precision; is effortless to understand throughout
- Band 7: Shows all positive features of Band 6 and some of Band 8; generally easy to understand
- Band 5: Shows all positive features of Band 4 and some of Band 6; may mispronounce some words
- Band 3: Shows some features of Band 2 and some of Band 4; causes some strain for the listener

IMPORTANT SCORING NOTES:
- A candidate with excellent vocabulary but poor grammar should show DIFFERENT scores for those criteria
- A fluent speaker with poor pronunciation should score HIGH on fluency but LOWER on pronunciation
- Score each criterion based ONLY on the evidence relevant to that skill
- Use half-band scores (5.5, 6.5, 7.5) when performance falls between bands
- The overall band should be calculated as the average of all four criteria, rounded to the nearest 0.5
- Apply the SAME scoring standard whether evaluating a single part or the full test (do NOT inflate scores for full tests)

MODEL ANSWERS REQUIREMENT:
You MUST provide a model answer for EVERY question asked in the test. For each question:
- Show what the candidate actually said (candidateResponse)
- Provide an exemplary Band 8-9 model answer that a native speaker or expert would give
- List key features that make the model answer strong

Respond with JSON in this exact format:
{
  "overallBand": number,
  "fluencyCoherence": { "score": number, "feedback": string, "examples": string[] },
  "lexicalResource": { "score": number, "feedback": string, "examples": string[], "lexicalUpgrades": [{"original": string, "upgraded": string, "context": string}] },
  "grammaticalRange": { "score": number, "feedback": string, "examples": string[] },
  "pronunciation": { "score": number, "feedback": string },
  "partAnalysis": [
    {"partNumber": 1, "strengths": string[], "improvements": string[]},
    {"partNumber": 2, "strengths": string[], "improvements": string[]},
    {"partNumber": 3, "strengths": string[], "improvements": string[]}
  ],
  "modelAnswers": [
    {"partNumber": number, "questionNumber": number, "question": string, "candidateResponse": string, "modelAnswer": string, "keyFeatures": string[]}
  ],
  "summary": string,
  "keyStrengths": string[],
  "priorityImprovements": string[],
  "transcripts": { "part1-q<id>": string, "part2-q<id>": string, "part3-q<id>": string }
}

CRITICAL: The "modelAnswers" array MUST contain an entry for EVERY question from ALL parts.`;
}

function normalizeEvaluationResponse(data: any): any {
  const ensureArray = (val: any) => (Array.isArray(val) ? val : []);

  const overallBand = data.overallBand ?? data.overall_band ?? 0;

  const normalizeCriterion = (camelKey: string, snakeKey: string) => {
    const val = data[camelKey] ?? data[snakeKey] ?? { score: 0, feedback: '' };
    return {
      score: val.score ?? 0,
      feedback: val.feedback ?? '',
      examples: ensureArray(val.examples),
    };
  };

  const lexicalResource = data.lexicalResource ?? data.lexical_resource ?? {};
  const lexicalUpgrades = ensureArray(
    lexicalResource.lexicalUpgrades ?? lexicalResource.lexical_upgrades ?? data.lexical_upgrades ?? [],
  );

  const partAnalysisRaw = ensureArray(data.partAnalysis ?? data.part_analysis ?? []);
  const partAnalysis = partAnalysisRaw.map((p: any) => ({
    part_number: p.partNumber ?? p.part_number ?? 0,
    strengths: ensureArray(p.strengths),
    improvements: ensureArray(p.improvements),
  }));

  return {
    overall_band: overallBand,
    overallBand: overallBand,
    fluency_coherence: normalizeCriterion('fluencyCoherence', 'fluency_coherence'),
    lexical_resource: {
      ...normalizeCriterion('lexicalResource', 'lexical_resource'),
      lexicalUpgrades: lexicalUpgrades,
    },
    grammatical_range: normalizeCriterion('grammaticalRange', 'grammatical_range'),
    pronunciation: {
      score: (data.pronunciation ?? {}).score ?? 0,
      feedback: (data.pronunciation ?? {}).feedback ?? '',
    },
    lexical_upgrades: lexicalUpgrades,
    part_analysis: partAnalysis,
    improvement_priorities: ensureArray(data.priorityImprovements ?? data.improvement_priorities ?? []),
    strengths_to_maintain: ensureArray(data.keyStrengths ?? data.strengths_to_maintain ?? []),
    examiner_notes: data.summary ?? data.examiner_notes ?? '',
    modelAnswers: ensureArray(data.modelAnswers ?? data.model_answers ?? []),
  };
}
