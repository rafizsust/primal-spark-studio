import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

import { HelpCircle, EyeOff, StickyNote, Mic as MicIcon, Pause, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HighlightNoteProvider } from '@/hooks/useHighlightNotes';
import { NoteSidebar } from '@/components/common/NoteSidebar';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { describeApiError } from '@/lib/apiErrors';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import { SpeakingTestControls } from '@/components/speaking/SpeakingTestControls';
import { SpeakingTimer } from '@/components/speaking/SpeakingTimer';
import { Badge } from '@/components/ui/badge';
import { MicrophoneTest } from '@/components/speaking/MicrophoneTest';
import { AILoadingScreen } from '@/components/common/AILoadingScreen';
import { useFullscreenTest } from '@/hooks/useFullscreenTest';
import { compressAudio } from '@/utils/audioCompressor';


type SpeakingTest = Tables<'speaking_tests'>;
// Extend SpeakingQuestionGroup to include the joined speaking_questions
interface SpeakingQuestionGroupWithQuestions extends Tables<'speaking_question_groups'> {
  speaking_questions: Array<Tables<'speaking_questions'>>;
}
// Extend SpeakingQuestion to include time_limit_seconds from its parent group
interface SpeakingQuestionWithTime extends Tables<'speaking_questions'> {
  time_limit_seconds: number;
}
// SpeakingSubmission type available from Tables<'speaking_submissions'>

// Helper to render rich text (markdown-like formatting)
const renderRichText = (text: string): string => {
  if (!text) return '';
  
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-2 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-3 mb-2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^• (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\n/g, '<br/>');
};

// Local storage key for guest drafts
const SPEAKING_TEST_GUEST_DRAFT_KEY = 'speaking_test_guest_draft';
// Local storage key for failed AI submissions (logged-in users)
const SPEAKING_TEST_FAILED_SUBMISSION_KEY = 'speaking_test_failed_submission';

