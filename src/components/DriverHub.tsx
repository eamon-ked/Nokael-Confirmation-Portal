import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { cacheJobData, getCachedJob, isOnline, checkServerReachable, setupConnectivityListeners } from '@/src/lib/offline';
import { Job, STEP_CONFIG } from '@/src/types';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  Package,
  Truck,
  WifiOff,
} from 'lucide-react';

// Local cache key namespace — distinct from the per-step cache entries so
// the hub's own cached copy doesn't collide with (or get evicted by) a
// driver-pickup / driver-delivery page cached under the same token.
const HUB_CACHE_STEP = 'driver-hub';

type CardStatus = 'locked' | 'waiting' | 'ready' | 'done';

function StatusPill({ status }: { status: CardStatus }) {
  const map: Record<CardStatus, { label: string; className: string }> = {
    locked: { label: 'Locked', className: 'bg-slate-100 text-slate-400 border-slate-200' },
    waiting: { label: 'Waiting', className: 'bg-amber-50 text-amber-700 border-amber-100' },
    ready: { label: 'Ready', className: 'bg-nokael-accent-light text-nokael-accent border-nokael-accent/20' },
    done: { label: 'Done', className: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  };
  const cfg = map[status];
  return (
    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function StepCard({
  title,
  subtitle,
  location,
  emirate,
  status,
  onClick,
}: {
  title: string;
  subtitle: string;
  location: string;
  emirate: string;
  status: CardStatus;
  onClick: () => void;
}) {
  const locked = status === 'locked';
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={`w-full text-left nokael-card !p-6 flex items-center gap-5 transition-all active:scale-[0.98] shadow-xl
        ${locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}
        ${status === 'done' ? 'border-emerald-100 bg-emerald-50/30' : 'border-nokael-border'}`}
    >
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0
        ${status === 'done' ? 'bg-emerald-500' : locked ? 'bg-slate-200' : 'bg-slate-900'}`}
      >
        {locked ? (
          <Lock className="w-6 h-6 text-slate-400" />
        ) : status === 'done' ? (
          <CheckCircle2 className="w-6 h-6 text-white" />
        ) : (
          <Package className="w-6 h-6 text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-black text-nokael-primary/40 uppercase tracking-[0.2em]">{subtitle}</span>
          <StatusPill status={status} />
        </div>
        <h3 className="text-xl font-black text-nokael-primary tracking-tight">{title}</h3>
        <p className="text-sm font-bold text-nokael-text-muted truncate capitalize">{location}, {emirate}</p>
      </div>
      {!locked && <ChevronRight className="w-5 h-5 text-nokael-primary/30 shrink-0" />}
    </button>
  );
}

export default function DriverHub() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());
  const [configError] = useState(!isSupabaseConfigured);

  const fetchJob = useCallback(async () => {
    if (!token) return;
    try {
      if (isOnline()) {
        const { data, error: rpcError } = await supabase.rpc('get_job_by_token', { p_token: token }).single();
        if (rpcError || !data) {
          setError('Security Error: Invalid or expired access link. Please check the link or contact dispatch.');
          setJob(null);
          return;
        }

        const jobData = data as Job;

        // The hub is driver-only. get_job_by_token accepts any of the four
        // step tokens (or the generic tracking token) — reject anything
        // that isn't one of this job's two driver tokens so a sender or
        // recipient link can't be repointed here and pick up driver-only
        // tokens/OTP fields in the process.
        if (jobData.token_driver_pickup !== token && jobData.token_driver_delivery !== token) {
          setError('This link is not valid for the driver hub. Please check the link or contact dispatch.');
          setJob(null);
          return;
        }

        setJob(jobData);
        setError(null);
        await cacheJobData(token, HUB_CACHE_STEP, jobData, '', '');
      } else {
        const cached = await getCachedJob(token);
        if (cached) { setJob(cached.job_data as Job); setOnline(false); }
        else setError('No internet connection. Please connect to load this page for the first time.');
      }
    } catch (err) {
      try {
        const cached = await getCachedJob(token);
        if (cached) { setJob(cached.job_data as Job); setOnline(false); }
        else setError('Unable to load job data. Please try again.');
      } catch {
        setError('Something went wrong. Please try again or contact Nokael dispatch.');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetchJob();

    const cleanup = setupConnectivityListeners(
      () => checkServerReachable().then((reachable) => { setOnline(reachable); if (reachable) fetchJob(); }),
      () => setOnline(false)
    );
    checkServerReachable().then((reachable) => setOnline(reachable));

    // Light background poll — a driver may sit on this page waiting for
    // the sender or recipient to act, so keep the checklist fresh.
    const interval = setInterval(() => { if (isOnline()) fetchJob(); }, 8000);

    return () => { cleanup(); clearInterval(interval); };
  }, [token, fetchJob]);

  if (configError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-nokael-primary">App Not Configured</h1>
          <p className="text-nokael-text-muted text-sm max-w-md mx-auto">
            This app can't reach the Nokael server because it was deployed without valid
            server credentials. Please contact support so this build can be redeployed correctly.
          </p>
        </div>
        <a href="https://wa.me/971509999999" className="nokael-button bg-[#059669] gap-2 flex items-center">
          <MessageSquare className="w-5 h-5" />WhatsApp Nokael Dispatch
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 text-nokael-primary animate-spin" />
        <p className="text-nokael-text-muted text-sm font-medium">Loading your job...</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-slate-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-nokael-primary">Unable to Load Job</h1>
          <p className="text-nokael-text-muted text-sm max-w-md mx-auto">{error || 'This link is not valid or has expired.'}</p>
        </div>
        <a href="https://wa.me/971509999999" className="text-nokael-accent font-bold text-sm underline underline-offset-4">Contact Nokael Dispatch</a>
      </div>
    );
  }

  const pickupConfig = STEP_CONFIG['driver-pickup'];
  const deliveryConfig = STEP_CONFIG['driver-delivery'];

  const pickupDone = job[pickupConfig.at_field] !== null;
  const senderReady = job[pickupConfig.partner_at_field] !== null;
  const deliveryDone = job[deliveryConfig.at_field] !== null;

  const pickupStatus: CardStatus = pickupDone ? 'done' : senderReady ? 'ready' : 'waiting';
  const deliveryStatus: CardStatus = deliveryDone ? 'done' : !pickupDone ? 'locked' : 'ready';

  const jobComplete = job.status === 'completed';

  const goToPickup = () => {
    if (!job.token_driver_pickup) return;
    navigate(`/${job.token_driver_pickup}/driver-pickup`);
  };
  const goToDelivery = () => {
    if (deliveryStatus === 'locked' || !job.token_driver_delivery) return;
    navigate(`/${job.token_driver_delivery}/driver-delivery`);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8 min-h-screen flex flex-col">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/nokael-logo.jpg" alt="Nokael" className="h-7 sm:h-8 rounded-md border border-slate-800" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <span className="text-xl sm:text-2xl font-[900] tracking-tighter text-nokael-primary uppercase italic">NOKAEL</span>
        </div>
        <div className="flex items-center gap-2">
          {!online && <WifiOff className="w-4 h-4 text-amber-500" />}
          <div className="flex items-center gap-1.5 px-3 py-1 bg-nokael-primary/10 rounded-full border border-nokael-primary/10">
            <div className="w-1.5 h-1.5 bg-nokael-primary rounded-full animate-pulse" />
            <span className="text-[9px] font-black text-nokael-primary tracking-widest uppercase">Live-Link</span>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-8">
        <div className="text-center space-y-2 pt-2">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto shadow-xl">
            <Truck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black text-nokael-primary tracking-tighter uppercase italic">Your Job</h1>
          <p className="text-nokael-text-muted text-sm font-bold uppercase tracking-wider">{job.job_ref}</p>
        </div>

        {jobComplete && (
          <div className="bg-emerald-50 border-2 border-emerald-100 p-6 rounded-3xl flex items-center gap-4 animate-in fade-in duration-700">
            <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="text-emerald-900 font-black text-sm uppercase tracking-tight">Job Complete</h4>
              <p className="text-emerald-700 text-xs font-bold leading-relaxed">Both legs are confirmed. Nothing else needed here.</p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <StepCard
            title="Collection"
            subtitle="Step 1 — Pickup"
            location={job.pickup_location}
            emirate={job.pickup_emirate}
            status={pickupStatus}
            onClick={goToPickup}
          />
          <StepCard
            title="Delivery"
            subtitle="Step 2 — Drop-off"
            location={job.delivery_location}
            emirate={job.delivery_emirate}
            status={deliveryStatus}
            onClick={goToDelivery}
          />
        </div>

        {deliveryStatus === 'locked' && (
          <div className="flex items-center gap-3 px-4 text-nokael-text-muted">
            <Clock className="w-4 h-4 shrink-0" />
            <p className="text-xs font-bold">Delivery unlocks once collection is confirmed.</p>
          </div>
        )}
      </main>

      <footer className="pt-8 mt-8 border-t border-nokael-border pb-12">
        <a href="https://wa.me/971509999999" className="w-full bg-white border-2 border-nokael-border p-6 rounded-[32px] text-nokael-primary font-black no-underline flex items-center justify-center gap-4 hover:bg-slate-50 transition-all">
          <MessageSquare className="w-6 h-6" />
          <span className="text-sm uppercase tracking-wider">Contact Response Team</span>
        </a>
      </footer>
    </div>
  );
}