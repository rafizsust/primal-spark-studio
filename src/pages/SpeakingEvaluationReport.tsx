import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Star, Mic, MessageSquareText, Lightbulb, CheckCircle2, History, AlertCircle, PlayCircle, FileText, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Tables } from '@/integrations/supabase/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { renderRichText } from '@/components/admin/RichTextEditor';
import { AddToFlashcardButton } from '@/components/common/AddToFlashcardButton';


type SpeakingTest = Tables<'speaking_tests'>;
type SpeakingSubmission = Tables<'speaking_submissions'>;
// Extend SpeakingQuestionGroup to include the joined speaking_questions
interface SpeakingQuestionGroupWithQuestions extends Tables<'speaking_question_groups'> {
  speaking_questions: Array<Tables<'speaking_questions'>>;
}
type SpeakingQuestion = Tables<'speaking_questions'>; // Added for question context

// New interfaces to accurately reflect the AI's nested JSON structure
interface CriterionEvaluation {
  band: number;
  strengths: string;
  weaknesses: string;
  suggestions_for_improvement: string;
}

interface EvaluationReport {
  fluency_coherence: CriterionEvaluation;
  lexical_resource: CriterionEvaluation;
  grammatical_range_accuracy: CriterionEvaluation;
  pronunciation: CriterionEvaluation;
  part_by_part_analysis: {
    part1: {
      summary: string;
      strengths: string;
      weaknesses: string;
    };
    part2: {
      topic_coverage: string;
      organization_quality: string;
      cue_card_fulfillment: string;
    };
    part3: {
      depth_of_discussion: string;
      question_notes: string;
    };
  };
  improvement_recommendations: string[];
  strengths_to_maintain: string[];
  examiner_notes?: string;
  raw_response?: string;
  parse_error?: string;
  transcripts?: Record<string, string>; // NEW: Transcripts field
}

// Helper function to round to nearest 0.5
const roundToHalf = (num: number): number => {
  return Math.round(num * 2) / 2;
};

