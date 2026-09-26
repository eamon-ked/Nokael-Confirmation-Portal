/**
 * In-memory demo backend, the same sample data and rules as the Android
 * `logic.fake` package. Used when no anon key is configured, so the whole
 * flow can be tried without real credentials. Never used by a production wiring.
 */
import { JobStageMachine } from "./jobStageMachine";
import type { ArrivalRecord, Driver, HandoffKind, Job, JobOutcome, Place } from "./model";
import type { ActionResult, AuthRepository, DispatchLocationRepository, HandoffResult, JobRepository, LoginResult, RestoreResult } from "./repositories";
import { delay, Store } from "./store";

export const HANDOFF_CODE = "482916";

export interface DemoAccount {
  driver: Driver;
  password: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { driver: { id: "D001", name: "Mohammed Al Farsi", phone: "+971501234567", email: "mohammed@driver.ae" }, password: "pass123" },
  { driver: { id: "D002", name: "Ali Hassan", phone: "+971509876543", email: "ali@driver.ae" }, password: "secure99" },
  { driver: { id: "D003", name: "Sara Khalid", phone: "+971555551234", email: "sara@driver.ae" }, password: "sara2024" },
];

const place = (address: string, shortName: string): Place => ({ address, shortName, emirate: "", latitude: null, longitude: null });

/** Today at hour:minute UAE time (UTC+4, no DST), so demo jobs always look "today". */
function todayAt(hour: number, minute: number): number {
  const dubaiNow = new Date(Date.now() + 4 * 3600_000);
  return Date.UTC(dubaiNow.getUTCFullYear(), dubaiNow.getUTCMonth(), dubaiNow.getUTCDate(), hour - 4, minute);
}

function demoJob(partial: Partial<Job> & Pick<Job, "id" | "senderName" | "recipientName" | "pickup" | "dropoff" | "itemType">): Job {
  return {
    ref: partial.id,
    senderPhone: null,
    recipientPhone: null,
    companyName: null,
    scheduledPickupAtMillis: null,
    specialInstructions: "",
    payoutAed: null,
    listStatus: "UPCOMING",
    stage: "HEADING_TO_PICKUP",
    remark: "",
    arrivals: [],
    otpLocked: false,
    returnReason: null,
    cancellationReason: null,
    ...partial,
  };
}

const demoJobs = (): Job[] => [
  demoJob({
    id: "JOB-4821",
    senderName: "Al Wasl Furniture Co.",
    senderPhone: "+971502345678",
    recipientName: "Ahmed Al Rashid",
    recipientPhone: "+971509998877",
    pickup: place("14 Al Wasl Road, Jumeirah, Dubai", "Jumeirah"),
    dropoff: place("Dubai Mall, Downtown Dubai", "Downtown"),
    scheduledPickupAtMillis: todayAt(14, 30),
    itemType: "fragile_furniture",
    specialInstructions: "Ring doorbell twice. Do not leave unattended. Call client if no answer.",
    payoutAed: 180,
    listStatus: "ACTIVE",
  }),
  demoJob({
    id: "JOB-4822",
    senderName: "Fatima Al Zaabi",
    senderPhone: "+971551234567",
    recipientName: "DIFC Reception",
    recipientPhone: "+971529876543",
    pickup: place("Marina Walk, Dubai Marina", "Marina"),
    dropoff: place("DIFC, Financial Centre", "DIFC"),
    scheduledPickupAtMillis: todayAt(16, 0),
    itemType: "electronics",
    payoutAed: 150,
  }),
  demoJob({
    id: "JOB-4823",
    senderName: "Al Quoz Industrial Supplies",
    senderPhone: "+971509876543",
    recipientName: "Khalid Bin Rashid",
    recipientPhone: "+971544567890",
    pickup: place("Al Quoz Industrial Area", "Al Quoz"),
    dropoff: place("Business Bay, Dubai", "Business Bay"),
    scheduledPickupAtMillis: todayAt(18, 15),
    itemType: "office_supplies",
    specialInstructions: "Deliver to reception on floor 12. Ask for Mr. Tariq.",
    payoutAed: 120,
  }),
];

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 15 * 60;

