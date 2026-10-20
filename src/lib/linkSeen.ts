// Tells dispatch the client has opened their link, and is still looking at it
// (supabase-link-views-migration.sql). The dashboard shows it as "Viewing now"
// or "Last seen 12 min ago" next to the person it was sent to.
//
// Quiet on purpose: one call when the page opens, one every HEARTBEAT_MS while
// it's actually on screen, none while the tab is hidden. Driver tokens are
// ignored by the server, so pages shared with drivers can call this too.
// `?staff=1` (the dashboard's own "open" button) skips it, so dispatch checking
// the page doesn't look like the client viewing it.

import { useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';

const HEARTBEAT_MS = 2 * 60 * 1000;
// Coming back after this long away counts as a new visit.
const NEW_VISIT_AFTER_MS = 30 * 60 * 1000;
// One visit per token per page load, even if the effect runs twice (React dev
// mode) or the page remounts.
const visitSent = new Map<string, number>();
const DUPLICATE_WINDOW_MS = 10 * 1000;

export function useLinkSeen(token: string | undefined) {
  useEffect(() => {
    if (!token || !isSupabaseConfigured || !supabase) return;
    if (new URLSearchParams(window.location.search).get('staff') === '1') return;

    let hiddenAt: number | null = null;
    const ping = (newVisit: boolean) => {
      if (Date.now() - (visitSent.get(token) ?? 0) < DUPLICATE_WINDOW_MS) return;
      if (newVisit) visitSent.set(token, Date.now());
      supabase!.rpc('track_link_seen', { p_token: token, p_new_visit: newVisit }).then(() => {}, () => {});
    };

    if (document.visibilityState === 'visible') ping(true);
    else hiddenAt = Date.now();

    const beat = setInterval(() => { if (document.visibilityState === 'visible') ping(false); }, HEARTBEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      ping(hiddenAt == null || Date.now() - hiddenAt > NEW_VISIT_AFTER_MS);
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(beat); document.removeEventListener('visibilitychange', onVisibility); };
  }, [token]);
}
