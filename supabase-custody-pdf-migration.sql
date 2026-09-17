-- NOKAEL — PROOF OF CUSTODY PDF SUPPORT
-- Safe to run top-to-bottom in the Supabase SQL editor. Purely additive:
-- no columns removed, no existing function branches changed, nothing
-- destructive.
--
-- WHY THIS EXISTS
-- The native driver app (NDP) generates an on-device Proof of Custody PDF
-- once a job's driver-delivery step is confirmed, combining both OTP
-- handshake timestamps and locations. jobs.driver_lat/driver_lng already
-- exist, but LocationTrackingService overwrites them continuously while
-- the driver is in transit (see LocationTrackingService.kt) -- by the time
-- delivery is confirmed, that pair holds the driver's *current* position,
-- not where the pickup handshake actually happened. These four new
-- columns freeze GPS at each handshake moment instead, so the PDF can
-- honestly say "pickup confirmed here" and "delivery confirmed here" as
-- two distinct, immutable facts.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS driver_pickup_lat double precision;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS driver_pickup_lng double precision;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS driver_delivery_lat double precision;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS driver_delivery_lng double precision;

-- Extends the existing whitelist-based update_job_by_token (see
-- supabase-schema.sql) with four new IF branches. Every existing branch
-- is reproduced byte-for-byte from supabase-schema.sql -- CREATE OR
-- REPLACE swaps the whole function body, so this must stay a faithful
-- superset, not a from-scratch rewrite, or existing callers regress.
CREATE OR REPLACE FUNCTION public.update_job_by_token(p_token text, p_updates jsonb)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.jobs
  WHERE (token_client_pickup::text = p_token
     OR token_driver_pickup::text = p_token
     OR token_driver_delivery::text = p_token
     OR token_client_delivery::text = p_token)
    AND status != 'completed'
    AND status != 'cancelled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found, already completed, or access token invalid.';
  END IF;

  IF p_updates ? 'driver_lat' THEN
    UPDATE public.jobs SET driver_lat = (p_updates->>'driver_lat')::double precision, driver_updated_at = now(), updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'driver_lng' THEN
    UPDATE public.jobs SET driver_lng = (p_updates->>'driver_lng')::double precision, driver_updated_at = now(), updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'driver_arrived_pickup_at' THEN
    UPDATE public.jobs SET driver_arrived_pickup_at = (p_updates->>'driver_arrived_pickup_at')::timestamp with time zone, updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'sender_ready_at' THEN
    UPDATE public.jobs SET sender_ready_at = (p_updates->>'sender_ready_at')::timestamp with time zone, updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'driver_arrived_delivery_at' THEN
    UPDATE public.jobs SET driver_arrived_delivery_at = (p_updates->>'driver_arrived_delivery_at')::timestamp with time zone, updated_at = now() WHERE id = v_job.id;
  END IF;

  -- New: freeze driver GPS at the moment each OTP handshake is confirmed.
  -- Written by ConfirmationViewModel.confirm() BEFORE it calls
  -- confirm_job_step, specifically so the job is still non-completed and
  -- this whitelist gate above doesn't reject the write -- once
  -- confirm_job_step marks the delivery leg done, status flips away from
  -- an editable state and update_job_by_token would start raising above.
  IF p_updates ? 'driver_pickup_lat' THEN
    UPDATE public.jobs SET driver_pickup_lat = (p_updates->>'driver_pickup_lat')::double precision, updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'driver_pickup_lng' THEN
    UPDATE public.jobs SET driver_pickup_lng = (p_updates->>'driver_pickup_lng')::double precision, updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'driver_delivery_lat' THEN
    UPDATE public.jobs SET driver_delivery_lat = (p_updates->>'driver_delivery_lat')::double precision, updated_at = now() WHERE id = v_job.id;
  END IF;
  IF p_updates ? 'driver_delivery_lng' THEN
    UPDATE public.jobs SET driver_delivery_lng = (p_updates->>'driver_delivery_lng')::double precision, updated_at = now() WHERE id = v_job.id;
  END IF;

  RETURN QUERY SELECT * FROM public.get_job_by_token(p_token);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_job_by_token(text, jsonb) TO anon, authenticated;
