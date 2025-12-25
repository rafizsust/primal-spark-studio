// Types for AI Practice feature
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export type PracticeModule = 'reading' | 'listening' | 'writing' | 'speaking';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

// Reading question types (12 types)
export type ReadingQuestionType = 
  | 'TRUE_FALSE_NOT_GIVEN'
  | 'YES_NO_NOT_GIVEN'
  | 'MATCHING_HEADINGS'
  | 'MATCHING_INFORMATION'
  | 'MATCHING_SENTENCE_ENDINGS'
  | 'MULTIPLE_CHOICE'
  | 'MULTIPLE_CHOICE_MULTIPLE'
  | 'FILL_IN_BLANK'
  | 'SENTENCE_COMPLETION'
  | 'TABLE_COMPLETION'
  | 'FLOWCHART_COMPLETION'
  | 'MAP_LABELING'
  | 'SUMMARY_COMPLETION'
  | 'NOTE_COMPLETION';

// Listening question types (9 types)
export type ListeningQuestionType =
  | 'FILL_IN_BLANK'
  | 'TABLE_COMPLETION'
  | 'MATCHING_CORRECT_LETTER'
  | 'MAP_LABELING'
  | 'DRAG_AND_DROP_OPTIONS'
  | 'FLOWCHART_COMPLETION'
  | 'MULTIPLE_CHOICE_SINGLE'
  | 'MULTIPLE_CHOICE_MULTIPLE';

// Writing task types
export type WritingTaskType = 'TASK_1' | 'TASK_2';

// Speaking part types
export type SpeakingPartType = 'FULL_TEST' | 'PART_1' | 'PART_2' | 'PART_3';

export type QuestionType = ReadingQuestionType | ListeningQuestionType | WritingTaskType | SpeakingPartType;

// Question counts based on question type
export const QUESTION_COUNTS: Record<string, number> = {
  // Reading types
  'TRUE_FALSE_NOT_GIVEN': 5,
  'YES_NO_NOT_GIVEN': 5,
  'MATCHING_HEADINGS': 5,
  'MATCHING_INFORMATION': 5,
  'MATCHING_SENTENCE_ENDINGS': 4,
  'MULTIPLE_CHOICE': 4,
  'MULTIPLE_CHOICE_MULTIPLE': 3,
  'FILL_IN_BLANK': 6,
  'SENTENCE_COMPLETION': 4,
  'TABLE_COMPLETION': 5,
  'FLOWCHART_COMPLETION': 4,
  'MAP_LABELING': 5,
  'SUMMARY_COMPLETION': 5,
  'NOTE_COMPLETION': 5,
  // Listening types
  'MULTIPLE_CHOICE_SINGLE': 4,
  'MATCHING_CORRECT_LETTER': 5,
  'DRAG_AND_DROP_OPTIONS': 5,
  // Writing - 1 task
  'TASK_1': 1,
  'TASK_2': 1,
  // Speaking - varies by part
  'FULL_TEST': 12,
  'PART_1': 4,
  'PART_2': 1,
  'PART_3': 4,
};

// Default times based on question count
export const getDefaultTime = (questionCount: number): number => {
  // Roughly 1.5 minutes per question for reading, 1 minute for listening
  return Math.max(5, Math.ceil(questionCount * 1.5));
};

// Practice configuration
export interface PracticeConfig {
  module: PracticeModule;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  topicPreference?: string;
  timeMinutes: number;
  audioSpeed?: number; // For listening only
}

// Generated question structure
export interface GeneratedQuestion {
  id: string;
  question_number: number;
  question_text: string;
  question_type: string;
  correct_answer: string;
  explanation: string;
  options?: string[]; // For MCQ
  heading?: string;
}

// Generated question group
export interface GeneratedQuestionGroup {
  id: string;
  instruction: string;
  question_type: string;
  start_question: number;
  end_question: number;
  options?: {
    options?: string[];
    option_format?: string;
  };
  questions: GeneratedQuestion[];
}

// Generated reading passage
export interface GeneratedPassage {
  id: string;
  title: string;
  content: string;
  passage_number: number;
}

