import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Trophy, 
  RotateCcw, 
  ArrowLeft, 
  CheckCircle2, 
  XCircle, 
  Sparkles,
  Medal,
  Loader2,
  Flag,
  Volume2,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { TranscriptViewer } from '@/components/listening/TranscriptViewer';

interface QuestionResult {
  questionNumber: number;
  questionText: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation?: string;
  options?: any;
  questionType?: string;
}

/**
 * Format correct answer string for display
 * Shows primary answer prominently and alternatives in a friendly way
 */
function formatCorrectAnswer(correctAnswer: string): { primary: string; alternatives: string[] } {
  if (!correctAnswer) return { primary: '', alternatives: [] };
  
  const parts = correctAnswer.split('/').map(a => a.trim()).filter(Boolean);
  
  if (parts.length === 0) return { primary: '', alternatives: [] };
  if (parts.length === 1) return { primary: parts[0], alternatives: [] };
  
  return {
    primary: parts[0],
    alternatives: parts.slice(1)
  };
}

interface TopScorer {
  id: string;
  full_name: string;
  avatar_url: string | null;
  score: number;
  total: number;
  completed_at: string;
}

interface TestResultData {
  id: string;
  score: number;
  total: number;
  percentage: number;
  bandScore: number;
  testTitle: string;
  bookName: string;
  testNumber: number;
  completedAt: string;
  questionResults: QuestionResult[];
}

