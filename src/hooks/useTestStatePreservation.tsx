import { useNavigate } from 'react-router-dom';
import { useCallback } from 'react';
import { safeLocalStorageSetItem, safeLocalStorageGetItem } from '@/lib/storage';

interface TestState {
  testId: string;
  testType: 'reading' | 'listening' | 'writing' | 'speaking';
  answers?: Record<number, string>;
  submissionText?: string;
  submissionText1?: string;
  submissionText2?: string;
  currentQuestion?: number;
  currentPassageIndex?: number;
  timeLeft?: number;
  returnPath: string;
  autoSubmitOnReturn?: boolean;
}

export function useTestStatePreservation() {
  const navigate = useNavigate();

  const saveStateAndRedirect = useCallback((state: TestState) => {
    // Save state to localStorage (with quota-safe handling)
    safeLocalStorageSetItem(
      'pendingTestSubmission',
      JSON.stringify({
        ...state,
        savedAt: new Date().toISOString(),
      })
    );

    // Redirect to auth with return URL
    navigate(`/auth?returnTo=${encodeURIComponent(state.returnPath)}&pendingSubmission=true`);
  }, [navigate]);

  const getPendingSubmission = useCallback((): TestState | null => {
    const saved = safeLocalStorageGetItem('pendingTestSubmission');
    if (!saved) return null;

    try {
      const state = JSON.parse(saved);
      // Check if saved within last 2 hours
      const savedAt = new Date(state.savedAt);
      const now = new Date();
      const hoursDiff = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60);

      if (hoursDiff > 2) {
        localStorage.removeItem('pendingTestSubmission');
        return null;
      }

      return state;
    } catch {
      localStorage.removeItem('pendingTestSubmission');
      return null;
    }
  }, []);

  const clearPendingSubmission = useCallback(() => {
    localStorage.removeItem('pendingTestSubmission');
  }, []);

  const restoreStateIfNeeded = useCallback((testId: string, testType: string): TestState | null => {
    const pending = getPendingSubmission();
    if (pending && pending.testId === testId && pending.testType === testType) {
      return pending;
    }
    return null;
  }, [getPendingSubmission]);

  return {
    saveStateAndRedirect,
    getPendingSubmission,
    clearPendingSubmission,
    restoreStateIfNeeded
  };
}
