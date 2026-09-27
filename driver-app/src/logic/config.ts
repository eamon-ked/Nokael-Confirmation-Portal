/**
 * Build-time settings, from `.env` (see `.env.example`). Same switches as the
 * Android app's `local.properties`.
 */
const env = import.meta.env;

const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

export const AppConfig = {
  supabaseUrl: (env.VITE_SUPABASE_URL ?? "https://hhgzxpuzsbqirmbsiltn.supabase.co").trim(),
  supabaseAnonKey: anonKey,
  /** Number used by the Call / Message dispatch actions. */
  dispatchPhone: (env.VITE_DISPATCH_PHONE ?? "").trim(),
};

if (anonKey === "") {
  // Every sign-in would fail; say why instead of leaving drivers guessing.
  console.error("Nokael Driver has no VITE_SUPABASE_ANON_KEY; it cannot reach the backend.");
}
