import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { uploadToR2 } from "../_shared/r2Client.ts";
import { compressPcmBase64ToMp3 } from "../_shared/audioCompressor.ts";

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

// Convert PCM base64 to WAV format (mono, 16-bit, 24kHz - optimized for speech)
// Note: WAV is used for maximum compatibility. For production at scale,
// consider using a CDN with on-the-fly transcoding or client-side compression.
function pcmToWavBuffer(pcmBase64: string, sampleRate: number): Uint8Array {
  const pcmBytes = Uint8Array.from(atob(pcmBase64), (c) => c.charCodeAt(0));
  const numChannels = 1; // Mono - optimal for spoken word
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, totalSize - 8, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Copy PCM data
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmBytes, headerSize);

  return wavBytes;
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

    const clips: Array<{ key: string; text: string; url?: string; audioBase64?: string; sampleRate: number }> = [];

    for (const item of items) {
      if (!item?.key || !item?.text) continue;
      
      const audioBase64 = await generateTtsPcmBase64({ apiKey: geminiApiKey, text: item.text, voiceName: resolvedVoice });
      const sampleRate = 24000;

      // OPTIMIZATION: Compress to MP3 and upload to R2 for bandwidth savings
      try {
        const textHash = await hashText(item.text + resolvedVoice);
        const fileName = `tts/${textHash}.mp3`;

        // Compress PCM to MP3 (80-90% smaller than WAV)
        const mp3Buffer = compressPcmBase64ToMp3(audioBase64, sampleRate);

        const uploadResult = await uploadToR2(fileName, mp3Buffer, "audio/mpeg");

        if (uploadResult.success && uploadResult.url) {
          console.log("TTS audio compressed & uploaded to R2:", uploadResult.url);
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
