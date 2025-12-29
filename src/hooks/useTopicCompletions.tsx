import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type ModuleType = 'reading' | 'listening' | 'writing' | 'speaking';

export function useTopicCompletions(module: ModuleType) {
  const { user } = useAuth();
  const [completions, setCompletions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  // Fetch completions for this module
  const fetchCompletions = useCallback(async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_practice_topic_completions')
        .select('topic, completed_count')
        .eq('user_id', user.id)
        .eq('module', module);

      if (error) {
        console.error('Error fetching topic completions:', error);
        return;
      }

      const counts: Record<string, number> = {};
      data?.forEach(row => {
        counts[row.topic] = row.completed_count;
      });
      setCompletions(counts);
    } catch (err) {
      console.error('Error fetching topic completions:', err);
    } finally {
      setLoading(false);
    }
  }, [user, module]);

  useEffect(() => {
    fetchCompletions();
  }, [fetchCompletions]);

  // Increment completion count for a topic
  const incrementCompletion = useCallback(async (topic: string) => {
    if (!user) return;

    try {
      const { error } = await supabase.rpc('increment_topic_completion', {
        p_user_id: user.id,
        p_module: module,
        p_topic: topic,
      });

      if (error) {
        console.error('Error incrementing topic completion:', error);
        return;
      }

      // Update local state
      setCompletions(prev => ({
        ...prev,
        [topic]: (prev[topic] || 0) + 1,
      }));
    } catch (err) {
      console.error('Error incrementing topic completion:', err);
    }
  }, [user, module]);

  // Get display label with completion count
  const getTopicLabel = useCallback((topic: string): string => {
    const count = completions[topic];
    if (count && count > 0) {
      return `${topic} (${count} completed)`;
    }
    return topic;
  }, [completions]);

  return {
    completions,
    loading,
    incrementCompletion,
    getTopicLabel,
    refetch: fetchCompletions,
  };
}
