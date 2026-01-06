import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gemini-api-key',
};

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

// ============================================================================
// CREDIT SYSTEM - Cost Map and Daily Limits
// ============================================================================
const COSTS = {
  'generate_speaking': 5,
  'generate_writing': 5,
  'generate_listening': 20,
  'generate_reading': 20,
  'evaluate_speaking': 15,
  'evaluate_writing': 10,
  'evaluate_reading': 0,
  'evaluate_listening': 0,
  'explain_answer': 2
};

const DAILY_CREDIT_LIMIT = 100;

// DB-managed API key interface
interface ApiKeyRecord {
  id: string;
  provider: string;
  key_value: string;
  is_active: boolean;
  error_count: number;
}

// Fetch active Gemini keys from api_keys table
async function getActiveGeminiKeys(serviceClient: any): Promise<ApiKeyRecord[]> {
  try {
    const { data, error } = await serviceClient
      .from('api_keys')
      .select('id, provider, key_value, is_active, error_count')
      .eq('provider', 'gemini')
      .eq('is_active', true)
      .order('error_count', { ascending: true });
    
    if (error) {
      console.error('Failed to fetch API keys:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Error fetching API keys:', err);
    return [];
  }
}

// Check credits (returns error if limit reached)
async function checkCredits(
  serviceClient: any, 
  userId: string, 
  operationType: keyof typeof COSTS
): Promise<{ ok: boolean; error?: string }> {
  const cost = COSTS[operationType] || 0;
  if (cost === 0) return { ok: true };
  
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('daily_credits_used, last_reset_date')
      .eq('id', userId)
      .single();
    
    if (!profile) return { ok: true };
    
    let currentCreditsUsed = profile.daily_credits_used || 0;
    if (profile.last_reset_date !== today) {
      currentCreditsUsed = 0;
      await serviceClient
        .from('profiles')
        .update({ daily_credits_used: 0, last_reset_date: today })
        .eq('id', userId);
    }
    
    if (currentCreditsUsed + cost > DAILY_CREDIT_LIMIT) {
      return { 
        ok: false, 
        error: `Daily credit limit reached (${currentCreditsUsed}/${DAILY_CREDIT_LIMIT}). Add your own Gemini API key in Settings.`
      };
    }
    
    return { ok: true };
  } catch (err) {
    console.error('Error in credit check:', err);
    return { ok: true };
  }
}

// Deduct credits after successful operation
async function deductCredits(serviceClient: any, userId: string, operationType: keyof typeof COSTS): Promise<void> {
  const cost = COSTS[operationType] || 0;
  if (cost === 0) return;
  
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('daily_credits_used, last_reset_date')
      .eq('id', userId)
      .single();
    
    if (!profile) return;
    
    let currentCreditsUsed = profile.daily_credits_used || 0;
    if (profile.last_reset_date !== today) {
      currentCreditsUsed = 0;
    }
    
    await serviceClient
      .from('profiles')
      .update({ daily_credits_used: currentCreditsUsed + cost, last_reset_date: today })
      .eq('id', userId);
    
    console.log(`Deducted ${cost} credits for ${operationType}. New total: ${currentCreditsUsed + cost}/${DAILY_CREDIT_LIMIT}`);
  } catch (err) {
    console.error('Failed to deduct credits:', err);
  }
}

// List of Gemini models in fallback order, prioritizing audio-capable models
const GEMINI_MODELS_FALLBACK_ORDER = [
  'gemini-1.5-pro', // Primary (Best)
  'gemini-1.5-flash', // Alternatives (Good)
  'gemini-pro-latest', // Alternatives (Good)
  'gemini-flash-latest', // Alternatives (Good)
  'gemini-exp-1206', // Alternatives (Good)
  'gemini-3-pro-preview', // Backup Options
  'gemini-2.0-flash-exp', // Backup Options
  'gemini-2.0-flash', // Backup Options
];

