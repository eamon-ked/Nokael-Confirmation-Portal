import * as DriverJson from "./driverJson";
import { setDriverOrg, type ArrivalRecord, type Driver, type HandoffKind, type Job, type JobOutcome } from "./model";
import { safeRead, safeWrite, SessionRpc, SessionTokens, SupabaseRpcClient, type RpcResult } from "./rpc";
import { Store } from "./store";

/** Result of trying to sign in with a phone/email and password. */
export type LoginResult =
  | { type: "success"; driver: Driver }
  /** Wrong identifier OR wrong password, or the account isn't active — deliberately indistinguishable. */
  | { type: "incorrect_credentials" }
  /** Too many wrong passwords; the driver must wait or call dispatch. */
  | { type: "locked"; retryAfterSeconds: number }
  /** Couldn't reach the server, or it answered unexpectedly. */
  | { type: "failure" };

/** Result of re-validating a stored session when the app starts. */
export type RestoreResult =
  | { type: "restored"; driver: Driver }
  | { type: "no_session" }
  /** A token was stored but the server no longer accepts it. */
  | { type: "expired" }
  /** Couldn't tell (offline). The token is kept; retry rather than signing the driver out. */
  | { type: "unreachable" };

/**
 * Result of an action that changes a job (arrive, remark, return).
 * - STALE: the job changed underneath the driver; the list has been refreshed.
 * - FAILED: network trouble or an unexpected answer. Safe to retry manually.
 * - SESSION_ENDED: the app is already heading to the login screen.
 */
export type ActionResult = "SUCCESS" | "STALE" | "FAILED" | "SESSION_ENDED";

/** Result of typing a pickup/drop-off code. LOCKED = five wrong codes; only dispatch can unlock. */
export type HandoffResult = "SUCCESS" | "WRONG_CODE" | "LOCKED" | "REFRESH" | "ERROR";

export interface AuthRepository {
  login(identifier: string, password: string, deviceLabel: string): Promise<LoginResult>;
  restoreSession(): Promise<RestoreResult>;
  /** Best-effort server-side sign-out. Never throws; safe with a dead token. */
  logout(): Promise<void>;
  /** Forgets the stored credentials on this device (always, even if logout failed). */
  clearLocalSession(): void;
}

export interface JobRepository {
  /** False until the first successful load after sign-in, so screens don't flash "all caught up". */
  readonly hasLoaded: Store<boolean>;
  /** The driver's open queue (active first, then upcoming) plus recently finished jobs. */
  readonly jobs: Store<Job[]>;
  /** Re-reads the list from the server. Returns false if it couldn't. Never throws. */
  refresh(): Promise<boolean>;
  /** Forgets everything cached (sign-out, expired session). */
  clear(): void;
  /** Records "I am here". Safe to retry: the first arrival wins. */
  confirmArrival(jobId: string, arrival: ArrivalRecord): Promise<ActionResult>;
  confirmHandoff(jobId: string, kind: HandoffKind, code: string): Promise<HandoffResult>;
  saveRemark(jobId: string, remark: string): Promise<ActionResult>;
  /** COMPLETED/CANCELLED make no server call (just refresh); RETURNED sends `reason`. */
  finishJob(jobId: string, outcome: JobOutcome, reason?: string): Promise<ActionResult>;
  /** Replays queued offline arrivals in order. True once none are left queued. */
  syncPendingArrivals(): Promise<boolean>;
}

