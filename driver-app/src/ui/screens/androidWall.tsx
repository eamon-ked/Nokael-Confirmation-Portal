import { useEffect } from "react";
import { AppConfig } from "../../logic/config";
import { container } from "../../logic/container";
import type { Job } from "../../logic/model";
import { useStore } from "../../logic/store";
import { DarkPanelScaffold, Emoji, ExternalActions, Tap, useThemeColor } from "../components";

/* ===========================================================================
 * Android phones must use the Android app (coc.nokael.com/android/), not this
 * web version: it keeps location and job alerts running in the background,
 * which a browser tab can't. iPhones keep using the web version.
 *
 * A driver who is part-way through a delivery (arrived at pickup, carrying the
 * item, or at the drop-off) can finish it here first — they get a banner, not
 * the wall — so nobody is stranded between OTPs.
 * ========================================================================= */

const INSTALL_PAGE = "/android/";

export function isAndroidPhone(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("web")) return false;
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform === "Android" || /Android/i.test(navigator.userAgent);
}

const MID_DELIVERY: Job["stage"][] = ["AT_PICKUP", "PICKED_UP", "AT_DROPOFF"];

/** True while the driver has a delivery under way that they should finish before switching. */
export function useMidDelivery(): boolean {
  const driver = useStore(container.session.driver);
  const jobs = useStore(container.jobs.jobs);
  return driver != null && jobs.some((job) => job.listStatus === "ACTIVE" && MID_DELIVERY.includes(job.stage));
}

export function AndroidWall() {
  useThemeColor("#1D2734");
  // The startup screen (which restores the session) never mounts behind the
  // wall, so restore it here: a driver with a delivery under way then loads
  // their jobs, and useMidDelivery lets them back in to finish it.
  useEffect(() => {
    if (container.session.driver.get() != null) return;
    container.auth
      .restoreSession()
      .then((result) => {
        if (result.type === "restored") container.session.signIn(result.driver);
      })
      .catch(() => undefined);
  }, []);
  return (
    <DarkPanelScaffold
      header={
        <div className="col" style={{ alignItems: "center", padding: "48px 24px 40px" }}>
          <Emoji size={72}>📲</Emoji>
          <div className="center" style={{ fontSize: 28, fontWeight: 900, color: "#fff", margin: "16px 0 4px" }}>
            Get the Nokael Driver app
          </div>
          <div className="center" style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>
            On Android, jobs now come through the app only.
          </div>
        </div>
      }
    >
      <div className="col">
        <Tap
          onClick={() => {
            window.location.href = INSTALL_PAGE;
          }}
          color="var(--neon)"
          contentColor="var(--on-neon)"
          radius={16}
          className="btn"
        >
          Download the app →
        </Tap>

        <ol style={{ margin: "24px 0 0", paddingInlineStart: 20, fontSize: 14, lineHeight: "22px", color: "var(--gray-600)" }}>
          <li>Tap <b>Download the app</b>, then open the downloaded file.</li>
          <li>If asked, allow your browser to <b>install unknown apps</b>.</li>
          <li>Tap <b>Install</b>. If Play Protect warns you, tap <b>More details → Install anyway</b>.</li>
          <li>Open <b>Nokael Driver</b> and sign in with the same phone or email and password.</li>
        </ol>

        <div style={{ marginTop: 24, background: "var(--blue-tint)", borderRadius: 16, padding: 16, fontSize: 13, color: "var(--gray-600)", lineHeight: "20px" }}>
          Already installed? Open <b>Nokael Driver</b> from your home screen. You can remove this web shortcut.
        </div>

        {AppConfig.dispatchPhone && (
          <Tap onClick={() => ExternalActions.dial(AppConfig.dispatchPhone)} color="transparent" contentColor="var(--gray-700)" radius={16} style={{ marginTop: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 900, padding: "12px 16px" }}>Trouble installing? Call dispatch</div>
          </Tap>
        )}
      </div>
    </DarkPanelScaffold>
  );
}

/** Shown instead of the wall while a delivery is under way. */
export function AndroidSwitchBanner() {
  return (
    <a className="android-banner" href={INSTALL_PAGE} style={{ paddingTop: "calc(8px + var(--safe-top))" }}>
      📲 Finish this delivery, then install the Nokael Driver app. <b>Get it →</b>
    </a>
  );
}
