import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gemini-api-key',
};

// ============================================================================
// CREDIT SYSTEM - Cost Map and Daily Limits
// ============================================================================
const COSTS = {
  // GENERATION
  'generate_speaking': 5,
  'generate_writing': 5,
  'generate_listening': 20,
  'generate_reading': 20,
  // EVALUATION
  'evaluate_speaking': 15,
  'evaluate_writing': 10,
  'evaluate_reading': 0,    // FREE
  'evaluate_listening': 0,  // FREE
  // CHAT
  'explain_answer': 2
};

const DAILY_CREDIT_LIMIT = 100;

// ============================================================================
// ATOMIC CREDIT FUNCTIONS - Uses DB functions to prevent race conditions
// ============================================================================

// Check and RESERVE credits atomically BEFORE calling AI
// This prevents the "rapid click attack" where parallel requests bypass limits
async function checkAndReserveCredits(
  serviceClient: any, 
  userId: string, 
  operationType: keyof typeof COSTS
): Promise<{ ok: boolean; error?: string; creditsUsed?: number; creditsRemaining?: number }> {
  const cost = COSTS[operationType] || 0;
  
  // Free operations always pass
  if (cost === 0) {
    return { ok: true, creditsUsed: 0, creditsRemaining: DAILY_CREDIT_LIMIT };
  }
  
  try {
    // Call atomic DB function that locks the row and reserves credits
    const { data, error } = await serviceClient.rpc('check_and_reserve_credits', {
      p_user_id: userId,
      p_cost: cost
    });
    
    if (error) {
      console.error('check_and_reserve_credits RPC error:', error);
      // Fail open - allow operation if RPC fails
      return { ok: true, creditsUsed: 0, creditsRemaining: DAILY_CREDIT_LIMIT };
    }
    
    console.log(`Credit check result for ${operationType} (cost ${cost}):`, data);
    
    if (!data.ok) {
      return {
        ok: false,
        error: data.error || `Daily credit limit reached. Add your own Gemini API key in Settings.`,
        creditsUsed: data.credits_used,
        creditsRemaining: data.credits_remaining
      };
    }
    
    return {
      ok: true,
      creditsUsed: data.credits_used,
      creditsRemaining: data.credits_remaining
    };
  } catch (err) {
    console.error('Error in atomic credit check:', err);
    // Fail open - allow operation
    return { ok: true, creditsUsed: 0, creditsRemaining: DAILY_CREDIT_LIMIT };
  }
}

// Refund credits if the AI operation fails AFTER we reserved them
async function refundCredits(
  serviceClient: any, 
  userId: string, 
  operationType: keyof typeof COSTS
): Promise<void> {
  const cost = COSTS[operationType] || 0;
  if (cost === 0) return;
  
  try {
    const { error } = await serviceClient.rpc('refund_credits', {
      p_user_id: userId,
      p_cost: cost
    });
    
    if (error) {
      console.error('refund_credits RPC error:', error);
    } else {
      console.log(`Refunded ${cost} credits for failed ${operationType}`);
    }
  } catch (err) {
    console.error('Failed to refund credits:', err);
  }
}

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
let lastTokensUsed: number = 0;
let isQuotaExceeded: boolean = false;

// DB-managed API key interface
interface ApiKeyRecord {
  id: string;
  provider: string;
  key_value: string;
  is_active: boolean;
  error_count: number;
}

