import { useEffect, useState } from "react";
import { AppConfig } from "./logic/config";
import { container } from "./logic/container";
import { useStore } from "./logic/store";
import { ToastHost } from "./ui/components";
import { NavProvider, parseHash, useNav, type Route } from "./ui/nav";
import { LoginScreen, StartupScreen, VerifyScreen } from "./ui/screens/auth";
import { ResultScreen, ReturnScreen } from "./ui/screens/finish";
import { HomeScreen } from "./ui/screens/home";
import { JobScreen } from "./ui/screens/job";
import { HandoffOtpScreen } from "./ui/screens/otp";

/**
 * Where a reload should land after the session is restored: the job the driver
 * was on (the OTP / return screens reopen the job, which is always safe).
 */
function resumeTarget(): Route[] {
  const route = parseHash(location.hash);
  if (!route || route.name === "home") return [];
  if (route.name === "job" || route.name === "otp" || route.name === "return") return [{ name: "job", jobId: route.jobId }];
  return [];
}

const initialResume = resumeTarget();

export default function App() {
  return (
    <div className="app">
      <NetworkStrip />
      <NavProvider>{(route) => <Screens route={route} />}</NavProvider>
      <ToastHost />
    </div>
  );
}

function Screens({ route }: { route: Route }) {
  const nav = useNav();
  const driver = useStore(container.session.driver);

  // The one place that reacts to a session ending, however it ended (sign-out,
  // or the server rejecting the token mid-app): no driver -> back to login.
  useEffect(() => {
    if (driver == null && route.name !== "login" && route.name !== "verify" && route.name !== "startup") {
      nav.resetTo({ name: "login" });
    }
  }, [driver, route.name, nav]);

  switch (route.name) {
    case "startup":
      return <StartupScreen resumeTo={initialResume} />;
    case "login":
      return <LoginScreen />;
    case "verify":
      return <VerifyScreen />;
    case "home":
      return <HomeScreen />;
    case "job":
      return <JobScreen key={route.jobId} jobId={route.jobId} />;
    case "otp":
      return <HandoffOtpScreen key={`${route.jobId}-${route.kind}`} jobId={route.jobId} kind={route.kind} />;
    case "return":
      return <ReturnScreen key={route.jobId} jobId={route.jobId} />;
    case "result":
      return <ResultScreen outcome={route.outcome} />;
  }
}

/** Web only: a thin strip when the device has no connection, or when running the demo backend. */
function NetworkStrip() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (AppConfig.useFakeBackend) {
    return (
      <div className="net-strip" style={{ background: "var(--purple)", paddingTop: "calc(6px + var(--safe-top))" }}>
        DEMO MODE · sample jobs, nothing is sent to dispatch
      </div>
    );
  }
  if (online) return null;
  return (
    <div className="net-strip" style={{ paddingTop: "calc(6px + var(--safe-top))" }} role="status">
      No connection · showing your last saved jobs. Arrivals will sync when you're back online.
    </div>
  );
}
