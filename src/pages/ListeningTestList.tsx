import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { BookSectionNew, QuestionTypeFilter } from '@/components/test-list';
import { Card, CardContent } from '@/components/ui/card';
import { Headphones, Sparkles } from 'lucide-react';
import { useUserTestScores } from '@/hooks/useUserTestScores';

interface QuestionGroup {
  id: string;
  question_type: string;
  start_question: number;
  end_question: number;
}

interface ListeningTest {
  id: string;
  title: string;
  book_name: string;
  test_number: number;
  time_limit: number;
  total_questions: number;
  audio_url: string | null;
  audio_url_part1?: string | null;
  audio_url_part2?: string | null;
  audio_url_part3?: string | null;
  audio_url_part4?: string | null;
  created_at: string | null;
  question_groups?: QuestionGroup[];
}

// Helper to extract book number for sorting (e.g., "Cambridge 20" -> 20)
const extractBookNumber = (bookName: string): number => {
  const match = bookName.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

export default function ListeningTestList() {
  const [tests, setTests] = useState<ListeningTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const { listening: userScores, loading: scoresLoading } = useUserTestScores();

  useEffect(() => {
    fetchTests();
  }, []);

  const fetchTests = async () => {
    try {
      // Fetch tests
      const { data: testsData, error: testsError } = await supabase
        .from('listening_tests')
        .select('*')
        .eq('is_published', true)
        .order('book_name', { ascending: false })
        .order('test_number', { ascending: true });

      if (testsError) throw testsError;

      // Fetch question groups
      const testIds = testsData?.map((t) => t.id) || [];
      const { data: groupsData } = await supabase
        .from('listening_question_groups')
        .select('id, question_type, start_question, end_question, test_id')
        .in('test_id', testIds);

      // Combine data
      const enrichedTests = testsData?.map((test) => {
        const question_groups = groupsData
          ?.filter((g) => g.test_id === test.id)
          .sort((a, b) => a.start_question - b.start_question) || [];

        return { ...test, question_groups };
      }) || [];

      setTests(enrichedTests);
    } catch (error) {
      console.error('Error fetching listening tests:', error);
    } finally {
      setLoading(false);
    }
  };

  // Group tests by book and sort books by number descending (newest first)
  const groupedTests = useMemo(() => {
    const groups = tests.reduce((acc, test) => {
      if (!acc[test.book_name]) {
        acc[test.book_name] = [];
      }
      acc[test.book_name].push(test);
      return acc;
    }, {} as Record<string, ListeningTest[]>);

    // Sort book names by number descending
    const sortedEntries = Object.entries(groups).sort(([a], [b]) => {
      return extractBookNumber(b) - extractBookNumber(a);
    });

    return sortedEntries;
  }, [tests]);

  // Get all unique question types
  const availableQuestionTypes = useMemo(() => {
    const types = new Set<string>();
    tests.forEach((test) => {
      test.question_groups?.forEach((group) => {
        types.add(group.question_type);
      });
    });
    return Array.from(types).sort();
  }, [tests]);

  const handleTypeToggle = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background via-background to-secondary/20">
      <Navbar />

      <main className="flex-1 container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              IELTS Academic Listening
            </div>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
              Listening Practice Tests
            </h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Sharpen your listening skills with authentic audio tests. Practice by sections or complete the full exam.
            </p>
          </div>

          {/* Question Type Filter */}
          {!loading && availableQuestionTypes.length > 0 && (
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="pt-6">
                <QuestionTypeFilter
                  availableTypes={availableQuestionTypes}
                  selectedTypes={selectedTypes}
                  onTypeToggle={handleTypeToggle}
                  onClearAll={() => setSelectedTypes([])}
                />
              </CardContent>
            </Card>
          )}

          {/* Content */}
          {loading || scoresLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center animate-pulse">
                <Headphones className="w-6 h-6 text-primary" />
              </div>
              <p className="text-muted-foreground">Loading tests...</p>
            </div>
          ) : tests.length === 0 ? (
            <Card className="text-center py-16">
              <CardContent className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center">
                  <Headphones className="w-10 h-10 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">No Tests Available</h3>
                  <p className="text-muted-foreground">Check back soon for new listening tests.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {groupedTests.map(([bookName, bookTests]) => (
                <BookSectionNew
                  key={bookName}
                  bookName={bookName}
                  tests={bookTests}
                  testType="listening"
                  selectedQuestionTypes={selectedTypes}
                  userScores={userScores}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