// Writing task structure
export interface GeneratedWritingTask {
  id: string;
  task_type: 'task1' | 'task2';
  instruction: string;
  text_content?: string;
  image_base64?: string; // For Task 1 charts/graphs
  image_description?: string;
  word_limit_min: number;
  word_limit_max?: number;
}

// Speaking part structure
export interface GeneratedSpeakingPart {
  id: string;
  part_number: 1 | 2 | 3;
  instruction: string;
  questions: GeneratedSpeakingQuestion[];
  cue_card_topic?: string; // For Part 2
  cue_card_content?: string; // For Part 2 - bullet points
  preparation_time_seconds?: number; // For Part 2
  speaking_time_seconds?: number; // For Part 2
  time_limit_seconds?: number; // For Parts 1 & 3
}

export interface GeneratedSpeakingQuestion {
  id: string;
  question_number: number;
  question_text: string;
  audio_base64?: string; // TTS audio for the question
  sample_answer?: string;
}

// Generated test structure
export interface GeneratedTest {
  id: string;
  module: PracticeModule;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  topic: string;
  timeMinutes: number;
  passage?: GeneratedPassage; // For reading
  audioBase64?: string; // For listening (kept in memory only)
  audioFormat?: string;
  sampleRate?: number;
  transcript?: string; // For listening
  questionGroups?: GeneratedQuestionGroup[]; // For reading/listening
  totalQuestions: number;
  generatedAt: string;
  // Writing specific
  writingTask?: GeneratedWritingTask;
  // Speaking specific
  speakingParts?: GeneratedSpeakingPart[];
}

// Practice result
export interface PracticeResult {
  testId: string;
  answers: Record<number, string>;
  score: number;
  totalQuestions: number;
  bandScore: number;
  completedAt: string;
  timeSpent: number; // seconds
  questionResults: QuestionResult[];
}

export interface QuestionResult {
  questionNumber: number;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache for current test (audio/large binary kept only in memory)
// ─────────────────────────────────────────────────────────────────────────────
let currentTestCache: GeneratedTest | null = null;

// Strip large binary/base64 data before persisting to Supabase
function stripBase64Data(test: GeneratedTest): GeneratedTest {
  const stripped: GeneratedTest = { ...test };

  // Remove audio data
  delete stripped.audioBase64;

  // Remove writing task image
  if (stripped.writingTask) {
    stripped.writingTask = { ...stripped.writingTask };
    delete stripped.writingTask.image_base64;
  }

  // Remove speaking audio
  if (stripped.speakingParts) {
    stripped.speakingParts = stripped.speakingParts.map(part => ({
      ...part,
      questions: part.questions.map(q => {
        const { audio_base64, ...rest } = q;
        return rest;
      }),
    }));
  }

  return stripped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase helpers (async)
// ─────────────────────────────────────────────────────────────────────────────

/** Persist a newly generated test to Supabase and keep full version in memory. */
export async function saveGeneratedTestAsync(test: GeneratedTest, userId: string): Promise<void> {
  // Keep full test in memory for immediate playback
  currentTestCache = test;

  const strippedTest = stripBase64Data(test);

  const { error } = await supabase.from('ai_practice_tests').insert({
    id: test.id,
    user_id: userId,
    module: test.module,
    question_type: test.questionType as string,
    difficulty: test.difficulty,
    topic: test.topic,
    time_minutes: test.timeMinutes,
    total_questions: test.totalQuestions,
    generated_at: test.generatedAt,
    payload: strippedTest as unknown as Json,
    audio_url: null, // we don't upload audio for now
    audio_format: test.audioFormat ?? null,
    sample_rate: test.sampleRate ?? null,
  });

  if (error) {
    console.error('Failed to save AI practice test to Supabase:', error);
  }
}

/** Load list of generated tests from Supabase (most recent first). */
export async function loadGeneratedTestsAsync(userId: string): Promise<GeneratedTest[]> {
  const { data, error } = await supabase
    .from('ai_practice_tests')
    .select('*')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Failed to load AI practice tests:', error);
    return currentTestCache ? [currentTestCache] : [];
  }

  const tests: GeneratedTest[] = (data || []).map((row) => {
    const payload = row.payload as unknown as GeneratedTest;
    return {
      ...payload,
      id: row.id,
      module: row.module as PracticeModule,
      questionType: row.question_type as QuestionType,
      difficulty: row.difficulty as DifficultyLevel,
      topic: row.topic,
      timeMinutes: row.time_minutes,
      totalQuestions: row.total_questions,
      generatedAt: row.generated_at,
      audioFormat: row.audio_format ?? undefined,
      sampleRate: row.sample_rate ?? undefined,
    };
  });

  // Merge memory cache if not in list
  if (currentTestCache && !tests.find(t => t.id === currentTestCache!.id)) {
    return [currentTestCache, ...tests];
  }

  return tests;
}

/** Load a single test by ID from memory cache first, then Supabase. */
export async function loadGeneratedTestAsync(testId: string): Promise<GeneratedTest | null> {
  if (currentTestCache?.id === testId) {
    return currentTestCache;
  }

  const { data, error } = await supabase
    .from('ai_practice_tests')
    .select('*')
    .eq('id', testId)
    .maybeSingle();

  if (error || !data) {
    console.error('Failed to load AI practice test:', error);
    return null;
  }

  const payload = data.payload as unknown as GeneratedTest;
  const test: GeneratedTest = {
    ...payload,
    id: data.id,
    module: data.module as PracticeModule,
    questionType: data.question_type as QuestionType,
    difficulty: data.difficulty as DifficultyLevel,
    topic: data.topic,
    timeMinutes: data.time_minutes,
    totalQuestions: data.total_questions,
    generatedAt: data.generated_at,
    audioFormat: data.audio_format ?? undefined,
    sampleRate: data.sample_rate ?? undefined,
  };

  return test;
}

/** Save practice result to Supabase. */
export async function savePracticeResultAsync(result: PracticeResult, userId: string, module: PracticeModule): Promise<void> {
  const { error } = await supabase.from('ai_practice_results').insert({
    user_id: userId,
    test_id: result.testId,
    module,
    answers: result.answers as unknown as Json,
    score: result.score,
    total_questions: result.totalQuestions,
    band_score: result.bandScore,
    time_spent_seconds: result.timeSpent,
    question_results: result.questionResults as unknown as Json,
    completed_at: result.completedAt,
  });

  if (error) {
    console.error('Failed to save AI practice result to Supabase:', error);
  }
}

/** Load practice results from Supabase. */
export async function loadPracticeResultsAsync(userId: string): Promise<PracticeResult[]> {
  const { data, error } = await supabase
    .from('ai_practice_results')
    .select('*')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Failed to load AI practice results:', error);
    return [];
  }

