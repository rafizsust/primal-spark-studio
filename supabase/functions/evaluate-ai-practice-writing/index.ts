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

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

async function callGemini(apiKey: string, prompt: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
          }),
        }
      );

      if (!response.ok) continue;

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch {
      continue;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const { data: secretData } = await supabaseClient
      .from('user_secrets')
      .select('encrypted_value')
      .eq('user_id', user.id)
      .eq('secret_name', 'GEMINI_API_KEY')
      .single();

    if (!secretData) {
      return new Response(JSON.stringify({ error: 'Gemini API key not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appEncryptionKey = Deno.env.get('app_encryption_key');
    if (!appEncryptionKey) throw new Error('Encryption key not configured');
    
    const geminiApiKey = await decryptApiKey(secretData.encrypted_value, appEncryptionKey);

    const { submissionText, taskType, instruction, imageDescription } = await req.json();
    const wordCount = submissionText.trim().split(/\s+/).filter(Boolean).length;

    const evaluationPrompt = `You are an expert IELTS writing examiner. Evaluate this ${taskType === 'task1' ? 'Task 1 Report' : 'Task 2 Essay'} submission.

Task Instructions: "${instruction}"
${imageDescription ? `Visual Description: "${imageDescription}"` : ''}

Student's Submission (${wordCount} words):
"${submissionText}"

Evaluate based on IELTS criteria:
1. Task Achievement/Response (0-9)
2. Coherence and Cohesion (0-9)
3. Lexical Resource (0-9)
4. Grammatical Range and Accuracy (0-9)

Provide feedback addressing the student directly using "you" and "your".

Return ONLY valid JSON:
{
  "overall_band": 6.5,
  "evaluation_report": {
    "task_achievement": { "band": 6.5, "feedback": "Your response..." },
    "coherence_cohesion": { "band": 6.5, "feedback": "Your organization..." },
    "lexical_resource": { "band": 6.5, "feedback": "Your vocabulary..." },
    "grammatical_accuracy": { "band": 6.5, "feedback": "Your grammar..." },
    "overall_feedback": "Overall, your essay...",
    "suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"]
  }
}`;

    const result = await callGemini(geminiApiKey, evaluationPrompt);
    
    if (!result) {
      return new Response(JSON.stringify({ error: 'Failed to evaluate' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let parsed;
    try {
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return new Response(JSON.stringify({ 
        overall_band: 5.5,
        evaluation_report: { overall_feedback: result }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Evaluation error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});