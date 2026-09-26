import { useCallback, useEffect, useRef, useState } from "react";
import { AppConfig } from "../../logic/config";
import { container } from "../../logic/container";
import { JobStageMachine, type PrimaryAction } from "../../logic/jobStageMachine";
import { currentLocation } from "../../logic/location";
import { cargo, clientName, clientPhone, hasPackage, isBeforePickup, scheduledDate, scheduledTime, type HandoffKind, type Job } from "../../logic/model";
import { useStore } from "../../logic/store";
import { BackCircleButton, ConfirmSheet, DispatchSheet, Emoji, ExternalActions, Icon, InfoBlock, Tap, toast, useThemeColor } from "../components";
import { useNav } from "../nav";

const ARRIVAL_FIX_TIMEOUT_MS = 8_000;
const REMARK_DEBOUNCE_MS = 800;
const MAX_REMARK_LENGTH = 1_000;

type JobDialog = { type: "confirm_arrival"; kind: HandoffKind } | { type: "dispatch" } | null;

interface JobLocalState {
  isProgressExpanded: boolean;
  isDetailsExpanded: boolean;
}

/**
 * Card open/closed state per job, kept while the driver hops to the OTP screen
 * and back (Android keeps the ViewModel alive on the back stack for the same).
 */
const localByJob = new Map<string, JobLocalState>();

/** Remark saves, one at a time per job, so an older request can never land after a newer one. */
const remarkChains = new Map<string, Promise<unknown>>();
const lastSavedRemark = new Map<string, string>();

function saveRemark(jobId: string, text: string): Promise<void> {
  const run = (remarkChains.get(jobId) ?? Promise.resolve()).then(async () => {
    if (text === (lastSavedRemark.get(jobId) ?? "")) return;
    const result = await container.jobs.saveRemark(jobId, text);
    if (result === "SUCCESS") lastSavedRemark.set(jobId, text);
    else if (result === "FAILED") toast("Couldn't save your remark. Check your connection.", true);
  });
  remarkChains.set(jobId, run.catch(() => undefined));
  return run;
}

/** How the big action button looks for each primary action. Purely visual. */
function actionStyle(action: PrimaryAction, job: Job) {
  switch (action) {
    case "ARRIVED_AT_PICKUP":
      return { color: "var(--sky)", emoji: "📍", title: "I AM HERE", subtitle: `Tap when you arrive at ${job.pickup.shortName}` };
    case "PICK_UP":
      return { color: "var(--green)", emoji: "📦", title: "PICK UP", subtitle: `${job.pickup.shortName} · Enter OTP to confirm` };
    case "ARRIVED_AT_DROPOFF":
      return { color: "var(--sky)", emoji: "📍", title: "I AM HERE", subtitle: `Tap when you arrive at ${job.dropoff.shortName}` };
    case "DROP_OFF":
      return { color: "var(--blue)", emoji: "🏁", title: "DROP OFF", subtitle: `${job.dropoff.shortName} · Enter OTP to confirm` };
    case "COMPLETE_JOB":
      return { color: "var(--red)", emoji: "🚀", title: "COMPLETE JOB", subtitle: "Tap to finish and return home" };
  }
}

/**
 * The working screen for a single job: job details on top, the next-step
 * button (I am here → Pick up → Drop off), directions, call client, dispatch,
 * and remarks.
 */
