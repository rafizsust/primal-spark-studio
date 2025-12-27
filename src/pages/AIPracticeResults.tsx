import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  loadGeneratedTestAsync,
  loadPracticeResultsAsync,
  GeneratedTest,
  PracticeResult,
  QuestionResult,
} from '@/types/aiPractice';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Clock,
  BookOpen,
  Headphones,
  RotateCcw,
  Home,
  ChevronDown,
  ChevronUp,
  Sparkles,
  MessageCircle,
  Send,
  Loader2,
  Bot,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function extractOptionId(option: string): string {
  const trimmed = (option ?? '').trim();
  const m = trimmed.match(/^([A-Z]|\d+|[ivxlcdm]+)\b/i);
  return (m?.[1] ?? trimmed).toUpperCase();
}

function extractOptionText(option: string): string {
  const trimmed = (option ?? '').trim();
  const id = extractOptionId(trimmed);
  const rest = trimmed.replace(new RegExp(`^${id}\\b\\s*`, 'i'), '').trim();
  return rest.length ? rest : trimmed;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface QuestionChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isOpen: boolean;
}

export default function AIPracticeResults() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [test, setTest] = useState<GeneratedTest | null>(null);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set());
  
  // Chat state per question
  const [questionChats, setQuestionChats] = useState<Record<number, QuestionChatState>>({});
  const [chatInputs, setChatInputs] = useState<Record<number, string>>({});
  const chatEndRefs = useRef<Record<number, HTMLDivElement | null>>({});

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

    let cancelled = false;

    const run = async () => {
      const loadedTest = await loadGeneratedTestAsync(testId);
      if (!loadedTest) {
        toast.error('Test not found');
        navigate('/ai-practice');
        return;
      }

      // The result insert is async; retry briefly so the results page is reliable.
      let matchingResult: PracticeResult | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const results = await loadPracticeResultsAsync(user.id);
        matchingResult = results.find(r => r.testId === testId);
        if (matchingResult) break;
        await new Promise(r => setTimeout(r, 750));
      }

      if (cancelled) return;

      if (!matchingResult) {
        toast.error('Results not found yet. Please try again.');
        navigate('/ai-practice');
        return;
      }

      setTest(loadedTest);
      setResult(matchingResult);

      // Expand incorrect answers by default
      const incorrectSet = new Set(
        (matchingResult.questionResults || [])
          .filter(q => !q.isCorrect)
          .map(q => q.questionNumber)
      );
      setExpandedQuestions(incorrectSet);
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [testId, navigate, user, authLoading]);

  // NOTE: Auto-scroll removed to preserve user's scroll position during AI response generation

  const toggleQuestion = (qNum: number) => {
    setExpandedQuestions(prev => {
      const next = new Set(prev);
      if (next.has(qNum)) {
        next.delete(qNum);
      } else {
        next.add(qNum);
      }
      return next;
    });
  };

  const toggleChat = (qNum: number) => {
    setQuestionChats(prev => ({
      ...prev,
      [qNum]: {
        ...prev[qNum],
        messages: prev[qNum]?.messages || [],
        isLoading: prev[qNum]?.isLoading || false,
        isOpen: !prev[qNum]?.isOpen,
      }
    }));
  };

  const sendMessage = async (questionNumber: number, qResult: QuestionResult) => {
    const message = chatInputs[questionNumber]?.trim();
    if (!message || !test) return;

    const question = (test.questionGroups || [])
      .flatMap(g => g.questions)
      .find(q => q.question_number === questionNumber);

    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setQuestionChats(prev => ({
      ...prev,
      [questionNumber]: {
        ...prev[questionNumber],
        messages: [...(prev[questionNumber]?.messages || []), userMessage],
        isLoading: true,
        isOpen: true,
      }
    }));
    setChatInputs(prev => ({ ...prev, [questionNumber]: '' }));

    try {
      const { data, error } = await supabase.functions.invoke('explain-answer-followup', {
        body: {
          question: message,
          context: {
            module: test.module,
            questionType: test.questionType,
            difficulty: test.difficulty,
            topic: test.topic,
            passage: test.passage,
            questionNumber,
            questionText: question?.question_text || qResult.correctAnswer,
            options: question?.options,
            userAnswer: qResult.userAnswer,
            correctAnswer: qResult.correctAnswer,
            isCorrect: qResult.isCorrect,
            explanation: qResult.explanation,
          },
        },
      });

      if (error) throw error;

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response || 'Sorry, I could not generate a response.',
        timestamp: new Date(),
      };

      setQuestionChats(prev => ({
        ...prev,
        [questionNumber]: {
          ...prev[questionNumber],
          messages: [...(prev[questionNumber]?.messages || []), assistantMessage],
          isLoading: false,
        }
      }));
    } catch (err: any) {
      console.error('Chat error:', err);
      toast.error(err.message || 'Failed to get AI response');
      setQuestionChats(prev => ({
        ...prev,
        [questionNumber]: {
          ...prev[questionNumber],
          isLoading: false,
        }
      }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, questionNumber: number, qResult: QuestionResult) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(questionNumber, qResult);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return 'text-success';
    if (percentage >= 60) return 'text-warning';
    return 'text-destructive';
  };

  const getBandColor = (band: number) => {
    if (band >= 7) return 'bg-success/20 text-success border-success/30';
    if (band >= 6) return 'bg-warning/20 text-warning border-warning/30';
    return 'bg-destructive/20 text-destructive border-destructive/30';
  };

  // Option maps for MATCHING_SENTENCE_ENDINGS so results show the chosen text (not just the letter).
  // IMPORTANT: This hook must run on every render (even before test/result are loaded)
  // to avoid React hook order mismatch.
  const sentenceEndingOptionByQuestionNumber = useMemo(() => {
    const out: Record<number, Map<string, string>> = {};

    const groups = test?.questionGroups ?? [];
    for (const g of groups) {
      if (g.question_type !== 'MATCHING_SENTENCE_ENDINGS') continue;

      const raw: any = g.options || {};
      const opts: any[] = Array.isArray(raw?.sentence_endings)
        ? raw.sentence_endings
        : Array.isArray(raw?.options)
          ? raw.options
          : Array.isArray(raw)
            ? raw
            : [];

      const map = new Map<string, string>();
      for (const opt of opts) {
        const asStr = typeof opt === 'string' ? opt : `${opt.id || ''} ${opt.text || ''}`.trim();
        map.set(extractOptionId(asStr), asStr);
      }

      for (const q of g.questions || []) {
        out[q.question_number] = map;
      }
    }

    return out;
  }, [test?.questionGroups]);

  // Defensive check for questionResults
  const questionResults = result?.questionResults ?? [];

  if (!test || !result) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const percentage = Math.round((result.score / result.totalQuestions) * 100);

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-y-auto">
      <Navbar />
      
      <main className="flex-1 py-8 overflow-visible">
        <div className="container max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-4">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">Practice Results</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold mb-2">
              {test.topic}
            </h1>
            <p className="text-muted-foreground">
              {test.questionType.replace(/_/g, ' ')} • {test.difficulty} difficulty
            </p>
          </div>

          {/* Score Overview */}
          <Card className="mb-6 overflow-hidden">
            <div className="bg-gradient-to-br from-primary/10 to-accent/10 p-6 md:p-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                {/* Score */}
                <div>
                  <div className={cn("text-4xl md:text-5xl font-bold mb-1", getScoreColor(percentage))}>
                    {result.score}/{result.totalQuestions}
                  </div>
                  <p className="text-sm text-muted-foreground">Correct Answers</p>
                </div>

                {/* Percentage */}
                <div>
                  <div className={cn("text-4xl md:text-5xl font-bold mb-1", getScoreColor(percentage))}>
                    {percentage}%
                  </div>
                  <p className="text-sm text-muted-foreground">Accuracy</p>
                </div>

                {/* Band Score */}
                <div>
                  <Badge className={cn("text-2xl md:text-3xl font-bold px-4 py-2", getBandColor(result.bandScore))}>
                    {result.bandScore}
                  </Badge>
                  <p className="text-sm text-muted-foreground mt-2">Est. Band</p>
                </div>

                {/* Time */}
                <div>
                  <div className="text-2xl md:text-3xl font-bold mb-1 flex items-center justify-center gap-2">
                    <Clock className="w-6 h-6" />
                    {formatTime(result.timeSpent)}
                  </div>
                  <p className="text-sm text-muted-foreground">Time Spent</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="py-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                <div className="text-2xl font-bold text-success">{result.score}</div>
                <p className="text-xs text-muted-foreground">Correct</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                <XCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
                <div className="text-2xl font-bold text-destructive">
                  {result.totalQuestions - result.score}
                </div>
                <p className="text-xs text-muted-foreground">Incorrect</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                {test.module === 'reading' ? (
                  <BookOpen className="w-8 h-8 text-primary mx-auto mb-2" />
                ) : (
                  <Headphones className="w-8 h-8 text-primary mx-auto mb-2" />
                )}
                <div className="text-2xl font-bold capitalize">{test.module}</div>
                <p className="text-xs text-muted-foreground">Module</p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Results */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Question by Question Review
                <Badge variant="secondary" className="ml-2 font-normal">
                  <MessageCircle className="w-3 h-3 mr-1" />
                  Ask AI for help
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {questionResults.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No question results available.
                  </div>
                ) : questionResults.map((qResult) => {
                  const question = (test.questionGroups || [])
                    .flatMap(g => g.questions)
                    .find(q => q.question_number === qResult.questionNumber);
                  
                  const isExpanded = expandedQuestions.has(qResult.questionNumber);
                  const chatState = questionChats[qResult.questionNumber] || { messages: [], isLoading: false, isOpen: false };

                  return (
                    <div 
                      key={qResult.questionNumber}
                      className={cn(
                        "border rounded-lg overflow-hidden transition-all",
                        qResult.isCorrect ? "border-success/30" : "border-destructive/30"
                      )}
                    >
                      {/* Question Header */}
                      <button
                        onClick={() => toggleQuestion(qResult.questionNumber)}
                        className={cn(
                          "w-full flex items-center justify-between p-4 text-left transition-colors",
                          qResult.isCorrect 
                            ? "bg-success/5 hover:bg-success/10" 
                            : "bg-destructive/5 hover:bg-destructive/10"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Badge 
                            variant="outline"
                            className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center p-0",
                              qResult.isCorrect 
                                ? "bg-success text-success-foreground border-success"
                                : "bg-destructive text-destructive-foreground border-destructive"
                            )}
                          >
                            {qResult.questionNumber}
                          </Badge>
                          
                          {qResult.isCorrect ? (
                            <CheckCircle2 className="w-5 h-5 text-success" />
                          ) : (
                            <XCircle className="w-5 h-5 text-destructive" />
                          )}
                          
                          <span className="text-sm font-medium line-clamp-1">
                            {question?.question_text || `Question ${qResult.questionNumber}`}
                          </span>
                        </div>
                        
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="p-4 border-t space-y-4">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground mb-1">Question</p>
                            <p>{question?.question_text}</p>
                          </div>

                          {(() => {
                            const type = question?.question_type;

                            const renderSentenceEnding = (value: string) => {
                              const id = extractOptionId(value);
                              const map = sentenceEndingOptionByQuestionNumber[qResult.questionNumber];
                              const full = map?.get(id);
                              const text = full ? extractOptionText(full) : '';
                              return text ? `${id}. ${text}` : id;
                            };

                            const renderAnswers = (value: string, kind: 'user' | 'correct') => {
                              if (!value) return kind === 'user' ? '(No answer)' : '';

                              if (type === 'MATCHING_SENTENCE_ENDINGS') {
                                return renderSentenceEnding(value);
                              }

                              if (type === 'MULTIPLE_CHOICE_MULTIPLE') {
                                return value.split(',').map((v) => v.trim()).filter(Boolean).join(', ');
                              }

                              return value;
                            };

                            return (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-sm font-medium text-muted-foreground mb-1">Your Answer</p>
                                  <p
                                    className={cn(
                                      "font-medium",
                                      qResult.isCorrect ? "text-success" : "text-destructive"
                                    )}
                                  >
                                    {renderAnswers(qResult.userAnswer, 'user')}
                                  </p>
                                </div>

                                <div>
                                  <p className="text-sm font-medium text-muted-foreground mb-1">Correct Answer</p>
                                  <p className="font-medium text-success">
                                    {renderAnswers(qResult.correctAnswer, 'correct')}
                                  </p>
                                </div>
                              </div>
                            );
                          })()}

                          <div className="bg-muted/50 rounded-lg p-4">
                            <p className="text-sm font-medium text-muted-foreground mb-1">Explanation</p>
                            <p className="text-sm">{qResult.explanation}</p>
                          </div>

                          {/* AI Follow-up Chat Section */}
                          <div className="border-t pt-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleChat(qResult.questionNumber)}
                              className="gap-2 mb-3"
                            >
                              <MessageCircle className="w-4 h-4" />
                              {chatState.isOpen ? 'Hide' : 'Ask AI'} about this question
                              {chatState.messages.length > 0 && (
                                <Badge variant="secondary" className="ml-1">
                                  {chatState.messages.length} {chatState.messages.length === 1 ? 'message' : 'messages'}
                                </Badge>
                              )}
                            </Button>

                            {chatState.isOpen && (
                              <div className="bg-muted/30 rounded-lg border p-3 space-y-3">
                                {/* Conversation History Header */}
                                {chatState.messages.length > 0 && (
                                  <div className="flex items-center justify-between pb-2 border-b border-border/50">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      Conversation History ({chatState.messages.length} {chatState.messages.length === 1 ? 'message' : 'messages'})
                                    </span>
                                    <span className="text-xs text-muted-foreground/60">
                                      Scroll to see all
                                    </span>
                                  </div>
                                )}
                                
                                {/* Chat Messages */}
                                {chatState.messages.length > 0 && (
                                  <div className="max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                                    <div className="space-y-3">
                                      {chatState.messages.map((msg) => (
                                        <div
                                          key={msg.id}
                                          className={cn(
                                            "flex gap-2",
                                            msg.role === 'user' ? 'justify-end' : 'justify-start'
                                          )}
                                        >
                                          {msg.role === 'assistant' && (
                                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                              <Bot className="w-4 h-4 text-primary" />
                                            </div>
                                          )}
                                          <div
                                            className={cn(
                                              "rounded-lg px-3 py-2 max-w-[85%] text-sm",
                                              msg.role === 'user'
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-background border'
                                            )}
                                          >
                                            <p className="whitespace-pre-wrap">{msg.content}</p>
                                          </div>
                                          {msg.role === 'user' && (
                                            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                                              <User className="w-4 h-4" />
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                      {chatState.isLoading && (
                                        <div className="flex gap-2 justify-start">
                                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <Bot className="w-4 h-4 text-primary" />
                                          </div>
                                          <div className="bg-background border rounded-lg px-3 py-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                          </div>
                                        </div>
                                      )}
                                      <div ref={el => chatEndRefs.current[qResult.questionNumber] = el} />
                                    </div>
                                  </div>
                                )}

                                {/* Suggested Questions */}
                                {chatState.messages.length === 0 && (
                                  <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">Suggested questions:</p>
                                    <div className="flex flex-wrap gap-2">
                                      {[
                                        'Why was my answer wrong?',
                                        'Explain this in simpler terms',
                                        'Give me a similar example',
                                        'What strategy should I use?',
                                      ].map((suggestion) => (
                                        <Button
                                          key={suggestion}
                                          variant="secondary"
                                          size="sm"
                                          className="text-xs h-7"
                                          onClick={() => {
                                            setChatInputs(prev => ({ ...prev, [qResult.questionNumber]: suggestion }));
                                          }}
                                        >
                                          {suggestion}
                                        </Button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Chat Input */}
                                <div className="flex gap-2">
                                  <Input
                                    placeholder="Ask a follow-up question..."
                                    value={chatInputs[qResult.questionNumber] || ''}
                                    onChange={(e) => setChatInputs(prev => ({ ...prev, [qResult.questionNumber]: e.target.value }))}
                                    onKeyDown={(e) => handleKeyDown(e, qResult.questionNumber, qResult)}
                                    disabled={chatState.isLoading}
                                    className="flex-1"
                                  />
                                  <Button
                                    size="icon"
                                    onClick={() => sendMessage(qResult.questionNumber, qResult)}
                                    disabled={chatState.isLoading || !chatInputs[qResult.questionNumber]?.trim()}
                                  >
                                    {chatState.isLoading ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Send className="w-4 h-4" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              variant="default"
              className="w-full sm:w-auto gap-2"
              onClick={() => navigate(`/ai-practice/${test.module}/${test.id}`)}
            >
              <RotateCcw className="w-4 h-4" />
              Retake this test
            </Button>
            <Link to="/ai-practice">
              <Button variant="outline" className="w-full sm:w-auto gap-2">
                <RotateCcw className="w-4 h-4" />
                New Practice Test
              </Button>
            </Link>
            <Link to="/">
              <Button variant="ghost" className="w-full sm:w-auto gap-2">
                <Home className="w-4 h-4" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
