import { useEffect, useRef, useState, type FormEvent } from "react";
import { bookDelivery, brand, supportWhatsApp, type BookingInput } from "./api";

const ITEMS: { value: BookingInput["itemType"]; label: string }[] = [
  { value: "document", label: "Documents" },
  { value: "parcel", label: "Parcel" },
  { value: "spare_part", label: "Spare part" },
  { value: "other", label: "Other" },
];
const WHEN: { value: BookingInput["urgency"]; label: string }[] = [
  { value: "immediate", label: "Now" },
  { value: "today", label: "Today" },
  { value: "scheduled", label: "Pick a date" },
];

/** "Book a delivery": sends a request to dispatch, who confirm the price on WhatsApp. */
export default function BookPanel({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  const [form, setForm] = useState<BookingInput>({
    pickup: "", delivery: "", recipient: "", itemType: "parcel", urgency: "today", date: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneRef, setDoneRef] = useState<string | null>(null);
  const set = <K extends keyof BookingInput>(k: K, v: BookingInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.pickup.trim() || !form.delivery.trim()) { setError("Add both a pickup and a drop-off address."); return; }
    if (form.urgency === "scheduled" && !form.date) { setError("Pick a date for the delivery."); return; }
    setBusy(true);
    setError(null);
    try {
      setDoneRef(await bookDelivery(businessId, form));
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes("rate_limited")
        ? "You've sent a lot of requests today. Message dispatch on WhatsApp instead."
        : msg.includes("not_authorized") ? "Your login can't book for this company." : "Couldn't send the request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <dialog ref={ref} className="panel" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="panel-body">
        <div className="panel-head">
          <div>
            <h2>Book a delivery</h2>
            <p className="muted">{brand()} confirms the price on WhatsApp before anything moves.</p>
          </div>
          <button className="close" onClick={() => ref.current?.close()} aria-label="Close">×</button>
        </div>

        {doneRef ? (
          <div className="book-done">
            <h2>Request {doneRef} sent</h2>
            <p className="muted">Dispatch will WhatsApp you a price shortly. It appears here once it's booked.</p>
            <a className="secondary" href={`https://wa.me/${supportWhatsApp()}?text=${encodeURIComponent(`Hi ${brand()}, I just requested ${doneRef} from the client portal.`)}`} target="_blank" rel="noreferrer">
              WhatsApp dispatch
            </a>
            <button className="link" onClick={() => ref.current?.close()}>Done</button>
          </div>
        ) : (
          <form className="book-form" onSubmit={submit}>
            <label>Pickup<input value={form.pickup} onChange={(e) => set("pickup", e.target.value)} placeholder="Building, area, city" maxLength={500} /></label>
            <label>Drop-off<input value={form.delivery} onChange={(e) => set("delivery", e.target.value)} placeholder="Building, area, city" maxLength={500} /></label>
            <label>Recipient <span className="muted">(name and phone, optional)</span><input value={form.recipient} onChange={(e) => set("recipient", e.target.value)} maxLength={200} /></label>

            <fieldset className="book-fieldset">
              <legend>What are we carrying?</legend>
              <div className="book-choices">
                {ITEMS.map((i) => (
                  <button type="button" key={i.value} aria-pressed={form.itemType === i.value} onClick={() => set("itemType", i.value)}>{i.label}</button>
                ))}
              </div>
            </fieldset>

            <fieldset className="book-fieldset">
              <legend>When?</legend>
              <div className="book-choices">
                {WHEN.map((w) => (
                  <button type="button" key={w.value} aria-pressed={form.urgency === w.value} onClick={() => set("urgency", w.value)}>{w.label}</button>
                ))}
              </div>
              {form.urgency === "scheduled" && (
                <input type="date" min={today} value={form.date} onChange={(e) => set("date", e.target.value)} aria-label="Delivery date" />
              )}
            </fieldset>

            <label>Notes for dispatch <span className="muted">(optional)</span>
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} />
            </label>

            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Request a price"}</button>
          </form>
        )}
      </div>
    </dialog>
  );
}
