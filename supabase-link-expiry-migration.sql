-- Client links expire 24 hours after a job is completed.
--
-- After that, every client-facing lookup refuses the job:
--   get_job_by_token / get_job_by_ref  → raise 'link_expired' (the pages redirect
--                                        to booking a new job)
--   get_job_driver_by_token / get_job_pod_by_token → return nothing
-- Not affected: driver tokens (driver links keep working), and signed-in Nokael
-- staff (is_org_member), so the dashboard can still read the job and issue the
-- COC certificate when a client calls dispatch.
--
-- get_job_by_token and get_job_by_ref are otherwise unchanged from their live
-- definitions as of 2026-09-28.

create or replace function public.job_link_expired(p_job public.jobs)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select p_job.status = 'completed'
     and coalesce(greatest(p_job.client_delivery_at, p_job.driver_delivery_at), p_job.updated_at)
         < now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_job_by_token(p_token text)
 RETURNS TABLE(id uuid, job_ref text, status job_status, confirmation_mode text, sender_name text, sender_phone text, recipient_name text, recipient_phone text, pickup_emirate text, pickup_location text, delivery_emirate text, delivery_location text, pickup_lat double precision, pickup_lng double precision, delivery_lat double precision, delivery_lng double precision, item_type item_type, urgency urgency_level, company_name text, driver_id uuid, driver_lat double precision, driver_lng double precision, driver_updated_at timestamp with time zone, locked boolean, cancellation_reason text, cancelled_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, client_pickup_at timestamp with time zone, driver_pickup_at timestamp with time zone, driver_delivery_at timestamp with time zone, client_delivery_at timestamp with time zone, client_pickup_confirmed_at timestamp with time zone, driver_pickup_confirmed_at timestamp with time zone, driver_delivery_confirmed_at timestamp with time zone, client_delivery_confirmed_at timestamp with time zone, driver_arrived_pickup_at timestamp with time zone, driver_arrived_delivery_at timestamp with time zone, sender_ready_at timestamp with time zone, scheduled_pickup_at timestamp with time zone, otp_own character, token_driver_pickup uuid, token_driver_delivery uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_is_driver boolean := false;
BEGIN
  SELECT * INTO v_job FROM public.jobs j
  WHERE j.token_client_pickup::text = p_token
     OR j.token_driver_pickup::text = p_token
     OR j.token_driver_delivery::text = p_token
     OR j.token_client_delivery::text = p_token
     OR j.tracking_token = p_token;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_is_driver := v_job.token_driver_pickup::text = p_token
              OR v_job.token_driver_delivery::text = p_token;

  -- Client links stop working 24 h after completion (driver links and staff excepted).
  IF NOT v_is_driver AND public.job_link_expired(v_job) AND NOT public.is_org_member(v_job.organization_id) THEN
    RAISE EXCEPTION 'link_expired';
  END IF;

  RETURN QUERY SELECT
    v_job.id, v_job.job_ref, v_job.status, v_job.confirmation_mode,
    v_job.sender_name, v_job.sender_phone, v_job.recipient_name, v_job.recipient_phone,
    v_job.pickup_emirate, v_job.pickup_location,
    v_job.delivery_emirate, v_job.delivery_location,
    v_job.pickup_lat, v_job.pickup_lng, v_job.delivery_lat, v_job.delivery_lng,
    v_job.item_type, v_job.urgency, v_job.company_name,
    v_job.driver_id, v_job.driver_lat, v_job.driver_lng, v_job.driver_updated_at,
    v_job.locked, v_job.cancellation_reason, v_job.cancelled_at, v_job.created_at, v_job.updated_at,
    v_job.client_pickup_at, v_job.driver_pickup_at, v_job.driver_delivery_at, v_job.client_delivery_at,
    v_job.client_pickup_confirmed_at, v_job.driver_pickup_confirmed_at,
    v_job.driver_delivery_confirmed_at, v_job.client_delivery_confirmed_at,
    v_job.driver_arrived_pickup_at, v_job.driver_arrived_delivery_at,
    v_job.sender_ready_at, v_job.scheduled_pickup_at,
    CASE
      WHEN v_job.token_client_pickup::text = p_token THEN v_job.otp_sender
      WHEN v_job.token_driver_pickup::text = p_token THEN v_job.otp_driver_pickup
      WHEN v_job.token_driver_delivery::text = p_token THEN v_job.otp_driver_delivery
      WHEN v_job.token_client_delivery::text = p_token THEN v_job.otp_recipient
      ELSE NULL
    END,
    CASE WHEN v_is_driver THEN v_job.token_driver_pickup ELSE NULL END,
    CASE WHEN v_is_driver THEN v_job.token_driver_delivery ELSE NULL END;
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_job_by_ref(p_query text)
 RETURNS TABLE(id uuid, job_ref text, status job_status, pickup_emirate text, pickup_location text, delivery_emirate text, delivery_location text, pickup_lat double precision, pickup_lng double precision, delivery_lat double precision, delivery_lng double precision, item_type item_type, urgency urgency_level, company_name text, driver_id uuid, locked boolean, cancellation_reason text, cancelled_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, client_pickup_at timestamp with time zone, driver_pickup_at timestamp with time zone, driver_delivery_at timestamp with time zone, client_delivery_at timestamp with time zone, client_pickup_confirmed_at timestamp with time zone, driver_pickup_confirmed_at timestamp with time zone, driver_delivery_confirmed_at timestamp with time zone, client_delivery_confirmed_at timestamp with time zone, driver_arrived_pickup_at timestamp with time zone, driver_arrived_delivery_at timestamp with time zone, sender_ready_at timestamp with time zone, scheduled_pickup_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.jobs j
  WHERE (p_query ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (j.id = p_query::uuid OR j.quote_id = p_query::uuid))
     OR j.job_ref ILIKE p_query
     OR j.tracking_token = p_query
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF public.job_link_expired(v_job) AND NOT public.is_org_member(v_job.organization_id) THEN
    RAISE EXCEPTION 'link_expired';
  END IF;

  RETURN QUERY SELECT
    v_job.id, v_job.job_ref, v_job.status,
    v_job.pickup_emirate, v_job.pickup_location,
    v_job.delivery_emirate, v_job.delivery_location,
    v_job.pickup_lat, v_job.pickup_lng, v_job.delivery_lat, v_job.delivery_lng,
    v_job.item_type, v_job.urgency, v_job.company_name,
    v_job.driver_id,
    v_job.locked, v_job.cancellation_reason, v_job.cancelled_at, v_job.created_at, v_job.updated_at,
    v_job.client_pickup_at, v_job.driver_pickup_at, v_job.driver_delivery_at, v_job.client_delivery_at,
    v_job.client_pickup_confirmed_at, v_job.driver_pickup_confirmed_at,
    v_job.driver_delivery_confirmed_at, v_job.client_delivery_confirmed_at,
    v_job.driver_arrived_pickup_at, v_job.driver_arrived_delivery_at,
    v_job.sender_ready_at, v_job.scheduled_pickup_at;
END;
$function$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_job_driver_by_token(p_token text)
 RETURNS TABLE(full_name text, phone text, vehicle_type text, vehicle_make text, vehicle_model text, vehicle_plate text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF public.job_link_expired(v_job) AND NOT public.is_org_member(v_job.organization_id) THEN
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
$function$;

-- ---------------------------------------------------------------------------
create or replace function public.get_job_pod_by_token(p_token text)
returns table (
  step text,
  method text,
  driver_lat double precision,
  driver_lng double precision,
  accuracy_m double precision,
  fix_age_s integer,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with job as (
    select j.id from public.jobs j
     where (j.token_client_pickup::text = p_token
        or j.token_driver_pickup::text = p_token
        or j.token_driver_delivery::text = p_token
        or j.token_client_delivery::text = p_token
        or j.tracking_token = p_token)
       and not (public.job_link_expired(j) and not public.is_org_member(j.organization_id))
     limit 1
  ),
  latest as (
    select distinct on (l.step) l.*
      from public.job_pod_log l
      join job on job.id = l.job_id
     order by l.step, l.created_at desc
  )
  select step, method, driver_lat, driver_lng, accuracy_m::double precision, fix_age_s, created_at
    from latest
   where action = 'confirmed';
$$;
