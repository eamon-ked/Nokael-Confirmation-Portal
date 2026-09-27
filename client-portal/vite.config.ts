import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  // A production bundle without the backend config can't sign anyone in. Fail the build instead.
  if (command === "build") {
    for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
      if (!(env[key] ?? "").trim()) throw new Error(`Refusing to build without ${key}. Set it in client-portal/.env or the Render environment.`);
    }
  }

  return {
    // Served by the Confirmation Portal at https://coc.nokael.com/portal/
    base: "/portal/",
    plugins: [react()],
    server: { host: true, port: 5181 },
    preview: { host: true, port: 5181 },
  };
});
