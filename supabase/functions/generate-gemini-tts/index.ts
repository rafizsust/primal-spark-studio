import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

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

// Helper to sleep for specified ms
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateTtsPcmBase64({
  apiKey,
  text,
  voiceName,
  maxRetries = 3,
}: {
  apiKey: string;
  text: string;
  voiceName: string;
  maxRetries?: number;
}): Promise<string> {
  const prompt = `You are an IELTS Speaking examiner with a neutral British accent.\n\nRead aloud EXACTLY the following text. Do not add, remove, or paraphrase anything. Use natural pacing and clear pronunciation.\n\n"""\n${text}\n"""`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

    if (resp.ok) {
      const data = await resp.json();
      const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data as string | undefined;
      if (!audioData) throw new Error("No audio returned from Gemini TTS");
      return audioData;
    }

    // Handle rate limiting (429)
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("Retry-After") || "0", 10);
      const waitTime = retryAfter > 0 ? retryAfter * 1000 : Math.min(20000 * Math.pow(2, attempt), 60000);
      console.log(`Rate limited (attempt ${attempt + 1}/${maxRetries + 1}), waiting ${waitTime}ms...`);
      
      if (attempt < maxRetries) {
        await sleep(waitTime);
        continue;
      }
    }

    const t = await resp.text();
    console.error("Gemini TTS error:", resp.status, t);
    throw new Error(`Gemini TTS failed (${resp.status})`);
  }

  throw new Error("Gemini TTS failed after max retries");
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

    const { items, voiceName }: { items: TtsItem[]; voiceName?: string } = await req.json();

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

    const resolvedVoice = (voiceName || "Kore").trim();
    console.log("generate-gemini-tts: user=", user.id, "items=", items.length, "voice=", resolvedVoice);

    const clips: Array<{ key: string; text: string; audioBase64: string; sampleRate: number }> = [];

    // Process items with delay between calls to respect rate limits
    // Free tier: 3 req/min. Retry-After suggests ~12s wait, we use 15s to be safe.
    const DELAY_BETWEEN_CALLS_MS = 15000;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item?.key || !item?.text) continue;
      
      // Add delay before each call except the first one
      if (i > 0) {
        console.log(`Waiting ${DELAY_BETWEEN_CALLS_MS}ms before TTS call ${i + 1}/${items.length}...`);
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
      
      try {
        const audioBase64 = await generateTtsPcmBase64({ apiKey: geminiApiKey, text: item.text, voiceName: resolvedVoice });
        clips.push({ key: item.key, text: item.text, audioBase64, sampleRate: 24000 });
        console.log(`Generated clip ${i + 1}/${items.length}: ${item.key}`);
      } catch (err) {
        console.error(`Failed to generate clip ${item.key}:`, err);
        // Continue with other clips instead of failing entirely
      }
    }

    if (clips.length === 0) {
      return new Response(JSON.stringify({ error: "Failed to generate any audio clips" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
