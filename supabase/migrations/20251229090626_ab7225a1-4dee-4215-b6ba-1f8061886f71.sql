-- Create table to track completed AI practice tests per topic per module
CREATE TABLE public.ai_practice_topic_completions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('reading', 'listening', 'writing', 'speaking')),
  topic TEXT NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, module, topic)
);

-- Enable RLS
ALTER TABLE public.ai_practice_topic_completions ENABLE ROW LEVEL SECURITY;

-- Users can view their own completions
CREATE POLICY "Users can view their own topic completions"
ON public.ai_practice_topic_completions
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own completions
CREATE POLICY "Users can insert their own topic completions"
ON public.ai_practice_topic_completions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own completions
CREATE POLICY "Users can update their own topic completions"
ON public.ai_practice_topic_completions
FOR UPDATE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_ai_practice_topic_completions_updated_at
BEFORE UPDATE ON public.ai_practice_topic_completions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to increment completion count (upsert)
CREATE OR REPLACE FUNCTION public.increment_topic_completion(
  p_user_id UUID,
  p_module TEXT,
  p_topic TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_practice_topic_completions (user_id, module, topic, completed_count)
  VALUES (p_user_id, p_module, p_topic, 1)
  ON CONFLICT (user_id, module, topic)
  DO UPDATE SET 
    completed_count = ai_practice_topic_completions.completed_count + 1,
    updated_at = now();
END;
$$;