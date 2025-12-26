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

// Generate map image using Lovable AI Gateway
async function generateMapImage(mapDescription: string, mapLabels: Array<{id: string; text: string}>): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  try {
    console.log('Generating map image with Lovable AI...');
    
    // Build a detailed prompt for map generation
    const labelsList = mapLabels.map(l => `${l.id}: ${l.text}`).join(', ');
    const imagePrompt = `Create a simple, clean map diagram for an IELTS listening test. 
The map shows: ${mapDescription}
Include these labeled locations: ${labelsList}
Style: Top-down view, simple line art with clear labels (A, B, C, etc.), easy to read, educational diagram style.
Make it look like a professional test map with clear pathways and building outlines.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          { role: 'user', content: imagePrompt }
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Map image generation failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (imageData && imageData.startsWith('data:image/')) {
      console.log('Map image generated successfully');
      return imageData;
    }
    
    console.error('No image data in response');
    return null;
  } catch (err) {
    console.error('Map image generation error:', err);
    return null;
  }
}

// Generate flowchart image using Lovable AI Gateway
async function generateFlowchartImage(
  title: string, 
  steps: Array<{label?: string; text?: string; isBlank?: boolean; questionNumber?: number}>
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  try {
    console.log('Generating flowchart image with Lovable AI...');
    
    // Build step descriptions for the prompt
    const stepDescriptions = steps.map((step, idx) => {
      const stepText = step.label || step.text || '';
      if (step.isBlank) {
        return `Step ${idx + 1}: [BLANK ${step.questionNumber || idx + 1}] (empty box for answer)`;
      }
      return `Step ${idx + 1}: ${stepText}`;
    }).join('\n');
    
    const imagePrompt = `Create a clean, professional flowchart diagram for an IELTS listening test.
Title: ${title || 'Process Flowchart'}
The flowchart has the following steps connected by arrows flowing downward:
${stepDescriptions}

Style requirements:
- Vertical flow from top to bottom
- Each step in a rounded rectangle box
- Clear arrows connecting steps
- Blank steps should show an empty box with a question number
- Clean, educational diagram style
- Easy to read text
- Professional appearance suitable for a test`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          { role: 'user', content: imagePrompt }
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Flowchart image generation failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    const imageData = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (imageData && imageData.startsWith('data:image/')) {
      console.log('Flowchart image generated successfully');
      return imageData;
    }
    
    console.error('No image data in flowchart response');
    return null;
  } catch (err) {
    console.error('Flowchart image generation error:', err);
    return null;
  }
}

// Upload base64 image to Supabase storage and return public URL
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
interface ListeningConfig {
  transcriptPreset?: string;
  durationSeconds?: number;
  wordCount?: number;
  useWordCountMode?: boolean;
}

// Reading question type prompts - generate structured data matching DB schema
function getReadingPrompt(
  questionType: string, 
  topic: string, 
  difficulty: string, 
  questionCount: number,
  readingConfig?: ReadingConfig
): string {
  const difficultyDesc = difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8';
  
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
      return basePrompt + `2. Create ${questionCount} multiple choice questions where test-takers must select TWO correct answers.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Choose TWO letters, A-E.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Which TWO statements are true according to the passage?",
      "options": ["A First option", "B Second option", "C Third option", "D Fourth option", "E Fifth option"],
      "correct_answer": "A,C",
      "explanation": "Why A and C are correct",
      "max_answers": 2
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

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], [C], [D], [E]"
  },
  "instruction": "Which paragraph contains the following information? Write the correct letter, A-E.",
  "options": ["A", "B", "C", "D", "E"],
  "questions": [
    {
      "question_number": 1,
      "question_text": "A description of...",
      "correct_answer": "C",
      "explanation": "This information is found in paragraph C where..."
    }
  ]
}`;

    case 'FILL_IN_BLANK':
    case 'SENTENCE_COMPLETION':
    case 'SHORT_ANSWER':
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank/sentence completion questions.
   - Answers should be words or short phrases from the passage (1-3 words)

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the sentences below. Choose NO MORE THAN THREE WORDS from the passage for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "According to the passage, the main cause of _____ is pollution.",
      "correct_answer": "climate change",
      "explanation": "Found in paragraph A: 'the main cause of climate change is pollution'"
    }
  ]
}`;

    case 'TABLE_COMPLETION':
      return basePrompt + `2. Create a table completion task with ${questionCount} blanks to fill.

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels like [A], [B], etc."
  },
  "instruction": "Complete the table below. Choose NO MORE THAN TWO WORDS from the passage for each answer.",
  "table_data": [
    [{"content": "Category", "is_header": true}, {"content": "Details", "is_header": true}],
    [{"content": "First item"}, {"content": "", "has_question": true, "question_number": 1}],
    [{"content": "Second item"}, {"content": "", "has_question": true, "question_number": 2}],
    [{"content": "Third item"}, {"content": "", "has_question": true, "question_number": 3}]
  ],
  "questions": [
    {"question_number": 1, "question_text": "Fill in blank 1", "correct_answer": "answer one", "explanation": "Found in paragraph B"},
    {"question_number": 2, "question_text": "Fill in blank 2", "correct_answer": "answer two", "explanation": "Found in paragraph C"},
    {"question_number": 3, "question_text": "Fill in blank 3", "correct_answer": "answer three", "explanation": "Found in paragraph D"}
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
   - The passage should describe locations or parts of a place/facility
   - Generate labels for different areas

Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text describing a location with labeled areas [A], [B], etc."
  },
  "instruction": "Label the map below. Choose the correct letter, A-H.",
  "map_description": "A floor plan of a library showing: reception (A), study rooms (B), computer lab (C), café (D), meeting rooms (E), quiet zone (F), children's section (G), magazine area (H)",
  "map_labels": [
    {"id": "A", "text": "Reception"},
    {"id": "B", "text": "Study Rooms"},
    {"id": "C", "text": "Computer Lab"},
    {"id": "D", "text": "Café"},
    {"id": "E", "text": "Meeting Rooms"},
    {"id": "F", "text": "Quiet Zone"},
    {"id": "G", "text": "Children's Section"},
    {"id": "H", "text": "Magazine Area"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Where can visitors access the internet?", "correct_answer": "C", "explanation": "The computer lab provides internet access"},
    {"question_number": 2, "question_text": "Where should visitors go first when entering?", "correct_answer": "A", "explanation": "Reception is the first point of contact"}
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
function getListeningPrompt(
  questionType: string, 
  topic: string, 
  difficulty: string, 
  questionCount: number, 
  scenario: any,
  listeningConfig?: ListeningConfig
): string {
  const difficultyDesc = difficulty === 'easy' ? 'Band 5-6' : difficulty === 'medium' ? 'Band 6-7' : 'Band 7-8';
  
  // Determine transcript specifications based on config
  // Default: ~225 words (~90 seconds of audio)
  let targetWordCount = listeningConfig?.wordCount || 225;
  let targetDurationSeconds = listeningConfig?.durationSeconds || 90;
  
  // If using word count mode, estimate duration (150 words/minute)
  if (listeningConfig?.useWordCountMode && listeningConfig.wordCount) {
    targetWordCount = listeningConfig.wordCount;
    targetDurationSeconds = Math.round((targetWordCount / 150) * 60);
  } else if (!listeningConfig?.useWordCountMode && listeningConfig?.durationSeconds) {
    // If using duration mode, estimate word count
    targetDurationSeconds = listeningConfig.durationSeconds;
    targetWordCount = Math.round((targetDurationSeconds / 60) * 150);
  }
  
  // Clamp to safe limits (max ~1200 words / 480 seconds = 8 minutes at 85% of Gemini capacity)
  targetWordCount = Math.min(1200, Math.max(100, targetWordCount));
  targetDurationSeconds = Math.min(480, Math.max(30, targetDurationSeconds));
  
  const wordRange = `${targetWordCount - 30}-${targetWordCount + 30}`;
  
  const basePrompt = `Generate an IELTS Listening test section with the following specifications:

