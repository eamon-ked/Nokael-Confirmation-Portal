import { supabase } from '@/src/lib/supabase';

/**
 * Web Push for a customer following a delivery link. The link token proves
 * access to that one job; the server sends "driver assigned", "at pickup",
 * "picked up" and "delivered". Uses the site's service worker (/sw.js).
 */

/** VAPID public key (the private half lives in Supabase Vault). Safe to ship. */
const VAPID_PUBLIC_KEY = 'BA1nn2YRPAoidJowKNHKYhv1a7o7IaI8fVDdraQrhryI75qMynwJmA8gkLPEPbCO3oPm7eEQk6rrw-ZjF8jg2MM';

export type TrackingPushState = 'unsupported' | 'denied' | 'off' | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

const storageKey = (linkToken: string) => `nokael.push.track.${linkToken}`;

export function trackingPushState(linkToken: string): TrackingPushState {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return Notification.permission === 'granted' && localStorage.getItem(storageKey(linkToken)) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Ask for permission (must run from a tap) and subscribe this browser to the job behind the link. */
export async function enableTrackingPush(linkToken: string): Promise<TrackingPushState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const keys = sub.toJSON().keys ?? {};
  const { data, error } = await supabase.rpc('tracking_push_subscribe', {
    p_link_token: linkToken,
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error || !data?.ok) throw new Error(error?.message || data?.error || 'subscribe_failed');
  try { localStorage.setItem(storageKey(linkToken), '1'); } catch { /* private mode */ }
  return 'on';
}
