import { useCallback, useEffect, useRef, useState } from "react";
import { AppConfig } from "../../logic/config";
import { container } from "../../logic/container";
import { JobStageMachine, type PrimaryAction } from "../../logic/jobStageMachine";
import { currentLocation } from "../../logic/location";
import { cargo, clientName, clientPhone, hasPackage, isBeforePickup, scheduledDate, scheduledTime, type GeoPoint, type HandoffKind, type Job, type Place } from "../../logic/model";
import { useStore } from "../../logic/store";
import { BackCircleButton, ConfirmSheet, DispatchSheet, Emoji, ExternalActions, Icon, InfoBlock, Tap, toast, useThemeColor } from "../components";
import { useNav } from "../nav";

const ARRIVAL_FIX_TIMEOUT_MS = 8_000;
const REMARK_DEBOUNCE_MS = 800;
const MAX_REMARK_LENGTH = 1_000;
/** Generous, so big compounds and slightly-off pins don't trip the "not there yet" warning. */
const FAR_FROM_STOP_M = 1_000;

// distanceMeters: how far GPS puts the driver from the stop's pin, once known;
// undefined while locating, or when the stop has no pin or there's no fix.
type JobDialog = { type: "confirm_arrival"; kind: HandoffKind; distanceMeters?: number } | { type: "dispatch" } | null;

