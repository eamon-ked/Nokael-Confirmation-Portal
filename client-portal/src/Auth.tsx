import { useState, type FormEvent, type ReactNode } from "react";
import { SUPPORT_WHATSAPP, supabase } from "./supabase";

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <p className="wordmark">nokael</p>
        <h1>{title}</h1>
        {children}
      </div>
      <p className="auth-foot">
        Need access? <a href={`https://wa.me/${SUPPORT_WHATSAPP}`}>Message Nokael on WhatsApp</a>
      </p>
    </main>
  );
}

export function SignIn({ initialError }: { initialError: string | null }) {
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(error.message === "Invalid login credentials" ? "That email and password don't match an account." : error.message);
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/portal/`,
      });
      if (error) setError(error.message);
      else setMode("sent");
    }
    setBusy(false);
  }

  if (mode === "sent") {
    return (
      <Shell title="Check your email">
        <p className="muted">If {email.trim()} has an account, a link to set a new password is on its way.</p>
        <button className="link" onClick={() => setMode("signin")}>Back to sign in</button>
      </Shell>
    );
  }

  return (
    <Shell title={mode === "signin" ? "Your deliveries" : "Reset your password"}>
      <form onSubmit={submit} className="stack">
        <label>
          Work email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "signin" && (
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Send reset link"}
        </button>
      </form>
      <button className="link" onClick={() => { setMode(mode === "signin" ? "forgot" : "signin"); setError(null); }}>
        {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
      </button>
    </Shell>
  );
}

export function SetPassword({ firstTime, onDone }: { firstTime: boolean; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <Shell title={firstTime ? "Set up your account" : "Choose a new password"}>
      <form onSubmit={submit} className="stack">
        <label>
          New password
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Repeat it
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </Shell>
  );
}
