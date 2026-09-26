import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { container } from "./logic/container";
import "./styles.css";

container.start();

// Dev only: lets you poke the app from the console (e.g. simulate dispatch cancelling a demo job).
if (import.meta.env.DEV) (window as unknown as { nokael: typeof container }).nokael = container;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline app shell. Only in production builds: in dev it would cache Vite's modules.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined);
  });
}
