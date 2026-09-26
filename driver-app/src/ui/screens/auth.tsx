import { useEffect, useRef, useState } from "react";
import { AppConfig } from "../../logic/config";
import { container, LoginDraft } from "../../logic/container";
import { DEMO_ACCOUNTS } from "../../logic/fake";
import { BackCircleButton, DarkPanelScaffold, Emoji, ExternalActions, SectionLabel, Tap, toast, useThemeColor } from "../components";
import { useNav, type Route } from "../nav";

/* ===========================================================================
 * Startup: validates a stored session before deciding where the app lands.
 * If the server can't be reached the token is kept and a retry is offered,
 * rather than dropping the driver on the login screen over a signal blip.
 * ========================================================================= */
export function StartupScreen({ resumeTo }: { resumeTo: Route[] }) {
  useThemeColor("#0F172A");
  const nav = useNav();
  const [attempt, setAttempt] = useState(0);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUnreachable(false);
    container.session.startup.set("CHECKING");
    container.auth.restoreSession().then((result) => {
      if (cancelled) return;
      switch (result.type) {
        case "restored":
          container.session.signIn(result.driver);
          nav.resetTo({ name: "home" }, ...resumeTo);
          break;
        case "no_session":
        case "expired":
          container.session.signOut();
          nav.resetTo({ name: "login" });
          break;
        case "unreachable":
          container.session.startup.set("UNREACHABLE");
          setUnreachable(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className="screen col" style={{ background: "var(--navy)", alignItems: "center", justifyContent: "center", padding: "0 32px" }}>
      <Emoji size={64}>🚛</Emoji>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", margin: "16px 0 24px" }}>Nokael Driver</div>
      {!unreachable ? (
        <div className="spinner" role="progressbar" aria-label="Loading" />
      ) : (
        <>
          <div className="center" style={{ fontSize: 16, color: "rgba(255,255,255,0.8)", marginBottom: 24 }}>
            Can't reach the server. Check your connection and try again.
          </div>
          <Tap onClick={() => setAttempt((n) => n + 1)} color="var(--blue)" radius={16} className="full">
            <div className="center" style={{ fontSize: 18, fontWeight: 900, padding: "18px 0" }}>
              Try again
            </div>
          </Tap>
          <Tap
            onClick={() => {
              // The driver chose to skip the stored session; signing in replaces the token.
              container.session.signOut();
              nav.resetTo({ name: "login" });
            }}
            color="transparent"
            contentColor="rgba(255,255,255,0.6)"
            radius={16}
            className="full"
            style={{ marginTop: 8 }}
          >
            <div className="center" style={{ fontSize: 14, padding: "12px 0" }}>
              Sign in again
            </div>
          </Tap>
        </>
      )}
    </div>
  );
}

/* ===========================================================================
 * Login screen 1: phone or email. Format is checked locally — no server call,
 * and never a "no account found" answer. Credentials are checked on screen 2.
 * ========================================================================= */
export function LoginScreen() {
  useThemeColor("#0F172A");
  const nav = useNav();
  const [identifier, setIdentifier] = useState(container.loginDraft.identifier);
  const [error, setError] = useState<string | null>(null);
  const demoDrivers = AppConfig.showDemoHints ? DEMO_ACCOUNTS.map((a) => a.driver) : [];
  const canContinue = identifier.trim() !== "";

  const onContinue = () => {
    if (!canContinue) return;
    if (!LoginDraft.isValidIdentifier(identifier)) {
      setError("Enter a valid phone number or email.");
      return;
    }
    container.loginDraft.set(identifier);
    nav.push({ name: "verify" });
  };

  return (
    <DarkPanelScaffold
      header={
        <div className="col" style={{ alignItems: "center", padding: "48px 24px 40px" }}>
          <Emoji size={72}>🚛</Emoji>
          <div style={{ fontSize: 30, fontWeight: 900, color: "#fff", margin: "16px 0 4px" }}>Driver Portal</div>
          <div className="center" style={{ fontSize: 16, color: "rgba(255,255,255,0.5)" }}>
            Sign in to access your deliveries
          </div>
        </div>
      }
    >
      <form
        className="col"
        onSubmit={(event) => {
          event.preventDefault();
          onContinue();
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, color: "var(--gray-900)" }}>Welcome back</div>
        <div style={{ fontSize: 14, color: "var(--gray-500)", margin: "4px 0 24px" }}>Enter your phone number or email to continue</div>
        <label htmlFor="identifier">
          <SectionLabel text="Phone or email" style={{ marginBottom: 8 }} />
        </label>
        <input
          id="identifier"
          className={`field ${identifier ? "has-value" : ""} ${error ? "error" : ""}`}
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
            setError(null);
          }}
          placeholder="+971 5X XXX XXXX or you@email.com"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        {error && <div className="error-text">❌ {error}</div>}
        <Tap onClick={onContinue} disabled={!canContinue} color={canContinue ? "var(--blue)" : "rgba(59,130,246,0.5)"} radius={16} className="btn" style={{ marginTop: 24 }}>
          Continue →
        </Tap>
        <button type="submit" hidden />
      </form>
      {demoDrivers.length > 0 && (
        <div style={{ marginTop: 32, background: "var(--slate-100)", borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--gray-400)", marginBottom: 8 }}>DEMO ACCOUNTS</div>
          {demoDrivers.map((driver) => (
            <Tap
              key={driver.id}
              onClick={() => {
                setIdentifier(driver.phone);
                setError(null);
              }}
              color="transparent"
              contentColor="var(--gray-700)"
              radius={12}
              className="full"
            >
              <div className="row" style={{ gap: 8, padding: "8px 12px" }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: "var(--gray-700)" }}>{driver.name}</span>
                <span style={{ fontSize: 12, color: "var(--gray-400)" }}>{driver.phone}</span>
              </div>
            </Tap>
          ))}
        </div>
      )}
      <InstallHint />
    </DarkPanelScaffold>
  );
}

/* ===========================================================================
 * Login screen 2: the password. One `driver_login` call carries both
 * credentials. Every wrong-credentials outcome shows the same message.
 * ========================================================================= */
export function VerifyScreen() {
  useThemeColor("#0F172A");
  const nav = useNav();
  const identifier = container.loginDraft.identifier;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lockedSeconds, setLockedSeconds] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Reloaded on this screen: the identifier lived in memory only.
    if (!identifier) nav.resetTo({ name: "login" });
    return () => {
      mounted.current = false;
    };
  }, [identifier, nav]);

  useEffect(() => {
    if (lockedSeconds <= 0) return;
    setError(lockedMessage(lockedSeconds));
    const timer = setTimeout(() => {
      setLockedSeconds((s) => s - 1);
      if (lockedSeconds === 1) setError(null);
    }, 1000);
    return () => clearTimeout(timer);
  }, [lockedSeconds]);

  const demoPassword = AppConfig.showDemoHints
    ? DEMO_ACCOUNTS.find((a) => {
        const cleaned = identifier.replace(/ /g, "");
        return a.driver.phone === cleaned || a.driver.email.toLowerCase() === cleaned.toLowerCase();
      })?.password
    : undefined;

  const canSubmit = password !== "" && !checking && lockedSeconds === 0;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setChecking(true);
    setError(null);
    const result = await container.auth.login(identifier, password, container.deviceLabel);
    if (!mounted.current) return;
    switch (result.type) {
      case "success":
        setChecking(false);
        container.session.signIn(result.driver);
        container.loginDraft.clear();
        // Clear the whole login/verify stack — Home becomes the new root.
        nav.resetTo({ name: "home" });
        break;
      case "incorrect_credentials":
        setChecking(false);
        setError("Incorrect phone/email or password.");
        break;
      case "locked":
        setChecking(false);
        setPassword("");
        setLockedSeconds(Math.max(1, result.retryAfterSeconds));
        break;
      case "failure":
        setChecking(false);
        setError("Can't reach the server. Check your connection and try again.");
    }
  };

  return (
    <DarkPanelScaffold
      header={
        <div className="row" style={{ padding: "16px 20px 24px", gap: 16 }}>
          <BackCircleButton onClick={nav.back} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="label" style={{ color: "rgba(255,255,255,0.5)" }}>
              Verification
            </span>
            <span className="ellipsis" style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              {identifier}
            </span>
          </div>
        </div>
      }
    >
      <form
        className="col"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        {/* Lets password managers pair the saved password with the right account. */}
        <input type="text" autoComplete="username" value={identifier} readOnly hidden />
        <label htmlFor="password">
          <SectionLabel text="Password" style={{ marginBottom: 8 }} />
        </label>
        <input
          id="password"
          className={`field ${password ? "has-value" : ""} ${error ? "error" : ""}`}
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            // Keep the lockout message visible; typing doesn't unlock anything.
            if (lockedSeconds === 0) setError(null);
          }}
          placeholder="Enter your password"
          autoComplete="current-password"
          enterKeyHint="done"
          autoFocus
        />
        {error && <div className="error-text">❌ {error}</div>}
        <Tap onClick={() => void onSubmit()} disabled={!canSubmit} color={password === "" ? "rgba(59,130,246,0.5)" : "var(--blue)"} radius={16} className="btn" style={{ marginTop: 24 }}>
          {checking ? "Checking…" : "Sign In →"}
        </Tap>
        <button type="submit" hidden />
      </form>
      {demoPassword && (
        <div className="row" style={{ marginTop: 16, background: "var(--slate-50)", borderRadius: 12, padding: 12, fontSize: 12 }}>
          <span style={{ color: "var(--gray-400)" }}>Demo:&nbsp;</span>
          <span style={{ fontWeight: 900, color: "var(--gray-600)" }}>{demoPassword}</span>
        </div>
      )}
      <div className="row" style={{ justifyContent: "center", marginTop: 20 }}>
        <Tap
          onClick={() => {
            if (!ExternalActions.dial(AppConfig.dispatchPhone)) toast("Dispatch number isn't set up. Contact your manager.");
          }}
          color="transparent"
          contentColor="var(--gray-400)"
          radius={12}
        >
          <div style={{ fontSize: 13, padding: 8 }}>Trouble signing in? Call dispatch</div>
        </Tap>
      </div>
    </DarkPanelScaffold>
  );
}

