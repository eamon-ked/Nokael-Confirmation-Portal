/**
 * GLOBAL BUSINESS CONTACT DATA
 * Mirrors the pattern used in the main Nokael marketing site (nokael-concierge-V2).
 * Update VITE_WHATSAPP_NUMBER in your deployment env vars to change this sitewide —
 * never hardcode a number directly in a component.
 */
export const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '971509710446';
export const DISPATCH_WA_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

/**
 * Client links stop working 24 h after the job is completed (enforced by the
 * database: get_job_by_token / get_job_by_ref raise 'link_expired'). The visitor
 * is sent to book a new job instead; the booking page explains that dispatch can
 * resend the COC certificate.
 */
export const BOOK_URL = (import.meta.env.VITE_BOOK_URL || 'https://www.nokael.com/get-quote').replace(/\/$/, '');
export const LINK_EXPIRY_HOURS = 24;
export const isLinkExpired = (err: { message?: string } | null | undefined) => !!err?.message?.includes('link_expired');
export const redirectToBooking = () => window.location.replace(`${BOOK_URL}?expired=1`);