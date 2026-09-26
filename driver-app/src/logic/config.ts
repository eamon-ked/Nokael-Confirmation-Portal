/**
 * Build-time settings, from `.env` (see `.env.example`). Same switches as the
 * Android app's `local.properties`.
 */
const env = import.meta.env;

const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();
const fakeFlag = (env.VITE_USE_FAKE_BACKEND ?? "").trim().toLowerCase();

export const AppConfig = {
  supabaseUrl: (env.VITE_SUPABASE_URL ?? "https://hhgzxpuzsbqirmbsiltn.supabase.co").trim(),
  supabaseAnonKey: anonKey,
  /** Number used by the Call / Message dispatch actions. */
  dispatchPhone: (env.VITE_DISPATCH_PHONE ?? "").trim(),
  /** In-memory demo jobs & accounts. Defaults to on only while the anon key is blank. */
  useFakeBackend: fakeFlag === "true" ? true : fakeFlag === "false" ? false : anonKey === "",
  /** Show demo accounts / demo codes on screen. Only ever with the fake backend. */
  get showDemoHints() {
    return this.useFakeBackend;
  },
};

if (import.meta.env.PROD && AppConfig.useFakeBackend) {
  // A production build should never silently ship fake jobs and fake logins.
  console.warn("Nokael Driver is running on the in-memory DEMO backend. Set VITE_SUPABASE_ANON_KEY.");
}
