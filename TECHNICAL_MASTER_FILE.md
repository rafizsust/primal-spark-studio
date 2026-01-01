# IELTS Prep Platform - Technical Master File
## Complete Low-Level System Specification
### Version: 1.0 | Date: 2026-01-01

---

# TABLE OF CONTENTS

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Database Schema (Supabase)](#3-database-schema-supabase)
4. [Edge Functions & API Logic](#4-edge-functions--api-logic)
5. [Authentication & Security](#5-authentication--security)
6. [IELTS Logic Engine](#6-ielts-logic-engine)
7. [Frontend Architecture](#7-frontend-architecture)
8. [External Integrations](#8-external-integrations)
9. [File Storage Architecture](#9-file-storage-architecture)
10. [Known Technical Debt](#10-known-technical-debt)

---

# 1. SYSTEM OVERVIEW

## 1.1 Purpose
An AI-powered IELTS preparation platform supporting all four modules:
- **Reading** - Passage-based comprehension tests
- **Listening** - Audio-based comprehension tests  
- **Writing** - Essay/report tasks with AI evaluation
- **Speaking** - Voice recording with AI evaluation

## 1.2 Core Features
- Admin-created official IELTS tests (Cambridge style)
- AI-generated practice tests (via Gemini API)
- Real-time scoring with IELTS band calculation
- AI-powered explanations for wrong answers
- Flashcard system for vocabulary
- Analytics dashboard for performance tracking
- Test state preservation across sessions

---

# 2. TECHNOLOGY STACK

## 2.1 Frontend
```
Framework:        React 18.3.1
Build Tool:       Vite
Language:         TypeScript 5.4.5
Styling:          Tailwind CSS + shadcn/ui components
State Management: TanStack Query (React Query) 5.83.0
Routing:          React Router DOM 6.30.1
Forms:            React Hook Form + Zod validation
Charts:           Recharts 2.15.4
Animations:       Tailwind CSS Animate
Toast:            Sonner 1.7.4
```

## 2.2 Backend
```
Database:         Supabase (PostgreSQL)
Auth:             Supabase Auth
Storage:          Supabase Storage (5 buckets)
Edge Functions:   Deno (20 functions)
AI Gateway:       Google Gemini API (user-provided keys)
```

## 2.3 Key Dependencies
```json
{
  "@supabase/supabase-js": "^2.86.2",
  "@tanstack/react-query": "^5.83.0",
  "lucide-react": "^0.462.0",
  "date-fns": "^3.6.0",
  "class-variance-authority": "^0.7.1"
}
```

---

# 3. DATABASE SCHEMA (SUPABASE)

## 3.1 User & Auth Tables

### `profiles`
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | - | Primary key, references auth.users |
| email | text | Yes | - | User email |
| full_name | text | Yes | - | Display name |
| avatar_url | text | Yes | - | Profile image URL |
| created_at | timestamptz | No | now() | Account creation |
| updated_at | timestamptz | No | now() | Last update |

**RLS Policies:**
- Users can INSERT/UPDATE/SELECT their own profile only
- DELETE is disabled

### `admin_users`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - (FK to profiles) |
| created_at | timestamptz | No | now() |

**RLS Policies:**
- Only admins can SELECT (via `is_admin()` function)
- INSERT/UPDATE/DELETE disabled

### `subscriptions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| plan_name | text | No | - |
| price | numeric | No | - |
| status | enum | No | 'pending' |
| start_date | timestamptz | No | now() |
| end_date | timestamptz | No | - |

**Status Enum:** `active | cancelled | expired | pending`

### `promotions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| name | text | No | - |
| description | text | Yes | - |
| is_active | boolean | No | true |
| start_date | timestamptz | No | - |
| end_date | timestamptz | No | - |

---

## 3.2 Reading Module Tables

### `reading_tests`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| title | text | No | - |
| book_name | text | No | - |
| test_number | integer | No | - |
| test_type | text | No | 'academic' |
| time_limit | integer | No | 60 |
| total_questions | integer | No | 40 |
| is_published | boolean | No | true |
| created_at | timestamptz | No | now() |
| updated_at | timestamptz | No | now() |

### `reading_passages`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| test_id | uuid | No | - (FK) |
| passage_number | integer | No | - |
| title | text | No | - |
| content | text | No | - |
| show_labels | boolean | No | true |
| created_at | timestamptz | No | now() |

### `reading_paragraphs`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| passage_id | uuid | No | - (FK) |
| label | text | No | - |
| content | text | No | - |
| is_heading | boolean | No | false |
| order_index | integer | No | - |

### `reading_question_groups`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| passage_id | uuid | No | - (FK) |
| question_type | text | No | - |
| instruction | text | Yes | - |
| start_question | integer | No | - |
| end_question | integer | No | - |
| options | jsonb | Yes | - |
| display_as_paragraph | boolean | Yes | false |
| show_bullets | boolean | Yes | false |
| show_headings | boolean | Yes | false |
| use_dropdown | boolean | Yes | false |

**Question Types:**
- `TRUE_FALSE_NOT_GIVEN`
- `YES_NO_NOT_GIVEN`
- `MULTIPLE_CHOICE`
- `MULTIPLE_CHOICE_SINGLE`
- `MULTIPLE_CHOICE_MULTIPLE`
- `MATCHING_HEADINGS`
- `MATCHING_INFORMATION`
- `MATCHING_FEATURES`
- `MATCHING_SENTENCE_ENDINGS`
- `FILL_IN_BLANK`
- `SENTENCE_COMPLETION`
- `SUMMARY_COMPLETION`
- `SUMMARY_WORD_BANK`
- `NOTE_COMPLETION`
- `TABLE_COMPLETION`
- `FLOWCHART_COMPLETION`
- `MAP_LABELING`
- `SHORT_ANSWER`

### `reading_questions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| passage_id | uuid | No | - (FK) |
| question_group_id | uuid | Yes | - |
| question_number | integer | No | - |
| question_text | text | No | - |
| question_type | text | No | - |
| correct_answer | text | No | - |
| options | jsonb | Yes | - |
| option_format | text | Yes | 'A' |
| heading | text | Yes | - |
| instruction | text | Yes | - |
| table_data | jsonb | Yes | - |

### `reading_test_submissions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| test_id | uuid | No | - (FK) |
| user_id | uuid | No | - |
| answers | jsonb | No | '{}' |
| score | integer | No | 0 |
| total_questions | integer | No | 40 |
| band_score | numeric | Yes | - |
| completed_at | timestamptz | No | now() |

---

## 3.3 Listening Module Tables

### `listening_tests`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| title | text | No | - |
| book_name | text | No | - |
| test_number | integer | No | - |
| test_type | text | No | 'academic' |
| time_limit | integer | No | 30 |
| total_questions | integer | No | 40 |
| is_published | boolean | No | false |
| audio_url | text | Yes | - |
| audio_url_part1 | text | Yes | - |
| audio_url_part2 | text | Yes | - |
| audio_url_part3 | text | Yes | - |
| audio_url_part4 | text | Yes | - |
| transcript_part1 | text | Yes | - |
| transcript_part2 | text | Yes | - |
| transcript_part3 | text | Yes | - |
| transcript_part4 | text | Yes | - |

### `listening_question_groups`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| test_id | uuid | No | - (FK) |
| question_type | text | No | - |
| instruction | text | Yes | - |
| start_question | integer | No | - |
| end_question | integer | No | - |
| options | jsonb | Yes | - |
| group_heading | text | Yes | - |
| group_heading_alignment | text | Yes | 'center' |
| start_timestamp_seconds | numeric | Yes | - |

### `listening_questions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| group_id | uuid | No | - (FK) |
| question_number | integer | No | - |
| question_text | text | No | - |
| correct_answer | text | No | - |
| options | jsonb | Yes | - |
| option_format | text | Yes | 'A' |
| heading | text | Yes | - |
| is_given | boolean | No | false |
| table_data | jsonb | Yes | - |

### `listening_test_submissions`
Same structure as reading_test_submissions

---

## 3.4 Writing Module Tables

### `writing_tests`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| title | text | No | - |
| description | text | Yes | - |
| time_limit | integer | No | 60 |
| is_published | boolean | No | false |

### `writing_tasks`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| writing_test_id | uuid | Yes | - (FK) |
| task_type | enum | No | - |
| instruction | text | No | - |
| text_content | text | Yes | - |
| image_url | text | Yes | - |
| image_width | integer | Yes | - |
| image_height | integer | Yes | - |
| word_limit_min | integer | No | 150 |
| word_limit_max | integer | Yes | - |

**Task Type Enum:** `task1 | task2`

### `writing_submissions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| task_id | uuid | No | - (FK) |
| user_id | uuid | No | - |
| submission_text | text | No | - |
| word_count | integer | No | - |
| overall_band | numeric | Yes | - |
| evaluation_report | jsonb | Yes | - |
| submitted_at | timestamptz | Yes | now() |

---

## 3.5 Speaking Module Tables

### `speaking_tests`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| name | text | No | - |
| description | text | Yes | - |
| test_type | text | No | 'academic' |
| is_published | boolean | No | false |

### `speaking_question_groups`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| test_id | uuid | No | - (FK) |
| part_number | integer | No | - |
| instruction | text | Yes | - |
| cue_card_topic | text | Yes | - |
| cue_card_content | text | Yes | - |
| time_limit_seconds | integer | Yes | - |
| preparation_time_seconds | integer | Yes | - |
| speaking_time_seconds | integer | Yes | - |
| total_part_time_limit_seconds | integer | Yes | - |
| min_required_questions | integer | Yes | - |
| options | jsonb | Yes | - |

### `speaking_questions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| group_id | uuid | No | - (FK) |
| question_number | integer | No | - |
| question_text | text | No | - |
| order_index | integer | No | - |
| is_required | boolean | No | true |

### `speaking_submissions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| test_id | uuid | No | - (FK) |
| user_id | uuid | No | - |
| audio_url_part1 | text | Yes | - |
| audio_url_part2 | text | Yes | - |
| audio_url_part3 | text | Yes | - |
| transcript_part1 | text | Yes | - |
| transcript_part2 | text | Yes | - |
| transcript_part3 | text | Yes | - |
| overall_band | numeric | Yes | - |
| evaluation_report | jsonb | Yes | - |
| submitted_at | timestamptz | Yes | now() |

---

## 3.6 AI Practice Tables

### `ai_practice_tests`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| module | text | No | - |
| topic | text | No | - |
| question_type | text | No | - |
| difficulty | text | No | - |
| time_minutes | integer | No | - |
| total_questions | integer | No | - |
| payload | jsonb | No | '{}' |
| audio_url | text | Yes | - |
| audio_format | text | Yes | - |
| sample_rate | integer | Yes | - |
| generated_at | timestamptz | No | now() |

### `ai_practice_results`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| test_id | uuid | No | - (FK) |
| user_id | uuid | No | - |
| module | text | No | - |
| answers | jsonb | No | '{}' |
| question_results | jsonb | No | '[]' |
| score | integer | No | 0 |
| total_questions | integer | No | 0 |
| band_score | numeric | Yes | - |
| time_spent_seconds | integer | No | 0 |
| completed_at | timestamptz | No | now() |

### `ai_practice_topic_completions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| module | text | No | - |
| topic | text | No | - |
| completed_count | integer | No | 0 |
| updated_at | timestamptz | No | now() |

**Unique Constraint:** (user_id, module, topic)

---

## 3.7 Supporting Tables

### `flashcard_decks`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| name | text | No | - |
| description | text | Yes | - |

### `flashcard_cards`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| deck_id | uuid | No | - (FK) |
| user_id | uuid | No | - |
| word | text | No | - |
| meaning | text | No | - |
| example | text | Yes | - |
| translation | text | Yes | - |
| status | text | No | 'learning' |
| review_count | integer | No | 0 |
| correct_count | integer | No | 0 |
| next_review_at | timestamptz | Yes | - |

### `user_secrets`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| secret_name | text | No | - |
| encrypted_value | text | No | - |

**Stores:** User's Gemini API key (encrypted with AES-GCM)

### `gemini_daily_usage`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| usage_date | date | No | CURRENT_DATE |
| tokens_used | integer | No | 0 |
| requests_count | integer | No | 0 |

### `user_analytics`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| module_type | text | No | - |
| tests_analyzed | integer | No | 0 |
| analysis_data | jsonb | No | '{}' |
| generated_at | timestamptz | No | now() |

### `test_results`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | - |
| test_type | text | No | - |
| answers | jsonb | Yes | - |
| score | numeric | Yes | - |
| band_score | numeric | Yes | - |
| feedback | jsonb | Yes | - |
| completed_at | timestamptz | No | now() |

---

## 3.8 Database Functions

### `is_admin(check_user_id uuid) → boolean`
```sql
SELECT EXISTS (
  SELECT 1 FROM public.admin_users WHERE user_id = check_user_id
);
```
Used in RLS policies to grant admin access.

### `has_active_subscription(p_user_id uuid) → boolean`
```sql
SELECT EXISTS (
  SELECT 1 FROM public.subscriptions
  WHERE user_id = p_user_id
    AND status = 'active'
    AND end_date > now()
);
```

### `is_promotion_active() → boolean`
```sql
SELECT EXISTS (
  SELECT 1 FROM public.promotions
  WHERE is_active = true
    AND start_date <= now()
    AND end_date >= now()
);
```

### `can_user_submit(p_user_id uuid) → boolean`
```sql
SELECT 
  p_user_id IS NOT NULL 
  AND (
    public.has_active_subscription(p_user_id) 
    OR public.is_promotion_active()
  );
```

### `increment_topic_completion(p_user_id, p_module, p_topic)`
Upserts completion count for AI practice topics.

### `handle_new_user() → trigger`
Creates profile entry when new user signs up:
```sql
INSERT INTO public.profiles (id, email, full_name)
VALUES (
  NEW.id,
  NEW.email,
  COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
);
```

---

# 4. EDGE FUNCTIONS & API LOGIC

## 4.1 Function Overview

| Function | JWT Required | Purpose |
|----------|--------------|---------|
| `generate-ai-practice` | Yes | Generate AI practice tests |
| `evaluate-writing-submission` | Yes | AI evaluation of writing |
| `evaluate-speaking-submission` | Yes | AI evaluation of speaking |
| `evaluate-ai-practice-writing` | Yes | Evaluate AI practice writing |
| `evaluate-ai-speaking-part` | Yes | Evaluate individual speaking parts |
| `evaluate-ai-speaking` | Yes | Full speaking evaluation |
| `explain-answer` | No | Explain wrong answers |
| `explain-answer-followup` | Yes | Follow-up explanations |
| `analyze-performance` | Yes | Generate analytics |
| `translate-word` | No | Word translation |
| `generate-listening-audio` | Yes | TTS audio generation |
| `generate-gemini-tts` | Yes | Gemini TTS |
| `transcribe-listening-audio` | No | Audio transcription |
| `analyze-listening-audio` | Yes | Audio analysis |
| `import-full-listening-test` | No | Bulk import tests |
| `import-listening-audio` | No | Import audio files |
| `admin-listening-action` | No | Admin actions |
| `set-user-gemini-api-key` | Yes | Store encrypted API key |
| `gemini-quota` | Yes | Check quota usage |
| `ai-speaking-session` | Yes | Live speaking session |

---

## 4.2 generate-ai-practice (Core Function)

### Location
`supabase/functions/generate-ai-practice/index.ts`

### Model Selection & Fallback Logic
```typescript
const GEMINI_MODELS = [
  'gemini-2.5-flash',      // Primary: best balance for IELTS generation
  'gemini-2.5-pro',        // High quality fallback 
  'gemini-2.0-flash',      // Fast reliable fallback
  'gemini-2.0-flash-lite', // Emergency fallback
];
```

### Gemini API Call Configuration
```typescript
generationConfig: {
  temperature: 0.7,
  maxOutputTokens: 8192,
}
```

### Pre-flight API Validation
Before generating, validates API key using lightweight `/models` endpoint:
```typescript
async function preflightApiCheck(apiKey: string, skipPreflight: boolean = false): Promise<{ ok: boolean; error?: string }>
```

### Rate Limiting & Retry Logic
```typescript
async function waitWithBackoff(attempt: number, baseDelayMs: number = 1000): Promise<void> {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 30000);
  await new Promise(resolve => setTimeout(resolve, delay));
}
```

### JSON Extraction from Gemini Response
```typescript
function extractJsonFromResponse(text: string): string {
  // 1. Try markdown code blocks: ```json ... ```
  // 2. Try raw JSON object: { ... }
  // 3. Try JSON array: [ ... ]
  // 4. Return trimmed text as fallback
}
```

### Reading Question Type Prompts

Each question type has a specific prompt template. Example for TRUE/FALSE/NOT GIVEN:

```typescript
case 'TRUE_FALSE_NOT_GIVEN':
  return basePrompt + `2. Create ${questionCount} True/False/Not Given questions...
  
Return ONLY valid JSON in this exact format:
{
  "passage": {
    "title": "The title of the passage",
    "content": "The full passage text with paragraph labels..."
  },
  "instruction": "Do the following statements agree with the information...",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Statement about the passage",
      "correct_answer": "TRUE",
      "explanation": "Why this is the correct answer"
    }
  ]
}`;
```

### Listening TTS Configuration
```typescript
interface SpeakerVoiceConfig {
  gender: 'male' | 'female';
  accent: string;
  voiceName: string;
}

// TTS Model: gemini-2.5-flash-preview-tts
// Sample Rate: 24000 Hz
// Multi-speaker config for dialogues
```

### Writing Task 1 Visual Generation
For charts/graphs, the function generates structured JSON data:
```typescript
{
  "chartType": "bar_chart" | "line_graph" | "pie_chart" | "table" | "process" | "map" | "mixed",
  "chartData": {
    "labels": [...],
    "datasets": [...]
  }
}
```

---

## 4.3 evaluate-writing-submission

### Location
`supabase/functions/evaluate-writing-submission/index.ts`

### Model Fallback Order
```typescript
const GEMINI_MODELS_FALLBACK_ORDER = [
  'gemini-2.5-pro',
  'gemini-pro-latest',
  'gemini-3-pro-preview',
  'gemini-exp-1206',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.5-flash-lite',
  // ... additional fallbacks
];
```

### System Prompt (Writing Evaluation)
```
You are an expert IELTS writing examiner and a supportive English teacher. 
Please provide a detailed evaluation of your student's IELTS Task submission.

IMPORTANT: Write your feedback as a teacher speaking directly to the student.
Use "you" and "your" when addressing them.

Evaluation Criteria:
1. Task Achievement/Response (Band 0-9)
2. Coherence and Cohesion (Band 0-9)
3. Lexical Resource (Band 0-9)
4. Grammatical Range and Accuracy (Band 0-9)
5. Overall Suggestions for Improvement
```

### Vision Integration for Task 1
If Task 1 has an image, it's fetched and sent as base64:
```typescript
if (task.task_type === 'task1' && task.image_url) {
  const imageResponse = await fetch(task.image_url);
  const imageBuffer = await imageResponse.arrayBuffer();
  imageBase64 = btoa(binary);
  
  parts.push({
    inline_data: {
      mime_type: mimeType,
      data: imageBase64
    }
  });
}
```

### Response Schema
```typescript
{
  "overall_band": number,
  "evaluation_report": {
    "task_achievement_response": {
      "band": number,
      "strengths": string,
      "weaknesses": string,
      "suggestions_for_improvement": string
    },
    "coherence_and_cohesion": { ... },
    "lexical_resource": { ... },
    "grammatical_range_and_accuracy": { ... },
    "overall_suggestions": string
  }
}
```

---

## 4.4 evaluate-speaking-submission

### Location
`supabase/functions/evaluate-speaking-submission/index.ts`

### Audio Processing
Audio is sent as base64 inline data:
```typescript
contents.push({
  parts: [{
    inlineData: {
      mimeType: 'audio/webm',
      data: audioBase64
    }
  }]
});
```

### Evaluation Criteria
```
1. Fluency and Coherence (Band 0-9)
2. Lexical Resource (Band 0-9)
3. Grammatical Range and Accuracy (Band 0-9)
4. Pronunciation (Band 0-9)
5. Part-by-Part Analysis (Part 1, 2, 3)
6. Overall Recommendations
```

### Transcript Generation
The model also generates transcripts for each audio segment:
```typescript
"transcripts": {
  "part1-q[question_id]": "Transcript text...",
  "part2-q[question_id]": "Transcript text...",
  "part3-q[question_id]": "Transcript text..."
}
```

---

## 4.5 explain-answer

### Location
`supabase/functions/explain-answer/index.ts`

### System Prompt
```typescript
const systemPrompt = `You are an expert ${testTypeLabel} tutor. Your task is to explain 
${isCorrect ? 'why a student\'s answer was correct' : 'why a student\'s answer was incorrect'} 
in a helpful and educational way.

Guidelines:
- Be concise but thorough (4-6 sentences)
- First explain why the student's answer is wrong, then explain why the correct answer is right
- Reference the specific part of the transcript/passage that contains the answer
- Provide helpful tips for similar questions
- Be encouraging and supportive
`;
```

### Special Handling: MCQ Multiple
```typescript
if (isMCQMultiple) {
  const correctOnes = userAnswers.filter(a => correctAnswersArr.includes(a));
  const wrongOnes = userAnswers.filter(a => !correctAnswersArr.includes(a));
  const missedOnes = correctAnswersArr.filter(a => !userAnswers.includes(a));
  
  // Explains each selection individually
}
```

---

# 5. AUTHENTICATION & SECURITY

## 5.1 Authentication Flow

### Location
`src/hooks/useAuth.tsx`

### Implementation
```typescript
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // 2. THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);
};
```

### Sign Up with Redirect
```typescript
const signUp = async (email, password, fullName) => {
  const redirectUrl = `${window.location.origin}/`;
  
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectUrl,
      data: { full_name: fullName }
    }
  });
};
```

### Dev Bypass Mode
```typescript
const BYPASS_AUTH = false; // Set to true for development
```

---

## 5.2 API Key Encryption

### Encryption Algorithm
- **Method:** AES-GCM
- **Key Size:** 256-bit (32 bytes)
- **IV Size:** 12 bytes
- **Storage:** Base64 encoded (IV + ciphertext)

### Encryption (Client → Edge Function)
```typescript
// In set-user-gemini-api-key/index.ts
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  cryptoKey,
  encoder.encode(apiKeyValue)
);

const combined = new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
const encryptedBase64 = btoa(String.fromCharCode(...combined));
```

### Decryption (Edge Function)
```typescript
async function decryptApiKey(encryptedValue: string, encryptionKey: string): Promise<string> {
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
```

### Environment Variable
The encryption key is stored as a Supabase secret: `app_encryption_key`

---

## 5.3 Row Level Security (RLS) Summary

### Pattern: User-Owned Data
```sql
-- SELECT
USING (auth.uid() = user_id)

-- INSERT
WITH CHECK (auth.uid() = user_id)

-- UPDATE
USING (auth.uid() = user_id)

-- DELETE
USING (auth.uid() = user_id)
```

### Pattern: Admin Access
```sql
-- Uses is_admin() function
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()))
```

### Pattern: Published Content (Public Read)
```sql
-- Anyone can view published content
USING (is_published = true)

-- Or with nested check
USING (EXISTS (
  SELECT 1 FROM reading_tests
  WHERE id = reading_passages.test_id
    AND is_published = true
))
```

---

# 6. IELTS LOGIC ENGINE

## 6.1 Answer Validation

### Location
`src/lib/ieltsAnswerValidation.ts`

### Main Function
```typescript
export function checkIeltsAnswer(userAnswer: string, correctAnswers: string): boolean {
  // Split correct answers by "/" for alternatives
  const rawAnswers = correctAnswers.split('/').map(a => a.trim());
  
  for (const rawCorrect of rawAnswers) {
    // Handle optional words: (the) hospital
    const { allVariations } = parseOptionalWords(rawCorrect);
    
    for (const correct of allVariations) {
      // 1. EXACT MATCH (case-insensitive)
      if (user === normalizedCorrect) return true;

      // 2. MATCH WITHOUT SPACES
      if (removeAllSpaces(user) === removeAllSpaces(normalizedCorrect)) return true;

      // 3. SPELLING VARIATIONS (British/American)
      if (matchWithSpellingVariations(user, normalizedCorrect)) return true;

      // 4. DATE FORMAT VARIATIONS
      if (matchDate(user, normalizedCorrect)) return true;

      // 5. TIME FORMAT VARIATIONS
      if (matchTime(user, normalizedCorrect)) return true;

      // 6. NUMBER FORMAT VARIATIONS
      if (matchNumber(user, normalizedCorrect)) return true;

      // 7. MEASUREMENT VARIATIONS
      if (matchMeasurement(user, normalizedCorrect)) return true;

      // 8. CURRENCY VARIATIONS
      if (matchCurrency(user, normalizedCorrect)) return true;

      // 9. PHONE NUMBER VARIATIONS
      if (matchPhoneNumber(user, normalizedCorrect)) return true;

      // 10. ALPHANUMERIC CODE VARIATIONS
      if (matchAlphanumericCode(user, normalizedCorrect)) return true;

      // 11. HYPHEN/SPACE VARIATIONS
      if (matchWithHyphens(user, normalizedCorrect)) return true;

      // 12. ARTICLE VARIATIONS ("the", "a", "an")
      if (withoutArticle(user) === withoutArticle(normalizedCorrect)) return true;
    }
  }
  return false;
}
```

### Spelling Variations (British/American)
```typescript
const SPELLING_VARIATIONS = {
  colour: ['colour', 'color'],
  centre: ['centre', 'center'],
  organisation: ['organisation', 'organization'],
  travelling: ['travelling', 'traveling'],
  grey: ['grey', 'gray'],
  // ... 50+ variations
};
```

### Number Word Mapping
```typescript
const NUMBER_WORDS = {
  '0': ['zero', 'o', 'oh', '0', 'nil', 'nought'],
  '1': ['one', '1', 'a'],
  // ... up to 1000000
  '1000': ['thousand', 'one thousand', 'a thousand', '1000', '1,000'],
};
```

### Ordinal Mapping
```typescript
const ORDINAL_MAP = {
  '1st': ['1', 'first', '1st'],
  '2nd': ['2', 'second', '2nd'],
  // ... up to 31st
};
```

### Date Matching
Accepts: `15 March`, `March 15`, `15th March`, `15/03`, `03/15`

### Time Matching
Accepts: `9:30`, `9.30`, `09:30`, `9.30am`, `9:30 AM`

### Measurement Matching
Accepts: `10kg`, `10 kg`, `10 kilograms`, `10 kilos`, `ten kilograms`

### Currency Matching
Accepts: `$50`, `50 dollars`, `50$`, `50 USD`

### Phone Number Matching
Handles: `double seven`, `triple two`, `O` for `0`

### Word Count Function
```typescript
export function countWords(text: string): { words: number; numbers: number } {
  // Hyphenated words = 1 word
  // Pure numbers = counted separately
  // Symbols ($ £ %) = not counted
}
```

---

## 6.2 Score Calculation

### Raw Score to Band Score Conversion

The IELTS band score is calculated from raw score out of 40:

```typescript
// Band score mapping (approximate)
function calculateBandScore(score: number, totalQuestions: number): number {
  const percentage = (score / totalQuestions) * 100;
  
  if (percentage >= 97.5) return 9.0;
  if (percentage >= 92.5) return 8.5;
  if (percentage >= 87.5) return 8.0;
  if (percentage >= 82.5) return 7.5;
  if (percentage >= 75.0) return 7.0;
  if (percentage >= 67.5) return 6.5;
  if (percentage >= 60.0) return 6.0;
  if (percentage >= 52.5) return 5.5;
  if (percentage >= 45.0) return 5.0;
  if (percentage >= 37.5) return 4.5;
  if (percentage >= 30.0) return 4.0;
  if (percentage >= 22.5) return 3.5;
  if (percentage >= 15.0) return 3.0;
  return 2.5;
}
```

---

## 6.3 Question Type Handling

### Multiple Choice (Single)
```typescript
// Compare by option ID only (A, B, C, D)
const normalizeOptionId = (s: string) => {
  const m = s.trim().match(/^([A-Z]|\d+|[ivxlcdm]+)\b/i);
  return (m?.[1] ?? s).toUpperCase();
};
```

### Multiple Choice (Multiple)
```typescript
export function checkMultipleChoiceMultiple(userAnswer: string, correctAnswer: string): boolean {
  const userOptions = new Set(userAnswer.split(',').map(opt => normalizeString(opt)));
  const correctOptions = new Set(correctAnswer.split(',').map(opt => normalizeString(opt)));
  
  if (userOptions.size !== correctOptions.size) return false;
  
  return [...userOptions].every(opt => correctOptions.has(opt)) &&
         [...correctOptions].every(opt => userOptions.has(opt));
}
```

---

# 7. FRONTEND ARCHITECTURE

## 7.1 Route Structure

```typescript
// Main Routes
/                          → Landing page (Index)
/auth                      → Authentication
/onboarding                → New user onboarding
/settings                  → User settings

// Reading Module
/reading/cambridge-ielts-a → Test list
/reading/test/:testId      → Take test
/reading/study/:testId     → Passage study mode

// Listening Module
/listening/cambridge-ielts-a → Test list
/listening/test/:testId      → Take test

// Writing Module
/writing/cambridge-ielts-a           → Test list
/writing/test/:testId                → Take test
/writing/evaluation/:testId/:submissionId → View evaluation

// Speaking Module
/speaking/cambridge-ielts-a           → Test list
/speaking/test/:testId                → Take test
/speaking/evaluation/:testId/:submissionId → View evaluation

// AI Practice
/ai-practice                → Topic selection
/ai-practice/history        → Practice history
/ai-practice/test/:testId   → Generic practice test
/ai-practice/reading/:testId
/ai-practice/listening/:testId
/ai-practice/writing/:testId
/ai-practice/speaking/:testId
/ai-practice/results/:testId

// Admin Routes (nested under /admin)
/admin                     → Dashboard
/admin/reading             → Manage reading tests
/admin/reading/new
/admin/reading/edit/:testId
/admin/listening           → Manage listening tests
/admin/writing             → Manage writing tests
/admin/speaking            → Manage speaking tests
/admin/promotions          → Manage promotions

// Utility Routes
/results/:submissionId     → View test results
/analytics                 → Performance analytics
/flashcards                → Vocabulary flashcards
/compare                   → Test comparison
/full-mock-test            → Complete mock test
```

---

## 7.2 Shared Hooks

### `useAuth`
```typescript
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email, password) => Promise<{ error }>;
  signUp: (email, password, fullName?) => Promise<{ error }>;
  signOut: () => Promise<void>;
}
```

### `useTestStatePreservation`
```typescript
interface TestState {
  testId: string;
  testType: 'reading' | 'listening' | 'writing' | 'speaking';
  answers?: Record<number, string>;
  submissionText?: string;
  currentQuestion?: number;
  timeLeft?: number;
  returnPath: string;
  autoSubmitOnReturn?: boolean;
}

// Saves state to localStorage before auth redirect
saveStateAndRedirect(state: TestState)

// Retrieves pending state (valid for 2 hours)
getPendingSubmission(): TestState | null

// Clears saved state
clearPendingSubmission()

// Restores state if matching testId/type
restoreStateIfNeeded(testId, testType): TestState | null
```

### `useAdminAccess`
Checks if current user has admin role via `is_admin()` RPC.

### `useAccessControl`
Combines subscription + promotion status check.

### `useTopicCompletions`
Tracks AI practice topic completion counts.

### `useUserTestScores`
Fetches user's test submission history.

### `useHighlightNotes`
Manages text highlighting/notes in passages.

### `usePullToRefresh`
Mobile pull-to-refresh functionality.

### `useSwipeGesture`
Touch swipe navigation for mobile.

### `useFullscreenTest`
Fullscreen mode management for tests.

### `useSpeechRecognition`
Browser speech recognition API wrapper.

### `useSpeechSynthesis`
Browser TTS API wrapper.

---

## 7.3 Shared Components

### UI Components (shadcn/ui)
```
/src/components/ui/
├── accordion.tsx
├── alert-dialog.tsx
├── avatar.tsx
├── badge.tsx
├── button.tsx
├── card.tsx
├── checkbox.tsx
├── dialog.tsx
├── dropdown-menu.tsx
├── form.tsx
├── input.tsx
├── label.tsx
├── popover.tsx
├── progress.tsx
├── radio-group.tsx
├── scroll-area.tsx
├── select.tsx
├── separator.tsx
├── sheet.tsx
├── skeleton.tsx
├── slider.tsx
├── switch.tsx
├── table.tsx
├── tabs.tsx
├── textarea.tsx
├── toast.tsx
├── tooltip.tsx
└── ... (40+ components)
```

### Common Components
```
/src/components/common/
├── AILoadingScreen.tsx       → Loading state for AI operations
├── ApiErrorDialog.tsx        → Error display modal
├── ExitTestConfirmDialog.tsx → Confirm exit during test
├── FlashcardQuickPractice.tsx
├── GeminiQuotaDisplay.tsx    → Shows API usage
├── IELTSVisualRenderer.tsx   → Renders charts/maps for Writing Task 1
├── NoteSidebar.tsx           → Note-taking sidebar
├── QuestionNumberBadge.tsx   → Q number indicator
├── QuestionTextWithTools.tsx → Question with highlight/translate tools
├── QuotaWarningDialog.tsx    → Quota exceeded warning
├── RestoreTestStateDialog.tsx
├── SafeSVG.tsx               → Safe SVG renderer
├── ScrollProgressIndicator.tsx
├── SubmitConfirmDialog.tsx
├── TestEntryOverlay.tsx
└── TestStartOverlay.tsx
```

### Reading Components
```
/src/components/reading/
├── ImportToFlashcardDialog.tsx
├── ReadingNavigation.tsx
├── ReadingPassage.tsx
├── ReadingQuestions.tsx
├── ReadingTimer.tsx
├── TestControls.tsx
├── TestOptionsMenu.tsx
├── WordSelectionToolbar.tsx
└── questions/
    ├── FillInBlank.tsx
    ├── FlowchartCompletion.tsx
    ├── MapLabeling.tsx
    ├── MatchingFeatures.tsx
    ├── MatchingHeadings.tsx
    ├── MatchingHeadingsDragDrop.tsx
    ├── MatchingInformation.tsx
    ├── MatchingSentenceEndingsDragDrop.tsx
    ├── MultipleChoice.tsx
    ├── MultipleChoiceMultiple.tsx
    ├── MultipleChoiceSingle.tsx
    ├── NoteCompletion.tsx
    ├── SentenceCompletion.tsx
    ├── ShortAnswer.tsx
    ├── SummaryCompletion.tsx
    ├── SummaryWordBank.tsx
    ├── TableCompletion.tsx
    ├── TableSelection.tsx
    └── TrueFalseNotGiven.tsx
```

### Listening Components
```
/src/components/listening/
├── AudioPlayOverlay.tsx
├── ListeningAudioPlayer.tsx
├── ListeningNavigation.tsx
├── ListeningQuestions.tsx
├── ListeningTestControls.tsx
├── ListeningTimer.tsx
├── MultiPartAudioPlayer.tsx
├── SeamlessAudioPlayer.tsx
├── TranscriptViewer.tsx
├── WebAudioScheduledPlayer.tsx
└── questions/
    ├── DragAndDropOptions.tsx
    ├── FillInBlank.tsx
    ├── FlowchartCompletion.tsx
    ├── ListeningTableCompletion.tsx
    ├── MapLabeling.tsx
    ├── Maps.tsx
    ├── MatchingCorrectLetter.tsx
    ├── MultipleChoiceMultipleQuestions.tsx
    └── NoteStyleFillInBlank.tsx
```

### Writing Components
```
/src/components/writing/
├── WritingInputPanel.tsx
├── WritingTaskDisplay.tsx
├── WritingTestControls.tsx
└── WritingTimer.tsx
```

### Speaking Components
```
/src/components/speaking/
├── AIExaminerAvatar.tsx
├── MicrophoneTest.tsx
├── SpeakingTestControls.tsx
└── SpeakingTimer.tsx
```

### Admin Components
```
/src/components/admin/
├── AudioTimestampEditor.tsx
├── FlowchartCompletionEditor.tsx
├── FullListeningTestPreview.tsx
├── FullTestPreview.tsx
├── ListeningAudioUploader.tsx
├── ListeningImageUploader.tsx
├── ListeningQuestionGroupEditor.tsx
├── ListeningQuestionGroupPreview.tsx
├── ListeningTableEditor.tsx
├── MapLabelingEditor.tsx
├── MultiSelectAnswerInput.tsx
├── MultipleAnswersInput.tsx
├── NoteStyleCategoryEditor.tsx
├── PassageEditor.tsx
├── QuestionGroupEditor.tsx
├── QuestionGroupPreview.tsx
├── ReadingTableEditor.tsx
├── RichTextEditor.tsx
├── SpeakingPart1Editor.tsx
├── SpeakingPart2Editor.tsx
├── SpeakingPart3Editor.tsx
└── WritingImageUploader.tsx
```

---

## 7.4 State Synchronization

### React Query Configuration
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

### Pattern: Fetching Data
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['reading-test', testId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('reading_tests')
      .select('*, reading_passages(*)')
      .eq('id', testId)
      .single();
    
    if (error) throw error;
    return data;
  }
});
```

### Pattern: Mutations
```typescript
const mutation = useMutation({
  mutationFn: async (submission) => {
    const { data, error } = await supabase
      .from('reading_test_submissions')
      .insert(submission)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  onSuccess: (data) => {
    queryClient.invalidateQueries(['submissions']);
    navigate(`/results/${data.id}`);
  }
});
```

### Local Storage Keys
```typescript
'pendingTestSubmission'  // Test state preservation
'ielts_highlights_{testId}'  // Text highlights
'ielts_notes_{testId}'  // User notes
```

---

# 8. EXTERNAL INTEGRATIONS

## 8.1 Google Gemini API

### Endpoint
```
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
```

### Models Used
| Model | Purpose |
|-------|---------|
| gemini-2.5-flash | Primary text generation |
| gemini-2.5-pro | Complex reasoning |
| gemini-2.0-flash | Fallback |
| gemini-2.5-flash-preview-tts | Audio generation |
| gemini-1.5-pro | Speaking evaluation (audio) |

### API Key Flow
1. User obtains key from Google AI Studio
2. User enters key in Settings page
3. Frontend calls `set-user-gemini-api-key` edge function
4. Key encrypted with AES-GCM
5. Stored in `user_secrets` table
6. Edge functions decrypt when needed

### Rate Limit Handling
```typescript
if (response.status === 429 || errorStatus === 'RESOURCE_EXHAUSTED') {
  isQuotaExceeded = true;
  lastGeminiError = 'QUOTA_EXCEEDED: Your Gemini API has reached its rate limit...';
  await waitWithBackoff(retryCount);
  // Try next model
}
```

---

## 8.2 Gemini TTS (Text-to-Speech)

### Endpoint
```
gemini-2.5-flash-preview-tts:generateContent
```

### Configuration
```typescript
{
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
}
```

### Available Voices
- Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr

### Output Format
- Base64 encoded audio
- Sample Rate: 24000 Hz
- Format: WAV/PCM

---

## 8.3 Google OAuth (Supabase Auth)

### Configuration
Set in Supabase Dashboard → Authentication → Providers → Google

### Redirect URL
```
https://{project_ref}.supabase.co/auth/v1/callback
```

---

## 8.4 Payment Gateway

**Status: Not Implemented**

The `subscriptions` and `promotions` tables exist but payment integration is not connected.

Current access control:
```typescript
function can_user_submit(p_user_id uuid) {
  return has_active_subscription(p_user_id) OR is_promotion_active();
}
```

**Potential Integration Points:**
- Stripe for payments
- Webhook to update `subscriptions` table

---

# 9. FILE STORAGE ARCHITECTURE

## 9.1 Storage Buckets

| Bucket | Public | Purpose |
|--------|--------|---------|
| `listening-audios` | Yes | Listening test audio files |
| `listening-images` | Yes | AI-generated charts/maps |
| `writing-images` | Yes | Writing Task 1 images |
| `speaking-audios` | Yes | Speaking test recordings |
| `listening-audio` | No | Private audio files |

## 9.2 File Naming Convention

```
Listening Audio: {book_name}/test_{test_number}/part_{part_number}.mp3
Writing Images: {test_id}/{task_type}_{timestamp}.png
Speaking Audio: {user_id}/{submission_id}/part_{part_number}.webm
AI Practice Images: ai-practice-images/{test_id}-{timestamp}.{ext}
```

## 9.3 Upload Pattern

```typescript
const { data, error } = await supabaseClient.storage
  .from('bucket-name')
  .upload(fileName, fileData, {
    contentType: mimeType,
    upsert: true,
  });

// Get public URL
const { data: urlData } = supabaseClient.storage
  .from('bucket-name')
  .getPublicUrl(fileName);
```

---

# 10. KNOWN TECHNICAL DEBT

## 10.1 Incomplete Features

### Flashcard Overlay
- **Issue:** Quick practice overlay may not dismiss properly
- **Location:** `FlashcardQuickPractice.tsx`

### Mobile Responsiveness
- **Issue:** Some admin editors not fully responsive
- **Location:** `/src/pages/admin/*`

### Full Mock Test
- **Issue:** Timer synchronization across modules
- **Location:** `FullMockTest.tsx`

## 10.2 Logic Loopholes

### Subscription Check Bypass
- **Issue:** `is_promotion_active()` allows access during active promotions
- **Risk:** Users could exploit promotion timing

### API Key Validation
- **Issue:** No validation of Gemini API key format before storage
- **Location:** `set-user-gemini-api-key`

### Answer Validation Edge Cases
- **Issue:** Complex compound answers may not match correctly
- **Example:** "north-west corner of the building" variations

## 10.3 Performance Issues

### Large Passage Rendering
- **Issue:** Long passages cause scrolling lag
- **Location:** `ReadingPassage.tsx`

### Audio Memory
- **Issue:** Multiple audio contexts not properly cleaned up
- **Location:** Listening test components

## 10.4 Missing Error Handling

### Edge Function Timeout
- No handling for long-running Gemini requests (>30s)

### Offline Mode
- No offline support for test-taking

### File Upload Size
- No client-side validation for large audio files

## 10.5 Security Considerations

### RLS Policy Gaps
- `explain-answer` function has `verify_jwt = false`
- `translate-word` function has `verify_jwt = false`

### API Key Exposure
- User's Gemini API key could theoretically be exposed if decryption key leaks

## 10.6 Code Quality

### Type Safety
- Some JSONB fields lack proper TypeScript typing
- `Json` type from Supabase is too broad

### Test Coverage
- Limited unit tests (only a few `*.test.tsx` files)
- No integration tests

### Documentation
- Missing JSDoc comments on utility functions
- No API documentation

---

# APPENDIX A: Environment Variables

## Supabase Secrets (Edge Functions)
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
SUPABASE_PUBLISHABLE_KEY
app_encryption_key
LOVABLE_API_KEY
```

## Client-Side (Vite)
```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

---

# APPENDIX B: Quick Reference Commands

## Local Development
```bash
# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Supabase
```bash
# Push edge functions
supabase functions deploy

# View edge function logs
supabase functions logs <function-name>

# Run migration
supabase db push
```

---

**Document Generated: 2026-01-01**
**Platform Version: 1.0.0**
**Maintainer: Lovable AI**
