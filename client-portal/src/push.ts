import { supabase } from "./supabase";

/**
 * Web Push for the business client portal: driver assigned, at pickup, picked
 * up and delivered, for the companies this login belongs to. The server
 * decides what to send; this registers (or removes) this browser.
 */

/** VAPID public key (the private half lives in Supabase Vault). Safe to ship. */
const VAPID_PUBLIC_KEY = "BA1nn2YRPAoidJowKNHKYhv1a7o7IaI8fVDdraQrhryI75qMynwJmA8gkLPEPbCO3oPm7eEQk6rrw-ZjF8jg2MM";
const SW_URL = `${import.meta.env.BASE_URL}push-sw.js`;

export type PushState = "unsupported" | "denied" | "off" | "on";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && (await currentSubscription()) ? "on" : "off";
}

async function register(businessId: string, sub: PushSubscription) {
  const keys = sub.toJSON().keys ?? {};
  const { data, error } = await supabase.rpc("client_push_subscribe", {
    p_business: businessId,
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error || !data?.ok) throw new Error(error?.message || data?.error || "subscribe_failed");
}

/** Ask for permission (must run from a click) and register this browser for the company. */
export async function enablePush(businessId: string): Promise<PushState> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  await register(businessId, sub);
  return "on";
}

/** Turn off, or sign out: remove this browser for every company. */
export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await supabase.rpc("push_unsubscribe", { p_endpoint: sub.endpoint, p_audience: "client" });
    await sub.unsubscribe();
  }
  return supported() ? "off" : "unsupported";
}

/** Viewing a company with push already on: make sure this browser gets its updates too. Never prompts. */
export async function syncPush(businessId: string): Promise<void> {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await register(businessId, sub);
  } catch (err) {
    console.warn("[push] sync failed", err);
  }
}
