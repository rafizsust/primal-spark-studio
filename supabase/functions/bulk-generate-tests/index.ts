import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Available TTS voices with accents
const TTS_VOICES = {
  US: ["Kore", "Charon", "Fenrir"],
  GB: ["Kore", "Aoede", "Puck"],
  AU: ["Kore", "Aoede", "Fenrir"],
  IN: ["Kore", "Charon", "Puck"],
};

const ALL_ACCENTS = Object.keys(TTS_VOICES) as Array<keyof typeof TTS_VOICES>;

// ============================================================================
// VOICE-FIRST GENDER SYNCHRONIZATION SYSTEM
// ============================================================================
const VOICE_GENDER_MAP: Record<string, 'male' | 'female'> = {
  'Kore': 'male',
  'Charon': 'male',
  'Fenrir': 'male',
  'Puck': 'male',
  'Aoede': 'female',
};

function getVoiceGender(voiceName: string): 'male' | 'female' {
  return VOICE_GENDER_MAP[voiceName] || 'male';
}

function getGenderAppropriateNames(gender: 'male' | 'female'): string[] {
  if (gender === 'male') {
    return ['Tom', 'David', 'John', 'Michael', 'James', 'Robert', 'William', 'Richard', 'Daniel', 'Mark'];
  }
  return ['Sarah', 'Emma', 'Lisa', 'Anna', 'Maria', 'Sophie', 'Rachel', 'Laura', 'Helen', 'Kate'];
}

function buildGenderConstraint(primaryVoice: string, hasSecondSpeaker: boolean): string {
  const primaryGender = getVoiceGender(primaryVoice);
  const oppositeGender = primaryGender === 'male' ? 'female' : 'male';
  const primaryNames = getGenderAppropriateNames(primaryGender).slice(0, 5).join(', ');
  const secondaryNames = getGenderAppropriateNames(oppositeGender).slice(0, 5).join(', ');
  
  let constraint = `
CRITICAL - VOICE-GENDER SYNCHRONIZATION:
- The MAIN SPEAKER (Speaker1) for this audio is ${primaryGender.toUpperCase()}.
- You MUST assign Speaker1 a ${primaryGender} name (e.g., ${primaryNames}).
- You MUST NOT write self-identifying phrases that contradict this gender.
- DO NOT use phrases like "${primaryGender === 'male' ? "I am a mother" : "I am a father"}" or names of the wrong gender.`;

  if (hasSecondSpeaker) {
    constraint += `
- The SECOND SPEAKER (Speaker2) should be ${oppositeGender.toUpperCase()} for voice distinctiveness.
- Assign Speaker2 a ${oppositeGender} name (e.g., ${secondaryNames}).`;
  }
  
  return constraint;
}

function getRandomVoice(preferredAccent?: string): { voiceName: string; accent: string } {
  let accent: keyof typeof TTS_VOICES;
  
  if (preferredAccent && preferredAccent !== "random" && preferredAccent !== "mixed" && TTS_VOICES[preferredAccent as keyof typeof TTS_VOICES]) {
    accent = preferredAccent as keyof typeof TTS_VOICES;
  } else {
    accent = ALL_ACCENTS[Math.floor(Math.random() * ALL_ACCENTS.length)];
  }
  
  const voices = TTS_VOICES[accent];
  const voiceName = voices[Math.floor(Math.random() * voices.length)];
  return { voiceName, accent };
}

function pickSecondaryVoice(primaryVoice: string, accent: string): string {
  const voices = TTS_VOICES[accent as keyof typeof TTS_VOICES] ?? TTS_VOICES.US;
  const primaryGender = getVoiceGender(primaryVoice);

  const candidates = voices.filter(v => v !== primaryVoice);
  const oppositeGenderCandidates = candidates.filter(v => getVoiceGender(v) !== primaryGender);

  const pool = oppositeGenderCandidates.length > 0 ? oppositeGenderCandidates : candidates;
  return pool[Math.floor(Math.random() * pool.length)] ?? primaryVoice;
}

// API Key management for round-robin Gemini TTS
interface ApiKeyRecord {
  id: string;
  provider: string;
  key_value: string;
  is_active: boolean;
  error_count: number;
}

let apiKeyCache: ApiKeyRecord[] = [];
let currentKeyIndex = 0;

async function getActiveGeminiKeys(supabaseServiceClient: any): Promise<ApiKeyRecord[]> {
  try {
    const { data, error } = await supabaseServiceClient
      .from('api_keys')
      .select('id, provider, key_value, is_active, error_count')
      .eq('provider', 'gemini')
      .eq('is_active', true)
      .order('error_count', { ascending: true });
    
    if (error) {
      console.error('Failed to fetch API keys:', error);
      return [];
    }
    
    console.log(`Found ${data?.length || 0} active Gemini keys in api_keys table`);
    return data || [];
  } catch (err) {
    console.error('Error fetching API keys:', err);
    return [];
  }
}

