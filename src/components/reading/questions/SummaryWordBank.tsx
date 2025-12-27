import { useState } from 'react';
import { cn } from '@/lib/utils';

interface WordBankItem {
  id: string; // A, B, C...
  text: string;
}

interface SummaryWordBankProps {
  title?: string;
  // Content with gaps marked as {{31}}, {{32}}, etc.
  content: string;
  wordBank: Array<string | WordBankItem>;
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  onQuestionFocus?: (questionNumber: number) => void;
  currentQuestion?: number;
  fontSize?: number;
}

export function SummaryWordBank({
  title,
  content,
  wordBank,
  answers,
  onAnswerChange,
  onQuestionFocus,
  currentQuestion,
  fontSize = 14,
}: SummaryWordBankProps) {
  const [draggedWord, setDraggedWord] = useState<string | null>(null);

  // Parse content to identify gaps
  const parseContent = () => {
    const parts: Array<{ type: 'text' | 'gap'; value: string; questionNumber?: number }> = [];
    const regex = /\{\{(\d+)\}\}/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Add text before the gap
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      // Add the gap
      parts.push({ type: 'gap', value: match[1], questionNumber: parseInt(match[1]) });
      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push({ type: 'text', value: content.slice(lastIndex) });
    }

    return parts;
  };

  const normalizeWordBankItem = (item: string | WordBankItem) => {
    if (typeof item === 'string') {
      // Back-compat: treat string as both id and text
      return { id: item, text: item };
    }
    return { id: item.id, text: item.text };
  };

  const handleDragStart = (item: string | WordBankItem) => {
    const wb = normalizeWordBankItem(item);
    setDraggedWord(wb.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (questionNumber: number) => {
    if (draggedWord) {
      onAnswerChange(questionNumber, draggedWord);
      // Focus the question in navigation after drop
      onQuestionFocus?.(questionNumber);
      setDraggedWord(null);
    }
  };

  const handleClear = (questionNumber: number) => {
    onAnswerChange(questionNumber, '');
  };

  const handleWordClick = (item: string | WordBankItem) => {
    const wb = normalizeWordBankItem(item);
    // Find first empty gap or current question
    const allGaps = parseContent().filter(p => p.type === 'gap');
    const firstEmptyGap = allGaps.find(g => !answers[g.questionNumber!]);

    if (currentQuestion && !answers[currentQuestion]) {
      onAnswerChange(currentQuestion, wb.id);
      onQuestionFocus?.(currentQuestion);
    } else if (firstEmptyGap) {
      onAnswerChange(firstEmptyGap.questionNumber!, wb.id);
      onQuestionFocus?.(firstEmptyGap.questionNumber!);
    }
  };

  const parts = parseContent();

  // Only treat words as "used" within THIS summary's gap question numbers (prevents cross-group ghosting)
  const gapQuestionNumbers = new Set(
    parts
      .filter((p) => p.type === 'gap')
      .map((p) => p.questionNumber!)
  );

  const usedWords = Object.entries(answers)
    .filter(([qNum]) => gapQuestionNumbers.has(Number(qNum)))
    .map(([, val]) => val)
    .filter(Boolean);

  return (
    <div className="flex gap-4" style={{ fontSize: `${fontSize}px` }}>
      {/* Summary Content */}
      <div className="flex-1">
        {title && (
          <h3 className="text-lg font-bold text-primary text-center mb-3">
            {title}
          </h3>
        )}

        <div className="leading-relaxed">
          {parts.map((part, index) => {
            if (part.type === 'text') {
              return <span key={index}>{part.value}</span>;
            }

            const questionNumber = part.questionNumber!;
            const answer = answers[questionNumber] || '';
            const isActive = currentQuestion === questionNumber;

            return (
              <span
                key={index}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(questionNumber)}
                onClick={() => answer && handleClear(questionNumber)}
                className={cn(
                  "inline-flex items-center justify-center min-w-24 h-8 mx-1 border-2 rounded cursor-pointer transition-all align-middle",
                  answer
                    ? "border-primary bg-primary/10 border-solid px-2"
                    : isActive
                      ? "border-primary border-dashed bg-primary/5"
                      : "border-muted-foreground/40 border-dashed hover:border-primary/50"
                )}
              >
                {answer ? (
                  <span className="font-medium text-sm">{answer}</span>
                ) : (
                  <span className="text-muted-foreground font-bold text-sm">
                    {questionNumber}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Word Bank Sidebar */}
      <div className="w-44 flex-shrink-0">
        <div className="sticky top-4 space-y-1">
          {wordBank.map((item, index) => {
            const wb = normalizeWordBankItem(item);
            const isUsed = usedWords.includes(wb.id);

            return (
              <div
                key={`${wb.id}-${index}`}
                className="min-h-[36px]"
              >
                {!isUsed ? (
                  <div
                    draggable
                    onDragStart={() => handleDragStart(item)}
                    onClick={() => handleWordClick(item)}
                    className={cn(
                      "px-2 py-1.5 border rounded text-center cursor-pointer transition-all text-sm",
                      "bg-background hover:border-primary hover:bg-primary/5 active:bg-primary/10"
                    )}
                  >
                    <span className="font-bold mr-1">{wb.id}</span>
                    <span>{wb.text}</span>
                  </div>
                ) : (
                  // Empty placeholder to maintain position, matching Matching Headings behavior
                  <div className="h-full" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
