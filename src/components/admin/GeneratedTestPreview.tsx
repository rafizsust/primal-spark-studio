import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Volume2, PenLine, Mic, FileText, ListChecks, HelpCircle } from "lucide-react";

interface GeneratedTestPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  test: {
    id: string;
    module: string;
    question_type: string;
    content_payload: Record<string, unknown>;
  } | null;
}

export default function GeneratedTestPreview({ open, onOpenChange, test }: GeneratedTestPreviewProps) {
  if (!test) return null;

  const { module, question_type, content_payload } = test;

  const getModuleIcon = () => {
    switch (module) {
      case "reading": return <BookOpen className="h-5 w-5" />;
      case "listening": return <Volume2 className="h-5 w-5" />;
      case "writing": return <PenLine className="h-5 w-5" />;
      case "speaking": return <Mic className="h-5 w-5" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getModuleIcon()}
            <span className="capitalize">{module}</span> Test Preview
            <Badge variant="outline" className="ml-2">
              {question_type?.replace(/_/g, " ") || "Mixed"}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="h-[70vh]">
          {module === "reading" && <ReadingPreview payload={content_payload} />}
          {module === "listening" && <ListeningPreview payload={content_payload} />}
          {module === "writing" && <WritingPreview payload={content_payload} />}
          {module === "speaking" && <SpeakingPreview payload={content_payload} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ReadingPreview({ payload }: { payload: Record<string, unknown> }) {
  const data = payload as {
    title?: string;
    passage?: string;
    paragraphs?: Array<{ label: string; content: string }>;
    questions?: Array<{
      number: number;
      text: string;
      type: string;
      options?: string[];
      answer: string;
    }>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {data.title || "Reading Passage"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.paragraphs ? (
            <div className="space-y-4">
              {data.paragraphs.map((p, i) => (
                <div key={i}>
                  <span className="font-bold text-primary">{p.label}</span>
                  <p className="text-sm leading-relaxed mt-1">{p.content}</p>
                </div>
              ))}
            </div>
          ) : data.passage ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.passage}</p>
          ) : (
            <p className="text-muted-foreground">No passage content</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Questions ({data.questions?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.questions?.map((q, i) => (
              <div key={i} className="border-b pb-3 last:border-0">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="shrink-0">{q.number || i + 1}</Badge>
                  <div className="flex-1">
                    <p className="text-sm">{q.text}</p>
                    {q.options && (
                      <div className="mt-2 pl-4 space-y-1">
                        {q.options.map((opt, j) => (
                          <p key={j} className="text-xs text-muted-foreground">
                            {String.fromCharCode(65 + j)}. {opt}
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs font-medium text-green-600">
                      Answer: {q.answer}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ListeningPreview({ payload }: { payload: Record<string, unknown> }) {
  const data = payload as {
    title?: string;
    transcript?: string;
    audio_url?: string;
    questions?: Array<{
      number: number;
      text: string;
      type: string;
      options?: string[];
      answer: string;
    }>;
  };

  return (
    <div className="space-y-6">
      {data.audio_url && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              Audio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <audio controls className="w-full">
              <source src={data.audio_url} type="audio/mpeg" />
            </audio>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Transcript
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.transcript || "No transcript available"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Questions ({data.questions?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.questions?.map((q, i) => (
              <div key={i} className="border-b pb-3 last:border-0">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="shrink-0">{q.number || i + 1}</Badge>
                  <div className="flex-1">
                    <p className="text-sm">{q.text}</p>
                    {q.options && (
                      <div className="mt-2 pl-4 space-y-1">
                        {q.options.map((opt, j) => (
                          <p key={j} className="text-xs text-muted-foreground">
                            {String.fromCharCode(65 + j)}. {opt}
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs font-medium text-green-600">
                      Answer: {q.answer}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WritingPreview({ payload }: { payload: Record<string, unknown> }) {
  const data = payload as {
    task_type?: string;
    prompt?: string;
    instruction?: string;
    data_description?: string;
    image_url?: string;
    sample_answer?: string;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            {data.task_type === "TASK_1" ? "Task 1" : "Task 2"} Prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.instruction && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Instructions</p>
              <p className="text-sm">{data.instruction}</p>
            </div>
          )}
          {data.prompt && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Prompt</p>
              <p className="text-sm whitespace-pre-wrap">{data.prompt}</p>
            </div>
          )}
          {data.data_description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Data Description</p>
              <p className="text-sm whitespace-pre-wrap">{data.data_description}</p>
            </div>
          )}
          {data.image_url && (
            <img src={data.image_url} alt="Task visual" className="max-w-full rounded-lg" />
          )}
        </CardContent>
      </Card>

      {data.sample_answer && (
        <Card>
          <CardHeader>
            <CardTitle>Sample Answer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.sample_answer}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SpeakingPreview({ payload }: { payload: Record<string, unknown> }) {
  const data = payload as {
    parts?: Array<{
      part: number;
      topic?: string;
      cue_card?: string;
      questions: Array<{
        text: string;
        audio_url?: string;
      }>;
    }>;
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="part1">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="part1">Part 1</TabsTrigger>
          <TabsTrigger value="part2">Part 2</TabsTrigger>
          <TabsTrigger value="part3">Part 3</TabsTrigger>
        </TabsList>
        
        {[1, 2, 3].map((partNum) => {
          const part = data.parts?.find(p => p.part === partNum);
          return (
            <TabsContent key={partNum} value={`part${partNum}`}>
              <Card>
                <CardHeader>
                  <CardTitle>Part {partNum}</CardTitle>
                  {part?.topic && (
                    <p className="text-sm text-muted-foreground">Topic: {part.topic}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {part?.cue_card && (
                    <div className="bg-muted p-4 rounded-lg">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Cue Card</p>
                      <p className="text-sm whitespace-pre-wrap">{part.cue_card}</p>
                    </div>
                  )}
                  
                  <div className="space-y-3">
                    {part?.questions?.map((q, i) => (
                      <div key={i} className="flex items-start gap-2 border-b pb-3 last:border-0">
                        <Badge variant="outline">{i + 1}</Badge>
                        <div className="flex-1">
                          <p className="text-sm">{q.text}</p>
                          {q.audio_url && (
                            <audio controls className="w-full mt-2 h-8">
                              <source src={q.audio_url} type="audio/mpeg" />
                            </audio>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {!part && (
                    <p className="text-muted-foreground text-center py-4">
                      No content for Part {partNum}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
