import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { linkError, linkIntent, supabase } from "./supabase";
import { SetPassword, SignIn } from "./Auth";
import Dashboard from "./Dashboard";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [needsPassword, setNeedsPassword] = useState(linkIntent !== null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setNeedsPassword(true);
      setSession(s);
    });
    if (linkIntent || linkError) history.replaceState(null, "", window.location.pathname); // don't leave tokens in the address bar
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="boot" aria-busy="true" />;
  if (!session) return <SignIn initialError={linkError ? "That link has expired or was already used. Ask Nokael for a new one, or reset your password below." : null} />;
  if (needsPassword) return <SetPassword firstTime={linkIntent === "invite"} onDone={() => setNeedsPassword(false)} />;
  return <Dashboard email={session.user.email ?? ""} />;
}
