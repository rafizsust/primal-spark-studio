import { cn } from '@/lib/utils';

interface MapLabel {
  id: string; // e.g., "A", "B", "C" (answer positions - NOT labeled on map)
  text: string; // e.g., "Library" (what the user needs to find)
}

interface Landmark {
  id: string; // e.g., "L1", "L2"
  text: string; // e.g., "Main Street", "Gift Shop" (labeled reference points)
}

interface Question {
  question_number: number;
  question_text: string; // The location name user needs to find (e.g., "Quilt Shop")
  correct_answer: string;
}

interface MapLabelingTableProps {
  mapDescription?: string;
  mapLabels: MapLabel[]; // Answer positions A-H (shown as circles only, no text labels)
  landmarks?: Landmark[]; // Reference landmarks (shown with text labels)
  questions: Question[];
  answers: Record<number, string>;
  onAnswerChange: (questionNumber: number, answer: string) => void;
  onQuestionFocus?: (questionNumber: number) => void;
  fontSize?: number;
  imageUrl?: string;
}

/**
 * MapLabelingTable - IELTS Official format Map Labeling
 * - Map on left: Shows answer position letters (A-H) as circles WITHOUT labels,
 *   and landmark reference points WITH text labels
 * - Table on right: Question number + location name to find + A-H radio columns
 */
export function MapLabelingTable({
  mapDescription,
  mapLabels,
  landmarks = [],
  questions,
  answers,
  onAnswerChange,
  onQuestionFocus,
  fontSize = 14,
  imageUrl,
}: MapLabelingTableProps) {
  // Get unique letters from labels (sorted) - these are answer position columns
  const letterColumns = [...mapLabels].sort((a, b) => a.id.localeCompare(b.id)).map(l => l.id);

  // Handle selecting an answer - stores the letter ID (A, B, C)
  const handleSelectAnswer = (questionNumber: number, letterId: string) => {
    onAnswerChange(questionNumber, letterId);
    onQuestionFocus?.(questionNumber);
  };

  // Get currently selected letter for a question
  const getSelectedLetter = (questionNumber: number): string | null => {
    const answer = answers[questionNumber];
    if (!answer) return null;
    // Return the answer directly if it's a letter, or find matching label
    if (letterColumns.includes(answer)) return answer;
    // Fallback: check if answer matches a label's text
    const label = mapLabels.find(l => l.text === answer);
    return label?.id || null;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start w-full">
      {/* Left: Map with answer positions and landmarks */}
      <div className="flex-shrink-0 w-full lg:w-1/2 lg:max-w-[500px]">
        <div className="relative border border-border rounded-lg overflow-hidden bg-muted/30">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Map diagram for labeling"
              className="w-full h-auto object-contain"
              draggable={false}
            />
          ) : (
            /* Text-based map representation when no image available */
            <div className="p-4 min-h-[300px]">
              {/* Map Grid representation */}
              <div className="relative bg-muted/50 rounded border border-border p-4 min-h-[280px]">
                {/* Compass - positioned at top right with proper N/E/S/W display */}
                <div className="absolute top-3 right-3 flex flex-col items-center text-foreground">
                  <span className="text-[10px] font-semibold mb-0.5">N</span>
                  <div className="flex items-center gap-0">
                    <span className="text-[10px] font-semibold">W</span>
                    <div className="w-6 h-6 mx-0.5 relative">
                      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 2 L12 6 M12 18 L12 22 M2 12 L6 12 M18 12 L22 12" />
                        <path d="M12 8 L14 12 L12 16 L10 12 Z" fill="currentColor" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-semibold">E</span>
                  </div>
                  <span className="text-[10px] font-semibold mt-0.5">S</span>
                </div>
                
                {/* Map description */}
                {mapDescription && (
                  <div className="mb-4 text-xs text-muted-foreground italic pr-16">
                    {mapDescription}
                  </div>
                )}
                
                {/* Answer positions - circles with ONLY letters, no text labels */}
                <div className="mt-8">
                  <div className="text-xs text-muted-foreground mb-2">Answer positions:</div>
                  <div className="grid grid-cols-4 gap-2">
                    {mapLabels.map((label) => (
                      <div 
                        key={label.id}
                        className="flex items-center justify-center"
                      >
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-foreground bg-background text-sm font-bold">
                          {label.id}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Landmarks - shown with labels for reference */}
                {landmarks && landmarks.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs text-muted-foreground mb-2">Reference landmarks:</div>
                    <div className="grid grid-cols-2 gap-2">
                      {landmarks.map((landmark) => (
                        <div 
                          key={landmark.id}
                          className="flex items-center gap-1.5 bg-background border border-border rounded px-2 py-1"
                        >
                          <span className="text-xs text-muted-foreground">{landmark.id}:</span>
                          <span className="text-xs text-foreground">{landmark.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Selection Table - compact layout */}
      <div className="w-full lg:flex-1 overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontSize: `${fontSize}px` }}>
          <thead>
            <tr>
              {/* Empty header cell for question numbers/names */}
              <th className="border border-border bg-muted/50 px-2 py-1.5 text-left"></th>
              {/* Letter columns - compact */}
              {letterColumns.map((letter) => (
                <th 
                  key={letter} 
                  className="border border-border bg-muted/50 px-1.5 py-1.5 text-center font-bold w-8"
                >
                  {letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => {
              const selectedLetter = getSelectedLetter(question.question_number);
              
              return (
                <tr 
                  key={question.question_number}
                  id={`question-${question.question_number}`}
                  className="hover:bg-muted/30 transition-colors"
                >
                  {/* Question cell - number + location name to find */}
                  <td className="border border-border px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center min-w-[22px] h-5 text-xs font-bold border border-foreground rounded px-1">
                        {question.question_number}
                      </span>
                      <span className="text-foreground">{question.question_text}</span>
                    </div>
                  </td>
                  
                  {/* Radio button cells for each letter - with persistent selection highlight */}
                  {letterColumns.map((letter) => {
                    const isSelected = selectedLetter === letter;
                    return (
                      <td 
                        key={letter} 
                        className={cn(
                          "border border-border px-1 py-1.5 text-center cursor-pointer transition-colors",
                          isSelected && "bg-sky-100 dark:bg-sky-900/40"
                        )}
                        onClick={() => handleSelectAnswer(question.question_number, letter)}
                      >
                        <label className="cursor-pointer flex items-center justify-center">
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                            isSelected 
                              ? "border-teal-500 bg-white dark:bg-background" 
                              : "border-muted-foreground/40 bg-white dark:bg-background"
                          )}>
                            {isSelected && (
                              <div className="w-2.5 h-2.5 rounded-full bg-teal-500" />
                            )}
                          </div>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