// Fetch active Gemini keys from api_keys table with rotation support
async function getActiveGeminiKeys(supabaseServiceClient: any): Promise<ApiKeyRecord[]> {
  try {
    const { data, error } = await supabaseServiceClient
      .from('api_keys')
      .select('id, provider, key_value, is_active, error_count')
      .eq('provider', 'gemini')
      .eq('is_active', true)
      .order('error_count', { ascending: true }); // Prioritize keys with fewer errors
    
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

// Increment error count for a failed key
async function incrementKeyErrorCount(supabaseServiceClient: any, keyId: string, deactivate: boolean = false): Promise<void> {
  try {
    const update: any = { 
      error_count: deactivate ? 999 : undefined,
      is_active: deactivate ? false : undefined,
    };
    
    // Use raw increment if not deactivating
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

// Reset error count on successful use
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

// Pre-flight validation: Check API key validity without consuming generation quota
// Uses a lightweight models/list call instead of a generation request
async function preflightApiCheck(apiKey: string, skipPreflight: boolean = false): Promise<{ ok: boolean; error?: string }> {
  // Allow skipping preflight when caller wants to proceed directly to main request
  if (skipPreflight) {
    console.log('Skipping pre-flight check (skipPreflight=true)');
    return { ok: true };
  }

  try {
    console.log('Running lightweight pre-flight API validation...');
    
    // Use models/list endpoint - this validates API key without consuming generation quota
    // This endpoint has much higher rate limits than generation endpoints
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorStatus = errorData?.error?.status || '';
      const errorMessage = errorData?.error?.message || '';
      
      console.error('Pre-flight check failed:', response.status, errorStatus);
      
      // Only treat 403/401 as definitive API key issues
      // 429 on list endpoint is very rare but could happen with extremely high abuse
      if (response.status === 403 || response.status === 401 || errorStatus === 'PERMISSION_DENIED') {
        return {
          ok: false,
          error: 'API_KEY_INVALID: Your Gemini API key appears to be invalid or lacks permissions. Please verify your API key in settings.',
        };
      } else if (response.status === 429 || errorStatus === 'RESOURCE_EXHAUSTED') {
        // Don't block on rate limit during pre-flight - let the main request try
        // The actual generation endpoint has separate limits
        console.warn('Pre-flight list endpoint rate-limited, proceeding to main request anyway');
        return { ok: true };
      }
      
      // For other errors, proceed anyway and let main request handle it
      console.warn(`Pre-flight returned ${response.status}, proceeding to main request`);
      return { ok: true };
    }

    console.log('Pre-flight API check passed');
    return { ok: true };
  } catch (err) {
    console.error('Pre-flight check connection error:', err);
    // Connection errors should not block - let the main request try
    console.warn('Pre-flight connection failed, proceeding to main request anyway');
    return { ok: true };
  }
}

// Update quota tracking in the database
async function updateQuotaTracking(supabase: any, userId: string, tokensUsed: number): Promise<void> {
  if (!userId || tokensUsed <= 0) return;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Check for existing record
    const { data: existingData } = await supabase
      .from('gemini_daily_usage')
      .select('id, tokens_used, requests_count')
      .eq('user_id', userId)
      .eq('usage_date', today)
      .maybeSingle();

    if (existingData) {
      // Update existing record
      await supabase
        .from('gemini_daily_usage')
        .update({
          tokens_used: existingData.tokens_used + tokensUsed,
          requests_count: existingData.requests_count + 1,
          last_updated_at: new Date().toISOString(),
        })
        .eq('id', existingData.id);
    } else {
      // Insert new record
      await supabase
        .from('gemini_daily_usage')
        .insert({
          user_id: userId,
          usage_date: today,
          tokens_used: tokensUsed,
          requests_count: 1,
        });
    }
    
    console.log(`Updated quota for user ${userId}: +${tokensUsed} tokens`);
  } catch (err) {
    console.error('Failed to update quota tracking:', err);
  }
}

// Helper function to wait with exponential backoff
async function waitWithBackoff(attempt: number, baseDelayMs: number = 1000): Promise<void> {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 30000); // Max 30 seconds
  console.log(`Waiting ${delay}ms before retry (attempt ${attempt + 1})...`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

// Simple sleep utility to prevent rate limiting between API calls
async function sleep(ms: number): Promise<void> {
  console.log(`Rate limit cooldown: waiting ${ms}ms...`);
  await new Promise(resolve => setTimeout(resolve, ms));
}

// Enhanced callGemini with DB key rotation support
// If dbKeys array is provided, will rotate through them on 429/403 errors
async function callGemini(
  apiKey: string, 
  prompt: string, 
  maxRetries: number = 2,
  options?: {
    dbKeys?: ApiKeyRecord[];
    serviceClient?: any;
    currentKeyIndex?: number;
  }
): Promise<string | null> {
  lastGeminiError = null;
  lastTokensUsed = 0;
  isQuotaExceeded = false;
  
  const dbKeys = options?.dbKeys || [];
  const serviceClient = options?.serviceClient;
  let currentKeyIndex = options?.currentKeyIndex || 0;
  let currentApiKey = apiKey;
  let currentKeyRecord: ApiKeyRecord | null = null;
  
  // If we have DB keys, use the first one
  if (dbKeys.length > 0 && currentKeyIndex < dbKeys.length) {
    currentKeyRecord = dbKeys[currentKeyIndex];
    currentApiKey = currentKeyRecord.key_value;
    console.log(`Using DB-managed key ${currentKeyIndex + 1}/${dbKeys.length}`);
  }
  
  for (const model of GEMINI_MODELS) {
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        console.log(`Trying Gemini model: ${model}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 8192,
                  // Strongly encourages the model to return valid JSON (prevents "[A] ..." non-JSON output)
                  responseMimeType: 'application/json',
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
            // Key rotation: try next DB key if available
            if (dbKeys.length > 0 && currentKeyIndex < dbKeys.length - 1) {
              console.log(`Key ${currentKeyIndex + 1} rate limited, rotating to next key...`);
              
              // Increment error count for this key
              if (serviceClient && currentKeyRecord) {
                await incrementKeyErrorCount(serviceClient, currentKeyRecord.id);
              }
              
              currentKeyIndex++;
              currentKeyRecord = dbKeys[currentKeyIndex];
              currentApiKey = currentKeyRecord.key_value;
              console.log(`Switched to DB key ${currentKeyIndex + 1}/${dbKeys.length}`);
              retryCount = 0; // Reset retry count for new key
              continue;
            }
            
            // Check if it's a rate limit that might recover with waiting
            if (retryCount < maxRetries) {
              console.log(`Rate limit hit on ${model}, will retry after backoff...`);
              await waitWithBackoff(retryCount);
              retryCount++;
              continue;
            }
            
            // All retries and keys exhausted
            isQuotaExceeded = true;
            lastGeminiError = 'QUOTA_EXCEEDED: All API keys have reached their rate limit. Please wait a few minutes and try again.';
            break;
          } else if (response.status === 403 || errorStatus === 'PERMISSION_DENIED') {
            // Key is invalid - try next DB key
            if (dbKeys.length > 0 && currentKeyIndex < dbKeys.length - 1) {
              console.log(`Key ${currentKeyIndex + 1} permission denied, rotating to next key...`);
              
              // Deactivate this key
              if (serviceClient && currentKeyRecord) {
                await incrementKeyErrorCount(serviceClient, currentKeyRecord.id, true);
              }
              
              currentKeyIndex++;
              currentKeyRecord = dbKeys[currentKeyIndex];
              currentApiKey = currentKeyRecord.key_value;
              retryCount = 0;
              continue;
            }
            
            lastGeminiError = 'API access denied. Please verify your Gemini API key is valid and has the correct permissions.';
            break;
          } else if (response.status === 400) {
            lastGeminiError = 'Invalid request to AI. The generation request was rejected. Please try again with different settings.';
            break;
          } else if (response.status >= 500) {
            if (retryCount < maxRetries) {
              console.log(`Server error on ${model}, will retry after backoff...`);
              await waitWithBackoff(retryCount);
              retryCount++;
              continue;
            }
            lastGeminiError = `AI service error (${response.status}): ${errorMessage.slice(0, 100)}`;
          } else {
            lastGeminiError = `AI service error (${response.status}): ${errorMessage.slice(0, 100)}`;
          }
          break;
        }

        const data = await response.json();
        
        // Extract token usage from response metadata
        const usageMetadata = data.usageMetadata;
        if (usageMetadata) {
          const promptTokens = usageMetadata.promptTokenCount || 0;
          const candidateTokens = usageMetadata.candidatesTokenCount || 0;
          lastTokensUsed = promptTokens + candidateTokens;
          console.log(`Token usage - Prompt: ${promptTokens}, Output: ${candidateTokens}, Total: ${lastTokensUsed}`);
        }
        
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`Success with ${model}`);
          
          // Reset error count on success
          if (serviceClient && currentKeyRecord) {
            await resetKeyErrorCount(serviceClient, currentKeyRecord.id);
          }
          
          return text;
        } else {
          const finishReason = data.candidates?.[0]?.finishReason;
          if (finishReason === 'SAFETY') {
            lastGeminiError = 'Content was filtered by safety settings. Please try a different topic.';
          } else {
            lastGeminiError = 'AI returned empty response. Please try again.';
          }
        }
        break;
      } catch (err) {
        console.error(`Error with ${model}:`, err);
        
        if (retryCount < maxRetries) {
          console.log(`Connection error on ${model}, will retry after backoff...`);
          await waitWithBackoff(retryCount);
          retryCount++;
          continue;
        }
        
        lastGeminiError = `Connection error: Unable to reach AI service. Please check your internet connection and try again.`;
        break;
      }
    }
  }
  return null;
}

// Save test to test_presets bank
async function saveToTestBank(
  serviceClient: any, 
  module: string, 
  topic: string, 
  payload: any
): Promise<boolean> {
  try {
    const { error } = await serviceClient
      .from('test_presets')
      .insert({
        module,
        topic,
        payload,
        is_published: false, // Admin must manually publish
      });
    
    if (error) {
      console.error('Failed to save to test bank:', error);
      return false;
    }
    
    console.log(`Saved ${module} test to test_presets bank`);
    return true;
  } catch (err) {
    console.error('Error saving to test bank:', err);
    return false;
  }
}

function getLastGeminiError(): string {
  return lastGeminiError || 'Failed to generate content. Please try again.';
}

function getLastTokensUsed(): number {
  return lastTokensUsed;
}

function wasQuotaExceeded(): boolean {
  return isQuotaExceeded;
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

// ============================================================================
// CHART DATA GENERATION - REMOVED
// ============================================================================
// Chart data is now generated inline with the writing task prompt using 
// Gemini's JSON mode (response_mime_type: "application/json").
// This combines the essay prompt and visual data in ONE API call to prevent
// truncation and rate limiting issues.
// Old functions removed: generateChartData, mergeTruncatedSvg, generateMapSvg,
// generateFlowchartSvg, generateWritingTask1Svg

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

// Generate TTS audio using Gemini with retry logic, configurable voices, and DB key rotation
async function generateAudio(
  apiKey: string, 
  script: string, 
  speakerConfig?: SpeakerConfigInput,
  maxRetries = 3,
  options?: {
    dbKeys?: ApiKeyRecord[];
    serviceClient?: any;
  }
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

  // DB key rotation support for TTS
  const dbKeys = options?.dbKeys || [];
  const serviceClient = options?.serviceClient;
  let currentKeyIndex = 0;
  let currentApiKey = apiKey;
  let currentKeyRecord: ApiKeyRecord | null = null;
  
  // If we have DB keys, use them for rotation
  if (dbKeys.length > 0) {
    currentKeyRecord = dbKeys[0];
    currentApiKey = currentKeyRecord.key_value;
    console.log(`TTS using DB-managed key 1/${dbKeys.length}`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating TTS audio (attempt ${attempt}/${maxRetries}) with voices: ${speaker1Voice}${useTwoSpeakers ? `, ${speaker2Voice}` : ' (monologue)'}...`);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${currentApiKey}`,
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
          
          // Check if we should rotate to next key (429 or 403)
          if (response.status === 429 || response.status === 403 || errorCode === 429) {
            // Try next DB key if available
            if (dbKeys.length > 0 && currentKeyIndex < dbKeys.length - 1) {
              console.log(`TTS key ${currentKeyIndex + 1} quota/permission issue, rotating to next key...`);
              
              // Increment error count for this key
              if (serviceClient && currentKeyRecord) {
                await incrementKeyErrorCount(serviceClient, currentKeyRecord.id, response.status === 403);
              }
              
              currentKeyIndex++;
              currentKeyRecord = dbKeys[currentKeyIndex];
              currentApiKey = currentKeyRecord.key_value;
              console.log(`TTS switched to DB key ${currentKeyIndex + 1}/${dbKeys.length}`);
              continue; // Retry with new key (don't count as retry)
            }
            
            if (response.status === 429 || errorCode === 429) {
              lastTTSError = 'All API keys have reached their rate limit for audio generation. Please wait a few minutes and try again.';
            } else {
              lastTTSError = 'API access denied for audio generation. Please verify your Gemini API key has TTS permissions enabled.';
            }
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
  const difficultyDesc = difficulty === 'easy' ? 'Band 5-5.5' : difficulty === 'medium' ? 'Band 6-6.5' : difficulty === 'hard' ? 'Band 7-7.5' : 'Band 8-9 (Expert level - extremely challenging, requires near-native comprehension, subtle inferences, and mastery of nuanced vocabulary)';
  
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

OFFICIAL IELTS FORMAT - CRITICAL RULES:
- The MAP shows: (1) Letter circles A-H marking UNKNOWN locations, and (2) LABELED landmarks for navigation
- The PASSAGE describes where things are using DIRECTIONS and LANDMARKS (e.g., "opposite the main entrance", "north of the café")
- QUESTIONS show the PLACE NAME the test taker must locate (e.g., "Library", "Gift Shop")
- The correct_answer is the LETTER (A, B, C, etc.) where that place is located

MAP STRUCTURE:
- map_labels: Answer positions A-H with x,y coordinates (0-100 percentage). The "text" field stores what the letter represents (for answer checking) but this text is NOT shown on the map - only the letter circle appears!
- landmarks: Reference points with x,y coordinates that ARE labeled on the map (streets, known buildings like "Main Entrance", "Café", "Park")

PASSAGE STYLE:
- Describe locations using RELATIVE POSITIONS: "The gift shop is directly opposite the main entrance" or "Located to the north of the café"
- NEVER say "The gift shop is at position B" - test takers must figure this out!
- Use directional words: north, south, east, west, opposite, adjacent, between, corner of, next to, behind

CRITICAL: Answers must NOT be sequential! Randomize: Q1=D, Q2=A, Q3=F, Q4=B (NOT Q1=A, Q2=B, Q3=C)

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The New Community Center",
    "content": "The new community center opened last month. The main entrance faces Oak Street. Immediately to the left of the entrance is the reception desk. The children's play area is located in the northeast corner, directly behind the café. The library occupies the western wing, opposite the sports hall. Meeting rooms can be found on the second floor, accessible via the staircase next to the reception."
  },
  "instruction": "Label the map below. Choose the correct letter, A-H.",
  "map_description": "A floor plan showing Oak Street at the bottom with main entrance. The building has various rooms arranged around a central corridor.",
  "map_labels": [
    {"id": "A", "text": "Reception", "x": 25, "y": 70},
    {"id": "B", "text": "Children's Play Area", "x": 75, "y": 20},
    {"id": "C", "text": "Library", "x": 15, "y": 40},
    {"id": "D", "text": "Sports Hall", "x": 75, "y": 40},
    {"id": "E", "text": "Meeting Rooms", "x": 50, "y": 15},
    {"id": "F", "text": "Storage", "x": 85, "y": 70},
    {"id": "G", "text": "Staff Room", "x": 15, "y": 20},
    {"id": "H", "text": "Toilets", "x": 85, "y": 15}
  ],
  "landmarks": [
    {"id": "L1", "text": "Oak Street", "x": 50, "y": 95},
    {"id": "L2", "text": "Main Entrance", "x": 50, "y": 85},
    {"id": "L3", "text": "Café", "x": 60, "y": 30},
    {"id": "L4", "text": "Staircase", "x": 35, "y": 70}
  ],
  "map_type": "floor_plan",
  "questions": [
    {"question_number": 1, "question_text": "Children's Play Area", "correct_answer": "B", "explanation": "Passage says it's in the northeast corner, behind the café"},
    {"question_number": 2, "question_text": "Library", "correct_answer": "C", "explanation": "Passage says it occupies the western wing, opposite the sports hall"},
    {"question_number": 3, "question_text": "Reception", "correct_answer": "A", "explanation": "Passage says it's immediately left of the main entrance"},
    {"question_number": 4, "question_text": "Sports Hall", "correct_answer": "D", "explanation": "Passage says the library is opposite it"}
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
// HARDCODED per Architect spec: 4 minutes audio (~600 words), 7 questions
const LISTENING_AUDIO_LENGTH_MINUTES = 4;
const LISTENING_QUESTION_COUNT = 7;
const LISTENING_WORD_COUNT = 600; // 4 min * 150 words/min

function getListeningPrompt(
  questionType: string, 
  topic: string, 
  difficulty: string, 
  questionCount: number, 
  scenario: any,
  listeningConfig?: ListeningConfig
): string {
  const difficultyDesc = difficulty === 'easy' ? 'Band 5-5.5' : difficulty === 'medium' ? 'Band 6-6.5' : difficulty === 'hard' ? 'Band 7-7.5' : 'Band 8-9 (Expert level - extremely challenging, requires near-native comprehension, subtle inferences, and mastery of nuanced vocabulary)';
  
  // HARDCODED per Architect spec: 4 minutes audio, 7 questions
  const targetWordCount = LISTENING_WORD_COUNT;
  const targetDurationSeconds = LISTENING_AUDIO_LENGTH_MINUTES * 60; // 240 seconds
  const effectiveQuestionCount = LISTENING_QUESTION_COUNT;
  
  const wordRange = `${targetWordCount - 50}-${targetWordCount + 50}`;

  // Determine if we use 1 or 2 speakers based on config
  const useTwoSpeakers = listeningConfig?.speakerConfig?.useTwoSpeakers !== false;

  // SSML pause instructions per Architect spec - CRITICAL for TTS pacing
  const ssmlInstructions = `
   CRITICAL AUDIO PACING - MUST USE SSML TAGS:
   - You MUST use SSML tags for pauses in the dialogue
   - Insert <break time='5s'/> between major topic changes or question sections
   - Insert <break time='2s'/> between speaker turns  
   - Insert <break time='1s'/> for natural pauses within speech
   - Example: "Speaker1: Welcome to the museum tour.<break time='2s'/> Let me start by explaining the layout."
   - This ensures test takers have time to write answers`;

  // Build prompt for realistic character names with SSML instructions
  const characterInstructions = useTwoSpeakers
    ? `1. Create a dialogue script between two characters that is:
   - ${wordRange} words total (approximately ${targetDurationSeconds} seconds / ${LISTENING_AUDIO_LENGTH_MINUTES} minutes when spoken)
   - Natural and conversational with realistic names/roles (e.g., "Receptionist", "Mark", "Dr. Smith", "Sarah")
   - In the output JSON dialogue field, you MUST use "Speaker1:" and "Speaker2:" prefixes for TTS processing
   - ALSO include a "speaker_names" object in your JSON that maps Speaker1/Speaker2 to their real names
   - Contains specific details (names, numbers, dates, locations)
   ${ssmlInstructions}
   
   CRITICAL OUTPUT FORMAT:
   - dialogue: Use "Speaker1:" and "Speaker2:" prefixes (required for audio generation)
   - speaker_names: {"Speaker1": "Real Name or Role", "Speaker2": "Real Name or Role"}
   - Example: speaker_names: {"Speaker1": "Sarah", "Speaker2": "Receptionist"}`
    : `1. Create a monologue script by a single speaker that is:
   - ${wordRange} words total (approximately ${targetDurationSeconds} seconds / ${LISTENING_AUDIO_LENGTH_MINUTES} minutes when spoken)
   - Clear and informative, like a tour guide, lecturer, or announcer
   - Use "Speaker1:" prefix for all lines (required for TTS)
   - ALSO include a "speaker_names" object: {"Speaker1": "Appropriate Role/Title"}
   - Example: speaker_names: {"Speaker1": "Tour Guide"} or {"Speaker1": "Professor Williams"}
   - Contains specific details (names, numbers, dates, locations)
   ${ssmlInstructions}`;

  const basePrompt = `Generate an IELTS Listening test section with the following specifications:

Topic: ${topic}
Scenario: ${scenario.description}
Difficulty: ${difficulty} (${difficultyDesc})
FIXED PARAMETERS: ${LISTENING_AUDIO_LENGTH_MINUTES} minutes audio, ${effectiveQuestionCount} questions

Requirements:
${characterInstructions}
`;

  // Handle FILL_IN_BLANK with optional Spelling Mode or Monologue Mode
  if (questionType === 'FILL_IN_BLANK') {
    const spellingMode = listeningConfig?.spellingMode;
    const isMonologue = listeningConfig?.monologueMode === true;
    
    // Monologue mode (IELTS Part 4 style)
    if (isMonologue) {
      return basePrompt + `2. Create ${effectiveQuestionCount} fill-in-the-blank questions in IELTS Part 4 monologue style.

CRITICAL RULES FOR MONOLOGUE MODE:
- This is a SINGLE SPEAKER monologue (like a lecture, tour guide, or presentation)
- Use "Speaker1:" prefix for ALL lines (required for TTS)
- Blanks should contain common nouns, dates, numbers, or descriptive phrases

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Welcome to today's lecture...<break time='2s'/> Let me explain...",
  "speaker_names": {"Speaker1": "Professor Williams"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "questions": [
    {"question_number": 1, "question_text": "_____ was the primary building material used.", "correct_answer": "Limestone", "explanation": "Speaker mentions limestone"}
  ]
}`;
    }
    
    // Standard Fill-in-Blank
    return basePrompt + `2. Create ${effectiveQuestionCount} fill-in-the-blank questions.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Hello, welcome to the museum...<break time='2s'/>\\nSpeaker2: Thank you...",
  "speaker_names": {"Speaker1": "Tour Guide", "Speaker2": "Visitor"},
  "instruction": "Complete the notes below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.",
  "questions": [
    {"question_number": 1, "question_text": "The event takes place in _____.", "correct_answer": "the main garden", "explanation": "Speaker mentions the main garden location"}
  ]
}`;
  }

  switch (questionType) {
    case 'MULTIPLE_CHOICE':
    case 'MULTIPLE_CHOICE_SINGLE':
      return basePrompt + `2. Create ${effectiveQuestionCount} multiple choice questions (single answer).

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Let me explain...<break time='2s'/>\\nSpeaker2: I see...",
  "speaker_names": {"Speaker1": "Instructor", "Speaker2": "Student"},
  "instruction": "Choose the correct letter, A, B or C.",
  "questions": [
    {"question_number": 1, "question_text": "What is the main topic?", "options": ["A First option", "B Second option", "C Third option"], "correct_answer": "A", "explanation": "The speaker mentions..."}
  ]
}`;

    case 'MULTIPLE_CHOICE_MULTIPLE':
      return basePrompt + `2. Create 1 multiple choice question where test-takers must select TWO correct answers.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: There are several benefits...<break time='2s'/>",
  "speaker_names": {"Speaker1": "Expert"},
  "instruction": "Choose TWO letters, A-E.",
  "questions": [
    {"question_number": 1, "question_text": "Which TWO benefits are mentioned?", "options": ["A First", "B Second", "C Third", "D Fourth", "E Fifth"], "correct_answer": "B,D", "explanation": "B and D are mentioned", "max_answers": 2}
  ]
}`;

    case 'MATCHING_CORRECT_LETTER':
      return basePrompt + `2. Create ${effectiveQuestionCount} matching questions.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Each department has responsibilities...<break time='2s'/>",
  "speaker_names": {"Speaker1": "Manager"},
  "instruction": "Match each person to their department.",
  "options": [{"letter": "A", "text": "Marketing"}, {"letter": "B", "text": "Finance"}, {"letter": "C", "text": "HR"}],
  "questions": [
    {"question_number": 1, "question_text": "John works in", "correct_answer": "A", "explanation": "John is in Marketing"}
  ]
}`;

    case 'TABLE_COMPLETION':
      return basePrompt + `2. Create a table completion task with ${effectiveQuestionCount} blanks.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Let me give you the schedule...<break time='2s'/>",
  "speaker_names": {"Speaker1": "Coordinator"},
  "instruction": "Complete the table below.",
  "table_data": {
    "headers": ["Event", "Time", "Location"],
    "rows": [
      [{"text": "Opening ceremony"}, {"text": "9:00 AM"}, {"isBlank": true, "questionNumber": 1}],
      [{"text": "Workshop"}, {"isBlank": true, "questionNumber": 2}, {"text": "Room 101"}]
    ]
  },
  "questions": [
    {"question_number": 1, "question_text": "Location of opening ceremony", "correct_answer": "Main Hall", "explanation": "Speaker says Main Hall"}
  ]
}`;

    case 'FLOWCHART_COMPLETION':
      return basePrompt + `2. Create a flowchart completion task with ${effectiveQuestionCount} blanks.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Let me explain the process...<break time='2s'/>",
  "speaker_names": {"Speaker1": "HR Manager"},
  "instruction": "Complete the flow chart below.",
  "flowchart_title": "Application Process",
  "flowchart_steps": [
    {"id": "step1", "text": "Submit application", "hasBlank": false},
    {"id": "step2", "text": "Receive __1__", "hasBlank": true, "blankNumber": 1},
    {"id": "step3", "text": "Attend __2__", "hasBlank": true, "blankNumber": 2}
  ],
  "distractor_options": ["schedule", "discount"],
  "questions": [
    {"question_number": 1, "question_text": "Step 2", "correct_answer": "confirmation", "explanation": "System sends confirmation"}
  ]
}`;

    case 'MAP_LABELING':
      return basePrompt + `2. Create a map labeling task with ${effectiveQuestionCount} locations.