/** No persisted token in fake mode, so the demo always starts at the login screen. */
export class FakeAuthRepository implements AuthRepository {
  private failedAttempts = 0;

  async login(identifier: string, password: string): Promise<LoginResult> {
    await delay(500); // pretend to hit the network
    const cleaned = identifier.trim().replace(/ /g, "");
    const account = DEMO_ACCOUNTS.find(
      (a) => a.driver.phone === cleaned || a.driver.email.toLowerCase() === cleaned.toLowerCase(),
    );
    if (!account || account.password !== password) {
      this.failedAttempts++;
      return this.failedAttempts >= MAX_ATTEMPTS
        ? { type: "locked", retryAfterSeconds: LOCK_SECONDS }
        : { type: "incorrect_credentials" };
    }
    this.failedAttempts = 0;
    return { type: "success", driver: account.driver };
  }

  async restoreSession(): Promise<RestoreResult> {
    return { type: "no_session" };
  }

  async logout() {}

  clearLocalSession() {}
}

/** Every driver sees the same three demo jobs. */
export class FakeJobRepository implements JobRepository {
  readonly jobs = new Store<Job[]>(demoJobs());
  readonly hasLoaded = new Store(false);
  /** Wrong hand-off codes per job, so five wrong tries locks just that job. */
  private wrongAttempts = new Map<string, number>();

  async refresh() {
    await delay(300);
    this.hasLoaded.set(true);
    return true;
  }

  clear() {
    this.jobs.set(demoJobs());
    this.hasLoaded.set(false);
    this.wrongAttempts.clear();
  }

  async confirmArrival(jobId: string, arrival: ArrivalRecord): Promise<ActionResult> {
    await delay(250);
    this.change(jobId, (job) => ({ ...job, stage: JobStageMachine.afterArrival(arrival.kind), arrivals: [...job.arrivals, arrival] }));
    return "SUCCESS";
  }

  async confirmHandoff(jobId: string, kind: HandoffKind, code: string): Promise<HandoffResult> {
    await delay(250);
    const job = this.jobs.get().find((j) => j.id === jobId);
    if (!job) return "REFRESH";
    if (job.otpLocked) return "LOCKED";
    if (code !== HANDOFF_CODE) {
      const attempts = (this.wrongAttempts.get(jobId) ?? 0) + 1;
      this.wrongAttempts.set(jobId, attempts);
      if (attempts >= MAX_ATTEMPTS) {
        this.change(jobId, (j) => ({ ...j, otpLocked: true }));
        return "LOCKED";
      }
      return "WRONG_CODE";
    }
    this.wrongAttempts.delete(jobId);
    this.change(jobId, (j) => ({ ...j, stage: JobStageMachine.afterHandoff(kind) }));
    return "SUCCESS";
  }

  async saveRemark(jobId: string, remark: string): Promise<ActionResult> {
    await delay(150);
    this.change(jobId, (job) => ({ ...job, remark }));
    return "SUCCESS";
  }

  async finishJob(jobId: string, outcome: JobOutcome, reason?: string): Promise<ActionResult> {
    await delay(200);
    this.jobs.update((list) => {
      const finished = list.map((job) =>
        job.id !== jobId
          ? job
          : { ...job, listStatus: outcome, returnReason: outcome === "RETURNED" ? (reason ?? null) : job.returnReason },
      );
      // Promote the next upcoming job once nothing is active.
      if (finished.some((job) => job.listStatus === "ACTIVE")) return finished;
      const nextId = finished.find((job) => job.listStatus === "UPCOMING")?.id;
      return finished.map((job) => (job.id === nextId ? { ...job, listStatus: "ACTIVE" } : job));
    });
    return "SUCCESS";
  }

  async syncPendingArrivals() {
    return true;
  }

  private change(jobId: string, fn: (job: Job) => Job) {
    this.jobs.update((list) => list.map((job) => (job.id === jobId ? fn(job) : job)));
  }
}

export class LoggingDispatchLocationRepository implements DispatchLocationRepository {
  async publish(latitude: number, longitude: number) {
    console.debug("[demo] location", latitude.toFixed(5), longitude.toFixed(5));
  }

  async markOffline() {
    console.debug("[demo] location sharing stopped");
  }
}
