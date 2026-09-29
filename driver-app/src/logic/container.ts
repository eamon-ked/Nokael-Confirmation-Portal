/**
 * The one place that decides which implementation backs each contract — the
 * web version of the Android `AppContainer`. Every repository talks to the
 * Nokael Supabase backend; no screen constructs its own dependencies.
 */
import { AppConfig } from "./config";
import { DriverPush } from "./push";
import { LiveLocationBroadcaster, LocationPermissionState } from "./location";
import type { Driver } from "./model";
import {
  RemoteAuthRepository,
  RemoteDispatchLocationRepository,
  RemoteJobRepository,
  type AuthRepository,
  type DispatchLocationRepository,
  type JobRepository,
} from "./repositories";
import { SessionRpc, SessionTokens, SupabaseRpcClient } from "./rpc";
import { Store } from "./store";

/** What the app knows about the stored session while it is starting up. */
export type StartupState = "CHECKING" | "SIGNED_IN" | "SIGNED_OUT" | "UNREACHABLE";

/** Who is signed in, and whether they are taking jobs. */
export class SessionManager {
  readonly driver = new Store<Driver | null>(null);
  readonly isOnline = new Store(true);
  readonly startup = new Store<StartupState>("CHECKING");

  signIn(driver: Driver) {
    this.driver.set(driver);
    this.isOnline.set(true);
    this.startup.set("SIGNED_IN");
  }

  signOut() {
    this.driver.set(null);
    this.startup.set("SIGNED_OUT");
  }

  toggleOnline() {
    this.isOnline.update((online) => !online);
  }
}

/** Holds the phone/email between the two sign-in screens, in memory only. */
export class LoginDraft {
  identifier = "";

  set(identifier: string) {
    this.identifier = identifier.trim();
  }

  clear() {
    this.identifier = "";
  }

  /** Email-shaped, or a phone number with at least 9 digits. */
  static isValidIdentifier(value: string): boolean {
    const text = value.trim();
    if (!text) return false;
    const at = text.indexOf("@");
    const looksLikeEmail = at >= 0 && text.slice(at + 1).includes(".");
    const digits = (text.match(/\d/g) ?? []).length;
    return looksLikeEmail || (digits >= 9 && at < 0);
  }
}

function describeDevice(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Mac/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : "";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  return `Web ${standalone ? "app" : "browser"} · ${browser}${os ? ` on ${os}` : ""}`;
}

class AppContainer {
  readonly session = new SessionManager();
  readonly loginDraft = new LoginDraft();
  /** A label for the `driver_login` device field; not a device ID. */
  readonly deviceLabel = describeDevice();
  readonly locationPermission = new LocationPermissionState();

  readonly auth: AuthRepository;
  readonly jobs: JobRepository;
  readonly dispatchLocation: DispatchLocationRepository;
  readonly broadcaster: LiveLocationBroadcaster;
  readonly push: DriverPush;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncBackoffMs = SYNC_BASE_MS;

  constructor() {
    const tokens = new SessionTokens();
    const rpc = new SupabaseRpcClient(AppConfig.supabaseUrl, AppConfig.supabaseAnonKey);
    const sessionRpc = new SessionRpc(rpc, tokens, () => this.expireLocally());
    this.auth = new RemoteAuthRepository(rpc, sessionRpc, tokens);
    this.jobs = new RemoteJobRepository(sessionRpc, () => this.scheduleArrivalSync(true));
    this.dispatchLocation = new RemoteDispatchLocationRepository(sessionRpc);
    this.broadcaster = new LiveLocationBroadcaster(this.dispatchLocation);
    this.push = new DriverPush(sessionRpc, rpc);
  }

  /** Call once, at boot. */
  start() {
    // Live tracking runs exactly while a driver is signed in AND online AND location is granted.
    const syncTracking = () => {
      const shouldTrack =
        this.session.driver.get() != null && this.session.isOnline.get() && this.locationPermission.state.get() === "granted";
      if (shouldTrack) this.broadcaster.start();
      else void this.broadcaster.stop();
    };
    this.session.driver.subscribe(syncTracking);
    this.session.isOnline.subscribe(syncTracking);
    this.locationPermission.state.subscribe(syncTracking);

    // No push feed: poll while a driver is signed in and the app is on screen,
    // refresh at once when it comes back to the foreground.
    const syncPolling = () => {
      if (this.pollTimer != null) clearTimeout(this.pollTimer);
      this.pollTimer = null;
      if (this.session.driver.get() == null || document.visibilityState !== "visible") return;
      const tick = async () => {
        await this.jobs.refresh();
        if (this.session.driver.get() != null && document.visibilityState === "visible") {
          this.pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      };
      void tick();
    };
    this.session.driver.subscribe(syncPolling);
    document.addEventListener("visibilitychange", () => {
      syncPolling();
      if (document.visibilityState === "visible") this.scheduleArrivalSync(false);
    });

    // Keep this browser's push registration current for whoever is signed in (never prompts).
    this.session.driver.subscribe(() => {
      if (this.session.driver.get() != null) void this.push.sync();
    });

    // Replaces WorkManager: replay queued arrivals when the connection returns,
    // at start (the tab may have closed before they synced), and with backoff.
    window.addEventListener("online", () => this.scheduleArrivalSync(false));
    this.scheduleArrivalSync(false);
  }

  /** `delayed` waits the backoff first (just queued: we know the network is down). */
  private scheduleArrivalSync(delayed: boolean) {
    if (this.syncTimer != null) clearTimeout(this.syncTimer);
    const run = async () => {
      this.syncTimer = null;
      const allSynced = await this.jobs.syncPendingArrivals();
      if (allSynced) {
        this.syncBackoffMs = SYNC_BASE_MS;
      } else {
        this.syncTimer = setTimeout(run, this.syncBackoffMs);
        this.syncBackoffMs = Math.min(this.syncBackoffMs * 2, SYNC_MAX_MS);
      }
    };
    if (delayed) this.syncTimer = setTimeout(run, this.syncBackoffMs);
    else void run();
  }

  /** The driver tapped "Sign out": tell the server, but clear local state whatever happens. */
  async signOut() {
    // Stop location first: once the token is revoked the server can't be told.
    if (this.broadcaster.running) await this.broadcaster.stop();
    else await this.dispatchLocation.markOffline().catch(() => undefined);
    await this.push.disable();
    await this.auth.logout().catch(() => undefined);
    this.expireLocally();
  }

  /** The server said `invalid_session`. No server calls — the token is already dead. */
  expireLocally() {
    this.auth.clearLocalSession();
    this.jobs.clear();
    this.session.signOut();
  }
}

const POLL_INTERVAL_MS = 25_000;
const SYNC_BASE_MS = 30_000;
const SYNC_MAX_MS = 15 * 60_000;

export const container = new AppContainer();
