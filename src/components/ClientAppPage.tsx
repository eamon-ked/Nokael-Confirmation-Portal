import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, ChevronLeft, Loader2, MapPin, MessageSquare, Package, Plus, Repeat2, Share, SquarePlus } from 'lucide-react';
import { orgBrand, orgDispatchNumber, orgLogoUrl, setOrg } from '@/src/lib/org';
import {
  type ClientAppData,
  type RebookInput,
  type RecentRoute,
  getClientApp,
  hasInstallPrompt,
  isIOS,
  isStandalone,
  markInstalled,
  promptInstall,
  rebook,
  setAppManifest,
} from '@/src/lib/clientApp';
import { ReviewCard } from './AfterDelivery';

/**
 * The installable client app — /app/:appToken.
 *
 * Opened from the home-screen icon (manifest start_url, see server.ts) or the
 * "Get the app" button on a delivered tracking page. Re-booking creates a
 * quote request (source 'rebook'); dispatch prices it and replies on WhatsApp.
 */

const ITEM_TYPES: { value: RebookInput['itemType']; label: string }[] = [
  { value: 'document', label: 'Documents' },
  { value: 'parcel', label: 'Parcel' },
  { value: 'spare_part', label: 'Spare part' },
  { value: 'other', label: 'Other' },
];
const URGENCIES: { value: RebookInput['urgency']; label: string; sub: string }[] = [
  { value: 'immediate', label: 'Now', sub: 'Within the hour' },
  { value: 'today', label: 'Today', sub: 'Same day' },
  { value: 'scheduled', label: 'Later', sub: 'Pick a date' },
];

