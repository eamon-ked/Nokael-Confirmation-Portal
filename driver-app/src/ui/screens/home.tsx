import { useEffect, useRef, useState } from "react";
import { container } from "../../logic/container";
import { calculateStats, cargo, clientName, formatAed, isStarted, scheduledTime, type Job } from "../../logic/model";
import { useStore } from "../../logic/store";
import { ConfirmSheet, Emoji, SectionLabel, Tap, toast, useThemeColor } from "../components";
import { locationHelpSteps } from "../../logic/location";
import { useNav } from "../nav";


export function HomeScreen() {
  useThemeColor("#26323F");
  const nav = useNav();
  const driver = useStore(container.session.driver);
  const isOnline = useStore(container.session.isOnline);
  const allJobs = useStore(container.jobs.jobs);
  const hasLoaded = useStore(container.jobs.hasLoaded);

  const stats = calculateStats(allJobs);
  const openJobs = allJobs.filter((job) => job.listStatus === "ACTIVE" || job.listStatus === "UPCOMING");
  const cancelledJobs = allJobs.filter((job) => job.listStatus === "CANCELLED");
  // A cached list from the last visit is shown straight away (offline-first), like the Android cache.
  const isLoading = !hasLoaded && allJobs.length === 0;

  // Being online promises dispatch a live position, so "online" and "location
  // granted" must never disagree: denied -> forced offline, with an explanation.
  // Blocked location can only be fixed in settings; this sheet says where.
  const [locationHelp, setLocationHelp] = useState(false);
  // Re-render after the job-alerts prompt is answered.
  const [, setPushAnswered] = useState(0);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !container.session.isOnline.get()) return;
    asked.current = true;
    void container.locationPermission.request().then((granted) => {
      if (!granted) {
        if (container.session.isOnline.get()) container.session.toggleOnline();
        setLocationHelp(true);
      }
    });
  }, []);

  // Only location is asked here: installed web apps (iPhone especially) allow one
  // permission prompt per tap, so job alerts get their own button below.
  const onToggleOnline = async () => {
    if (container.session.isOnline.get()) {
      container.session.toggleOnline();
      return;
    }
    const granted = await container.locationPermission.request();
    if (granted) {
      setLocationHelp(false);
      if (!container.session.isOnline.get()) container.session.toggleOnline();
    } else {
      setLocationHelp(true);
    }
  };

  const onEnableAlerts = async () => {
    await container.push.enable();
    setPushAnswered((n) => n + 1);
    if (Notification.permission === "granted") toast("Job alerts are on.");
  };

  /**
   * Only the active job can be opened; upcoming ones are read-only. An offline
   * driver can't start a job, but one already under way stays openable so a
   * package in their hands can still be delivered or returned.
   */
  const onJobClick = (job: Job) => {
    if (job.listStatus !== "ACTIVE") return;
    if (!container.session.isOnline.get() && !isStarted(job.stage)) {
      toast("You're offline. Go online to start this job.");
      return;
    }
    nav.push({ name: "job", jobId: job.id });
  };

  return (
    <div className="screen" style={{ background: "var(--background)" }}>
      {/* Header */}
      <div className="bar" style={{ background: "var(--slate)" }}>
        <div style={{ padding: "16px 20px 20px" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
            <div className="col" style={{ flex: 1, minWidth: 0 }}>
              <span className="label" style={{ color: "rgba(255,255,255,0.5)" }}>
                Good day,
              </span>
              <span style={{ fontSize: 20, fontWeight: 900, color: "#fff", overflowWrap: "anywhere" }}>
                {driver?.name ?? ""}
              </span>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Tap onClick={() => void container.signOut()} color="transparent" contentColor="rgba(255,255,255,0.5)" radius={12}>
                <div style={{ fontSize: 12, padding: 8 }}>Sign out</div>
              </Tap>
              <OnlineToggle isOnline={isOnline} onClick={() => void onToggleOnline()} />
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <StatTile label="Today's Jobs" value={String(stats.jobsToday)} />
            <StatTile label="Completed" value={String(stats.completed)} />
            <StatTile label="Earnings" value={`AED ${formatAed(stats.earningsAed)}`} />
          </div>
        </div>
      </div>

      {/* The app opens offline unless a shift is being resumed; make the next step obvious. */}
      {!isOnline && !isLoading && (
        <div style={{ padding: "16px 16px 0" }}>
          <Tap onClick={() => void onToggleOnline()} color="var(--green)" contentColor="#fff" elevation={4} radius={20} className="full">
            <div className="row" style={{ gap: 12, padding: "16px 20px", justifyContent: "space-between" }}>
              <div className="col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 900 }}>You're offline</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
                  Go online to take jobs and share your location with dispatch.
                </span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 900, whiteSpace: "nowrap" }}>GO ONLINE</span>
            </div>
          </Tap>
        </div>
      )}

      {isOnline && container.push.canAsk && (
        <div style={{ padding: "16px 16px 0" }}>
          <Tap onClick={() => void onEnableAlerts()} color="#fff" contentColor="var(--gray-700)" elevation={1} radius={20} className="full">
            <div className="row" style={{ gap: 12, padding: "14px 20px", justifyContent: "space-between" }}>
              <div className="col" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: "var(--gray-900)" }}>🔔 Turn on job alerts</span>
                <span style={{ fontSize: 12, color: "var(--gray-500)" }}>Get notified about new jobs and changes, even when the app is closed.</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 900, color: "var(--blue)", whiteSpace: "nowrap" }}>TURN ON</span>
            </div>
          </Tap>
        </div>
      )}

      <SectionLabel text="Assigned Jobs" style={{ padding: "20px 16px 12px" }} />
      {isLoading ? (
        <MessageCard emoji="⏳" emojiSize={40} text="Loading your jobs…" />
      ) : openJobs.length === 0 ? (
        <MessageCard emoji="🎉" emojiSize={48} title="All caught up" text="New jobs will appear here as dispatch assigns them." />
      ) : (
        openJobs.map((job, index) => (
          <div key={job.id} style={{ padding: "6px 16px" }}>
            <JobCard job={job} position={index + 1} canStart={isOnline || isStarted(job.stage)} onClick={() => onJobClick(job)} />
          </div>
        ))
      )}
      {cancelledJobs.length > 0 && (
        <>
          <SectionLabel text="Cancelled by dispatch" style={{ padding: "20px 16px 12px" }} />
          {cancelledJobs.map((job) => (
            <div key={`cancelled-${job.id}`} style={{ padding: "6px 16px" }}>
              <CancelledJobCard job={job} />
            </div>
          ))}
        </>
      )}
      <div style={{ height: "calc(40px + var(--safe-bottom))" }} />

      {locationHelp && (
        <ConfirmSheet
          emoji="📍"
          title="Location is blocked"
          message={`Going online shares your location with dispatch, so it has to be allowed.\n\n${locationHelpSteps()}`}
          confirmLabel="Try again"
          confirmColor="var(--green)"
          onConfirm={() => void onToggleOnline()}
          onDismiss={() => setLocationHelp(false)}
        />
      )}
    </div>
  );
}

