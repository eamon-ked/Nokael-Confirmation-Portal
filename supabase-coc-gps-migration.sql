-- COC certificate: GPS at each handover.
--
-- fn_log_pod_steps already records the driver's last fix (driver_location_tracking,
-- no older than 5 minutes) in job_pod_log every time a custody step is confirmed.
-- This hands those fixes to the /:token/track page so the certificate can print
-- where each handover happened. Same token rules as get_job_by_token.
--
-- Per step, only the most recent log row counts: a step that ops reverted and
-- was never re-confirmed returns nothing.

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
     where j.token_client_pickup::text = p_token
        or j.token_driver_pickup::text = p_token
        or j.token_driver_delivery::text = p_token
        or j.token_client_delivery::text = p_token
        or j.tracking_token = p_token
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

revoke all on function public.get_job_pod_by_token(text) from public;
grant execute on function public.get_job_pod_by_token(text) to anon, authenticated;
