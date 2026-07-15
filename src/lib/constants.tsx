/**
 * GLOBAL BUSINESS CONTACT DATA
 * Mirrors the pattern used in the main Nokael marketing site (nokael-concierge-V2).
 * Update VITE_WHATSAPP_NUMBER in your deployment env vars to change this sitewide —
 * never hardcode a number directly in a component.
 */
export const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || '971509710446';
export const DISPATCH_WA_URL = `https://wa.me/${WHATSAPP_NUMBER}`;