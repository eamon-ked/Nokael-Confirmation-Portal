import type { SessionRpc, SupabaseRpcClient } from "./rpc";

/**
 * Web Push for the web driver app (the Android app uses FCM instead). The
 * server decides what to send (new job, job changed or cancelled, pickup
 * reminder); this only registers this browser for the signed-in driver.
 */

/** VAPID public key (the private half lives in Supabase Vault). Safe to ship. */
const VAPID_PUBLIC_KEY = "BA1nn2YRPAoidJowKNHKYhv1a7o7IaI8fVDdraQrhryI75qMynwJmA8gkLPEPbCO3oPm7eEQk6rrw-ZjF8jg2MM";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** The app's own service worker (registered in main.tsx); null in dev, where it isn't registered. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  return reg ?? null;
}

export class DriverPush {
  constructor(
    private readonly session: SessionRpc,
    /** For push_unsubscribe, which takes no session token. */
    private readonly rpc: SupabaseRpcClient,
  ) {}

  /**
   * Ask for permission (only works from a tap) and register this browser. Never
   * throws: a driver who says no, or a browser without push, just gets no pushes.
   */
  async enable(): Promise<void> {
    try {
      if (!supported()) return;
      if (Notification.permission === "default" && (await Notification.requestPermission()) !== "granted") return;
      await this.sync(true);
    } catch {
      // Push is a bonus; never block going online over it.
    }
  }

  /** Re-register if permission was already given (keeps the server in step). Never prompts. */
  async sync(createIfMissing = false): Promise<void> {
    try {
      if (!supported() || Notification.permission !== "granted") return;
      const reg = await registration();
      if (!reg) return;
      let sub = await reg.pushManager.getSubscription();
      if (!sub && createIfMissing) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
      }
      if (!sub) return;
      const keys = sub.toJSON().keys ?? {};
      await this.session.call("driver_push_subscribe", {
        p_channel: "web",
        p_endpoint: sub.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_user_agent: navigator.userAgent,
      });
    } catch {
      // Best-effort.
    }
  }

  /** Signing out: stop this browser getting the driver's jobs (the next person may not be them). */
  async disable(): Promise<void> {
    try {
      if (!supported()) return;
      const sub = await (await registration())?.pushManager.getSubscription();
      if (!sub) return;
      await this.rpc.call("push_unsubscribe", { p_endpoint: sub.endpoint, p_audience: "driver" });
      await sub.unsubscribe();
    } catch {
      // Best-effort.
    }
  }
}
