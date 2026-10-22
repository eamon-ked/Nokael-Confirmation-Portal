-- =============================================================================
-- Client tracking opens 60 min before the pickup window (22 Oct 2026)
-- Project: hhgzxpuzsbqirmbsiltn
--
-- driver_publish_location copies a driver's GPS onto every open job they hold,
-- so a client link used to show the driver on other customers' jobs hours
-- before their own pickup. Now, for client links (not driver links, not staff):
-- * get_job_by_token returns driver_lat/lng/updated_at only once tracking is
--   open, and a new last column tracking_opens_at (null = no time set).
-- * get_job_driver_by_token withholds the driver's phone until then (name and
--   vehicle still show).
-- * The "Driver assigned" tracking push says when live tracking starts
--   instead of "on the way" when the pickup is over an hour off.
-- Open = no pickup time, or now >= pickup start - 60 min, or the driver has
-- arrived at / collected from the pickup.
-- Built from the live definitions; safe to run more than once.
-- =============================================================================

create or replace function public.job_tracking_opens_at(j public.jobs)
returns timestamptz
language sql stable
set search_path to 'public'
as $$
  select coalesce(j.pickup_window_start, j.scheduled_pickup_at) - interval '60 minutes';
$$;

create or replace function public.job_tracking_open(j public.jobs)
returns boolean
language sql stable
set search_path to 'public'
as $$
  select public.job_tracking_opens_at(j) is null
      or now() >= public.job_tracking_opens_at(j)
      or j.driver_arrived_pickup_at is not null
      or j.driver_pickup_at is not null
      or j.client_pickup_at is not null;
$$;

do $$
declare
  v_def text := pg_get_functiondef('public.get_job_by_token'::regproc);
  v_sig_old text := 'delivery_window_end timestamp with time zone)';
  v_sig_new text := 'delivery_window_end timestamp with time zone, tracking_opens_at timestamp with time zone)';
  v_decl_old text := 'v_is_driver boolean := false;';
  v_decl_new text := 'v_is_driver boolean := false;
  v_open boolean;';
  v_ret_old text := '  RETURN QUERY SELECT';
  v_ret_new text := '  -- Client links see the driver''s position only once tracking opens.
  v_open := v_is_driver OR public.is_org_member(v_job.organization_id) OR public.job_tracking_open(v_job);

  RETURN QUERY SELECT';
  v_loc_old text := 'v_job.driver_id, v_job.driver_lat, v_job.driver_lng, v_job.driver_updated_at,';
  v_loc_new text := 'v_job.driver_id,
    CASE WHEN v_open THEN v_job.driver_lat END,
    CASE WHEN v_open THEN v_job.driver_lng END,
    CASE WHEN v_open THEN v_job.driver_updated_at END,';
  v_sel_old text := 'v_job.scheduled_delivery_start, v_job.scheduled_delivery_end;';
  v_sel_new text := 'v_job.scheduled_delivery_start, v_job.scheduled_delivery_end,
    public.job_tracking_opens_at(v_job);';
begin
  if position('tracking_opens_at' in v_def) > 0 then
    raise notice 'get_job_by_token already gates tracking';
  else
    if position(v_sig_old in v_def) = 0 or position(v_decl_old in v_def) = 0
       or position(v_ret_old in v_def) = 0 or position(v_loc_old in v_def) = 0
       or position(v_sel_old in v_def) = 0 then
      raise exception 'get_job_by_token: live definition changed, anchors not found';
    end if;
    v_def := replace(v_def, v_sig_old, v_sig_new);
    v_def := replace(v_def, v_decl_old, v_decl_new);
    v_def := replace(v_def, v_ret_old, v_ret_new);
    v_def := replace(v_def, v_loc_old, v_loc_new);
    v_def := replace(v_def, v_sel_old, v_sel_new);
    drop function public.get_job_by_token(text);
    execute v_def;
    grant execute on function public.get_job_by_token(text) to anon, authenticated, service_role;
  end if;
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public.get_job_driver_by_token'::regproc);
  v_old text := $q$THEN NULL ELSE coalesce(nullif(d.phone, ''), d.whatsapp) END$q$;
  v_new text := $q$THEN NULL
              WHEN NOT (public.job_tracking_open(v_job) OR public.is_org_member(v_job.organization_id)) THEN NULL
              ELSE coalesce(nullif(d.phone, ''), d.whatsapp) END$q$;
begin
  if position('job_tracking_open' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'get_job_driver_by_token: anchor not found';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public._push_on_job'::regproc);
  v_old text := $q$'Driver assigned', coalesce(v_driver, 'Your driver') || ' is on the way to ' || v_pickup || '.', null, v_tag);$q$;
  v_new text := $q$'Driver assigned',
      case when v_start - interval '60 minutes' > now() then
        coalesce(v_driver, 'Your driver') || ' will collect your package. Live tracking starts '
        || case when v_start - interval '60 minutes' > now() + interval '12 hours'
             then to_char((v_start - interval '60 minutes') at time zone coalesce(nullif(public.org_setting(new.organization_id, 'timezone'), ''), 'Asia/Dubai'), 'Dy DD Mon') || ', '
             else '' end
        || public._push_clock(new.organization_id, v_start - interval '60 minutes') || '.'
      else coalesce(v_driver, 'Your driver') || ' is on the way to ' || v_pickup || '.' end,
      null, v_tag);$q$;
begin
  if position('Live tracking starts' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception '_push_on_job: anchor not found';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
