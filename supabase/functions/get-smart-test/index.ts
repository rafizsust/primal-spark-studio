import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user's token if available
    const token = authHeader?.replace("Bearer ", "");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    if (token && token !== supabaseAnonKey) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    const { module, topic, difficulty, questionType, excludeTestIds, preferredAccent } = await req.json();

    if (!module) {
      return new Response(JSON.stringify({ error: "Module is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[get-smart-test] Request: module=${module}, topic=${topic}, difficulty=${difficulty}, questionType=${questionType}`);

    // If no topic is specified and user is logged in, use Smart-Cycle algorithm to pick topic
    let effectiveTopic = topic;
    
    if (!effectiveTopic && userId) {
      // Get all distinct topics from published tests for this module
      // Also filter by difficulty and questionType if provided to get relevant topics
      let topicQuery = supabase
        .from("generated_test_audio")
        .select("topic")
        .eq("module", module)
        .eq("is_published", true)
        .eq("status", "ready");

      // Apply filters when determining available topics
      if (difficulty) {
        topicQuery = topicQuery.eq("difficulty", difficulty);
      }
      if (questionType) {
        topicQuery = topicQuery.eq("question_type", questionType);
      }

      const { data: topicData } = await topicQuery;

      if (topicData && topicData.length > 0) {
        // Get unique topics, sorted for consistent ordering
        const availableTopics = [...new Set(topicData.map(t => t.topic))].sort();
        
        // Get user's completion counts for these topics
        const { data: completionData } = await supabase
          .from("ai_practice_topic_completions")
          .select("topic, completed_count")
          .eq("user_id", userId)
          .eq("module", module);

        const completions: Record<string, number> = {};
        completionData?.forEach((row: { topic: string; completed_count: number }) => {
          completions[row.topic] = row.completed_count;
        });

        // Calculate cycle count (minimum completions across all available topics)
        const counts = availableTopics.map(t => completions[t] || 0);
        const cycleCount = Math.min(...counts);

        // Find next topic where usage == cycle_count (Smart-Cycle algorithm)
        for (const t of availableTopics) {
          const usageCount = completions[t] || 0;
          if (usageCount === cycleCount) {
            effectiveTopic = t;
            break;
          }
        }
      }
    }

    // Build query for smart test selection
    let query = supabase
      .from("generated_test_audio")
      .select("*")
      .eq("module", module)
      .eq("is_published", true)
      .eq("status", "ready");

    // CRITICAL: Filter by difficulty if provided
    if (difficulty) {
      query = query.eq("difficulty", difficulty);
      console.log(`[get-smart-test] Filtering by difficulty: ${difficulty}`);
    }

    // CRITICAL: Filter by questionType if provided
    if (questionType) {
      query = query.eq("question_type", questionType);
      console.log(`[get-smart-test] Filtering by question_type: ${questionType}`);
    }

    // Filter by topic if provided (or determined by Smart-Cycle)
    if (effectiveTopic) {
      query = query.eq("topic", effectiveTopic);
      console.log(`[get-smart-test] Filtering by topic: ${effectiveTopic}`);
    }

    // Get all matching tests
    const { data: allTests, error } = await query;

    if (error) {
      console.error("Query error:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch tests" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allTests || allTests.length === 0) {
      return new Response(JSON.stringify({ error: "No tests available", code: "NO_TESTS" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If user is logged in, get their test history for LRU selection
    let recentTestIds: string[] = [];
    let recentAccents: string[] = [];

    if (userId) {
      const { data: history } = await supabase
        .from("user_test_history")
        .select("test_id")
        .eq("user_id", userId)
        .order("taken_at", { ascending: false })
        .limit(20);

      if (history) {
        recentTestIds = history.map((h) => h.test_id);
      }

      // Get recent accents from test history
      if (recentTestIds.length > 0) {
        const { data: recentTests } = await supabase
          .from("generated_test_audio")
          .select("accent")
          .in("id", recentTestIds.slice(0, 5));

        if (recentTests) {
          recentAccents = recentTests.map((t) => t.accent).filter(Boolean) as string[];
        }
      }
    }

    // Also exclude any explicitly passed test IDs
    if (excludeTestIds && Array.isArray(excludeTestIds)) {
      recentTestIds = [...new Set([...recentTestIds, ...excludeTestIds])];
    }

    // Smart selection algorithm:
    // 1. Filter out recently taken tests
    // 2. Prefer accents user hasn't heard recently
    // 3. Sort by least used (times_used) and oldest (last_used_at)

    let availableTests = allTests.filter((t) => !recentTestIds.includes(t.id));

    // If all tests have been taken, fall back to all tests (LRU)
    if (availableTests.length === 0) {
      availableTests = allTests;
    }

    // Score tests for selection
    const scoredTests = availableTests.map((test) => {
      let score = 0;

      // Prefer tests with accents user hasn't heard recently
      if (test.accent && !recentAccents.includes(test.accent)) {
        score += 10;
      }

      // Prefer preferred accent if specified
      if (preferredAccent && test.accent === preferredAccent) {
        score += 5;
      }

      // Prefer less used tests
      score -= (test.times_used || 0) * 2;

      // Add some randomness
      score += Math.random() * 5;

      return { test, score };
    });

    // Sort by score (highest first) and pick the best
    scoredTests.sort((a, b) => b.score - a.score);
    const selectedTest = scoredTests[0].test;

    // Update usage stats
    await supabase
      .from("generated_test_audio")
      .update({
        times_used: (selectedTest.times_used || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", selectedTest.id);

    // Record in user history if logged in
    if (userId) {
      await supabase
        .from("user_test_history")
        .upsert(
          {
            user_id: userId,
            test_id: selectedTest.id,
            taken_at: new Date().toISOString(),
          },
          { onConflict: "user_id,test_id" }
        );
    }

    return new Response(
      JSON.stringify({
        success: true,
        test: selectedTest,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("get-smart-test error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