export default function SpeakingTest() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [speakingTest, setSpeakingTest] = useState<SpeakingTest | null>(null);
  const [questionGroups, setQuestionGroups] = useState<SpeakingQuestionGroupWithQuestions[]>([]);
  const [allQuestions, setAllQuestions] = useState<SpeakingQuestionWithTime[]>([]);

  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [part2Phase, setPart2Phase] = useState<'preparation' | 'speaking' | 'done'>('preparation');

  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioBlobUrls = useRef<Record<string, string>>({}); // Stores blob URLs for each question/part
  const audioBlobs = useRef<Record<string, Blob>>({}); // Stores actual Blob objects
  // Removed transcripts.current ref

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0); // New state for recording duration
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [timeLeft, setTimeLeft] = useState(0);
  const [overallPartTimeLeft, setOverallPartTimeLeft] = useState(0);
  const [fontSize, setFontSize] = useState(14);
  const [isPaused, setIsPaused] = useState(false);
  const [customTime, setCustomTime] = useState(15);

  // Fullscreen mode
  const { enterFullscreen, toggleFullscreen, isFullscreen } = useFullscreenTest();

  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [showMicrophoneTest, setShowMicrophoneTest] = useState(true); // New state for mic test

  // AI Loading Screen states
  const [showAILoadingScreen, setShowAILoadingScreen] = useState(false);
  const [aiProgressSteps, setAiProgressSteps] = useState<string[]>([]);
  const [currentAIStepIndex, setCurrentAIStepIndex] = useState(0);

  // New state for animation direction
  const [navigationDirection, setNavigationDirection] = useState<'next' | 'prev' | null>(null);
  // New state for part transition overlay
  const [showPartTransitionOverlay, setShowPartTransitionOverlay] = useState(false);
  const [partTransitionMessage, setPartTransitionMessage] = useState('');


  const isNewSubmissionRequest = location.pathname.endsWith('/new-submission');

  // --- Helper Functions ---
  const currentGroup = useMemo(() => questionGroups[currentPartIndex] || null, [questionGroups, currentPartIndex]);
  const currentQuestionsInGroup = useMemo(() => {
    return allQuestions.filter(q => q.group_id === currentGroup?.id).sort((a, b) => a.order_index - b.order_index);
  }, [allQuestions, currentGroup]);
  const currentQuestion = useMemo(() => currentQuestionsInGroup[currentQuestionIndex] || null, [currentQuestionsInGroup, currentQuestionIndex]);

  // --- Navigation Logic Variables ---
  const canGoNextQuestion = currentQuestionIndex < currentQuestionsInGroup.length - 1;
  const canGoNextPart = currentPartIndex < questionGroups.length - 1;
  const isLastQuestionOfLastPart = !canGoNextQuestion && !canGoNextPart;

  // Helper to convert Blob to Base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Helper to convert Base64 to Blob
  const base64ToBlob = (base64: string, contentType: string = 'audio/webm'): Blob => {
    const byteString = atob(base64.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: contentType });
  };

  const stopRecording = useCallback(async (): Promise<void> => {
    return new Promise(resolve => {
      if (!isRecording || !mediaRecorder) {
        resolve();
        return;
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        
        if (currentQuestion && currentGroup) {
          const key = `part${currentGroup.part_number}-q${currentQuestion.id}`;
          audioBlobUrls.current = { ...audioBlobUrls.current, [key]: url };
          audioBlobs.current = { ...audioBlobs.current, [key]: audioBlob };
          console.log(`Recorded audio for ${key}: ${url}`);
        }
        // Stop all tracks in the stream
        if (mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        setRecordingDuration(0);
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        
        setIsRecording(false);
        setMediaRecorder(null);
        // toast.success('Recording stopped.'); // Removed redundant toast

        if (currentGroup?.part_number === 2 && part2Phase === 'speaking') {
          setPart2Phase('done');
        }
        resolve(); // Resolve the promise here
      };

      mediaRecorder.stop();
    });
  }, [isRecording, mediaRecorder, currentQuestion, currentGroup, part2Phase]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      audioChunks.current = [];
      recorder.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      // The onstop logic is now handled by the `stopRecording` useCallback
      // This ensures that `stopRecording` is the single source of truth for processing the audio blob.
      // We still need to set the `onstop` handler here, but it will be overridden if `stopRecording` is called directly.
      // For consistency, we'll ensure `stopRecording` is always called to finalize.

      recorder.start();
      setIsRecording(true);
      setMediaRecorder(recorder);
      setIsPaused(false);
      // toast.info('Recording started. Speak into your microphone.'); // Removed redundant toast

      // Start recording duration timer
      setRecordingDuration(0);
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      if (currentGroup?.part_number === 2 && part2Phase === 'preparation') {
        setPart2Phase('speaking');
      }
    } catch (err) {
      console.error('Error accessing microphone:', err);
      toast.error('Failed to start recording. Please check microphone permissions.');
    }
  }, [isRecording, currentQuestion, currentGroup, part2Phase]);

  const resetCurrentRecording = useCallback(() => {
    if (isRecording) {
      stopRecording(); // This will now return a Promise, but we don't need to await it here
    }
    if (currentQuestion && currentGroup) {
      const key = `part${currentGroup.part_number}-q${currentQuestion.id}`;
      const newAudioBlobUrls = { ...audioBlobUrls.current };
      delete newAudioBlobUrls[key];
      audioBlobUrls.current = newAudioBlobUrls;
      const newAudioBlobs = { ...audioBlobs.current };
      delete newAudioBlobs[key];
      audioBlobs.current = newAudioBlobs;
      toast.info('Recording cleared for current question/part.');
      // Reset timer for the specific question
      setTimeLeft(currentQuestion.time_limit_seconds || 30);
    }
  }, [isRecording, stopRecording, currentQuestion, currentGroup]);

  const saveGuestDraft = useCallback(async () => {
    if (!testId) return;

    const audioBlobsBase64: Record<string, string> = {};
    for (const key in audioBlobs.current) {
      audioBlobsBase64[key] = await blobToBase64(audioBlobs.current[key]);
    }

    const draft = {
      testId,
      currentPartIndex,
      currentQuestionIndex,
      part2Phase,
      audioBlobsBase64, // Save Base64 representation
      // Removed transcripts from draft
      timeLeft,
      overallPartTimeLeft,
      fontSize,
      isFullscreen,
      isPaused,
      customTime,
      savedAt: Date.now(),
    };
    localStorage.setItem(`${SPEAKING_TEST_GUEST_DRAFT_KEY}_${testId}`, JSON.stringify(draft));
    toast.info('Your progress has been saved locally. Please log in to submit.');
  }, [testId, currentPartIndex, currentQuestionIndex, part2Phase, timeLeft, overallPartTimeLeft, fontSize, isFullscreen, isPaused, customTime]);

  const clearGuestDraft = useCallback(() => {
    if (testId) {
      localStorage.removeItem(`${SPEAKING_TEST_GUEST_DRAFT_KEY}_${testId}`);
    }
  }, [testId]);

  const saveFailedSubmissionLocally = useCallback(async (submissionData: TablesInsert<'speaking_submissions'>) => {
    if (!testId || !user) return;

    const audioBlobsBase64: Record<string, string> = {};
    for (const key in audioBlobs.current) {
      audioBlobsBase64[key] = await blobToBase64(audioBlobs.current[key]);
    }

    const failedSubmission = {
      testId,
      userId: user.id,
      submissionData, // The data that was attempted to be submitted
      audioBlobsBase64,
      // Removed transcripts from failed submission draft
      failedAt: new Date().toISOString(),
    };

    // Store as an array of failed submissions
    const existingFailed = JSON.parse(localStorage.getItem(SPEAKING_TEST_FAILED_SUBMISSION_KEY) || '[]') as typeof failedSubmission[];
    localStorage.setItem(SPEAKING_TEST_FAILED_SUBMISSION_KEY, JSON.stringify([...existingFailed, failedSubmission]));
    toast.error('AI evaluation failed. Your submission has been saved locally for re-submission.', { duration: 8000 });
  }, [testId, user]);


  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return; // Prevent re-entry

    if (isRecording) {
      await stopRecording(); // Wait for recording to fully stop and process
    }

    // Now, check if any audio was actually recorded across all parts/questions
    const hasAnyRecordedAudio = Object.keys(audioBlobs.current).length > 0;
    if (!hasAnyRecordedAudio) {
      toast.error('Please record your speaking response before submitting.');
      setIsSubmitting(false); // Reset submitting state
      return;
    }

    if (!user) {
      saveGuestDraft();
      navigate(`/auth?redirect=/speaking/test/${testId}/submit-guest`);
      return;
    }

    if (!speakingTest) {
      toast.error('Test data not loaded.');
      setIsSubmitting(false); // Reset state on error
      return;
    }

    setIsSubmitting(true); // Set submitting state BEFORE confirmation
    if (!confirm('Are you sure you want to submit your speaking test? You cannot edit it after submission.')) {
      setIsSubmitting(false); // Reset if user cancels
      return;
    }

    // Show AI Loading Screen
    setShowAILoadingScreen(true);
    setAiProgressSteps([
      'Preparing your audio for AI',
      'Analyzing your speaking performance',
      'Generating detailed feedback report',
      'Calculating your overall band score',
    ]);
    setCurrentAIStepIndex(0);

    const simulateProgress = (step: number, delay: number = 2000) => {
      return new Promise(resolve => setTimeout(() => {
        setCurrentAIStepIndex(step);
        resolve(null);
      }, delay));
    };

    try {
      await simulateProgress(0, 500); // Step 0: Preparing audio

      const submissionTimestamp = new Date().toISOString();
      
      // Prepare submission data (audio_url_partX and transcript_partX will be NULL)
      const submissionData: TablesInsert<'speaking_submissions'> = {
        user_id: user.id,
        test_id: speakingTest.id!,
        submitted_at: submissionTimestamp,
        audio_url_part1: null, // No longer storing audio files in Supabase Storage
        audio_url_part2: null,
        audio_url_part3: null,
        transcript_part1: null, // No longer storing transcripts in DB directly
        transcript_part2: null,
        transcript_part3: null,
      };

      // Insert new submission
      const { data: newSubmission, error: insertError } = await supabase
        .from('speaking_submissions')
        .insert(submissionData)
        .select()
        .single();

      if (insertError) throw insertError;

      // Convert all recorded audio blobs to Base64 for sending to Edge Function
      // Prefer MP3 to reduce payload size (same compression approach as AI Practice)
      const base64AudioData: Record<string, string> = {};
      for (const key in audioBlobs.current) {
        const blob = audioBlobs.current[key];

        try {
          const inputFile = new File([blob], `${key}.webm`, { type: blob.type || 'audio/webm' });
          const mp3File = await compressAudio(inputFile);
          base64AudioData[key] = await blobToBase64(mp3File);
        } catch (e) {
          console.warn('[SpeakingTest] MP3 compression failed, falling back to original blob:', e);
          base64AudioData[key] = await blobToBase64(blob);
        }
      }

      console.log('Audio Blobs before Base64 conversion:', audioBlobs.current); // Log 1
      console.log('Base64 Audio Data being sent:', base64AudioData); // Log 2

      await simulateProgress(1); // Step 1: Analyzing with AI

      // Trigger AI evaluation, sending audio data directly
      const { error: evaluationError } = await supabase.functions.invoke('evaluate-speaking-submission', {
        body: { submissionId: newSubmission.id, audioData: base64AudioData },
      });

      if (evaluationError) {
        console.error('AI evaluation failed:', evaluationError);
        const errDesc = describeApiError(evaluationError);

        // Save to local storage if AI evaluation failed
        await saveFailedSubmissionLocally(submissionData);
        toast.error(errDesc.description, { 
          id: 'ai-eval-toast', 
          duration: 8000,
          action: errDesc.action ? {
            label: errDesc.action.label,
            onClick: () => navigate(errDesc.action!.href)
          } : undefined
        });
        return; // Stop submission process here
      }

      await simulateProgress(2); // Step 2: Generating feedback
      await simulateProgress(3); // Step 3: Calculating band score

      clearGuestDraft(); // Clear guest draft after successful submission
      toast.success('Speaking test submitted! Evaluation will be available shortly.', { id: 'ai-eval-toast', duration: 5000 }); // Added duration
      navigate(`/speaking/evaluation/${testId}/${newSubmission.id}`);
    } catch (error: any) {
      console.error('Error submitting speaking test:', error);
      toast.error(`Failed to submit test: ${error.message}`, { id: 'ai-eval-toast' });
    } finally {
      setIsSubmitting(false);
      setShowAILoadingScreen(false); // Hide loading screen
    }
  }, [user, speakingTest, testId, isRecording, stopRecording, navigate, questionGroups, saveGuestDraft, clearGuestDraft, isSubmitting, saveFailedSubmissionLocally]);

  const handleCurrentTimerEnd = useCallback(async () => { // Make it async
    if (isRecording) {
      await stopRecording(); // Await here too
    }

    if (!currentGroup) {
      handleSubmit(); // This handleSubmit will now correctly check for audio
      return;
    }

    if (currentGroup.part_number === 1) {
      if (canGoNextQuestion) { // Use canGoNextQuestion
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        const nextPartNumber = questionGroups[currentPartIndex + 1]?.part_number;
        if (nextPartNumber) {
          setPartTransitionMessage(`Moving to Part ${nextPartNumber}`);
          setShowPartTransitionOverlay(true);
          setTimeout(() => setShowPartTransitionOverlay(false), 500); // Reduced to 500ms
        }
        setCurrentPartIndex(prev => prev + 1);
        setCurrentQuestionIndex(0);
        setPart2Phase('preparation');
      }
    } else if (currentGroup.part_number === 2) {
      if (part2Phase === 'preparation') {
        setTimeLeft(currentGroup.speaking_time_seconds || 120); // Start speaking timer
        setPart2Phase('speaking');
      } else if (part2Phase === 'speaking' || part2Phase === 'done') { // Combine these
        setPart2Phase('done'); // Ensure it's marked done
        if (canGoNextPart) {
          const nextPartNumber = questionGroups[currentPartIndex + 1]?.part_number;
          if (nextPartNumber) {
            setPartTransitionMessage(`Moving to Part ${nextPartNumber}`);
            setShowPartTransitionOverlay(true);
            setTimeout(() => setShowPartTransitionOverlay(false), 500); // Reduced to 500ms
          }
          setCurrentPartIndex(prev => prev + 1);
          setCurrentQuestionIndex(0);
          if (questionGroups[currentPartIndex + 1]?.part_number === 2) {
            setPart2Phase('preparation');
          }
        } else {
          handleSubmit();
        }
      }
    } else if (currentGroup.part_number === 3) {
      if (canGoNextQuestion) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        handleSubmit();
      }
    }
  }, [isRecording, stopRecording, currentGroup, canGoNextQuestion, currentQuestionIndex, currentPartIndex, questionGroups.length, part2Phase, canGoNextPart, handleSubmit, questionGroups]);

  // Part 3 time end handler removed - not currently used

  // --- Effects ---
  useEffect(() => {
    if (testId) {
      fetchTestData();
    }
  }, [testId, isNewSubmissionRequest]);

  // Auto-enter fullscreen on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      enterFullscreen();
    }, 500);
    return () => clearTimeout(timer);
  }, [enterFullscreen]);

  // Load guest draft on mount if available and user is not logged in
  useEffect(() => {
    if (!user && testId) {
      const savedDraft = localStorage.getItem(`${SPEAKING_TEST_GUEST_DRAFT_KEY}_${testId}`);
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft);
          setCurrentPartIndex(draft.currentPartIndex);
          setCurrentQuestionIndex(draft.currentQuestionIndex);
          setPart2Phase(draft.part2Phase);
          // Convert Base64 audio back to Blob and create URL
          const loadedAudioBlobs: Record<string, Blob> = {};
          const loadedAudioBlobUrls: Record<string, string> = {};
          for (const key in draft.audioBlobsBase64) {
            const blob = base64ToBlob(draft.audioBlobsBase64[key]);
            loadedAudioBlobs[key] = blob;
            loadedAudioBlobUrls[key] = URL.createObjectURL(blob);
          }
          audioBlobs.current = loadedAudioBlobs;
          audioBlobUrls.current = loadedAudioBlobUrls;
          // Removed transcripts.current = draft.transcripts;
          setTimeLeft(draft.timeLeft);
          setOverallPartTimeLeft(draft.overallPartTimeLeft);
          setFontSize(draft.fontSize);
          // isFullscreen is handled by hook, skip restoring
          setIsPaused(draft.isPaused);
          setCustomTime(draft.customTime);
          toast.info('Your previous session has been restored. Please log in to submit.');
          setShowMicrophoneTest(false); // Skip mic test if draft loaded
        } catch (e) {
          console.error('Failed to restore guest draft:', e);
          clearGuestDraft();
        }
      }
    }
  }, [user, testId, clearGuestDraft]);

  // Handle post-login submission redirect
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const redirect = queryParams.get('redirect');

    if (user && redirect === `/speaking/test/${testId}/submit-guest`) {
      // Clear the redirect parameter from the URL
      navigate(location.pathname, { replace: true });
      // Trigger submission after successful login and state restoration
      handleSubmit();
    }
  }, [user, location.search, testId, navigate, handleSubmit]);


  // Effect for question/phase specific timer (timeLeft)
  useEffect(() => {
    if (currentGroup && currentQuestion) {
      if (currentGroup.part_number === 1) {
        setTimeLeft(currentQuestion.time_limit_seconds || 30);
      } else if (currentGroup.part_number === 2) {
        if (part2Phase === 'preparation') {
          setTimeLeft(currentGroup.preparation_time_seconds || 60);
        } else if (part2Phase === 'speaking') {
          setTimeLeft(currentGroup.speaking_time_seconds || 120);
        } else { // part2Phase === 'done'
          setTimeLeft(0);
        }
      } else if (currentGroup.part_number === 3) {
        setTimeLeft(currentQuestion.time_limit_seconds || 60);
      }
    }
  }, [currentGroup, currentQuestion, part2Phase]); // Dependencies: current active elements

  // Effect for overall Part 3 timer (overallPartTimeLeft)
  const prevPartIndexRef = useRef(currentPartIndex);
  useEffect(() => {
    // If we just entered Part 3
    if (currentGroup?.part_number === 3 && prevPartIndexRef.current !== currentPartIndex) {
      setOverallPartTimeLeft(currentGroup.total_part_time_limit_seconds || 300);
    } 
    // If we just left Part 3
    else if (currentGroup?.part_number !== 3 && prevPartIndexRef.current === 3) {
      setOverallPartTimeLeft(0);
    }
    prevPartIndexRef.current = currentPartIndex; // Update ref for next render
  }, [currentPartIndex, currentGroup]); // Only depends on part index and group


  const fetchTestData = async () => {
    setLoading(true);
    try {
      const { data: testData, error: testError } = await supabase
        .from('speaking_tests')
        .select('*')
        .eq('id', testId!)
        .single();

      if (testError) throw testError;
      setSpeakingTest(testData);

      const { data: groupsData, error: groupsError } = await supabase
        .from('speaking_question_groups')
        .select('*, speaking_questions(*)')
        .eq('test_id', testId!)
        .order('part_number')
        .order('order_index', { foreignTable: 'speaking_questions' });

      if (groupsError) throw groupsError;

      const fetchedGroups: SpeakingQuestionGroupWithQuestions[] = (groupsData || []).map(g => ({
        ...g,
        speaking_questions: (g.speaking_questions || []).map(q => ({
          ...q,
          time_limit_seconds: g.time_limit_seconds || 0
        })).sort((a, b) => a.order_index - b.order_index),
      }));
      setQuestionGroups(fetchedGroups);

      const allQs: SpeakingQuestionWithTime[] = fetchedGroups.flatMap(group => 
        (group.speaking_questions || []).map(q => ({
          ...q,
          time_limit_seconds: group.time_limit_seconds || 0,
        }))
      );
      setAllQuestions(allQs);

      if (allQs.length > 0) {
        setCurrentQuestionIndex(0);
        setCurrentPartIndex(0);
      } else {
        toast.error('No questions found for this speaking test.');
        navigate('/speaking/cambridge-ielts-a');
        return;
      }

    } catch (error) {
      console.error('Error fetching test data:', error);
      toast.error('Failed to load speaking test');
      navigate('/speaking/cambridge-ielts-a');
    } finally {
      setLoading(false);
    }
  };

  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
    if (isRecording) {
      if (mediaRecorder?.state === 'recording') {
        mediaRecorder.pause();
      } else if (mediaRecorder?.state === 'paused') {
        mediaRecorder.resume();
      }
    }
  }, [isRecording, mediaRecorder]);

  // Custom time change removed - not currently used

  const handleNext = useCallback(async () => { // Make it async
    if (isRecording) {
      await stopRecording(); // Await here
    }
    setNavigationDirection('next'); // Set animation direction
    setTimeout(() => setNavigationDirection(null), 500); // Reset after animation duration

    if (currentGroup?.part_number === 2) {
      if (part2Phase === 'preparation') {
        setTimeLeft(currentGroup.speaking_time_seconds || 120); // Start speaking timer
        setPart2Phase('speaking');
      } else if (part2Phase === 'speaking' || part2Phase === 'done') { // Combine these
        setPart2Phase('done'); // Ensure it's marked done
        if (canGoNextPart) {
          const nextPartNumber = questionGroups[currentPartIndex + 1]?.part_number;
          if (nextPartNumber) {
            setPartTransitionMessage(`Moving to Part ${nextPartNumber}`);
            setShowPartTransitionOverlay(true);
            setTimeout(() => setShowPartTransitionOverlay(false), 500); // Reduced to 500ms
          }
          setCurrentPartIndex(prev => prev + 1);
          setCurrentQuestionIndex(0);
          if (questionGroups[currentPartIndex + 1]?.part_number === 2) {
            setPart2Phase('preparation');
          }
        } else {
          handleSubmit();
        }
      }
    } else if (canGoNextQuestion) {
      setCurrentQuestionIndex(prev => prev + 1); // Corrected: increment question index
    } else if (canGoNextPart) {
      const nextPartNumber = questionGroups[currentPartIndex + 1]?.part_number;
      if (nextPartNumber) {
        setPartTransitionMessage(`Moving to Part ${nextPartNumber}`);
        setShowPartTransitionOverlay(true);
        setTimeout(() => setShowPartTransitionOverlay(false), 500); // Reduced to 500ms
      }
      setCurrentPartIndex(prev => prev + 1);
      setCurrentQuestionIndex(0);
      if (questionGroups[currentPartIndex + 1]?.part_number === 2) {
        setPart2Phase('preparation');
      }
    } else {
      handleSubmit();
    }
  }, [isRecording, stopRecording, currentGroup, part2Phase, canGoNextQuestion, canGoNextPart, currentPartIndex, questionGroups, handleSubmit]);

  const handlePrev = useCallback(async () => { // Make it async
    if (isRecording) {
      await stopRecording(); // Await here
    }
    setNavigationDirection('prev'); // Set animation direction
    setTimeout(() => setNavigationDirection(null), 500); // Reset after animation duration

    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    } else if (currentPartIndex > 0) {
      const newPartIndex = currentPartIndex - 1;
      const prevGroup = questionGroups[newPartIndex];
      if (prevGroup) {
        const prevPartNumber = prevGroup.part_number;
        if (prevPartNumber) {
          setPartTransitionMessage(`Moving to Part ${prevPartNumber}`);
          setShowPartTransitionOverlay(true);
          setTimeout(() => setShowPartTransitionOverlay(false), 500); // Reduced to 500ms
        }
        setCurrentPartIndex(newPartIndex);
        setCurrentQuestionIndex(prevGroup.speaking_questions.length - 1);
        if (prevGroup.part_number === 2) {
          setPart2Phase('done'); // Assume done if navigating back to it
        } else {
          setPart2Phase('preparation'); // Reset phase for other parts
        }
      }
    }
  }, [isRecording, stopRecording, currentQuestionIndex, currentPartIndex, questionGroups, part2Phase]);


  if (showMicrophoneTest) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center">
        <MicrophoneTest 
          onTestComplete={() => setShowMicrophoneTest(false)} 
          onSkipTest={() => setShowMicrophoneTest(false)} // Pass the skip handler
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading test...</div>
      </div>
    );
  }

  if (!speakingTest || !currentGroup || !currentQuestion) {
    return (
      <div className="min-h-screen bg-secondary flex items-center justify-center">
        <div className="text-destructive">Speaking test or questions not found</div>
      </div>
    );
  }

  const isPart2Preparation = currentGroup.part_number === 2 && part2Phase === 'preparation';

  const currentRecordingStatusText = isRecording 
    ? 'Recording...' 
    : isPart2Preparation 
      ? 'Prepare your answer' 
      : 'Click to Start Recording';

  const currentRecordingButtonDisabled = isSubmitting || isPaused || (currentGroup.part_number === 2 && part2Phase === 'done'); // Only disable if Part 2 is done
  const currentRecordingButtonIcon = isRecording ? <Pause size={32} /> : <MicIcon size={32} />;
  const currentRecordingButtonClasses = cn(
    "rounded-full h-16 w-16 flex items-center justify-center transition-all duration-200 relative",
    isRecording ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90"
  );

  const hasRecordedForCurrentQuestion = currentQuestion && currentGroup && audioBlobUrls.current[`part${currentGroup.part_number}-q${currentQuestion.id}`];

  return (
    <HighlightNoteProvider testId={testId!}>
      <div className="min-h-screen bg-background flex flex-col overflow-y-auto ielts-test-content">
        {/* Top Header - IELTS Official Style */}
        <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0 ielts-section-header" style={{ fontFamily: 'var(--font-ielts)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center border border-border">
              <span className="text-xs font-bold" style={{ fontFamily: 'var(--font-ielts)' }}>SP</span>
            </div>
            <span className="text-sm font-semibold" style={{ fontFamily: 'var(--font-ielts)' }}>Speaking Test: {speakingTest.name}</span>
          </div>
          
          <SpeakingTimer 
            timeLeft={timeLeft} 
            setTimeLeft={setTimeLeft} 
            isPaused={isPaused} 
            onTimeEnd={handleCurrentTimerEnd} 
            isDone={currentGroup?.part_number === 2 && part2Phase === 'done'} // Pass isDone prop
          />
          
          <div className="flex items-center gap-2">
            <SpeakingTestControls
              fontSize={fontSize}
              setFontSize={setFontSize}
              isFullscreen={isFullscreen}
              toggleFullscreen={toggleFullscreen}
              isPaused={isPaused}
              togglePause={togglePause}
            />
            <Button variant="ghost" size="icon" onClick={() => setIsNoteSidebarOpen(true)} className="relative">
              <StickyNote size={18} />
            </Button>
            <Button variant="outline" size="sm">
              <HelpCircle size={16} className="mr-1" />
              Help
            </Button>
            <Button variant="outline" size="sm">
              <EyeOff size={16} className="mr-1" />
              Hide
            </Button>
          </div>
        </header>

        {/* Part Header - IELTS Official Style */}
        <div className="bg-muted border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0 ielts-muted" style={{ fontFamily: 'var(--font-ielts)' }}>
          <div>
            <h2 className="font-semibold" style={{ fontFamily: 'var(--font-ielts)' }}>Part {currentGroup.part_number}: {currentGroup.part_number === 1 ? 'Introduction & Interview' : currentGroup.part_number === 2 ? 'Individual Long Turn' : 'Two-way Discussion'}</h2>
            <p className="text-sm text-muted-foreground ielts-muted-text" style={{ fontFamily: 'var(--font-ielts)' }}>
              {renderRichText(currentGroup.instruction || '')}
            </p>
          </div>
          {currentGroup.part_number === 2 && (
            <Badge variant="secondary" className="text-sm">
              {part2Phase === 'preparation' ? 'Preparation Time' : 'Speaking Time'}
            </Badge>
          )}
          {currentGroup.part_number === 3 && (
            <div className="text-sm text-muted-foreground">
              Overall Part 3 Time: {Math.floor(overallPartTimeLeft / 60)}:{String(overallPartTimeLeft % 60).padStart(2, '0')}
            </div>
          )}
        </div>

        {/* Main Content - IELTS Official Style */}
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 pb-20 ielts-card" style={{ fontFamily: 'var(--font-ielts)' }}>
            <div
              key={`${currentGroup?.id}-${currentQuestion?.id}-${part2Phase}`}
              className={cn(
                "p-8 max-w-3xl w-full text-center space-y-6 overflow-y-auto max-h-full",
                navigationDirection === 'next' ? 'animate-slide-fade-in-right' :
                navigationDirection === 'prev' ? 'animate-slide-fade-in-left' : ''
              )}
              style={{ fontFamily: 'var(--font-ielts)' }}
            >
              {currentGroup.part_number === 2 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold text-primary">{currentGroup.cue_card_topic}</h3>
                  <div className="p-4 text-left">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: renderRichText(currentGroup.cue_card_content || '') }}
                    />
                  </div>
                <p className="text-sm text-muted-foreground">
                  Preparation Time: {currentGroup.preparation_time_seconds} seconds
                </p>
              </div>
            )}

            <h2 className="text-3xl font-bold text-foreground">
              <div dangerouslySetInnerHTML={{ __html: renderRichText(currentQuestion.question_text) }} />
            </h2>
            <p className="text-muted-foreground text-lg">
              Question {currentQuestion.question_number} of {currentQuestionsInGroup.length}
            </p>

            {/* Recording Controls */}
            <div className="flex flex-col items-center gap-4 mt-8">
              <div className="relative">
                <Button
                  size="lg"
                  className={currentRecordingButtonClasses}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={currentRecordingButtonDisabled}
                >
                  {currentRecordingButtonIcon}
                </Button>
                {/* Blinking red recording indicator */}
                {isRecording && (
                  <div className="absolute -top-1 -right-1 flex items-center justify-center">
                    <span className="absolute w-4 h-4 rounded-full bg-red-500 animate-ping opacity-75" />
                    <span className="relative w-3 h-3 rounded-full bg-red-600" />
                  </div>
                )}
              </div>
              <span className={cn(
                "text-sm font-medium",
                isRecording ? "text-destructive" : "text-muted-foreground"
              )}>
                {currentRecordingStatusText}
              </span>
              {isRecording && (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                  <span className="text-sm text-destructive font-mono">
                    Recording: {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{String(recordingDuration % 60).padStart(2, '0')}
                  </span>
                </div>
              )}
              {hasRecordedForCurrentQuestion && !isRecording && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm text-success flex items-center gap-1">
                    <CheckCircle2 size={16} /> Recording saved temporarily
                  </span>
                  <audio controls src={audioBlobUrls.current[`part${currentGroup.part_number}-q${currentQuestion.id}`]} className="w-64" />
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={resetCurrentRecording}
                    disabled={isSubmitting || isPaused}
                    className="mt-2"
                  >
                    Retake
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Navigation */}
        <footer className="bg-card border-t border-border px-4 py-3 flex items-center justify-between flex-shrink-0 fixed bottom-0 left-0 right-0 z-40"> {/* Added fixed positioning and z-index */}
          <Button variant="outline" onClick={handlePrev} disabled={isSubmitting || (currentPartIndex === 0 && currentQuestionIndex === 0)}>
            Back
          </Button>
          {isLastQuestionOfLastPart ? (
            <Button onClick={handleSubmit} disabled={isSubmitting || isRecording}>
              {isSubmitting ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
              {isSubmitting ? 'Submitting...' : 'Submit Test'}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={isSubmitting}>
              Next
            </Button>
          )}
        </footer>
      </div>
      {testId && (
        <NoteSidebar 
          testId={testId} 
          isOpen={isNoteSidebarOpen} 
          onOpenChange={setIsNoteSidebarOpen} 
          renderRichText={renderRichText}
        />
      )}
      {showAILoadingScreen && (
        <AILoadingScreen
          title="Evaluating Your Speaking Performance"
          description="Our AI is analyzing your audio and crafting your personalized feedback report."
          progressSteps={aiProgressSteps}
          currentStepIndex={currentAIStepIndex}
          estimatedTime="30-60 seconds"
        />
      )}
      {/* Non-intrusive part transition indicator */}
      <div 
        className={cn(
          "fixed top-20 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out pointer-events-none",
          showPartTransitionOverlay 
            ? "opacity-100 translate-y-0" 
            : "opacity-0 -translate-y-4"
        )}
      >
        <div className="relative flex items-center gap-3 px-6 py-3 rounded-full bg-gradient-to-r from-primary/90 to-primary shadow-lg shadow-primary/25 border border-primary/20">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20 animate-pulse">
            <svg className="w-4 h-4 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <span className="text-lg font-semibold text-primary-foreground tracking-wide">
            {partTransitionMessage}
          </span>
          <div className="absolute inset-0 rounded-full bg-white/10 animate-ping opacity-20" />
        </div>
      </div>
    </HighlightNoteProvider>
  );
}