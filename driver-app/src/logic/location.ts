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

  /** Makes sure location has been asked for, then resolves with whether it is granted. */
  request(): Promise<boolean> {
    if (!("geolocation" in navigator)) return Promise.resolve(false);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          this.state.set("granted");
          resolve(true);
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            this.state.set("denied");
            resolve(false);
          } else {
            // Permission is fine, the fix just didn't come (indoors, timeout).
            this.state.set("granted");
            resolve(true);
          }
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
      );
    });
  }
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
export class LiveLocationBroadcaster {
  private watchId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private latest: GeoPoint | null = null;
  private inFlight = false;

  constructor(
    private readonly dispatch: DispatchLocationRepository,
    private readonly intervalMs = 10_000,
  ) {}

  get running() {
    return this.watchId != null;
  }

  start() {
    if (this.running || !("geolocation" in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const first = this.latest == null;
        this.latest = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        if (first) this.flush();
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    this.timer = setInterval(() => this.flush(), this.intervalMs);
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