// @ts-ignore
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // @ts-ignore
    const supabaseClient = createClient(
      // @ts-ignore
      (Deno.env.get('SUPABASE_URL') as string) ?? '',
      // @ts-ignore
      (Deno.env.get('SUPABASE_ANON_KEY') as string) ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { submissionId, audioData } = await req.json(); // Receive audioData

    if (!submissionId || !audioData) {
      console.error('Edge Function: Missing submissionId or audioData in request body.');
      return new Response(JSON.stringify({ error: 'Missing submissionId or audioData', code: 'BAD_REQUEST' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Edge Function: Received audioData object:', JSON.stringify(audioData, null, 2)); // NEW LOG
    const receivedAudioKeys = Object.keys(audioData); // Get keys once
    console.log('Edge Function: Received audioData keys:', receivedAudioKeys); // Updated log

    // 1. Fetch submission details (no longer need transcripts from here)
    const { data: submission, error: submissionError } = await supabaseClient
      .from('speaking_submissions')
      .select('test_id, user_id')
      .eq('id', submissionId)
      .eq('user_id', user.id) // Ensure user owns the submission
      .single();

    if (submissionError || !submission) {
      return new Response(JSON.stringify({ error: submissionError?.message || 'Speaking submission not found or unauthorized.', code: 'SUBMISSION_NOT_FOUND' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch the associated test details to get instructions/topics
    const { data: test, error: testError } = await supabaseClient
      .from('speaking_tests')
      .select('name, description')
      .eq('id', submission.test_id)
      .single();

    if (testError || !test) {
      return new Response(JSON.stringify({ error: testError?.message || 'Associated speaking test not found.', code: 'TEST_NOT_FOUND' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Fetch question groups and questions for context
    const { data: questionGroups, error: groupsError } = await supabaseClient
      .from('speaking_question_groups')
      .select('part_number, instruction, cue_card_topic, cue_card_content, time_limit_seconds, preparation_time_seconds, speaking_time_seconds, speaking_questions(question_number, question_text, order_index, id)') // Added id to speaking_questions
      .eq('test_id', submission.test_id)
      .order('part_number')
      .order('order_index', { foreignTable: 'speaking_questions' });

    if (groupsError) {
      console.warn('Could not fetch question groups for speaking evaluation context:', groupsError.message);
      // Continue without groups if there's an error, but log it.
    }

    // Service client for credit operations
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const appEncryptionKey = Deno.env.get('app_encryption_key');

    // ============ HYBRID KEY PRIORITY SYSTEM ============
    const headerApiKey = req.headers.get('x-gemini-api-key');
    let geminiApiKey: string | null = null;
    let isUserProvidedKey = false;
    
    if (headerApiKey) {
      geminiApiKey = headerApiKey;
      isUserProvidedKey = true;
    } else {
      const { data: userSecret } = await supabaseClient
        .from('user_secrets')
        .select('encrypted_value')
        .eq('user_id', user.id)
        .eq('secret_name', 'GEMINI_API_KEY')
        .single();

      if (userSecret && appEncryptionKey) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const keyData = encoder.encode(appEncryptionKey);
        const cryptoKey = await crypto.subtle.importKey("raw", keyData.slice(0, 32), { name: "AES-GCM" }, false, ["decrypt"]);
        const encryptedBytes = Uint8Array.from(atob(userSecret.encrypted_value), c => c.charCodeAt(0));
        const decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encryptedBytes.slice(0, 12) }, cryptoKey, encryptedBytes.slice(12));
        geminiApiKey = decoder.decode(decryptedData);
        isUserProvidedKey = true;
      }
    }
    
    if (!isUserProvidedKey) {
      const dbApiKeys = await getActiveGeminiKeys(serviceClient);
      if (dbApiKeys.length > 0) geminiApiKey = dbApiKeys[0].key_value;
    }
    
    if (!geminiApiKey) {
      return new Response(JSON.stringify({ error: 'No API key available. Please add your Gemini API key in Settings.', code: 'API_KEY_NOT_FOUND' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Credit check for system pool users
    if (!isUserProvidedKey) {
      const creditCheck = await checkCredits(serviceClient, user.id, 'evaluate_speaking');
      if (!creditCheck.ok) {
        return new Response(JSON.stringify({ error: creditCheck.error, code: 'CREDIT_LIMIT_EXCEEDED' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 5. Construct Gemini API request parts with audio
    // Each item in 'contents' array must have a 'parts' array.
    const contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = [];

    // Initial instruction for Gemini
    contents.push({
      parts: [{
        text: `You are an expert IELTS speaking examiner. I will provide you with the context of an IELTS Speaking Test (instructions, questions, cue card) and your audio recordings for each part. Your task is to **listen carefully to your audio** and provide a detailed evaluation of your speaking performance.

      Focus on offering constructive feedback and an overall band score, similar to how a human examiner would. It is CRUCIAL that you evaluate the actual spoken audio for pronunciation, fluency, and intonation, not just the content.

      **When providing strengths, weaknesses, and suggestions, use markdown for emphasis:**
      -   Wrap **important words or phrases** in double asterisks for bolding (e.g., **strong vocabulary**).
      -   Wrap ==key terms or examples== in double equals signs for highlighting (e.g., ==cohesive devices==).

      ---
      **IELTS Speaking Test: ${test.name}**
      ${test.description ? `Description: ${test.description}` : ''}
      ---
      `
      }]
    });

    // Add parts and questions with their corresponding audio
    questionGroups?.forEach(group => {
      contents.push({ parts: [{ text: `\n**Part ${group.part_number}: ${group.part_number === 1 ? 'Introduction and Interview' : group.part_number === 2 ? 'Individual Long Turn (Cue Card)' : 'Two-way Discussion'}**\n` }] });
      if (group.instruction) {
        contents.push({ parts: [{ text: `Instructions: "${group.instruction}"\n` }] });
      }

      if (group.part_number === 2) {
        if (group.cue_card_topic) contents.push({ parts: [{ text: `Cue Card Topic: "${group.cue_card_topic}"\n` }] });
        if (group.cue_card_content) contents.push({ parts: [{ text: `Cue Card Content: "${group.cue_card_content}"\n` }] });
        contents.push({ parts: [{ text: `Preparation Time: ${group.preparation_time_seconds} seconds, Speaking Time: ${group.speaking_time_seconds} seconds.\n` }] });
        
        // Part 2 has one logical question (the cue card itself)
        const part2Question = group.speaking_questions?.[0];
        if (part2Question) {
          const audioKey = `part${group.part_number}-q${part2Question.id}`;
          console.log(`Edge Function: Checking audio for ${audioKey}. Exists in receivedAudioKeys: ${receivedAudioKeys.includes(audioKey)}. Value type: ${typeof audioData[audioKey]}. Value length: ${audioData[audioKey]?.length}`); // NEW LOG
           if (receivedAudioKeys.includes(audioKey) && audioData[audioKey]) {
             const { mimeType, base64: audioBase64 } = parseDataUrl(audioData[audioKey]);
             // Validate audio has actual content (not just empty recording)
             if (audioBase64 && audioBase64.length > 1000) { // Minimum ~750 bytes of actual audio
               contents.push({ parts: [{ text: `Your Audio Response for Part 2 (Topic: "${part2Question.question_text}"):\n` }] });
               contents.push({ parts: [{ inlineData: { mimeType, data: audioBase64 } }] });
               contents.push({ parts: [{ text: `Please provide a transcript for the above audio for Part 2, using the key "${audioKey}" in the "transcripts" object of the final JSON output. If the audio is silent or contains no speech, indicate "No speech detected" and give a band score of 0 for that part.` }] });
             } else {
              contents.push({ parts: [{ text: `You provided an empty or silent recording for Part 2. Score this as 0.\n` }] });
            }
          } else {
            contents.push({ parts: [{ text: `You did not provide audio for Part 2. Score this as 0.\n` }] });
          }
        }
      } else {
        group.speaking_questions?.forEach(question => {
          contents.push({ parts: [{ text: `\nQuestion ${question.question_number}: "${question.question_text}"\n` }] });
          const audioKey = `part${group.part_number}-q${question.id}`;
          console.log(`Edge Function: Checking audio for ${audioKey}. Exists in receivedAudioKeys: ${receivedAudioKeys.includes(audioKey)}. Value type: ${typeof audioData[audioKey]}. Value length: ${audioData[audioKey]?.length}`);
           if (receivedAudioKeys.includes(audioKey) && audioData[audioKey]) {
             const { mimeType, base64: audioBase64 } = parseDataUrl(audioData[audioKey]);
             // Validate audio has actual content (not just empty recording)
             if (audioBase64 && audioBase64.length > 1000) { // Minimum ~750 bytes of actual audio
               contents.push({ parts: [{ text: `Your Audio Response for Question ${question.question_number}:\n` }] });
               contents.push({ parts: [{ inlineData: { mimeType, data: audioBase64 } }] });
               contents.push({ parts: [{ text: `Please provide a transcript for the above audio for Question ${question.question_number}, using the key "${audioKey}" in the "transcripts" object of the final JSON output. If the audio is silent or contains no speech, indicate "No speech detected" and give a band score of 0 for that question.` }] });
             } else {
              contents.push({ parts: [{ text: `You provided an empty or silent recording for Question ${question.question_number}. Score this as 0.\n` }] });
            }
          } else {
            contents.push({ parts: [{ text: `You did not provide audio for Question ${question.question_number}. Score this as 0.\n` }] });
          }
        });
      }
    });

    contents.push({
      parts: [{
        text: `\n---
      **Evaluation Criteria:**

      1.  **Fluency and Coherence**:
          -   **Band**: [0-9, in 0.5 increments]
          -   **Strengths**: What you did well in speaking smoothly, logically, and connecting ideas.
          -   **Weaknesses**: Areas where your pauses, repetition, or unclear connections could be improved.
          -   **Suggestions for Improvement**: Actionable advice to enhance your fluency and coherence.
      2.  **Lexical Resource**:
          -   **Band**: [0-9, in 0.5 increments]
          -   **Strengths**: What you did well in using a range of vocabulary accurately and appropriately.
          -   **Weaknesses**: Areas where your vocabulary could be more varied, precise, or natural.
          -   **Suggestions for Improvement**: Advice on expanding your vocabulary and using less common lexical items effectively.
      3.  **Grammatical Range and Accuracy**:
          -   **Band**: [0-9, in 0.5 increments]
          -   **Strengths**: What you did well in using a variety of grammatical structures accurately.
          -   **Weaknesses**: Common errors or areas where your grammatical control could be improved.
          -   **Suggestions for Improvement**: Advice to enhance your grammatical range and accuracy.
      4.  **Pronunciation**:
          -   **Band**: [0-9, in 0.5 increments]
          -   **Strengths**: What you did well in producing clear, understandable speech with appropriate intonation and stress.
          -   **Weaknesses**: Areas where your pronunciation, intonation, or stress patterns could be improved for clarity.
          -   **Suggestions for Improvement**: Advice to improve your pronunciation for better intelligibility.

      **Part-by-Part Analysis:**
      Provide a brief summary of performance for each part, highlighting specific strengths and weaknesses observed in that part.

      -   **Part 1: Introduction & Interview**
          -   **Summary**: Overall impression of Part 1.
          -   **Strengths**: Specific examples of good performance.
          -   **Weaknesses**: Specific areas for improvement.
      -   **Part 2: Individual Long Turn**
          -   **Topic Coverage**: How well the topic was addressed.
          -   **Organization Quality**: Structure and flow of the long turn.
          -   **Cue Card Fulfillment**: How well all parts of the cue card were covered.
      -   **Part 3: Two-way Discussion**
          -   **Depth of Discussion**: Ability to discuss abstract ideas and elaborate.
          -   **Question Notes**: Any specific observations on handling Part 3 questions.

      **Overall Recommendations:**
      -   **Improvement Recommendations**: A list of general actionable advice and strategies you can use to improve overall speaking.
      -   **Strengths to Maintain**: A list of key strengths you should continue to leverage.
      -   **Examiner Notes (Optional)**: Any additional general comments.

      Format your response as a JSON object with the following structure:
      {
        "overall_band": number,
        "evaluation_report": {
          "fluency_coherence": {
            "band": number,
            "strengths": string,
            "weaknesses": string,
            "suggestions_for_improvement": string
          },
          "lexical_resource": {
            "band": number,
            "strengths": string,
            "weaknesses": string,
            "suggestions_for_improvement": string
          },
          "grammatical_range_accuracy": {
            "band": number,
            "strengths": string,
            "weaknesses": string,
            "suggestions_for_improvement": string
          },
          "pronunciation": {
            "band": number,
            "strengths": string,
            "weaknesses": string,
            "suggestions_for_improvement": string
          },
          "part_by_part_analysis": {
            "part1": {
              "summary": string,
              "strengths": string,
              "weaknesses": string
            },
            "part2": {
              "topic_coverage": string,
              "organization_quality": string,
              "cue_card_fulfillment": string
            },
            "part3": {
              "depth_of_discussion": string,
              "question_notes": string
            }
          },
          "improvement_recommendations": string[],
          "strengths_to_maintain": string[],
          "examiner_notes": string,
          "transcripts": { // NEW FIELD FOR TRANSCRIPTS
            "part1-q[question_id_1]": "Transcript for Part 1 Question 1",
            "part1-q[question_id_2]": "Transcript for Part 1 Question 2",
            "part2-q[part2_question_id]": "Transcript for Part 2 long turn",
            "part3-q[question_id_1]": "Transcript for Part 3 Question 1"
            // ... and so on for all recorded audio segments that had audio provided
          }
        }
      }
      
      Ensure your response is ONLY the JSON object, with no additional text or markdown formatting outside of the JSON itself.
      `
      }]
    });

    console.log('Edge Function: Gemini contents array:', JSON.stringify(contents, null, 2)); // Log 4

    // 6. Call Gemini API for evaluation with fallback models
    let responseText: string | null = null;
    let usedModel: string | null = null;

    for (const modelName of GEMINI_MODELS_FALLBACK_ORDER) {
      console.log(`Attempting evaluation with Gemini model: ${modelName}`);
      const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;

      try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: contents, // Send the constructed contents array
          }),
        });

        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          const content = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (content) {
            responseText = content;
            usedModel = modelName;
            break; // Exit loop on successful response with content
          } else {
            console.warn(`Model ${modelName} returned OK but no content. Trying next model.`);
          }
        } else {
          const errorText = await geminiResponse.text();
          console.error(`Gemini API error with model ${modelName} (Status: ${geminiResponse.status}): ${errorText}`);

          // Specific error handling for Gemini API issues
          if (geminiResponse.status === 401 || geminiResponse.status === 403) {
            throw new Error(JSON.stringify({ error: `Your Gemini API key is invalid or suspended. Please check your key in settings.`, code: 'API_KEY_INVALID_OR_SUSPENDED' }));
          } else if (geminiResponse.status === 429) {
            throw new Error(JSON.stringify({ error: `Your Gemini API quota has been exceeded. Please wait or check your usage limits.`, code: 'GEMINI_QUOTA_EXCEEDED' }));
          }
          
          const isRecoverableError = 
            (geminiResponse.status >= 500 && geminiResponse.status < 600) || 
            errorText.includes('rate limit') || 
            errorText.includes('overloaded') || 
            errorText.includes('model not found') || 
            errorText.includes('invalid model');

          if (isRecoverableError) {
            console.log(`Recoverable error with model ${modelName}. Trying next model.`);
            continue;
          } else {
            throw new Error(JSON.stringify({ error: `Gemini API error: ${geminiResponse.status} - ${errorText}`, code: 'GEMINI_SERVICE_ERROR' }));
          }
        }
      } catch (fetchError: any) {
        console.error(`Fetch error with model ${modelName}:`, fetchError.message);
        continue;
      }
    }

    if (!responseText || !usedModel) {
      throw new Error(JSON.stringify({ error: 'All Gemini models failed to provide a valid response after multiple attempts.', code: 'GEMINI_SERVICE_ERROR' }));
    }

    console.log(`Successfully received response from model: ${usedModel}`);

    let evaluationReport: any;
    let overallBand: number | null = null;

    try {
      responseText = responseText.replace(/```json\n|\n```/g, '').trim();
      console.log('Cleaned Gemini response:', responseText);

      const parsedResponse = JSON.parse(responseText);
      overallBand = parsedResponse.overall_band;
      evaluationReport = parsedResponse.evaluation_report;
    } catch (parseError) {
      console.error('Failed to parse Gemini JSON response:', parseError);
      evaluationReport = {
        raw_response: responseText,
        parse_error: 'Failed to parse full JSON from Gemini. Raw response provided.',
      };
      const bandMatch = responseText.match(/Overall Band Score:\s*(\d+(\.\d)?)/i);
      if (bandMatch && bandMatch[1]) {
        overallBand = parseFloat(bandMatch[1]);
      }
    }

    // 7. Update submission with evaluation results (transcripts remain null)
    const { error: updateError } = await supabaseClient
      .from('speaking_submissions')
      .update({
        evaluation_report: evaluationReport,
        overall_band: overallBand,
        // transcript_partX fields remain null as Gemini provides evaluation, not ASR transcript
      })
      .eq('id', submissionId);

    if (updateError) throw updateError;

    // 8. Implement cleanup: Keep only the last 3 submissions for this user and speaking test
    const { data: userSubmissionsForTest, error: userSubmissionsError } = await supabaseClient
      .from('speaking_submissions')
      .select('id, submitted_at')
      .eq('user_id', user.id)
      .eq('test_id', submission.test_id)
      .order('submitted_at', { ascending: false });

    if (userSubmissionsError) {
      console.error('Error fetching user submissions for cleanup:', userSubmissionsError);
    } else if (userSubmissionsForTest) {
      const sortedAttemptTimestamps = Array.from(new Set(userSubmissionsForTest.map(sub => sub.submitted_at || '') as string[])).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

      if (sortedAttemptTimestamps.length > 3) {
        const timestampsToDelete = sortedAttemptTimestamps.slice(3);
        const submissionIdsToDelete: string[] = [];
        timestampsToDelete.forEach(ts => {
          userSubmissionsForTest.filter(sub => sub.submitted_at === ts).forEach(sub => submissionIdsToDelete.push(sub.id));
        });

        if (submissionIdsToDelete.length > 0) {
          const { error: deleteError } = await supabaseClient
            .from('speaking_submissions')
            .delete()
            .in('id', submissionIdsToDelete);

          if (deleteError) {
            console.error('Error deleting old submissions:', deleteError);
          } else {
            console.log(`Deleted ${submissionIdsToDelete.length} old speaking submissions for user ${user.id} and test ${submission.test_id}.`);
          }
        }
      }
    }

    return new Response(JSON.stringify({ message: 'Evaluation completed successfully', overallBand, evaluationReport }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Edge Function error:', error.message);
    let errorMessage = 'An unexpected error occurred during evaluation.';
    let errorCode = 'UNKNOWN_ERROR';
    try {
      const parsedError = JSON.parse(error.message);
      errorMessage = parsedError.error || errorMessage;
      errorCode = parsedError.code || errorCode;
    } catch (e) {
      // Not a JSON error, use original message
      errorMessage = error.message;
    }

    return new Response(JSON.stringify({ error: errorMessage, code: errorCode }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});