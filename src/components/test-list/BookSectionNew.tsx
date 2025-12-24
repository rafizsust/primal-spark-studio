import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { BookOpen, Headphones, ChevronDown, ChevronUp, Play, Clock, FileText, Trophy, Check, Zap } from 'lucide-react';
import { QuestionTypeBadge } from './QuestionTypeBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface QuestionGroup {
  id: string;
  question_type: string;
  start_question: number;
  end_question: number;
  passage_id?: string;
}

interface Passage {
  id: string;
  passage_number: number;
  title: string;
}

interface TestData {
  id: string;
  title: string;
  test_number: number;
  time_limit: number;
  total_questions: number;
  passages?: Passage[];
  question_groups?: QuestionGroup[];
}

interface TestScore {
  score: number;
  totalQuestions: number;
  bandScore: number | null;
}

interface BookSectionNewProps {
  bookName: string;
  tests: TestData[];
  testType: 'reading' | 'listening';
  selectedQuestionTypes: string[];
  userScores?: Record<string, { overall: TestScore | null; parts: Record<number, { score: number; totalQuestions: number }> }>;
}

export function BookSectionNew({
  bookName,
  tests,
  testType,
  selectedQuestionTypes,
  userScores = {},
}: BookSectionNewProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  // Filter tests based on selected question types
  const filteredTests = selectedQuestionTypes.length === 0 
    ? tests 
    : tests.filter((test) => 
        test.question_groups?.some((group) => 
          selectedQuestionTypes.includes(group.question_type)
        )
      );

  if (filteredTests.length === 0) return null;

  const IconComponent = testType === 'reading' ? BookOpen : Headphones;
  const accentColor = testType === 'reading' ? 'teal' : 'emerald';

  // Calculate book-level stats
  const totalAttempted = Object.keys(userScores).filter(id => 
    filteredTests.some(t => t.id === id)
  ).length;

  return (
    <div className="space-y-3">
      {/* Book Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center justify-between gap-3 p-4 rounded-2xl transition-all",
          "bg-gradient-to-r from-background to-secondary/30 border border-border/50",
          "hover:border-primary/30 hover:shadow-md"
        )}
      >
        <div className="flex items-center gap-4">
          <div className={cn(
            "flex items-center justify-center w-14 h-14 rounded-2xl shadow-lg",
            `bg-gradient-to-br from-${accentColor} to-${accentColor}-dark text-white`
          )}
          style={{
            background: testType === 'reading' 
              ? 'linear-gradient(135deg, hsl(var(--teal)), hsl(var(--emerald)))' 
              : 'linear-gradient(135deg, hsl(var(--emerald)), hsl(var(--teal)))'
          }}
          >
            <IconComponent className="w-7 h-7" />
          </div>
          <div className="text-left">
            <h2 className="text-xl font-bold text-foreground">{bookName}</h2>
            <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground">
              <span>{filteredTests.length} tests</span>
              {totalAttempted > 0 && (
                <span className="flex items-center gap-1 text-success">
                  <Check className="w-3.5 h-3.5" />
                  {totalAttempted} completed
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-xl transition-all",
          "bg-secondary/50 text-muted-foreground",
          isExpanded && "rotate-180"
        )}>
          <ChevronDown className="w-5 h-5 transition-transform duration-300" />
        </div>
      </button>

      {/* Test Cards */}
      {isExpanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {filteredTests.map((test) => (
            <TestCardNew
              key={test.id}
              test={test}
              testType={testType}
              isExpanded={expandedTestId === test.id}
              onToggle={() => setExpandedTestId(expandedTestId === test.id ? null : test.id)}
              score={userScores[test.id]}
            />
          ))}
        </div>
      )}

      {/* Expanded Part Details */}
      {expandedTestId && isExpanded && (
        <ExpandedTestDetails
          test={filteredTests.find(t => t.id === expandedTestId)!}
          testType={testType}
          score={userScores[expandedTestId]}
          onClose={() => setExpandedTestId(null)}
        />
      )}
    </div>
  );
}

// Compact Test Card
interface TestCardNewProps {
  test: TestData;
  testType: 'reading' | 'listening';
  isExpanded: boolean;
  onToggle: () => void;
  score?: { overall: TestScore | null; parts: Record<number, { score: number; totalQuestions: number }> };
}

