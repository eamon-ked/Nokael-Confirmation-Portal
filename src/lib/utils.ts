import { orgLocale, orgTimeZone } from './org';

/**
 * Formats a date in the job's company time zone (lib/org — Asia/Dubai for
 * Nokael and until the company is known). Name kept for existing callers.
 */
export function formatUAETime(date: string | Date | null): string {
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat(orgLocale(), {
      timeZone: orgTimeZone(),
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleString();
  }
}

/**
 * A pickup/delivery window in the company time zone: "3:00–5:00 PM" today,
 * "Tue, 21 Oct, 3:00–5:00 PM" on another day, "from 3:00 PM" with no end.
 * Empty when there is no window.
 */
export function formatWindow(start?: string | null, end?: string | null): string {
  if (!start && !end) return '';
  const tz = orgTimeZone();
  const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  const day = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const first = (s ?? e)!;
  const prefix = day(first) === day(new Date()) ? '' : `${day(first)}, `;
  if (s && e) {
    const sameDay = day(s) === day(e);
    const st = time(s), et = time(e);
    // "3:00 pm–5:00 pm" → "3:00–5:00 pm" when both share am/pm.
    const sharedPeriod = st.slice(-2) === et.slice(-2);
    return sameDay
      ? `${prefix}${sharedPeriod ? st.slice(0, -3) : st}–${et}`
      : `${prefix}${st} – ${day(e)}, ${et}`;
  }
  return s ? `${prefix}from ${time(s)}` : `${prefix}by ${time(e!)}`;
}

/** "2:00 pm" today, else "Thu, 23 Oct, 2:00 pm", in the company time zone. */
export function formatClock(date: string | Date): string {
  const tz = orgTimeZone();
  const d = new Date(date);
  const day = (x: Date) => x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
  const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  return day(d) === day(new Date()) ? time : `${day(d)}, ${time}`;
}

/**
 * Where an expected arrival falls against a window: on time, or minutes late
 * past the window end (or start, when there is no end). Null without a window.
 */
export function windowFit(arrival: Date, start?: string | null, end?: string | null): { late: boolean; minutes: number } | null {
  const deadline = end ?? start;
  if (!deadline) return null;
  const minutes = Math.round((arrival.getTime() - new Date(deadline).getTime()) / 60000);
  return { late: minutes > 2, minutes: Math.max(0, minutes) };
}

/**
 * Detects if the app is running inside WhatsApp in-app browser
 */
export function isWhatsAppBrowser(): boolean {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
  return /WhatsApp/i.test(ua);
}