const wa = (p: string, text: string) => `https://wa.me/${p.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const short = (s: string) => s.split(',')[0].trim();

type View = { kind: 'home' } | { kind: 'book'; from?: RecentRoute; reverse?: boolean } | { kind: 'done'; ref: string };

export default function ClientAppPage() {
  const { appToken } = useParams<{ appToken: string }>();
  const [search] = useSearchParams();
  const [data, setData] = useState<ClientAppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'home' });

  useEffect(() => {
    if (!appToken) return;
    setAppManifest(appToken);
    getClientApp(appToken)
      .then((d) => {
        if (!d) { setError('This app link is not valid any more. Please contact dispatch for a new one.'); return; }
        setOrg(d.org);
        setData(d);
        if (isStandalone() && !d.installed) markInstalled(appToken);
      })
      .catch(() => setError('We could not load your account right now. Check your connection and try again.'));
  }, [appToken]);

  useEffect(() => { if (data) document.title = orgBrand(); }, [data]);

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="nokael-card max-w-md w-full text-center space-y-4 py-10">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="text-nokael-text-main">{error}</p>
          <a href={wa(orgDispatchNumber(), `Hi ${orgBrand()}, I'd like to book a delivery.`)} target="_blank" rel="noopener noreferrer" className="nokael-button gap-2 no-underline">
            <MessageSquare className="w-5 h-5" /> WhatsApp us
          </a>
        </div>
      </div>
    );
  }
  if (!data || !appToken) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center text-nokael-text-muted">
        <Loader2 className="w-6 h-6 animate-spin text-nokael-primary" />
      </div>
    );
  }

  const brand = orgBrand();
  const logo = orgLogoUrl() || '/nokael-logo.jpg';
  // "Mr charbel Tamer" → "Charbel": skip titles, capitalise.
  const first = (data.name || '').trim().split(/\s+/).find((w) => !/^(mr|mrs|ms|miss|dr|eng|sheikh)\.?$/i.test(w));
  const firstName = first ? first.charAt(0).toUpperCase() + first.slice(1) : undefined;

  return (
    <div className="min-h-[100dvh] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-[1100] bg-nokael-bg/90 backdrop-blur border-b border-nokael-border pt-[env(safe-area-inset-top)]">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
          {view.kind === 'book' ? (
            <button onClick={() => setView({ kind: 'home' })} className="flex items-center gap-1 -ml-1 text-nokael-accent font-semibold text-sm" aria-label="Back">
              <ChevronLeft className="w-5 h-5" /> Back
            </button>
          ) : (
            <>
              <img src={logo} alt="" className="w-7 h-7 rounded-lg object-cover" />
              <span className="font-extrabold tracking-tight text-nokael-primary">{brand.toUpperCase()}</span>
            </>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
        {view.kind === 'home' && (
          <Home
            data={data}
            firstName={firstName}
            reviewToken={search.get('review')}
            showInstallSteps={search.get('install') === '1' || !!search.get('review')}
            onBook={(from, reverse) => setView({ kind: 'book', from, reverse })}
          />
        )}
        {view.kind === 'book' && (
          <BookForm
            appToken={appToken}
            from={view.from}
            reverse={view.reverse}
            onDone={(ref) => setView({ kind: 'done', ref })}
          />
        )}
        {view.kind === 'done' && (
          <section className="nokael-card text-center space-y-4 py-8">
            <CheckCircle2 className="w-12 h-12 text-nokael-success mx-auto" />
            <div>
              <p className="text-xl font-bold text-nokael-primary">Got it — {view.ref}</p>
              <p className="text-sm text-nokael-text-muted mt-1">We'll WhatsApp you a price shortly. Need it faster? Message us now.</p>
            </div>
            <a
              href={wa(orgDispatchNumber(), `Hi ${brand}, I just booked ${view.ref} from the app.`)}
              target="_blank" rel="noopener noreferrer"
              className="nokael-button gap-2 no-underline"
            >
              <MessageSquare className="w-5 h-5" /> WhatsApp dispatch
            </a>
            <button onClick={() => setView({ kind: 'home' })} className="text-sm font-semibold text-nokael-accent">Back to home</button>
          </section>
        )}
      </main>
    </div>
  );
}

function Home({ data, firstName, reviewToken, showInstallSteps, onBook }: {
  data: ClientAppData; firstName?: string; reviewToken: string | null; showInstallSteps: boolean;
  onBook: (from?: RecentRoute, reverse?: boolean) => void;
}) {
  const brand = orgBrand();
  const [canPrompt, setCanPrompt] = useState(hasInstallPrompt);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const ready = () => setCanPrompt(true);
    window.addEventListener('nokael_pwa_prompt_ready', ready);
    return () => window.removeEventListener('nokael_pwa_prompt_ready', ready);
  }, []);
  const showInstall = !isStandalone() && !installed && (showInstallSteps || canPrompt);

  return (
    <>
      <section className="space-y-1 pt-1">
        <h1 className="text-2xl font-bold text-nokael-primary">{firstName ? `Hi ${firstName}` : 'Welcome back'}</h1>
        <p className="text-sm text-nokael-text-muted">Where are we taking it today?</p>
      </section>

      {/* Arrived from an expired delivery link: ask for the review first. */}
      {reviewToken && <ReviewCard token={reviewToken} staff={false} />}

      {showInstall && (
        <section className="nokael-card space-y-3 border-nokael-accent/30">
          <p className="font-semibold text-nokael-primary">Add {brand} to your home screen</p>
          {canPrompt ? (
            <button onClick={async () => setInstalled(await promptInstall())} className="nokael-button gap-2">
              <SquarePlus className="w-5 h-5" /> Install app
            </button>
          ) : isIOS() ? (
            <ol className="text-[13px] text-nokael-text-muted space-y-1.5 list-decimal pl-5">
              <li>Tap <Share className="inline w-4 h-4 -mt-0.5 text-nokael-accent" /> <b>Share</b> in Safari's toolbar.</li>
              <li>Scroll and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>. Open {brand} from your home screen next time.</li>
            </ol>
          ) : (
            <p className="text-[13px] text-nokael-text-muted">Open your browser menu (⋮) and choose <b>Add to Home screen</b> or <b>Install app</b>.</p>
          )}
        </section>
      )}

      <button
        onClick={() => onBook()}
        className="w-full flex items-center justify-between rounded-2xl bg-nokael-primary text-white px-5 py-5 shadow-lg shadow-nokael-primary/15 active:scale-[0.99]"
      >
        <span className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center"><Plus className="w-6 h-6" /></span>
          <span className="text-left">
            <span className="block text-lg font-bold">Book a delivery</span>
            <span className="block text-[13px] text-white/60">Get a price on WhatsApp in minutes</span>
          </span>
        </span>
        <ArrowRight className="w-5 h-5" />
      </button>

      {data.recent.length > 0 && (
        <section className="space-y-2">
          <p className="info-label px-1">Repeat a delivery</p>
          {data.recent.map((r, i) => (
            <div key={i} className="nokael-card !p-0 overflow-hidden">
              <button onClick={() => onBook(r)} className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-slate-50">
                <Repeat2 className="w-5 h-5 text-nokael-accent shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-nokael-primary truncate">{short(r.pickup_location)} → {short(r.delivery_location)}</span>
                  <span className="block text-[12px] text-nokael-text-muted truncate">
                    {[r.pickup_emirate, r.delivery_emirate].filter(Boolean).join(' → ') || 'Same route'}
                  </span>
                </span>
                <ArrowRight className="w-4 h-4 text-nokael-text-muted" />
              </button>
              <button onClick={() => onBook(r, true)} className="w-full text-left px-4 py-2 border-t border-nokael-border text-[12px] font-semibold text-nokael-accent hover:bg-slate-50">
                Send it back the other way
              </button>
            </div>
          ))}
        </section>
      )}

      <a
        href={wa(orgDispatchNumber(), `Hi ${brand}, I'd like to book a delivery.`)}
        target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-2xl px-4 py-3.5 border bg-white border-nokael-border text-nokael-primary no-underline"
      >
        <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-nokael-accent-light"><MessageSquare className="w-4.5 h-4.5 text-nokael-accent" /></span>
        <span className="text-sm font-semibold">Prefer to chat? WhatsApp us</span>
      </a>
    </>
  );
}