function lockedMessage(remaining: number) {
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  return `Too many attempts. Try again in ${minutes}:${seconds}, or call dispatch.`;
}

/* ===========================================================================
 * Web only: nudge the driver to add the app to their home screen, so it opens
 * full-screen like the Android app and survives a lost signal.
 * ========================================================================= */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let deferredInstall: InstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event as InstallPromptEvent;
});

function InstallHint() {
  const [, force] = useState(0);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  useEffect(() => {
    const onPrompt = () => force((n) => n + 1);
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (standalone) return null;
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!deferredInstall && !isIos) return null;
  return (
    <div style={{ marginTop: 24, background: "var(--blue-tint)", borderRadius: 16, padding: 16, fontSize: 13, color: "var(--gray-600)", lineHeight: "20px" }}>
      <div style={{ fontWeight: 900, color: "var(--gray-800)", marginBottom: 4 }}>📲 Add to your home screen</div>
      {deferredInstall ? (
        <Tap
          onClick={() => {
            void deferredInstall?.prompt();
            deferredInstall = null;
            force((n) => n + 1);
          }}
          color="var(--blue)"
          radius={12}
          style={{ marginTop: 8 }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, padding: "10px 16px" }}>Install Nokael Driver</div>
        </Tap>
      ) : (
        <span>
          In Safari, tap <b>Share</b> then <b>Add to Home Screen</b>.
        </span>
      )}
    </div>
  );
}
