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

// Speaking topics for each part
const SPEAKING_TOPICS = {
  part1: [
    'hometown', 'work or studies', 'hobbies', 'daily routine', 'food and cooking',
    'music', 'reading', 'sports', 'travel', 'technology', 'friends', 'weather'
  ],
  part2: [
    'a memorable event', 'a person who influenced you', 'a place you visited',
    'an achievement you are proud of', 'a book or movie that impressed you',
    'a skill you learned', 'a tradition in your culture', 'a challenge you faced'
  ],
  part3: [
    'social issues', 'education', 'technology impact', 'environment', 
    'work-life balance', 'cultural differences', 'future predictions'
  ]
};

// Gemini models to try (with fallback)
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

async function callGemini(apiKey: string, prompt: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      console.log(`Trying Gemini model: ${model}`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`Gemini ${model} failed:`, JSON.stringify(errorData));
        if (response.status === 429) continue;
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        console.log(`Success with ${model}`);
        return text;
      }
    } catch (err) {
      console.error(`Error with ${model}:`, err);
      continue;
    }
  }
  return null;
}

// Generate TTS audio using Gemini with retry logic for transient errors
async function generateAudio(apiKey: string, script: string, maxRetries = 3): Promise<{ audioBase64: string; sampleRate: number } | null> {
  const ttsPrompt = `Read the following conversation slowly and clearly, as if for a language listening test. 
Use a moderate speaking pace with natural pauses between sentences. 
Pause briefly (about 1-2 seconds) after each speaker finishes their turn.
Speaker1 and Speaker2 should have distinct, clear voices:

${script}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating TTS audio (attempt ${attempt}/${maxRetries})...`);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: ttsPrompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: [
                    { speaker: "Speaker1", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
                    { speaker: "Speaker2", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
                  ],
                },
              },
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`TTS failed (attempt ${attempt}):`, errorText);
        
        // Retry on 500/503 errors (transient)
        if ((response.status === 500 || response.status === 503) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
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
      }
    } catch (err) {
      console.error(`TTS error (attempt ${attempt}):`, err);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  return null;
}

// Generate single voice TTS for speaking questions with retry logic
async function generateSingleVoiceTTS(apiKey: string, text: string, maxRetries = 3): Promise<{ audioBase64: string; sampleRate: number } | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Generating single voice TTS (attempt ${attempt}/${maxRetries})...`);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Read this question slowly and clearly as an IELTS examiner: ${text}` }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Kore" }
                }
              },
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Single voice TTS failed (attempt ${attempt}):`, errorText);
        
        // Retry on 500/503 errors (transient)
        if ((response.status === 500 || response.status === 503) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Retrying single voice TTS in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return null;
      }

      const data = await response.json();
      const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (audioData) {
        console.log("Single voice TTS generated successfully");
        return { audioBase64: audioData, sampleRate: 24000 };
      }
    } catch (err) {
      console.error(`Single voice TTS error (attempt ${attempt}):`, err);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  return null;
}

// Generate image using Gemini image model
async function generateImage(apiKey: string, prompt: string): Promise<string | null> {
  try {
    console.log("Generating image for Writing Task 1...");
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ 
            parts: [{ 
              text: `Generate a simple, clear ${prompt}. The image should be professional and suitable for an IELTS Academic Writing Task 1. Include clear labels, legends, and values. Use a clean white background.` 
            }] 
          }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("Image generation failed:", await response.text());
      return null;
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    
    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        return part.inlineData.data;
      }
    }
  } catch (err) {
    console.error("Image generation error:", err);
  }
  return null;
}

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

    // Get API key
    const { data: secretData } = await supabaseClient
      .from('user_secrets')
      .select('encrypted_value')
      .eq('user_id', user.id)
      .eq('secret_name', 'GEMINI_API_KEY')
      .single();

    if (!secretData) {
      return new Response(JSON.stringify({ 
        error: 'Gemini API key not found. Please add your API key in Settings.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appEncryptionKey = Deno.env.get('app_encryption_key');
    if (!appEncryptionKey) throw new Error('Encryption key not configured');
    
    const geminiApiKey = await decryptApiKey(secretData.encrypted_value, appEncryptionKey);

    // Parse request
    const { module, questionType, difficulty, topicPreference, questionCount, timeMinutes } = await req.json();
    
    const topic = topicPreference || IELTS_TOPICS[Math.floor(Math.random() * IELTS_TOPICS.length)];
    const testId = crypto.randomUUID();

    console.log(`Generating ${module} test: ${questionType}, ${difficulty}, topic: ${topic}`);

    if (module === 'reading') {
      // Generate Reading Test
      const readingPrompt = `Generate an IELTS Academic Reading test with the following specifications:

