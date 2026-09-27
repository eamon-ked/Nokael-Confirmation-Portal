import { useEffect, useRef } from "react";
import { COC_URL } from "./supabase";
import { ago, full, slotText, statusOf, verifiedLabel, type Job } from "./api";

type Step = { label: string; at: string | null; note?: string | null };

export default function JobPanel({ job, onClose }: { job: Job; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  const s = statusOf(job);
  const inTransit = s.tone === "moving";
  const steps: Step[] = [
    { label: "Collected by the driver", at: job.picked_up_at },
    { label: "Driver arrived", at: job.arrived_at },
    job.returned_at
      ? { label: "Returned", at: job.returned_at, note: job.return_reason }
      : { label: "Delivered", at: job.delivered_at, note: verifiedLabel(job.delivery_verified_by) },
  ];

  return (
    <dialog ref={ref} className="panel" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="panel-body">
        <div className="panel-head">
          <div>
            <h2>{job.recipient_name}</h2>
            <p className="muted">{job.delivery_location}, {job.delivery_emirate}</p>
          </div>
          <button className="close" onClick={() => ref.current?.close()} aria-label="Close">×</button>
        </div>

        <dl className="facts">
          <div><dt>Time slot</dt><dd>{slotText(job)}</dd></div>
          <div><dt>Status</dt><dd><span className={`status ${s.tone}`}>{s.label}</span></dd></div>
          {job.job_ref && <div><dt>Reference</dt><dd>{job.job_ref}</dd></div>}
        </dl>

        <ol className="custody" aria-label="Chain of custody">
          {steps.map((st) => (
            <li key={st.label} className={st.at ? "reached" : ""}>
              <span className="custody-label">{st.label}</span>
              <span className="custody-at">{st.at ? full(st.at) : "Not yet"}</span>
              {st.at && st.note && <span className="custody-note">{st.note}</span>}
            </li>
          ))}
        </ol>

        {job.remark && (
          <div className="remark">
            <p className="remark-title">Note from the driver</p>
            <p>{job.remark}</p>
          </div>
        )}

        {inTransit && (
          <div className="live">
            {job.driver_lat != null && job.driver_lng != null ? (
              <p>
                Driver's last position was {ago(job.driver_location_at)}.{" "}
                <a href={`https://maps.google.com/?q=${job.driver_lat},${job.driver_lng}`} target="_blank" rel="noreferrer">Open in Maps</a>
              </p>
            ) : (
              <p className="muted">The driver's live position isn't available right now.</p>
            )}
            {job.tracking_token && (
              <a className="secondary" href={`${COC_URL}/${job.tracking_token}/track`} target="_blank" rel="noreferrer">Open live tracking</a>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