async function incrementKeyErrorCount(supabaseServiceClient: any, keyId: string, deactivate: boolean = false): Promise<void> {
  try {
    if (!deactivate) {
      const { data: currentKey } = await supabaseServiceClient
        .from('api_keys')
        .select('error_count')
        .eq('id', keyId)
        .single();
      
      if (currentKey) {
        await supabaseServiceClient
          .from('api_keys')
          .update({ 
            error_count: (currentKey.error_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', keyId);
      }
    } else {
      await supabaseServiceClient
        .from('api_keys')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', keyId);
    }
    
    console.log(`Updated key ${keyId}: ${deactivate ? 'deactivated' : 'incremented error count'}`);
  } catch (err) {
    console.error('Failed to update key error count:', err);
  }
}

async function resetKeyErrorCount(supabaseServiceClient: any, keyId: string): Promise<void> {
  try {
    await supabaseServiceClient
      .from('api_keys')
      .update({ error_count: 0, updated_at: new Date().toISOString() })
      .eq('id', keyId);
  } catch (err) {
    console.error('Failed to reset key error count:', err);
  }
}

function getNextApiKey(): ApiKeyRecord | null {
  if (apiKeyCache.length === 0) return null;
  const key = apiKeyCache[currentKeyIndex % apiKeyCache.length];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeyCache.length;
  return key;
}

// Retry helper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`Attempt ${attempt + 1} failed:`, lastError.message);
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("All retries failed");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin check
    const { data: adminCheck } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!adminCheck) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { module, topic, difficulty, quantity, questionType, monologue } = await req.json();

    // Validation
    if (!module || !topic || !difficulty || !quantity) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["listening", "speaking", "reading", "writing"].includes(module)) {
      return new Response(JSON.stringify({ error: "Invalid module" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["easy", "medium", "hard"].includes(difficulty)) {
      return new Response(JSON.stringify({ error: "Invalid difficulty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (quantity < 1 || quantity > 50) {
      return new Response(JSON.stringify({ error: "Quantity must be 1-50" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from("bulk_generation_jobs")
      .insert({
        admin_user_id: user.id,
        module,
        topic,
        difficulty,
        quantity,
        question_type: questionType || "mixed",
        monologue: monologue || false,
        status: "pending",
      })
      .select()
      .single();

    if (jobError) {
      console.error("Failed to create job:", jobError);
      return new Response(JSON.stringify({ error: "Failed to create job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Job ${job.id}] Created job for ${quantity} ${module} tests`);

    // Start background processing using EdgeRuntime.waitUntil
    const processingPromise = processGenerationJob(
      supabase, 
      job.id, 
      module, 
      topic, 
      difficulty, 
      quantity, 
      questionType || "mixed",
      monologue || false
    );
    
    // Use EdgeRuntime.waitUntil if available for background processing
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processingPromise);
    } else {
      // Fallback: don't await, let it run in background
      processingPromise.catch(console.error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        message: `Started generating ${quantity} ${module} tests for topic "${topic}"`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("bulk-generate-tests error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Main processing function
async function processGenerationJob(
  supabase: any,
  jobId: string,
  module: string,
  topic: string,
  difficulty: string,
  quantity: number,
  questionType: string,
  monologue: boolean
) {
  console.log(`[Job ${jobId}] Starting generation of ${quantity} ${module} tests (type: ${questionType}, monologue: ${monologue})`);

  await supabase
    .from("bulk_generation_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  let successCount = 0;
  let failureCount = 0;
  const errorLog: Array<{ index: number; error: string }> = [];
  let cancelled = false;

  // If mixed question type, rotate through available types
  const questionTypes = getQuestionTypesForModule(module, questionType);

  for (let i = 0; i < quantity; i++) {
    // Allow admin to cancel the job
    const { data: jobRow } = await supabase
      .from("bulk_generation_jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (jobRow?.status === "cancelled") {
      cancelled = true;
      console.log(`[Job ${jobId}] Cancelled by admin. Stopping at ${i}/${quantity}.`);
      break;
    }

    try {
      console.log(`[Job ${jobId}] Processing test ${i + 1}/${quantity}`);
      
      const { voiceName, accent } = getRandomVoice();
      const currentQuestionType = questionTypes[i % questionTypes.length];
      
      // Generate content using the same prompts as generate-ai-practice
      // Pass voiceName for gender synchronization (listening/speaking modules)
      const content = await withRetry(
        () => generateContent(module, topic, difficulty, currentQuestionType, monologue, voiceName),
        3,
        2000
      );
      
      if (!content) {
        throw new Error("Content generation failed - empty response");
      }

      let audioUrl: string | null = null;

      // LISTENING: Generate audio with MONOLOGUE RESCUE on failure
      if (module === "listening") {
        const scriptText = content.dialogue || content.script || "";
        const hasSecondSpeaker = !monologue && /Speaker2\s*:/i.test(scriptText) && /Speaker1\s*:/i.test(scriptText);

        // Persist speaker voice mapping in the JSON payload (so admin preview can show both voices)
        if (hasSecondSpeaker) {
          const speaker2Voice = pickSecondaryVoice(voiceName, accent);
          content.tts_speaker_voices = { Speaker1: voiceName, Speaker2: speaker2Voice };
        } else {
          content.tts_speaker_voices = { Speaker1: voiceName };
        }
        
        if (scriptText.trim()) {
          try {
            audioUrl = await withRetry(
              () => generateAndUploadAudio(
                supabase,
                scriptText,
                voiceName,
                hasSecondSpeaker ? content.tts_speaker_voices?.Speaker2 : undefined,
                monologue,
                jobId,
                i
              ),
              3,
              3000
            );
          } catch (audioError) {
            console.error(`[Job ${jobId}] Listening audio failed for test ${i + 1}:`, audioError);
            
            // === MONOLOGUE RESCUE: Convert dialogue to monologue for browser TTS fallback ===
            if (!monologue && scriptText.includes('Speaker')) {
              console.log(`[Job ${jobId}] Attempting monologue rescue for test ${i + 1}...`);
              try {
                const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
                if (LOVABLE_API_KEY) {
                  const monologuePrompt = `Rewrite the following dialogue as a detailed monologue or narration. 
Remove all speaker labels (e.g., "Speaker1:", "Speaker2:", names followed by colons). 
Convert the conversation into a flowing narrative that a single narrator would read aloud.
Keep ALL factual information, numbers, dates, names, and details that would be needed to answer test questions.
Return ONLY the raw monologue text, no JSON wrapper.

DIALOGUE TO CONVERT:
${scriptText}`;
                  
                  const rescueResponse = await fetchWithTimeout(
                    "https://ai.gateway.lovable.dev/v1/chat/completions",
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${LOVABLE_API_KEY}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        model: "google/gemini-2.5-flash",
                        messages: [
                          { role: "user", content: monologuePrompt },
                        ],
                      }),
                    },
                    60_000
                  );
                  
                  if (rescueResponse.ok) {
                    const rescueData = await rescueResponse.json();
                    const rescuedMonologue = rescueData.choices?.[0]?.message?.content;
                    
                    if (rescuedMonologue && rescuedMonologue.trim().length > 50) {
                      console.log(`[Job ${jobId}] Monologue rescue successful for test ${i + 1}`);
                      content.dialogue = rescuedMonologue.trim();
                      content.script = rescuedMonologue.trim();
                      content.speaker_names = { Speaker1: 'Narrator' };
                      content.monologue_rescued = true;
                      // Continue without throwing - test will be saved with browser TTS fallback
                    } else {
                      throw new Error('Monologue rescue returned empty result');
                    }
                  } else {
                    throw new Error('Monologue rescue API call failed');
                  }
                } else {
                  throw new Error('LOVABLE_API_KEY not available for rescue');
                }
              } catch (rescueError) {
                console.error(`[Job ${jobId}] Monologue rescue failed for test ${i + 1}:`, rescueError);
                throw new Error(`Audio generation failed and monologue rescue failed: ${audioError instanceof Error ? audioError.message : "Unknown"}`);
              }
            } else {
              // Already a monologue or no dialogue - cannot rescue
              throw new Error(`Audio generation failed: ${audioError instanceof Error ? audioError.message : "Unknown"}`);
            }
          }
        }
      }

      // SPEAKING: Generate audio for instructions and questions
      if (module === "speaking") {
        try {
          const speakingAudioUrls = await withRetry(
            () => generateSpeakingAudio(supabase, content, voiceName, jobId, i),
            2,
            2000
          );
          
          if (speakingAudioUrls) {
            content.audioUrls = speakingAudioUrls;
          }
        } catch (audioError) {
          console.warn(`[Job ${jobId}] Speaking audio generation failed, will use browser TTS fallback:`, audioError);
          content.audioUrls = null;
          content.useBrowserTTS = true;
        }
      }

      // Save to generated_test_audio table
      // Only include voice/accent for modules that use audio (listening, speaking)
      const testData: any = {
        job_id: jobId,
        module,
        topic,
        difficulty,
        question_type: currentQuestionType,
        content_payload: content,
        audio_url: audioUrl,
        transcript: content.dialogue || content.script || null,
        status: module === "listening" && !audioUrl && !content.monologue_rescued ? "failed" : "ready",
        is_published: false,
      };

      // Only add voice configuration for audio-based modules
      if (module === "listening" || module === "speaking") {
        testData.voice_id = voiceName;
        testData.accent = accent;
      }

      const { error: insertError } = await supabase
        .from("generated_test_audio")
        .insert(testData);

      if (insertError) {
        throw new Error(`Database insert failed: ${insertError.message}`);
      }

      successCount++;
      console.log(`[Job ${jobId}] Successfully created test ${i + 1}`);

       await supabase
         .from("bulk_generation_jobs")
         .update({
           success_count: successCount,
           failure_count: failureCount,
           updated_at: new Date().toISOString(),
         })
         .eq("id", jobId);

    } catch (error) {
      failureCount++;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      errorLog.push({ index: i, error: errorMessage });
      console.error(`[Job ${jobId}] Failed test ${i + 1}:`, errorMessage);

       await supabase
         .from("bulk_generation_jobs")
         .update({
           success_count: successCount,
           failure_count: failureCount,
           error_log: errorLog,
           updated_at: new Date().toISOString(),
         })
         .eq("id", jobId);
    }

    // Delay between generations to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await supabase
    .from("bulk_generation_jobs")
    .update({
      status: cancelled ? "cancelled" : failureCount === quantity ? "failed" : "completed",
      success_count: successCount,
      failure_count: failureCount,
      error_log: errorLog,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  console.log(`[Job ${jobId}] Completed: ${successCount} success, ${failureCount} failed`);
}

// Get question types for rotation
function getQuestionTypesForModule(module: string, selectedType: string): string[] {
  if (selectedType !== "mixed") {
    return [selectedType];
  }

  switch (module) {
    case "reading":
      return [
        "TRUE_FALSE_NOT_GIVEN",
        "MULTIPLE_CHOICE_SINGLE",
        "MULTIPLE_CHOICE_MULTIPLE",
        "MATCHING_HEADINGS",
        "SENTENCE_COMPLETION",
        "SUMMARY_WORD_BANK",
        "SHORT_ANSWER",
        "TABLE_COMPLETION",
      ];
    case "listening":
      return [
        "FILL_IN_BLANK",
        "MULTIPLE_CHOICE_SINGLE",
        "MULTIPLE_CHOICE_MULTIPLE",
        "TABLE_COMPLETION",
        "NOTE_COMPLETION",
        "MATCHING_CORRECT_LETTER",
      ];
    case "writing":
      return ["TASK_1", "TASK_2"];
    case "speaking":
      return ["FULL_TEST"];
    default:
      return ["mixed"];
  }
}

// Generate content using Lovable AI Gateway
async function generateContent(
  module: string,
  topic: string,
  difficulty: string,
  questionType: string,
  monologue: boolean,
  voiceName?: string
): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY not configured");
  }

  const prompt = getPromptForModule(module, topic, difficulty, questionType, monologue, voiceName);

  const response = await fetchWithTimeout(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are an expert IELTS test creator. Generate high-quality, authentic exam content. Always respond with valid JSON only, no markdown code blocks.",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
    90_000
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI generation failed: ${response.status} - ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const contentText = data.choices?.[0]?.message?.content;

  if (!contentText) {
    throw new Error("Empty AI response");
  }

  // Parse JSON from response
  let jsonContent = contentText;
  if (contentText.includes("```json")) {
    jsonContent = contentText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  } else if (contentText.includes("```")) {
    jsonContent = contentText.replace(/```\n?/g, "");
  }

  try {
    return JSON.parse(jsonContent.trim());
  } catch (parseError) {
    console.error("JSON parse error:", parseError, "Content:", jsonContent.slice(0, 500));
    throw new Error("Failed to parse AI response as JSON");
  }
}

// Get prompt based on module and question type
function getPromptForModule(
  module: string,
  topic: string,
  difficulty: string,
  questionType: string,
  monologue: boolean,
  voiceName?: string
): string {
  const difficultyDesc = difficulty === "easy" ? "Band 5.5-6.5" : difficulty === "medium" ? "Band 7-8" : "Band 8.5-9";
  // MCMA uses 3 questions (user selects 3 answers), all other types use 7
  const questionCount = questionType === "MULTIPLE_CHOICE_MULTIPLE" ? 3 : 7;
  const paragraphCount = 4; // Fixed per requirements

  switch (module) {
    case "reading":
      return getReadingPrompt(topic, difficultyDesc, questionType, questionCount, paragraphCount);
    case "listening":
      return getListeningPrompt(topic, difficultyDesc, questionType, questionCount, monologue, voiceName);
    case "writing":
      return getWritingPrompt(topic, difficultyDesc, questionType);
    case "speaking":
      return getSpeakingPrompt(topic, difficultyDesc, questionType);
    default:
      throw new Error(`Unknown module: ${module}`);
  }
}

function getReadingPrompt(topic: string, difficulty: string, questionType: string, questionCount: number, paragraphCount: number): string {
  const paragraphLabels = Array.from({ length: paragraphCount }, (_, i) => 
    String.fromCharCode(65 + i)
  ).map(l => `[${l}]`).join(", ");

  const basePrompt = `Generate an IELTS Academic Reading test with:
Topic: ${topic}
Difficulty: ${difficulty}

Create a reading passage with:
- ${paragraphCount} paragraphs labeled ${paragraphLabels}
- Each paragraph 80-150 words
- Academic tone, well-structured
- Contains specific testable information

`;

  switch (questionType) {
    case "TRUE_FALSE_NOT_GIVEN":
    case "YES_NO_NOT_GIVEN":
      return basePrompt + `Create ${questionCount} ${questionType === "YES_NO_NOT_GIVEN" ? "Yes/No/Not Given" : "True/False/Not Given"} questions.

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage with [A], [B], etc."},
  "instruction": "Do the following statements agree with the information given?",
  "questions": [
    {"question_number": 1, "question_text": "Statement", "correct_answer": "${questionType === "YES_NO_NOT_GIVEN" ? "YES" : "TRUE"}", "explanation": "Why"}
  ]
}`;

    case "MULTIPLE_CHOICE_SINGLE":
      return basePrompt + `Create ${questionCount} multiple choice questions (single answer).

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage"},
  "instruction": "Choose the correct letter, A, B, C or D.",
  "questions": [
    {"question_number": 1, "question_text": "Question?", "options": ["A Option", "B Option", "C Option", "D Option"], "correct_answer": "A", "explanation": "Why"}
  ]
}`;

    case "MULTIPLE_CHOICE_MULTIPLE":
      // For MCMA: Generate 1 question set spanning question numbers 1-3
      // User selects 3 correct answers from 6 options (A-F)
      return basePrompt + `Create a multiple choice question set where the test-taker must choose THREE correct answers from six options (A-F).

CRITICAL REQUIREMENTS:
- This question set spans Questions 1 to 3 (3 question numbers)
- Generate exactly 6 options (A through F)
- Generate exactly 3 correct answer letters (e.g., "A,C,E")
- Return exactly 3 question objects with question_number 1, 2, and 3
- ALL 3 question objects must have IDENTICAL content (same question_text, same options, same correct_answer)
- The correct_answer is a comma-separated list of 3 letters (e.g., "A,C,E")
- DO NOT always use A,C,E - randomize which 3 options are correct

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage with paragraph labels [A], [B], etc."},
  "instruction": "Questions 1-3. Choose THREE letters, A-F.",
  "max_answers": 3,
  "questions": [
    {
      "question_number": 1,
      "question_text": "Which THREE of the following statements are true according to the passage?",
      "options": ["A First statement", "B Second statement", "C Third statement", "D Fourth statement", "E Fifth statement", "F Sixth statement"],
      "correct_answer": "A,C,E",
      "max_answers": 3,
      "explanation": "A is correct because..., C is correct because..., E is correct because..."
    },
    {
      "question_number": 2,
      "question_text": "Which THREE of the following statements are true according to the passage?",
      "options": ["A First statement", "B Second statement", "C Third statement", "D Fourth statement", "E Fifth statement", "F Sixth statement"],
      "correct_answer": "A,C,E",
      "max_answers": 3,
      "explanation": "A is correct because..., C is correct because..., E is correct because..."
    },
    {
      "question_number": 3,
      "question_text": "Which THREE of the following statements are true according to the passage?",
      "options": ["A First statement", "B Second statement", "C Third statement", "D Fourth statement", "E Fifth statement", "F Sixth statement"],
      "correct_answer": "A,C,E",
      "max_answers": 3,
      "explanation": "A is correct because..., C is correct because..., E is correct because..."
    }
  ]
}`;

    case "MATCHING_HEADINGS":
      return basePrompt + `Create a matching headings task with ${questionCount} paragraphs needing headings.

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage with [A], [B], etc."},
  "instruction": "Choose the correct heading for each paragraph.",
  "headings": ["i Heading 1", "ii Heading 2", "iii Heading 3", "iv Heading 4", "v Heading 5", "vi Heading 6", "vii Heading 7", "viii Extra heading"],
  "questions": [
    {"question_number": 1, "question_text": "Paragraph A", "correct_answer": "ii", "explanation": "Why"}
  ]
}`;

    case "SENTENCE_COMPLETION":
      return basePrompt + `Create ${questionCount} sentence completion questions.

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage"},
  "instruction": "Complete the sentences. Write NO MORE THAN THREE WORDS.",
  "questions": [
    {"question_number": 1, "question_text": "The main advantage is _____.", "correct_answer": "increased efficiency", "explanation": "Why"}
  ]
}`;

    case "SUMMARY_COMPLETION":
    case "SUMMARY_WORD_BANK":
      return basePrompt + `Create a summary completion task with a word bank.
The summary_text should have gaps marked with {{1}}, {{2}}, {{3}} etc.
Create 4-6 questions where each correct_answer is a letter (A-H) from the word_bank.

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage with paragraph labels [A], [B], etc."},
  "instruction": "Complete the summary using the list of words, A-H, below.",
  "summary_text": "The passage discusses how {{1}} affects modern society. Scientists have found that {{2}} plays a crucial role. Furthermore, {{3}} has been identified as key, while {{4}} remains a concern.",
  "word_bank": [
    {"id": "A", "text": "technology"},
    {"id": "B", "text": "environment"},
    {"id": "C", "text": "research"},
    {"id": "D", "text": "education"},
    {"id": "E", "text": "climate"},
    {"id": "F", "text": "innovation"},
    {"id": "G", "text": "development"},
    {"id": "H", "text": "resources"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Gap 1", "correct_answer": "A", "explanation": "Technology is discussed as affecting society"},
    {"question_number": 2, "question_text": "Gap 2", "correct_answer": "C", "explanation": "Research is mentioned as crucial"},
    {"question_number": 3, "question_text": "Gap 3", "correct_answer": "E", "explanation": "Climate is identified as key factor"},
    {"question_number": 4, "question_text": "Gap 4", "correct_answer": "B", "explanation": "Environment remains a concern"}
  ]
}`;

    case "TABLE_COMPLETION":
      return basePrompt + `Create a table completion task with ${questionCount} blanks to fill.

CRITICAL RULES - FOLLOW EXACTLY:
1. WORD LIMIT: Maximum THREE words per answer. STRICTLY ENFORCED.
   - Every answer MUST be 1, 2, or 3 words maximum
   - NEVER use 4+ word answers - this violates IELTS standards
   - Vary the lengths naturally: mix of 1-word, 2-word, and 3-word answers
   - Example valid answers: "pollution" (1 word), "water supply" (2 words), "clean water supply" (3 words)
   - Example INVALID: "the clean water supply" (4 words - NEVER DO THIS)
2. Tables MUST have EXACTLY 3 COLUMNS (no more, no less).
3. Use inline blanks with __ (double underscores) within cell content, NOT separate cells for blanks.
   - Example: "Clean air and water, pollination of crops, and __" where __ is the blank
4. DISTRIBUTE blanks across BOTH column 2 AND column 3. Do NOT put all blanks only in column 2.
   - Alternate between putting blanks in the 2nd column and the 3rd column
   - At least 1/3 of blanks MUST be in the 3rd column

Return ONLY valid JSON in this exact format:
{
  "passage": {"title": "Title", "content": "Full passage with paragraph labels [A], [B], etc."},
  "instruction": "Complete the table below. Choose NO MORE THAN THREE WORDS from the passage for each answer.",
  "table_data": [
    [{"content": "Category", "is_header": true}, {"content": "Details", "is_header": true}, {"content": "Impact/Challenge", "is_header": true}],
    [{"content": "First item"}, {"content": "Description text and __", "has_question": true, "question_number": 1}, {"content": "Positive effect"}],
    [{"content": "Second item"}, {"content": "More text here"}, {"content": "Results in __", "has_question": true, "question_number": 2}],
    [{"content": "Third item"}, {"content": "Additional info about __", "has_question": true, "question_number": 3}, {"content": "Significant"}],
    [{"content": "Fourth item"}, {"content": "Details here"}, {"content": "Has __", "has_question": true, "question_number": 4}],
    [{"content": "Fifth item"}, {"content": "Uses __ method", "has_question": true, "question_number": 5}, {"content": "Effective"}]
  ],
  "questions": [
    {"question_number": 1, "question_text": "Fill in blank 1", "correct_answer": "resources", "explanation": "Found in paragraph B"},
    {"question_number": 2, "question_text": "Fill in blank 2", "correct_answer": "water scarcity", "explanation": "Found in paragraph C"},
    {"question_number": 3, "question_text": "Fill in blank 3", "correct_answer": "deforestation", "explanation": "Found in paragraph D"},
    {"question_number": 4, "question_text": "Fill in blank 4", "correct_answer": "limitations", "explanation": "Found in paragraph E"},
    {"question_number": 5, "question_text": "Fill in blank 5", "correct_answer": "solar", "explanation": "Found in paragraph A"}
  ]
}`;

    case "SHORT_ANSWER":
      return basePrompt + `Create ${questionCount} short answer questions.

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage"},
  "instruction": "Answer the questions. Write NO MORE THAN THREE WORDS.",
  "questions": [
    {"question_number": 1, "question_text": "What was the main finding?", "correct_answer": "carbon emissions", "explanation": "Why"}
  ]
}`;

    default:
      return basePrompt + `Create ${questionCount} True/False/Not Given questions.

Return ONLY valid JSON:
{
  "passage": {"title": "Title", "content": "Full passage"},
  "instruction": "Do the following statements agree with the information given?",
  "questions": [
    {"question_number": 1, "question_text": "Statement", "correct_answer": "TRUE", "explanation": "Why"}
  ]
}`;
  }
}

function getListeningPrompt(topic: string, difficulty: string, questionType: string, questionCount: number, monologue: boolean, voiceName?: string): string {
  // TEMPORARY: 1 minute audio for testing (revert to 300-500 words / 4 minutes for production)
  
  // Build gender constraint if voice is provided
  const genderConstraint = voiceName ? buildGenderConstraint(voiceName, !monologue) : '';
  
  const speakerInstructions = monologue
    ? `Create a monologue (single speaker) script that is:
- 100-150 words (approximately 1 minute when spoken)
- Use "Speaker1:" prefix for all lines
- Include speaker_names: {"Speaker1": "Role/Name"}`
    : `Create a dialogue between two people that is:
- 100-150 words (approximately 1 minute when spoken)
- Use "Speaker1:" and "Speaker2:" prefixes
- Include speaker_names: {"Speaker1": "Name", "Speaker2": "Name"}`;

  // NATURAL GAP POSITIONING INSTRUCTION
  const gapPositionInstruction = `
CRITICAL - NATURAL GAP/BLANK POSITIONING:
For fill-in-the-blank questions, you MUST randomize the position of the missing word (represented by _____):
- 30% of questions: Blank should be near the START of the sentence (e.g., "_____ is the main attraction.")
- 40% of questions: Blank should be in the MIDDLE of the sentence (e.g., "The event starts at _____ on Saturday.")
- 30% of questions: Blank should be at the END of the sentence (e.g., "Visitors should bring _____.")
- Ensure the sentence context makes the missing word deducible from the audio.
- NEVER put all blanks at the same position - vary them naturally across questions.`;

  const basePrompt = `Generate an IELTS Listening test section:
Topic: ${topic}
Difficulty: ${difficulty}
${genderConstraint}

${speakerInstructions}
- Natural conversation with realistic names/roles
- Contains specific details (names, numbers, dates, locations)
- Use natural, short pauses: <break time='500ms'/> between sentences. NEVER use pauses longer than 1 second.

`;

  switch (questionType) {
    case "FILL_IN_BLANK":
      return basePrompt + `Create ${questionCount} fill-in-the-blank questions.
${gapPositionInstruction}

CRITICAL NEGATIVE CONSTRAINT: You are PROHIBITED from placing the blank at the very end of the sentence more than 30% of the time. Vary positions naturally.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Welcome to the museum.<break time='500ms'/>\\nSpeaker2: Thank you for having me...",
  "speaker_names": {"Speaker1": "Guide", "Speaker2": "Visitor"},
  "instruction": "Complete the notes. Write NO MORE THAN THREE WORDS.",
  "questions": [
    {"question_number": 1, "question_text": "_____ is located near the entrance.", "correct_answer": "The gift shop", "explanation": "Speaker mentions location (START gap)"},
    {"question_number": 2, "question_text": "The tour starts at _____ each morning.", "correct_answer": "9:30 AM", "explanation": "Speaker mentions time (MIDDLE gap)"},
    {"question_number": 3, "question_text": "Visitors should bring _____.", "correct_answer": "comfortable shoes", "explanation": "Speaker recommends footwear (END gap)"}
  ]
}`;

    case "MULTIPLE_CHOICE_SINGLE":
      return basePrompt + `Create ${questionCount} multiple choice questions (single answer).

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Let me explain...<break time='500ms'/>",
  "speaker_names": {"Speaker1": "Instructor"},
  "instruction": "Choose the correct letter, A, B or C.",
  "questions": [
    {"question_number": 1, "question_text": "What is the main topic?", "options": ["A First", "B Second", "C Third"], "correct_answer": "A", "explanation": "Why"}
  ]
}`;

    case "MULTIPLE_CHOICE_MULTIPLE":
      // MCMA for Listening presets must be the same UX as Reading MCMA:
      // Questions 1-3 are a SINGLE checkbox task (select 3 answers from A-F).
      // We duplicate the same question object 3 times so the UI can label the range consistently.
      return basePrompt + `Create ONE multiple choice question set where the test-taker must choose THREE correct answers from six options (A-F).

CRITICAL REQUIREMENTS:
- This question set spans Questions 1 to 3 (3 question numbers)
- Return EXACTLY 3 question objects with question_number 1, 2, and 3
- ALL 3 question objects must have IDENTICAL content (same question_text, same options, same correct_answer)
- Provide exactly 6 options labeled A-F
- correct_answer MUST be a comma-separated list of exactly 3 letters (e.g., "A,C,E")
- Set max_answers to 3
- The statements MUST be clearly supported by the dialogue (so answers are objectively checkable)

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: ...<break time='500ms'/>\nSpeaker2: ...",
  "speaker_names": {"Speaker1": "Name", "Speaker2": "Name"},
  "instruction": "Questions 1-3. Choose THREE letters, A-F.",
  "max_answers": 3,
  "questions": [
    {
      "question_number": 1,
      "question_text": "Which THREE of the following statements are correct?",
      "options": ["A ...", "B ...", "C ...", "D ...", "E ...", "F ..."],
      "correct_answer": "A,C,E",
      "max_answers": 3,
      "explanation": "A is correct because... C is correct because... E is correct because..."
    },
    {
      "question_number": 2,
      "question_text": "Which THREE of the following statements are correct?",
      "options": ["A ...", "B ...", "C ...", "D ...", "E ...", "F ..."],
      "correct_answer": "A,C,E",
      "max_answers": 3,
      "explanation": "A is correct because... C is correct because... E is correct because..."
    },
    {
      "question_number": 3,
      "question_text": "Which THREE of the following statements are correct?",
      "options": ["A ...", "B ...", "C ...", "D ...", "E ...", "F ..."],
      "correct_answer": "A,C,E",
      "max_answers": 3,
      "explanation": "A is correct because... C is correct because... E is correct because..."
    }
  ]
}`;

    case "TABLE_COMPLETION":
      return basePrompt + `Create a table completion task with ${questionCount} blanks.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Here's the schedule...<break time='500ms'/>",
  "speaker_names": {"Speaker1": "Coordinator"},
  "instruction": "Complete the table below.",
  "table_data": {
    "headers": ["Event", "Time", "Location"],
    "rows": [
      [{"text": "Opening"}, {"text": "9:00 AM"}, {"isBlank": true, "questionNumber": 1}]
    ]
  },
  "questions": [
    {"question_number": 1, "question_text": "Location", "correct_answer": "Main Hall", "explanation": "Why"}
  ]
}`;

    case "NOTE_COMPLETION":
      return basePrompt + `Create a note completion task with ${questionCount} blanks.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: The key points are...<break time='500ms'/>",
  "speaker_names": {"Speaker1": "Lecturer"},
  "instruction": "Complete the notes below.",
  "note_sections": [
    {"title": "Main Topic", "items": [{"text_before": "Focus is on", "question_number": 1, "text_after": ""}]}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Note 1", "correct_answer": "research methods", "explanation": "Why"}
  ]
}`;

    case "MATCHING_CORRECT_LETTER":
      return basePrompt + `Create ${questionCount} matching questions.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Each department has...<break time='500ms'/>",
  "speaker_names": {"Speaker1": "Manager"},
  "instruction": "Match each person to their department.",
  "options": [{"letter": "A", "text": "Marketing"}, {"letter": "B", "text": "Finance"}, {"letter": "C", "text": "HR"}],
  "questions": [
    {"question_number": 1, "question_text": "John works in", "correct_answer": "A", "explanation": "Why"}
  ]
}`;

    default:
      return basePrompt + `Create ${questionCount} fill-in-the-blank questions.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: dialogue...<break time='500ms'/>\\nSpeaker2: response...",
  "speaker_names": {"Speaker1": "Host", "Speaker2": "Guest"},
  "instruction": "Complete the notes below.",
  "questions": [
    {"question_number": 1, "question_text": "The event is in _____.", "correct_answer": "main garden", "explanation": "Why"}
  ]
}`;
  }
}

function getWritingPrompt(topic: string, difficulty: string, taskType: string): string {
  if (taskType === "TASK_1") {
    return `Generate an IELTS Academic Writing Task 1:
Topic: ${topic}
Difficulty: ${difficulty}

Return ONLY valid JSON:
{
  "task_type": "TASK_1",
  "instruction": "The chart below shows...",
  "chart_description": "Description of the data visualization",
  "chart_data": {
    "type": "bar|line|pie",
    "title": "Chart title",
    "labels": ["Label1", "Label2"],
    "datasets": [{"label": "Series1", "data": [10, 20, 30]}]
  },
  "model_answer": "A band 8-9 sample answer (150+ words)...",
  "word_limit_min": 150,
  "key_features": ["Feature 1", "Feature 2", "Feature 3"]
}`;
  } else {
    return `Generate an IELTS Writing Task 2:
Topic: ${topic}
Difficulty: ${difficulty}

Return ONLY valid JSON:
{
  "task_type": "TASK_2",
  "instruction": "Some people believe that... To what extent do you agree or disagree?",
  "essay_type": "opinion|discussion|problem_solution|two_part",
  "model_answer": "A band 8-9 sample essay (250+ words)...",
  "word_limit_min": 250,
  "key_points": ["Point 1", "Point 2", "Point 3"],
  "vocabulary_suggestions": ["word1", "word2", "word3"]
}`;
  }
}

function getSpeakingPrompt(topic: string, difficulty: string, questionType: string): string {
  const includeParts = questionType === "FULL_TEST" 
    ? "all three parts (Part 1, 2, and 3)"
    : questionType === "PART_1" ? "Part 1 only"
    : questionType === "PART_2" ? "Part 2 only"
    : "Part 3 only";

  return `Generate an IELTS Speaking test for ${includeParts}:
Topic: ${topic}
Difficulty: ${difficulty}

Return ONLY valid JSON:
{
  "part1": {
    "instruction": "I'd like to ask you some questions about yourself.",
    "questions": ["Question 1?", "Question 2?", "Question 3?", "Question 4?"],
    "sample_answers": ["Sample 1", "Sample 2", "Sample 3", "Sample 4"]
  },
  "part2": {
    "instruction": "Now I'm going to give you a topic.",
    "cue_card": "Describe a [topic]...\\nYou should say:\\n- point 1\\n- point 2\\n- point 3\\nAnd explain why...",
    "preparation_time": 60,
    "speaking_time": 120,
    "sample_answer": "Model answer (200-250 words)..."
  },
  "part3": {
    "instruction": "Let's discuss some more general questions.",
    "questions": ["Discussion Q1?", "Discussion Q2?", "Discussion Q3?"],
    "sample_answers": ["Sample 1", "Sample 2", "Sample 3"]
  }
}`;
}

// Direct Gemini TTS call using api_keys table with FULL retry across ALL available keys
async function generateGeminiTtsDirect(
  supabaseServiceClient: any,
  text: string,
  voiceName: string
): Promise<{ audioBase64: string; sampleRate: number }> {
  // Ensure we have API keys cached
  if (apiKeyCache.length === 0) {
    apiKeyCache = await getActiveGeminiKeys(supabaseServiceClient);
    if (apiKeyCache.length === 0) {
      throw new Error("No active Gemini API keys available in api_keys table");
    }
  }

  const prompt = `You are an IELTS Speaking examiner with a neutral British accent.\n\nRead aloud EXACTLY the following text. Do not add, remove, or paraphrase anything. Use natural pacing and clear pronunciation.\n\n"""\n${text}\n"""`;

  // Try ALL available API keys - if one fails, move to the next
  let lastError: Error | null = null;
  const keysToTry = apiKeyCache.length; // Try ALL keys, not just 3
  const triedKeyIds = new Set<string>();
  
  for (let i = 0; i < keysToTry; i++) {
    const keyRecord = getNextApiKey();
    if (!keyRecord || triedKeyIds.has(keyRecord.id)) continue;
    triedKeyIds.add(keyRecord.id);
    
    try {
      const resp = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${keyRecord.key_value}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
        },
        90_000
      );

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`Gemini TTS error with key ${keyRecord.id}:`, resp.status, errorText.slice(0, 200));
        
        // Track error for this key - deactivate on auth errors
        await incrementKeyErrorCount(supabaseServiceClient, keyRecord.id, resp.status === 401 || resp.status === 403);
        lastError = new Error(`Gemini TTS failed (${resp.status})`);
        // Continue to next key
        continue;
      }

      const data = await resp.json();
      const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data as string | undefined;
      
      if (!audioData) {
        lastError = new Error("No audio returned from Gemini TTS");
        continue;
      }
      
      // Success - reset error count
      await resetKeyErrorCount(supabaseServiceClient, keyRecord.id);
      
      return { audioBase64: audioData, sampleRate: 24000 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`Gemini TTS attempt with key ${keyRecord.id} failed:`, lastError.message);
      // Continue to next key
    }
  }

  throw lastError || new Error("All Gemini API keys failed");
}

async function generateGeminiTtsMultiSpeaker(
  supabaseServiceClient: any,
  text: string,
  voices: { Speaker1: string; Speaker2: string }
): Promise<{ audioBase64: string; sampleRate: number }> {
  if (apiKeyCache.length === 0) {
    apiKeyCache = await getActiveGeminiKeys(supabaseServiceClient);
    if (apiKeyCache.length === 0) {
      throw new Error("No active Gemini API keys available in api_keys table");
    }
  }

  const prompt = `Read the following IELTS Listening dialogue naturally.
- Do NOT speak the labels "Speaker1" or "Speaker2" out loud.
- Keep a short pause between turns.
- Speak clearly at a moderate pace.

${text}`;

  let lastError: Error | null = null;
  const keysToTry = apiKeyCache.length;
  const triedKeyIds = new Set<string>();

  for (let i = 0; i < keysToTry; i++) {
    const keyRecord = getNextApiKey();
    if (!keyRecord || triedKeyIds.has(keyRecord.id)) continue;
    triedKeyIds.add(keyRecord.id);

    try {
      const resp = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${keyRecord.key_value}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: [
                    {
                      speaker: "Speaker1",
                      voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.Speaker1 } },
                    },
                    {
                      speaker: "Speaker2",
                      voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.Speaker2 } },
                    },
                  ],
                },
              },
            },
          }),
        },
        90_000
      );

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(
          `Gemini multi-speaker TTS error with key ${keyRecord.id}:`,
          resp.status,
          errorText.slice(0, 200)
        );
        await incrementKeyErrorCount(
          supabaseServiceClient,
          keyRecord.id,
          resp.status === 401 || resp.status === 403
        );
        lastError = new Error(`Gemini multi-speaker TTS failed (${resp.status})`);
        continue;
      }

      const data = await resp.json();
      const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data as string | undefined;

      if (!audioData) {
        lastError = new Error("No audio returned from Gemini multi-speaker TTS");
        continue;
      }

      await resetKeyErrorCount(supabaseServiceClient, keyRecord.id);
      return { audioBase64: audioData, sampleRate: 24000 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `Gemini multi-speaker TTS attempt with key ${keyRecord.id} failed:`,
        lastError.message
      );
    }
  }

  throw lastError || new Error("All Gemini API keys failed (multi-speaker)");
}

// Generate and upload audio for listening tests
async function generateAndUploadAudio(
  supabaseServiceClient: any,
  text: string,
  speaker1Voice: string,
  speaker2Voice: string | undefined,
  monologue: boolean,
  jobId: string,
  index: number
): Promise<string> {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\[pause\s*\d*s?\]/gi, "...")
    .trim();

  const isDialogue = !monologue && /Speaker1\s*:/i.test(normalized) && /Speaker2\s*:/i.test(normalized);

  // Keep speaker turn boundaries for multi-speaker TTS
  let cleanText = normalized;
  if (isDialogue) {
    cleanText = cleanText
      // Ensure each speaker label starts on a new line
      .replace(/\s*(Speaker1\s*:)/gi, "\n$1")
      .replace(/\s*(Speaker2\s*:)/gi, "\n$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    cleanText = cleanText
      .replace(/\n+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  cleanText = cleanText.slice(0, 5000).trim();

  if (!cleanText) {
    throw new Error("Empty text for TTS");
  }

  // Use multi-speaker Gemini TTS when we detect Speaker1/Speaker2 dialogue
  const { audioBase64, sampleRate } = isDialogue && speaker2Voice
    ? await generateGeminiTtsMultiSpeaker(supabaseServiceClient, cleanText, {
        Speaker1: speaker1Voice,
        Speaker2: speaker2Voice,
      })
    : await generateGeminiTtsDirect(supabaseServiceClient, cleanText, speaker1Voice);

  // Convert base64 PCM to standard 16-bit WAV (full quality, no Mu-Law)
  const { createPcmWav } = await import("../_shared/pcmToWav.ts");
  const { uploadToR2 } = await import("../_shared/r2Client.ts");

  const pcmBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const wavBytes = createPcmWav(pcmBytes, sampleRate);
  // Admin audio goes to "presets/" folder for permanent storage
  const key = `presets/${jobId}/${index}.wav`;

  const uploadResult = await uploadToR2(key, wavBytes, "audio/wav");

  if (!uploadResult.success || !uploadResult.url) {
    throw new Error(uploadResult.error || "R2 upload failed");
  }

  return uploadResult.url;
}

// Parallel processing helper with concurrency limit
async function processWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await fn(items[currentIndex]);
      } catch (err) {
        // Store null for failed items - caller handles
        results[currentIndex] = null as unknown as R;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Generate speaking audio for instructions and questions (PARALLELIZED)
async function generateSpeakingAudio(
  supabaseServiceClient: any,
  content: any,
  voiceName: string,
  jobId: string,
  index: number
): Promise<Record<string, string> | null> {
  const ttsItems: Array<{ key: string; text: string }> = [];
  
  // Collect all texts that need TTS
  if (content.part1) {
    if (content.part1.instruction) {
      ttsItems.push({ key: "part1_instruction", text: content.part1.instruction });
    }
    content.part1.questions?.forEach((q: string, idx: number) => {
      ttsItems.push({ key: `part1_q${idx + 1}`, text: q });
    });
  }
  
  if (content.part2) {
    const part2Instruction = "Now, I'm going to give you a topic. You'll have one minute to prepare, then speak for one to two minutes.";
    ttsItems.push({ key: "part2_instruction", text: part2Instruction });
    
    if (content.part2.cue_card) {
      const topic = content.part2.cue_card.split('\n')[0] || content.part2.cue_card;
      ttsItems.push({ key: "part2_cuecard_topic", text: `Your topic is: ${topic}` });
    }
    
    ttsItems.push({ 
      key: "part2_start_speaking", 
      text: "Your preparation time is over. Please start speaking now." 
    });
  }
  
  if (content.part3) {
    const part3Instruction = "Now let's discuss some more general questions related to this topic.";
    ttsItems.push({ key: "part3_instruction", text: part3Instruction });
    
    content.part3.questions?.forEach((q: string, idx: number) => {
      ttsItems.push({ key: `part3_q${idx + 1}`, text: q });
    });
  }
  
  ttsItems.push({ key: "test_ending", text: "Thank you. That is the end of the speaking test." });
  
  if (ttsItems.length === 0) {
    return null;
  }

  console.log(`[Job ${jobId}] Generating audio for ${ttsItems.length} speaking items using PARALLEL Gemini TTS`);

  // Standard 16-bit PCM WAV (full quality, no Mu-Law degradation)
  const { createPcmWav } = await import("../_shared/pcmToWav.ts");
  const { uploadToR2 } = await import("../_shared/r2Client.ts");

  // Process TTS items in parallel with concurrency limit (use all available API keys efficiently)
  const concurrency = Math.min(apiKeyCache.length || 3, 5);
  
  const results = await processWithConcurrency(
    ttsItems,
    async (item) => {
      try {
        const { audioBase64, sampleRate } = await generateGeminiTtsDirect(
          supabaseServiceClient,
          item.text,
          voiceName
        );

        const pcmBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
        const wavBytes = createPcmWav(pcmBytes, sampleRate);
        // Admin speaking audio goes to "presets/" folder for permanent storage
        const key = `presets/speaking/${jobId}/${index}/${item.key}.wav`;

        const uploadResult = await uploadToR2(key, wavBytes, "audio/wav");
        if (uploadResult.success && uploadResult.url) {
          return { key: item.key, url: uploadResult.url };
        }
        return null;
      } catch (err) {
        console.warn(`[Job ${jobId}] Failed TTS for ${item.key}:`, err);
        return null;
      }
    },
    concurrency
  );

  const audioUrls: Record<string, string> = {};
  results.forEach((r) => {
    if (r && r.key && r.url) {
      audioUrls[r.key] = r.url;
    }
  });

  console.log(`[Job ${jobId}] Generated ${Object.keys(audioUrls).length}/${ttsItems.length} speaking audio files`);
  return Object.keys(audioUrls).length > 0 ? audioUrls : null;
}

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil?: (promise: Promise<any>) => void;
} | undefined;
