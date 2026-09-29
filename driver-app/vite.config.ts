import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();

  // Same rule as the Android release build: a production bundle must never ship without
  // the backend key (every sign-in would fail) or without a dispatch number.
  if (command === "build") {
    if (anonKey === "") {
      throw new Error("Refusing to build without VITE_SUPABASE_ANON_KEY. Set it in .env.");
    }
    if (!(env.VITE_DISPATCH_PHONE ?? "").trim()) {
      throw new Error("Refusing to build without a dispatch number. Set VITE_DISPATCH_PHONE in .env.");
    }
  }

  return {
    // Served by the Confirmation Portal at https://coc.nokael.com/driver-app/
    base: "/driver-app/",
    plugins: [react()],
    // Reported to dispatch with each sign-in (driver_report_app) so they can see which build a phone runs.
    define: { __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
    server: { host: true, port: 5180 },
    preview: { host: true, port: 5180 },
  };
});