CRITICAL: Use directional language, NEVER say "at position B".
Include x,y coordinates (0-100 percentage) for each label and landmark for map rendering.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Welcome to Historic Fairview. Let me show you around...<break time='1s'/> The quilt shop is on the west side of Main Street, just past the welcome center. <break time='2s'/> If you walk north along Main Street, you'll find the handicrafts museum on your right, directly across from the bank...",
  "speaker_names": {"Speaker1": "Tour Guide"},
  "instruction": "Label the map. Choose the correct letter, A-H.",
  "map_description": "A street map showing the intersection of Oak Street and Main Street. Buildings are arranged along both streets.",
  "map_type": "street_map",
  "map_labels": [
    {"id": "A", "text": "Art Gallery", "x": 20, "y": 25},
    {"id": "B", "text": "Bookshop", "x": 40, "y": 35},
    {"id": "C", "text": "Museum", "x": 70, "y": 25},
    {"id": "D", "text": "Quilt Shop", "x": 25, "y": 55},
    {"id": "E", "text": "School House", "x": 75, "y": 55},
    {"id": "F", "text": "Gift Shop", "x": 50, "y": 65},
    {"id": "G", "text": "Café", "x": 80, "y": 35},
    {"id": "H", "text": "Post Office", "x": 15, "y": 75}
  ],
  "landmarks": [
    {"id": "L1", "text": "Bank", "x": 55, "y": 25},
    {"id": "L2", "text": "Welcome Center", "x": 30, "y": 45},
    {"id": "L3", "text": "Oak Street", "x": 50, "y": 10},
    {"id": "L4", "text": "Main Street", "x": 10, "y": 50},
    {"id": "L5", "text": "Elm Street", "x": 50, "y": 90}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Quilt Shop", "correct_answer": "D", "explanation": "Guide says it's on west side of Main Street, past welcome center"},
    {"question_number": 2, "question_text": "Museum", "correct_answer": "C", "explanation": "Guide says it's north on Main Street, across from the bank"},
    {"question_number": 3, "question_text": "School House", "correct_answer": "E", "explanation": "Guide says it's on the east side, south of the café"}
  ]
}`;

    case 'NOTE_COMPLETION':
      return basePrompt + `2. Create a note completion task with ${effectiveQuestionCount} blanks.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Let me explain the key points...<break time='2s'/>",
  "speaker_names": {"Speaker1": "Lecturer"},
  "instruction": "Complete the notes below.",
  "note_sections": [
    {
      "title": "Main Topic",
      "items": [
        {"text_before": "The primary focus is", "question_number": 1, "text_after": ""}
      ]
    }
  ],
  "questions": [
    {"question_number": 1, "question_text": "Note 1", "correct_answer": "research methods", "explanation": "Speaker mentions research methods"}
  ]
}`;

    case 'DRAG_AND_DROP_OPTIONS':
      return basePrompt + `2. Create ${effectiveQuestionCount} drag-and-drop questions with extra distractor options.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: Each department has different responsibilities...<break time='2s'/>",
  "speaker_names": {"Speaker1": "Department Head"},
  "instruction": "Match each person to their responsibility.",
  "drag_options": ["Managing budget", "Training staff", "Customer service", "Quality control", "Marketing"],
  "questions": [
    {"question_number": 1, "question_text": "____ is John's main focus.", "correct_answer": "Managing budget", "explanation": "John handles budget"}
  ]
}`;

    default:
      return basePrompt + `2. Create ${effectiveQuestionCount} fill-in-the-blank questions.

