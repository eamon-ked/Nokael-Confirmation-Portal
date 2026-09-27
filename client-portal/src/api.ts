import { supabase } from "./supabase";

export type Membership = { business_id: string; company_name: string; role: "admin" | "viewer" };

export type Campaign = {
  client_reference: string | null;
  jobs_total: number;
  jobs_delivered: number;
  first_slot: string;
  last_slot: string;
};

export type Job = {
  job_id: string;
  job_ref: string | null;
  client_reference: string | null;
  recipient_name: string;
  delivery_emirate: string;
  delivery_location: string;
  slot_start: string | null;
  slot_end: string | null;
  status: string;
  picked_up_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  delivery_verified_by: "otp" | "ops_override" | null;
  returned_at: string | null;
  return_reason: string | null;
  remark: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_location_at: string | null;
  tracking_token: string | null;
};

type PodRow = Record<string, string | number | null>;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message === "not_authorized" ? "Your account doesn't have access to this company." : error.message);
  return data as T;
}

export const getMemberships = () => rpc<Membership[]>("client_me");
export const getCampaigns = (businessId: string) => rpc<Campaign[]>("client_list_references", { p_business_id: businessId });
export const getJobs = (businessId: string, reference: string | null) =>
  rpc<Job[]>("client_list_jobs", { p_business_id: businessId, p_reference: reference });
export const getPodReport = (businessId: string, reference: string | null) =>
  rpc<PodRow[]>("client_pod_report", { p_business_id: businessId, p_reference: reference });

// ---------- Status vocabulary: one name per state, used everywhere ----------

export type Tone = "waiting" | "moving" | "done" | "problem";

export function statusOf(job: Job): { label: string; tone: Tone } {
  switch (job.status) {
    case "completed": return { label: "Delivered", tone: "done" };
    case "returned": return { label: "Returned", tone: "problem" };
    case "driver_pickup": return { label: job.arrived_at ? "At the door" : "On the way", tone: "moving" };
    case "driver_delivery": return { label: "Awaiting recipient", tone: "moving" };
    case "client_pickup": return { label: "Being collected", tone: "waiting" };
    default: return { label: "Scheduled", tone: "waiting" };
  }
}

export const verifiedLabel = (v: Job["delivery_verified_by"]) =>
  v === "otp" ? "Confirmed with the recipient's code" : v === "ops_override" ? "Confirmed by Nokael operations" : null;

// ---------- Time: always shown in UAE time, whatever the viewer's device says ----------

const TZ = "Asia/Dubai";
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const timeF = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const dayKeyF = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabelF = fmt({ weekday: "short", day: "numeric", month: "short" });
const fullF = fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export const time = (iso: string | null) => (iso ? timeF.format(new Date(iso)) : "");
export const full = (iso: string | null) => (iso ? fullF.format(new Date(iso)) : "");
export const dayKey = (iso: string) => dayKeyF.format(new Date(iso));
export const dayLabel = (iso: string) => dayLabelF.format(new Date(iso));

export function slotText(job: Job): string {
  if (!job.slot_start) return "No time slot set";
  return job.slot_end ? `${time(job.slot_start)}–${time(job.slot_end)}` : `From ${time(job.slot_start)}`;
}

export function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

// ---------- POD export ----------

const POD_COLUMNS: [string, string, "text" | "time" | "method" | "num"][] = [
  ["job_ref", "Reference", "text"],
  ["recipient_name", "Recipient", "text"],
  ["delivery_emirate", "Emirate", "text"],
  ["delivery_location", "Address", "text"],
  ["slot_start", "Slot start", "time"],
  ["slot_end", "Slot end", "time"],
  ["status", "Status", "text"],
  ["picked_up_at", "Collected", "time"],
  ["arrived_at", "Driver arrived", "time"],
  ["arrived_lat", "Arrival latitude", "num"],
  ["arrived_lng", "Arrival longitude", "num"],
  ["delivered_at", "Delivered", "time"],
  ["delivery_verified_by", "Delivery confirmed by", "method"],
  ["handoff_lat", "Handover latitude", "num"],
  ["handoff_lng", "Handover longitude", "num"],
  ["handoff_accuracy_m", "GPS accuracy (m)", "num"],
  ["handoff_fix_age_s", "GPS fix age (s)", "num"],
  ["returned_at", "Returned", "time"],
  ["return_reason", "Return reason", "text"],
  ["remark", "Driver remark", "text"],
];

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function podCsv(rows: PodRow[]): string {
  const head = [...POD_COLUMNS.map((c) => c[1]), "Handover map link"];
  const lines = rows.map((r) => {
    const cells = POD_COLUMNS.map(([key, , kind]) => {
      const v = r[key];
      if (v == null) return "";
      if (kind === "time") return full(String(v));
      if (kind === "method") return v === "otp" ? "Recipient code (OTP)" : v === "ops_override" ? "Nokael operations" : String(v);
      if (kind === "num" && typeof v === "number") return key.endsWith("_lat") || key.endsWith("_lng") ? v.toFixed(6) : String(Math.round(v));
      return String(v);
    });
    const link = r.handoff_lat != null ? `https://maps.google.com/?q=${r.handoff_lat},${r.handoff_lng}` : "";
    return [...cells, link].map(csvCell).join(",");
  });
  return "\uFEFF" + [head.map(csvCell).join(","), ...lines].join("\r\n"); // BOM so Excel reads UTF-8
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
