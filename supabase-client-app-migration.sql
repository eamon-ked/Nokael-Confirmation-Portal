-- ============================================================
-- Client app: post-delivery survey + installable re-booking PWA
-- Safe to run top-to-bottom in the Supabase SQL editor.
-- ============================================================
-- WHY
--   The tracking link (/:token/track) closes 24h after delivery, so it can't
--   be what an installed home-screen app opens. Once a job is completed we
--   issue a long-lived client app token per (job, party); the PWA's
--   start_url is /app/<token>. From there the client re-books, which lands
--   in quote_requests (source = 'rebook') and fires the existing staff push
--   (_push_on_quote trigger).
--
--   The delivered page also asks: star rating, comment, where they heard of
--   us. Stored per (job, party) in job_client_feedback and mirrored to
--   job_ratings (one row per job — the sender's answer wins).
--
-- ACCESS RULES
--   • Only the two CLIENT link tokens can issue an app token or give
--     feedback. Driver tokens are refused.
--   • client_app_issue works for completed jobs even after the 24h link
--     expiry (the delivered page may be reopened later from history).
--   • An app token only ever reads its own holder's name/phone, the org's
--     public profile, and routes of jobs that holder sent or received.
--   • Re-bookings are rate-limited to 5 per app token per 24h.
--   • The Google review link lives in organizations.branding.google_review_url
--     (already exposed by _org_public_profile); org owners/admins set it with
--     org_set_google_review_url.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.client_app_tokens (
  token           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  party           text not null check (party in ('sender', 'recipient')),
  name            text,
  phone           text,
  created_at      timestamptz not null default now(),
  last_opened_at  timestamptz,
  installed_at    timestamptz,
  unique (job_id, party)
);
create index if not exists client_app_tokens_org_idx on public.client_app_tokens (organization_id, created_at desc);

create table if not exists public.job_client_feedback (
  job_id                   uuid not null references public.jobs(id) on delete cascade,
  party                    text not null check (party in ('sender', 'recipient')),
  organization_id          uuid not null references public.organizations(id) on delete cascade,
  rating                   smallint check (rating between 1 and 5),
  comment                  text,
  lead_source              text check (lead_source in
                             ('google','instagram','tiktok','facebook','linkedin','referral','repeat','saw_vehicle','other')),
  lead_source_other        text,
  google_review_clicked_at timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (job_id, party)
);
create index if not exists job_client_feedback_org_idx on public.job_client_feedback (organization_id, created_at desc);

alter table public.client_app_tokens   enable row level security;
alter table public.job_client_feedback enable row level security;

drop policy if exists client_app_tokens_select_members on public.client_app_tokens;
create policy client_app_tokens_select_members on public.client_app_tokens
  for select using (public.is_org_member(organization_id));

drop policy if exists job_client_feedback_select_members on public.job_client_feedback;
create policy job_client_feedback_select_members on public.job_client_feedback
  for select using (public.is_org_member(organization_id));

alter table public.quote_requests add column if not exists source           text not null default 'website';
alter table public.quote_requests add column if not exists rebook_of_job_id uuid references public.jobs(id) on delete set null;
alter table public.quote_requests add column if not exists client_app_token uuid references public.client_app_tokens(token) on delete set null;
alter table public.quote_requests add column if not exists preferred_date   date;
alter table public.quote_requests add column if not exists notes            text;

do $$ begin
  alter publication supabase_realtime add table public.job_client_feedback;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------- helpers ----------
-- Resolves a client link token to (job, party). Driver tokens → no row.
create or replace function public._client_link_job(p_token text)
returns table (job_id uuid, party text)
language sql stable security definer set search_path = public
as $$
  select j.id, case when j.token_client_pickup::text = p_token then 'sender' else 'recipient' end
    from public.jobs j
   where p_token is not null and length(p_token) <= 64
     and (j.token_client_pickup::text = p_token or j.token_client_delivery::text = p_token)
   limit 1;
$$;
revoke all on function public._client_link_job(text) from public, anon, authenticated;

-- Last 9 digits: matches +9715…, 05…, 9715… forms of the same number.
create or replace function public._phone_key(p text)
returns text language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '');
$$;