function TestCardNew({ test, testType, isExpanded, onToggle, score }: TestCardNewProps) {
  const uniqueTypes = [...new Set(test.question_groups?.map(g => g.question_type) || [])];
  const hasScore = score?.overall !== null && score?.overall !== undefined;
  const scorePercent = hasScore ? Math.round((score!.overall!.score / score!.overall!.totalQuestions) * 100) : 0;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border transition-all duration-200",
        "bg-card hover:shadow-lg",
        isExpanded 
          ? "border-primary ring-2 ring-primary/20" 
          : "border-border/60 hover:border-primary/40"
      )}
    >
      <div className="p-4 space-y-3">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className={cn(
            "flex items-center justify-center w-12 h-12 rounded-xl font-bold text-lg shrink-0",
            "bg-gradient-to-br from-primary/20 to-primary/10 text-primary border border-primary/20"
          )}>
            {test.test_number}
          </div>
          
          {hasScore && (
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs font-semibold",
                scorePercent >= 70 
                  ? "bg-success/15 text-success border-success/30" 
                  : scorePercent >= 50 
                    ? "bg-gold/15 text-gold border-gold/30" 
                    : "bg-destructive/15 text-destructive border-destructive/30"
              )}
            >
              <Trophy className="w-3 h-3 mr-1" />
              {score!.overall!.score}/{score!.overall!.totalQuestions}
            </Badge>
          )}
        </div>

        {/* Test Info */}
        <div>
          <h3 className="font-semibold text-foreground text-sm line-clamp-1">{test.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {test.time_limit}m
            </span>
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {test.total_questions}Q
            </span>
          </div>
        </div>

        {/* Question Types */}
        <div className="flex flex-wrap gap-1">
          {uniqueTypes.slice(0, 4).map((type) => (
            <QuestionTypeBadge key={type} type={type} />
          ))}
          {uniqueTypes.length > 4 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
              +{uniqueTypes.length - 4}
            </span>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex border-t border-border/40 divide-x divide-border/40">
        <button
          onClick={onToggle}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5",
            "text-xs font-medium transition-all",
            isExpanded 
              ? "text-primary bg-primary/5" 
              : "text-muted-foreground hover:text-primary hover:bg-primary/5"
          )}
        >
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {isExpanded ? 'Hide' : 'Parts'}
        </button>
        <Link
          to={`/${testType}/test/${test.id}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2.5",
            "text-xs font-medium transition-all",
            "text-primary hover:bg-primary/10"
          )}
        >
          <Zap className="w-3.5 h-3.5" />
          Full Test
        </Link>
      </div>
    </div>
  );
}

// Expanded Test Details Panel
interface ExpandedTestDetailsProps {
  test: TestData;
  testType: 'reading' | 'listening';
  score?: { overall: TestScore | null; parts: Record<number, { score: number; totalQuestions: number }> };
  onClose: () => void;
}

function ExpandedTestDetails({ test, testType, score, onClose }: ExpandedTestDetailsProps) {
  // Get parts data
  const partsData = useMemo(() => {
    if (testType === 'reading' && test.passages) {
      return test.passages.map((passage) => {
        const passageGroups = test.question_groups?.filter(g => g.passage_id === passage.id) || [];
        const questionCount = passageGroups.reduce((sum, g) => sum + (g.end_question - g.start_question + 1), 0);
        const types = [...new Set(passageGroups.map(g => g.question_type))];
        return {
          partNumber: passage.passage_number,
          title: passage.title,
          questionCount,
          types,
          questionGroups: passageGroups,
        };
      });
    } else {
      // Listening: 4 parts based on question ranges
      const parts: { partNumber: number; questionCount: number; types: string[]; questionGroups: QuestionGroup[] }[] = [];
      for (let i = 1; i <= 4; i++) {
        const partGroups = test.question_groups?.filter(g => {
          const midQ = (g.start_question + g.end_question) / 2;
          return Math.ceil(midQ / 10) === i;
        }) || [];
        if (partGroups.length > 0) {
          const questionCount = partGroups.reduce((sum, g) => sum + (g.end_question - g.start_question + 1), 0);
          const types = [...new Set(partGroups.map(g => g.question_type))];
          parts.push({ partNumber: i, questionCount, types, questionGroups: partGroups });
        }
      }
      return parts;
    }
  }, [test, testType]);

  return (
    <div className="rounded-2xl border border-primary/30 bg-card p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary font-bold">
            T{test.test_number}
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{test.title}</h3>
            <p className="text-xs text-muted-foreground">{test.total_questions} questions • {test.time_limit} minutes</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Parts Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {partsData.map((part) => {
          const partScore = score?.parts?.[part.partNumber];
          const hasPartScore = partScore !== undefined;
          
          return (
            <div
              key={part.partNumber}
              className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/20 text-primary text-xs font-bold">
                    {part.partNumber}
                  </span>
                  <span className="text-sm font-medium text-foreground">Part {part.partNumber}</span>
                </div>
                {hasPartScore && (
                  <span className="text-xs font-medium text-success">
                    {partScore.score}/{partScore.totalQuestions}
                  </span>
                )}
              </div>

              {'title' in part && typeof part.title === 'string' && part.title && (
                <p className="text-xs text-muted-foreground line-clamp-1">{part.title as string}</p>
              )}

              <div className="flex flex-wrap gap-1">
                {part.types.map(type => (
                  <QuestionTypeBadge
                    key={type}
                    type={type}
                    clickable
                    testId={test.id}
                    testType={testType}
                    partNumber={part.partNumber}
                  />
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                {testType === 'reading' && (
                  <Link
                    to={`/reading/study/${test.id}?part=${part.partNumber}`}
                    className="flex-1 text-center py-1.5 text-xs font-medium rounded-lg bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                  >
                    Study
                  </Link>
                )}
                <Link
                  to={`/${testType}/test/${test.id}?part=${part.partNumber}`}
                  className="flex-1 text-center py-1.5 text-xs font-medium rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                >
                  <Play className="w-3 h-3 inline mr-1" />
                  Start
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Full Test Button */}
      <div className="mt-4 flex justify-center">
        <Link
          to={`/${testType}/test/${test.id}`}
          className={cn(
            "inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium",
            "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground",
            "hover:shadow-lg hover:shadow-primary/25 transition-all hover:scale-[1.02]"
          )}
        >
          <Zap className="w-4 h-4" />
          Start Full Test ({test.total_questions} questions, {test.time_limit}m)
        </Link>
      </div>
    </div>
  );
}
