-- REALTIME BROADCAST FOR public.jobs
-- Run this against the live Supabase project (SQL editor or migration
-- pipeline) once. Additive only -- does not touch supabase-schema.sql's
-- existing RLS/RPC security model.
--
-- WHY THIS EXISTS
-- The jobs table has RLS enabled with all permissive SELECT/UPDATE
-- policies dropped (see supabase-schema.sql's "default-deny access"
-- section) -- all real reads/writes go through the token-gated,
-- SECURITY DEFINER get_job_by_token / update_job_by_token /
-- confirm_job_step RPCs, which redact OTPs per-caller.
--
-- That means Supabase's standard "Postgres Changes" realtime (which
-- requires the row to be SELECT-able under RLS for the subscribing role)
-- cannot be used here -- an anon-key client would receive nothing, since
-- there is no anon SELECT policy on jobs. This migration uses Broadcast
-- from Database instead: a trigger sends a tiny, sanitized "something
-- changed" signal over a PUBLIC channel (no job data, no OTPs, no PII),
-- and clients react to that signal by re-running the existing secure
-- get_job_by_token RPC -- exactly the same call the old polling loop
-- made, just triggered by an event instead of a timer. The redaction
-- logic in get_job_by_token is completely untouched.
--
-- Because the channel is PUBLIC (is_private = false in realtime.send),
-- no RLS policy on realtime.messages is required and no Supabase Auth
-- session is needed -- consistent with this app's anon-key, no-auth-user
-- design. Public just means "anyone can subscribe to the topic without
-- authenticating"; it does NOT mean anyone can read job data, because no
-- job data is ever placed in the payload.

create or replace function public.broadcast_job_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('job_id', new.id, 'updated_at', new.updated_at),
    'job_updated',              -- event name clients listen for
    'job:' || new.id::text,     -- topic, scoped per job row
    false                       -- public channel -- payload has no secrets
  );
  return new;
end;
$$;

drop trigger if exists jobs_broadcast_change on public.jobs;

create trigger jobs_broadcast_change
after insert or update on public.jobs
for each row
execute function public.broadcast_job_change();

-- Nothing else required. No GRANTs needed since the function is
-- SECURITY DEFINER and realtime.send is called server-side, not by the
-- client role.

-- OPTIONAL FOLLOW-UP (not part of this migration, noted for later):
-- The driver status screen's "active jobs" list still polls
-- get_driver_active_jobs_session every 15s because there's no single job
-- row to key a topic off of before a job is assigned. A `driver:<driver_id>`
-- topic broadcast on jobs.driver_id assignment (or on drivers.status
-- change) would close that gap the same way, but is deliberately left out
-- here to keep this migration narrowly scoped to the two screens (job hub,
-- confirmation) that already have a concrete job id to key off of.
