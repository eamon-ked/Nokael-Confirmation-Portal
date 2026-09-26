import type { ArrivalRecord, Driver, Job, JobListStatus, JobStage, Place } from "./model";

/**
 * Turns the backend's JSON into app models — the same mapping as the Android
 * `DriverJson`, so both clients read every field identically. This is the only
 * place that knows field names.
 */

type Json = Record<string, any>;

/** The backend sends "" for an absent value about as often as it omits the key; treat both as null. */
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Thrown when a body doesn't have the shape we need (the Android `JSONException`). */
export class ShapeError extends Error {}

export function driver(source: unknown): Driver {
  const dto = source as Json;
  if (!dto || typeof dto.id !== "string") throw new ShapeError("driver");
  return {
    id: dto.id,
    name: str(dto.full_name) ?? "",
    phone: str(dto.phone) ?? "",
    email: str(dto.email) ?? "",
  };
}

export function jobs(body: unknown): Job[] {
  const list = (body as Json)?.jobs ?? [];
  if (!Array.isArray(list)) throw new ShapeError("jobs");
  return list.map(job);
}

export function job(source: unknown): Job {
  const dto = source as Json;
  if (!dto || typeof dto.id !== "string") throw new ShapeError("job");
  return {
    id: dto.id,
    ref: str(dto.job_ref) ?? dto.id,
    senderName: str(dto.sender_name) ?? "",
    senderPhone: str(dto.sender_phone),
    recipientName: str(dto.recipient_name) ?? "",
    recipientPhone: str(dto.recipient_phone),
    companyName: str(dto.company_name),
    pickup: place(dto.pickup),
    dropoff: place(dto.dropoff),
    scheduledPickupAtMillis: epochMillis(dto.scheduled_pickup_at),
    itemType: str(dto.item_type) ?? "",
    specialInstructions: str(dto.special_instructions) ?? "",
    payoutAed: num(dto.driver_payout_aed),
    listStatus: listStatus(dto.list_status),
    stage: stage(dto.stage),
    remark: str(dto.driver_remark) ?? "",
    arrivals: Array.isArray(dto.arrivals) ? dto.arrivals.map(arrival).filter((a): a is ArrivalRecord => a != null) : [],
    otpLocked: dto.otp_locked === true,
    returnReason: str(dto.return_reason),
    cancellationReason: str(dto.cancellation_reason),
  };
}

function place(dto: Json | null | undefined): Place {
  if (!dto) return { address: "", shortName: "", emirate: "", latitude: null, longitude: null };
  const address = str(dto.address) ?? "";
  const emirate = str(dto.emirate) ?? "";
  return { address, shortName: shortName(address, emirate), emirate, latitude: num(dto.lat), longitude: num(dto.lng) };
}

/**
 * The server has no neighbourhood field, so derive a short label: the first
 * comma-separated part of the address ("DIFC, Gate 3" -> "DIFC"), or the
 * second when the first is a street number ("14 Al Wasl Road, Jumeirah" ->
 * "Jumeirah"), falling back to the emirate.
 */
export function shortName(address: string, emirate: string): string {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  let chosen = "";
  if (parts.length > 1 && /\d/.test(parts[0][0])) chosen = parts[1];
  else if (parts.length > 0) chosen = parts[0];
  return chosen.trim() === "" ? emirate : chosen;
}

function arrival(dto: Json): ArrivalRecord | null {
  const at = epochMillis(dto?.at);
  if (at == null) return null;
  const lat = num(dto.lat);
  const lng = num(dto.lng);
  return {
    kind: dto.kind === "pickup" ? "PICKUP" : "DROPOFF",
    location: lat != null && lng != null ? { latitude: lat, longitude: lng } : null,
    timestampMillis: at,
  };
}

function listStatus(value: unknown): JobListStatus {
  switch (value) {
    case "active":
      return "ACTIVE";
    case "completed":
      return "COMPLETED";
    case "returned":
      return "RETURNED";
    case "cancelled":
      return "CANCELLED";
    default:
      return "UPCOMING";
  }
}

function stage(value: unknown): JobStage {
  switch (value) {
    case "at_pickup":
      return "AT_PICKUP";
    case "picked_up":
      return "PICKED_UP";
    case "at_dropoff":
      return "AT_DROPOFF";
    case "dropped_off":
      return "DROPPED_OFF";
    default:
      return "HEADING_TO_PICKUP";
  }
}

/** Timestamps come as ISO-8601 with an offset. */
function epochMillis(value: unknown): number | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
