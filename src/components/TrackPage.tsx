import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Headphones,
  Key,
  Loader2,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  Phone,
  Share2,
  Truck,
  Undo2,
  UserCheck,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { formatUAETime } from '@/src/lib/utils';
import { Job } from '@/src/types';
import { LINK_EXPIRY_HOURS, isLinkExpired, redirectToBooking } from '@/src/lib/constants';
import { useOrgForToken, orgBrand, orgDispatchNumber, orgTimeZone } from '@/src/lib/org';
import { downloadCocPdf, DriverContact, PodFix } from '@/src/lib/cocPdf';
import DriverMap from './DriverMap';
import CustodyTimeline from './CustodyTimeline';
import { enableTrackingPush, trackingPushState, type TrackingPushState } from '@/src/lib/push';

/**
 * Client tracking page — /:token/track (sender) or /:token/track?for=recipient.
 *
 * Shared by dispatch from the dashboard. Read-only: it never confirms a step,
 * it only shows status, the live driver position, contact buttons, the
 * caller's own handover code, and the COC certificate once delivered.
 * `for` only changes wording — which OTP is visible is decided server-side
 * by which token get_job_by_token was called with.
 */

type Party = 'sender' | 'recipient';

const ACTIVE_POLL_MS = 20000;
const STALE_LOCATION_MS = 5 * 60 * 1000;

const tel = (p: string) => `tel:${p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`}`;
const wa = (p: string, text: string) => `https://wa.me/${p.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

const STAGES = [
  { label: 'Booked', icon: Package },
  { label: 'Driver assigned', icon: UserCheck },
  { label: 'Collected', icon: Truck },
  { label: 'Arriving', icon: MapPin },
  { label: 'Delivered', icon: CheckCircle2 },
] as const;

function stageOf(job: Job): number {
  if (job.status === 'completed') return 4;
  if (job.driver_arrived_delivery_at) return 3;
  if (job.driver_pickup_at || job.client_pickup_at) return 2;
  if (job.driver_id) return 1;
  return 0;
}

function headline(job: Job, stage: number, party: Party): { title: string; sub: string } {
  switch (stage) {
    case 4:
      return { title: 'Delivered', sub: `Received ${formatUAETime(job.client_delivery_at || job.driver_delivery_at)}. Your custody certificate is ready.` };
    case 3:
      return { title: 'Driver has arrived', sub: `At ${job.delivery_location}. ${party === 'recipient' ? 'Have your code ready.' : 'Handover to recipient in progress.'}` };
    case 2:
      return { title: 'On the way', sub: `Collected ${formatUAETime(job.driver_pickup_at || job.client_pickup_at)}, heading to ${job.delivery_location}.` };
    case 1:
      return job.driver_arrived_pickup_at
        ? { title: 'Driver at pickup', sub: `Arrived at ${job.pickup_location}. ${party === 'sender' ? 'Hand over the package with your code.' : 'Collection in progress.'}` }
        : { title: 'Driver on the way to pickup', sub: `Heading to ${job.pickup_location}, ${job.pickup_emirate}.` };
    default:
      return {
        title: 'Booking confirmed',
        sub: job.scheduled_pickup_at
          ? `Pickup scheduled for ${formatUAETime(job.scheduled_pickup_at)}. A driver will be assigned shortly.`
          : 'We are assigning a driver to your job.',
      };
  }
}

