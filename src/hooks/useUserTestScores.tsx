import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface TestScore {
  testId: string;
  score: number;
  totalQuestions: number;
  bandScore: number | null;
  completedAt: string;
}

interface PartScore {
  partNumber: number;
  score: number;
  totalQuestions: number;
}

interface UserTestScores {
  reading: Record<string, { overall: TestScore | null; parts: Record<number, PartScore> }>;
  listening: Record<string, { overall: TestScore | null; parts: Record<number, PartScore> }>;
  loading: boolean;
}

export function useUserTestScores(): UserTestScores {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [readingScores, setReadingScores] = useState<Record<string, { overall: TestScore | null; parts: Record<number, PartScore> }>>({});
  const [listeningScores, setListeningScores] = useState<Record<string, { overall: TestScore | null; parts: Record<number, PartScore> }>>({});

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setReadingScores({});
      setListeningScores({});
      return;
    }

    const fetchScores = async () => {
      try {
        // Fetch reading submissions
        const { data: readingData } = await supabase
          .from('reading_test_submissions')
          .select('test_id, score, total_questions, band_score, completed_at, answers')
          .eq('user_id', user.id)
          .order('completed_at', { ascending: false });

        // Fetch listening submissions
        const { data: listeningData } = await supabase
          .from('listening_test_submissions')
          .select('test_id, score, total_questions, band_score, completed_at, answers')
          .eq('user_id', user.id)
          .order('completed_at', { ascending: false });

        // Process reading scores - keep only the best/latest per test
        const readingMap: Record<string, { overall: TestScore | null; parts: Record<number, PartScore> }> = {};
        readingData?.forEach(submission => {
          if (!readingMap[submission.test_id]) {
            readingMap[submission.test_id] = {
              overall: {
                testId: submission.test_id,
                score: submission.score,
                totalQuestions: submission.total_questions,
                bandScore: submission.band_score,
                completedAt: submission.completed_at,
              },
              parts: {},
            };
          }
        });

        // Process listening scores
        const listeningMap: Record<string, { overall: TestScore | null; parts: Record<number, PartScore> }> = {};
        listeningData?.forEach(submission => {
          if (!listeningMap[submission.test_id]) {
            listeningMap[submission.test_id] = {
              overall: {
                testId: submission.test_id,
                score: submission.score,
                totalQuestions: submission.total_questions,
                bandScore: submission.band_score,
                completedAt: submission.completed_at,
              },
              parts: {},
            };
          }
        });

        setReadingScores(readingMap);
        setListeningScores(listeningMap);
      } catch (error) {
        console.error('Error fetching user scores:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchScores();
  }, [user]);

  return {
    reading: readingScores,
    listening: listeningScores,
    loading,
  };
}
