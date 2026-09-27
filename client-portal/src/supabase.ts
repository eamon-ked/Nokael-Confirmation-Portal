import { createClient } from "@supabase/supabase-js";

// Read the auth link intent BEFORE the client consumes the URL hash on init.
// Invite and password-recovery links both land here and must end on "set a password".
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
export const linkIntent: "invite" | "recovery" | null =
  hash.get("type") === "invite" ? "invite" : hash.get("type") === "recovery" ? "recovery" : null;
export const linkError: string | null = hash.get("error_description");

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export const COC_URL = (import.meta.env.VITE_COC_URL || "https://coc.nokael.com").replace(/\/$/, "");
export const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP || "971509710446";
