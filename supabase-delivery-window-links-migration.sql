-- =============================================================================
-- Delivery/pickup windows on every link (21 Oct 2026)
-- Project: hhgzxpuzsbqirmbsiltn
--
-- * get_job_by_token (tracking + confirmation pages) also returns
--   pickup_window_start/end and delivery_window_start/end (= jobs.
--   scheduled_delivery_start/end). New columns go at the end so existing
--   callers are unaffected. The return type changes, so the function is
--   dropped and recreated (same body, same grants) in this transaction.
-- * driver_jobs queues open jobs by the pickup window start, falling back to
--   scheduled_pickup_at (it already returns both windows per stop).
-- Link rules (expiry 24 h after completion) are unchanged.
-- Built from the live definitions; safe to run more than once.
-- =============================================================================

do $$
declare
  v_def text := pg_get_functiondef('public.get_job_by_token'::regproc);
  v_sig_old text := 'token_driver_pickup uuid, token_driver_delivery uuid)';
  v_sig_new text := 'token_driver_pickup uuid, token_driver_delivery uuid, pickup_window_start timestamp with time zone, pickup_window_end timestamp with time zone, delivery_window_start timestamp with time zone, delivery_window_end timestamp with time zone)';
  v_sel_old text := 'CASE WHEN v_is_driver THEN v_job.token_driver_delivery ELSE NULL END;';
  v_sel_new text := 'CASE WHEN v_is_driver THEN v_job.token_driver_delivery ELSE NULL END,
    v_job.pickup_window_start, v_job.pickup_window_end,
    v_job.scheduled_delivery_start, v_job.scheduled_delivery_end;';
begin
  if position('delivery_window_start' in v_def) > 0 then
    raise notice 'get_job_by_token already returns windows';
  else
    if position(v_sig_old in v_def) = 0 or position(v_sel_old in v_def) = 0 then
      raise exception 'get_job_by_token: live definition changed, anchors not found';
    end if;
    v_def := replace(replace(v_def, v_sig_old, v_sig_new), v_sel_old, v_sel_new);
    drop function public.get_job_by_token(text);
    execute v_def;
    grant execute on function public.get_job_by_token(text) to anon, authenticated, service_role;
  end if;
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public.driver_jobs'::regproc);
  v_old text := 'coalesce(b.scheduled_pickup_at, b.created_at)';
  v_new text := 'coalesce(b.pickup_window_start, b.scheduled_pickup_at, b.created_at)';
begin
  if position(v_new in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'driver_jobs: anchor not found';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
