import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { uploadToR2 } from "../_shared/r2Client.ts";
import { compressPcmToMp3 } from "../_shared/audioCompressor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TtsItem = {
  key: string;
  text: string;
};

async function decryptApiKey(encryptedValue: string, encryptionKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const combined = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
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

  const decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, encryptedData);
  return decoder.decode(decryptedData);
}

// Generate a hash for deduplication
async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .slice(0, 8) // Use first 8 bytes for shorter hash
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Exponential backoff configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;

// Concurrency control for request queuing
const MAX_CONCURRENT_REQUESTS = 3; // Limit concurrent TTS requests

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number): number {
  // Exponential backoff with jitter: base * 2^attempt + random jitter
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500; // Add 0-500ms jitter
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
}

async function generateTtsPcmBase64Once({
  apiKey,
  text,
  voiceName,
}: {
  apiKey: string;
  text: string;
  voiceName: string;
}): Promise<{ audioBase64: string; status: number }> {
  const prompt = `You are an IELTS Speaking examiner with a neutral British accent.\n\nRead aloud EXACTLY the following text. Do not add, remove, or paraphrase anything. Use natural pacing and clear pronunciation.\n\n"""\n${text}\n"""`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
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
    }
  );

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Gemini TTS error:", resp.status, t.slice(0, 300));
    return { audioBase64: "", status: resp.status };
  }

  const data = await resp.json();
  const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data as string | undefined;
  if (!audioData) throw new Error("No audio returned from Gemini TTS");

  return { audioBase64: audioData, status: 200 };
}

async function getSystemGeminiKeys(serviceClient: any): Promise<string[]> {
  try {
    const { data, error } = await serviceClient
      .from("api_keys")
      .select("key_value")
      .eq("provider", "gemini")
      .eq("is_active", true)
      .order("error_count", { ascending: true })
      .limit(10);

    if (error) {
      console.warn("Failed to fetch system Gemini keys:", error);
      return [];
    }

    return (data || []).map((r: any) => String(r.key_value)).filter(Boolean);
  } catch (e) {
    console.warn("System key fetch error:", e);
    return [];
  }
}