function OnlineToggle({ isOnline, onClick }: { isOnline: boolean; onClick: () => void }) {
  return (
    <button type="button" className="tap row" onClick={onClick} role="switch" aria-checked={isOnline} style={{ gap: 10, padding: 4, borderRadius: 999 }}>
      <span style={{ fontSize: 13, fontWeight: 900, color: isOnline ? "var(--green)" : "rgba(255,255,255,0.6)" }}>{isOnline ? "ONLINE" : "OFFLINE"}</span>
      <span className="toggle-track" style={{ background: isOnline ? "var(--green)" : "var(--slate-500)" }}>
        <span className="toggle-thumb" style={{ display: "block", transform: `translateX(${isOnline ? 20 : 0}px)` }} />
      </span>
    </button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="col" style={{ flex: 1, minWidth: 0, alignItems: "center", background: "rgba(255,255,255,0.07)", borderRadius: 16, padding: 12 }}>
      <span className="ellipsis" style={{ fontSize: 18, fontWeight: 900, color: "#fff", maxWidth: "100%" }}>
        {value}
      </span>
      <span className="center" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
        {label}
      </span>
    </div>
  );
}

function JobCard({ job, position, canStart, onClick }: { job: Job; position: number; canStart: boolean; onClick: () => void }) {
  const isActive = job.listStatus === "ACTIVE";
  return (
    <Tap onClick={onClick} disabled={!isActive} color="#fff" contentColor="var(--gray-900)" elevation={4} className="full">
      <div style={{ padding: "16px 20px" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 900,
              color: isActive ? "var(--green)" : "var(--slate-400)",
              background: isActive ? "var(--green-soft)" : "var(--slate-100)",
              borderRadius: 999,
              padding: "4px 12px",
            }}
          >
            {isActive ? "● ACTIVE" : `#${position} UPCOMING`}
          </span>
          <span style={{ fontSize: 12, color: "var(--gray-400)" }}>{scheduledTime(job)}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--gray-900)" }}>{clientName(job)}</div>
        <div style={{ fontSize: 12, color: "var(--gray-500)", margin: "4px 0 12px" }}>{cargo(job)}</div>
        <RouteLine dot="🟢" label={job.pickup.shortName} />
        <div style={{ height: 6 }} />
        <RouteLine dot="🔵" label={job.dropoff.shortName} />
        {isActive && (
          <>
            <div style={{ height: 1, background: "var(--slate-100)", marginTop: 12 }} />
            <div style={{ fontSize: 12, fontWeight: 900, marginTop: 12, color: canStart ? "var(--blue)" : "var(--slate-400)" }}>
              {canStart ? "Tap to start →" : "You're offline. Go online to start."}
            </div>
          </>
        )}
      </div>
    </Tap>
  );
}

function RouteLine({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Emoji size={16}>{dot}</Emoji>
      <span style={{ fontSize: 12, color: "var(--gray-600)" }}>{label}</span>
    </div>
  );
}

function CancelledJobCard({ job }: { job: Job }) {
  return (
    <div style={{ background: "var(--red-tint)", borderRadius: 24, padding: "16px 20px" }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: "var(--red-dark)", marginBottom: 8 }}>🚫 CANCELLED</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: "var(--gray-900)" }}>{job.ref}</div>
      <div style={{ fontSize: 12, color: "var(--gray-600)", marginTop: 4 }}>
        {job.pickup.shortName} → {job.dropoff.shortName}
      </div>
      <div style={{ fontSize: 12, color: "var(--red-dark)", marginTop: 8 }}>{job.cancellationReason ?? "Dispatch cancelled this job. No action needed."}</div>
    </div>
  );
}

function MessageCard({ emoji, emojiSize, title, text }: { emoji: string; emojiSize: number; title?: string; text: string }) {
  return (
    <div style={{ padding: "0 16px" }}>
      <div className="col" style={{ alignItems: "center", background: "#fff", borderRadius: 24, padding: 32 }}>
        <Emoji size={emojiSize}>{emoji}</Emoji>
        {title && <div style={{ fontSize: 20, fontWeight: 900, color: "var(--gray-900)", margin: "12px 0 4px" }}>{title}</div>}
        <div className="center" style={{ fontSize: 14, color: "var(--gray-500)", marginTop: title ? 0 : 12 }}>
          {text}
        </div>
      </div>
    </div>
  );
}
