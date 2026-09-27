import { useEffect, useRef, useState } from "react";
import { AppConfig } from "../../logic/config";
import { container } from "../../logic/container";
import type { HandoffKind } from "../../logic/model";
import { delay, useStore } from "../../logic/store";
import { BackCircleButton, Emoji, ExternalActions, NumberPad, OTP_LENGTH, OtpDigitRow, Tap, toast, useKeypadKeys, useThemeColor } from "../components";
import { useNav } from "../nav";

/** A non-"wrong code" reason the last attempt didn't go through. */
type OtpNotice = "NETWORK" | "JOB_CHANGED" | null;

interface OtpEntryState {
  digits: string;
  showError: boolean;
  isChecking: boolean;
  /** Five wrong codes: entry is disabled until dispatch unlocks the job. */
  isLocked: boolean;
  notice: OtpNotice;
}

const EMPTY: OtpEntryState = { digits: "", showError: false, isChecking: false, isLocked: false, notice: null };

const SUCCESS_DELAY_MS = 300;
const ERROR_CLEAR_DELAY_MS = 300;
const ERROR_VISIBLE_MS = 1_500;

/**
 * Where the driver types the client's 6-digit code to confirm a hand-off.
 * Submits automatically when the sixth digit lands; a wrong code flashes an
 * error then clears; the fifth wrong code locks; network / job-changed
 * problems are shown separately so they aren't mistaken for typos. A failed
 * submit is never retried automatically — the driver types again.
 */
export function HandoffOtpScreen({ jobId, kind }: { jobId: string; kind: HandoffKind }) {
  const isPickup = kind === "PICKUP";
  const accent = isPickup ? "var(--green)" : "var(--blue)";
  const accentTint = isPickup ? "rgba(34,197,94,0.1)" : "rgba(45,125,255,0.1)";
  useThemeColor(isPickup ? "#22C55E" : "#2D7DFF");

  const nav = useNav();
  const job = useStore(container.jobs.jobs).find((j) => j.id === jobId);
  const [entry, setEntry] = useState<OtpEntryState>(EMPTY);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isLocked = entry.isLocked || job?.otpLocked === true;
  const [compact, setCompact] = useState(() => window.innerHeight < 700);
  useEffect(() => {
    const onResize = () => setCompact(window.innerHeight < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const update = (change: Partial<OtpEntryState> | ((s: OtpEntryState) => OtpEntryState)) => {
    if (!mounted.current) return;
    const next = typeof change === "function" ? change(entryRef.current) : { ...entryRef.current, ...change };
    entryRef.current = next;
    setEntry(next);
  };

  const submit = async (code: string) => {
    update({ isChecking: true });
    const result = await container.jobs.confirmHandoff(jobId, kind, code);
    switch (result) {
      case "SUCCESS":
        await delay(SUCCESS_DELAY_MS);
        update({ isChecking: false });
        if (mounted.current) nav.back();
        break;
      case "WRONG_CODE":
        await delay(ERROR_CLEAR_DELAY_MS);
        update({ ...EMPTY, showError: true });
        await delay(ERROR_VISIBLE_MS);
        update((s) => ({ ...s, showError: false }));
        break;
      case "LOCKED":
        update({ ...EMPTY, isLocked: true });
        break;
      case "ERROR":
        update({ ...EMPTY, notice: "NETWORK" });
        break;
      case "REFRESH":
        // The job was reassigned / cancelled / finished elsewhere; leave this screen.
        update({ ...EMPTY, notice: "JOB_CHANGED" });
        if (mounted.current) nav.back();
    }
  };

  const onDigit = (digit: string) => {
    const current = entryRef.current;
    if (current.isChecking || current.isLocked || isLocked || current.digits.length >= OTP_LENGTH) return;
    const digits = current.digits + digit;
    update({ digits, showError: false, notice: null });
    if (digits.length === OTP_LENGTH) void submit(digits);
  };

  const onBackspace = () => {
    const current = entryRef.current;
    if (current.isChecking || current.isLocked) return;
    update({ digits: current.digits.slice(0, -1), showError: false, notice: null });
  };

  useKeypadKeys(onDigit, onBackspace);

  return (
    <div className="screen" style={{ background: "var(--background)", height: "100dvh", minHeight: 0 }}>
      <div className="bar" style={{ background: accent }}>
        <div className="row" style={{ padding: "16px 16px 24px", gap: 16 }}>
          <BackCircleButton onClick={nav.back} background="rgba(255,255,255,0.2)" iconSize={28} />
          <div className="col">
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>OTP Code</span>
            <span style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>{isPickup ? "📦 PICK UP" : "🏁 DROP OFF"}</span>
          </div>
        </div>
      </div>
      {isLocked ? (
        <LockedState compact={compact} />
      ) : (
        <div className="col" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: "12px 24px calc(12px + var(--safe-bottom))", overflowY: "auto" }}>
          <Emoji size={compact ? 44 : 60}>🔑</Emoji>
          <div className="center" style={{ fontSize: 20, fontWeight: 900, color: "var(--gray-700)", margin: "12px 0 8px" }}>
            Ask client for the code
          </div>
          <div className="center" style={{ fontSize: 16, color: "var(--gray-500)", marginBottom: 16 }}>
            Enter the 6-digit code from the client
          </div>
          <OtpDigitRow digits={entry.digits} showError={entry.showError} accent={accent} accentTint={accentTint} style={{ marginBottom: 24 }} />
          {entry.showError && <div style={{ fontSize: 18, fontWeight: 900, color: "var(--red)", marginBottom: 16 }}>❌ Wrong code — try again</div>}
          {/* The request itself failed (not a typo), so say so instead of silently clearing the digits. */}
          {entry.notice && (
            <div className="center" style={{ fontSize: 16, color: "var(--red)", marginBottom: 16 }}>
              {entry.notice === "NETWORK" ? "⚠️ Couldn't reach the server. Enter the code again." : "⚠️ This job has changed."}
            </div>
          )}
          <NumberPad onDigit={onDigit} onBackspace={onBackspace} variant="elevated" keyHeight={compact ? 60 : 76} textSize={compact ? 26 : 30} />
        </div>
      )}
    </div>
  );
}

function LockedState({ compact }: { compact: boolean }) {
  return (
    <div className="col" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: "0 24px var(--safe-bottom)" }}>
      <Emoji size={compact ? 44 : 60}>🔒</Emoji>
      <div className="center" style={{ fontSize: 20, fontWeight: 900, color: "var(--gray-700)", margin: "12px 0 8px" }}>
        Too many wrong codes
      </div>
      <div className="center" style={{ fontSize: 16, color: "var(--gray-500)", marginBottom: 24 }}>
        This job is locked. Only dispatch can unlock it.
      </div>
      <Tap
        onClick={() => {
          if (!ExternalActions.dial(AppConfig.dispatchPhone)) toast("Dispatch number isn't set up. Contact your manager.", true);
        }}
        color="var(--red)"
        radius={16}
        className="btn"
      >
        📞 Call Dispatch
      </Tap>
    </div>
  );
}
