-- Create atomic credit check and deduction function
-- This prevents race conditions by using SELECT FOR UPDATE and atomic increment

CREATE OR REPLACE FUNCTION public.check_and_reserve_credits(
  p_user_id uuid,
  p_cost integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_profile profiles%ROWTYPE;
  v_current_credits integer;
  v_result jsonb;
BEGIN
  -- Lock the row for update to prevent race conditions
  SELECT * INTO v_profile
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Profile not found',
      'credits_used', 0,
      'credits_remaining', 0
    );
  END IF;
  
  -- Reset credits if new day
  IF v_profile.last_reset_date IS NULL OR v_profile.last_reset_date < v_today THEN
    UPDATE profiles
    SET daily_credits_used = 0, last_reset_date = v_today
    WHERE id = p_user_id;
    v_current_credits := 0;
  ELSE
    v_current_credits := COALESCE(v_profile.daily_credits_used, 0);
  END IF;
  
  -- Check if limit would be exceeded (limit is 100)
  IF v_current_credits + p_cost > 100 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Daily credit limit reached (%s/100). Add your own Gemini API key in Settings.', v_current_credits),
      'credits_used', v_current_credits,
      'credits_remaining', GREATEST(0, 100 - v_current_credits)
    );
  END IF;
  
  -- Atomically increment credits (reserve them BEFORE calling AI)
  UPDATE profiles
  SET daily_credits_used = v_current_credits + p_cost,
      last_reset_date = v_today
  WHERE id = p_user_id;
  
  RETURN jsonb_build_object(
    'ok', true,
    'credits_used', v_current_credits + p_cost,
    'credits_remaining', GREATEST(0, 100 - v_current_credits - p_cost)
  );
END;
$$;

-- Create function to refund credits if operation fails
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id uuid,
  p_cost integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET daily_credits_used = GREATEST(0, daily_credits_used - p_cost)
  WHERE id = p_user_id;
END;
$$;

-- Create function to get current credit status
CREATE OR REPLACE FUNCTION public.get_credit_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_profile profiles%ROWTYPE;
  v_current_credits integer;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'credits_used', 0,
      'credits_remaining', 100,
      'limit', 100
    );
  END IF;
  
  -- Reset logic for display
  IF v_profile.last_reset_date IS NULL OR v_profile.last_reset_date < v_today THEN
    v_current_credits := 0;
  ELSE
    v_current_credits := COALESCE(v_profile.daily_credits_used, 0);
  END IF;
  
  RETURN jsonb_build_object(
    'credits_used', v_current_credits,
    'credits_remaining', GREATEST(0, 100 - v_current_credits),
    'limit', 100
  );
END;
$$;