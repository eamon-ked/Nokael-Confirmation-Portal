import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { cacheJobData, getCachedJob, isOnline, checkServerReachable, setupConnectivityListeners } from '@/src/lib/offline';
import { Job, STEP_CONFIG } from '@/src/types';
import { DISPATCH_WA_URL } from '@/src/lib/constants';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  Package,
  Truck,
  WifiOff,
} from 'lucide-react';

// Apple system font stack — resolves to San Francisco on Apple devices,
// falls back to the platform default everywhere else. Scoped to this page
// only (not the shared theme) since only the hub's type scale is changing.
const APPLE_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, 'Segoe UI', Roboto, sans-serif";

const HUB_CACHE_STEP = 'driver-hub';

type CardStatus = 'locked' | 'waiting' | 'ready' | 'done';

function StatusPill({ status }: { status: CardStatus }) {
  const map: Record<CardStatus, { label: string; className: string }> = {
    locked: { label: 'Locked', className: 'bg-slate-100 text-slate-400' },
    waiting: { label: 'Waiting', className: 'bg-amber-50 text-amber-600' },
    ready: { label: 'Ready', className: 'bg-nokael-accent-light text-nokael-accent' },
    done: { label: 'Done', className: 'bg-emerald-50 text-emerald-600' },
  };
  const cfg = map[status];
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[12px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// Apple-style segmented control — a quick way to jump between the two
// steps without scrolling to find the right card. Mirrors iOS's
// UISegmentedControl: a rounded pill track, a raised white segment for
// the option you can act on, muted/disabled styling for a locked one.
function StepSegmentedControl({
  pickupStatus,
  deliveryStatus,
  onSelectPickup,
  onSelectDelivery,
}: {
  pickupStatus: CardStatus;
  deliveryStatus: CardStatus;
  onSelectPickup: () => void;
  onSelectDelivery: () => void;
}) {
  const segmentBase =
    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[10px] text-[13px] font-medium transition-all active:scale-[0.98]';

  return (
    <div className="flex p-1 bg-slate-100 rounded-[14px] gap-1" role="tablist" aria-label="Navigate between collection and delivery">
      <button
        role="tab"
        onClick={onSelectPickup}
        className={`${segmentBase} bg-white text-nokael-primary shadow-sm`}
      >
        {pickupStatus === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
        Collection
      </button>
      <button
        role="tab"
        onClick={onSelectDelivery}
        disabled={deliveryStatus === 'locked'}
        className={`${segmentBase} ${
          deliveryStatus === 'locked'
            ? 'text-slate-300 cursor-not-allowed'
            : 'text-slate-500 hover:text-nokael-primary'
        }`}
      >
        {deliveryStatus === 'locked' && <Lock className="w-3 h-3" />}
        {deliveryStatus === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
        Delivery
      </button>
    </div>
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
      className={`w-full text-left nokael-card !p-5 flex items-center gap-4 transition-all active:scale-[0.98]
        ${locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}
        ${status === 'done' ? 'border-emerald-100 bg-emerald-50/30' : 'border-nokael-border'}`}
    >
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0
        ${status === 'done' ? 'bg-emerald-500' : locked ? 'bg-slate-200' : 'bg-slate-900'}`}
      >
        {locked ? (
          <Lock className="w-[18px] h-[18px] text-slate-400" />
        ) : status === 'done' ? (
          <CheckCircle2 className="w-5 h-5 text-white" />
        ) : (
          <Package className="w-5 h-5 text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-medium text-nokael-primary/50">{subtitle}</span>
          <StatusPill status={status} />
        </div>
        <h3 className="text-[17px] font-semibold text-nokael-primary tracking-tight leading-snug">{title}</h3>
        <p className="text-[14px] text-nokael-text-muted truncate">{location}, {emirate}</p>
      </div>
      {!locked && <ChevronRight className="w-4 h-4 text-nokael-primary/25 shrink-0" />}
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
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <div className="space-y-2">
          <h1 className="text-[20px] font-semibold text-nokael-primary">App Not Configured</h1>
          <p className="text-nokael-text-muted text-[14px] max-w-md mx-auto">
            This app can't reach the Nokael server because it was deployed without valid
            server credentials. Please contact support so this build can be redeployed correctly.
          </p>
        </div>
        <a href={DISPATCH_WA_URL} className="nokael-button bg-[#059669] gap-2 flex items-center">
          <MessageSquare className="w-5 h-5" />WhatsApp Nokael Dispatch
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-7 h-7 text-nokael-primary animate-spin" />
        <p className="text-nokael-text-muted text-[14px] font-medium">Loading your job...</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-slate-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-[20px] font-semibold text-nokael-primary">Unable to Load Job</h1>
          <p className="text-nokael-text-muted text-[14px] max-w-md mx-auto">{error || 'This link is not valid or has expired.'}</p>
        </div>
        <a href={DISPATCH_WA_URL} className="text-nokael-accent font-medium text-[14px] underline underline-offset-4">Contact Nokael Dispatch</a>
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

  const cachedDriverId = localStorage.getItem('nokael_active_driver_id');

  return (
    <div style={{ fontFamily: APPLE_FONT_STACK }} className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6 min-h-screen flex flex-col">
      <header className="flex items-center justify-between">
        {cachedDriverId ? (
          <Link
            to={`/driver/${cachedDriverId}/status`}
            className="flex items-center gap-1.5 text-nokael-primary/60 hover:text-nokael-primary transition-all font-medium text-[13px] bg-white px-3 py-1.5 rounded-full border border-nokael-border shadow-sm"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>My Jobs</span>
          </Link>
        ) : (
          <div className="flex items-center gap-2.5">
            <img src="/nokael-logo.jpg" alt="Nokael" className="h-6 sm:h-7 rounded-md border border-slate-800" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <span className="text-[15px] font-semibold tracking-tight text-nokael-primary">Nokael</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!online && <WifiOff className="w-3.5 h-3.5 text-amber-500" />}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-nokael-primary/10 rounded-full">
            <div className="w-1.5 h-1.5 bg-nokael-primary rounded-full animate-pulse" />
            <span className="text-[11px] font-medium text-nokael-primary">Live</span>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-6">
        {/* Quick-jump navigation between Collection and Delivery */}
        <StepSegmentedControl
          pickupStatus={pickupStatus}
          deliveryStatus={deliveryStatus}
          onSelectPickup={goToPickup}
          onSelectDelivery={goToDelivery}
        />

        <div className="text-center space-y-1 pt-1">
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <h1
            style={{ fontSize: 'clamp(1.25rem, 5.5vw, 1.625rem)' }}
            className="font-semibold text-nokael-primary tracking-tight"
          >
            Your Job
          </h1>
          <p className="text-nokael-text-muted text-[13px] font-medium">{job.job_ref}</p>
        </div>

        {jobComplete && (
          <div className="bg-emerald-50 p-5 rounded-2xl flex items-center gap-3.5 animate-in fade-in duration-700">
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h4 className="text-emerald-900 font-semibold text-[14px]">Job Complete</h4>
              <p className="text-emerald-700 text-[13px]">Both legs are confirmed. Nothing else needed here.</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <StepCard
            title="Collection"
            subtitle="Step 1 · Pickup"
            location={job.pickup_location}
            emirate={job.pickup_emirate}
            status={pickupStatus}
            onClick={goToPickup}
          />
          <StepCard
            title="Delivery"
            subtitle="Step 2 · Drop-off"
            location={job.delivery_location}
            emirate={job.delivery_emirate}
            status={deliveryStatus}
            onClick={goToDelivery}
          />
        </div>

        {deliveryStatus === 'locked' && (
          <div className="flex items-center gap-2.5 px-3 text-nokael-text-muted">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <p className="text-[13px]">Delivery unlocks once collection is confirmed.</p>
          </div>
        )}
      </main>

      <footer className="pt-6 mt-6 border-t border-nokael-border pb-10">
        <a href={DISPATCH_WA_URL} className="w-full bg-white border border-nokael-border p-4 rounded-2xl text-nokael-primary font-medium no-underline flex items-center justify-center gap-3 hover:bg-slate-50 transition-all">
          <MessageSquare className="w-5 h-5" />
          <span className="text-[14px]">Contact Response Team</span>
        </a>
      </footer>
    </div>
  );
}