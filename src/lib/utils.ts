/**
 * Formats a date string to UAE time (Asia/Dubai)
 * UAE is UTC+4, no DST.
 */
export function formatUAETime(date: string | Date | null): string {
  if (!date) return '';
  
  return new Intl.DateTimeFormat('en-AE', {
    timeZone: 'Asia/Dubai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

/**
 * Detects if the app is running inside WhatsApp in-app browser
 */
export function isWhatsAppBrowser(): boolean {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
  return /WhatsApp/i.test(ua);
}