Return ONLY valid JSON:
{
  "dialogue": "Speaker1: dialogue...<break time='2s'/>\\nSpeaker2: response...",
  "speaker_names": {"Speaker1": "Host", "Speaker2": "Guest"},
  "instruction": "Complete the notes below.",
  "questions": [
    {"question_number": 1, "question_text": "The event takes place in _____.", "correct_answer": "the main garden", "explanation": "Speaker mentions the main garden"}
  ]
}`;
  }
}

// ============================================================================
// SERVE HANDLER
// ============================================================================

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

    // Service client for DB operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body first to check for userApiKey
    const body = await req.json();
    const { module, questionType, difficulty, topicPreference, questionCount, timeMinutes, readingConfig, listeningConfig, writingConfig, skipPreflight, save_to_bank, userApiKey } = body;

    // ============ HYBRID KEY PRIORITY SYSTEM ============
    // Priority 1: User-provided key (header or body) - NO fallback on failure
    // Priority 2: System pool (DB api_keys table) - with rotation
    
    const headerApiKey = req.headers.get('x-gemini-api-key');
    let geminiApiKey: string | null = null;
    let isUserProvidedKey = false;
    let dbApiKeys: ApiKeyRecord[] = [];
    
    // Priority 1: Check for user-provided key
    if (headerApiKey) {
      console.log('Using user-provided API key from header (Priority 1)');
      geminiApiKey = headerApiKey;
      isUserProvidedKey = true;
    } else if (userApiKey) {
      console.log('Using user-provided API key from body (Priority 1)');
      geminiApiKey = userApiKey;
      isUserProvidedKey = true;
    } else {
      // Check user_secrets table for stored encrypted key
      const { data: secretData } = await supabaseClient
        .from('user_secrets')
        .select('encrypted_value')
        .eq('user_id', user.id)
        .eq('secret_name', 'GEMINI_API_KEY')
        .single();
      
      if (secretData) {
        const appEncryptionKey = Deno.env.get('app_encryption_key');
        if (appEncryptionKey) {
          geminiApiKey = await decryptApiKey(secretData.encrypted_value, appEncryptionKey);
          isUserProvidedKey = true;
          console.log('Using user API key from user_secrets (Priority 1)');
        }
      }
    }
    
    // Priority 2: System pool (only if no user key)
    if (!isUserProvidedKey) {
      dbApiKeys = await getActiveGeminiKeys(serviceClient);
      console.log(`No user key found. Using system pool: ${dbApiKeys.length} DB-managed keys (Priority 2)`);
      
      if (dbApiKeys.length > 0) {
        geminiApiKey = dbApiKeys[0].key_value;
      }
    }
    
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ 
        error: 'No API key available. Please add your Gemini API key in Settings, or contact support if using system keys.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Key mode: ${isUserProvidedKey ? 'USER_KEY (no fallback)' : 'SYSTEM_POOL (rotation enabled)'}`);

    // ============ CREDIT SYSTEM CHECK ============
    // Step 1: If user has their own key (BYOK), skip all credit checks
    // Step 2-4: Check and enforce credit limits for system pool users
    const operationType = module === 'reading' ? 'generate_reading' 
                        : module === 'listening' ? 'generate_listening'
                        : module === 'writing' ? 'generate_writing'
                        : module === 'speaking' ? 'generate_speaking'
                        : 'generate_reading';
    
    if (!isUserProvidedKey) {
      const creditCheck = await checkAndReserveCredits(serviceClient, user.id, operationType as keyof typeof COSTS);
      
      if (!creditCheck.ok) {
        return new Response(JSON.stringify({ 
          error: creditCheck.error,
          errorType: 'CREDIT_LIMIT_EXCEEDED',
          creditsUsed: creditCheck.creditsUsed,
          creditsRemaining: creditCheck.creditsRemaining,
          dailyLimit: DAILY_CREDIT_LIMIT
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      console.log(`Credits reserved: ${creditCheck.creditsUsed}/${DAILY_CREDIT_LIMIT} used, ${creditCheck.creditsRemaining} remaining after this operation`);
    } else {
      console.log('BYOK mode: Skipping credit check');
    }
    
    // Track if we need to refund on error (only if credits were reserved)
    const creditsReserved = !isUserProvidedKey;
    const currentOperationType = operationType as keyof typeof COSTS;
    
    const topic = topicPreference || IELTS_TOPICS[Math.floor(Math.random() * IELTS_TOPICS.length)];
    const testId = crypto.randomUUID();

    console.log(`Generating ${module} test: ${questionType}, ${difficulty}, topic: ${topic}`);

    // ============ PRESET LOOKUP - Check for published admin-generated tests first ============
    // This saves credits and returns instantly if a matching preset exists
    try {
      let presetQuery = serviceClient
        .from('generated_test_audio')
        .select('*')
        .eq('module', module)
        .eq('is_published', true)
        .eq('status', 'ready');
      
      // Match difficulty
      if (difficulty) {
        presetQuery = presetQuery.eq('difficulty', difficulty);
      }
      
      // For listening/speaking, prefer tests with audio
      if (module === 'listening') {
        presetQuery = presetQuery.not('audio_url', 'is', null);
      }
      
      // Match question type if specified and not mixed
      if (questionType && questionType !== 'mixed' && questionType !== 'MIXED' && questionType !== 'FULL_TEST') {
        // Normalize question type aliases for matching
        // MULTIPLE_CHOICE and MULTIPLE_CHOICE_SINGLE are equivalent
        const normalizedType = questionType.toUpperCase();
        if (normalizedType === 'MULTIPLE_CHOICE') {
          // Match both MULTIPLE_CHOICE and MULTIPLE_CHOICE_SINGLE
          presetQuery = presetQuery.in('question_type', ['MULTIPLE_CHOICE', 'MULTIPLE_CHOICE_SINGLE']);
        } else if (normalizedType === 'MULTIPLE_CHOICE_SINGLE') {
          presetQuery = presetQuery.in('question_type', ['MULTIPLE_CHOICE', 'MULTIPLE_CHOICE_SINGLE']);
        } else {
          presetQuery = presetQuery.eq('question_type', normalizedType);
        }
      }
      
      // Optionally match topic (fuzzy - if topic preference provided)
      if (topicPreference) {
        presetQuery = presetQuery.ilike('topic', `%${topicPreference}%`);
      }
      
      // Limit to tests not used recently, order by least used
      presetQuery = presetQuery.order('times_used', { ascending: true }).limit(10);
      
      const { data: presets, error: presetError } = await presetQuery;
      
      if (!presetError && presets && presets.length > 0) {
        // Pick a random one from the pool to add variety
        const preset = presets[Math.floor(Math.random() * presets.length)];
        console.log(`Found preset test ${preset.id} for ${module}/${difficulty}/${questionType}`);
        
        // Update usage stats
        await serviceClient
          .from('generated_test_audio')
          .update({ 
            times_used: (preset.times_used || 0) + 1,
            last_used_at: new Date().toISOString()
          })
          .eq('id', preset.id);
        
        // Build response based on module type using content_payload
        const payload = preset.content_payload || {};
        
          if (module === 'listening') {
            // Listening preset response
            const normalizeType = (raw: unknown) => String(raw ?? '').trim().toUpperCase();

            const buildGroup = (g: any, fallbackType: string) => {
              const type = normalizeType(g?.question_type || fallbackType || questionType);
              const qsRaw: any[] = Array.isArray(g?.questions)
                ? g.questions
                : Array.isArray(payload.questions)
                  ? payload.questions
                  : [];

              let groupOptions: any = g?.options ?? payload.options ?? payload.groupOptions ?? {};
              if (
                Array.isArray(groupOptions) &&
                [
                  'MATCHING_CORRECT_LETTER',
                  'MAPS',
                  'MAP_LABELING',
                  'MULTIPLE_CHOICE_MULTIPLE',
                  'DRAG_AND_DROP_OPTIONS',
                  'FLOWCHART_COMPLETION',
                  'TABLE_COMPLETION',
                ].includes(type)
              ) {
                groupOptions = { type, options: groupOptions, option_format: 'A' };
              }

              const questions = qsRaw.map((q: any, idx: number) => {
                const qType = normalizeType(q?.question_type || type);
                return {
                  id: q?.id || crypto.randomUUID(),
                  question_number: q?.question_number ?? idx + (g?.start_question ?? 1),
                  question_type: qType,
                  question_text: q?.question_text ?? q?.text ?? '',
                  correct_answer: q?.correct_answer ?? q?.correctAnswer ?? '',
                  explanation: q?.explanation ?? '',
                  heading: q?.heading ?? null,
                  options: Array.isArray(q?.options)
                    ? q.options
                    : Array.isArray(q?.options?.options)
                      ? q.options.options
                      : null,
                  option_format: q?.option_format ?? groupOptions?.option_format ?? 'A',
                  table_data: q?.table_data ?? groupOptions?.table_data ?? null,
                };
              });

              return {
                id: g?.id || crypto.randomUUID(),
                instruction: g?.instruction || payload.instruction || 'Complete the questions below.',
                question_type: type,
                start_question: g?.start_question ?? 1,
                end_question: g?.end_question ?? (g?.start_question ?? 1) + Math.max(0, questions.length - 1),
                options: groupOptions,
                questions,
              };
            };

            const topLevelType = normalizeType(preset.question_type || questionType);
            const groups = Array.isArray(payload.questionGroups) && payload.questionGroups.length > 0
              ? payload.questionGroups.map((g: any) => buildGroup(g, topLevelType))
              : [buildGroup({ questions: payload.questions, options: payload.options }, topLevelType)];

            const responsePayload = {
              testId: `preset-${preset.id}`,
              topic: preset.topic,
              transcript: preset.transcript || payload.dialogue || payload.transcript,
              speakerNames: payload.speaker_names || payload.speakerNames,
              audioUrl: preset.audio_url, // Pre-generated audio URL
              audioBase64: null, // Not needed - using URL
              audioFormat: 'wav',
              sampleRate: 24000,
              questionGroups: groups,
              isPreset: true,
              presetId: preset.id,
            };
          
          console.log(`Serving listening preset: ${preset.topic}`);
          return new Response(JSON.stringify(responsePayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else if (module === 'speaking') {
          // Speaking preset response - transform part1/part2/part3 structure to speakingParts array
          const speakingParts: any[] = [];
          
          // Helper to transform part data
          const transformPart = (partData: any, partNum: number) => {
            if (!partData) return null;
            
            // Questions could be array of strings or array of objects
            const questions = Array.isArray(partData.questions) 
              ? partData.questions.map((q: any, qIndex: number) => ({
                  id: crypto.randomUUID(),
                  question_number: qIndex + 1,
                  question_text: typeof q === 'string' ? q : (q.question_text || q),
                  sample_answer: typeof q === 'object' ? q.sample_answer : undefined,
                }))
              : [];
            
            // Sample answers could be separate array
            if (Array.isArray(partData.sample_answers) && partData.sample_answers.length > 0) {
              partData.sample_answers.forEach((answer: string, idx: number) => {
                if (questions[idx]) {
                  questions[idx].sample_answer = answer;
                }
              });
            }
            
            return {
              id: crypto.randomUUID(),
              part_number: partNum,
              instruction: partData.instruction || '',
              questions,
              cue_card_topic: partData.cue_card_topic,
              cue_card_content: partData.cue_card_content,
              preparation_time_seconds: partData.preparation_time_seconds || (partNum === 2 ? 60 : undefined),
              speaking_time_seconds: partData.speaking_time_seconds || (partNum === 2 ? 120 : undefined),
              time_limit_seconds: partData.time_limit_seconds || (partNum === 1 || partNum === 3 ? 300 : undefined),
            };
          };
          
          // Check for part1/part2/part3 structure
          if (payload.part1) {
            const part = transformPart(payload.part1, 1);
            if (part) speakingParts.push(part);
          }
          if (payload.part2) {
            const part = transformPart(payload.part2, 2);
            if (part) speakingParts.push(part);
          }
          if (payload.part3) {
            const part = transformPart(payload.part3, 3);
            if (part) speakingParts.push(part);
          }
          
          // Fallback to parts array or speakingParts if already in correct format
          if (speakingParts.length === 0 && payload.parts) {
            payload.parts.forEach((p: any, pIndex: number) => {
              const part = transformPart(p, p.part_number || pIndex + 1);
              if (part) speakingParts.push(part);
            });
          }
          if (speakingParts.length === 0 && payload.speakingParts) {
            speakingParts.push(...payload.speakingParts);
          }
          
          const responsePayload = {
            testId: `preset-${preset.id}`,
            topic: preset.topic,
            speakingParts,
            audioUrls: payload.audioUrls, // Pre-generated TTS audio URLs
            isPreset: true,
            presetId: preset.id,
          };
          
          console.log(`Serving speaking preset: ${preset.topic}, parts: ${speakingParts.length}`);
          return new Response(JSON.stringify(responsePayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else if (module === 'reading') {
          // Reading preset response
          const normalizeType = (raw: unknown) => String(raw ?? '').trim().toUpperCase();

          const normalizePassage = (raw: any) => {
            // Bulk/admin presets often store {title, content} without an id.
            // The test-taker renderer relies on passage.id to attach questions to the passage.
            const content =
              typeof raw === 'string'
                ? raw
                : typeof raw?.content === 'string'
                  ? raw.content
                  : typeof payload?.passageContent === 'string'
                    ? payload.passageContent
                    : '';

            const title =
              typeof raw === 'object' && typeof raw?.title === 'string'
                ? raw.title
                : typeof payload?.title === 'string'
                  ? payload.title
                  : preset.topic;

            const id = typeof raw === 'object' && typeof raw?.id === 'string' && raw.id.trim()
              ? raw.id
              : crypto.randomUUID();

            return {
              id,
              title,
              content,
              passage_number: 1,
            };
          };

          const buildGroup = (g: any, fallbackType: string) => {
            const type = normalizeType(g?.question_type || fallbackType || questionType);
            const qsRaw: any[] = Array.isArray(g?.questions)
              ? g.questions
              : Array.isArray(payload.questions)
                ? payload.questions
                : [];

            let groupOptions: any = g?.options ?? payload.options ?? {};

            // Ensure bulk/admin presets for MATCHING_HEADINGS carry headings into group options
            // so the reading renderer can display the heading bank.
            if (type === 'MATCHING_HEADINGS' && Array.isArray(payload.headings)) {
              if (Array.isArray(groupOptions)) {
                groupOptions = { options: groupOptions };
              }
              if (!groupOptions || typeof groupOptions !== 'object') {
                groupOptions = {};
              }
              if (!Array.isArray(groupOptions.headings)) {
                groupOptions = { ...groupOptions, headings: payload.headings };
              }
            }

            // For MULTIPLE_CHOICE_MULTIPLE: Extract max_answers from first question and propagate to group options
            // This ensures the renderer shows correct "Select X answers" instruction
            if (type === 'MULTIPLE_CHOICE_MULTIPLE') {
              // Ensure groupOptions is an object
              if (Array.isArray(groupOptions)) {
                groupOptions = { options: groupOptions };
              }
              if (!groupOptions || typeof groupOptions !== 'object') {
                groupOptions = {};
              }
              
              // Get max_answers from first question, group options, or infer from question text
              const firstQ = qsRaw[0];
              const explicitMax = firstQ?.max_answers ?? g?.max_answers ?? groupOptions?.max_answers;
              
              if (explicitMax) {
                groupOptions = { ...groupOptions, max_answers: explicitMax };
              } else if (firstQ?.question_text) {
                // Infer from question text (e.g., "Which THREE statements...")
                const text = firstQ.question_text;
                const match = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b\s+(?:statements|answers|options|letters?|of the following)\b/i)
                  || text.match(/\bwhich\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
                if (match) {
                  const raw = match[1].toLowerCase();
                  const wordMap: Record<string, number> = {
                    one: 1, two: 2, three: 3, four: 4, five: 5,
                    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
                  };
                  const inferred = wordMap[raw] ?? parseInt(raw, 10);
                  if (inferred > 0) {
                    groupOptions = { ...groupOptions, max_answers: inferred };
                  }
                }
              }
              
              // Also ensure options array is properly set for checkboxes
              if (!groupOptions.options && firstQ?.options && Array.isArray(firstQ.options)) {
                groupOptions = { ...groupOptions, options: firstQ.options };
              }
            }

            const questions = qsRaw.map((q: any, idx: number) => {
              const qType = normalizeType(q?.question_type || type);
              return {
                id: q?.id || crypto.randomUUID(),
                question_number: q?.question_number ?? idx + (g?.start_question ?? 1),
                question_type: qType,
                question_text: q?.question_text ?? q?.text ?? '',
                correct_answer: q?.correct_answer ?? q?.correctAnswer ?? '',
                explanation: q?.explanation ?? '',
                options: Array.isArray(q?.options)
                  ? q.options
                  : Array.isArray(q?.options?.options)
                    ? q.options.options
                    : null,
                heading: q?.heading ?? null,
                table_data: q?.table_data ?? groupOptions?.table_data ?? null,
              };
            });

            return {
              id: g?.id || crypto.randomUUID(),
              instruction: g?.instruction || payload.instruction || 'Answer the questions below.',
              question_type: type,
              start_question: g?.start_question ?? 1,
              end_question: g?.end_question ?? (g?.start_question ?? 1) + Math.max(0, questions.length - 1),
              options: groupOptions,
              questions,
            };
          };

          const topLevelType = normalizeType(preset.question_type || questionType);
          const groups = Array.isArray(payload.questionGroups) && payload.questionGroups.length > 0
            ? payload.questionGroups.map((g: any) => buildGroup(g, topLevelType))
            : [buildGroup({ questions: payload.questions, options: payload.options }, topLevelType)];

          const responsePayload = {
            testId: `preset-${preset.id}`,
            topic: preset.topic,
            passage: normalizePassage(payload.passage),
            questionGroups: groups,
            isPreset: true,
            presetId: preset.id,
          };
          
          console.log(`Serving reading preset: ${preset.topic}`);
          return new Response(JSON.stringify(responsePayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else if (module === 'writing') {
          // Writing preset response
          const responsePayload = {
            testId: `preset-${preset.id}`,
            topic: preset.topic,
            writingTask: payload.writingTask || payload,
            isPreset: true,
            presetId: preset.id,
          };
          
          console.log(`Serving writing preset: ${preset.topic}`);
          return new Response(JSON.stringify(responsePayload), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.log(`No preset found for ${module}/${difficulty}/${questionType}, proceeding with fresh generation`);
      }
    } catch (presetError) {
      console.error('Preset lookup failed, continuing with generation:', presetError);
      // Continue to normal generation
    }

    // ============ FRESH GENERATION (if no preset found) ============

    // Pre-flight validation
    const preflightResult = await preflightApiCheck(geminiApiKey, skipPreflight === true);
    if (!preflightResult.ok) {
      return new Response(JSON.stringify({ 
        error: preflightResult.error,
        errorType: 'API_ERROR',
        preflightFailed: true
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (module === 'reading') {
      const readingPrompt = getReadingPrompt(questionType, topic, difficulty, questionCount, readingConfig);
      const result = await callGemini(geminiApiKey, readingPrompt, 2, { dbKeys: dbApiKeys, serviceClient });
      
      let totalTokensUsed = getLastTokensUsed();
      
      if (!result) {
        // Refund credits on AI failure
        if (creditsReserved) {
          await refundCredits(serviceClient, user.id, currentOperationType);
        }
        if (wasQuotaExceeded()) {
          return new Response(JSON.stringify({ 
            error: getLastGeminiError(),
            errorType: 'QUOTA_EXCEEDED'
          }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: getLastGeminiError() }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      await updateQuotaTracking(serviceClient, user.id, totalTokensUsed);

      let parsed;
      try {
        const jsonStr = extractJsonFromResponse(result);
        parsed = JSON.parse(jsonStr);
        
        // Validate required fields
        if (!parsed.passage || !parsed.passage.content) {
          throw new Error('Missing passage content in AI response');
        }
        if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
          throw new Error('Missing or empty questions array in AI response');
        }
        // Validate each question has required fields
        for (const q of parsed.questions) {
          if (!q.correct_answer) {
            throw new Error(`Question ${q.question_number || '?'} missing correct_answer`);
          }
        }
      } catch (e) {
        console.error("Failed to parse/validate Gemini response:", e);
        // Refund credits on parse failure
        if (creditsReserved) {
          await refundCredits(serviceClient, user.id, currentOperationType);
        }
        return new Response(JSON.stringify({ 
          error: 'AI returned invalid content. Please try again.',
          errorType: 'PARSE_ERROR',
          details: e instanceof Error ? e.message : String(e)
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const groupId = crypto.randomUUID();
      const passageId = crypto.randomUUID();

      let groupOptions: any = undefined;
      if (questionType === 'MATCHING_HEADINGS' && parsed.headings) {
        groupOptions = { headings: parsed.headings };
      } else if (questionType === 'MATCHING_INFORMATION' && parsed.options) {
        groupOptions = { options: parsed.options };
      } else if (questionType.includes('MULTIPLE_CHOICE') && parsed.questions?.[0]?.options) {
        groupOptions = { options: parsed.questions[0].options };
      } else if ((questionType === 'SUMMARY_COMPLETION' || questionType === 'SUMMARY_WORD_BANK') && (parsed.summary_text || parsed.word_bank)) {
        // Summary completion needs summary_text and word_bank in options for renderer
        groupOptions = { 
          summary_text: parsed.summary_text || '',
          word_bank: parsed.word_bank || [],
        };
      } else if (questionType === 'MATCHING_SENTENCE_ENDINGS' && (parsed.sentence_endings || parsed.sentence_beginnings)) {
        // Matching sentence endings needs sentence_endings array for drag/drop
        groupOptions = { 
          sentence_beginnings: parsed.sentence_beginnings || [],
          sentence_endings: parsed.sentence_endings || [],
        };
      } else if (questionType === 'TABLE_COMPLETION' && parsed.table_data) {
        groupOptions = { table_data: parsed.table_data };
      } else if (questionType === 'FLOWCHART_COMPLETION' && (parsed.flowchart_title || parsed.flowchart_steps)) {
        groupOptions = { 
          flowchart_title: parsed.flowchart_title || '',
          flowchart_steps: parsed.flowchart_steps || [],
        };
      } else if (questionType === 'MAP_LABELING' && parsed.map_labels) {
        groupOptions = {
          map_description: parsed.map_description || '',
          map_type: parsed.map_type || 'floor_plan',
          map_labels: parsed.map_labels || [],
          landmarks: parsed.landmarks || [],
        };
      } else if (questionType === 'NOTE_COMPLETION' && parsed.note_sections) {
        groupOptions = { note_sections: parsed.note_sections };
      }

      const questions = (parsed.questions || []).map((q: any, i: number) => ({
        id: crypto.randomUUID(),
        question_number: q.question_number || i + 1,
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        options: q.options || null,
        heading: q.heading || null,
      }));

      const responsePayload = {
        testId,
        topic,
        passage: {
          id: passageId,
          title: parsed.passage?.title || 'Reading Passage',
          content: parsed.passage?.content || '',
        },
        questionGroups: [{
          id: groupId,
          instruction: parsed.instruction || `Questions 1-${questions.length}`,
          question_type: questionType,
          start_question: 1,
          end_question: questions.length,
          options: groupOptions,
          questions,
        }],
      };

      // Save to test bank if requested
      if (save_to_bank) {
        await saveToTestBank(serviceClient, 'reading', topic, responsePayload);
      }

      // Credits already reserved atomically before AI call - no deduction needed

      return new Response(JSON.stringify(responsePayload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'listening') {
      const scenario = LISTENING_SCENARIOS[Math.floor(Math.random() * LISTENING_SCENARIOS.length)];
      const listeningPrompt = getListeningPrompt(questionType, topic, difficulty, LISTENING_QUESTION_COUNT, scenario, listeningConfig);
      
      const result = await callGemini(geminiApiKey, listeningPrompt, 2, { dbKeys: dbApiKeys, serviceClient });
      let totalTokensUsed = getLastTokensUsed();
      
      if (!result) {
        // Refund credits on AI failure
        if (creditsReserved) {
          await refundCredits(serviceClient, user.id, currentOperationType);
        }
        if (wasQuotaExceeded()) {
          return new Response(JSON.stringify({ 
            error: getLastGeminiError(),
            errorType: 'QUOTA_EXCEEDED'
          }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: getLastGeminiError() }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonStr = extractJsonFromResponse(result);
        parsed = JSON.parse(jsonStr);
        
        // Validate required fields
        if (!parsed.dialogue || typeof parsed.dialogue !== 'string' || parsed.dialogue.trim().length < 50) {
          throw new Error('Missing or too short dialogue in AI response');
        }
        if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
          throw new Error('Missing or empty questions array in AI response');
        }
        if (!parsed.instruction || typeof parsed.instruction !== 'string') {
          throw new Error('Missing instruction in AI response');
        }
        // Validate each question has required fields
        for (const q of parsed.questions) {
          if (!q.correct_answer) {
            throw new Error(`Question ${q.question_number || '?'} missing correct_answer`);
          }
        }
      } catch (e) {
        console.error("Failed to parse/validate listening response:", e);
        // Refund credits on parse failure
        if (creditsReserved) {
          await refundCredits(serviceClient, user.id, currentOperationType);
        }
        return new Response(JSON.stringify({ 
          error: 'AI returned invalid content. Please try again.',
          errorType: 'PARSE_ERROR',
          details: e instanceof Error ? e.message : String(e)
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate TTS audio
      const useTwoSpeakers = listeningConfig?.speakerConfig?.useTwoSpeakers !== false;
      const audio = await generateAudio(geminiApiKey, parsed.dialogue, listeningConfig?.speakerConfig, 3, { dbKeys: dbApiKeys, serviceClient });
      
      await updateQuotaTracking(serviceClient, user.id, totalTokensUsed);

      let groupOptions: any = undefined;
      if (questionType === 'MAP_LABELING') {
        groupOptions = {
          map_description: parsed.map_description,
          map_type: parsed.map_type || 'floor_plan',
          map_labels: parsed.map_labels, // Now includes x,y coordinates
          landmarks: parsed.landmarks || [],
        };
      } else if (questionType === 'TABLE_COMPLETION') {
        groupOptions = { table_data: parsed.table_data };
      } else if (questionType === 'FLOWCHART_COMPLETION') {
        groupOptions = { 
          flowchart_title: parsed.flowchart_title,
          flowchart_steps: parsed.flowchart_steps,
        };
      } else if (questionType === 'NOTE_COMPLETION' && parsed.note_sections) {
        groupOptions = { note_sections: parsed.note_sections };
      } else if (questionType === 'DRAG_AND_DROP_OPTIONS') {
        groupOptions = { options: parsed.drag_options || [] };
      } else if (questionType.includes('MULTIPLE_CHOICE') && parsed.questions?.[0]?.options) {
        groupOptions = { options: parsed.questions[0].options };
      } else if (questionType === 'MATCHING_CORRECT_LETTER' && parsed.options) {
        groupOptions = { options: parsed.options };
      }

      const groupId = crypto.randomUUID();
      const questions = (parsed.questions || []).map((q: any, i: number) => ({
        id: crypto.randomUUID(),
        question_number: q.question_number || i + 1,
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        options: q.options || null,
      }));

      // Process transcript to replace Speaker1/Speaker2 with real names
      let displayTranscript = parsed.dialogue;
      const speakerNames = parsed.speaker_names || {};
      if (speakerNames.Speaker1) {
        displayTranscript = displayTranscript.replace(/Speaker1:/g, `${speakerNames.Speaker1}:`);
      }
      if (speakerNames.Speaker2) {
        displayTranscript = displayTranscript.replace(/Speaker2:/g, `${speakerNames.Speaker2}:`);
      }

      const responsePayload = {
        testId,
        topic,
        transcript: displayTranscript,
        speakerNames,
        audioBase64: audio?.audioBase64 || null,
        audioFormat: audio ? 'pcm' : null,
        sampleRate: audio?.sampleRate || null,
        questionGroups: [{
          id: groupId,
          instruction: parsed.instruction || `Questions 1-${questions.length}`,
          question_type: questionType,
          start_question: 1,
          end_question: questions.length,
          options: groupOptions,
          questions,
        }],
      };

      // Save to test bank if requested
      if (save_to_bank) {
        await saveToTestBank(serviceClient, 'listening', topic, responsePayload);
      }

      // Credits already reserved atomically before AI call - no deduction needed

      return new Response(JSON.stringify(responsePayload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'writing') {
      // Writing handler - preserved from original
      const writingConfig = body.writingConfig || {};
      const taskType = writingConfig.taskType || questionType;
      const task1VisualType = writingConfig.task1VisualType || 'RANDOM';
      const task2EssayType = writingConfig.task2EssayType || 'RANDOM';
      
      const isFullTest = taskType === 'FULL_TEST';
      const includeTask1 = isFullTest || taskType === 'TASK_1';
      const includeTask2 = isFullTest || taskType === 'TASK_2';
      
      let writingTotalTokensUsed = 0;

      async function generateSingleWritingTask(taskNum: 1 | 2, visualType: string, essayType: string): Promise<any> {
        const isTask1 = taskNum === 1;
        let writingPrompt: string;
        
        if (isTask1) {
          const visualTypeToUse = visualType === 'RANDOM'
            ? ['BAR_CHART', 'LINE_GRAPH', 'PIE_CHART', 'TABLE', 'PROCESS_DIAGRAM', 'MAP'][Math.floor(Math.random() * 6)]
            : visualType;
          
          // Build type-specific visualData examples based on visual type
          let visualDataExample: string;
          let typeSpecificInstructions: string;
          
          switch (visualTypeToUse) {
            case 'PROCESS_DIAGRAM':
              visualDataExample = `{
    "type": "PROCESS_DIAGRAM",
    "title": "Process Title",
    "steps": [
      { "label": "Step 1: Raw materials collected", "description": "Optional detail" },
      { "label": "Step 2: Materials processed", "description": "Optional detail" },
      { "label": "Step 3: Quality check", "description": "Optional detail" },
      { "label": "Step 4: Final product", "description": "Optional detail" }
    ]
  }`;
              typeSpecificInstructions = `Create a process/cycle diagram with 4-8 steps. Each step must have a clear "label" field. The "description" field is optional but helpful.`;
              break;
            case 'MAP':
              visualDataExample = `{
    "type": "MAP",
    "title": "Town Centre Development",
    "subtitle": "Changes between 1990 and 2020",
    "mapData": {
      "before": {
        "year": "1990",
        "features": [
          { "label": "Town Hall", "type": "building", "position": "center" },
          { "label": "Main Street", "type": "road", "position": "north-south" },
          { "label": "Old Park", "type": "park", "position": "east" }
        ]
      },
      "after": {
        "year": "2020",
        "features": [
          { "label": "Town Hall", "type": "building", "position": "center" },
          { "label": "Main Street", "type": "road", "position": "north-south" },
          { "label": "Shopping Mall", "type": "building", "position": "east" },
          { "label": "New Car Park", "type": "other", "position": "south" }
        ]
      }
    }
  }`;
              typeSpecificInstructions = `Create a map comparison showing changes over time. Include "before" and "after" sections with features (buildings, roads, parks, water bodies). Use position words like "north", "south", "center", "east", "west", "north-east" etc.`;
              break;
            case 'TABLE':
              visualDataExample = `{
    "type": "TABLE",
    "title": "Table Title",
    "headers": ["Category", "2010", "2015", "2020"],
    "rows": [
      [{ "value": "Item A" }, { "value": 25 }, { "value": 30 }, { "value": 35 }],
      [{ "value": "Item B" }, { "value": 40 }, { "value": 38 }, { "value": 42 }],
      [{ "value": "Item C" }, { "value": 15 }, { "value": 20 }, { "value": 28 }]
    ]
  }`;
              typeSpecificInstructions = `Create a data table with 3-5 rows and 3-5 columns of numeric data showing trends or comparisons.`;
              break;
            case 'LINE_GRAPH':
              visualDataExample = `{
    "type": "LINE_GRAPH",
    "title": "Graph Title",
    "xAxisLabel": "Year",
    "yAxisLabel": "Percentage (%)",
    "series": [
      { "name": "Category A", "data": [{ "x": "2000", "y": 20 }, { "x": "2005", "y": 35 }, { "x": "2010", "y": 45 }] },
      { "name": "Category B", "data": [{ "x": "2000", "y": 40 }, { "x": "2005", "y": 38 }, { "x": "2010", "y": 50 }] }
    ]
  }`;
              typeSpecificInstructions = `Create a line graph with 2-4 series showing trends over 4-6 time points. Use percentages (0-100) or realistic numbers.`;
              break;
            case 'PIE_CHART':
              visualDataExample = `{
    "type": "PIE_CHART",
    "title": "Pie Chart Title",
    "data": [
      { "label": "Category A", "value": 35 },
      { "label": "Category B", "value": 25 },
      { "label": "Category C", "value": 20 },
      { "label": "Category D", "value": 15 },
      { "label": "Other", "value": 5 }
    ]
  }`;
              typeSpecificInstructions = `Create a pie chart with 4-6 segments. Values must add up to 100 (percentages).`;
              break;
            case 'BAR_CHART':
            default:
              visualDataExample = `{
    "type": "BAR_CHART",
    "title": "Chart Title",
    "xAxisLabel": "Categories",
    "yAxisLabel": "Percentage (%)",
    "data": [
      { "label": "Category A", "value": 45 },
      { "label": "Category B", "value": 32 },
      { "label": "Category C", "value": 28 },
      { "label": "Category D", "value": 55 }
    ]
  }`;
              typeSpecificInstructions = `Create a bar chart with 4-8 bars. Use percentages (0-100) or realistic whole numbers.`;
              break;
          }
            
          writingPrompt = `You are a data analyst. Generate an IELTS Academic Writing Task 1 with BOTH the essay question AND the chart/diagram data.

Topic: ${topic}
Difficulty: ${difficulty}
Visual Type: ${visualTypeToUse}

CRITICAL INSTRUCTIONS:
1. ${typeSpecificInstructions}
2. The instruction must start with "The ${visualTypeToUse.replace(/_/g, ' ').toLowerCase()} below shows..."
3. Include: "Summarise the information by selecting and reporting the main features, and make comparisons where relevant."
4. End with: "Write at least 150 words."

Return this EXACT JSON structure:
{
  "task_type": "task1",
  "instruction": "The ${visualTypeToUse.replace(/_/g, ' ').toLowerCase()} below shows [specific description]. Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.",
  "visual_type": "${visualTypeToUse}",
  "visualData": ${visualDataExample}
}

IMPORTANT: Use whole numbers. Keep all labels under 15 characters. Ensure visualData matches the exact structure shown above.`;
        } else {
          const essayTypeToUse = essayType === 'RANDOM'
            ? ['OPINION', 'DISCUSSION', 'PROBLEM_SOLUTION', 'ADVANTAGES_DISADVANTAGES', 'TWO_PART_QUESTION'][Math.floor(Math.random() * 5)]
            : essayType;
            
          const essayFormatGuide = {
            'OPINION': 'To what extent do you agree or disagree?',
            'DISCUSSION': 'Discuss both views and give your own opinion.',
            'PROBLEM_SOLUTION': 'What are the causes of this problem and what solutions can you suggest?',
            'ADVANTAGES_DISADVANTAGES': 'What are the advantages and disadvantages of this?',
            'TWO_PART_QUESTION': 'Include two related questions that the student must address.'
          };
          
          writingPrompt = `Generate an IELTS Academic Writing Task 2.
Topic: ${topic}
Difficulty: ${difficulty}
Essay Type: ${essayTypeToUse}

IMPORTANT: The instruction must follow official IELTS format exactly:
- Start with a statement or context about a topic
- Present the main question/argument
- End with the appropriate question format for ${essayTypeToUse}: "${essayFormatGuide[essayTypeToUse as keyof typeof essayFormatGuide] || ''}"
- Include: "Give reasons for your answer and include any relevant examples from your own knowledge or experience."
- End with: "Write at least 250 words."

Return this EXACT JSON structure:
{
  "task_type": "task2",
  "instruction": "[Context statement about the topic]. [Main argument or question]. ${essayFormatGuide[essayTypeToUse as keyof typeof essayFormatGuide] || ''} Give reasons for your answer and include any relevant examples from your own knowledge or experience. Write at least 250 words.",
  "essay_type": "${essayTypeToUse}"
}`;
        }

        // Use Gemini with JSON mode for stable, non-truncated output
        console.log(`Generating Task ${taskNum} with JSON mode...`);

        const safeParseJson = (raw: string): any => {
          // 1) Direct parse (best case)
          try {
            return JSON.parse(raw);
          } catch {
            // 2) Extract JSON from mixed content (code fences etc.)
            const extracted = extractJsonFromResponse(raw);
            return JSON.parse(extracted);
          }
        };

        const baseMaxOutputTokens = 2048;
        const maxAttempts = 3;
        let lastErr: unknown = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const maxOutputTokens = attempt === 0 ? baseMaxOutputTokens : baseMaxOutputTokens * 2;

          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: writingPrompt }] }],
                generationConfig: {
                  // Lower temperature improves schema adherence for strict JSON
                  temperature: 0.2,
                  maxOutputTokens,
                  responseMimeType: 'application/json', // Force JSON mode
                },
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Task ${taskNum} generation failed:`, response.status, errorText);
            throw new Error(`Failed to generate Task ${taskNum}: ${response.status}`);
          }

          const data = await response.json();

          // Track token usage
          const usageMetadata = data.usageMetadata;
          if (usageMetadata) {
            const promptTokens = usageMetadata.promptTokenCount || 0;
            const candidateTokens = usageMetadata.candidatesTokenCount || 0;
            writingTotalTokensUsed += promptTokens + candidateTokens;
            console.log(`Task ${taskNum} tokens - Prompt: ${promptTokens}, Output: ${candidateTokens}`);
          }

          const finishReason = data.candidates?.[0]?.finishReason;

          const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!resultText) {
            lastErr = new Error(`Empty response for Task ${taskNum}`);
            console.error(lastErr);
            continue;
          }

          console.log(`Task ${taskNum} response length: ${resultText.length} chars (attempt ${attempt + 1}/${maxAttempts}, finishReason=${finishReason || 'unknown'})`);

          try {
            const parsed = safeParseJson(resultText);

            return {
              id: crypto.randomUUID(),
              task_type: isTask1 ? 'task1' : 'task2',
              instruction: parsed.instruction,
              image_description: parsed.visual_description || parsed.instruction, // Fallback
              chartData: parsed.visualData || null, // Direct from combined response
              visual_type: parsed.visual_type,
              essay_type: parsed.essay_type,
              word_limit_min: isTask1 ? 150 : 250,
              word_limit_max: isTask1 ? 200 : 350,
            };
          } catch (e) {
            lastErr = e;
            const preview = resultText?.substring(0, 500);
            console.error(`Failed to parse Task ${taskNum} JSON (attempt ${attempt + 1}/${maxAttempts}):`, e, preview);

            // If the model output looks truncated, retry with a larger token budget.
            // Otherwise, retry once more anyway (models sometimes self-correct on retry).
            const looksTruncated = !resultText.trim().endsWith('}') || finishReason === 'MAX_TOKENS';
            if (!looksTruncated && attempt >= 1) {
              break;
            }

            continue;
          }
        }

        console.error(`Failed to parse Task ${taskNum} after ${maxAttempts} attempts:`, lastErr);
        throw new Error(`Failed to parse Task ${taskNum} content`);
      }

      try {
        // Create service client for quota tracking
        const serviceClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        if (isFullTest) {
          // Generate both tasks sequentially - each task is now a single API call
          console.log('Generating full writing test - Task 1...');
          const task1Result = await generateSingleWritingTask(1, task1VisualType, task2EssayType);
          
          console.log('Generating Task 2...');
          const task2Result = await generateSingleWritingTask(2, task1VisualType, task2EssayType);
          
          // Update quota tracking
          if (writingTotalTokensUsed > 0) {
            await updateQuotaTracking(serviceClient, user.id, writingTotalTokensUsed);
          }

          // Credits already reserved atomically before AI call - no deduction needed
          
          return new Response(JSON.stringify({
            testId,
            topic,
            timeMinutes,
            writingTask: {
              id: crypto.randomUUID(),
              test_type: 'full_test',
              task1: task1Result,
              task2: task2Result,
              time_minutes: timeMinutes,
            },
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          // Generate single task
          const taskResult = await generateSingleWritingTask(
            includeTask1 ? 1 : 2,
            task1VisualType,
            task2EssayType
          );
          
          // Update quota tracking
          if (writingTotalTokensUsed > 0) {
            await updateQuotaTracking(serviceClient, user.id, writingTotalTokensUsed);
          }

          // Credits already reserved atomically before AI call - no deduction needed
          
          return new Response(JSON.stringify({
            testId,
            topic,
            writingTask: taskResult,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err: any) {
        console.error('Writing generation error:', err);
        return new Response(JSON.stringify({ error: err.message || 'Failed to generate writing test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

    } else if (module === 'speaking') {
      // Speaking test generation with official IELTS examiner phrases
      const isFullTest = questionType === 'FULL_TEST';
      const includePart1 = isFullTest || questionType === 'PART_1';
      const includePart2 = isFullTest || questionType === 'PART_2';
      const includePart3 = isFullTest || questionType === 'PART_3';

      const speakingPrompt = `Generate an official IELTS Speaking test with proper examiner phrases.

TOPIC: ${topic}
DIFFICULTY: ${difficulty}
PARTS TO INCLUDE: ${[includePart1 && 'Part 1', includePart2 && 'Part 2', includePart3 && 'Part 3'].filter(Boolean).join(', ')}

OFFICIAL IELTS SPEAKING TEST FORMAT:

PART 1 (Introduction & Interview) - 4-5 minutes:
- Examiner intro: "Now, in this first part, I'd like to ask you some questions about yourself."
- Then: "Let's talk about [topic]..." followed by 4-5 simple questions
- Questions should be personal/familiar topics (home, work, studies, hobbies, etc.)
- Each question expects 20-30 seconds answer

PART 2 (Individual Long Turn) - 3-4 minutes:
- Examiner intro: "Now, I'm going to give you a topic and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish."
- Provide a cue card with: "Describe [topic]" followed by bullet points "You should say:" with 3-4 prompts
- After 2 minutes: "Thank you."
- One optional rounding-off question

PART 3 (Two-way Discussion) - 4-5 minutes:
- Examiner intro: "We've been talking about [Part 2 topic] and I'd like to discuss one or two more general questions related to this."
- 4-5 abstract/analytical questions that extend from Part 2 topic
- Questions should require opinion, analysis, speculation
- Each question expects 45-60 seconds answer

Return ONLY valid JSON:
{
  "topic": "${topic}",
  "parts": [
    ${includePart1 ? `{
      "part_number": 1,
      "instruction": "Now, in this first part, I'd like to ask you some questions about yourself. Let's talk about [specific topic]...",
      "questions": [
        { "question_number": 1, "question_text": "First question about the topic?" },
        { "question_number": 2, "question_text": "Second question?" },
        { "question_number": 3, "question_text": "Third question?" },
        { "question_number": 4, "question_text": "Fourth question?" }
      ],
      "time_limit_seconds": 300
    }${includePart2 || includePart3 ? ',' : ''}` : ''}
    ${includePart2 ? `{
      "part_number": 2,
      "instruction": "Now, I'm going to give you a topic and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish.",
      "cue_card_topic": "Describe [something related to topic]",
      "cue_card_content": "You should say:\\n• first bullet point\\n• second bullet point\\n• third bullet point\\n• and explain why...",
      "questions": [
        { "question_number": 1, "question_text": "Optional rounding-off question after 2-minute speech" }
      ],
      "preparation_time_seconds": 60,
      "speaking_time_seconds": 120
    }${includePart3 ? ',' : ''}` : ''}
    ${includePart3 ? `{
      "part_number": 3,
      "instruction": "We've been talking about [Part 2 topic] and I'd like to discuss one or two more general questions related to this.",
      "questions": [
        { "question_number": 1, "question_text": "First analytical/abstract question?" },
        { "question_number": 2, "question_text": "Second question requiring opinion?" },
        { "question_number": 3, "question_text": "Third question about implications?" },
        { "question_number": 4, "question_text": "Fourth speculative question?" }
      ],
      "time_limit_seconds": 300
    }` : ''}
  ]
}

Generate realistic, ${difficulty}-level questions appropriate for IELTS. Make questions coherent and thematically connected.`;

      const result = await callGemini(geminiApiKey, speakingPrompt, 2, { dbKeys: dbApiKeys, serviceClient });
      
      // Track tokens used
      const totalTokensUsed = getLastTokensUsed();
      
      if (!result) {
        // If quota exceeded, return special error with status 429
        if (wasQuotaExceeded()) {
          return new Response(JSON.stringify({ 
            error: getLastGeminiError(),
            errorType: 'QUOTA_EXCEEDED',
            suggestion: 'Check your usage at aistudio.google.com or wait a few minutes before retrying.'
          }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: getLastGeminiError() }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Update quota tracking (uses serviceClient from main handler scope)
      await updateQuotaTracking(serviceClient, user.id, totalTokensUsed);

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

      // Process the parts with proper structure
      const speakingParts = (parsed.parts || []).map((p: any, pIndex: number) => {
        const partNumber = p.part_number || pIndex + 1;
        
        return {
          id: crypto.randomUUID(),
          part_number: partNumber,
          instruction: p.instruction || '',
          questions: (p.questions || []).map((q: any, qIndex: number) => ({
            id: crypto.randomUUID(),
            question_number: q.question_number || qIndex + 1,
            question_text: q.question_text || '',
            sample_answer: q.sample_answer,
          })),
          cue_card_topic: p.cue_card_topic,
          cue_card_content: p.cue_card_content,
          preparation_time_seconds: p.preparation_time_seconds || (partNumber === 2 ? 60 : undefined),
          speaking_time_seconds: p.speaking_time_seconds || (partNumber === 2 ? 120 : undefined),
          time_limit_seconds: p.time_limit_seconds || (partNumber === 1 || partNumber === 3 ? 300 : undefined),
        };
      });

      // Credits already reserved atomically before AI call - no deduction needed

      return new Response(JSON.stringify({
        testId,
        topic: parsed.topic || topic,
        speakingParts,
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
