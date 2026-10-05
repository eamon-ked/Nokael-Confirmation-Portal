/**
 * App models, mirroring `com.nokael.driver.model` in the Android app so both
 * clients describe a job the same way.
 */

/** A freelance driver who has been vetted and can sign in. */
export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
}

/** A WGS-84 coordinate. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** The two custody hand-offs in a job, each confirmed with a client OTP. */
export type HandoffKind = "PICKUP" | "DROPOFF";

/** Position of a job in the driver's queue, as shown on the home list. */
export type JobListStatus = "ACTIVE" | "UPCOMING" | "COMPLETED" | "RETURNED" | "CANCELLED";

/** How a job ended. */
export type JobOutcome = "COMPLETED" | "RETURNED" | "CANCELLED";

/** Where the driver is within a single job. Stages only ever move forward. */
export type JobStage = "HEADING_TO_PICKUP" | "AT_PICKUP" | "PICKED_UP" | "AT_DROPOFF" | "DROPPED_OFF";

export const STAGE_ORDER: JobStage[] = ["HEADING_TO_PICKUP", "AT_PICKUP", "PICKED_UP", "AT_DROPOFF", "DROPPED_OFF"];

export const stageIndex = (stage: JobStage) => STAGE_ORDER.indexOf(stage);

/** True once the driver has done anything on the job (reported arrival at pickup or later). */
export const isStarted = (stage: JobStage) => stage !== "HEADING_TO_PICKUP";

/** True while the driver is still on the way to (or at) the pickup point. */
export const isBeforePickup = (stage: JobStage) => stage === "HEADING_TO_PICKUP" || stage === "AT_PICKUP";

/** True while the driver physically has the package (picked up, not yet delivered). */
export const hasPackage = (stage: JobStage) => stage === "PICKED_UP" || stage === "AT_DROPOFF";

/**
 * A pickup or drop-off location.
 * `shortName` is a neighbourhood-level label, used on cards and buttons.
 */
export interface Place {
  address: string;
  shortName: string;
  emirate: string;
  latitude: number | null;
  longitude: number | null;
}

/** Proof that the driver reached a location ("I am here"). */
export interface ArrivalRecord {
  kind: HandoffKind;
  location: GeoPoint | null;
  timestampMillis: number;
}

/**
 * One delivery assigned to a driver. Phone numbers are null once a job is
 * finished (the server withholds them). `payoutAed` is null until dispatch
 * enters it. `otpLocked` is true after 5 wrong hand-off codes.
 */
export interface Job {
  id: string;
  ref: string;
  senderName: string;
  senderPhone: string | null;
  recipientName: string;
  recipientPhone: string | null;
  companyName: string | null;
  pickup: Place;
  dropoff: Place;
  scheduledPickupAtMillis: number | null;
  itemType: string;
  specialInstructions: string;
  payoutAed: number | null;
  listStatus: JobListStatus;
  stage: JobStage;
  remark: string;
  arrivals: ArrivalRecord[];
  otpLocked: boolean;
  returnReason: string | null;
  cancellationReason: string | null;
}

/** Sender before the package is collected, recipient afterwards. */
export const clientName = (job: Job) => (isBeforePickup(job.stage) ? job.senderName : job.recipientName);

export const clientPhone = (job: Job) => (isBeforePickup(job.stage) ? job.senderPhone : job.recipientPhone);

/** Display form of `itemType` ("fragile_item" -> "Fragile item"). */
export const cargo = (job: Job) => {
  const text = job.itemType.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Show times in the driver's company time zone whatever the phone's zone is,
// and money in its currency. Both come from driver_me's `org` (Asia/Dubai /
// AED — Nokael — until it's known or on an older backend).
let zone = "Asia/Dubai";
let currency = "AED";
let dateParts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
let timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true });

/** Apply the company profile returned by driver_me (`body.org`). Ignores anything malformed. */
export function setDriverOrg(org: unknown) {
  const settings = (org as { settings?: { timezone?: unknown; currency?: unknown } } | null)?.settings;
  if (typeof settings?.currency === "string" && /^[A-Z]{3}$/.test(settings.currency)) currency = settings.currency;
  if (typeof settings?.timezone === "string" && settings.timezone !== zone) {
    try {
      dateParts = new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone, weekday: "short", day: "numeric", month: "short" });
      timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone, hour: "numeric", minute: "2-digit", hour12: true });
      zone = settings.timezone;
    } catch {
      // unknown zone name — keep the previous one
    }
  }
}

/** ISO 4217 code for payouts ("AED" for Nokael). */
export const currencyCode = () => currency;

/** e.g. "Sat, 19 Sep"; empty when unscheduled. */
export const scheduledDate = (job: Job) => {
  if (job.scheduledPickupAtMillis == null) return "";
  const parts = Object.fromEntries(
    dateParts.formatToParts(new Date(job.scheduledPickupAtMillis)).map((part) => [part.type, part.value]),
  );
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
};

/** e.g. "2:30 PM"; "—" when unscheduled. */
export const scheduledTime = (job: Job) =>
  job.scheduledPickupAtMillis == null ? "—" : timeFormat.format(new Date(job.scheduledPickupAtMillis));

/** Numbers shown in the home-screen header. */
export interface DriverStats {
  jobsToday: number;
  completed: number;
  /** Sum of payouts dispatch has entered for completed jobs. */
  earningsAed: number;
}

/** Turns a driver's full job list into the header numbers. Jobs without a payout yet count as 0. */
export function calculateStats(jobs: Job[]): DriverStats {
  const completed = jobs.filter((job) => job.listStatus === "COMPLETED");
  return {
    jobsToday: jobs.length,
    completed: completed.length,
    earningsAed: completed.reduce((sum, job) => sum + (job.payoutAed ?? 0), 0),
  };
}

/** Like the Android `BigDecimal.toString()` for money: "180", "180.5". */
export const formatAed = (value: number) => String(Math.round(value * 100) / 100);
