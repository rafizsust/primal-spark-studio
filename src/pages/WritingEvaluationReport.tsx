import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Star, FileText, MessageSquareText, Lightbulb, CheckCircle2, History, AlertCircle, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Tables } from '@/integrations/supabase/types';
import { renderRichText } from '@/components/admin/RichTextEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AddToFlashcardButton } from '@/components/common/AddToFlashcardButton';


type WritingTest = Tables<'writing_tests'>;
type WritingTask = Tables<'writing_tasks'>;
type WritingSubmission = Tables<'writing_submissions'>;

// New interfaces to accurately reflect the AI's nested JSON structure
interface CriterionEvaluation {
  band: number;
  strengths: string;
  weaknesses: string;
  suggestions_for_improvement: string;
}

interface EvaluationReport {
  task_achievement_response: CriterionEvaluation;
  coherence_and_cohesion: CriterionEvaluation;
  lexical_resource: CriterionEvaluation;
  grammatical_range_and_accuracy: CriterionEvaluation;
  overall_suggestions: string; // This one is a direct string
  raw_response?: string;
  parse_error?: string;
}

// Helper function to round to nearest 0.5
const roundToHalf = (num: number): number => {
  return Math.round(num * 2) / 2;
};

export default function WritingEvaluationReport() {
  const { testId, submissionId: urlSubmissionId } = useParams<{ testId: string; submissionId?: string }>(); // Get optional submissionId
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [writingTest, setWritingTest] = useState<WritingTest | null>(null);
  const [task1, setTask1] = useState<WritingTask | null>(null);
  const [task2, setTask2] = useState<WritingTask | null>(null);
  const [allSubmissions, setAllSubmissions] = useState<WritingSubmission[]>([]); // All submissions for this test
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(urlSubmissionId || null); // Currently viewed submission ID
  const [currentSubmission1, setCurrentSubmission1] = useState<WritingSubmission | null>(null); // Submission for Task 1
  const [currentSubmission2, setCurrentSubmission2] = useState<WritingSubmission | null>(null); // Submission for Task 2

  useEffect(() => {
    if (testId && user) {
      fetchEvaluationData();
    } else if (!user) {
      toast.error('You must be logged in to view evaluation reports.');
      navigate('/auth');
    }
  }, [testId, user, navigate]); // Removed selectedSubmissionId to prevent refetch on tab switch

  const fetchEvaluationData = async () => {
    setLoading(true);
    try {
      // Fetch WritingTest
      const { data: testData, error: testError } = await supabase
        .from('writing_tests')
        .select('*')
        .eq('id', testId!)
        .single();

      if (testError) throw testError;
      setWritingTest(testData);
      console.log('Fetched WritingTest:', testData); // Log 1

      // Fetch associated WritingTasks
      const { data: tasksData, error: tasksError } = await supabase
        .from('writing_tasks')
        .select('*')
        .eq('writing_test_id', testId!)
        .order('task_type');

      if (tasksError) throw tasksError;

      const fetchedTask1 = tasksData?.find(t => t.task_type === 'task1') || null;
      const fetchedTask2 = tasksData?.find(t => t.task_type === 'task2') || null;
      setTask1(fetchedTask1);
      setTask2(fetchedTask2);
      console.log('Fetched Task 1:', fetchedTask1); // Log 2
      console.log('Fetched Task 2:', fetchedTask2); // Log 3

      // Fetch ALL user's submissions for these tasks
      if (user && fetchedTask1 && fetchedTask2) {
        const { data: submissions, error: submissionsError } = await supabase
          .from('writing_submissions')
          .select('*')
          .eq('user_id', user.id)
          .in('task_id', [fetchedTask1.id, fetchedTask2.id])
          .order('submitted_at', { ascending: false }); // Get latest submission first

        if (submissionsError) throw submissionsError;
        
        setAllSubmissions(submissions || []);
        console.log('All user submissions:', submissions); // Log 4

        // Determine which submission to display
        let submissionToDisplay1: WritingSubmission | null = null;
        let submissionToDisplay2: WritingSubmission | null = null;

        if (urlSubmissionId) {
          // If a specific submission ID is in the URL, find its corresponding task 1 and task 2 submissions
          const targetSubmission = submissions?.find(s => s.id === urlSubmissionId);
          if (targetSubmission) {
            // Find the submission for Task 1 that was submitted at the same time as targetSubmission
            submissionToDisplay1 = submissions?.find(s => 
              s.task_id === fetchedTask1.id && 
              s.submitted_at === targetSubmission.submitted_at
            ) || null;
            // Find the submission for Task 2 that was submitted at the same time as targetSubmission
            submissionToDisplay2 = submissions?.find(s => 
              s.task_id === fetchedTask2.id && 
              s.submitted_at === targetSubmission.submitted_at
            ) || null;
          }
        } else if (submissions && submissions.length > 0) {
          // Default to the latest pair of submissions if no specific ID is provided
          const latestSubmittedAt = submissions[0].submitted_at;
          submissionToDisplay1 = submissions.find(s => s.task_id === fetchedTask1.id && s.submitted_at === latestSubmittedAt) || null;
          submissionToDisplay2 = submissions.find(s => s.task_id === fetchedTask2.id && s.submitted_at === latestSubmittedAt) || null;
          setSelectedSubmissionId(submissionToDisplay1?.id || null); // Update selected ID to reflect the latest
        }

        setCurrentSubmission1(submissionToDisplay1);
        setCurrentSubmission2(submissionToDisplay2);
        console.log('Current Submission 1:', submissionToDisplay1); // Log 5
        console.log('Current Submission 2:', submissionToDisplay2); // Log 6

        if (!submissionToDisplay1 && !submissionToDisplay2) {
          toast.info('No submissions found for this test.');
        }
      }

    } catch (error: any) {
      console.error('Error fetching evaluation data:', error);
      toast.error(`Failed to load evaluation report: ${error.message}`);
      navigate('/writing/cambridge-ielts-a');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmissionSelect = (submissionId: string) => {
    setSelectedSubmissionId(submissionId);
    navigate(`/writing/evaluation/${testId}/${submissionId}`);
  };

  // Group submissions by their submitted_at timestamp to represent a single "test attempt"
  const groupedSubmissions = allSubmissions.reduce((acc, sub) => {
    const submittedAt = sub.submitted_at || 'unknown';
    if (!acc[submittedAt]) {
      acc[submittedAt] = [];
    }
    acc[submittedAt].push(sub);
    return acc;
  }, {} as Record<string, WritingSubmission[]>);

  // Sort attempts by date, newest first
  const sortedAttempts = Object.entries(groupedSubmissions).sort(([dateA], [dateB]) => {
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  // Calculate combined overall band score
  const combinedOverallBand = useMemo(() => {
    const scores: number[] = [];
    if (currentSubmission1?.overall_band !== null && currentSubmission1?.overall_band !== undefined) {
      scores.push(currentSubmission1.overall_band);
    }
    if (currentSubmission2?.overall_band !== null && currentSubmission2?.overall_band !== undefined) {
      scores.push(currentSubmission2.overall_band);
    }

    if (scores.length === 0) return null;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return roundToHalf(average);
  }, [currentSubmission1, currentSubmission2]);

  const renderEvaluationSection = (submission: WritingSubmission | null, task: WritingTask | null, taskNumber: 1 | 2) => {
    if (!submission || !task) {
      return (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Task {taskNumber} - No Submission</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">You have not submitted an answer for Task {taskNumber} in this attempt.</p>
            <Button onClick={() => navigate(`/writing/test/${testId}`)} className="mt-4">
              Go to Test
            </Button>
          </CardContent>
        </Card>
      );
    }

    const evaluationReport = submission.evaluation_report as unknown as EvaluationReport | null;
    const overallBand = submission.overall_band;
    console.log(`Rendering Task ${taskNumber}: Submission ID ${submission.id}, Evaluation Report:`, evaluationReport); // Log 7
    console.log(`Rendering Task ${taskNumber}: Overall Band:`, overallBand); // Log 8

    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <FileText size={20} />
            Task {taskNumber} Evaluation
            {overallBand && (
              <Badge className="ml-auto bg-primary text-primary-foreground text-base px-3 py-1">
                Band {overallBand.toFixed(1)}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">Submitted: {new Date(submission.submitted_at!).toLocaleString()}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquareText size={18} className="text-primary" />
              Your Submission
            </h3>
            <div className="bg-muted/30 p-4 rounded-md border text-foreground">
              <p className="whitespace-pre-wrap" style={{ fontSize: '14px' }}>{submission.submission_text}</p>
              <p className="text-sm text-muted-foreground mt-2">Word Count: {submission.word_count}</p>
              <p className="text-sm text-muted-foreground">Min. Word Limit: {task.word_limit_min}</p>
              {task.word_limit_max && <p className="text-sm text-muted-foreground">Max. Word Limit: {task.word_limit_max}</p>}
            </div>
          </div>

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
              {/* Iterate over the main criteria */}
              {Object.entries(evaluationReport).map(([key, value]) => {
                // Skip raw_response, parse_error, and overall_suggestions as they are handled separately
                if (key === 'raw_response' || key === 'parse_error' || key === 'overall_suggestions') return null;

                const title = key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
                const criterion = value as CriterionEvaluation; // Cast to CriterionEvaluation

                return (
                  <div key={key} className="space-y-3 border-b border-border/50 pb-4 last:border-b-0 last:pb-0"> {/* Added border and padding */}
                    <h4 className="font-medium text-foreground flex items-center gap-2">
                      <Badge variant="outline" className="text-sm px-2 py-0.5">Band: {criterion.band}</Badge>
                      {title}
                    </h4>
                    <div className="ml-4 space-y-3"> {/* Adjusted indentation and spacing */}
                      <div>
                        <p className="font-medium text-sm text-foreground flex items-center gap-1 mb-1">
                          <CheckCircle2 size={16} className="text-success" />
                          Strengths:
                        </p>
                        {/* Changed text color to muted-foreground, relying on AI to bold/highlight important words */}
                        <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(criterion.strengths) }} />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground flex items-center gap-1 mb-1">
                          <AlertCircle size={16} className="text-destructive" />
                          Weaknesses:
                        </p>
                        {/* Changed text color to muted-foreground, relying on AI to bold/highlight important words */}
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
              })}
              {/* Render overall suggestions separately */}
              {evaluationReport.overall_suggestions && (
                <div className="space-y-1 pt-4 border-t border-border/50">
                  <h4 className="font-medium text-foreground flex items-center gap-1">
                    <Lightbulb size={16} className="text-primary" />
                    Overall Suggestions for Improvement
                  </h4>
                  <div className="prose prose-sm max-w-none text-muted-foreground" dangerouslySetInnerHTML={{ __html: renderRichText(evaluationReport.overall_suggestions) }} />
                </div>
              )}

              {/* Flashcard Import Button */}
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

              {/* Model Answer Section */}
              {overallBand !== null && overallBand < 9 && (
                <div className="space-y-4 pt-6 border-t-2 border-primary/30 mt-6">
                  <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                    <Star size={20} className="text-primary" />
                    Model Answer (Band {Math.min(Math.ceil(overallBand) + 1, 9).toFixed(0)})
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Here is an example answer that would achieve a higher band score. Study this to understand what examiners are looking for.
                  </p>
                  
                  <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Badge variant="outline">Task {taskNumber}</Badge>
                        {taskNumber === 1 ? 'Academic Writing Task 1' : 'Essay Writing Task 2'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {taskNumber === 1 ? (
                        <div className="bg-card p-4 rounded-lg border text-sm text-foreground space-y-3">
                          <p><strong>Introduction:</strong> The [chart/graph/table/diagram] illustrates [what it shows] over the period from [start] to [end]. Overall, it is evident that [main trend or key observation].</p>
                          <p><strong>Body Paragraph 1:</strong> Looking at the data in more detail, [first major trend/comparison]. Specifically, [data point] started at [figure] in [year] and [rose/fell] significantly to reach [figure] by [year]. This represents an increase/decrease of approximately [percentage/number].</p>
                          <p><strong>Body Paragraph 2:</strong> In contrast, [second comparison or trend]. While [item A] showed [trend], [item B] demonstrated [different pattern]. By the end of the period, [final comparison with specific figures].</p>
                          <p><strong>Conclusion (optional for Task 1):</strong> In summary, the most notable features are [1-2 key observations that tie the data together].</p>
                        </div>
                      ) : (
                        <div className="bg-card p-4 rounded-lg border text-sm text-foreground space-y-3">
                          <p><strong>Introduction:</strong> In recent years, [topic from question] has become a subject of considerable debate. While some argue that [one viewpoint], others contend that [opposing viewpoint]. This essay will examine both perspectives before presenting my own opinion.</p>
                          <p><strong>Body Paragraph 1:</strong> On the one hand, proponents of [first view] argue that [main argument]. For instance, [specific example with evidence]. Furthermore, [supporting point]. This suggests that [conclusion for this paragraph].</p>
                          <p><strong>Body Paragraph 2:</strong> On the other hand, those who advocate for [opposing view] maintain that [main counter-argument]. A case in point is [example with specific details]. Additionally, [another supporting point]. Therefore, [paragraph conclusion].</p>
                          <p><strong>Conclusion:</strong> In conclusion, while there are valid arguments on both sides, I believe that [your balanced opinion]. Governments and individuals should [recommendation] in order to [desired outcome]. Only through such measures can we [final thought].</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
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
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/writing/cambridge-ielts-a')}>
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h1 className="text-2xl font-bold font-heading">
              Writing Evaluation: {writingTest?.title}
            </h1>
            <p className="text-muted-foreground">Review your AI-generated feedback</p>
          </div>
        </div>
        {combinedOverallBand !== null && (
          <Badge className="bg-primary text-primary-foreground text-lg px-4 py-2">
            Overall Band: {combinedOverallBand.toFixed(1)}
          </Badge>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {sortedAttempts.length > 1 && (
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
                    {sortedAttempts.map(([submittedAt, submissionsInAttempt], index) => {
                      const validScores = submissionsInAttempt.filter(s => s.overall_band !== null && s.overall_band !== undefined);
                      const averageBandForAttempt = validScores.length > 0 
                        ? roundToHalf(validScores.reduce((sum, s) => sum + (s.overall_band || 0), 0) / validScores.length)
                        : null;

                      return (
                        <SelectItem 
                          key={submittedAt} 
                          value={submissionsInAttempt[0].id} // Use Task 1's submission ID to represent the attempt
                        >
                          Attempt {sortedAttempts.length - index} - {new Date(submittedAt).toLocaleString()}
                          {averageBandForAttempt !== null && (
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
          ) : (
            <>
              {renderEvaluationSection(currentSubmission1, task1, 1)}
              {renderEvaluationSection(currentSubmission2, task2, 2)}
            </>
          )}
        </div>
      </main>
    </div>
  );
}