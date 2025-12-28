import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Mic,
  RotateCcw,
  Home,
  ChevronDown,
  ChevronUp,
  Sparkles,
  TrendingUp,
  ArrowUpRight,
  MessageSquare,
  Target,
  Loader2,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CriterionScore {
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

interface LexicalUpgrade {
  original: string;
  upgraded: string;
  context: string;
}

interface PartAnalysis {
  part_number: number;
  performance_notes: string;
  key_moments: string[];
  areas_for_improvement: string[];
}

interface ModelAnswer {
  partNumber: number;
  question: string;
  candidateResponse?: string;
  modelAnswer: string;
  keyFeatures: string[];
}

interface EvaluationReport {
  overall_band: number;
  overallBand?: number;
  fluency_coherence: CriterionScore;
  fluencyCoherence?: CriterionScore;
  lexical_resource: CriterionScore;
  lexicalResource?: { score: number; feedback: string; examples: string[]; lexicalUpgrades?: LexicalUpgrade[] };
  grammatical_range: CriterionScore;
  grammaticalRange?: CriterionScore;
  pronunciation: CriterionScore;
  lexical_upgrades: LexicalUpgrade[];
  part_analysis: PartAnalysis[];
  partAnalysis?: Array<{ partNumber: number; strengths: string[]; improvements: string[] }>;
  improvement_priorities: string[];
  priorityImprovements?: string[];
  strengths_to_maintain: string[];
  keyStrengths?: string[];
  examiner_notes: string;
  summary?: string;
  modelAnswers?: ModelAnswer[];
}

interface SpeakingResult {
  id: string;
  test_id: string;
  overall_band: number;
  evaluation_report: EvaluationReport | null;
  audio_urls: Record<string, string>;
  created_at: string;
}

export default function AISpeakingResults() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [result, setResult] = useState<SpeakingResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set([1, 2, 3]));

  useEffect(() => {
    if (!testId) {
      navigate('/ai-practice');
      return;
    }

    if (authLoading) return;

    if (!user) {
      toast.error('Please sign in to view your results');
      navigate('/ai-practice');
      return;
    }

    const loadResults = async () => {
      // Try to find the result in ai_practice_results
      const { data, error } = await supabase
        .from('ai_practice_results')
        .select('*')
        .eq('test_id', testId)
        .eq('user_id', user.id)
        .eq('module', 'speaking')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Failed to load speaking results:', error);
        toast.error('Failed to load results');
        navigate('/ai-practice');
        return;
      }

      if (!data) {
        // Results might still be processing
        toast.info('Results are still being processed. Please wait...');
        setTimeout(loadResults, 3000);
        return;
      }

      const report = data.question_results as unknown as EvaluationReport;
      
      setResult({
        id: data.id,
        test_id: data.test_id,
        overall_band: data.band_score || 0,
        evaluation_report: report,
        audio_urls: (data.answers as Record<string, string>) || {},
        created_at: data.completed_at,
      });
      setLoading(false);
    };

    loadResults();
  }, [testId, navigate, user, authLoading]);

  const togglePart = (partNum: number) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      if (next.has(partNum)) {
        next.delete(partNum);
      } else {
        next.add(partNum);
      }
      return next;
    });
  };

  const getBandColor = (band: number) => {
    if (band >= 7) return 'text-success';
    if (band >= 6) return 'text-warning';
    return 'text-destructive';
  };

  const getBandBg = (band: number) => {
    if (band >= 7) return 'bg-success/20 border-success/30';
    if (band >= 6) return 'bg-warning/20 border-warning/30';
    return 'bg-destructive/20 border-destructive/30';
  };

  if (loading || !result) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading your speaking evaluation...</p>
          </div>
        </main>
      </div>
    );
  }

  const report = result.evaluation_report;

  if (!report) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <Card className="max-w-md">
            <CardContent className="py-8 text-center">
              <AlertCircle className="w-12 h-12 text-warning mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">Evaluation In Progress</h2>
              <p className="text-muted-foreground mb-4">
                Your speaking test is still being evaluated. Please check back in a few moments.
              </p>
              <Button onClick={() => window.location.reload()}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const criteria = [
    { key: 'fluency_coherence', label: 'Fluency & Coherence', data: report.fluency_coherence },
    { key: 'lexical_resource', label: 'Lexical Resource', data: report.lexical_resource },
    { key: 'grammatical_range', label: 'Grammatical Range & Accuracy', data: report.grammatical_range },
    { key: 'pronunciation', label: 'Pronunciation', data: report.pronunciation },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 py-8">
        <div className="container max-w-5xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-4">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">AI Speaking Evaluation</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mb-2">
              Speaking Test Results
            </h1>
            <p className="text-muted-foreground">
              Comprehensive analysis based on official IELTS 2025 criteria
            </p>
          </div>

          {/* Overall Band Score */}
          <Card className="mb-6 overflow-hidden">
            <div className="bg-gradient-to-br from-primary/10 to-accent/10 p-8">
              <div className="text-center">
                <Badge className={cn("text-5xl md:text-6xl font-bold px-8 py-4 mb-4", getBandBg(report.overall_band))}>
                  {report.overall_band.toFixed(1)}
                </Badge>
                <p className="text-lg text-muted-foreground">Overall Band Score</p>
              </div>
              
              {/* Criteria Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
                {criteria.map(({ label, data }) => (
                  <div key={label} className="text-center">
                    <div className={cn("text-2xl font-bold mb-1", getBandColor(data?.score || 0))}>
                      {data?.score?.toFixed(1) || 'N/A'}
                    </div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Tabs defaultValue="criteria" className="mb-6">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="criteria">Criteria</TabsTrigger>
              <TabsTrigger value="model">Model Answers</TabsTrigger>
              <TabsTrigger value="lexical">Lexical</TabsTrigger>
              <TabsTrigger value="parts">Parts</TabsTrigger>
              <TabsTrigger value="improve">Improve</TabsTrigger>
            </TabsList>

            {/* Criteria Breakdown */}
            <TabsContent value="criteria" className="mt-6 space-y-4">
              {criteria.map(({ key, label, data }) => (
                <Card key={key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{label}</CardTitle>
                      <Badge className={cn("text-lg font-bold px-3", getBandBg(data?.score || 0))}>
                        {data?.score?.toFixed(1) || 'N/A'}
                      </Badge>
                    </div>
                    <Progress 
                      value={(data?.score || 0) / 9 * 100} 
                      className="h-2 mt-2"
                    />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Strengths */}
                    {data?.strengths && data.strengths.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-success mb-2">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="font-medium text-sm">Strengths</span>
                        </div>
                        <ul className="space-y-1 pl-6">
                          {data.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Weaknesses */}
                    {data?.weaknesses && data.weaknesses.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-destructive mb-2">
                          <AlertCircle className="w-4 h-4" />
                          <span className="font-medium text-sm">Areas to Improve</span>
                        </div>
                        <ul className="space-y-1 pl-6">
                          {data.weaknesses.map((w, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Suggestions */}
                    {data?.suggestions && data.suggestions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-primary mb-2">
                          <Lightbulb className="w-4 h-4" />
                          <span className="font-medium text-sm">Suggestions</span>
                        </div>
                        <ul className="space-y-1 pl-6">
                          {data.suggestions.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground list-disc">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* Model Answers */}
            <TabsContent value="model" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Band 8+ Model Answers
                  </CardTitle>
                  <CardDescription>
                    Learn from example responses that demonstrate high-scoring techniques
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {report.modelAnswers && report.modelAnswers.length > 0 ? (
                    report.modelAnswers.map((model, i) => (
                      <div key={i} className="border rounded-lg p-4 space-y-4">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Part {model.partNumber}</Badge>
                          <span className="text-sm font-medium">{model.question}</span>
                        </div>

                        {model.candidateResponse && (
                          <div className="pl-4 border-l-2 border-muted">
                            <p className="text-xs text-muted-foreground mb-1">Your response:</p>
                            <p className="text-sm italic text-muted-foreground">{model.candidateResponse}</p>
                          </div>
                        )}

                        <div className="pl-4 border-l-2 border-success">
                          <p className="text-xs text-success mb-1 font-medium">Band 8+ Model Answer:</p>
                          <p className="text-sm">{model.modelAnswer}</p>
                        </div>

                        {model.keyFeatures && model.keyFeatures.length > 0 && (
                          <div className="bg-primary/5 rounded-lg p-3">
                            <p className="text-xs font-medium text-primary mb-2 flex items-center gap-1">
                              <Lightbulb className="w-3 h-3" />
                              Why this works:
                            </p>
                            <ul className="space-y-1">
                              {model.keyFeatures.map((feature, j) => (
                                <li key={j} className="text-xs text-muted-foreground flex items-start gap-2">
                                  <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0 mt-0.5" />
                                  {feature}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      Model answers will appear here after your test is fully evaluated.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Lexical Upgrades Table */}
            <TabsContent value="lexical" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5 text-primary" />
                    Lexical Upgrade Suggestions
                  </CardTitle>
                  <CardDescription>
                    Replace common words with Band 8+ alternatives
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.lexical_upgrades && report.lexical_upgrades.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-2 font-medium">Original Word</th>
                            <th className="text-left py-3 px-2 font-medium">Band 8+ Alternative</th>
                            <th className="text-left py-3 px-2 font-medium">Context</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.lexical_upgrades.map((upgrade, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-3 px-2">
                                <Badge variant="outline" className="bg-destructive/10 text-destructive">
                                  {upgrade.original}
                                </Badge>
                              </td>
                              <td className="py-3 px-2">
                                <Badge variant="outline" className="bg-success/10 text-success">
                                  {upgrade.upgraded}
                                </Badge>
                              </td>
                              <td className="py-3 px-2 text-muted-foreground italic">
                                "{upgrade.context}"
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No lexical upgrades suggested - great vocabulary usage!
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Part-by-Part Analysis */}
            <TabsContent value="parts" className="mt-6 space-y-4">
              {report.part_analysis && report.part_analysis.map((part) => (
                <Card key={part.part_number}>
                  <CardHeader 
                    className="cursor-pointer"
                    onClick={() => togglePart(part.part_number)}
                  >
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Mic className="w-5 h-5 text-primary" />
                        Part {part.part_number}
                      </CardTitle>
                      {expandedParts.has(part.part_number) ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                  {expandedParts.has(part.part_number) && (
                    <CardContent className="space-y-4">
                      <p className="text-sm">{part.performance_notes}</p>
                      
                      {part.key_moments && part.key_moments.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Target className="w-4 h-4 text-primary" />
                            <span className="font-medium text-sm">Key Moments</span>
                          </div>
                          <ul className="space-y-1 pl-6">
                            {part.key_moments.map((m, i) => (
                              <li key={i} className="text-sm text-muted-foreground list-disc">{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {part.areas_for_improvement && part.areas_for_improvement.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-warning" />
                            <span className="font-medium text-sm">Areas for Improvement</span>
                          </div>
                          <ul className="space-y-1 pl-6">
                            {part.areas_for_improvement.map((a, i) => (
                              <li key={i} className="text-sm text-muted-foreground list-disc">{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Audio Playback if available */}
                      {result.audio_urls[`part${part.part_number}`] && (
                        <div className="pt-4 border-t">
                          <div className="flex items-center gap-2 mb-2">
                            <Volume2 className="w-4 h-4" />
                            <span className="font-medium text-sm">Your Recording</span>
                          </div>
                          <audio 
                            controls 
                            className="w-full" 
                            src={result.audio_urls[`part${part.part_number}`]} 
                          />
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              ))}
            </TabsContent>

            {/* Improvement Priorities */}
            <TabsContent value="improve" className="mt-6 space-y-4">
              {/* Priorities */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-warning" />
                    Improvement Priorities
                  </CardTitle>
                  <CardDescription>Focus on these areas to boost your band score</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.improvement_priorities && report.improvement_priorities.length > 0 ? (
                    <ol className="space-y-3">
                      {report.improvement_priorities.map((priority, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-warning/20 text-warning text-sm font-bold flex items-center justify-center">
                            {i + 1}
                          </span>
                          <span className="text-sm">{priority}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-muted-foreground">No specific improvement priorities identified.</p>
                  )}
                </CardContent>
              </Card>

              {/* Strengths to Maintain */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-success" />
                    Strengths to Maintain
                  </CardTitle>
                  <CardDescription>Keep doing these well!</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.strengths_to_maintain && report.strengths_to_maintain.length > 0 ? (
                    <ul className="space-y-2">
                      {report.strengths_to_maintain.map((strength, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                          <span>{strength}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Keep practicing to develop more strengths!</p>
                  )}
                </CardContent>
              </Card>

              {/* Examiner Notes */}
              {report.examiner_notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-primary" />
                      Examiner Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm italic text-muted-foreground">
                      "{report.examiner_notes}"
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <Button variant="outline" asChild>
              <Link to="/ai-practice">
                <Home className="w-4 h-4 mr-2" />
                Back to AI Practice
              </Link>
            </Button>
            {report.modelAnswers && report.modelAnswers.length > 0 && (
              <Button 
                variant="secondary"
                onClick={() => {
                  // Store practice data for re-attempt
                  const practiceData = {
                    testId: result.test_id,
                    modelAnswers: report.modelAnswers,
                    topic: report.examiner_notes || 'Speaking Practice'
                  };
                  sessionStorage.setItem('speaking_practice_mode', JSON.stringify(practiceData));
                  navigate(`/ai-practice/speaking/${result.test_id}?mode=practice`);
                }}
              >
                <Play className="w-4 h-4 mr-2" />
                Practice These Questions
              </Button>
            )}
            <Button asChild>
              <Link to="/ai-practice">
                <RotateCcw className="w-4 h-4 mr-2" />
                New Test
              </Link>
            </Button>
          </div>
        </div>
      </main>
      
      <Footer />
    </div>
  );
}
