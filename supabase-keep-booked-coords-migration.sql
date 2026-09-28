-- confirm_job_step: never overwrite a job's booked pickup/drop-off coordinates.
--
-- It used to write the confirming device's GPS over pickup_lat/lng and
-- delivery_lat/lng, which moved the booked address pin to wherever the handover
-- happened (breaking the map, ETA and "distance from booked address" on the COC).
-- The handover position is proof, not the address: fn_log_pod_steps records it
-- in job_pod_log, and the COC reads it from there (get_job_pod_by_token).
-- p_lat/p_lng now only fill a booked pin that was never set.
--
-- Everything else is unchanged from the live definition as of 2026-09-28.

CREATE OR REPLACE FUNCTION public.confirm_job_step(p_token text, p_step text, p_otp text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_expected_otp text;
  v_at_field text;
  v_max_attempts constant integer := 5;
BEGIN
  SELECT * INTO v_job FROM public.jobs
  WHERE
    (p_step = 'client_pickup'   AND token_client_pickup::text   = p_token) OR
    (p_step = 'driver_pickup'   AND token_driver_pickup::text   = p_token) OR
    (p_step = 'driver_delivery' AND token_driver_delivery::text = p_token) OR
    (p_step = 'client_delivery' AND token_client_delivery::text = p_token);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found or token invalid for this step.';
  END IF;

  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'This job has been cancelled.';
  END IF;

  IF v_job.confirmation_mode = 'driver_only' AND p_step IN ('client_pickup', 'client_delivery') THEN
    RETURN jsonb_build_object('error', 'step_not_applicable');
  END IF;

  IF v_job.otp_attempts >= v_max_attempts THEN
    RETURN jsonb_build_object('error', 'locked');
  END IF;

  CASE p_step
    WHEN 'client_pickup' THEN
      v_expected_otp := v_job.otp_driver_pickup;
      v_at_field := 'client_pickup_at';
    WHEN 'driver_pickup' THEN
      v_expected_otp := v_job.otp_sender;
      v_at_field := 'driver_pickup_at';
    WHEN 'driver_delivery' THEN
      v_expected_otp := v_job.otp_recipient;
      v_at_field := 'driver_delivery_at';
    WHEN 'client_delivery' THEN
      v_expected_otp := v_job.otp_driver_delivery;
      v_at_field := 'client_delivery_at';
    ELSE
      RAISE EXCEPTION 'Unknown step: %', p_step;
  END CASE;

  IF (v_at_field = 'client_pickup_at'   AND v_job.client_pickup_at   IS NOT NULL) OR
     (v_at_field = 'driver_pickup_at'   AND v_job.driver_pickup_at   IS NOT NULL) OR
     (v_at_field = 'driver_delivery_at' AND v_job.driver_delivery_at IS NOT NULL) OR
     (v_at_field = 'client_delivery_at' AND v_job.client_delivery_at IS NOT NULL)
  THEN
    RETURN jsonb_build_object('error', 'already_confirmed');
  END IF;

  IF p_step IN ('driver_delivery', 'client_delivery') AND v_job.driver_pickup_at IS NULL THEN
    RAISE EXCEPTION 'Step not ready. Job must be in status driver_pickup first.';
  END IF;

  IF p_otp IS NULL OR p_otp != v_expected_otp THEN
    UPDATE public.jobs
    SET otp_attempts = otp_attempts + 1, updated_at = now()
    WHERE id = v_job.id;

    IF v_job.otp_attempts + 1 >= v_max_attempts THEN
      RETURN jsonb_build_object('error', 'locked');
    END IF;
    RETURN jsonb_build_object('error', 'invalid_otp');
  END IF;

  -- OTP verified: tag this transaction so trg_log_pod_steps records method = 'otp'.
  PERFORM set_config('nokael.via_otp', '1', true);

  -- Booked coordinates win; the device GPS only fills a pin that was never set.
  IF v_at_field = 'client_pickup_at' THEN
    UPDATE public.jobs SET
      client_pickup_at = now(),
      pickup_lat = COALESCE(pickup_lat, p_lat),
      pickup_lng = COALESCE(pickup_lng, p_lng),
      otp_attempts = 0,
      updated_at = now()
    WHERE id = v_job.id;
  ELSIF v_at_field = 'driver_pickup_at' THEN
    UPDATE public.jobs SET
      driver_pickup_at = now(),
      pickup_lat = COALESCE(pickup_lat, p_lat),
      pickup_lng = COALESCE(pickup_lng, p_lng),
      otp_attempts = 0,
      updated_at = now()
    WHERE id = v_job.id;
  ELSIF v_at_field = 'driver_delivery_at' THEN
    UPDATE public.jobs SET
      driver_delivery_at = now(),
      delivery_lat = COALESCE(delivery_lat, p_lat),
      delivery_lng = COALESCE(delivery_lng, p_lng),
      otp_attempts = 0,
      updated_at = now()
    WHERE id = v_job.id;
  ELSIF v_at_field = 'client_delivery_at' THEN
    UPDATE public.jobs SET
      client_delivery_at = now(),
      delivery_lat = COALESCE(delivery_lat, p_lat),
      delivery_lng = COALESCE(delivery_lng, p_lng),
      otp_attempts = 0,
      updated_at = now()
    WHERE id = v_job.id;
  END IF;

  PERFORM set_config('nokael.via_otp', '', true);

  SELECT * INTO v_job FROM public.jobs WHERE id = v_job.id;
  UPDATE public.jobs SET status = (
    CASE
      WHEN v_job.confirmation_mode = 'driver_only' THEN
        CASE
          WHEN v_job.driver_delivery_at IS NOT NULL THEN 'completed'
          WHEN v_job.driver_pickup_at   IS NOT NULL THEN 'driver_pickup'
          ELSE 'pending'
        END
      ELSE
        CASE
          WHEN v_job.client_delivery_at IS NOT NULL THEN 'completed'
          WHEN v_job.driver_delivery_at IS NOT NULL THEN 'driver_delivery'
          WHEN v_job.driver_pickup_at   IS NOT NULL THEN 'driver_pickup'
          WHEN v_job.client_pickup_at   IS NOT NULL THEN 'client_pickup'
          ELSE 'pending'
        END
    END
  )::public.job_status
  WHERE id = v_job.id;

  RETURN jsonb_build_object('success', true);
END;
$function$;
