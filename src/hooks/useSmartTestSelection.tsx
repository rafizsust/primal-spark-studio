import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SmartTestSelection {
  test: any | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface UseSmartTestSelectionOptions {
  module: "listening" | "speaking" | "reading" | "writing";
  topic?: string;
  difficulty?: string;
  questionType?: string;
  excludeTestIds?: string[];
  preferredAccent?: string;
  autoFetch?: boolean;
}

export function useSmartTestSelection({
  module,
  topic,
  difficulty,
  questionType,
  excludeTestIds,
  preferredAccent,
  autoFetch = true,
}: UseSmartTestSelectionOptions): SmartTestSelection {
  const [test, setTest] = useState<any | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);

  const fetchTest = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-smart-test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            module,
            topic,
            difficulty,
            questionType,
            excludeTestIds,
            preferredAccent,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "NO_TESTS") {
          setError("No tests available for this selection");
        } else {
          setError(data.error || "Failed to fetch test");
        }
        setTest(null);
      } else if (data.success && data.test) {
        setTest(data.test);
      } else {
        setError("Invalid response from server");
        setTest(null);
      }
    } catch (err) {
      console.error("Smart test selection error:", err);
      setError(err instanceof Error ? err.message : "Network error");
      setTest(null);
    } finally {
      setLoading(false);
    }
  }, [module, topic, difficulty, questionType, excludeTestIds, preferredAccent]);

  useEffect(() => {
    if (autoFetch) {
      fetchTest();
    }
  }, [autoFetch, fetchTest]);

  return {
    test,
    loading,
    error,
    refetch: fetchTest,
  };
}

export default useSmartTestSelection;
