import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate ephemeral token for Gemini Live API
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const { partType, difficulty, topic } = await req.json();

    // Build system instruction for IELTS examiner with British accent personality
    const examinerInstruction = buildExaminerInstruction(partType, difficulty, topic);

    // For Gemini Live API, we need to get the session config
    // The client will connect directly to the WebSocket with this config
    const sessionConfig = {
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck' // British-sounding, neutral professional voice
            }
          }
        }
      },
      systemInstruction: {
        parts: [{ text: examinerInstruction }]
      }
    };

    // Return the session configuration for client-side WebSocket connection
    return new Response(JSON.stringify({
      success: true,
      sessionConfig,
      apiKey: LOVABLE_API_KEY, // Client needs this to connect to Gemini
      wsEndpoint: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('AI Speaking Session Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create speaking session';
    return new Response(JSON.stringify({ 
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildExaminerInstruction(partType: string, difficulty: string, topic?: string): string {
  const difficultyGuide = {
    easy: 'Use clear, simple language. Speak at a moderate pace. Ask straightforward questions.',
    medium: 'Use natural conversational language. Ask moderately complex questions with some follow-ups.',
    hard: 'Use sophisticated vocabulary. Ask complex, abstract questions requiring detailed responses.',
    expert: 'Use advanced academic vocabulary. Ask highly abstract, philosophical questions.'
  };

  const baseInstruction = `You are an official IELTS Speaking Examiner with a neutral British accent. Your role is to conduct a professional IELTS Speaking test following the official 2025 format precisely.

PERSONALITY & VOICE:
- Speak with a clear, professional British accent
- Be warm but formal, like a real IELTS examiner
- Use natural intonation and appropriate pauses
- Never rush the candidate

EXAMINATION RULES:
- Always start with a formal greeting and identity check
- Follow the official IELTS timing strictly
- If the candidate speaks too long, politely interrupt with "Thank you" and move to the next question
- If the candidate pauses too long (>5 seconds), gently prompt them
- Use natural transition phrases between questions
- At the end of each part, clearly signal the transition

DIFFICULTY LEVEL: ${difficulty?.toUpperCase() || 'MEDIUM'}
${difficultyGuide[difficulty as keyof typeof difficultyGuide] || difficultyGuide.medium}

${topic ? `TOPIC FOCUS: The test should relate to the topic of "${topic}" where appropriate.` : ''}

PART 1 STRUCTURE (4-5 minutes):
- Start: "Good morning/afternoon. My name is [examiner]. Could you tell me your full name, please?"
- Follow with: "And what should I call you?"
- Then: "Can I see your identification, please?" (wait 2 seconds, then) "Thank you."
- Ask 3-4 questions on first topic (familiar topics: home, work, studies, hobbies)
- Ask 3-4 questions on second topic

PART 2 STRUCTURE (3-4 minutes):
- Say: "Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes."
- After prep time: "All right? Remember, you have one to two minutes for this, so don't worry if I stop you. I'll tell you when the time is up. Can you start speaking now, please?"
- At 2 minutes: "Thank you." Then ask 1-2 rounding-off questions

PART 3 STRUCTURE (4-5 minutes):
- Transition: "We've been talking about [Part 2 topic], and I'd like to discuss some related questions."
- Ask 4-6 abstract, discussion-type questions related to the Part 2 topic
- Use follow-up prompts: "Why do you think that is?" "Can you give an example?"

BARGE-IN SUPPORT:
- If the candidate interrupts, pause and listen
- Acknowledge their input naturally before continuing`;

  return baseInstruction;
}
