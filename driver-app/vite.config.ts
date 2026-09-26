import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  const fake = (env.VITE_USE_FAKE_BACKEND ?? "").trim().toLowerCase();
  const useFake = fake === "true" || (fake !== "false" && anonKey === "");

  // Same rule as the Android release build: a production bundle must never run on the
  // in-memory demo backend (fake jobs, fake logins) or ship without a dispatch number.
  // `npm run build -- --mode demo` builds the demo on purpose.
  if (command === "build" && mode !== "demo") {
    if (useFake || anonKey === "") {
      throw new Error("Refusing to build with the fake backend. Set VITE_SUPABASE_ANON_KEY in .env and make sure VITE_USE_FAKE_BACKEND is not true.");
    }
    if (!(env.VITE_DISPATCH_PHONE ?? "").trim()) {
      throw new Error("Refusing to build without a dispatch number. Set VITE_DISPATCH_PHONE in .env.");
    }
  }

  return {
    // Served by the Confirmation Portal at https://coc.nokael.com/driver-app/
    base: "/driver-app/",
    plugins: [react()],
    server: { host: true, port: 5180 },
    preview: { host: true, port: 5180 },
  };
});
