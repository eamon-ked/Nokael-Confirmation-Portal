// Waiting time on client links. The server opens a wait when the driver
// arrives and closes it at handover (job_waits); this is the same maths as
// the server and the dashboard (nokael-concierge-V2/src/lib/waiting.ts) for
// the live clock between fetches.
//
//   minutes = whole minutes since clock_start (15:50 → 15)
//   charge  = ceil(max(0, minutes - free) / block) × block amount

import type { Job, TrackWait, WaitingPolicy } from '@/src/types';

export const money = (n: number, currency?: string | null) =>
  `${(currency || 'AED').toUpperCase()} ${Number.isInteger(n) ? n : n.toFixed(2)}`;

export interface WaitView {
  open: boolean;
  early: boolean;
  minutes: number;
  freeLeft: number;
  overFree: boolean;
  charge: number;
  waived: boolean;
}

export function waitView(w: TrackWait, now = Date.now()): WaitView {
  const open = !w.ended_at;
  const start = new Date(w.clock_start).getTime();
  const minutes = open ? Math.max(0, Math.floor((now - start) / 60000)) : (w.wait_min ?? 0);
  const running = Math.ceil(Math.max(0, minutes - w.free_min) / Math.max(w.block_min, 1)) * Number(w.block_aed);
  return {
    open,
    early: open && start > now,
    minutes,
    freeLeft: Math.max(0, w.free_min - minutes),
    overFree: minutes > w.free_min,
    charge: open ? running : Number(w.charge_aed ?? 0),
    waived: !!w.waived,
  };
}

/** The wait running now, if the driver is waiting somewhere. */
export const openWaitOf = (job: Job): TrackWait | null =>
  ['completed', 'cancelled', 'returned'].includes(job.status) ? null : (job.waits ?? []).find(w => !w.ended_at) ?? null;

export const waitForStop = (job: Job, stopId: string) => (job.waits ?? []).find(w => w.stop_id === stopId) ?? null;
export const waitForLeg = (job: Job, leg: 'pickup' | 'dropoff') => (job.waits ?? []).find(w => w.leg === leg && !w.stop_id) ?? null;

/** "15 min free waiting, then AED 25 per 15 min" */
export const policyLine = (p: WaitingPolicy | null | undefined): string | null =>
  p && p.enabled ? `${p.free_min} min free waiting, then ${money(Number(p.block_aed), p.currency)} per ${p.block_min} min` : null;

/** Finished wait, for stop lists and the delivered view. */
export function waitedText(w: TrackWait): string | null {
  const v = waitView(w);
  if (v.open || v.minutes <= 0) return null;
  if (v.waived) return `Driver waited ${v.minutes} min · waiting waived`;
  return v.charge > 0 ? `Driver waited ${v.minutes} min · ${money(v.charge, w.currency)} waiting` : `Driver waited ${v.minutes} min · free`;
}
