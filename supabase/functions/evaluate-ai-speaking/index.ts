import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const body: EvaluationRequest = await req.json();
    const { testId, partAudios, transcripts, topic, difficulty } = body;

    console.log(`Evaluating speaking test ${testId} for user ${user.id}`);
    console.log(`Parts received: ${partAudios.length}`);

    // Upload audio files to storage
    const audioUrls: Record<number, string> = {};
    for (const part of partAudios) {
      try {
        const audioBytes = Uint8Array.from(atob(part.audioBase64), c => c.charCodeAt(0));
        const path = `ai-speaking/${user.id}/${testId}/part${part.partNumber}.webm`;
        
        const { error: uploadError } = await supabase.storage
          .from('speaking-audios')
          .upload(path, audioBytes, { contentType: 'audio/webm', upsert: true });

        if (!uploadError) {
          audioUrls[part.partNumber] = supabase.storage.from('speaking-audios').getPublicUrl(path).data.publicUrl;
        }
      } catch (err) {
        console.error(`Failed to upload Part ${part.partNumber} audio:`, err);
      }
    }

    // Build evaluation prompt with 2025 precision standards
    const evaluationPrompt = buildEvaluationPrompt(transcripts, topic, difficulty);

    // Call Lovable AI for evaluation
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: getEvaluationSystemPrompt() },
          { role: 'user', content: evaluationPrompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'submit_evaluation',
            description: 'Submit the comprehensive IELTS speaking evaluation with model answers',
            parameters: {
              type: 'object',
              properties: {
                overallBand: { type: 'number', description: 'Overall band score (0-9)' },
                fluencyCoherence: {
                  type: 'object',
                  properties: {
                    score: { type: 'number' },
                    feedback: { type: 'string' },
                    examples: { type: 'array', items: { type: 'string' } }
                  },
                  required: ['score', 'feedback', 'examples']
                },
                lexicalResource: {
                  type: 'object',
                  properties: {
                    score: { type: 'number' },
                    feedback: { type: 'string' },
                    examples: { type: 'array', items: { type: 'string' } },
                    lexicalUpgrades: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          original: { type: 'string' },
                          upgraded: { type: 'string' },
                          context: { type: 'string' }
                        },
                        required: ['original', 'upgraded', 'context']
                      }
                    }
                  },
                  required: ['score', 'feedback', 'examples', 'lexicalUpgrades']
                },
                grammaticalRange: {
                  type: 'object',
                  properties: {
                    score: { type: 'number' },
                    feedback: { type: 'string' },
                    examples: { type: 'array', items: { type: 'string' } },
                    errors: { type: 'array', items: { type: 'string' } }
                  },
                  required: ['score', 'feedback', 'examples']
                },
                pronunciation: {
                  type: 'object',
                  properties: {
                    score: { type: 'number' },
                    feedback: { type: 'string' },
                    notes: { type: 'array', items: { type: 'string' } }
                  },
                  required: ['score', 'feedback']
                },
                partAnalysis: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      partNumber: { type: 'number' },
                      strengths: { type: 'array', items: { type: 'string' } },
                      improvements: { type: 'array', items: { type: 'string' } },
                      wordLimitViolations: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['partNumber', 'strengths', 'improvements']
                  }
                },
                modelAnswers: {
                  type: 'array',
                  description: 'Band 8+ model answers for key questions in each part',
                  items: {
                    type: 'object',
                    properties: {
                      partNumber: { type: 'number', description: 'Part 1, 2, or 3' },
                      question: { type: 'string', description: 'The question being answered' },
                      candidateResponse: { type: 'string', description: 'What the candidate said (summarized)' },
                      modelAnswer: { type: 'string', description: 'A Band 8+ example response' },
                      keyFeatures: { 
                        type: 'array', 
                        items: { type: 'string' },
                        description: 'What makes this a Band 8+ answer'
                      }
                    },
                    required: ['partNumber', 'question', 'modelAnswer', 'keyFeatures']
                  }
                },
                summary: { type: 'string', description: 'Overall summary and advice' },
                keyStrengths: { type: 'array', items: { type: 'string' } },
                priorityImprovements: { type: 'array', items: { type: 'string' } }
              },
              required: ['overallBand', 'fluencyCoherence', 'lexicalResource', 'grammaticalRange', 'pronunciation', 'modelAnswers', 'summary']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'submit_evaluation' } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Evaluation API error:', errorText);
      throw new Error('Failed to evaluate speaking test');
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      throw new Error('Invalid evaluation response');
    }

    const evaluation = JSON.parse(toolCall.function.arguments);

    // Save to database
    const { error: insertError } = await supabase.from('ai_practice_results').insert({
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
      audioUrls
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

Be encouraging but honest. Provide specific examples from the transcript.`;
}

function buildEvaluationPrompt(transcripts?: Record<number, string>, topic?: string, difficulty?: string): string {
  let prompt = `Please evaluate this IELTS Speaking test performance.\n\n`;
  
  if (topic) {
    prompt += `TEST TOPIC: ${topic}\n`;
  }
  if (difficulty) {
    prompt += `DIFFICULTY LEVEL: ${difficulty}\n\n`;
  }

  prompt += `CANDIDATE'S RESPONSES:\n\n`;

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
7. MODEL ANSWERS: For 2-3 key questions from each part, provide Band 8+ example responses that demonstrate:
   - Sophisticated vocabulary and collocations
   - Complex grammatical structures
   - Natural fluency and coherence
   - Clear organization and development of ideas
   
   For each model answer, explain what makes it a Band 8+ response.`;

  return prompt;
}
