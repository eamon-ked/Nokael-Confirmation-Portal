-- ============================================================
-- Clients share their exact location from their link
-- Safe to run top-to-bottom in the Supabase SQL editor.
-- ============================================================
-- WHY
--   Dispatch often doesn't know the exact drop-off (or pickup) spot: villas,
--   compounds, warehouses with several gates. The person at that stop does.
--   Their tracking link now offers "Share my exact location": one tap sends
--   the phone's GPS fix, which becomes the stop's pin for the driver's
--   navigation, ETA and arrival check.
--
-- RULES
--   • Sender link → pickup pin, recipient link → drop-off pin, stop link → that stop.
--   • Only until the driver arrives at that stop (then the pin is what the
--     driver is standing at, and changing it would only confuse).
--   • Fixes worse than 250 m are refused: the client is asked to try again
--     with precise location on.
--   • Dispatch and the assigned driver get a push.
-- ============================================================

alter table public.jobs
  add column if not exists pickup_pin_shared_at timestamptz,
  add column if not exists pickup_pin_accuracy_m integer,
  add column if not exists delivery_pin_shared_at timestamptz,
  add column if not exists delivery_pin_accuracy_m integer;

alter table public.job_stops
  add column if not exists pin_shared_at timestamptz,
  add column if not exists pin_accuracy_m integer;

create or replace function public.share_my_location(
  p_token      text,
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v       uuid;
  j       public.jobs%rowtype;
  st      public.job_stops%rowtype;
  v_leg   text;
  v_who   text;
  v_acc   integer := case when p_accuracy_m is null then null else round(p_accuracy_m)::integer end;
begin
  begin v := p_token::uuid; exception when others then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 or (p_lat = 0 and p_lng = 0) then
    return jsonb_build_object('ok', false, 'error', 'bad_point');
  end if;
  if v_acc is not null and v_acc > 250 then
    return jsonb_build_object('ok', false, 'error', 'inaccurate', 'accuracy_m', v_acc);
  end if;

  select * into j from public.jobs where token_client_pickup = v for update;
  if found then
    v_leg := 'pickup'; v_who := 'The sender';
  else
    select * into j from public.jobs where token_client_delivery = v for update;
    if found then
      v_leg := 'delivery'; v_who := 'The recipient';
    else
      select * into st from public.job_stops where token = v for update;
      if not found then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
      select * into j from public.jobs where id = st.job_id;
      v_leg := 'stop'; v_who := coalesce(nullif(btrim(st.contact_name), ''), 'Stop ' || st.seq);
    end if;
  end if;

  if j.status in ('completed', 'cancelled', 'returned') then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if v_leg = 'stop' then
    if st.arrived_at is not null or st.handed_at is not null or st.skipped_at is not null then
      return jsonb_build_object('ok', false, 'error', 'driver_arrived');
    end if;
    update public.job_stops
       set lat = p_lat, lng = p_lng, pin_shared_at = now(), pin_accuracy_m = v_acc, updated_at = now()
     where id = st.id;
  elsif j.job_kind <> 'one_way' then
    return jsonb_build_object('ok', false, 'error', 'not_supported');
  elsif v_leg = 'pickup' then
    if j.driver_arrived_pickup_at is not null or j.driver_pickup_at is not null or j.client_pickup_at is not null then
      return jsonb_build_object('ok', false, 'error', 'driver_arrived');
    end if;
    update public.jobs
       set pickup_lat = p_lat, pickup_lng = p_lng, pickup_pin_shared_at = now(), pickup_pin_accuracy_m = v_acc, updated_at = now()
     where id = j.id;
  else
    if j.driver_arrived_delivery_at is not null or j.driver_delivery_at is not null or j.client_delivery_at is not null then
      return jsonb_build_object('ok', false, 'error', 'driver_arrived');
    end if;
    update public.jobs
       set delivery_lat = p_lat, delivery_lng = p_lng, delivery_pin_shared_at = now(), delivery_pin_accuracy_m = v_acc, updated_at = now()
     where id = j.id;
  end if;

  -- The reminder ETA was for the old point: recheck on the next run.
  update public.job_reminder_state set eta_checked_at = null where job_id = j.id;

  perform public.push_enqueue('staff', j.organization_id, null, null, j.id,
    'Exact location shared',
    coalesce(j.job_ref, 'Job') || ': ' || v_who || ' shared their ' ||
      case v_leg when 'pickup' then 'pickup' when 'delivery' then 'drop-off' else 'stop' end || ' location.',
    '/dashboard', 'pin:' || j.id || ':' || v_leg);
  if j.driver_id is not null then
    perform public.push_enqueue('driver', j.organization_id, j.driver_id, null, j.id,
      'Location updated',
      coalesce(j.job_ref, 'Job') || ': ' ||
        case v_leg when 'pickup' then 'the pickup' when 'delivery' then 'the drop-off' else 'a stop' end ||
        ' now has the exact pin, shared by the client. Navigate again for the new point.',
      '/driver-app/', 'pin:' || j.id || ':' || v_leg);
  end if;

  return jsonb_build_object('ok', true, 'leg', v_leg, 'shared_at', now());
end $$;

revoke all on function public.share_my_location(text, double precision, double precision, double precision) from public;
grant execute on function public.share_my_location(text, double precision, double precision, double precision) to anon, authenticated;

-- ---------- /portal booking carries exact points ----------
-- "Book a delivery" now sends the pins from the address field (search, pasted
-- map link or the phone's GPS). Same rules as before; only the points are new.
drop function if exists public.client_book(uuid, text, text, text, text, date, text, text);

create or replace function public.client_book(
  p_business_id    uuid,
  p_pickup         text,
  p_delivery       text,
  p_item_type      text default 'parcel',
  p_urgency        text default 'today',
  p_preferred_date date default null,
  p_notes          text default null,
  p_recipient      text default null,
  p_pickup_lat     double precision default null,
  p_pickup_lng     double precision default null,
  p_delivery_lat   double precision default null,
  p_delivery_lng   double precision default null,
  p_emirate        text default null)
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
     emirate, pickup_lat, pickup_lng, delivery_lat, delivery_lng,
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
     nullif(left(btrim(p_emirate), 60), ''),
     case when abs(p_pickup_lat) <= 90 and abs(p_pickup_lng) <= 180 then p_pickup_lat end,
     case when abs(p_pickup_lat) <= 90 and abs(p_pickup_lng) <= 180 then p_pickup_lng end,
     case when abs(p_delivery_lat) <= 90 and abs(p_delivery_lng) <= 180 then p_delivery_lat end,
     case when abs(p_delivery_lat) <= 90 and abs(p_delivery_lng) <= 180 then p_delivery_lng end,
     'business_portal', 'portal', 'pending');

  return v_ref;
end $$;

revoke execute on function public.client_book(uuid, text, text, text, text, date, text, text,
  double precision, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.client_book(uuid, text, text, text, text, date, text, text,
  double precision, double precision, double precision, double precision, text) to authenticated;
