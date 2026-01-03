-- Fix AI practice listening presets falling back to TTS by ensuring audio_url is populated
-- 1) Backfill any existing rows where payload.presetId points to a generated_test_audio row with a real audio_url
UPDATE public.ai_practice_tests apt
SET audio_url = gta.audio_url
FROM public.generated_test_audio gta
WHERE apt.module = 'listening'
  AND apt.audio_url IS NULL
  AND apt.payload->>'isPreset' = 'true'
  AND apt.payload->>'presetId' IS NOT NULL
  AND gta.id = (apt.payload->>'presetId')::uuid
  AND gta.audio_url IS NOT NULL;

-- 2) Prevent future regressions: on insert, if this is a listening preset run and audio_url is NULL,
--    pull audio_url from generated_test_audio using payload.presetId.
CREATE OR REPLACE FUNCTION public.fill_ai_practice_audio_url_from_preset()
RETURNS TRIGGER AS $$
DECLARE
  preset_uuid uuid;
  preset_audio_url text;
BEGIN
  IF NEW.module = 'listening' AND NEW.audio_url IS NULL THEN
    BEGIN
      preset_uuid := NULLIF(NEW.payload->>'presetId', '')::uuid;
    EXCEPTION WHEN others THEN
      preset_uuid := NULL;
    END;

    IF preset_uuid IS NOT NULL THEN
      SELECT gta.audio_url
      INTO preset_audio_url
      FROM public.generated_test_audio gta
      WHERE gta.id = preset_uuid
        AND gta.audio_url IS NOT NULL
      LIMIT 1;

      IF preset_audio_url IS NOT NULL THEN
        NEW.audio_url := preset_audio_url;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_fill_ai_practice_audio_url_from_preset ON public.ai_practice_tests;
CREATE TRIGGER trg_fill_ai_practice_audio_url_from_preset
BEFORE INSERT ON public.ai_practice_tests
FOR EACH ROW
EXECUTE FUNCTION public.fill_ai_practice_audio_url_from_preset();
