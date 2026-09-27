import { useEffect, useRef, useState } from "react";
import { container } from "../../logic/container";
import { cargo, type JobOutcome } from "../../logic/model";
import { useStore } from "../../logic/store";
import { Emoji, SectionLabel, Tap, useThemeColor } from "../components";
import { useNav } from "../nav";

/** Short reasons shown as quick-pick chips; the driver can still type their own. */
const RETURN_REASON_PRESETS = ["Client unreachable", "Client refused delivery", "Wrong address", "Business closed"];
const MAX_REASON_LENGTH = 300;

/** "Return to sender?" confirmation. A reason is required before dispatch accepts the return. */
export function ReturnScreen({ jobId }: { jobId: string }) {
  useThemeColor("#F7F8FA");
  const nav = useNav();
  const job = useStore(container.jobs.jobs).find((j) => j.id === jobId);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const canConfirm = reason.trim() !== "" && !submitting;

  const onReasonChange = (text: string) => {
    setReason(text.slice(0, MAX_REASON_LENGTH));
    // Editing after a failure is a fresh attempt; don't leave the old error on screen.
    if (!submitting) setError(null);
  };

  const onConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    // Only report a return once the server has accepted it.
    const result = await container.jobs.finishJob(jobId, "RETURNED", trimmed);
    if (!mounted.current) return;
    switch (result) {
      case "SUCCESS":
        // Stays "submitting" so the button can't be tapped again while the screen changes.
        nav.push({ name: "result", outcome: "RETURNED" });
        break;
      case "STALE":
        setSubmitting(false);
        setError("This job has changed. Go back to see its current status.");
        break;
      case "FAILED":
        setSubmitting(false);
        setError("Couldn't send the return. Check your connection and try again.");
        break;
      case "SESSION_ENDED":
        // The app is already heading to the login screen.
        setSubmitting(false);
    }
  };

  return (
    <div className="screen col" style={{ background: "var(--background)", justifyContent: "center", padding: "calc(24px + var(--safe-top)) 24px calc(24px + var(--safe-bottom))" }}>
      <div className="col" style={{ width: "100%", maxWidth: 384, margin: "0 auto", background: "#fff", borderRadius: 24, padding: 32, alignItems: "center" }}>
        <Emoji size={72}>↩️</Emoji>
        <div className="center" style={{ fontSize: 24, fontWeight: 900, color: "var(--gray-900)", margin: "16px 0 8px" }}>
          Return to Sender?
        </div>
        <div className="center" style={{ fontSize: 14, lineHeight: "22px", color: "var(--gray-500)", marginBottom: 24 }}>
          This will mark the package as unable to deliver and initiate a return to the original sender.
        </div>
        {job && (
          <div className="col full" style={{ background: "var(--orange-tint)", borderRadius: 16, padding: 16, marginBottom: 24 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "var(--orange-text)" }}>PACKAGE</span>
            <span style={{ fontSize: 16, fontWeight: 900, color: "var(--gray-800)" }}>{cargo(job)}</span>
            <span style={{ fontSize: 14, color: "var(--gray-500)", marginTop: 4 }}>Returning to: {job.pickup.shortName}</span>
          </div>
        )}
        <div className="col full" style={{ marginBottom: 20 }}>
          <label htmlFor="return-reason">
            <SectionLabel text="Reason for return" style={{ marginBottom: 8 }} />
          </label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {RETURN_REASON_PRESETS.map((preset) => {
              const selected = reason === preset;
              return (
                <Tap
                  key={preset}
                  onClick={() => onReasonChange(preset)}
                  color={selected ? "var(--red)" : "var(--slate-100)"}
                  contentColor={selected ? "#fff" : "var(--gray-600)"}
                  radius={999}
                >
                  <span style={{ display: "block", fontSize: 12, padding: "8px 14px" }}>{preset}</span>
                </Tap>
              );
            })}
          </div>
          <input
            id="return-reason"
            className={`field ${reason ? "has-value" : ""}`}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="Describe why the package is being returned"
            maxLength={MAX_REASON_LENGTH}
            enterKeyHint="done"
          />
          {error && <div className="error-text">❌ {error}</div>}
        </div>
        <Tap onClick={() => void onConfirm()} disabled={!canConfirm} color={canConfirm ? "var(--red)" : "rgba(239,68,68,0.5)"} radius={16} className="btn" style={{ marginBottom: 12 }}>
          {submitting ? "Returning…" : "↩️ Confirm Return"}
        </Tap>
        <Tap onClick={nav.back} color="var(--slate-100)" contentColor="var(--gray-600)" radius={16} className="full">
          <div className="center" style={{ fontSize: 16, fontWeight: 900, padding: "16px 0" }}>
            Cancel
          </div>
        </Tap>
      </div>
    </div>
  );
}

const RESULT_CONTENT: Record<JobOutcome, { emoji: string; background: string; theme: string; title: string; message: string; buttonColor: string }> = {
  COMPLETED: { emoji: "✅", background: "var(--green)", theme: "#22C55E", title: "Job Complete!", message: "Great work. Check your next job below.", buttonColor: "var(--green-dark)" },
  RETURNED: { emoji: "↩️", background: "var(--red)", theme: "#EF4444", title: "Return Initiated", message: "The package is being returned to the sender.", buttonColor: "var(--red)" },
  CANCELLED: {
    emoji: "🚫",
    background: "var(--slate)",
    theme: "#26323F",
    title: "Job Cancelled",
    message: "Dispatch has cancelled this job. No further action is needed from you.",
    buttonColor: "var(--slate)",
  },
};

/** Full-screen "Job Complete!" / "Return Initiated" / "Job Cancelled" confirmation. */
export function ResultScreen({ outcome }: { outcome: JobOutcome }) {
  const content = RESULT_CONTENT[outcome];
  useThemeColor(content.theme);
  const nav = useNav();
  const backToJobs = () => {
    // Drop Job/OTP/Return/Result and land back on Home.
    if (nav.current.name === "result") nav.popTo("home");
  };
  return (
    <div className="screen col" style={{ background: content.background, alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
      <Emoji size={112}>{content.emoji}</Emoji>
      <div className="center" style={{ fontSize: 36, fontWeight: 900, color: "#fff", margin: "24px 0 12px" }}>
        {content.title}
      </div>
      <div className="center" style={{ fontSize: 20, color: "rgba(255,255,255,0.8)", marginBottom: 32 }}>
        {content.message}
      </div>
      <Tap onClick={backToJobs} color="#fff" contentColor={content.buttonColor} radius={24}>
        <span style={{ display: "block", fontSize: 24, fontWeight: 900, padding: "20px 48px" }}>Back to Jobs</span>
      </Tap>
    </div>
  );
}
