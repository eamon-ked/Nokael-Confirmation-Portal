import { supabase } from './supabase';
import type { OrgProfile } from './org';

// ==========================================
// Client app — survey + installable re-booking PWA
// ==========================================
// The tracking link dies 24h after delivery, so the installed app runs on a
// separate long-lived token (client_app_tokens) issued from the delivered
// tracking page. See supabase-client-app-migration.sql.

export const LEAD_SOURCES = [
  { value: 'google', label: 'Google' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'A friend / colleague' },
  { value: 'saw_vehicle', label: 'Saw a Nokael driver' },
  { value: 'repeat', label: "I've used you before" },
  { value: 'other', label: 'Other' },
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number]['value'];

export interface FeedbackState { rating: number | null; lead_source: LeadSource | null; review_clicked: boolean }

export interface RecentRoute {
  pickup_location: string;
  delivery_location: string;
  pickup_emirate: string | null;
  delivery_emirate: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  item_type: string | null;
}

export interface ClientAppData {
  org: OrgProfile | null;
  name: string | null;
  phone: string | null;
  party: 'sender' | 'recipient';
  installed: boolean;
  recent: RecentRoute[];
}

export const appUrl = (appToken: string) => `/app/${appToken}`;
export const appManifestUrl = (appToken: string) => `/app/${appToken}/manifest.webmanifest`;

/** Points the page's manifest at the token's app, so "Install" lands in /app/<token>. */
export function setAppManifest(appToken: string | null | undefined) {
  if (!appToken || typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  const href = appManifestUrl(appToken);
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export async function issueAppToken(linkToken: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('client_app_issue', { p_link_token: linkToken });
  return error ? null : ((data as string | null) ?? null);
}

export async function getFeedback(linkToken: string): Promise<FeedbackState | null> {
  const { data, error } = await supabase.rpc('client_feedback_get', { p_link_token: linkToken });
  return error ? null : ((data as FeedbackState | null) ?? null);
}

export async function submitFeedback(linkToken: string, f: { rating: number; leadSource: LeadSource | null; other?: string; comment?: string }) {
  const { error } = await supabase.rpc('client_feedback_submit', {
    p_link_token: linkToken,
    p_rating: f.rating,
    p_lead_source: f.leadSource,
    p_lead_source_other: f.other || null,
    p_comment: f.comment || null,
  });
  if (error) throw error;
}

export const markReviewClicked = (linkToken: string) =>
  supabase.rpc('client_feedback_review_click', { p_link_token: linkToken }).then(() => undefined, () => undefined);

export async function getClientApp(appToken: string): Promise<ClientAppData | null> {
  const { data, error } = await supabase.rpc('client_app_get', { p_app_token: appToken });
  if (error) throw error;
  return (data as ClientAppData | null) ?? null;
}

export const markInstalled = (appToken: string) =>
  supabase.rpc('client_app_mark_installed', { p_app_token: appToken }).then(() => undefined, () => undefined);

export interface RebookInput {
  pickup: string;
  delivery: string;
  itemType: 'document' | 'parcel' | 'spare_part' | 'other';
  urgency: 'immediate' | 'today' | 'scheduled';
  preferredDate?: string | null;
  notes?: string;
  pickupEmirate?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
}

/** Creates a quote request (source 'rebook'); returns its NK-#### reference. */
export async function rebook(appToken: string, r: RebookInput): Promise<string> {
  const { data, error } = await supabase.rpc('client_app_rebook', {
    p_app_token: appToken,
    p_pickup: r.pickup,
    p_delivery: r.delivery,
    p_item_type: r.itemType,
    p_urgency: r.urgency,
    p_preferred_date: r.preferredDate || null,
    p_notes: r.notes || null,
    p_pickup_emirate: r.pickupEmirate || null,
    p_pickup_lat: r.pickupLat ?? null,
    p_pickup_lng: r.pickupLng ?? null,
    p_delivery_lat: r.deliveryLat ?? null,
    p_delivery_lng: r.deliveryLng ?? null,
  });
  if (error) throw error;
  return data as string;
}

// ---------- install helpers ----------
export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const hasInstallPrompt = () => !!(window as any).deferredPWAInstallPrompt;

/** Shows Chrome's install dialog if it's available. Resolves true when accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = (window as any).deferredPWAInstallPrompt;
  if (!e) return false;
  (window as any).deferredPWAInstallPrompt = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  return choice?.outcome === 'accepted';
}

export const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } },
};