function ActionButton({ href, icon: Icon, label, sub, primary, disabled }: {
  href?: string; icon: typeof Phone; label: string; sub?: string; primary?: boolean; disabled?: boolean;
}) {
  const cls = `flex items-center gap-3 rounded-2xl px-4 py-3.5 border transition-all active:scale-[0.98] no-underline ${
    disabled
      ? 'bg-slate-50 border-nokael-border text-slate-400 pointer-events-none'
      : primary
        ? 'bg-nokael-primary border-nokael-primary text-white shadow-lg shadow-nokael-primary/15'
        : 'bg-white border-nokael-border text-nokael-primary hover:bg-slate-50'
  }`;
  const target = href?.startsWith('http') ? '_blank' : undefined;
  return (
    <a href={disabled ? undefined : href} target={target} rel={target ? 'noopener noreferrer' : undefined} className={cls} aria-disabled={disabled}>
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${primary && !disabled ? 'bg-white/10' : 'bg-nokael-accent-light'}`}>
        <Icon className={`w-4.5 h-4.5 ${primary && !disabled ? 'text-white' : 'text-nokael-accent'}`} />
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-sm font-semibold leading-tight">{label}</span>
        {sub && <span className={`text-[12px] truncate ${primary && !disabled ? 'text-white/60' : 'text-nokael-text-muted'}`}>{sub}</span>}
      </span>
    </a>
  );
}

export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  // The job's company: its name, dispatch number and time zone (Nokael until loaded).
  useOrgForToken(token);
  const [search] = useSearchParams();
  const party: Party = search.get('for') === 'recipient' ? 'recipient' : 'sender';

  const [job, setJob] = useState<Job | null>(null);
  const [driver, setDriver] = useState<DriverContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<TrackingPushState>(() => (token ? trackingPushState(token) : 'unsupported'));
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOtp, setShowOtp] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);

  const fetchJob = useCallback(async () => {
    if (!token) return;
    const { data, error: err } = await supabase.rpc('get_job_by_token', { p_token: token }).maybeSingle();
    if (isLinkExpired(err)) return redirectToBooking();
    if (err) {
      setError(isSupabaseConfigured ? 'We could not load this job right now. Please refresh, or contact dispatch.' : 'This tracking page is not configured. Please contact Nokael dispatch.');
    } else if (!data) {
      setError(`This tracking link is invalid or has expired. Please contact ${orgBrand()} dispatch for a new link.`);
    } else {
      setJob(data as Job);
      setError(null);
    }
    setLoading(false);
  }, [token]);

  // Driver contact card. Missing RPC (migration not applied) or no driver
  // yet both just leave the card empty; the page falls back to dispatch.
  const fetchDriver = useCallback(async () => {
    if (!token) return;
    const { data, error: err } = await supabase.rpc('get_job_driver_by_token', { p_token: token }).maybeSingle();
    if (!err) setDriver((data as DriverContact) || null);
  }, [token]);

  // Handover GPS for the COC certificate. Missing RPC (supabase-coc-gps-migration.sql
  // not applied) just leaves it empty; the certificate prints without coordinates.
  const [pod, setPod] = useState<PodFix[]>([]);
  const fetchPod = useCallback(async () => {
    if (!token) return;
    const { data, error: err } = await supabase.rpc('get_job_pod_by_token', { p_token: token });
    if (!err) setPod((data as PodFix[]) || []);
  }, [token]);

  useEffect(() => { fetchJob(); }, [fetchJob]);
  useEffect(() => { if (job?.driver_id) fetchDriver(); else setDriver(null); }, [job?.driver_id, job?.status, fetchDriver]);
  useEffect(() => { if (job?.status === 'completed') fetchPod(); }, [job?.status, fetchPod]);

  const isActive = !!job && !['completed', 'cancelled', 'returned'].includes(job.status);

  // Realtime: the jobs table broadcasts a PII-free "job_updated" ping on
  // topic job:<id> (see supabase-realtime-broadcast-migration.sql). A slow
  // poll backs it up in case the socket drops on mobile networks.
  useEffect(() => {
    if (!job?.id || !isActive) return;
    const channel = supabase
      .channel(`job:${job.id}`)
      .on('broadcast', { event: 'job_updated' }, () => fetchJob())
      .subscribe();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') fetchJob(); }, ACTIVE_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchJob(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [job?.id, isActive, fetchJob]);

  // Re-render "updated x min ago" labels.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch { /* clipboard blocked — nothing useful to show */ }
  };

  const turnOnPush = async () => {
    if (!token || pushBusy) return;
    setPushBusy(true);
    try {
      setPushState(await enableTrackingPush(token));
    } catch {
      setPushState('off');
    } finally {
      setPushBusy(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: `${orgBrand()} job ${job?.job_ref ?? ''}`, url }); } catch { /* cancelled */ }
    } else {
      copy(url, 'link');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 text-nokael-text-muted">
        <Loader2 className="w-6 h-6 animate-spin text-nokael-primary" />
        <p className="text-sm">Loading your delivery…</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="nokael-card max-w-md w-full text-center space-y-4 py-10">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="text-nokael-text-main">{error}</p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <ActionButton href={tel(orgDispatchNumber())} icon={Phone} label="Call dispatch" />
            <ActionButton href={wa(orgDispatchNumber(), `Hi ${orgBrand()}, my tracking link is not working.`)} icon={MessageSquare} label="WhatsApp" />
          </div>
        </div>
      </div>
    );
  }

  const stage = stageOf(job);
  const closed = job.status === 'cancelled' || job.status === 'returned';
  const { title, sub } = headline(job, stage, party);
  const dispatchMsg = `Hi ${orgBrand()}, I'm enquiring about job ${job.job_ref}.`;

  // The caller's own code is only useful until the handover it guards.
  const otp = job.otp_own?.trim();
  const otpUsedAt = party === 'sender' ? (job.driver_pickup_at || job.client_pickup_at) : (job.client_delivery_at || job.driver_delivery_at);
  const showOtpCard = !!otp && isActive && !otpUsedAt;

  const hasDriverPos = job.driver_lat != null && job.driver_lng != null;
  const locationStale = job.driver_updated_at ? Date.now() - new Date(job.driver_updated_at).getTime() > STALE_LOCATION_MS : true;
  const vehicle = driver ? [driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(' ') || driver.vehicle_type : null;

  return (
    <div className="min-h-[100dvh] pb-[max(2rem,env(safe-area-inset-bottom))]">
      {/* Top bar */}
      <header className="sticky top-0 z-[1100] bg-nokael-bg/90 backdrop-blur border-b border-nokael-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/nokael-logo.jpg" alt="" className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-extrabold tracking-tight text-nokael-primary">NOKAEL</span>
          </div>
          <button onClick={share} className="flex items-center gap-1.5 text-[13px] font-semibold text-nokael-accent px-3 py-1.5 rounded-lg hover:bg-nokael-accent-light">
            <Share2 className="w-4 h-4" /> {copied === 'link' ? 'Link copied' : 'Share'}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
        {/* Status hero */}
        <section className="nokael-card space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="info-label">Job {job.job_ref}</p>
              <h1 className="text-2xl font-bold text-nokael-primary leading-tight">
                {closed ? (job.status === 'returned' ? 'Returning to sender' : 'Job cancelled') : title}
              </h1>
              <p className="text-sm text-nokael-text-muted mt-1">
                {closed
                  ? job.status === 'returned'
                    ? 'The package could not be delivered and is on its way back. Dispatch will be in touch.'
                    : job.cancellation_reason || 'This job has been cancelled. Contact dispatch if this is unexpected.'
                  : sub}
              </p>
              {isActive && etaMinutes != null && !locationStale && (
                <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-nokael-accent-light px-3 py-2 text-sm font-semibold text-nokael-primary">
                  <Clock className="w-4 h-4 text-nokael-accent" />
                  {stage >= 2 ? 'Arriving' : 'Driver at pickup'} around{' '}
                  {new Date(Date.now() + etaMinutes * 60000).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: orgTimeZone() })}
                  <span className="font-normal text-nokael-text-muted">· about {etaMinutes} min</span>
                </p>
              )}
            </div>
            {isActive && (
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-nokael-success bg-nokael-success/10 px-2.5 py-1 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-nokael-success animate-pulse" /> Live
              </span>
            )}
            {closed && <Undo2 className="w-6 h-6 text-amber-500 shrink-0" />}
          </div>

          {!closed && (
            <ol className="grid grid-cols-5 gap-1" aria-label="Delivery progress">
              {STAGES.map((s, i) => {
                const done = i <= stage;
                const current = i === stage && isActive;
                return (
                  <li key={s.label} className="flex flex-col items-center gap-1.5 text-center">
                    <span className={`h-1.5 w-full rounded-full ${done ? 'bg-nokael-success' : 'bg-slate-200'} ${current ? 'animate-pulse' : ''}`} />
                    <s.icon className={`w-4 h-4 ${done ? 'text-nokael-success' : 'text-slate-300'}`} />
                    <span className={`text-[10.5px] leading-tight ${done ? 'text-nokael-primary font-semibold' : 'text-nokael-text-muted'}`}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Push updates for this delivery (hidden where the browser can't do push). */}
          {isActive && pushState === 'off' && (
            <button
              onClick={turnOnPush}
              disabled={pushBusy}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-nokael-border px-4 py-2.5 text-sm font-semibold text-nokael-accent hover:bg-nokael-accent-light disabled:opacity-60"
            >
              {pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
              Notify me about this delivery
            </button>
          )}
          {isActive && pushState === 'on' && (
            <p className="flex items-center justify-center gap-2 text-[13px] text-nokael-text-muted">
              <BellRing className="w-4 h-4 text-nokael-success" /> You'll get a notification at each step.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-nokael-border">
            <div className="pt-3">
              <p className="info-label">From</p>
              <p className="info-value">{job.pickup_location}, {job.pickup_emirate}</p>
              <p className="text-[12px] text-nokael-text-muted">{job.sender_name}</p>
            </div>
            <div className="pt-3">
              <p className="info-label">To</p>
              <p className="info-value">{job.delivery_location}, {job.delivery_emirate}</p>
              <p className="text-[12px] text-nokael-text-muted">{job.recipient_name}</p>
            </div>
          </div>
        </section>

        {/* COC download — the end-of-job deliverable */}
        {job.status === 'completed' && (
          <section className="nokael-card border-nokael-success/30 bg-nokael-success/[0.03] space-y-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-nokael-success/10 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-nokael-success" />
              </span>
              <div>
                <p className="font-semibold text-nokael-primary">Chain of Custody certificate</p>
                <p className="text-[13px] text-nokael-text-muted">Every handover, time-stamped, code-verified and GPS-located.</p>
                <p className="text-[12px] text-nokael-text-muted mt-1">
                  This link closes {LINK_EXPIRY_HOURS} hours after delivery. Download your certificate now. After that, dispatch can send it to you.
                </p>
              </div>
            </div>
            <button onClick={() => downloadCocPdf(job, driver, pod)} className="nokael-button gap-2 !bg-nokael-success">
              <Download className="w-5 h-5" /> Download COC (PDF)
            </button>
          </section>
        )}

        {/* Handover code */}
        {showOtpCard && (
          <section className="nokael-card space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-nokael-accent" />
              <p className="font-semibold text-nokael-primary">Your handover code</p>
            </div>
            <p className="text-[13px] text-nokael-text-muted">
              {party === 'sender'
                ? 'Give this code to the driver only when you hand over the package.'
                : 'Give this code to the driver only once you have the package in hand.'}{' '}
              {orgBrand()} will never ask for it by phone.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-14 rounded-xl bg-slate-50 border border-nokael-border flex items-center justify-center font-mono text-2xl font-bold tracking-[0.3em] whitespace-nowrap text-nokael-primary">
                {showOtp ? otp : '••••'}
              </div>
              <button onClick={() => setShowOtp((v) => !v)} className="h-14 w-14 rounded-xl border border-nokael-border bg-white flex items-center justify-center text-nokael-primary" aria-label={showOtp ? 'Hide code' : 'Show code'}>
                {showOtp ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
              <button onClick={() => copy(otp!, 'otp')} className="h-14 w-14 rounded-xl border border-nokael-border bg-white flex items-center justify-center text-nokael-primary" aria-label="Copy code">
                {copied === 'otp' ? <CheckCircle2 className="w-5 h-5 text-nokael-success" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </section>
        )}
        {!!otp && otpUsedAt && isActive && (
          <p className="text-[12px] text-nokael-text-muted px-1 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-nokael-success" /> Your handover code was used {formatUAETime(otpUsedAt)}.
          </p>
        )}

        {/* Driver + contact */}
        {!closed && (
          <section className="nokael-card space-y-4">
            {job.driver_id ? (
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-full bg-nokael-primary text-white flex items-center justify-center font-bold">
                  {(driver?.full_name || 'N').trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-nokael-primary truncate">{driver?.full_name || 'Your Nokael driver'}</p>
                  <p className="text-[13px] text-nokael-text-muted truncate">
                    {[vehicle, driver?.vehicle_plate].filter(Boolean).join(' · ') || `Verified ${orgBrand()} courier`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-nokael-text-muted">A driver hasn't been assigned yet. Dispatch can help with any questions.</p>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              {isActive && driver?.phone && (
                <>
                  <ActionButton primary href={tel(driver.phone)} icon={Phone} label="Call driver" sub={driver.full_name?.split(' ')[0] || undefined} />
                  <ActionButton href={wa(driver.phone, `Hi, this is about ${orgBrand()} job ${job.job_ref}.`)} icon={MessageSquare} label="Message driver" sub="WhatsApp" />
                </>
              )}
              <ActionButton primary={!(isActive && driver?.phone)} href={tel(orgDispatchNumber())} icon={Headphones} label="Call dispatch" sub="24/7" />
              <ActionButton href={wa(orgDispatchNumber(), dispatchMsg)} icon={MessageSquare} label="Message dispatch" sub="WhatsApp" />
            </div>
          </section>
        )}

        {/* Live location */}
        {isActive && job.driver_id && (
          <section className="space-y-2">
            {hasDriverPos ? (
              <DriverMap job={job} onEta={setEtaMinutes} />
            ) : (
              <div className="nokael-card text-sm text-nokael-text-muted flex items-center gap-2">
                <Navigation className="w-4 h-4" /> Live location appears once the driver starts moving.
              </div>
            )}
            {hasDriverPos && (
              <div className="flex items-center justify-between px-1 text-[12px] text-nokael-text-muted">
                <span className={locationStale ? 'text-amber-600' : ''}>
                  {job.driver_updated_at ? `Location updated ${timeAgo(job.driver_updated_at)}` : 'Location time unknown'}
                  {locationStale && ' — signal may be weak'}
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${job.driver_lat},${job.driver_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-nokael-accent"
                >
                  Open in Maps
                </a>
              </div>
            )}
          </section>
        )}

        {/* Chain of custody */}
        <section className="nokael-card">
          <CustodyTimeline job={job} compact />
        </section>

        {closed && (
          <section className="grid grid-cols-2 gap-2.5">
            <ActionButton primary href={tel(orgDispatchNumber())} icon={Headphones} label="Call dispatch" />
            <ActionButton href={wa(orgDispatchNumber(), dispatchMsg)} icon={MessageSquare} label="Message dispatch" sub="WhatsApp" />
          </section>
        )}

        <p className="text-center text-[11px] text-nokael-text-muted pt-2">
          Item: {job.item_type} · {job.urgency} · Booked {formatUAETime(job.created_at)}
        </p>
      </main>
    </div>
  );
}