export default function SpeakingEvaluationReport() {
  const { testId, submissionId: urlSubmissionId } = useParams<{ testId: string; submissionId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [speakingTest, setSpeakingTest] = useState<SpeakingTest | null>(null);
  const [questionGroups, setQuestionGroups] = useState<SpeakingQuestionGroupWithQuestions[]>([]); // Use new interface
  const [allQuestions, setAllQuestions] = useState<SpeakingQuestion[]>([]); // Store all questions for context
  const [allSubmissions, setAllSubmissions] = useState<SpeakingSubmission[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(urlSubmissionId || null);
  const [currentSubmission, setCurrentSubmission] = useState<SpeakingSubmission | null>(null);

  useEffect(() => {
    if (testId && user) {
      fetchEvaluationData();
    } else if (!user) {
      toast.error('You must be logged in to view evaluation reports.');
      navigate('/auth');
    }
  }, [testId, user, navigate]); // Removed selectedSubmissionId to prevent refetch on tab switch

  // Update current submission when selectedSubmissionId changes (without refetching)
  useEffect(() => {
    if (selectedSubmissionId && allSubmissions.length > 0) {
      const submission = allSubmissions.find(s => s.id === selectedSubmissionId);
      if (submission) {
        setCurrentSubmission(submission);
      }
    }
  }, [selectedSubmissionId, allSubmissions]);

  const fetchEvaluationData = async () => {
    setLoading(true);
    try {
      // Fetch SpeakingTest
      const { data: testData, error: testError } = await supabase
        .from('speaking_tests')
        .select('*')
        .eq('id', testId!)
        .single();

      if (testError) throw testError;
      setSpeakingTest(testData);

      // Fetch question groups and questions for context
      const { data: groupsData, error: groupsError } = await supabase
        .from('speaking_question_groups')
        .select('*, speaking_questions(*)')
        .eq('test_id', testId!)
        .order('part_number')
        .order('order_index', { foreignTable: 'speaking_questions' });

      if (groupsError) throw groupsError;
      setQuestionGroups(groupsData || []);
      setAllQuestions(groupsData?.flatMap(g => g.speaking_questions || []) || []);

      // Fetch ALL user's submissions for this test
      if (user) {
        const { data: submissions, error: submissionsError } = await supabase
          .from('speaking_submissions')
          .select('*')
          .eq('user_id', user.id)
          .eq('test_id', testId!)
          .order('submitted_at', { ascending: false });

        if (submissionsError) throw submissionsError;
        
        setAllSubmissions(submissions || []);

        let submissionToDisplay: SpeakingSubmission | null = null;
        if (urlSubmissionId) {
          submissionToDisplay = submissions?.find(s => s.id === urlSubmissionId) || null;
        } else if (submissions && submissions.length > 0) {
          submissionToDisplay = submissions[0];
          setSelectedSubmissionId(submissions[0].id);
        }
        setCurrentSubmission(submissionToDisplay);

        if (!submissionToDisplay) {
          toast.info('No submissions found for this test.');
        }
      }

    } catch (error: any) {
      console.error('Error fetching evaluation data:', error);
      toast.error(`Failed to load evaluation report: ${error.message}`);
      navigate('/speaking/cambridge-ielts-a');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmissionSelect = (submissionId: string) => {
    setSelectedSubmissionId(submissionId);
    navigate(`/speaking/evaluation/${testId}/${submissionId}`);
  };

  const evaluationReport = currentSubmission?.evaluation_report as unknown as EvaluationReport | null;
  const overallBand = currentSubmission?.overall_band;

  // Helper to get question text by ID
  const getQuestionTextById = (questionId: string) => {
    const question = allQuestions.find(q => q.id === questionId);
    return question?.question_text || 'Unknown Question';
  };

  const renderCriterion = (title: string, criterion: CriterionEvaluation) => (
    <div className="space-y-3 border-b border-border/50 pb-4 last:border-b-0 last:pb-0">
      <h4 className="font-medium text-foreground flex items-center gap-2">
        <Badge variant="outline" className="text-sm px-2 py-0.5">Band: {criterion.band}</Badge>
        {title}
      </h4>
      <div className="ml-4 space-y-3">
        <div>
          <p className="font-medium text-sm text-foreground flex items-center gap-1 mb-1">
            <CheckCircle2 size={16} className="text-success" />
            Strengths:
          </p>
          <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(criterion.strengths) }} />
        </div>
        <div>
          <p className="font-medium text-sm text-foreground flex items-center gap-1 mb-1">
            <AlertCircle size={16} className="text-destructive" />
            Weaknesses:
          </p>
          <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(criterion.weaknesses) }} />
        </div>
        <div>
          <p className="font-medium text-sm text-foreground flex items-center gap-1 mb-1">
            <Lightbulb size={16} className="text-primary" />
            Suggestions for Improvement:
          </p>
          <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(criterion.suggestions_for_improvement) }} />
        </div>
      </div>
    </div>
  );

  const renderFlashcardImport = () => (
    <div className="pt-4 border-t border-border/50 flex items-center gap-3">
      <BookOpen size={18} className="text-primary" />
      <span className="text-sm text-muted-foreground">Save key vocabulary from this feedback:</span>
      <AddToFlashcardButton 
        word=""
        meaning=""
        example=""
        variant="button"
      />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/speaking/cambridge-ielts-a')}>
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h1 className="text-2xl font-bold font-heading">
              Speaking Evaluation: {speakingTest?.name}
            </h1>
            <p className="text-muted-foreground">Review your AI-generated feedback</p>
          </div>
        </div>
        {overallBand != null && (
          <Badge className="bg-primary text-primary-foreground text-lg px-4 py-2">
            Overall Band: {overallBand.toFixed(1)}
          </Badge>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {allSubmissions.length > 1 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                  <History size={20} />
                  Submission History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedSubmissionId || ''} onValueChange={handleSubmissionSelect}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a past submission" />
                  </SelectTrigger>
                  <SelectContent>
                    {allSubmissions.map((sub, index) => {
                      const averageBandForAttempt = sub.overall_band !== null && sub.overall_band !== undefined
                        ? roundToHalf(sub.overall_band)
                        : null;

                      return (
                        <SelectItem 
                          key={sub.id} 
                          value={sub.id}
                        >
                          Attempt {allSubmissions.length - index} - {new Date(sub.submitted_at!).toLocaleString()}
                          {averageBandForAttempt != null && (
                            <span className="ml-2 text-muted-foreground">
                              (Band {averageBandForAttempt.toFixed(1)})
                            </span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading evaluation...</div>
          ) : !currentSubmission ? (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-200">
              <AlertCircle size={20} className="inline-block mr-2" />
              No submission selected or found for this test.
            </div>
          ) : (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                  <Mic size={20} />
                  Your Speaking Submission
                </CardTitle>
                <p className="text-sm text-muted-foreground">Submitted: {new Date(currentSubmission.submitted_at!).toLocaleString()}</p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Render audio and transcript for each part/question */}
                {questionGroups.map((group: SpeakingQuestionGroupWithQuestions) => ( // Use new interface here
                  <div key={group.id} className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <PlayCircle size={18} className="text-primary" />
                      Part {group.part_number} Audio & Transcript
                    </h3>
                    {group.part_number === 2 ? (
                      // Part 2 has one logical question (the cue card itself)
                      (() => {
                        const part2Question = allQuestions.find(q => q.group_id === group.id);
                        const audioKey = part2Question ? `part${group.part_number}-q${part2Question.id}` : null;
                        const audioUrl = currentSubmission[`audio_url_part${group.part_number}` as keyof SpeakingSubmission];
                        const transcript = evaluationReport?.transcripts?.[audioKey || ''];

                        return (
                          <div className="space-y-2">
                            {audioUrl && <audio controls src={audioUrl as string} className="w-full" />}
                            {transcript && (
                              <div className="bg-muted/30 p-4 rounded-md border text-foreground">
                                <h4 className="font-medium text-sm flex items-center gap-1 mb-2">
                                  <FileText size={16} className="text-primary" />
                                  Transcript:
                                </h4>
                                <p className="whitespace-pre-wrap text-sm">{transcript}</p>
                              </div>
                            )}
                            {!audioUrl && !transcript && (
                              <p className="text-muted-foreground text-sm italic">No audio or transcript available for this part.</p>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      // Parts 1 and 3 have multiple questions
                      group.speaking_questions?.map(question => {
                        const audioKey = `part${group.part_number}-q${question.id}`;
                        // Audio URL is for whole part, not granular per question
                        const transcript = evaluationReport?.transcripts?.[audioKey];

                        // For now, we'll display audio for the whole part if available, and individual transcripts
                        // If audio was recorded per question, the audioUrl would need to be stored per question.
                        // Given the current submission structure, audio_url_partX is for the whole part.
                        // We'll display the transcript per question if available.
                        return (
                          <div key={question.id} className="space-y-2 pl-4 border-l border-border/50">
                            <h4 className="font-medium text-sm flex items-center gap-1">
                              Question {question.question_number}: {getQuestionTextById(question.id!)}
                            </h4>
                            {transcript && (
                              <div className="bg-muted/30 p-4 rounded-md border text-foreground">
                                <h5 className="font-medium text-xs flex items-center gap-1 mb-1">
                                  <FileText size={14} className="text-primary" />
                                  Your Transcript:
                                </h5>
                                <p className="whitespace-pre-wrap text-sm">{transcript}</p>
                              </div>
                            )}
                            {!transcript && (
                              <p className="text-muted-foreground text-xs italic">No transcript available for this question.</p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}


                {evaluationReport ? (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Star size={18} className="text-gold" />
                      AI Evaluation Report
                    </h3>
                    {evaluationReport.parse_error && (
                      <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md p-3 text-sm">
                        <p className="font-semibold">Error parsing AI response:</p>
                        <p>{evaluationReport.parse_error}</p>
                        <p className="mt-2 font-semibold">Raw AI Response:</p>
                        <pre className="whitespace-pre-wrap text-xs bg-destructive/5 p-2 rounded-sm">{evaluationReport.raw_response}</pre>
                      </div>
                    )}
                    {/* Criteria Evaluation */}
                    {evaluationReport.fluency_coherence && renderCriterion('Fluency & Coherence', evaluationReport.fluency_coherence)}
                    {evaluationReport.lexical_resource && renderCriterion('Lexical Resource', evaluationReport.lexical_resource)}
                    {evaluationReport.grammatical_range_accuracy && renderCriterion('Grammatical Range & Accuracy', evaluationReport.grammatical_range_accuracy)}
                    {evaluationReport.pronunciation && renderCriterion('Pronunciation', evaluationReport.pronunciation)}

                    {/* Part-by-Part Analysis */}
                    {evaluationReport.part_by_part_analysis && (
                      <div className="space-y-4 pt-4 border-t border-border/50">
                        <h4 className="font-medium text-foreground flex items-center gap-1">
                          <MessageSquareText size={16} className="text-primary" />
                          Part-by-Part Analysis
                        </h4>
                        <div className="ml-4 space-y-3">
                          {evaluationReport.part_by_part_analysis.part1 && (
                            <div>
                              <p className="font-semibold text-sm">Part 1: Introduction & Interview</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part1.summary) }} />
                              <p className="font-medium text-sm mt-2">Strengths:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part1.strengths) }} />
                              <p className="font-medium text-sm mt-2">Weaknesses:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part1.weaknesses) }} />
                            </div>
                          )}
                          {evaluationReport.part_by_part_analysis.part2 && (
                            <div className="mt-4">
                              <p className="font-semibold text-sm">Part 2: Individual Long Turn</p>
                              <p className="font-medium text-sm mt-2">Topic Coverage:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part2.topic_coverage) }} />
                              <p className="font-medium text-sm mt-2">Organization Quality:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part2.organization_quality) }} />
                              <p className="font-medium text-sm mt-2">Cue Card Fulfillment:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part2.cue_card_fulfillment) }} />
                            </div>
                          )}
                          {evaluationReport.part_by_part_analysis.part3 && (
                            <div className="mt-4">
                              <p className="font-semibold text-sm">Part 3: Two-way Discussion</p>
                              <p className="font-medium text-sm mt-2">Depth of Discussion:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part3.depth_of_discussion) }} />
                              <p className="font-medium text-sm mt-2">Question Notes:</p>
                              <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.part_by_part_analysis.part3.question_notes) }} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Improvement Recommendations */}
                    {evaluationReport.improvement_recommendations && evaluationReport.improvement_recommendations.length > 0 && (
                      <div className="space-y-1 pt-4 border-t border-border/50">
                        <h4 className="font-medium text-foreground flex items-center gap-1">
                          <Lightbulb size={16} className="text-primary" />
                          Improvement Recommendations
                        </h4>
                        <ul className="list-disc ml-6 space-y-1 text-muted-foreground">
                          {evaluationReport.improvement_recommendations.map((tip, idx) => (
                            <li key={idx} dangerouslySetInnerHTML={{ __html: renderRichText(tip) }} />
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Strengths to Maintain */}
                    {evaluationReport.strengths_to_maintain && evaluationReport.strengths_to_maintain.length > 0 && (
                      <div className="space-y-1 pt-4 border-t border-border/50">
                        <h4 className="font-medium text-foreground flex items-center gap-1">
                          <CheckCircle2 size={16} className="text-success" />
                          Strengths to Maintain
                        </h4>
                        <ul className="list-disc ml-6 space-y-1 text-muted-foreground">
                          {evaluationReport.strengths_to_maintain.map((strength, idx) => (
                            <li key={idx} dangerouslySetInnerHTML={{ __html: renderRichText(strength) }} />
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Examiner Notes */}
                    {evaluationReport.examiner_notes && (
                      <div className="space-y-1 pt-4 border-t border-border/50">
                        <h4 className="font-medium text-foreground flex items-center gap-1">
                          <AlertCircle size={16} className="text-muted-foreground" />
                          Examiner Notes
                        </h4>
                        <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.examiner_notes) }} />
                      </div>
                    )}

                    {/* Flashcard Import */}
                    {renderFlashcardImport()}

                    {/* Model Answers Section */}
                    {overallBand !== null && overallBand !== undefined && overallBand < 9 && (
                      <div className="space-y-4 pt-6 border-t-2 border-primary/30 mt-6">
                        <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                          <Star size={20} className="text-primary" />
                          Model Answers (Band {Math.min(Math.ceil(overallBand ?? 0) + 1, 9).toFixed(0)})
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Here are example answers that would achieve a higher band score. Study these to understand what examiners are looking for.
                        </p>
                        
                        {questionGroups.map((group: SpeakingQuestionGroupWithQuestions) => (
                          <Card key={group.id} className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg flex items-center gap-2">
                                <Badge variant="outline">Part {group.part_number}</Badge>
                                {group.part_number === 1 ? 'Introduction & Interview' : 
                                 group.part_number === 2 ? 'Individual Long Turn' : 'Two-way Discussion'}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {group.part_number === 2 ? (
                                <div className="space-y-2">
                                  <p className="font-medium text-sm text-foreground">Cue Card Topic:</p>
                                  <p className="text-sm text-muted-foreground italic">{group.cue_card_topic || 'Not specified'}</p>
                                  <p className="font-medium text-sm text-foreground mt-3">Model Answer:</p>
                                  <div className="bg-card p-4 rounded-lg border text-sm text-foreground">
                                    <p>I'd like to talk about [topic from cue card]. This is something that has been quite significant in my life because [reason].</p>
                                    <p className="mt-2">First of all, let me describe [first point]. What makes this particularly interesting is [elaboration with specific details and examples].</p>
                                    <p className="mt-2">Moving on to [second point], I would say that [detailed explanation]. For instance, [specific example that demonstrates your point].</p>
                                    <p className="mt-2">Finally, regarding [third point], I believe [your thoughts with reasoning]. This has impacted me in several ways, including [personal reflection].</p>
                                    <p className="mt-2">In conclusion, [brief summary and final thought about the topic].</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {group.speaking_questions?.slice(0, 2).map((question, idx) => (
                                    <div key={question.id} className="space-y-2">
                                      <p className="font-medium text-sm text-foreground">Q{idx + 1}: {question.question_text}</p>
                                      <div className="bg-card p-3 rounded-lg border text-sm text-foreground">
                                        {group.part_number === 1 ? (
                                          <p>Well, that's an interesting question. I would say that [direct answer]. The main reason for this is [explanation]. For example, [specific personal example]. Additionally, I think [further elaboration with varied vocabulary].</p>
                                        ) : (
                                          <p>That's a thought-provoking question. In my opinion, [your stance on the topic]. There are several factors to consider here. Firstly, [main argument with supporting evidence]. Furthermore, [second point with examples]. However, it's also worth noting that [balanced perspective or counter-argument]. Overall, I believe [conclusion with nuanced view].</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-200">
                    <Lightbulb size={20} className="inline-block mr-2" />
                    AI evaluation is not yet available for this submission. It might still be processing or an error occurred.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}