import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import {
  ago, brand, dayKey, dayLabel, download, getCampaigns, getJobs, getMemberships, getPodReport, loadOrg, podCsv,
  slotText, statusOf, supportWhatsApp, type Campaign, type Job, type Membership,
} from "./api";
import JobPanel from "./JobPanel";
import { disablePush, enablePush, getPushState, syncPush, type PushState } from "./push";

const REFRESH_MS = 30_000;

type Day = { key: string; label: string; jobs: Job[] };

function groupByDay(jobs: Job[]): Day[] {
  const days = new Map<string, Day>();
  for (const j of jobs) {
    const when = j.slot_start ?? j.picked_up_at ?? j.delivered_at;
    const key = when ? dayKey(when) : "unscheduled";
    if (!days.has(key)) days.set(key, { key, label: when ? dayLabel(when) : "No date set", jobs: [] });
    days.get(key)!.jobs.push(j);
  }
  return [...days.values()].sort((a, b) => (a.key === "unscheduled" ? 1 : b.key === "unscheduled" ? -1 : a.key.localeCompare(b.key)));
}

export default function Dashboard({ email }: { email: string }) {
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reference, setReference] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [, tick] = useState(0);
  const [pushState, setPushState] = useState<PushState | null>(null);

  useEffect(() => {
    getPushState().then(setPushState).catch(() => setPushState("unsupported"));
    // The delivery company's name, support number and time zone.
    loadOrg().then((changed) => changed && tick((n) => n + 1)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (businessId) void syncPush(businessId);
  }, [businessId]);

  async function togglePush() {
    if (!businessId) return;
    try {
      setPushState(pushState === "on" ? await disablePush() : await enablePush(businessId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Signing out also stops this browser getting the company's delivery updates.
  async function signOut() {
    await disablePush().catch(() => undefined);
    await supabase.auth.signOut();
  }

  useEffect(() => {
    getMemberships()
      .then((m) => { setMemberships(m); setBusinessId(m[0]?.business_id ?? null); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!businessId) return;
    getCampaigns(businessId)
      .then((c) => {
        setCampaigns(c);
        // Open on the most recent named campaign; fall back to everything.
        setReference(c.find((x) => x.client_reference)?.client_reference ?? null);
      })
      .catch((e) => setError(e.message));
  }, [businessId]);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      setJobs(await getJobs(businessId, reference));
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [businessId, reference]);

  useEffect(() => {
    setJobs(null);
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); tick((n) => n + 1); }, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const days = useMemo(() => groupByDay(jobs ?? []), [jobs]);
  const counts = useMemo(() => {
    const c = { total: 0, done: 0, moving: 0, problem: 0, waiting: 0 };
    for (const j of jobs ?? []) { c.total++; c[statusOf(j).tone]++; }
    return c;
  }, [jobs]);
  const company = memberships?.find((m) => m.business_id === businessId)?.company_name ?? "";
  const openJob = jobs?.find((j) => j.job_id === openId) ?? null;
  const todayKey = dayKey(new Date().toISOString());

  async function exportPod() {
    if (!businessId) return;
    setExporting(true);
    try {
      const rows = await getPodReport(businessId, reference);
      const name = `${company}-${reference ?? "all-deliveries"}-proof-of-delivery.csv`.replace(/[^\w.-]+/g, "-");
      download(name, podCsv(rows));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  if (memberships && memberships.length === 0) {
    return (
      <main className="empty-page">
        <p className="wordmark">{brand().toLowerCase()}</p>
        <h1>Your account isn't linked to a company yet</h1>
        <p className="muted">Signed in as {email}. {brand()} links your login to your company's deliveries. <a href={`https://wa.me/${supportWhatsApp()}`}>Message us on WhatsApp</a> and we'll set it up.</p>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <p className="wordmark">{brand().toLowerCase()}</p>
        {memberships && memberships.length > 1 ? (
          <select aria-label="Company" value={businessId ?? ""} onChange={(e) => setBusinessId(e.target.value)}>
            {memberships.map((m) => <option key={m.business_id} value={m.business_id}>{m.company_name}</option>)}
          </select>
        ) : (
          <span className="company">{company}</span>
        )}
        <span className="spacer" />
        <span className="who">{email}</span>
        {(pushState === "on" || pushState === "off") && (
          <button
            className="link"
            onClick={togglePush}
            aria-pressed={pushState === "on"}
            title={pushState === "on" ? "Delivery notifications are on for this browser" : "Get a notification when a driver is assigned, arrives, picks up and delivers"}
          >
            {pushState === "on" ? "Notifications on" : "Turn on notifications"}
          </button>
        )}
        <button className="link" onClick={signOut}>Sign out</button>
      </header>

      <main className="content">
        <section className="overview" aria-live="polite">
          <div className="overview-head">
            {campaigns.some((c) => c.client_reference) ? (
              <select className="campaign" aria-label="Campaign" value={reference ?? ""} onChange={(e) => setReference(e.target.value || null)}>
                {campaigns.filter((c) => c.client_reference).map((c) => (
                  <option key={c.client_reference!} value={c.client_reference!}>{c.client_reference}</option>
                ))}
                <option value="">All deliveries</option>
              </select>
            ) : (
              <h2 className="campaign">All deliveries</h2>
            )}
            <button className="secondary" onClick={exportPod} disabled={exporting || !jobs?.length}>
              {exporting ? "Preparing…" : "Download proof of delivery"}
            </button>
          </div>

          {jobs && (
            <>
              <p className="tally">
                <span className="tally-num">{counts.done}</span>
                <span className="tally-of">of {counts.total} delivered</span>
              </p>
              <p className="muted">
                {[counts.moving && `${counts.moving} on the way`, counts.waiting && `${counts.waiting} still scheduled`, counts.problem && `${counts.problem} returned`]
                  .filter(Boolean).join(", ") || "Nothing outstanding."}
                {loadedAt && <> Updated {ago(loadedAt)}.</>}
              </p>

              {/* The ledger: every delivery as one mark, day by day. */}
              {days.length > 0 && (
                <div className="ledger" role="list" aria-label="Deliveries by day">
                  {days.map((d) => (
                    <div key={d.key} role="listitem" className={`ledger-day${d.key === todayKey ? " today" : ""}`}>
                      <span className="ledger-label">{d.label}</span>
                      <div className="ledger-marks">
                        {d.jobs.map((j) => {
                          const s = statusOf(j);
                          return (
                            <button key={j.job_id} className={`mark ${s.tone}`} onClick={() => setOpenId(j.job_id)}
                              title={`${j.recipient_name}: ${s.label}`} aria-label={`${j.recipient_name}, ${s.label}`} />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {error && <p className="error banner" role="alert">{error}</p>}
        {!jobs && !error && <p className="muted loading">Loading deliveries…</p>}
        {jobs && jobs.length === 0 && (
          <p className="muted empty">No deliveries booked here yet. Once {brand()} schedules them, they'll appear with their time slots.</p>
        )}

        {days.map((d) => {
          const delivered = d.jobs.filter((j) => j.status === "completed").length;
          return (
            <section key={d.key} className="day">
              <h3>
                {d.label}{d.key === todayKey && <span className="today-tag">Today</span>}
                <span className="day-count">{delivered} of {d.jobs.length} delivered</span>
              </h3>
              <ul className="rows">
                {d.jobs.map((j) => {
                  const s = statusOf(j);
                  return (
                    <li key={j.job_id}>
                      <button className="row" onClick={() => setOpenId(j.job_id)}>
                        <span className="row-slot">{slotText(j)}</span>
                        <span className="row-who">
                          <strong>{j.recipient_name}</strong>
                          <span className="muted">{j.delivery_emirate}</span>
                        </span>
                        <span className={`status ${s.tone}`}>{s.label}</span>
                        <span className="row-proof">
                          {j.delivery_verified_by === "otp" && <span title="Confirmed with the recipient's code">Code verified</span>}
                          {j.delivery_verified_by === "ops_override" && <span title={`Confirmed by ${brand()} operations`}>Confirmed by {brand()}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>

      {openJob && <JobPanel job={openJob} onClose={() => setOpenId(null)} />}
    </div>
  );
}
