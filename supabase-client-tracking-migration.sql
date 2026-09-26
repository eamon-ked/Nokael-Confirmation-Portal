-- NOKAEL — CLIENT TRACKING PAGE (/:token/track) DRIVER CONTACT
-- Safe to run top-to-bottom in the Supabase SQL editor. Purely additive:
-- one new read-only function, no table or existing function changes.
--
-- WHY THIS EXISTS
-- get_job_by_token returns driver_id and live driver_lat/lng but no driver
-- name or phone, so the client tracking page had no way to offer "Call
-- driver". This function returns just the contact card for the driver on
-- the job the token belongs to.
--
-- ACCESS RULES
-- * Client tokens only (token_client_pickup, token_client_delivery,
--   tracking_token). Driver tokens get nothing — drivers don't need it.
-- * Phone is only returned while the job is live. Once the job is
--   completed / cancelled / returned the client keeps the driver's name
--   (it appears on the COC document) but loses the phone number.

CREATE OR REPLACE FUNCTION public.get_job_driver_by_token(p_token text)
RETURNS TABLE(full_name text, phone text, vehicle_type text, vehicle_make text, vehicle_model text, vehicle_plate text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.jobs j
  WHERE j.token_client_pickup::text = p_token
     OR j.token_client_delivery::text = p_token
     OR j.tracking_token = p_token;

  IF NOT FOUND OR v_job.driver_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT d.full_name,
         CASE WHEN v_job.status::text IN ('completed', 'cancelled', 'returned')
              THEN NULL ELSE coalesce(nullif(d.phone, ''), d.whatsapp) END,
         d.vehicle_type, d.vehicle_make, d.vehicle_model, d.vehicle_plate
    FROM public.drivers d
   WHERE d.id = v_job.driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_job_driver_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_job_driver_by_token(text) TO anon, authenticated;