function BookForm({ appToken, from, reverse, onDone }: { appToken: string; from?: RecentRoute; reverse?: boolean; onDone: (ref: string) => void }) {
  const a = reverse
    ? { loc: from?.delivery_location, em: from?.delivery_emirate, lat: from?.delivery_lat, lng: from?.delivery_lng }
    : { loc: from?.pickup_location, em: from?.pickup_emirate, lat: from?.pickup_lat, lng: from?.pickup_lng };
  const b = reverse
    ? { loc: from?.pickup_location, lat: from?.pickup_lat, lng: from?.pickup_lng }
    : { loc: from?.delivery_location, lat: from?.delivery_lat, lng: from?.delivery_lng };

  const [pickup, setPickup] = useState(a.loc ?? '');
  const [delivery, setDelivery] = useState(b.loc ?? '');
  const [itemType, setItemType] = useState<RebookInput['itemType']>(
    (ITEM_TYPES.find((t) => t.value === from?.item_type)?.value) ?? 'parcel');
  const [urgency, setUrgency] = useState<RebookInput['urgency']>('today');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Coordinates only travel with an address the client didn't edit.
  const keep = (orig: string | null | undefined, now: string) => !!orig && orig.trim() === now.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!pickup.trim() || !delivery.trim()) { setErr('Add both a pickup and a drop-off address.'); return; }
    if (urgency === 'scheduled' && !date) { setErr('Pick a date for the delivery.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const ref = await rebook(appToken, {
        pickup, delivery, itemType, urgency, notes,
        preferredDate: urgency === 'scheduled' ? date : null,
        pickupEmirate: keep(a.loc, pickup) ? a.em : null,
        pickupLat: keep(a.loc, pickup) ? a.lat : null,
        pickupLng: keep(a.loc, pickup) ? a.lng : null,
        deliveryLat: keep(b.loc, delivery) ? b.lat : null,
        deliveryLng: keep(b.loc, delivery) ? b.lng : null,
      });
      onDone(ref);
    } catch (e: any) {
      setErr(String(e?.message).includes('rate_limited')
        ? "You've sent several requests today. Dispatch will be in touch, or WhatsApp us."
        : 'Could not send your request. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const field = 'w-full rounded-xl border border-nokael-border bg-white px-3 py-3 text-[15px] text-nokael-primary';

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-bold text-nokael-primary">{from ? 'Repeat delivery' : 'New delivery'}</h1>

      <section className="nokael-card space-y-3">
        <label className="block space-y-1.5">
          <span className="info-label flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Pickup</span>
          <input className={field} value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Building, area, city" maxLength={500} />
        </label>
        <label className="block space-y-1.5">
          <span className="info-label flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Drop-off</span>
          <input className={field} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="Building, area, city" maxLength={500} />
        </label>
      </section>

      <section className="nokael-card space-y-3">
        <span className="info-label flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> What are we carrying?</span>
        <div className="grid grid-cols-2 gap-2">
          {ITEM_TYPES.map((t) => (
            <button type="button" key={t.value} onClick={() => setItemType(t.value)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${itemType === t.value ? 'bg-nokael-primary border-nokael-primary text-white' : 'bg-white border-nokael-border text-nokael-primary'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <span className="info-label block pt-1">When?</span>
        <div className="grid grid-cols-3 gap-2">
          {URGENCIES.map((u) => (
            <button type="button" key={u.value} onClick={() => setUrgency(u.value)}
              className={`rounded-xl border px-2 py-2.5 text-center ${urgency === u.value ? 'bg-nokael-primary border-nokael-primary text-white' : 'bg-white border-nokael-border text-nokael-primary'}`}>
              <span className="block text-sm font-semibold">{u.label}</span>
              <span className={`block text-[11px] ${urgency === u.value ? 'text-white/60' : 'text-nokael-text-muted'}`}>{u.sub}</span>
            </button>
          ))}
        </div>
        {urgency === 'scheduled' && (
          <input type="date" min={today} className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        )}

        <textarea className={`${field} resize-none`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for dispatch (optional)" />
      </section>

      {err && <p className="text-[13px] text-red-600 px-1">{err}</p>}
      <button type="submit" disabled={busy} className="nokael-button gap-2 disabled:opacity-60">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Request a price
      </button>
      <p className="text-center text-[12px] text-nokael-text-muted">No payment now. We confirm the price on WhatsApp first.</p>
    </form>
  );
}
