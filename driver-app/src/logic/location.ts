import type { GeoPoint } from "./model";
import type { DispatchLocationRepository } from "./repositories";
import { Store } from "./store";

/** Whether the browser will hand us a position. */
export type LocationPermission = "granted" | "denied" | "prompt";

/**
 * The web version of `LocationPermissionState`: tracks the geolocation grant
 * so live tracking starts/stops off it. Browsers without the Permissions API
 * (older iOS) start at "prompt" and learn the answer from the first request.
 */
/** How long a location request may stay silent (outside a visible prompt) before we stop waiting. */
const REQUEST_GUARD_MS = 17_000;

export class LocationPermissionState {
  readonly state = new Store<LocationPermission>("prompt");

  constructor() {
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((status) => {
        this.state.set(status.state as LocationPermission);
        status.addEventListener("change", () => this.state.set(status.state as LocationPermission));
      })
      .catch(() => undefined);
  }

  /**
   * Makes sure location has been asked for, then resolves with whether it is granted.
   *
   * iPhone installed web apps have a WebKit bug where, once a location watch has
   * been cleared (going offline), the next request can never call back, not even
   * with its own timeout. So: skip the request when the Permissions API already
   * says "granted", and otherwise guard it with our own timer (except while the
   * prompt may be on screen, which can legitimately take a while to answer).
   */
  async request(): Promise<boolean> {
    if (!("geolocation" in navigator)) return false;
    const known = await this.queryState();
    if (known === "granted") {
      this.state.set("granted");
      return true;
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (granted: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        this.state.set(granted ? "granted" : "denied");
        resolve(granted);
      };
      // "prompt" means the question is on screen; any other state should answer quickly.
      const guard = known === "prompt" ? undefined : setTimeout(() => settle(true), REQUEST_GUARD_MS);
      navigator.geolocation.getCurrentPosition(
        () => settle(true),
        // Anything but a refusal means permission is fine; the fix just didn't come (indoors, timeout).
        (error) => settle(error.code !== error.PERMISSION_DENIED),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
      );
    });
  }

  /** The browser's own answer, when it has a Permissions API that knows geolocation. */
  private async queryState(): Promise<LocationPermission | null> {
    try {
      const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
      return (status?.state as LocationPermission | undefined) ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Where to re-allow location once it's blocked. A browser (and an installed web
 * app) remembers "Don't allow" and never asks again, so the driver has to change
 * it in settings; the steps differ per platform.
 */
export function locationHelpSteps(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return [
      "1. Open Settings → Privacy & Security → Location Services and make sure it's on.",
      "2. In the same list, open Safari Websites → choose \"While Using the App\" and turn on Precise Location.",
      "3. Also check Settings → Apps → Safari → Location is \"Ask\" or \"Allow\".",
      "4. Come back here and tap Try again.",
    ].join("\n");
  }
  if (/Android/.test(ua)) {
    return [
      "1. Pull down quick settings and make sure Location is on.",
      "2. Open Chrome → ⋮ → Settings → Site settings → Location → coc.nokael.com → Allow.",
      "3. Check Android Settings → Apps → Chrome → Permissions → Location → Allow (precise).",
      "4. Come back here and tap Try again.",
    ].join("\n");
  }
  return "Click the lock icon next to the address, set Location to Allow, reload the page, then tap Try again.";
}

/**
 * One-shot fix for the "I am here" arrival log. Resolves null instead of
 * failing whenever permission is missing or no fix comes within `timeoutMs`,
 * so a GPS that hangs (basement car park) never stalls the driver.
 */
export function currentLocation(timeoutMs: number): Promise<GeoPoint | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const guard = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(guard);
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        clearTimeout(guard);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}

/**
 * Streams the driver's live position to dispatch until `stop()` — the web
 * version of `LiveLocationBroadcaster`.
 *
 * - At most one fix per interval and one request in flight; a slow network
 *   only ever costs stale fixes, never a backlog (the newest position wins).
 * - A failed publish is skipped; it never ends tracking.
 * - However it ends, dispatch is told the driver is offline.
 *
 * Unlike Android's foreground service, a browser only guarantees updates while
 * the app is on screen; the server treats an old timestamp as offline.
 */
const STALE_WATCH_MS = 30_000;

export class LiveLocationBroadcaster {
  private watchId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private latest: GeoPoint | null = null;
  private inFlight = false;
  /** When the watch last delivered a fix; see [tick] for why it matters. */
  private lastFixAt = 0;

  constructor(
    private readonly dispatch: DispatchLocationRepository,
    private readonly intervalMs = 10_000,
  ) {}

  get running() {
    return this.watchId != null;
  }

  start() {
    if (this.running || !("geolocation" in navigator)) return;
    this.lastFixAt = Date.now();
    this.watch();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private watch() {
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.accept({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
  }

  private accept(point: GeoPoint) {
    const first = this.latest == null;
    this.lastFixAt = Date.now();
    this.latest = point;
    if (first) this.flush();
  }

  /**
   * On iPhone installed web apps a watch restarted after going offline can stay
   * silent (WebKit bug). If nothing has arrived for STALE_WATCH_MS, ask for one
   * fix directly and restart the watch, so dispatch keeps seeing the driver.
   */
  private tick() {
    if (this.watchId != null && Date.now() - this.lastFixAt > STALE_WATCH_MS) {
      this.lastFixAt = Date.now(); // don't restart again until another full window passes
      void currentLocation(10_000).then((point) => {
        if (point && this.running) this.accept(point);
      });
      navigator.geolocation.clearWatch(this.watchId);
      this.watch();
    }
    this.flush();
  }

  stop(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    if (this.timer != null) clearInterval(this.timer);
    this.watchId = null;
    this.timer = null;
    this.latest = null;
    return this.dispatch.markOffline().catch(() => undefined);
  }

  private flush() {
    const point = this.latest;
    if (!point || this.inFlight) return;
    this.latest = null;
    this.inFlight = true;
    this.dispatch
      .publish(point.latitude, point.longitude)
      .catch(() => {
        // Keep the fix so the next tick retries with it (unless a newer one arrives).
        this.latest ??= point;
      })
      .finally(() => {
        this.inFlight = false;
      });
  }
}
