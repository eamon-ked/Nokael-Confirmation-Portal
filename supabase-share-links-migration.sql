-- ============================================================
-- Share links: permanent certificate link + booking from the client portal
-- Safe to run top-to-bottom in the Supabase SQL editor.
-- ============================================================
-- WHY
--   Client tracking links close 24h after delivery, so a client who came
--   back later lost their certificate and dispatch had to download and
--   attach the PDF by hand. Business clients on /portal could see their
--   deliveries but not download a certificate or book a new one.
--
--   1. get_certificate(token)      → /:token/certificate on the portal.
--      Any client link token of a COMPLETED job keeps opening its Chain of
--      Custody certificate. It returns only what the PDF prints: no codes,
--      no driver phone, no live GPS.
--   2. client_certificate_token(job) → the signed-in /portal client (or staff)
--      gets the certificate link of any delivered job of their company.
--   3. client_book(business, ...)  → "Book a delivery" on /portal. Lands in
--      quote_requests (source 'business_portal', business_id set) and fires
--      the staff push like any quote.
--
-- ACCESS RULES
--   • Certificates only for status = 'completed'.
--   • Portal access uses _can_read_business (client_members or org staff).
--   • Booking needs a client_members row; 20 requests per company per 24h.
-- ============================================================

alter table public.quote_requests add column if not exists business_id uuid
  references public.business_inquiries(id) on delete set null;

-- ---------- certificate (no expiry for completed jobs) ----------
create or replace function public._certificate_json(p_job public.jobs)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'org', public._org_public_profile(p_job.organization_id),
    'job', jsonb_build_object(
      'id', p_job.id, 'job_ref', p_job.job_ref, 'status', p_job.status, 'job_kind', p_job.job_kind,
      'confirmation_mode', p_job.confirmation_mode, 'company_name', p_job.company_name,
      'created_at', p_job.created_at, 'updated_at', p_job.updated_at,
      'sender_name', p_job.sender_name, 'recipient_name', p_job.recipient_name,
      'pickup_emirate', p_job.pickup_emirate, 'pickup_location', p_job.pickup_location,
      'pickup_lat', p_job.pickup_lat, 'pickup_lng', p_job.pickup_lng,
      'delivery_emirate', p_job.delivery_emirate, 'delivery_location', p_job.delivery_location,
      'delivery_lat', p_job.delivery_lat, 'delivery_lng', p_job.delivery_lng,
      'item_type', p_job.item_type, 'urgency', p_job.urgency,
      'client_pickup_at', p_job.client_pickup_at, 'driver_pickup_at', p_job.driver_pickup_at,
      'driver_delivery_at', p_job.driver_delivery_at, 'client_delivery_at', p_job.client_delivery_at,
      'client_pickup_confirmed_at', p_job.client_pickup_confirmed_at,
      'driver_pickup_confirmed_at', p_job.driver_pickup_confirmed_at,
      'driver_delivery_confirmed_at', p_job.driver_delivery_confirmed_at,
      'client_delivery_confirmed_at', p_job.client_delivery_confirmed_at,
      'driver_arrived_pickup_at', p_job.driver_arrived_pickup_at,
      'driver_arrived_delivery_at', p_job.driver_arrived_delivery_at,
      'sender_ready_at', p_job.sender_ready_at,
      'stops', case when p_job.job_kind <> 'one_way' then public.job_stops_json(p_job.id, null) end,
      'waits', public.job_waits_json(p_job.id)),
    'driver', (select jsonb_build_object('full_name', d.full_name, 'phone', null,
                 'vehicle_type', d.vehicle_type, 'vehicle_make', d.vehicle_make,
                 'vehicle_model', d.vehicle_model, 'vehicle_plate', d.vehicle_plate)
                 from public.drivers d where d.id = p_job.driver_id),
    'pod', (select coalesce(jsonb_agg(jsonb_build_object(
               'step', l.step, 'method', l.method, 'driver_lat', l.driver_lat, 'driver_lng', l.driver_lng,
               'accuracy_m', l.accuracy_m, 'fix_age_s', l.fix_age_s, 'confirmed_at', l.created_at,
               'stop_id', l.stop_id)), '[]'::jsonb)
              from (select distinct on (x.step, x.stop_id) x.*
                      from public.job_pod_log x
                     where x.job_id = p_job.id
                     order by x.step, x.stop_id, x.created_at desc) l
             where l.action = 'confirmed'));
