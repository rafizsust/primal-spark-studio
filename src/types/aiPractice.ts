// Types for AI Practice feature

export type PracticeModule = 'reading' | 'listening' | 'writing' | 'speaking';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

// Reading question types
export type ReadingQuestionType = 
  | 'TRUE_FALSE_NOT_GIVEN'
  | 'MULTIPLE_CHOICE'
  | 'FILL_IN_BLANK'
  | 'MATCHING_HEADINGS'
  | 'MATCHING_INFORMATION'
  | 'SENTENCE_COMPLETION'
  | 'SUMMARY_COMPLETION';

// Listening question types  
export type ListeningQuestionType =
  | 'FILL_IN_BLANK'
  | 'MULTIPLE_CHOICE_SINGLE'
  | 'MULTIPLE_CHOICE_MULTIPLE'
  | 'MATCHING_CORRECT_LETTER'
  | 'TABLE_COMPLETION';

// Writing task types
export type WritingTaskType = 'TASK_1' | 'TASK_2';

// Speaking part types
export type SpeakingPartType = 'FULL_TEST' | 'PART_1' | 'PART_2' | 'PART_3';

export type QuestionType = ReadingQuestionType | ListeningQuestionType | WritingTaskType | SpeakingPartType;

// Question counts based on question type
export const QUESTION_COUNTS: Record<string, number> = {
  'TRUE_FALSE_NOT_GIVEN': 5,
  'MULTIPLE_CHOICE': 4,
  'FILL_IN_BLANK': 6,
  'MATCHING_HEADINGS': 5,
  'MATCHING_INFORMATION': 5,
  'SENTENCE_COMPLETION': 4,
  'SUMMARY_COMPLETION': 5,
  'MULTIPLE_CHOICE_SINGLE': 4,
  'MULTIPLE_CHOICE_MULTIPLE': 3,
  'MATCHING_CORRECT_LETTER': 5,
  'TABLE_COMPLETION': 5,
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
  audioBase64?: string; // For listening
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

// Local storage key
export const AI_PRACTICE_STORAGE_KEY = 'ai_practice_tests';
export const AI_PRACTICE_RESULTS_KEY = 'ai_practice_results';

// In-memory cache for current test (avoids localStorage quota issues with base64 data)
let currentTestCache: GeneratedTest | null = null;

// Strip large base64 data for localStorage storage
function stripBase64Data(test: GeneratedTest): GeneratedTest {
  const stripped = { ...test };
  
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
      })
    }));
  }
  
  return stripped;
}

// Helper to save/load from localStorage
export function saveGeneratedTest(test: GeneratedTest): void {
  // Store full test in memory for immediate access
  currentTestCache = test;
  
  try {
    // Store stripped version in localStorage (metadata only)
    const strippedTest = stripBase64Data(test);
    const stored = localStorage.getItem(AI_PRACTICE_STORAGE_KEY);
    const tests: GeneratedTest[] = stored ? JSON.parse(stored) : [];
    // Keep only last 10 tests
    const updated = [strippedTest, ...tests.filter(t => t.id !== test.id).slice(0, 9)];
    localStorage.setItem(AI_PRACTICE_STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Could not save test to localStorage, using memory only:', error);
    // Clear old tests to make room
    try {
      localStorage.removeItem(AI_PRACTICE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function loadGeneratedTests(): GeneratedTest[] {
  try {
    const stored = localStorage.getItem(AI_PRACTICE_STORAGE_KEY);
    const tests: GeneratedTest[] = stored ? JSON.parse(stored) : [];
    // Include current cached test if it exists
    if (currentTestCache && !tests.find(t => t.id === currentTestCache!.id)) {
      return [currentTestCache, ...tests];
    }
    return tests;
  } catch {
    return currentTestCache ? [currentTestCache] : [];
  }
}

export function loadGeneratedTest(testId: string): GeneratedTest | null {
  // First check memory cache (has full data including base64)
  if (currentTestCache?.id === testId) {
    return currentTestCache;
  }
  // Fall back to localStorage (without base64 data)
  const tests = loadGeneratedTests();
  return tests.find(t => t.id === testId) || null;
}

// Set current test in memory (used when navigating to test)
export function setCurrentTest(test: GeneratedTest): void {
  currentTestCache = test;
}

// Get current test from memory
export function getCurrentTest(): GeneratedTest | null {
  return currentTestCache;
}

export function savePracticeResult(result: PracticeResult): void {
  try {
    const stored = localStorage.getItem(AI_PRACTICE_RESULTS_KEY);
    const results: PracticeResult[] = stored ? JSON.parse(stored) : [];
    const updated = [result, ...results.slice(0, 49)]; // Keep last 50 results
    localStorage.setItem(AI_PRACTICE_RESULTS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Could not save result to localStorage:', error);
  }
}

export function loadPracticeResults(): PracticeResult[] {
  try {
    const stored = localStorage.getItem(AI_PRACTICE_RESULTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}