Topic: ${topic}
Question Type: ${questionType}
Difficulty: ${difficulty} (${difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8'})
Number of Questions: ${questionCount}

Requirements:
1. Create a reading passage of 600-800 words that is:
   - Academic in tone and style
   - Well-structured with clear paragraphs (label them A, B, C, etc.)
   - Contains specific information that can be tested
   - Appropriate for the ${difficulty} difficulty level

2. Create ${questionCount} ${questionType.replace(/_/g, ' ')} questions based on the passage

3. For each question, provide:
   - The question text
   - The correct answer
   - A brief explanation of why this is correct

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "The instruction text for this question type",
  "questions": [
    {
      "question_number": 1,
      "question_text": "The question text",
      "correct_answer": "The correct answer",
      "explanation": "Why this is the correct answer",
      "options": ["A", "B", "C", "D"] // Only for MULTIPLE_CHOICE type
    }
  ]
}`;

      const result = await callGemini(geminiApiKey, readingPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate reading test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result);
        return new Response(JSON.stringify({ error: 'Failed to parse generated content' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        testId,
        topic,
        passage: {
          id: crypto.randomUUID(),
          title: parsed.passage.title,
          content: parsed.passage.content,
          passage_number: 1,
        },
        questionGroups: [{
          id: crypto.randomUUID(),
          instruction: parsed.instruction || `Questions 1-${questionCount}`,
          question_type: questionType,
          start_question: 1,
          end_question: questionCount,
          options: questionType === 'MULTIPLE_CHOICE' ? { options: ['A', 'B', 'C', 'D'] } : undefined,
          questions: parsed.questions.map((q: any, i: number) => ({
            id: crypto.randomUUID(),
            question_number: q.question_number || i + 1,
            question_text: q.question_text,
            question_type: questionType,
            correct_answer: q.correct_answer,
            explanation: q.explanation,
            options: q.options,
          })),
        }],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'listening') {
      // Generate Listening Test
      const scenario = LISTENING_SCENARIOS[Math.floor(Math.random() * LISTENING_SCENARIOS.length)];
      
      const listeningPrompt = `Generate an IELTS Listening test section with the following specifications:

Topic: ${topic}
Scenario: ${scenario.description}
Question Type: ${questionType}
Difficulty: ${difficulty} (${difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8'})
Number of Questions: ${questionCount}

Requirements:
1. Create a dialogue script between Speaker1 and Speaker2 that is:
   - 200-300 words total
   - Natural and conversational
   - Contains specific details that can be tested (names, numbers, dates, locations)
   - Format each line as: "Speaker1: dialogue text" or "Speaker2: dialogue text"

2. Create ${questionCount} ${questionType.replace(/_/g, ' ')} questions based on the dialogue

3. For each question, provide:
   - The question text
   - The correct answer (exactly as spoken in the dialogue)
   - A brief explanation

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Hello...\\nSpeaker2: Hi...",
  "instruction": "The instruction text for this question type",
  "questions": [
    {
      "question_number": 1,
      "question_text": "The question text",
      "correct_answer": "The correct answer",
      "explanation": "Why this is the correct answer",
      "options": ["A", "B", "C", "D"] // Only for MULTIPLE_CHOICE types
    }
  ]
}`;

      const result = await callGemini(geminiApiKey, listeningPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate listening test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result);
        return new Response(JSON.stringify({ error: 'Failed to parse generated content' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate audio
      const audio = await generateAudio(geminiApiKey, parsed.dialogue);

      return new Response(JSON.stringify({
        testId,
        topic,
        transcript: parsed.dialogue,
        audioBase64: audio?.audioBase64 || null,
        audioFormat: audio ? 'pcm' : null,
        sampleRate: audio?.sampleRate || null,
        questionGroups: [{
          id: crypto.randomUUID(),
          instruction: parsed.instruction || `Questions 1-${questionCount}`,
          question_type: questionType,
          start_question: 1,
          end_question: questionCount,
          options: questionType.includes('MULTIPLE_CHOICE') || questionType === 'MATCHING_CORRECT_LETTER' 
            ? { options: parsed.questions[0]?.options || ['A', 'B', 'C', 'D'] } 
            : undefined,
          questions: parsed.questions.map((q: any, i: number) => ({
            id: crypto.randomUUID(),
            question_number: q.question_number || i + 1,
            question_text: q.question_text,
            question_type: questionType,
            correct_answer: q.correct_answer,
            explanation: q.explanation,
            options: q.options,
          })),
        }],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'writing') {
      // Generate Writing Test
      const isTask1 = questionType === 'TASK_1';
      
      const writingPrompt = isTask1 
        ? `Generate an IELTS Academic Writing Task 1 with the following specifications:

Topic: ${topic}
Difficulty: ${difficulty} (${difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8'})

Requirements:
1. Create a Task 1 prompt that asks the test taker to describe visual data
2. The visual should be one of: bar chart, line graph, pie chart, table, process diagram, or map
3. Provide a detailed description of what the visual shows (this will be used to generate an image)
4. Include specific data points, labels, and values

Return ONLY valid JSON in this exact format:
{
  "task_type": "task1",
  "instruction": "The task instruction starting with 'The chart/graph/diagram below shows...'",
  "visual_description": "A detailed description of the chart for image generation (e.g., 'A bar chart showing the percentage of people using different types of transportation in London from 2000 to 2020. The x-axis shows years (2000, 2010, 2020), the y-axis shows percentage (0-100). Categories include: Cars (blue bars: 60%, 55%, 45%), Public Transport (green bars: 25%, 30%, 40%), Cycling (orange bars: 5%, 8%, 12%), Walking (purple bars: 10%, 7%, 3%).')",
  "visual_type": "bar chart" // or "line graph", "pie chart", "table", "process diagram", "map"
}`
        : `Generate an IELTS Academic Writing Task 2 with the following specifications:

Topic: ${topic}
Difficulty: ${difficulty} (${difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8'})

Requirements:
1. Create a Task 2 essay question that is:
   - Thought-provoking and academic
   - Clear and specific
   - Appropriate for the difficulty level

2. The question should be one of these types:
   - Opinion essay (To what extent do you agree or disagree?)
   - Discussion essay (Discuss both views and give your opinion)
   - Problem-solution essay (What problems does this cause? What solutions can you suggest?)
   - Advantages/disadvantages essay

Return ONLY valid JSON in this exact format:
{
  "task_type": "task2",
  "instruction": "The full essay question including any background context and the specific question"
}`;

      const result = await callGemini(geminiApiKey, writingPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate writing test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result);
        return new Response(JSON.stringify({ error: 'Failed to parse generated content' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate image for Task 1
      let imageBase64 = null;
      if (isTask1 && parsed.visual_description) {
        imageBase64 = await generateImage(geminiApiKey, `${parsed.visual_type}: ${parsed.visual_description}`);
      }

      return new Response(JSON.stringify({
        testId,
        topic,
        writingTask: {
          id: crypto.randomUUID(),
          task_type: isTask1 ? 'task1' : 'task2',
          instruction: parsed.instruction,
          image_base64: imageBase64,
          image_description: parsed.visual_description,
          word_limit_min: isTask1 ? 150 : 250,
          word_limit_max: isTask1 ? 200 : 350,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'speaking') {
      // Generate Speaking Test
      const partType = questionType; // FULL_TEST, PART_1, PART_2, or PART_3
      
      const speakingPrompt = `Generate an IELTS Speaking test with the following specifications:

Topic: ${topic}
Parts to generate: ${partType === 'FULL_TEST' ? 'All 3 parts' : partType.replace('_', ' ')}
Difficulty: ${difficulty} (${difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8'})

Requirements:
${partType === 'FULL_TEST' || partType === 'PART_1' ? `
Part 1 (Introduction and Interview - 4-5 minutes):
- Generate 4 conversational questions about familiar topics
- Questions should be simple and direct
` : ''}
${partType === 'FULL_TEST' || partType === 'PART_2' ? `
Part 2 (Individual Long Turn - 3-4 minutes):
- Generate a cue card topic with the main question
- Include 3-4 bullet points for what to include
- The candidate gets 1 minute to prepare and speaks for 1-2 minutes
` : ''}
${partType === 'FULL_TEST' || partType === 'PART_3' ? `
Part 3 (Discussion - 4-5 minutes):
- Generate 4 abstract/discussion questions related to Part 2 topic
- Questions should require more analysis and opinion
` : ''}

Return ONLY valid JSON in this exact format:
{
  "parts": [
    ${partType === 'FULL_TEST' || partType === 'PART_1' ? `{
      "part_number": 1,
      "instruction": "Let's talk about your hometown/studies/work...",
      "questions": [
        {"question_number": 1, "question_text": "Question 1?", "sample_answer": "A good sample answer..."},
        {"question_number": 2, "question_text": "Question 2?", "sample_answer": "A good sample answer..."},
        {"question_number": 3, "question_text": "Question 3?", "sample_answer": "A good sample answer..."},
        {"question_number": 4, "question_text": "Question 4?", "sample_answer": "A good sample answer..."}
      ],
      "time_limit_seconds": 240
    }${partType === 'FULL_TEST' ? ',' : ''}` : ''}
    ${partType === 'FULL_TEST' || partType === 'PART_2' ? `{
      "part_number": 2,
      "instruction": "Now I'm going to give you a topic and I'd like you to talk about it for 1-2 minutes.",
      "cue_card_topic": "Describe a [topic]",
      "cue_card_content": "You should say:\\n• bullet point 1\\n• bullet point 2\\n• bullet point 3\\n• And explain why...",
      "questions": [
        {"question_number": 5, "question_text": "The full cue card topic and points", "sample_answer": "A good 2-minute response..."}
      ],
      "preparation_time_seconds": 60,
      "speaking_time_seconds": 120
    }${partType === 'FULL_TEST' ? ',' : ''}` : ''}
    ${partType === 'FULL_TEST' || partType === 'PART_3' ? `{
      "part_number": 3,
      "instruction": "Let's discuss some more general questions about [topic]...",
      "questions": [
        {"question_number": ${partType === 'PART_3' ? '1' : '6'}, "question_text": "Discussion question 1?", "sample_answer": "A thoughtful answer..."},
        {"question_number": ${partType === 'PART_3' ? '2' : '7'}, "question_text": "Discussion question 2?", "sample_answer": "A thoughtful answer..."},
        {"question_number": ${partType === 'PART_3' ? '3' : '8'}, "question_text": "Discussion question 3?", "sample_answer": "A thoughtful answer..."},
        {"question_number": ${partType === 'PART_3' ? '4' : '9'}, "question_text": "Discussion question 4?", "sample_answer": "A thoughtful answer..."}
      ],
      "time_limit_seconds": 300
    }` : ''}
  ]
}`;

      const result = await callGemini(geminiApiKey, speakingPrompt);
      if (!result) {
        return new Response(JSON.stringify({ error: 'Failed to generate speaking test' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let parsed;
      try {
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse Gemini response:", e, result);
        return new Response(JSON.stringify({ error: 'Failed to parse generated content' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate TTS for each question (limit to avoid rate limits)
      const speakingParts = [];
      for (const part of parsed.parts) {
        const questionsWithAudio = [];
        for (const q of part.questions.slice(0, 5)) { // Limit to 5 questions per part
          // Generate TTS for the question
          const audioResult = await generateSingleVoiceTTS(geminiApiKey, q.question_text);
          questionsWithAudio.push({
            id: crypto.randomUUID(),
            question_number: q.question_number,
            question_text: q.question_text,
            sample_answer: q.sample_answer,
            audio_base64: audioResult?.audioBase64 || null,
          });
        }
        
        speakingParts.push({
          id: crypto.randomUUID(),
          part_number: part.part_number,
          instruction: part.instruction,
          questions: questionsWithAudio,
          cue_card_topic: part.cue_card_topic,
          cue_card_content: part.cue_card_content,
          preparation_time_seconds: part.preparation_time_seconds,
          speaking_time_seconds: part.speaking_time_seconds,
          time_limit_seconds: part.time_limit_seconds,
        });
      }

      return new Response(JSON.stringify({
        testId,
        topic,
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
