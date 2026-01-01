-- Create a function to cleanup old user test data (older than 1 year)
-- This only deletes user-generated data like submissions, not the tests themselves
CREATE OR REPLACE FUNCTION public.cleanup_old_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff_date timestamp with time zone := now() - interval '1 year';
  v_deleted_reading_submissions integer := 0;
  v_deleted_listening_submissions integer := 0;
  v_deleted_speaking_submissions integer := 0;
  v_deleted_writing_submissions integer := 0;
  v_deleted_ai_practice_results integer := 0;
  v_deleted_test_results integer := 0;
BEGIN
  -- Delete old reading test submissions
  DELETE FROM public.reading_test_submissions
  WHERE completed_at < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_reading_submissions = ROW_COUNT;

  -- Delete old listening test submissions
  DELETE FROM public.listening_test_submissions
  WHERE completed_at < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_listening_submissions = ROW_COUNT;

  -- Delete old speaking submissions
  DELETE FROM public.speaking_submissions
  WHERE submitted_at < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_speaking_submissions = ROW_COUNT;

  -- Delete old writing submissions
  DELETE FROM public.writing_submissions
  WHERE submitted_at < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_writing_submissions = ROW_COUNT;

  -- Delete old AI practice results
  DELETE FROM public.ai_practice_results
  WHERE completed_at < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_ai_practice_results = ROW_COUNT;

  -- Delete old general test results
  DELETE FROM public.test_results
  WHERE completed_at < v_cutoff_date;
  GET DIAGNOSTICS v_deleted_test_results = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff_date', v_cutoff_date,
    'deleted_reading_submissions', v_deleted_reading_submissions,
    'deleted_listening_submissions', v_deleted_listening_submissions,
    'deleted_speaking_submissions', v_deleted_speaking_submissions,
    'deleted_writing_submissions', v_deleted_writing_submissions,
    'deleted_ai_practice_results', v_deleted_ai_practice_results,
    'deleted_test_results', v_deleted_test_results
  );
END;
$$;