-- ---------- issue an app token from the delivered tracking page ----------
create or replace function public.client_app_issue(p_link_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_job   public.jobs;
  v_party text;
  v_id    uuid;
  v_tok   uuid;
begin
  select c.job_id, c.party into v_id, v_party from public._client_link_job(p_link_token) c;
  select * into v_job from public.jobs where id = v_id;
  if v_job.id is null or v_job.status <> 'completed' then
    return null;
  end if;

  insert into public.client_app_tokens (organization_id, job_id, party, name, phone)
  values (v_job.organization_id, v_job.id, v_party,
          case v_party when 'sender' then coalesce(v_job.sender_name, v_job.client_name) else v_job.recipient_name end,
          case v_party when 'sender' then coalesce(v_job.sender_phone, v_job.client_whatsapp) else v_job.recipient_phone end)
  on conflict (job_id, party) do update set job_id = excluded.job_id
  returning token into v_tok;
  return v_tok;
end $$;

-- ---------- survey ----------
create or replace function public.client_feedback_submit(
  p_link_token text, p_rating int, p_lead_source text, p_lead_source_other text default null, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_job   public.jobs;
  v_party text;
  v_id    uuid;
begin
  select c.job_id, c.party into v_id, v_party from public._client_link_job(p_link_token) c;
  select * into v_job from public.jobs where id = v_id;
  if v_job.id is null or v_job.status <> 'completed' then
    raise exception 'not_available';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise exception 'bad_rating';
  end if;

  insert into public.job_client_feedback as f
         (job_id, party, organization_id, rating, comment, lead_source, lead_source_other)
  values (v_job.id, v_party, v_job.organization_id, p_rating,
          left(nullif(btrim(p_comment), ''), 2000), nullif(p_lead_source, ''),
          left(nullif(btrim(p_lead_source_other), ''), 120))
  on conflict (job_id, party) do update
     set rating = coalesce(excluded.rating, f.rating),
         comment = coalesce(excluded.comment, f.comment),
         lead_source = coalesce(excluded.lead_source, f.lead_source),
         lead_source_other = coalesce(excluded.lead_source_other, f.lead_source_other),
         updated_at = now();

  -- Mirror into job_ratings (one per job): the sender's rating wins, a
  -- recipient's only fills an empty slot. Never overwrite an operator rating.
  if p_rating is not null and v_job.driver_id is not null then
    insert into public.job_ratings as r (job_id, driver_id, rating, feedback_text, rated_by)
    values (v_job.id, v_job.driver_id, p_rating, left(nullif(btrim(p_comment), ''), 2000), 'client')
    on conflict (job_id) do update
       set rating = excluded.rating, feedback_text = excluded.feedback_text, rated_at = now()
     where r.rated_by = 'client' and v_party = 'sender';
  end if;
end $$;

create or replace function public.client_feedback_review_click(p_link_token text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_job   public.jobs;
  v_party text;
  v_id    uuid;
begin
  select c.job_id, c.party into v_id, v_party from public._client_link_job(p_link_token) c;
  select * into v_job from public.jobs where id = v_id;
  if v_job.id is null then return; end if;
  update public.job_client_feedback
     set google_review_clicked_at = coalesce(google_review_clicked_at, now())
   where job_id = v_job.id and party = v_party;
end $$;

-- Does this link already have feedback? (so the page shows "thanks" on reopen)
create or replace function public.client_feedback_get(p_link_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_job   public.jobs;
  v_party text;
  v_id    uuid;
begin
  select c.job_id, c.party into v_id, v_party from public._client_link_job(p_link_token) c;
  select * into v_job from public.jobs where id = v_id;
  if v_job.id is null then return null; end if;
  return (select jsonb_build_object('rating', f.rating, 'lead_source', f.lead_source,
                                    'review_clicked', f.google_review_clicked_at is not null)
            from public.job_client_feedback f where f.job_id = v_job.id and f.party = v_party);
end $$;

-- ---------- the installed app ----------
create or replace function public.client_app_get(p_app_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  t      public.client_app_tokens;
  v_key  text;
  v_recent jsonb;
begin
  if p_app_token is null or length(p_app_token) > 64 then return null; end if;
  select * into t from public.client_app_tokens where token::text = p_app_token;
  if not found then return null; end if;

  update public.client_app_tokens set last_opened_at = now() where token = t.token;
  v_key := public._phone_key(t.phone);

  -- Distinct recent routes this person sent or received (their own jobs only).
  select coalesce(jsonb_agg(r order by r.last_at desc), '[]'::jsonb) into v_recent from (
    select distinct on (lower(j.pickup_location), lower(j.delivery_location))
           j.pickup_location, j.delivery_location, j.pickup_emirate, j.delivery_emirate,
           j.pickup_lat, j.pickup_lng, j.delivery_lat, j.delivery_lng, j.item_type,
           j.created_at as last_at
      from public.jobs j
     where j.organization_id = t.organization_id
       and j.status <> 'cancelled'
       and (j.id = t.job_id
            or (v_key is not null and (public._phone_key(j.sender_phone) = v_key
                                       or public._phone_key(j.client_whatsapp) = v_key
                                       or public._phone_key(j.recipient_phone) = v_key)))
     order by lower(j.pickup_location), lower(j.delivery_location), j.created_at desc
  ) r
  where r.pickup_location is not null and r.delivery_location is not null;

  return jsonb_build_object(
    'org', public._org_public_profile(t.organization_id),
    'name', t.name,
    'phone', t.phone,
    'party', t.party,
    'installed', t.installed_at is not null,
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from
                 (select x from jsonb_array_elements(v_recent) x limit 5) s)
  );
end $$;

create or replace function public.client_app_mark_installed(p_app_token text)
returns void
language sql security definer set search_path = public
as $$
  update public.client_app_tokens set installed_at = coalesce(installed_at, now())
   where token::text = p_app_token;
$$;

create or replace function public.client_app_rebook(
  p_app_token   text,
  p_pickup      text,
  p_delivery    text,
  p_item_type   text default 'parcel',
  p_urgency     text default 'today',
  p_preferred_date date default null,
  p_notes       text default null,
  p_pickup_emirate text default null,
  p_pickup_lat  double precision default null,
  p_pickup_lng  double precision default null,
  p_delivery_lat double precision default null,
  p_delivery_lng double precision default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  t     public.client_app_tokens;
  v_job public.jobs;
  v_ref text;
begin
  if p_app_token is null or length(p_app_token) > 64 then raise exception 'not_found'; end if;
  select * into t from public.client_app_tokens where token::text = p_app_token;
  if not found then raise exception 'not_found'; end if;
  if nullif(btrim(p_pickup), '') is null or nullif(btrim(p_delivery), '') is null then
    raise exception 'missing_address';
  end if;
  if (select count(*) from public.quote_requests q
       where q.client_app_token = t.token and q.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'rate_limited';
  end if;

  select * into v_job from public.jobs where id = t.job_id;
  v_ref := 'NK-' || (1000 + floor(random() * 9000))::int;

  insert into public.quote_requests
    (organization_id, source, rebook_of_job_id, client_app_token, tracking_id,
     name, phone, whatsapp_opt_in, company_name, customer_type, repeat_business,
     pickup_location, delivery_location, emirate, item_type, urgency, preferred_date, notes,
     pickup_lat, pickup_lng, delivery_lat, delivery_lng,
     utm_source, utm_medium, status)
  values
    (t.organization_id, 'rebook', t.job_id, t.token, v_ref,
     coalesce(t.name, 'Returning client'), t.phone, true,
     case when t.party = 'sender' then v_job.company_name end,
     case when v_job.business_id is not null and t.party = 'sender' then 'business' else 'personal' end,
     true,
     left(btrim(p_pickup), 500), left(btrim(p_delivery), 500),
     coalesce(nullif(p_pickup_emirate, ''), v_job.pickup_emirate),
     case when p_item_type in ('document','parcel','spare_part','other') then p_item_type else 'parcel' end,
     case when p_urgency in ('immediate','today','scheduled') then p_urgency else 'today' end,
     p_preferred_date, left(nullif(btrim(p_notes), ''), 1000),
     p_pickup_lat, p_pickup_lng, p_delivery_lat, p_delivery_lng,
     'client_app', 'pwa', 'pending');

  return v_ref;
end $$;

-- ---------- org setting: Google review link ----------
create or replace function public.org_set_google_review_url(p_org uuid, p_url text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.org_members m
                  where m.organization_id = p_org and m.user_id = auth.uid()
                    and m.role in ('owner', 'admin')) then
    raise exception 'forbidden';
  end if;
  if nullif(btrim(p_url), '') is not null and p_url !~* '^https://' then
    raise exception 'bad_url';
  end if;
  update public.organizations
     set branding = case when nullif(btrim(p_url), '') is null
                         then coalesce(branding, '{}'::jsonb) - 'google_review_url'
                         else coalesce(branding, '{}'::jsonb) || jsonb_build_object('google_review_url', btrim(p_url)) end
   where id = p_org;
end $$;

-- ---------- re-book push wording ----------
create or replace function public._push_on_quote()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.push_enqueue('staff', new.organization_id, null, null, null,
    case when new.source = 'rebook' then 'Re-booking from client app' else 'New quote request' end,
    coalesce(nullif(btrim(new.company_name), ''), nullif(btrim(new.name), ''), 'A customer') || ': '
      || public._push_place(new.pickup_location) || ' → ' || public._push_place(new.delivery_location),
    '/dashboard', 'quote:' || new.id);
  return null;
end $$;

grant execute on function public.client_app_issue(text)                         to anon, authenticated;
grant execute on function public.client_feedback_submit(text, int, text, text, text) to anon, authenticated;
grant execute on function public.client_feedback_review_click(text)             to anon, authenticated;
grant execute on function public.client_feedback_get(text)                      to anon, authenticated;
grant execute on function public.client_app_get(text)                           to anon, authenticated;
grant execute on function public.client_app_mark_installed(text)                to anon, authenticated;
grant execute on function public.client_app_rebook(text, text, text, text, text, date, text, text,
                                                   double precision, double precision,
                                                   double precision, double precision) to anon, authenticated;
grant execute on function public.org_set_google_review_url(uuid, text)          to authenticated;