$$;
revoke all on function public._certificate_json(public.jobs) from public, anon, authenticated;

create or replace function public.get_certificate(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_job public.jobs;
begin
  if p_token is not null then
    if length(p_token) > 64 then return null; end if;
    select * into v_job from public.jobs j
     where j.token_client_pickup::text = p_token
        or j.token_client_delivery::text = p_token
        or j.tracking_token = p_token
     limit 1;
    if v_job.id is null then
      select * into v_job from public.jobs j
       where j.id = public._stop_link_job(p_token) and j.job_kind <> 'one_way';
    end if;
  end if;

  if v_job.id is null or v_job.status <> 'completed' then return null; end if;
  return public._certificate_json(v_job);
end $$;

-- The signed-in /portal client opens a delivered job's certificate link.
create or replace function public.client_certificate_token(p_job uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(j.token_client_pickup::text, j.tracking_token)
    from public.jobs j
   where j.id = p_job and j.status = 'completed'
     and j.business_id is not null and public._can_read_business(j.business_id);
$$;

-- ---------- booking from the business client portal ----------
create or replace function public.client_book(
  p_business_id  uuid,
  p_pickup       text,
  p_delivery     text,
  p_item_type    text default 'parcel',
  p_urgency      text default 'today',
  p_preferred_date date default null,
  p_notes        text default null,
  p_recipient    text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  b       public.business_inquiries;
  v_email text;
  v_ref   text;
begin
  if not exists (select 1 from public.client_members m
                  where m.business_id = p_business_id and m.user_id = auth.uid()) then
    raise exception 'not_authorized';
  end if;
  select * into b from public.business_inquiries where id = p_business_id;
  if nullif(btrim(p_pickup), '') is null or nullif(btrim(p_delivery), '') is null then
    raise exception 'missing_address';
  end if;
  if (select count(*) from public.quote_requests q
       where q.business_id = b.id and q.source = 'business_portal'
         and q.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate_limited';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  v_ref := 'NK-' || (1000 + floor(random() * 9000))::int;

  insert into public.quote_requests
    (organization_id, source, business_id, tracking_id,
     name, phone, whatsapp_opt_in, company_name, customer_type, repeat_business, corporate_code,
     pickup_location, delivery_location, item_type, urgency, preferred_date, notes,
     utm_source, utm_medium, status)
  values
    (b.organization_id, 'business_portal', b.id, v_ref,
     coalesce(nullif(btrim(b.contact_person), ''), b.company_name), b.phone_whatsapp, true,
     b.company_name, 'business', true, b.corporate_code,
     left(btrim(p_pickup), 500), left(btrim(p_delivery), 500),
     case when p_item_type in ('document','parcel','spare_part','other') then p_item_type else 'parcel' end,
     case when p_urgency in ('immediate','today','scheduled') then p_urgency else 'today' end,
     p_preferred_date,
     left(concat_ws(E'\n',
       case when nullif(btrim(p_recipient), '') is not null then 'Recipient: ' || btrim(p_recipient) end,
       nullif(btrim(p_notes), ''),
       case when v_email is not null then 'Booked by ' || v_email || ' on the client portal' end), 1500),
     'business_portal', 'portal', 'pending');

  return v_ref;
end $$;

-- ---------- staff push wording ----------
create or replace function public._push_on_quote()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.push_enqueue('staff', new.organization_id, null, null, null,
    case new.source
      when 'rebook' then 'Re-booking from client app'
      when 'business_portal' then 'Booking from client portal'
      else 'New quote request' end,
    coalesce(nullif(btrim(new.company_name), ''), nullif(btrim(new.name), ''), 'A customer') || ': '
      || public._push_place(new.pickup_location) || ' → ' || public._push_place(new.delivery_location),
    '/dashboard', 'quote:' || new.id);
  return null;
end $$;

grant execute on function public.get_certificate(text) to anon, authenticated;
grant execute on function public.client_certificate_token(uuid) to authenticated;
revoke execute on function public.client_book(uuid, text, text, text, text, date, text, text) from public, anon;
grant execute on function public.client_book(uuid, text, text, text, text, date, text, text) to authenticated;