/** Great-circle (haversine) distance in metres. */
function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** "850 m", "1.4 km", "12 km". */
function formatDistance(meters: number): string {
  if (meters < 1_000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1_000).toFixed(1)} km`;
  return `${Math.round(meters / 1_000)} km`;
}

const pinOf = (place: Place): GeoPoint | null =>
  place.latitude != null && place.longitude != null ? { latitude: place.latitude, longitude: place.longitude } : null;

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
      return { color: "var(--sky)", emoji: "📍", title: "I HAVE ARRIVED", subtitle: `Tap when you arrive at ${job.pickup.shortName}` };
    case "PICK_UP":
      return { color: "var(--green)", emoji: "📦", title: "PICK UP", subtitle: `${job.pickup.shortName} · Enter OTP to confirm` };
    case "ARRIVED_AT_DROPOFF":
      return { color: "var(--sky)", emoji: "📍", title: "I HAVE ARRIVED", subtitle: `Tap when you arrive at ${job.dropoff.shortName}` };
    case "DROP_OFF":
      return { color: "var(--blue)", emoji: "🏁", title: "DROP OFF", subtitle: `${job.dropoff.shortName} · Enter OTP to confirm` };
    case "COMPLETE_JOB":
      return { color: "var(--red)", emoji: "🚀", title: "COMPLETE JOB", subtitle: "Tap to finish and return home" };
  }
}

/**
 * The working screen for a single job: job details on top, the next-step
 * button (I have arrived → Pick up → Drop off), directions, call client, dispatch,
 * and remarks. On the drive to drop-off, NAVIGATE leads and the arrival button
 * drops below it in a smaller size, so a driver who just confirmed pickup doesn't
 * tap "arrived" out of habit.
 */
export function JobScreen({ jobId }: { jobId: string }) {
  useThemeColor("#26323F");
  const nav = useNav();
  const driver = useStore(container.session.driver);
  const job = useStore(container.jobs.jobs).find((j) => j.id === jobId) ?? null;

  const [local, setLocal] = useState<JobLocalState>(() => localByJob.get(jobId) ?? { isProgressExpanded: false, isDetailsExpanded: false });
  useEffect(() => {
    localByJob.set(jobId, local);
  }, [jobId, local]);

  const [dialog, setDialog] = useState<JobDialog>(null);
  const [arriving, setArriving] = useState(false);
  // GPS fix taken when the arrival sheet opens; reused for the arrival record.
  const arrivalFix = useRef<Promise<GeoPoint | null> | null>(null);

  /**
   * Opens the "Arrived?" sheet and, in the background, measures how far the
   * driver is from the stop's pin, so the sheet can warn when they're clearly
   * not there yet. No pin or no fix: the sheet just stays as it is.
   */
  const openArrival = (kind: HandoffKind) => {
    setDialog({ type: "confirm_arrival", kind });
    const fix = currentLocation(ARRIVAL_FIX_TIMEOUT_MS);
    arrivalFix.current = fix;
    const stop = job ? pinOf(kind === "PICKUP" ? job.pickup : job.dropoff) : null;
    void fix.then((point) => {
      if (!point || !stop || !mounted.current || arrivalFix.current !== fix) return;
      const meters = distanceMeters(point, stop);
      setDialog((d) => (d?.type === "confirm_arrival" && d.kind === kind ? { ...d, distanceMeters: meters } : d));
    });
  };
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
        return openArrival("PICKUP");
      case "ARRIVED_AT_DROPOFF":
        return openArrival("DROPOFF");
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
    // Reuse the fix taken when the sheet opened; otherwise try once more.
    const location = (await arrivalFix.current) ?? (await currentLocation(ARRIVAL_FIX_TIMEOUT_MS));
    arrivalFix.current = null;
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
          {JobStageMachine.primaryActionFor(job.stage) === "ARRIVED_AT_DROPOFF" ? (
            <>
              <NavigateButton job={job} hero note="✅ Package picked up" />
              <PrimaryActionButton job={job} busy={arriving} onClick={onPrimaryAction} compact />
            </>
          ) : (
            <>
              <PrimaryActionButton job={job} busy={arriving} onClick={onPrimaryAction} />
              <NavigateButton job={job} />
            </>
          )}
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
        const distance = dialog.distanceMeters;
        if (distance != null && distance > FAR_FROM_STOP_M) {
          // GPS says they're clearly not there yet; still let them confirm (GPS can drift).
          return (
            <ConfirmSheet
              emoji="⚠️"
              title={`You're ${formatDistance(distance)} away`}
              message={`Your location shows you about ${formatDistance(distance)} from ${place.shortName}. Only confirm once you've actually arrived.`}
              confirmLabel="I Have Arrived Anyway"
              confirmColor="var(--orange)"
              onConfirm={() => void onConfirmArrival()}
              onDismiss={() => setDialog(null)}
            />
          );
        }
        return (
          <ConfirmSheet
            emoji="📍"
            title={`Arrived at ${place.shortName}?`}
            message={`Please confirm you have reached the ${isPickup ? "pickup" : "drop-off"} location at ${place.address}.`}
            confirmLabel="Yes, I Have Arrived"
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
function PrimaryActionButton({ job, busy, onClick, compact = false }: { job: Job; busy: boolean; onClick: () => void; compact?: boolean }) {
  const style = actionStyle(JobStageMachine.primaryActionFor(job.stage), job);
  const subtitle = busy ? "Recording your arrival…" : style.subtitle;
  // Compact: a regular-sized row, used when another button leads the screen.
  if (compact) {
    return (
      <Tap onClick={onClick} color={style.color} elevation={4} className="full" disabled={busy} style={{ opacity: busy ? 0.75 : 1 }}>
        <div className="row" style={{ justifyContent: "center", gap: 16, padding: "20px 16px" }}>
          <Emoji size={36}>{style.emoji}</Emoji>
          <div className="col" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 900 }}>{style.title}</span>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>{subtitle}</span>
          </div>
        </div>
      </Tap>
    );
  }
  return (
    <Tap onClick={onClick} color={style.color} elevation={8} className="full" disabled={busy} style={{ opacity: busy ? 0.75 : 1 }}>
      <div className="col" style={{ alignItems: "center", gap: 12, padding: "40px 16px" }}>
        <Emoji size={60}>{style.emoji}</Emoji>
        <span style={{ fontSize: 24, fontWeight: 900 }}>{style.title}</span>
        <span className="center" style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
          {subtitle}
        </span>
      </div>
    </Tap>
  );
}

function NavigateButton({ job, hero = false, note }: { job: Job; hero?: boolean; note?: string }) {
  const target = isBeforePickup(job.stage) ? job.pickup : job.dropoff;
  // Hero: the big leading button, sized like PrimaryActionButton, for the drive to drop-off.
  if (hero) {
    return (
      <Tap onClick={() => ExternalActions.navigate(target.address)} color="var(--orange)" elevation={8} className="full">
        <div className="col" style={{ alignItems: "center", gap: 10, padding: "32px 16px" }}>
          {note && <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{note}</span>}
          <Emoji size={52}>🗺️</Emoji>
          <span style={{ fontSize: 24, fontWeight: 900 }}>NAVIGATE</span>
          <span className="center" style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>→ {target.shortName}</span>
        </div>
      </Tap>
    );
  }
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
