import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';
import { WHATSAPP_NUMBER } from './constants';

// ==========================================
// The company a job belongs to
// ==========================================
// Jobs on the platform can belong to any company (organizations), not just
// Nokael. Pages opened from a job link look the company up once
// (get_public_org_for_job) so times show in the company's time zone and the
// name / dispatch number are the company's. Until it loads — or for Nokael —
// everything falls back to Nokael's UAE defaults, i.e. the old behaviour.

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  branding: { display_name?: string; whatsapp?: string; support_phone?: string; logo_url?: string; primary_color?: string };
  settings: { timezone?: string; currency?: string; locale?: string; country?: string; coc?: unknown };
}

let current: OrgProfile | null = null;
const loaded = new Map<string, Promise<OrgProfile | null>>();

export const orgBrand = () => current?.branding.display_name?.trim() || current?.name || 'Nokael';
export const orgTimeZone = () => current?.settings.timezone || 'Asia/Dubai';
export const orgLocale = () => current?.settings.locale || 'en-AE';
export const orgCurrency = () => current?.settings.currency || 'AED';
/** The company's COC certificate template (raw; normalised in cocRender). */
export const orgCocTemplate = () => current?.settings.coc;
export const orgLogoUrl = () => current?.branding.logo_url || null;
/** Dispatch WhatsApp / phone digits; Nokael's number only for Nokael (or before load). */
export const orgDispatchNumber = () => {
  if (!current) return WHATSAPP_NUMBER;
  const n = (current.branding.whatsapp || current.branding.support_phone || '').replace(/\D/g, '');
  return n || (current.slug === 'nokael' ? WHATSAPP_NUMBER : '');
};

export const setOrg = (org: OrgProfile | null) => { if (org) current = org; };

export function loadOrgForToken(token: string): Promise<OrgProfile | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!loaded.has(token)) {
    loaded.set(token, (async () => {
      const { data, error } = await supabase.rpc('get_public_org_for_job', { p_token: token });
      // Older database without the RPC: keep Nokael defaults.
      if (error || !data) return null;
      current = data as OrgProfile;
      return current;
    })());
  }
  return loaded.get(token)!;
}

/** Loads the job's company and re-renders once it's known. */
export function useOrgForToken(token: string | undefined): OrgProfile | null {
  const [org, setOrgState] = useState<OrgProfile | null>(current);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    loadOrgForToken(token).then(o => { if (alive && o) setOrgState(o); });
    return () => { alive = false; };
  }, [token]);
  return org;
}
