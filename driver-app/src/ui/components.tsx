import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Store, useStore } from "../logic/store";

/* ---------------------------------------------------------------------------
 * Icons (Material "filled" paths, same glyphs as the Android app)
 * ------------------------------------------------------------------------- */
const ICONS = {
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  backspace:
    "M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z",
  chevronDown: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
};

export function Icon({ name, size = 24, className }: { name: keyof typeof ICONS; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export const Emoji = ({ children, size }: { children: string; size: number }) => (
  <span className="emoji" style={{ fontSize: size }} aria-hidden="true">
    {children}
  </span>
);

/* ---------------------------------------------------------------------------
 * ActionSurface: the app's tappable tile, shrinks slightly while pressed
 * ------------------------------------------------------------------------- */
export function Tap({
  onClick,
  color,
  contentColor = "#fff",
  radius = 24,
  elevation = 0,
  disabled,
  className = "",
  style,
  label,
  children,
}: {
  onClick: () => void;
  color: string;
  contentColor?: string;
  radius?: number;
  elevation?: 0 | 1 | 3 | 4 | 8;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tap ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        background: color,
        color: contentColor,
        borderRadius: radius,
        boxShadow: elevation ? `var(--elev-${elevation})` : undefined,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Round translucent back button used on dark and coloured headers. */
export function BackCircleButton({ onClick, background = "rgba(255,255,255,0.1)", iconSize = 24 }: { onClick: () => void; background?: string; iconSize?: number }) {
  return (
    <Tap onClick={onClick} color={background} radius={999} className="back-circle" label="Back">
      <Icon name="back" size={iconSize} />
    </Tap>
  );
}

/** Small uppercase heading above a group of content. */
export const SectionLabel = ({ text, style }: { text: string; style?: CSSProperties }) => (
  <div className="label" style={{ color: "var(--gray-400)", ...style }}>
    {text}
  </div>
);

/** A tinted box with an emoji, a small caption and the value below it. */
export function InfoBlock({
  emoji,
  caption,
  text,
  background,
  captionColor,
  trailing,
}: {
  emoji: string;
  caption: string;
  text: string;
  background: string;
  captionColor: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="info-block" style={{ background }}>
      <Emoji size={20}>{emoji}</Emoji>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <span className="info-block__caption" style={{ color: captionColor }}>
          {caption}
        </span>
        <span className="info-block__text">{text}</span>
      </div>
      {trailing}
    </div>
  );
}

/** The sign-in look: a navy header area with a white, rounded-top panel. */
export function DarkPanelScaffold({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="screen dark-panel">
      <div className="dark-panel__header">{header}</div>
      <div className="dark-panel__body">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * OTP
 * ------------------------------------------------------------------------- */
export const OTP_LENGTH = 6;

/** Six boxes showing the digits typed so far. Turns red while `showError`. */
export function OtpDigitRow({ digits, showError, accent, accentTint, style }: { digits: string; showError: boolean; accent: string; accentTint: string; style?: CSSProperties }) {
  return (
    <div className={`otp-row ${showError ? "shake" : ""}`} style={style} role="status" aria-label={`${digits.length} of ${OTP_LENGTH} digits entered`}>
      {Array.from({ length: OTP_LENGTH }, (_, i) => {
        const digit = digits[i];
        return (
          <div
            key={i}
            className="otp-box"
            style={{
              borderColor: showError ? "var(--red)" : digit != null ? accent : undefined,
              background: digit != null ? accentTint : undefined,
              color: showError ? "var(--red)" : undefined,
            }}
          >
            {digit ?? ""}
          </div>
        );
      })}
    </div>
  );
}

/** 3×4 phone-style keypad: digits, a blank cell, 0 and backspace. */
export function NumberPad({
  onDigit,
  onBackspace,
  variant = "outlined",
  keyHeight = 64,
  textSize = 24,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  variant?: "outlined" | "elevated";
  keyHeight?: number;
  textSize?: number;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="pad">
      {keys.map((key, i) => {
        if (key === "") return <div key={i} />;
        if (key === "⌫")
          return (
            <Tap key={i} onClick={onBackspace} color="var(--red-soft)" radius={16} className="pad-key pad-key--delete" style={{ height: keyHeight }} label="Delete">
              <Icon name="backspace" size={textSize + 2} />
            </Tap>
          );
        return (
          <Tap
            key={i}
            onClick={() => onDigit(key)}
            color={variant === "outlined" ? "var(--slate-50)" : "#fff"}
            contentColor="var(--slate)"
            radius={16}
            className={`pad-key pad-key--${variant}`}
            style={{ height: keyHeight, fontSize: textSize }}
          >
            {key}
          </Tap>
        );
      })}
    </div>
  );
}

/** Lets a hardware keyboard type into a keypad screen too (desktop / tablets with keyboards). */
export function useKeypadKeys(onDigit: (d: string) => void, onBackspace: () => void) {
  const latest = useRef({ onDigit, onBackspace });
  latest.current = { onDigit, onBackspace };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(event.key)) latest.current.onDigit(event.key);
      else if (event.key === "Backspace") latest.current.onBackspace();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

/* ---------------------------------------------------------------------------
 * Bottom sheets
 * ------------------------------------------------------------------------- */

/** White bottom sheet with the reference's rounded top and grab handle. */
export function ActionBottomSheet({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  return (
    <div className="scrim" onClick={onDismiss}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet__handle" />
        {children}
      </div>
    </div>
  );
}

function SheetCancelButton({ onClick }: { onClick: () => void }) {
  return (
    <Tap onClick={onClick} color="var(--slate-100)" contentColor="var(--gray-600)" radius={16} className="full">
      <div className="center" style={{ fontSize: 16, fontWeight: 900, padding: "16px 0" }}>
        Cancel
      </div>
    </Tap>
  );
}

/** "Are you sure?" sheet with one coloured confirm button and a cancel. */
export function ConfirmSheet({
  emoji,
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onDismiss,
}: {
  emoji: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <ActionBottomSheet onDismiss={onDismiss}>
      <Emoji size={48}>{emoji}</Emoji>
      <div className="center" style={{ fontSize: 20, fontWeight: 900, color: "var(--gray-900)", margin: "12px 0 8px" }}>
        {title}
      </div>
      <div className="center" style={{ fontSize: 14, lineHeight: "22px", color: "var(--gray-500)", marginBottom: 24 }}>
        {message}
      </div>
      <Tap onClick={onConfirm} color={confirmColor} radius={16} className="full" style={{ marginBottom: 12 }}>
        <div className="center" style={{ fontSize: 18, fontWeight: 900, padding: "20px 0" }}>
          {confirmLabel}
        </div>
      </Tap>
      <SheetCancelButton onClick={onDismiss} />
    </ActionBottomSheet>
  );
}

/** Sheet offering to call or message dispatch. */
export function DispatchSheet({ onCall, onMessage, onDismiss }: { onCall: () => void; onMessage: () => void; onDismiss: () => void }) {
  const option = (emoji: string, title: string, subtitle: string, color: string, onClick: () => void) => (
    <Tap onClick={onClick} color={color} radius={16} className="full" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 16, padding: 20 }}>
        <Emoji size={30}>{emoji}</Emoji>
        <div className="col">
          <span style={{ fontSize: 18, fontWeight: 900 }}>{title}</span>
          <span style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>{subtitle}</span>
        </div>
      </div>
    </Tap>
  );
  return (
    <ActionBottomSheet onDismiss={onDismiss}>
      <Emoji size={36}>📡</Emoji>
      <div style={{ fontSize: 20, fontWeight: 900, color: "var(--gray-900)", margin: "8px 0 4px" }}>Contact Dispatch</div>
      <div style={{ fontSize: 14, color: "var(--gray-400)", marginBottom: 24 }}>How would you like to reach dispatch?</div>
      {option("📞", "Call Dispatch", "Direct voice call", "var(--green)", onCall)}
      {option("💬", "Send Message", "Text or WhatsApp", "var(--blue)", onMessage)}
      <SheetCancelButton onClick={onDismiss} />
    </ActionBottomSheet>
  );
}

/* ---------------------------------------------------------------------------
 * Toasts (Android `Toast`)
 * ------------------------------------------------------------------------- */
const toastStore = new Store<{ id: number; text: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, long = false) {
  clearTimeout(toastTimer);
  toastStore.set({ id: Date.now(), text });
  toastTimer = setTimeout(() => toastStore.set(null), long ? 3500 : 2000);
}

export function ToastHost() {
  const current = useStore(toastStore);
  return (
    <div className="toast-host" aria-live="polite">
      {current && (
        <div key={current.id} className="toast">
          {current.text}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * External actions (phone, messages, maps)
 * ------------------------------------------------------------------------- */
const clean = (phone: string) => phone.replace(/ /g, "");

export const ExternalActions = {
  /** Returns false when no number is configured, so a blank number can't open an empty dialer. */
  dial(phone: string): boolean {
    if (!phone.trim()) return false;
    window.location.href = `tel:${clean(phone)}`;
    return true;
  },
  sms(phone: string): boolean {
    if (!phone.trim()) return false;
    window.location.href = `sms:${clean(phone)}`;
    return true;
  },
  /** Opens turn-by-turn directions (Google Maps app if installed, otherwise the website). */
  navigate(address: string) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) window.location.href = url;
  },
};

/** Status-bar colour for the current screen (Android sets this per screen). */
export function useThemeColor(color: string) {
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
    document.body.style.background = color;
  }, [color]);
}