export function JobScreen({ jobId }: { jobId: string }) {
  useThemeColor("#1E293B");
  const nav = useNav();
  const driver = useStore(container.session.driver);
  const job = useStore(container.jobs.jobs).find((j) => j.id === jobId) ?? null;

  const [local, setLocal] = useState<JobLocalState>(() => localByJob.get(jobId) ?? { isProgressExpanded: false, isDetailsExpanded: false });
  useEffect(() => {
    localByJob.set(jobId, local);
  }, [jobId, local]);

  const [dialog, setDialog] = useState<JobDialog>(null);
  const [arriving, setArriving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // --- Remark: seeded once with whatever was saved earlier ------------------
  const [remark, setRemark] = useState<{ text: string; open: boolean; seeded: boolean }>({ text: "", open: false, seeded: false });
  useEffect(() => {
    if (remark.seeded || job == null) return;
    lastSavedRemark.set(jobId, job.remark);
    setRemark({ text: job.remark, open: job.remark.trim() !== "", seeded: true });
  }, [job, jobId, remark.seeded]);

  // Typing must not cost one request per keystroke: wait for a pause, then send the latest text.
  const pendingRemark = useRef<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onRemarkChange = (value: string) => {
    const limited = value.slice(0, MAX_REMARK_LENGTH);
    setRemark((r) => ({ ...r, text: limited }));
    pendingRemark.current = limited;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      pendingRemark.current = null;
      void saveRemark(jobId, limited);
    }, REMARK_DEBOUNCE_MS);
  };
  // Leaving the screen (or the app) still sends the last edit.
  useEffect(() => {
    const flush = () => {
      clearTimeout(debounce.current);
      if (pendingRemark.current != null) void saveRemark(jobId, pendingRemark.current);
      pendingRemark.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [jobId]);

  // --- Dispatch can cancel a job mid-route: say so, don't let it silently vanish.
  const reportedCancel = useRef(false);
  useEffect(() => {
    if (job?.listStatus === "CANCELLED" && !reportedCancel.current) {
      reportedCancel.current = true;
      setDialog(null);
      nav.push({ name: "result", outcome: "CANCELLED" });
    }
  }, [job?.listStatus, nav]);

  const onPrimaryAction = useCallback(() => {
    if (!job || arriving) return;
    const action = JobStageMachine.primaryActionFor(job.stage);
    // Starting a job means reporting arrival at pickup; not while offline. A job already
    // under way can still be finished, so this only blocks the very first step.
    if (action === "ARRIVED_AT_PICKUP" && !container.session.isOnline.get()) {
      toast("You're offline. Go online to start this job.", true);
      return;
    }
    switch (action) {
      case "ARRIVED_AT_PICKUP":
        return setDialog({ type: "confirm_arrival", kind: "PICKUP" });
      case "ARRIVED_AT_DROPOFF":
        return setDialog({ type: "confirm_arrival", kind: "DROPOFF" });
      case "PICK_UP":
        return nav.push({ name: "otp", jobId, kind: "PICKUP" });
      case "DROP_OFF":
        return nav.push({ name: "otp", jobId, kind: "DROPOFF" });
      case "COMPLETE_JOB":
        // No server call: the job completed when the drop-off code was accepted.
        void container.jobs.finishJob(jobId, "COMPLETED").then(() => {
          if (mounted.current) nav.push({ name: "result", outcome: "COMPLETED" });
        });
    }
  }, [job, arriving, jobId, nav]);

  /** The driver confirmed "Yes, I'm here": send where (the server stamps when), then refresh. */
  const onConfirmArrival = async () => {
    if (dialog?.type !== "confirm_arrival") return;
    const kind = dialog.kind;
    setDialog(null);
    setArriving(true);
    // A GPS fix can hang indefinitely (indoors, basement car park); never let that stall the driver.
    const location = await currentLocation(ARRIVAL_FIX_TIMEOUT_MS);
    const result = await container.jobs.confirmArrival(jobId, { kind, location, timestampMillis: Date.now() });
    if (mounted.current) setArriving(false);
    if (result === "STALE") toast("This job has changed. Refreshed.", true);
    else if (result === "FAILED") toast("Couldn't record your arrival. Try again.", true);
  };

  const dispatchPhone = AppConfig.dispatchPhone;
  const noDispatch = () => toast("Dispatch number isn't set up. Contact your manager.", true);

  return (
    <div className="screen" style={{ background: "var(--background)" }}>
      <JobHeader jobRef={job?.ref ?? ""} driverName={driver?.name} onBack={nav.back} />
      {job && (
        <div className="col" style={{ flex: 1, gap: 12, padding: "16px 16px calc(16px + var(--safe-bottom))" }}>
          <ProgressCard job={job} expanded={local.isProgressExpanded} onToggle={() => setLocal((l) => ({ ...l, isProgressExpanded: !l.isProgressExpanded }))} />
          <DetailsCard job={job} expanded={local.isDetailsExpanded} onToggle={() => setLocal((l) => ({ ...l, isDetailsExpanded: !l.isDetailsExpanded }))} />
          <PrimaryActionButton job={job} busy={arriving} onClick={onPrimaryAction} />
          <NavigateButton job={job} />
          <div className="row" style={{ gap: 12 }}>
            <QuickActionTile
              emoji="📞"
              label="CALL CLIENT"
              color="var(--purple)"
              contentColor="#fff"
              onClick={() => {
                // Phones are withheld once a job is finished; an open job should always have one.
                const phone = clientPhone(job);
                if (phone) ExternalActions.dial(phone);
                else toast("No phone number available for this contact.");
              }}
            />
            <QuickActionTile emoji="📡" label="DISPATCH" color="var(--slate)" contentColor="#fff" onClick={() => setDialog({ type: "dispatch" })} />
          </div>
          <RemarkAndReturn
            job={job}
            open={remark.open}
            text={remark.text}
            onOpen={() => setRemark((r) => ({ ...r, open: true }))}
            onChange={onRemarkChange}
            onReturn={() => nav.push({ name: "return", jobId })}
          />
        </div>
      )}

      {dialog?.type === "confirm_arrival" && job && (() => {
        const isPickup = dialog.kind === "PICKUP";
        const place = isPickup ? job.pickup : job.dropoff;
        return (
          <ConfirmSheet
            emoji="📍"
            title={`Arrived at ${place.shortName}?`}
            message={`Please confirm you have reached the ${isPickup ? "pickup" : "drop-off"} location at ${place.address}.`}
            confirmLabel="Yes, I'm Here"
            confirmColor="var(--sky)"
            onConfirm={() => void onConfirmArrival()}
            onDismiss={() => setDialog(null)}
          />
        );
      })()}
      {dialog?.type === "dispatch" && (
        <DispatchSheet
          onCall={() => {
            setDialog(null);
            if (!ExternalActions.dial(dispatchPhone)) noDispatch();
          }}
          onMessage={() => {
            setDialog(null);
            if (!ExternalActions.sms(dispatchPhone)) noDispatch();
          }}
          onDismiss={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function JobHeader({ jobRef, driverName, onBack }: { jobRef: string; driverName?: string; onBack: () => void }) {
  return (
    <div className="bar" style={{ background: "var(--slate)" }}>
      <div className="row" style={{ justifyContent: "space-between", padding: 16, paddingLeft: 20, paddingRight: 20 }}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <BackCircleButton onClick={onBack} iconSize={22} />
          <div className="col" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>DRIVER APP</span>
            <span className="ellipsis" style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>
              🚛 {jobRef}
            </span>
          </div>
        </div>
        {driverName && (
          <span className="ellipsis" style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", paddingLeft: 12 }}>
            {driverName}
          </span>
        )}
      </div>
    </div>
  );
}

/** Collapsible "Progress" card: five dots when closed, the full checklist when open. */
function ProgressCard({ job, expanded, onToggle }: { job: Job; expanded: boolean; onToggle: () => void }) {
  const steps = JobStageMachine.progressSteps(job.stage);
  const completed = steps.filter((s) => s.done).length;
  const currentLabel = steps.find((s) => s.active)?.label ?? (job.stage === "DROPPED_OFF" ? "Delivered" : "Heading to pickup");
  return (
    <Tap onClick={onToggle} color="#fff" contentColor="var(--gray-700)" elevation={1} className="full" label={`Progress: ${currentLabel}. ${expanded ? "Collapse" : "Expand"}`}>
      <div style={{ padding: "16px 20px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 4 }}>
              {steps.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: i < completed ? "var(--green)" : i === completed ? "var(--sky)" : "var(--slate-200)",
                  }}
                />
              ))}
            </div>
            <div className="col">
              <span className="label" style={{ color: "var(--gray-400)" }}>
                Progress
              </span>
              <span style={{ fontSize: 14, fontWeight: 900, color: "var(--gray-700)" }}>{currentLabel}</span>
            </div>
          </div>
          <Icon name="chevronDown" className={`chevron ${expanded ? "open" : ""}`} />
        </div>
        <div className={`collapse ${expanded ? "open" : ""}`}>
          <div>
            <div className="col" style={{ gap: 8, paddingTop: 16 }}>
              {steps.map((step, index) => (
                <div key={step.label} className="row" style={{ gap: 12 }}>
                  <span
                    className="row"
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 900,
                      background: step.done ? "var(--green)" : step.active ? "var(--sky)" : "var(--slate-200)",
                      color: step.done || step.active ? "#fff" : "var(--slate-400)",
                    }}
                  >
                    {step.done ? "✓" : index + 1}
                  </span>
                  <span style={{ fontSize: 14, color: step.done ? "var(--green-dark)" : step.active ? "var(--sky-dark)" : "var(--slate-400)" }}>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Tap>
  );
}

/** Collapsible: client + schedule when closed, plus cargo, instructions and both addresses when open. */
function DetailsCard({ job, expanded, onToggle }: { job: Job; expanded: boolean; onToggle: () => void }) {
  const isPickupReached = JobStageMachine.hasArrivedAtPickup(job.stage);
  const isDelivered = job.stage === "DROPPED_OFF";
  return (
    <Tap onClick={onToggle} color="#fff" contentColor="var(--gray-700)" elevation={1} className="full" label={`Job details. ${expanded ? "Collapse" : "Expand"}`}>
      <div style={{ padding: "16px 20px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <Emoji size={30}>👤</Emoji>
            <div className="col" style={{ minWidth: 0 }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: "var(--gray-900)" }}>{clientName(job)}</span>
              <span style={{ fontSize: 12, color: "var(--gray-500)" }}>
                {scheduledDate(job)} · {scheduledTime(job)}
              </span>
            </div>
          </div>
          <Icon name="chevronDown" className={`chevron ${expanded ? "open" : ""}`} />
        </div>
        <div className={`collapse ${expanded ? "open" : ""}`}>
          <div>
            <div className="col" style={{ gap: 12, paddingTop: 12 }}>
              <InfoBlock emoji="📦" caption="Cargo" text={cargo(job)} background="var(--orange-tint)" captionColor="var(--orange-text)" />
              {job.specialInstructions.trim() !== "" && (
                <InfoBlock emoji="⚠️" caption="Special Instructions" text={job.specialInstructions} background="var(--rose-tint)" captionColor="var(--rose)" />
              )}
              <InfoBlock
                emoji="🟢"
                caption="Pick Up"
                text={job.pickup.address}
                background="var(--green-tint)"
                captionColor="var(--green)"
                trailing={isPickupReached ? <Emoji size={16}>✅</Emoji> : null}
              />
              <InfoBlock
                emoji="🔵"
                caption="Drop Off"
                text={job.dropoff.address}
                background="var(--blue-tint)"
                captionColor="var(--blue)"
                trailing={isDelivered ? <Emoji size={16}>✅</Emoji> : null}
              />
            </div>
          </div>
        </div>
      </div>
    </Tap>
  );
}

/** The one big button for whatever the driver should do next. */
function PrimaryActionButton({ job, busy, onClick }: { job: Job; busy: boolean; onClick: () => void }) {
  const style = actionStyle(JobStageMachine.primaryActionFor(job.stage), job);
  return (
    <Tap onClick={onClick} color={style.color} elevation={8} className="full" disabled={busy} style={{ opacity: busy ? 0.75 : 1 }}>
      <div className="col" style={{ alignItems: "center", gap: 12, padding: "40px 16px" }}>
        <Emoji size={60}>{style.emoji}</Emoji>
        <span style={{ fontSize: 24, fontWeight: 900 }}>{style.title}</span>
        <span className="center" style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
          {busy ? "Recording your arrival…" : style.subtitle}
        </span>
      </div>
    </Tap>
  );
}

function NavigateButton({ job }: { job: Job }) {
  const target = isBeforePickup(job.stage) ? job.pickup : job.dropoff;
  return (
    <Tap onClick={() => ExternalActions.navigate(target.address)} color="var(--orange)" elevation={4} className="full">
      <div className="row" style={{ justifyContent: "center", gap: 16, padding: "20px 0" }}>
        <Emoji size={36}>🗺️</Emoji>
        <div className="col">
          <span style={{ fontSize: 18, fontWeight: 900 }}>NAVIGATE</span>
          <span style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>→ {target.shortName}</span>
        </div>
      </div>
    </Tap>
  );
}

/** Square-ish tile with an emoji over a short caption. */
function QuickActionTile({ emoji, label, color, contentColor, onClick }: { emoji: string; label: string; color: string; contentColor: string; onClick: () => void }) {
  return (
    <Tap onClick={onClick} color={color} contentColor={contentColor} elevation={4} style={{ flex: 1 }}>
      <div className="col" style={{ alignItems: "center", gap: 8, padding: "20px 0" }}>
        <Emoji size={30}>{emoji}</Emoji>
        <span style={{ fontSize: 14, fontWeight: 900, color: contentColor }}>{label}</span>
      </div>
    </Tap>
  );
}

/** Either the two "Add remark" / "Return pkg" tiles, or the open remark box. */
function RemarkAndReturn({
  job,
  open,
  text,
  onOpen,
  onChange,
  onReturn,
}: {
  job: Job;
  open: boolean;
  text: string;
  onOpen: () => void;
  onChange: (text: string) => void;
  onReturn: () => void;
}) {
  // A package can only be returned while the driver has it (the server rejects it earlier or later).
  const canReturn = hasPackage(job.stage) && (job.listStatus === "ACTIVE" || job.listStatus === "UPCOMING");
  const onReturnTap = () => {
    if (canReturn) onReturn();
    else toast(job.stage === "DROPPED_OFF" ? "This package has already been delivered." : "You can return a package once you've picked it up.");
  };
  if (!open) {
    return (
      <div className="row" style={{ gap: 12, marginBottom: 24 }}>
        <QuickActionTile emoji="💬" label="ADD REMARK" color="#fff" contentColor="var(--slate-500)" onClick={onOpen} />
        <QuickActionTile emoji="↩️" label="RETURN PKG" color="var(--red-tint)" contentColor="var(--red-dark)" onClick={onReturnTap} />
      </div>
    );
  }
  return (
    <div style={{ background: "#fff", borderRadius: 24, padding: 16, marginBottom: 24 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: "var(--gray-400)" }}>REMARK</span>
        <Tap onClick={onReturnTap} color="var(--red-tint)" contentColor="var(--red)" radius={12}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 900, padding: "4px 8px" }}>↩️ Return Pkg</span>
        </Tap>
      </div>
      <textarea
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type your remark here..."
        rows={3}
        maxLength={MAX_REMARK_LENGTH}
        aria-label="Remark"
        style={{
          width: "100%",
          border: 0,
          outline: "none",
          resize: "none",
          background: "transparent",
          font: "inherit",
          fontSize: 16,
          fontWeight: 700,
          color: "var(--gray-800)",
          caretColor: "var(--blue)",
          padding: "16px 0 4px",
        }}
      />
    </div>
  );
}