Topic: ${topic}
Scenario: ${scenario.description}
Difficulty: ${difficulty} (${difficultyDesc})

Requirements:
1. Create a dialogue script between Speaker1 and Speaker2 that is:
   - ${wordRange} words total (approximately ${targetDurationSeconds} seconds when spoken)
   - Natural and conversational
   - Contains specific details (names, numbers, dates, locations)
   - Format each line as: "Speaker1: dialogue text" or "Speaker2: dialogue text"

`;

  switch (questionType) {
    case 'FILL_IN_BLANK':
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions.
   - Answers should be exact words/phrases spoken in the dialogue (1-2 words)

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Hello, welcome to the museum...\\nSpeaker2: Thank you...",
  "instruction": "Complete the notes below. Write NO MORE THAN TWO WORDS for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "The museum was founded in _____.",
      "correct_answer": "1985",
      "explanation": "Speaker1 says 'founded in 1985'"
    }
  ]
}`;

    case 'TABLE_COMPLETION':
      return basePrompt + `2. Create a table completion task with ${questionCount} blanks.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Let me explain the schedule...\\nSpeaker2: Yes, please...",
  "instruction": "Complete the table below. Write NO MORE THAN TWO WORDS for each answer.",
  "table_data": [
    [{"content": "Time", "is_header": true}, {"content": "Activity", "is_header": true}],
    [{"content": "9:00 AM"}, {"content": "", "has_question": true, "question_number": 1}],
    [{"content": "11:00 AM"}, {"content": "", "has_question": true, "question_number": 2}]
  ],
  "questions": [
    {"question_number": 1, "question_text": "Activity at 9 AM", "correct_answer": "registration", "explanation": "Speaker mentions registration at 9"},
    {"question_number": 2, "question_text": "Activity at 11 AM", "correct_answer": "workshop", "explanation": "Workshop mentioned for 11 AM"}
  ]
}`;

    case 'MULTIPLE_CHOICE_SINGLE':
      return basePrompt + `2. Create ${questionCount} multiple choice questions (single answer).

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: The conference will focus on...\\nSpeaker2: That sounds interesting...",
  "instruction": "Choose the correct letter, A, B, or C.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "What is the main topic of the conference?",
      "options": ["A Environmental issues", "B Technology trends", "C Economic policies"],
      "correct_answer": "B",
      "explanation": "Speaker1 explicitly mentions technology trends"
    }
  ]
}`;

    case 'MULTIPLE_CHOICE_MULTIPLE':
      return basePrompt + `2. Create ${questionCount} multiple choice questions where listeners select TWO correct answers.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: There are several benefits...\\nSpeaker2: Can you list them?...",
  "instruction": "Choose TWO letters, A-E.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Which TWO benefits are mentioned?",
      "options": ["A Cost savings", "B Time efficiency", "C Better quality", "D More flexibility", "E Improved safety"],
      "correct_answer": "A,C",
      "explanation": "Cost savings and better quality are mentioned",
      "max_answers": 2
    }
  ]
}`;

    case 'MATCHING_CORRECT_LETTER':
      return basePrompt + `2. Create ${questionCount} matching questions where listeners match items to categories.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Let me describe each option...\\nSpeaker2: Yes, I need to choose...",
  "instruction": "What does the speaker say about each item? Choose the correct letter, A-C.",
  "options": ["A Recommended", "B Not recommended", "C Depends on situation"],
  "questions": [
    {
      "question_number": 1,
      "question_text": "Online courses",
      "correct_answer": "A",
      "explanation": "Speaker recommends online courses"
    }
  ]
}`;

    case 'FLOWCHART_COMPLETION':
      return basePrompt + `2. Create a flowchart completion task about a process with ${questionCount} blanks.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Let me explain the process...\\nSpeaker2: Please go ahead...",
  "instruction": "Complete the flow chart below. Write NO MORE THAN TWO WORDS for each answer.",
  "flowchart_title": "Process of Application",
  "flowchart_steps": [
    {"id": "step1", "label": "Submit form online", "isBlank": false},
    {"id": "step2", "label": "", "isBlank": true, "questionNumber": 1},
    {"id": "step3", "label": "Attend interview", "isBlank": false}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Step 2", "correct_answer": "pay fee", "explanation": "Speaker mentions paying the fee after submission"}
  ]
}`;

    case 'DRAG_AND_DROP_OPTIONS':
      // Ensure we always have more options than questions (at least 2 extra distractor options)
      const dragOptionCount = Math.max(questionCount + 2, 5);
      return basePrompt + `2. Create ${questionCount} drag-and-drop questions with ${dragOptionCount} draggable options.

CRITICAL RULES:
- You MUST provide EXACTLY ${dragOptionCount} drag_options (more options than questions - some are distractors).
- Each question MUST include a drop zone indicated by 2+ consecutive underscores (e.g., "____").
- Use this exact pattern in question_text so the UI can render a drop box:
  "<Item> ____ ." or "Drop answer ____ here." (must contain "____").
- The draggable options MUST be provided via drag_options.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Each department has different responsibilities...\\nSpeaker2: I see...",
  "instruction": "Match each person to their responsibility. Drag the correct option to each box.",
  "drag_options": ["Managing budget", "Training staff", "Customer service", "Quality control", "Marketing", "Scheduling", "Research"],
  "questions": [
    {"question_number": 1, "question_text": "John ____ .", "correct_answer": "Managing budget", "explanation": "John is responsible for budget"},
    {"question_number": 2, "question_text": "Sarah ____ .", "correct_answer": "Training staff", "explanation": "Sarah handles training"}
  ]
}`;

    case 'MAP_LABELING':
      return basePrompt + `2. Create a map labeling task with ${questionCount} locations to identify.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Let me show you around the campus...\\nSpeaker2: Great, where is everything?...",
  "instruction": "Label the map below. Write the correct letter, A-F.",
  "map_description": "A campus map showing: Library (A), Science Building (B), Sports Center (C), Cafeteria (D), Administration (E), Parking (F)",
  "map_labels": [
    {"id": "A", "text": "Library"},
    {"id": "B", "text": "Science Building"},
    {"id": "C", "text": "Sports Center"},
    {"id": "D", "text": "Cafeteria"},
    {"id": "E", "text": "Administration"},
    {"id": "F", "text": "Parking"}
  ],
  "questions": [
    {"question_number": 1, "question_text": "Where can students borrow books?", "correct_answer": "A", "explanation": "The library is mentioned for books"},
    {"question_number": 2, "question_text": "Where are sports facilities?", "correct_answer": "C", "explanation": "Sports Center has the facilities"}
  ]
}`;

    case 'NOTE_COMPLETION':
      return basePrompt + `2. Create a note completion task with ${questionCount} blanks organized in categories.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: Let me explain the key points...\\nSpeaker2: Please go ahead...",
  "instruction": "Complete the notes below. Write NO MORE THAN TWO WORDS for each answer.",
  "note_sections": [
    {
      "title": "Main Topic",
      "items": [
        {"text_before": "The primary focus is on", "question_number": 1, "text_after": ""},
        {"text_before": "This relates to", "question_number": 2, "text_after": "in modern contexts"}
      ]
    },
    {
      "title": "Key Details",
      "items": [
        {"text_before": "The main benefit includes", "question_number": 3, "text_after": ""}
      ]
    }
  ],
  "questions": [
    {"question_number": 1, "question_text": "Note 1", "correct_answer": "research methods", "explanation": "Speaker mentions research methods"},
    {"question_number": 2, "question_text": "Note 2", "correct_answer": "practical applications", "explanation": "Related to practical use"},
    {"question_number": 3, "question_text": "Note 3", "correct_answer": "cost savings", "explanation": "Benefits discussed"}
  ]
}`;

    default:
      return basePrompt + `2. Create ${questionCount} fill-in-the-blank questions.
   - Each question MUST include a blank indicated by 2+ underscores (e.g., "_____") where the answer goes.

Return ONLY valid JSON in this exact format:
{
  "dialogue": "Speaker1: dialogue...\\nSpeaker2: response...",
  "instruction": "Complete the notes below. Write NO MORE THAN TWO WORDS for each answer.",
  "questions": [
    {
      "question_number": 1,
      "question_text": "The event takes place in _____.",
      "correct_answer": "the garden",
      "explanation": "Speaker mentions the garden location"
    }
  ]
}`;
  }
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
    const { module, questionType, difficulty, topicPreference, questionCount, timeMinutes, readingConfig, listeningConfig } = await req.json();
    
    const topic = topicPreference || IELTS_TOPICS[Math.floor(Math.random() * IELTS_TOPICS.length)];
    const testId = crypto.randomUUID();

    console.log(`Generating ${module} test: ${questionType}, ${difficulty}, topic: ${topic}, questions: ${questionCount}`);
    if (readingConfig) {
      console.log(`Reading config: paragraphs=${readingConfig.paragraphCount}, words=${readingConfig.wordCount}, preset=${readingConfig.passagePreset}`);
    }
    if (listeningConfig) {
      console.log(`Listening config: duration=${listeningConfig.durationSeconds}s, words=${listeningConfig.wordCount}, preset=${listeningConfig.transcriptPreset}`);
    }

    if (module === 'reading') {
      // Generate Reading Test with specific question type prompt
      const readingPrompt = getReadingPrompt(questionType, topic, difficulty, questionCount, readingConfig);

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

      // Build question group with proper structure
      const groupId = crypto.randomUUID();
      const passageId = crypto.randomUUID();

      // Build options based on question type
      let groupOptions: any = undefined;
      if (questionType === 'MATCHING_HEADINGS' && parsed.headings) {
        groupOptions = { headings: parsed.headings };
      } else if (questionType === 'MATCHING_INFORMATION' && parsed.options) {
        groupOptions = { options: parsed.options };
      } else if (questionType === 'MATCHING_SENTENCE_ENDINGS') {
        groupOptions = { 
          sentence_beginnings: parsed.sentence_beginnings,
          sentence_endings: parsed.sentence_endings 
        };
      } else if (questionType === 'SUMMARY_WORD_BANK' || questionType === 'SUMMARY_COMPLETION') {
        groupOptions = { 
          word_bank: parsed.word_bank,
          summary_text: parsed.summary_text 
        };
      } else if (questionType === 'FLOWCHART_COMPLETION') {
        // Generate flowchart image for reading tests
        let flowchartImageUrl: string | undefined;
        if (parsed.flowchart_steps) {
          console.log('Generating flowchart image for reading FLOWCHART_COMPLETION...');
          const flowchartImageData = await generateFlowchartImage(
            parsed.flowchart_title || 'Process Flowchart',
            parsed.flowchart_steps
          );
          if (flowchartImageData) {
            const uploadedUrl = await uploadGeneratedImage(supabaseClient, flowchartImageData, testId, 'ai-practice-flowcharts');
            if (uploadedUrl) {
              flowchartImageUrl = uploadedUrl;
            }
          }
        }
        groupOptions = { 
          flowchart_title: parsed.flowchart_title,
          flowchart_steps: parsed.flowchart_steps,
          imageUrl: flowchartImageUrl,
        };
      } else if (questionType === 'TABLE_COMPLETION') {
        groupOptions = { table_data: parsed.table_data };
      } else if (questionType === 'NOTE_COMPLETION') {
        groupOptions = { note_sections: parsed.note_sections };
      } else if (questionType === 'MAP_LABELING') {
        // Generate map image for reading tests
        let mapImageUrl: string | undefined;
        if (parsed.map_description && parsed.map_labels) {
          console.log('Generating map image for reading MAP_LABELING...');
          const mapImageData = await generateMapImage(parsed.map_description, parsed.map_labels);
          if (mapImageData) {
            const uploadedUrl = await uploadGeneratedImage(supabaseClient, mapImageData, testId, 'ai-practice-maps');
            if (uploadedUrl) {
              mapImageUrl = uploadedUrl;
            }
          }
        }
        groupOptions = { 
          map_description: parsed.map_description,
          map_labels: parsed.map_labels,
          imageUrl: mapImageUrl,
        };
      } else if (questionType.includes('MULTIPLE_CHOICE') && parsed.questions?.[0]?.options) {
        groupOptions = { options: parsed.questions[0].options };
      }

      const questions = (parsed.questions || []).map((q: any, i: number) => ({
        id: crypto.randomUUID(),
        question_number: q.question_number || i + 1,
        question_text: q.question_text,
        question_type: questionType,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        options: q.options || null,
        heading: q.heading || null,
        table_data: parsed.table_data || null,
        max_answers: q.max_answers || undefined,
      }));

      return new Response(JSON.stringify({
        testId,
        topic,
        passage: {
          id: passageId,
          title: parsed.passage.title,
          content: parsed.passage.content,
          passage_number: 1,
        },
        questionGroups: [{
          id: groupId,
          instruction: parsed.instruction || `Questions 1-${questionCount}`,
          question_type: questionType,
          start_question: 1,
          end_question: questions.length,
          options: groupOptions,
          questions: questions,
        }],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'listening') {
      // Generate Listening Test
      const scenario = LISTENING_SCENARIOS[Math.floor(Math.random() * LISTENING_SCENARIOS.length)];
      const listeningPrompt = getListeningPrompt(questionType, topic, difficulty, questionCount, scenario, listeningConfig);

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

      // Build group options based on question type
      let groupOptions: any = undefined;
      if (questionType === 'MATCHING_CORRECT_LETTER' && parsed.options) {
        groupOptions = { options: parsed.options, option_format: 'A' };
      } else if (questionType === 'TABLE_COMPLETION' && parsed.table_data) {
        groupOptions = { table_data: parsed.table_data };
      } else if (questionType === 'FLOWCHART_COMPLETION' && parsed.flowchart_steps) {
        // Map flowchart_steps to the format expected by FlowchartCompletion component
        // Component expects: steps[].text, steps[].hasBlank, steps[].blankNumber
        const steps = parsed.flowchart_steps.map((step: any) => ({
          text: step.label || step.text || '',
          hasBlank: step.isBlank || step.hasBlank || false,
          blankNumber: step.questionNumber || step.blankNumber,
          alignment: step.alignment || 'center',
        }));
        // Component also needs options array for drag-and-drop
        // Extract correct answers as the option pool + add distractors
        const correctAnswers = parsed.questions?.map((q: any) => q.correct_answer) || [];
        const distractors = ['Other option', 'Alternative choice']; // fallback distractors
        const flowchartOptions = [...new Set([...correctAnswers, ...distractors])];
        
        // Generate flowchart image using Lovable AI
        let flowchartImageUrl: string | undefined;
        console.log('Generating flowchart image for FLOWCHART_COMPLETION...');
        const flowchartImageData = await generateFlowchartImage(
          parsed.flowchart_title || 'Process Flowchart',
          parsed.flowchart_steps
        );
        if (flowchartImageData) {
          const uploadedUrl = await uploadGeneratedImage(supabaseClient, flowchartImageData, testId, 'ai-practice-flowcharts');
          if (uploadedUrl) {
            flowchartImageUrl = uploadedUrl;
          }
        }
        
        groupOptions = {
          title: parsed.flowchart_title,
          steps,
          options: flowchartOptions,
          option_format: 'A',
          imageUrl: flowchartImageUrl,
        };
      } else if (questionType === 'DRAG_AND_DROP_OPTIONS') {
        // UI expects group.options.options (array of strings) + option_format
        groupOptions = { options: parsed.drag_options || [], option_format: 'A' };
      } else if (questionType === 'MAP_LABELING') {
        // Generate map image using Lovable AI
        let mapImageUrl: string | undefined;
        if (parsed.map_description && parsed.map_labels) {
          console.log('Generating map image for MAP_LABELING...');
          const mapImageData = await generateMapImage(parsed.map_description, parsed.map_labels);
          if (mapImageData) {
            const uploadedUrl = await uploadGeneratedImage(supabaseClient, mapImageData, testId, 'ai-practice-maps');
            if (uploadedUrl) {
              mapImageUrl = uploadedUrl;
            }
          }
        }
        
        groupOptions = {
          map_description: parsed.map_description,
          map_labels: parsed.map_labels,
          imageUrl: mapImageUrl,
          // Add drop zones based on questions for visual placement
          dropZones: (parsed.questions || []).map((q: any, idx: number) => ({
            id: `zone-${q.question_number || idx + 1}`,
            questionNumber: q.question_number || idx + 1,
            x: 20 + (idx % 3) * 30, // Distribute across map
            y: 20 + Math.floor(idx / 3) * 25,
            width: 60,
            height: 30,
          })),
          options: parsed.map_labels?.map((l: any) => l.id) || [],
        };
      } else if (questionType === 'NOTE_COMPLETION' && parsed.note_sections) {
        // Map note_sections to noteCategories format expected by NoteStyleFillInBlank
        const noteCategories = parsed.note_sections.map((section: any) => ({
          label: section.title,
          items: (section.items || []).map((item: any) => ({
            text: item.text_before || '',
            hasBlank: true,
            suffixText: item.text_after || '',
            questionNumber: item.question_number,
          })),
        }));
        groupOptions = { 
          noteCategories, 
          display_mode: 'note_style' 
        };
      } else if (questionType.includes('MULTIPLE_CHOICE') && parsed.questions?.[0]?.options) {
        groupOptions = { options: parsed.questions[0].options };
      }

      const groupId = crypto.randomUUID();

      // For DRAG_AND_DROP_OPTIONS, store correct answers as option LABELS (A/B/C...) to match UI answer values
      const dragOptionLabels = (groupOptions?.options || []).map((_: unknown, idx: number) => String.fromCharCode(65 + idx));
      const dragTextToLabel = new Map<string, string>();
      if (questionType === 'DRAG_AND_DROP_OPTIONS') {
        (groupOptions?.options || []).forEach((t: string, idx: number) => {
          dragTextToLabel.set(String(t).trim().toLowerCase(), dragOptionLabels[idx]);
        });
      }

      const questions = (parsed.questions || []).map((q: any, i: number) => {
        let correct = q.correct_answer;
        if (questionType === 'DRAG_AND_DROP_OPTIONS') {
          const asString = String(q.correct_answer ?? '').trim();
          const upper = asString.toUpperCase();
          // If Gemini already returned a label, keep it; otherwise map option text -> label
          if (upper.length === 1 && dragOptionLabels.includes(upper)) {
            correct = upper;
          } else {
            correct = dragTextToLabel.get(asString.toLowerCase()) || asString;
          }
        }

        return {
          id: crypto.randomUUID(),
          question_number: q.question_number || i + 1,
          question_text: q.question_text,
          question_type: questionType,
          correct_answer: correct,
          explanation: q.explanation,
          options: q.options || null,
          heading: q.heading || null,
          max_answers: q.max_answers || undefined,
        };
      });

      return new Response(JSON.stringify({
        testId,
        topic,
        transcript: parsed.dialogue,
        audioBase64: audio?.audioBase64 || null,
        audioFormat: audio ? 'pcm' : null,
        sampleRate: audio?.sampleRate || null,
        questionGroups: [{
          id: groupId,
          instruction: parsed.instruction || `Questions 1-${questionCount}`,
          question_type: questionType,
          start_question: 1,
          end_question: questions.length,
          options: groupOptions,
          questions: questions,
        }],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'writing') {
      // Writing test generation (unchanged)
      const isTask1 = questionType === 'TASK_1';
      
      const writingPrompt = isTask1 
        ? `Generate an IELTS Academic Writing Task 1:\nTopic: ${topic}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON:\n{\n  "task_type": "task1",\n  "instruction": "The chart/graph below shows...",\n  "visual_description": "Description for image generation",\n  "visual_type": "bar chart"\n}`
        : `Generate an IELTS Academic Writing Task 2:\nTopic: ${topic}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON:\n{\n  "task_type": "task2",\n  "instruction": "The essay question..."\n}`;

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

      return new Response(JSON.stringify({
        testId,
        topic,
        writingTask: {
          id: crypto.randomUUID(),
          task_type: isTask1 ? 'task1' : 'task2',
          instruction: parsed.instruction,
          image_description: parsed.visual_description,
          word_limit_min: isTask1 ? 150 : 250,
          word_limit_max: isTask1 ? 200 : 350,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (module === 'speaking') {
      // Speaking test generation (simplified)
      const speakingPrompt = `Generate IELTS Speaking test questions:\nTopic: ${topic}\nPart: ${questionType}\nDifficulty: ${difficulty}\n\nReturn ONLY valid JSON with parts array containing questions.`;

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
        return new Response(JSON.stringify({ error: 'Failed to parse generated content' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        testId,
        topic,
        speakingParts: parsed.parts?.map((p: any) => ({
          id: crypto.randomUUID(),
          part_number: p.part_number,
          instruction: p.instruction,
          questions: (p.questions || []).map((q: any) => ({
            id: crypto.randomUUID(),
            question_number: q.question_number,
            question_text: q.question_text,
            sample_answer: q.sample_answer,
          })),
          cue_card_topic: p.cue_card_topic,
          cue_card_content: p.cue_card_content,
          preparation_time_seconds: p.preparation_time_seconds,
          speaking_time_seconds: p.speaking_time_seconds,
          time_limit_seconds: p.time_limit_seconds,
        })) || [],
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
