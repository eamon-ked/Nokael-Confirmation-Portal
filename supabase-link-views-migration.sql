-- Client link views: when the sender / recipient opened the link dispatch sent
-- them, and when they were last looking at it.
--
-- One row per job and party. The tracking and confirmation pages call
-- track_link_seen(token) when they open and every couple of minutes while on
-- screen; only the two client tokens count (driver tokens are ignored). Writes
-- are throttled to one a minute per party. The dashboard reads the rows (org
-- members only) and gets them live over realtime.
--
-- A separate table rather than columns on jobs, so a client looking at the page
-- doesn't fire the jobs triggers (driver status, push, updated_at) or ripple a
-- realtime update to everyone watching the job.

create table if not exists public.job_link_views (
  job_id          uuid        not null references public.jobs(id) on delete cascade,
  party           text        not null check (party in ('sender', 'recipient')),
  organization_id uuid,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  visits          integer     not null default 1,
  primary key (job_id, party)
);

alter table public.job_link_views enable row level security;

drop policy if exists job_link_views_read on public.job_link_views;
create policy job_link_views_read on public.job_link_views
  for select to authenticated
  using (public.is_org_member(organization_id));

do $$ begin
  alter publication supabase_realtime add table public.job_link_views;
exception when duplicate_object then null;
end $$;

-- p_new_visit: the page was just opened (or came back after a long time away),
-- so count a visit; otherwise it's a "still looking" heartbeat.
create or replace function public.track_link_seen(p_token text, p_new_visit boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job   public.jobs%rowtype;
  v_party text;
begin
  if p_token is null or length(p_token) > 64 then
    return;
  end if;

  select * into v_job from public.jobs j
   where j.token_client_pickup::text = p_token
      or j.token_client_delivery::text = p_token;
  if not found then
    return;
  end if;

  v_party := case when v_job.token_client_pickup::text = p_token then 'sender' else 'recipient' end;

  insert into public.job_link_views as v (job_id, party, organization_id)
  values (v_job.id, v_party, v_job.organization_id)
  on conflict (job_id, party) do update
     set last_seen_at = now(),
         visits = v.visits + case when p_new_visit then 1 else 0 end
   where p_new_visit or v.last_seen_at < now() - interval '50 seconds';
end;
$function$;

revoke all on function public.track_link_seen(text, boolean) from public;
grant execute on function public.track_link_seen(text, boolean) to anon, authenticated;
