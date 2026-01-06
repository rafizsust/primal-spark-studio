import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { uploadToR2 } from "../_shared/r2Client.ts";
import { createMuLawWav } from "../_shared/muLawCompressor.ts";

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

async function generateTtsPcmBase64({
  apiKey,
  text,
  voiceName,
}: {
  apiKey: string;
  text: string;
  voiceName: string;
}): Promise<string> {
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
    console.error("Gemini TTS error:", resp.status, t);
    throw new Error(`Gemini TTS failed (${resp.status})`);
  }

  const data = await resp.json();
  const audioData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data as string | undefined;
  if (!audioData) throw new Error("No audio returned from Gemini TTS");

  return audioData;
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

    const resolvedVoice = (voiceName || "Kore").trim();
    // Default to "tts/" folder for user audio (ephemeral), allow override for admin audio
    const folder = (directory || "tts").replace(/\/$/, "");
    console.log("generate-gemini-tts: user=", user.id, "items=", items.length, "voice=", resolvedVoice, "folder=", folder);

    const clips: Array<{ key: string; text: string; url?: string; audioBase64?: string; sampleRate: number }> = [];

    for (const item of items) {
      if (!item?.key || !item?.text) continue;
      
      const audioBase64 = await generateTtsPcmBase64({ apiKey: geminiApiKey, text: item.text, voiceName: resolvedVoice });
      const sampleRate = 24000;

      // OPTIMIZATION: Upload Mu-Law WAV to R2 (50% smaller than 16-bit PCM, fast encoding)
      try {
        const textHash = await hashText(item.text + resolvedVoice);
        const fileName = `${folder}/${textHash}.wav`;

        // Convert PCM to Mu-Law WAV (8-bit, 50% size reduction, CPU-friendly)
        const pcmBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
        const wavBuffer = createMuLawWav(pcmBytes, sampleRate);

        const uploadResult = await uploadToR2(fileName, wavBuffer, "audio/wav");

        if (uploadResult.success && uploadResult.url) {
          console.log("TTS audio uploaded to R2:", uploadResult.url);
          clips.push({ 
            key: item.key, 
            text: item.text, 
            url: uploadResult.url, 
            sampleRate 
          });
          continue;
        } else {
          console.warn("R2 upload failed, falling back to base64:", uploadResult.error);
        }
      } catch (r2Error) {
        console.warn("R2 upload error, falling back to base64:", r2Error);
      }

      // Fallback: return base64 if R2 upload fails
      clips.push({ key: item.key, text: item.text, audioBase64, sampleRate });
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