/** Sends the driver's live position somewhere dispatch can see it. */
export interface DispatchLocationRepository {
  publish(latitude: number, longitude: number): Promise<void>;
  /** Tells dispatch this driver stopped sharing. Best-effort. */
  markOffline(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real backend (the `driver_*` functions)
// ---------------------------------------------------------------------------

const MAX_DEVICE_LABEL = 100;
const DEFAULT_LOCK_SECONDS = 15 * 60;

export class RemoteAuthRepository implements AuthRepository {
  constructor(
    private readonly rpc: SupabaseRpcClient,
    private readonly session: SessionRpc,
    private readonly tokens: SessionTokens,
  ) {}

  async login(identifier: string, password: string, deviceLabel: string): Promise<LoginResult> {
    const result = await this.rpc.call("driver_login", {
      p_identifier: identifier.trim(),
      p_password: password,
      p_device_label: deviceLabel.slice(0, MAX_DEVICE_LABEL),
    });
    switch (result.type) {
      case "ok":
        try {
          const token = result.body.token;
          if (typeof token !== "string") throw new DriverJson.ShapeError("token");
          // The token is returned exactly once; persist it before anything else.
          this.tokens.set(token);
          // Company time zone / currency; best-effort, defaults stay until it answers.
          void this.session.call("driver_me").then((me) => { if (me.type === "ok") setDriverOrg(me.body.org); }).catch(() => undefined);
          return { type: "success", driver: DriverJson.driver(result.body.driver) };
        } catch {
          this.tokens.clear();
          return { type: "failure" };
        }
      case "rejected":
        if (result.error === "locked") {
          const retry = result.body.retry_after_seconds;
          return { type: "locked", retryAfterSeconds: typeof retry === "number" ? retry : DEFAULT_LOCK_SECONDS };
        }
        return result.error === "incorrect_credentials" ? { type: "incorrect_credentials" } : { type: "failure" };
      default:
        return { type: "failure" };
    }
  }

  async restoreSession(): Promise<RestoreResult> {
    if (!this.session.hasSession) return { type: "no_session" };
    const result = await this.session.call("driver_me");
    switch (result.type) {
      case "ok":
        try {
          setDriverOrg(result.body.org);
          return { type: "restored", driver: DriverJson.driver(result.body.driver) };
        } catch {
          return { type: "unreachable" };
        }
      case "invalid_session":
        return { type: "expired" };
      default:
        return { type: "unreachable" };
    }
  }

  async logout() {
    // Result deliberately ignored: a dead token or no network must not block signing out.
    await this.session.call("driver_logout");
  }

  clearLocalSession() {
    this.tokens.clear();
  }
}

interface PendingArrival {
  jobId: string;
  kind: HandoffKind;
  latitude: number | null;
  longitude: number | null;
  timestampMillis: number;
}

/**
 * The job list is a cache that `refresh` overwrites; there is no realtime feed,
 * so a poller calls `refresh` every few seconds while the app is on screen,
 * and every action here refreshes straight afterwards.
 *
 * Like the Android Room cache, the last job list is kept in localStorage so a
 * cold start with no signal still shows the driver their jobs, and "I am here"
 * taps made with no signal are queued and replayed later.
 */
export class RemoteJobRepository implements JobRepository {
  private static readonly CACHE_KEY = "nokael.driver.jobs";
  private static readonly PENDING_KEY = "nokael.driver.pendingArrivals";
  private static readonly RECENT_HOURS = 24;

  readonly jobs = new Store<Job[]>([]);
  readonly hasLoaded = new Store(false);

  /** Serialises refreshes so a slow older response can never overwrite a newer one. */
  private refreshChain: Promise<unknown> = Promise.resolve();
  private syncing: Promise<boolean> | null = null;

  constructor(
    private readonly rpc: SessionRpc,
    /** Called whenever an arrival is queued offline, so the app can schedule a retry. */
    private readonly onArrivalQueued: () => void = () => {},
  ) {
    // Show the last-known list immediately on a cold start, before the first refresh lands.
    const cached = safeRead(RemoteJobRepository.CACHE_KEY);
    if (cached) {
      try {
        this.jobs.set(DriverJson.jobs(JSON.parse(cached)));
      } catch {
        // Corrupt/old-shape cache entry; ignore it and wait for a real refresh.
      }
    }
  }

  refresh(): Promise<boolean> {
    const run = this.refreshChain.then(async () => {
      const result = await this.rpc.call("driver_jobs", { p_recent_hours: RemoteJobRepository.RECENT_HOURS });
      if (result.type !== "ok") return false;
      try {
        this.jobs.set(DriverJson.jobs(result.body));
        this.hasLoaded.set(true);
        safeWrite(RemoteJobRepository.CACHE_KEY, JSON.stringify(result.body));
        return true;
      } catch {
        return false;
      }
    });
    this.refreshChain = run.catch(() => undefined);
    return run;
  }

  clear() {
    this.jobs.set([]);
    this.hasLoaded.set(false);
    safeWrite(RemoteJobRepository.CACHE_KEY, null);
    // Queued arrivals are kept (as on Android): a driver signed out mid-dead-zone
    // still gets their "I am here" taps delivered after signing back in.
  }

  async confirmArrival(jobId: string, arrival: ArrivalRecord): Promise<ActionResult> {
    const result = await this.rpc.call("driver_arrive", arrivalParams(jobId, arrival.kind, arrival.location?.latitude, arrival.location?.longitude));
    if (result.type === "failure") {
      // No signal right now, not a rejection: queue it so "I am here" never gets
      // lost to a dead zone, and let it look like it worked.
      this.writePending([
        ...this.readPending(),
        {
          jobId,
          kind: arrival.kind,
          latitude: arrival.location?.latitude ?? null,
          longitude: arrival.location?.longitude ?? null,
          timestampMillis: arrival.timestampMillis,
        },
      ]);
      this.onArrivalQueued();
      return "SUCCESS";
    }
    return this.toActionResult(result);
  }

  async confirmHandoff(jobId: string, kind: HandoffKind, code: string): Promise<HandoffResult> {
    const result = await this.rpc.call("driver_confirm_handoff", {
      p_job_id: jobId,
      p_kind: kind === "PICKUP" ? "pickup" : "dropoff",
      p_code: code,
    });
    switch (result.type) {
      case "ok":
        await this.refresh();
        return "SUCCESS";
      case "rejected":
        switch (result.error) {
          case "invalid_otp":
            return "WRONG_CODE";
          case "locked":
            await this.refresh(); // picks up otp_locked so the screen stays locked after a reopen
            return "LOCKED";
          // A retry after a timeout: the step already happened, which is what the driver wanted.
          case "already_confirmed":
            await this.refresh();
            return "SUCCESS";
          case "job_closed":
          case "not_assigned":
          case "step_not_applicable":
          case "step_rejected":
            await this.refresh();
            return "REFRESH";
          default:
            return "ERROR";
        }
      default:
        return "ERROR";
    }
  }

  async saveRemark(jobId: string, remark: string): Promise<ActionResult> {
    return this.toActionResult(await this.rpc.call("driver_set_remark", { p_job_id: jobId, p_remark: remark }), false);
  }

  async finishJob(jobId: string, outcome: JobOutcome, reason?: string): Promise<ActionResult> {
    if (outcome !== "RETURNED") {
      // The server completed the job when the drop-off code was accepted.
      await this.refresh();
      return "SUCCESS";
    }
    const params: Record<string, unknown> = { p_job_id: jobId };
    const trimmed = reason?.trim();
    if (trimmed) params.p_reason = trimmed;
    return this.toActionResult(await this.rpc.call("driver_return_job", params));
  }

  syncPendingArrivals(): Promise<boolean> {
    // One replay at a time, or two triggers (online event + timer) would double-send.
    this.syncing ??= this.replayPending().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async replayPending(): Promise<boolean> {
    let pending = this.readPending();
    if (pending.length === 0) return true;
    while (pending.length > 0) {
      const entry = pending[0];
      const result = await this.rpc.call("driver_arrive", arrivalParams(entry.jobId, entry.kind, entry.latitude, entry.longitude));
      // Still can't reach it, or the session died: stop here (keep order) and retry later.
      if (result.type === "failure" || result.type === "invalid_session") return false;
      // The server has an answer either way (accepted, or "already recorded"): nothing left to retry.
      pending = this.readPending().slice(1);
      this.writePending(pending);
    }
    await this.refresh();
    return true;
  }

  get hasPendingArrivals() {
    return this.readPending().length > 0;
  }

  private readPending(): PendingArrival[] {
    try {
      const parsed = JSON.parse(safeRead(RemoteJobRepository.PENDING_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writePending(list: PendingArrival[]) {
    safeWrite(RemoteJobRepository.PENDING_KEY, list.length ? JSON.stringify(list) : null);
  }

  private async toActionResult(result: RpcResult, refreshOnSuccess = true): Promise<ActionResult> {
    switch (result.type) {
      case "ok":
        if (refreshOnSuccess) await this.refresh();
        return "SUCCESS";
      case "rejected":
        if (STALE_ERRORS.has(result.error)) {
          await this.refresh();
          return "STALE";
        }
        return "FAILED";
      case "invalid_session":
        return "SESSION_ENDED";
      case "failure":
        return "FAILED";
    }
  }
}

const STALE_ERRORS = new Set([
  "not_assigned",
  "job_closed",
  "already_picked_up",
  "not_picked_up",
  "already_delivered",
  "not_in_custody",
  "return_rejected",
]);

function arrivalParams(jobId: string, kind: HandoffKind, lat?: number | null, lng?: number | null) {
  const params: Record<string, unknown> = { p_job_id: jobId, p_stage: kind === "PICKUP" ? "pickup" : "delivery" };
  // Both coordinates or neither; the arrival is recorded either way.
  if (lat != null && lng != null) {
    params.p_lat = lat;
    params.p_lng = lng;
  }
  return params;
}

/** Live position via `driver_publish_location` / `driver_stop_location`. */
export class RemoteDispatchLocationRepository implements DispatchLocationRepository {
  constructor(private readonly rpc: SessionRpc) {}

  async publish(latitude: number, longitude: number) {
    // No session means we're mid sign-out; there is nothing to tell dispatch.
    if (!this.rpc.hasSession) return;
    const result = await this.rpc.call("driver_publish_location", { p_lat: latitude, p_lng: longitude });
    // A rejected fix (out of range) is dropped; a failure is skipped and the next fix tries again.
    if (result.type === "failure") throw new Error("Location publish failed");
  }

  async markOffline() {
    if (!this.rpc.hasSession) return;
    // Best-effort: the server also treats stale positions as offline.
    await this.rpc.call("driver_stop_location");
  }
}