export default function TestResults() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [searchParams] = useSearchParams();
  const testType = searchParams.get('type') || 'reading';
  const testId = searchParams.get('testId');
  const navigate = useNavigate();
  
  const [resultData, setResultData] = useState<TestResultData | null>(null);
  const [topScorers, setTopScorers] = useState<TopScorer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExplanations, setLoadingExplanations] = useState<Set<number>>(new Set());
  const [explanations, setExplanations] = useState<Record<number, string>>({});
  const [transcripts, setTranscripts] = useState<{
    part1?: string | null;
    part2?: string | null;
    part3?: string | null;
    part4?: string | null;
  }>({});
  const [passages, setPassages] = useState<{
    passage1?: { title: string; content: string } | null;
    passage2?: { title: string; content: string } | null;
    passage3?: { title: string; content: string } | null;
  }>({});
  const [questionPassageMap, setQuestionPassageMap] = useState<Record<number, number>>({});
  const [showOnlyIncorrect, setShowOnlyIncorrect] = useState(false);
  const autoLoadedRef = useRef(false);

  useEffect(() => {
    if (submissionId) {
      fetchResultData();
      fetchTopScorers();
    }
  }, [submissionId, testType]);

  // Auto-load explanations for incorrect answers
  useEffect(() => {
    if (resultData && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      const incorrectQuestions = resultData.questionResults.filter(r => !r.isCorrect);
      // Load first 3 incorrect explanations automatically
      incorrectQuestions.slice(0, 3).forEach(q => {
        fetchExplanation(q);
      });
    }
  }, [resultData]);

  const fetchResultData = async () => {
    try {
      const tableName = testType === 'reading' ? 'reading_test_submissions' : 'listening_test_submissions';
      const testTable = testType === 'reading' ? 'reading_tests' : 'listening_tests';
      
      const { data: submission, error: submissionError } = await supabase
        .from(tableName as 'reading_test_submissions' | 'listening_test_submissions')
        .select('*')
        .eq('id', submissionId!)
        .single();

      if (submissionError) {
        console.error('Submission fetch error:', submissionError);
        if (submissionError.code === '42P01' || submissionError.message.includes('does not exist')) {
          const storedResult = sessionStorage.getItem(`test_result_${submissionId}`);
          if (storedResult) {
            setResultData(JSON.parse(storedResult));
          }
          setLoading(false);
          return;
        }
        throw submissionError;
      }

      const { data: testInfo } = await supabase
        .from(testTable)
        .select('*')
        .eq('id', submission.test_id)
        .single();

      let questions: any[] = [];
      if (testType === 'reading') {
        const { data: passageData } = await supabase
          .from('reading_passages')
          .select('id, passage_number, title, content')
          .eq('test_id', submission.test_id)
          .order('passage_number');
        
        if (passageData && passageData.length > 0) {
          // Store passages for context
          const passageMap: typeof passages = {};
          passageData.forEach(p => {
            const key = `passage${p.passage_number}` as keyof typeof passageMap;
            passageMap[key] = { title: p.title, content: p.content };
          });
          setPassages(passageMap);

          const passageIds = passageData.map(p => p.id);
          const { data: questionData } = await supabase
            .from('reading_questions')
            .select('*')
            .in('passage_id', passageIds)
            .order('question_number');
          
          // Create a map of question number to passage number
          const qPassageMap: Record<number, number> = {};
          questionData?.forEach(q => {
            const passage = passageData.find(p => p.id === q.passage_id);
            if (passage) {
              qPassageMap[q.question_number] = passage.passage_number;
            }
          });
          setQuestionPassageMap(qPassageMap);
          
          questions = questionData || [];
        }
      } else {
        const { data: groups } = await supabase
          .from('listening_question_groups')
          .select('*, listening_questions(*)')
          .eq('test_id', submission.test_id);
        
        questions = groups?.flatMap(g => 
          (g.listening_questions || []).map((lq: any) => ({
            ...lq,
            question_type: g.question_type,
            group_options: g.options
          }))
        ) || [];
      }

      const userAnswers = submission.answers as Record<string, string>;
      const questionResults: QuestionResult[] = questions.map(q => {
        const userAnswer = userAnswers?.[q.question_number.toString()] || '';
        const correctAnswer = q.correct_answer || '';
        const correctOptions = correctAnswer.toLowerCase().split('/').map((a: string) => a.trim());
        const isCorrect = correctOptions.includes(userAnswer.toLowerCase().trim());

        return {
          questionNumber: q.question_number,
          questionText: q.question_text,
          userAnswer,
          correctAnswer,
          isCorrect,
          options: q.options || q.group_options,
          questionType: q.question_type
        };
      }).sort((a, b) => a.questionNumber - b.questionNumber);

      const score = submission.score || questionResults.filter(r => r.isCorrect).length;
      const total = submission.total_questions || questionResults.length;
      const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
      
      const bandScore = calculateBandScore(percentage);

      setResultData({
        id: submission.id,
        score,
        total,
        percentage,
        bandScore,
        testTitle: testInfo?.title || 'Test',
        bookName: testInfo?.book_name || '',
        testNumber: testInfo?.test_number || 1,
        completedAt: submission.completed_at,
        questionResults
      });

      // Set transcripts for listening tests
      if (testType === 'listening' && testInfo) {
        const listeningTestInfo = testInfo as {
          transcript_part1?: string | null;
          transcript_part2?: string | null;
          transcript_part3?: string | null;
          transcript_part4?: string | null;
        };
        setTranscripts({
          part1: listeningTestInfo.transcript_part1,
          part2: listeningTestInfo.transcript_part2,
          part3: listeningTestInfo.transcript_part3,
          part4: listeningTestInfo.transcript_part4,
        });
      }
    } catch (error) {
      console.error('Error fetching result data:', error);
      const storedResult = sessionStorage.getItem(`test_result_${submissionId}`);
      if (storedResult) {
        setResultData(JSON.parse(storedResult));
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchTopScorers = async () => {
    try {
      const tableName = testType === 'reading' ? 'reading_test_submissions' : 'listening_test_submissions';
      
      const { data, error } = await supabase
        .from(tableName as 'reading_test_submissions' | 'listening_test_submissions')
        .select('id, score, total_questions, completed_at, user_id, test_id')
        .order('score', { ascending: false })
        .limit(20);

      if (error) {
        if (error.code !== '42P01') {
          console.error('Top scorers fetch error:', error);
        }
        return;
      }

      if (!data || data.length === 0) {
        const storedResult = sessionStorage.getItem(`test_result_${submissionId}`);
        if (storedResult) {
          const result = JSON.parse(storedResult);
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('id', user.id)
              .single();
            
            setTopScorers([{
              id: submissionId || 'current',
              full_name: profile?.full_name || user.email?.split('@')[0] || 'You',
              avatar_url: profile?.avatar_url ?? null,
              score: result.score,
              total: result.total,
              completed_at: result.completedAt
            }]);
          }
        }
        return;
      }

      const userIds = [...new Set(data.map((item: any) => item.user_id).filter(Boolean))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      const scorers: TopScorer[] = data.map((item: any) => {
        const profile = profileMap.get(item.user_id);
        return {
          id: item.id,
          full_name: profile?.full_name || 'Anonymous',
          avatar_url: profile?.avatar_url || null,
          score: item.score,
          total: item.total_questions,
          completed_at: item.completed_at
        };
      });

      setTopScorers(scorers);
    } catch (error) {
      console.error('Error fetching top scorers:', error);
    }
  };

  const calculateBandScore = (percentage: number): number => {
    if (percentage >= 93) return 9;
    if (percentage >= 85) return 8.5;
    if (percentage >= 78) return 8;
    if (percentage >= 70) return 7.5;
    if (percentage >= 63) return 7;
    if (percentage >= 55) return 6.5;
    if (percentage >= 48) return 6;
    if (percentage >= 40) return 5.5;
    if (percentage >= 33) return 5;
    if (percentage >= 25) return 4.5;
    if (percentage >= 18) return 4;
    if (percentage >= 13) return 3.5;
    if (percentage >= 8) return 3;
    return 2.5;
  };

  const getTranscriptContext = (questionNumber: number): string => {
    // Determine which part the question belongs to based on question number
    // Part 1: Q1-10, Part 2: Q11-20, Part 3: Q21-30, Part 4: Q31-40
    let relevantTranscript = '';
    if (questionNumber <= 10 && transcripts.part1) {
      relevantTranscript = transcripts.part1;
    } else if (questionNumber <= 20 && transcripts.part2) {
      relevantTranscript = transcripts.part2;
    } else if (questionNumber <= 30 && transcripts.part3) {
      relevantTranscript = transcripts.part3;
    } else if (transcripts.part4) {
      relevantTranscript = transcripts.part4;
    }
    
    // Limit transcript length to avoid token limits
    if (relevantTranscript.length > 2000) {
      return relevantTranscript.substring(0, 2000) + '...';
    }
    return relevantTranscript;
  };

  const getPassageContext = (questionNumber: number): string => {
    const passageNumber = questionPassageMap[questionNumber];
    if (!passageNumber) return '';
    
    const passageKey = `passage${passageNumber}` as keyof typeof passages;
    const passage = passages[passageKey];
    if (!passage) return '';
    
    // Limit passage length to avoid token limits
    let content = `Title: ${passage.title}\n\n${passage.content}`;
    if (content.length > 3000) {
      content = content.substring(0, 3000) + '...';
    }
    return content;
  };

  const fetchExplanation = async (questionResult: QuestionResult) => {
    if (explanations[questionResult.questionNumber]) return;
    if (loadingExplanations.has(questionResult.questionNumber)) return;
    
    setLoadingExplanations(prev => new Set(prev).add(questionResult.questionNumber));
    
    try {
      const transcriptContext = testType === 'listening' 
        ? getTranscriptContext(questionResult.questionNumber)
        : '';
      
      const passageContext = testType === 'reading'
        ? getPassageContext(questionResult.questionNumber)
        : '';

      const response = await supabase.functions.invoke('explain-answer', {
        body: {
          questionText: questionResult.questionText,
          userAnswer: questionResult.userAnswer,
          correctAnswer: questionResult.correctAnswer,
          isCorrect: questionResult.isCorrect,
          options: questionResult.options,
          questionType: questionResult.questionType,
          transcriptContext,
          passageContext,
          testType
        }
      });

      if (response.error) {
        if (response.error.message?.includes('429')) {
          throw new Error('Rate limit exceeded. Please try again in a moment.');
        }
        if (response.error.message?.includes('402')) {
          throw new Error('AI credits exhausted. Please add credits to continue.');
        }
        throw response.error;
      }

      const explanation = response.data?.explanation;
      if (!explanation || explanation === 'Unable to generate explanation.') {
        throw new Error('No explanation received');
      }

      setExplanations(prev => ({
        ...prev,
        [questionResult.questionNumber]: explanation
      }));
    } catch (error) {
      console.error('Error fetching explanation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate explanation';
      setExplanations(prev => ({
        ...prev,
        [questionResult.questionNumber]: `Unable to generate explanation: ${errorMessage}. Please try again.`
      }));
    } finally {
      setLoadingExplanations(prev => {
        const next = new Set(prev);
        next.delete(questionResult.questionNumber);
        return next;
      });
    }
  };

  const reportIssue = (questionResult: QuestionResult) => {
    const subject = encodeURIComponent(`Issue with Question ${questionResult.questionNumber} - ${resultData?.testTitle || 'Test'}`);
    const body = encodeURIComponent(`
Hi IELTS AI Support,

I believe there may be an issue with the following question:

Test: ${resultData?.testTitle || 'N/A'}
Question Number: ${questionResult.questionNumber}
Question Text: ${questionResult.questionText}

Given Correct Answer: ${questionResult.correctAnswer}
My Answer: ${questionResult.userAnswer || '(No answer)'}

Issue Description:
[Please describe the issue here]

Thank you for looking into this.
    `.trim());
    
    window.open(`mailto:support@ieltsai.net?subject=${subject}&body=${body}`, '_blank');
    
    toast({
      title: 'Report Issue',
      description: 'Your email client should open. If not, please email support@ieltsai.net directly.',
    });
  };

  const handleRetake = () => {
    if (testId) {
      navigate(`/${testType}/test/${testId}`);
    } else {
      navigate(`/${testType}`);
    }
  };

  const handleBack = () => {
    navigate(`/${testType}/cambridge-ielts-a`);
  };

  const displayedResults = showOnlyIncorrect 
    ? resultData?.questionResults.filter(r => !r.isCorrect) || []
    : resultData?.questionResults || [];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading results...</p>
        </div>
      </div>
    );
  }

  if (!resultData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Results not found</p>
          <Button onClick={() => navigate(`/${testType}`)}>Back to Tests</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm z-10 sticky top-0">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} className="gap-2">
            <ArrowLeft size={18} />
            Back
          </Button>
          <h1 className="text-lg font-semibold">{resultData.testTitle}</h1>
          <Button onClick={handleRetake} variant="outline" className="gap-2">
            <RotateCcw size={18} />
            Retake
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Score Overview - Compact */}
        <Card className="mb-6 border-0 bg-gradient-to-r from-accent/10 via-primary/5 to-accent/10 shadow-lg">
          <CardContent className="py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Score Circle */}
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
                    <div className="w-20 h-20 rounded-full bg-background flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-primary">{resultData.score}</span>
                      <span className="text-xs text-muted-foreground">/ {resultData.total}</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-lg px-3 py-1">
                      Band {resultData.bandScore}
                    </Badge>
                    <span className="text-2xl font-bold">{resultData.percentage}%</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 size={16} />
                      {resultData.questionResults.filter(r => r.isCorrect).length} correct
                    </span>
                    <span className="flex items-center gap-1 text-rose-600">
                      <XCircle size={16} />
                      {resultData.questionResults.filter(r => !r.isCorrect).length} incorrect
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant={showOnlyIncorrect ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowOnlyIncorrect(!showOnlyIncorrect)}
                  className="gap-2"
                >
                  <XCircle size={16} />
                  {showOnlyIncorrect ? 'Show All' : 'Show Incorrect Only'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          {/* Left Side - Question Review */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Question Review {showOnlyIncorrect && `(${displayedResults.length} incorrect)`}
              </h2>
              {testType === 'listening' && (
                <Badge variant="outline" className="gap-1">
                  <Volume2 size={12} />
                  Listening Test
                </Badge>
              )}
            </div>

            <div className="space-y-4">
              {displayedResults.map((result) => (
                <Card 
                  key={result.questionNumber}
                  className={cn(
                    "transition-all duration-200 border-l-4 overflow-hidden",
                    result.isCorrect 
                      ? "border-l-emerald-500 bg-emerald-500/5" 
                      : "border-l-rose-500 bg-rose-500/5"
                  )}
                >
                  <CardContent className="p-4 space-y-4">
                    {/* Question Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "font-mono shrink-0",
                            result.isCorrect ? "border-emerald-500 text-emerald-600" : "border-rose-500 text-rose-600"
                          )}
                        >
                          Q{result.questionNumber}
                        </Badge>
                        <div className="flex-1">
                          <p className="text-sm font-medium leading-relaxed">
                            {result.questionText}
                          </p>
                          {result.questionType && (
                            <Badge variant="secondary" className="mt-2 text-xs">
                              {result.questionType.replace(/_/g, ' ').toLowerCase()}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {result.isCorrect ? (
                        <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle size={20} className="text-rose-500 shrink-0" />
                      )}
                    </div>

                    {/* Answers - Always Visible */}
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className={cn(
                        "p-3 rounded-lg border",
                        result.isCorrect 
                          ? "bg-emerald-500/10 border-emerald-500/20" 
                          : "bg-rose-500/10 border-rose-500/20"
                      )}>
                        <p className="text-xs text-muted-foreground mb-1">Your Answer</p>
                        <p className={cn(
                          "font-semibold",
                          result.isCorrect ? "text-emerald-600" : "text-rose-600"
                        )}>
                          {result.userAnswer || '(No answer)'}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs text-muted-foreground">Correct Answer(s)</p>
                          {result.correctAnswer.includes('/') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info size={12} className="text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-xs">Multiple answers are accepted. Any of these variations will be marked correct.</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        {(() => {
                          const { primary, alternatives } = formatCorrectAnswer(result.correctAnswer);
                          return (
                            <div>
                              <p className="font-semibold text-emerald-600">{primary}</p>
                              {alternatives.length > 0 && (
                                <div className="mt-1.5 pt-1.5 border-t border-emerald-500/20">
                                  <p className="text-xs text-muted-foreground mb-1">Also accepted:</p>
                                  <div className="flex flex-wrap gap-1">
                                    {alternatives.map((alt, idx) => (
                                      <Badge 
                                        key={idx} 
                                        variant="outline" 
                                        className="text-xs bg-emerald-500/5 border-emerald-500/30 text-emerald-700"
                                      >
                                        {alt}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* AI Explanation - Always Visible */}
                    <div className="pt-2 border-t border-border/50">
                      {explanations[result.questionNumber] ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Sparkles size={16} className="text-primary" />
                              <span className="text-sm font-medium">AI Explanation</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reportIssue(result)}
                              className="gap-1 text-xs text-muted-foreground hover:text-amber-600 h-7"
                            >
                              <Flag size={12} />
                              Report
                            </Button>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            {explanations[result.questionNumber]}
                          </p>
                          {explanations[result.questionNumber].includes('Unable to generate') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setExplanations(prev => {
                                  const next = { ...prev };
                                  delete next[result.questionNumber];
                                  return next;
                                });
                                fetchExplanation(result);
                              }}
                              className="gap-2"
                            >
                              <RotateCcw size={14} />
                              Retry
                            </Button>
                          )}
                        </div>
                      ) : loadingExplanations.has(result.questionNumber) ? (
                        <div className="flex items-center gap-3 py-2">
                          <Loader2 size={16} className="animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground">Generating AI explanation...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchExplanation(result)}
                            className="gap-2"
                          >
                            <Sparkles size={14} />
                            Get AI Explanation
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => reportIssue(result)}
                            className="gap-1 text-muted-foreground hover:text-amber-600"
                          >
                            <Flag size={14} />
                            Report Issue
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Transcript Viewer for Listening Tests */}
            {testType === 'listening' && (transcripts.part1 || transcripts.part2 || transcripts.part3 || transcripts.part4) && (
              <TranscriptViewer transcripts={transcripts} className="mt-6" />
            )}
          </div>

          {/* Right Side - Top Scorers */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="text-amber-500" size={18} />
                  Top Scorers
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {topScorers.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {topScorers.map((scorer, index) => (
                        <div
                          key={scorer.id}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-lg transition-colors text-sm",
                            index === 0 && "bg-amber-500/10 border border-amber-500/20",
                            index === 1 && "bg-slate-400/10",
                            index === 2 && "bg-orange-600/10",
                            index > 2 && "bg-muted/30"
                          )}>
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
                            index === 0 && "bg-amber-500 text-white",
                            index === 1 && "bg-slate-400 text-white",
                            index === 2 && "bg-orange-600 text-white",
                            index > 2 && "bg-muted text-muted-foreground"
                          )}>
                            {index < 3 ? <Medal size={12} /> : index + 1}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{scorer.full_name}</p>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="font-bold text-sm">{scorer.score}/{scorer.total}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8">
                    <Trophy className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No scores yet. Be the first!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