  return (data || []).map((row) => ({
    testId: row.test_id,
    answers: row.answers as unknown as Record<number, string>,
    score: row.score,
    totalQuestions: row.total_questions,
    bandScore: Number(row.band_score ?? 0),
    completedAt: row.completed_at,
    timeSpent: row.time_spent_seconds,
    questionResults: row.question_results as unknown as QuestionResult[],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous helpers (for backwards compatibility during migration)
// These are thin wrappers around the async functions for pages that use sync API.
// ─────────────────────────────────────────────────────────────────────────────

/** Set current test in memory (used when navigating to test). */
export function setCurrentTest(test: GeneratedTest): void {
  currentTestCache = test;
}

/** Get current test from memory cache. */
export function getCurrentTest(): GeneratedTest | null {
  return currentTestCache;
}

/** Synchronous wrapper: just uses memory cache. Async load should be preferred. */
export function loadGeneratedTest(testId: string): GeneratedTest | null {
  if (currentTestCache?.id === testId) {
    return currentTestCache;
  }
  // If not in memory, caller should use loadGeneratedTestAsync
  return null;
}

/** Synchronous wrapper: just returns memory cache. */
export function loadGeneratedTests(): GeneratedTest[] {
  return currentTestCache ? [currentTestCache] : [];
}

// Legacy sync stubs (no-ops for write, caller should use Async variants)
export function saveGeneratedTest(_test: GeneratedTest): void {
  // No-op: callers should migrate to saveGeneratedTestAsync
  // Keep memory cache for fallback
  currentTestCache = _test;
}

export function savePracticeResult(_result: PracticeResult): void {
  // No-op: callers should migrate to savePracticeResultAsync
}

export function loadPracticeResults(): PracticeResult[] {
  // Caller should use loadPracticeResultsAsync
  return [];
}