// Shuffle array using Fisher-Yates algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Generate TTS with exponential backoff retry
async function generateTtsPcmBase64WithRetry({
  apiKey,
  text,
  voiceName,
}: {
  apiKey: string;
  text: string;
  voiceName: string;
}): Promise<{ audioBase64: string; status: number }> {
  let lastResult = { audioBase64: "", status: 0 };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await generateTtsPcmBase64Once({ apiKey, text, voiceName });
    lastResult = result;

    if (result.status === 200) {
      return result;
    }

    // Only retry on rate limit (429) - other errors fail immediately
    if (result.status !== 429) {
      return result;
    }

    // Don't wait after the last attempt
    if (attempt < MAX_RETRIES) {
      const delay = getBackoffDelay(attempt);
      console.log(`Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(delay);
    }
  }

  console.log(`All ${MAX_RETRIES} retries exhausted for key`);
  return lastResult;
}

async function generateTtsPcmBase64WithFallback({
  primaryKey,
  fallbackKeys,
  text,
  voiceName,
}: {
  primaryKey: string;
  fallbackKeys: string[];
  text: string;
  voiceName: string;
}): Promise<string> {
  // Build a pool of all available keys (user key + system keys)
  const allKeys = [primaryKey, ...fallbackKeys].filter(Boolean);
  
  if (allKeys.length === 0) {
    throw new Error("No API keys available. Please add your Gemini API key in Settings.");
  }

  // Shuffle the pool randomly to distribute load across all keys
  const shuffledKeys = shuffleArray(allKeys);
  
  let lastStatus = 0;
  let lastError = "";

  // Try each key in random order with retry logic
  for (const apiKey of shuffledKeys) {
    const result = await generateTtsPcmBase64WithRetry({ apiKey, text, voiceName });
    
    if (result.status === 200) {
      return result.audioBase64;
    }
    
    lastStatus = result.status;
    
    // For non-rate-limit errors (except 403), fail immediately
    if (result.status !== 429 && result.status !== 403) {
      lastError = `Gemini TTS failed with status ${result.status}`;
      break;
    }
    
    // Continue to next key for 429/403 errors
    console.log(`Key exhausted after retries (${result.status}), trying next key...`);
  }

  // All keys exhausted or non-retryable error
  if (lastStatus === 429) {
    throw new Error("All API keys are rate-limited. Please try again later.");
  }
  if (lastStatus === 403) {
    throw new Error("All API keys are blocked/forbidden. Please check your API key configuration.");
  }
  
  throw new Error(lastError || `Gemini TTS failed (${lastStatus})`);
}

// Request queue for concurrency control
class RequestQueue {
  private queue: Array<{ task: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  private running = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ 
        task: task as () => Promise<unknown>, 
        resolve: resolve as (value: unknown) => void, 
        reject 
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { task, resolve, reject } = this.queue.shift()!;

    task()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.running--;
        this.processQueue();
      });
  }
}

// Process items with concurrency control
async function processItemsWithQueue({
  items,
  geminiApiKey,
  systemKeys,
  voiceName,
  folder,
  sampleRate,
}: {
  items: TtsItem[];
  geminiApiKey: string;
  systemKeys: string[];
  voiceName: string;
  folder: string;
  sampleRate: number;
}): Promise<Array<{ key: string; text: string; url?: string; audioBase64?: string; sampleRate: number }>> {
  const queue = new RequestQueue(MAX_CONCURRENT_REQUESTS);

  console.log(`Processing ${items.length} items with max ${MAX_CONCURRENT_REQUESTS} concurrent requests`);

  const tasks = items.map((item) =>
    queue.add(async () => {
      if (!item?.key || !item?.text) return null;

      const audioBase64 = await generateTtsPcmBase64WithFallback({
        primaryKey: geminiApiKey,
        fallbackKeys: systemKeys,
        text: item.text,
        voiceName,
      });

      // Compress PCM to MP3 for 80-90% size reduction (consistent with AI Practice)
      try {
        const textHash = await hashText(item.text + voiceName);
        const fileName = `${folder}/${textHash}.mp3`;

        const pcmBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
        const mp3Buffer = compressPcmToMp3(pcmBytes, sampleRate);

        console.log("generate-gemini-tts: mp3 bytes=", mp3Buffer.length, "key=", fileName, "(compressed from", pcmBytes.length, "PCM bytes)");

        const uploadResult = await uploadToR2(fileName, mp3Buffer, "audio/mpeg");

        if (uploadResult.success && uploadResult.url) {
          return {
            key: item.key,
            text: item.text,
            url: uploadResult.url,
            sampleRate,
          };
        } else {
          console.warn("R2 upload failed, falling back to base64:", uploadResult.error);
        }
      } catch (r2Error) {
        console.warn("R2 upload error, falling back to base64:", r2Error);
      }

      // Fallback: return base64 if R2 upload fails
      return { key: item.key, text: item.text, audioBase64, sampleRate };
    })
  );

  const results = await Promise.all(tasks);
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { items, voiceName, directory }: { items: TtsItem[]; voiceName?: string; directory?: string } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: "items[] is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: secretData, error: secretError } = await supabaseClient
      .from("user_secrets")
      .select("encrypted_value")
      .eq("user_id", user.id)
      .eq("secret_name", "GEMINI_API_KEY")
      .single();

    if (secretError || !secretData) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not found. Please add your API key in Settings." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const appEncryptionKey = Deno.env.get("app_encryption_key");
    if (!appEncryptionKey) throw new Error("app_encryption_key not configured");

    const geminiApiKey = await decryptApiKey(secretData.encrypted_value, appEncryptionKey);

    // Service client used ONLY for system-pool fallback keys (prevents user TTS from hard-failing on 429)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const systemKeys = await getSystemGeminiKeys(serviceClient);

    const resolvedVoice = (voiceName || "Kore").trim();
    // Default to "tts/" folder for user audio, allow override for admin audio
    const folder = (directory || "tts").replace(/\/$/, "");

    // Gemini returns PCM at 24000Hz 16-bit - we preserve full quality (no Mu-Law)
    const sampleRate = 24000;

    console.log(
      "generate-gemini-tts:",
      "user=", user.id,
      "items=", items.length,
      "voice=", resolvedVoice,
      "folder=", folder,
      "sampleRate=", sampleRate
    );

    // Process items with concurrency control and queuing
    const clips = await processItemsWithQueue({
      items,
      geminiApiKey,
      systemKeys,
      voiceName: resolvedVoice,
      folder,
      sampleRate,
    });

    return new Response(JSON.stringify({ success: true, clips }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("generate-gemini-tts error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
