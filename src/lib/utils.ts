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
 * Detects if the app is running inside WhatsApp in-app browser
 */
export function isWhatsAppBrowser(): boolean {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
  return /WhatsApp/i.test(ua);
}
