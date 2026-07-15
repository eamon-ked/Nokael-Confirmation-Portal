import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { DISPATCH_WA_URL } from '@/src/lib/constants';
import { scopeInstallToStartUrl } from '@/src/lib/pwa';

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  Moon,
  Package,
  Sun,
  Copy,
  Share2,
} from 'lucide-react';

// Matches the font stack used on DriverHub so both driver-facing screens feel
// like one app.
const APPLE_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, 'Segoe UI', Roboto, sans-serif";

const SESSION_KEY_PREFIX = 'nokael_driver_session_';

// Shared with DriverHub — lets a job-hub screen show a "My Jobs" link back
// to whichever driver most recently had a valid session on this device,
// without needing a server round trip.
export const ACTIVE_DRIVER_KEY = 'nokael_active_driver_id';

type DriverSessionInfo = {
  full_name: string;
  tier: string | null;
  status: 'offline' | 'available' | 'on_job';
  session_valid: boolean;
};

type ActiveJob = {
  job_ref: string;
  status: string;
  pickup_location: string;
  pickup_emirate: string;
  delivery_location: string;
  delivery_emirate: string;
  item_type: string;
  urgency: string;
  created_at: string;
  hub_token: string;
};

export default function DriverStatusPage() {
  const { driverId } = useParams<{ driverId: string }>();
  const [configError] = useState(!isSupabaseConfigured);

  const [loading, setLoading] = useState(true);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<DriverSessionInfo | null>(null);

  const [pin, setPin] = useState('');
  const [submittingPin, setSubmittingPin] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const loggedIn = Boolean(driverId && localStorage.getItem(SESSION_KEY_PREFIX + driverId));

  const refreshStatus = useCallback(async () => {
    if (!driverId) return;
    try {
      const { data, error: rpcError } = await supabase
        .rpc('get_driver_session_status', { driver_id: driverId })
        .single();

      if (rpcError || !data) {
        setError('Could not find your driver profile. Contact dispatch for a new link.');
        setInfo(null);
        return;
      }

      const result = data as DriverSessionInfo;
      setInfo(result);

      // Server is the source of truth for whether our cached session is
      // still good — if it says no, drop the local flag so the PIN pad shows.
      if (!result.session_valid && driverId) {
        localStorage.removeItem(SESSION_KEY_PREFIX + driverId);
      }
      if (result.session_valid && driverId) {
        localStorage.setItem(ACTIVE_DRIVER_KEY, driverId);
        // So "Add to Home Screen" from here relaunches straight back into
        // this driver's own status page instead of the generic root.
        scopeInstallToStartUrl(`/driver/${driverId}/status`, `Nokael — ${result.full_name.split(' ')[0]}`);
      }
      setError(null);
    } catch (err) {
      setError('Something went wrong loading your status. Please try again.');
    } finally {
      setLoading(false);
      setCheckingSession(false);
    }
  }, [driverId]);

  const fetchJobs = useCallback(async () => {
    if (!driverId) return;
    setJobsLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_driver_active_jobs_session', {
        p_driver_id: driverId,
      });
      if (!rpcError && data) {
        setJobs(data as ActiveJob[]);
      }
    } catch {
      // Non-fatal — the status toggle still works even if the job list fails to load.
    } finally {
      setJobsLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (info?.session_valid) {
      fetchJobs();
      const interval = setInterval(fetchJobs, 15000);
      return () => clearInterval(interval);
    }
  }, [info?.session_valid, fetchJobs]);

  const handlePinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!driverId || pin.length < 4) return;
    setSubmittingPin(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('create_driver_session', {
        driver_id: driverId,
        pin,
      });
      if (rpcError) {
        setError(rpcError.message.includes('Incorrect') ? 'Incorrect PIN. Try again.' : 'Login failed. Please try again.');
        return;
      }
      localStorage.setItem(SESSION_KEY_PREFIX + driverId, '1');
      setPin('');
      await refreshStatus();
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setSubmittingPin(false);
    }
  };

  const toggleStatus = async () => {
    if (!driverId || !info || info.status === 'on_job') return;
    const nextStatus = info.status === 'available' ? 'offline' : 'available';
    setTogglingStatus(true);
    try {
      const { error: rpcError } = await supabase.rpc('update_driver_status_session', {
        driver_id: driverId,
        new_status: nextStatus,
      });
      if (rpcError) {
        if (rpcError.message.includes('expired')) {
          localStorage.removeItem(SESSION_KEY_PREFIX + driverId);
        }
        setError(rpcError.message || 'Could not update status.');
        await refreshStatus();
        return;
      }
      setInfo(prev => (prev ? { ...prev, status: nextStatus } : prev));
    } catch (err) {
      setError('Could not update status. Please try again.');
    } finally {
      setTogglingStatus(false);
    }
  };

  if (configError) {
    return (
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="flex flex-col items-center justify-center min-h-[100dvh] gap-6 text-center px-6">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="text-nokael-text-muted text-[14px] max-w-md mx-auto">App not configured. Contact dispatch.</p>
      </div>
    );
  }

  if (!driverId) {
    return (
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="flex flex-col items-center justify-center min-h-[100dvh] gap-6 text-center px-6">
        <AlertCircle className="w-8 h-8 text-slate-400" />
        <p className="text-nokael-text-muted text-[14px] max-w-md mx-auto">Missing driver link. Use the link dispatch sent you on WhatsApp.</p>
      </div>
    );
  }

  if (loading || checkingSession) {
    return (
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="flex flex-col items-center justify-center min-h-[100dvh] gap-4">
        <Loader2 className="w-7 h-7 text-nokael-primary animate-spin" />
      </div>
    );
  }

  // --- PIN entry screen ---
  if (!info?.session_valid || !loggedIn) {
    return (
      <div style={{ fontFamily: APPLE_FONT_STACK }} className="max-w-sm mx-auto px-6 py-10 min-h-[100dvh] flex flex-col justify-center gap-8">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-[22px] font-semibold text-nokael-primary tracking-tight">Driver Status</h1>
          <p className="text-nokael-text-muted text-[14px]">{info?.full_name ? `Welcome back, ${info.full_name.split(' ')[0]}` : 'Enter your PIN to continue'}</p>
        </div>

        <form onSubmit={handlePinSubmit} className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN"
            className="w-full text-center text-[24px] tracking-[0.5em] font-semibold py-4 rounded-2xl border border-nokael-border focus:outline-none focus:border-nokael-primary"
          />
          {error && <p className="text-red-500 text-[13px] text-center">{error}</p>}
          <button
            type="submit"
            disabled={pin.length < 4 || submittingPin}
            className="nokael-button w-full flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {submittingPin ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Log In'}
          </button>
        </form>

        <a href={DISPATCH_WA_URL} className="text-nokael-accent font-medium text-[13px] text-center underline underline-offset-4">
          Don't have a PIN? Contact dispatch
        </a>
      </div>
    );
  }

  // --- Status toggle screen ---
  const isAvailable = info.status === 'available';
  const isOnJob = info.status === 'on_job';

  return (
    <div style={{ fontFamily: APPLE_FONT_STACK }} className="max-w-sm mx-auto px-6 py-10 min-h-[100dvh] flex flex-col gap-8">
      <header className="text-center space-y-1 pt-4">
        <h1 className="text-[20px] font-semibold text-nokael-primary tracking-tight">Hi {info.full_name.split(' ')[0]}</h1>
        {info.tier && <p className="text-nokael-text-muted text-[13px]">Tier {info.tier} Driver</p>}
      </header>



      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {isOnJob ? (
          <div className="text-center space-y-3">
            <div className="w-24 h-24 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
              <Loader2 className="w-9 h-9 text-amber-500" />
            </div>
            <p className="text-nokael-primary font-semibold text-[16px]">You're on a job</p>
            <p className="text-nokael-text-muted text-[13px] max-w-[220px]">Your status will switch back automatically once it's marked complete.</p>
          </div>
        ) : (
          <>
            <button
              onClick={toggleStatus}
              disabled={togglingStatus}
              className={`w-40 h-40 rounded-full flex flex-col items-center justify-center gap-2 shadow-xl transition-all active:scale-95 disabled:opacity-60
                ${isAvailable ? 'bg-emerald-500' : 'bg-slate-300'}`}
            >
              {togglingStatus ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : isAvailable ? (
                <Sun className="w-8 h-8 text-white" />
              ) : (
                <Moon className="w-8 h-8 text-slate-600" />
              )}
              <span className={`text-[15px] font-semibold ${isAvailable ? 'text-white' : 'text-slate-600'}`}>
                {isAvailable ? 'Available' : 'Offline'}
              </span>
            </button>
            <p className="text-nokael-text-muted text-[13px] text-center max-w-[220px]">
              Tap to go {isAvailable ? 'offline' : 'available'}. {isAvailable ? "You'll stop receiving new job pings." : "You'll be visible for new jobs."}
            </p>
          </>
        )}
        {error && <p className="text-red-500 text-[13px] text-center">{error}</p>}
      </div>

      {/* Persistent Portal Link Card for PWA / Bookmark */}
      <div className="nokael-card !p-4 border border-nokael-border space-y-3 bg-white">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase text-nokael-text-muted tracking-wider font-bold">Your Portal Link</span>
          <span className="px-2 py-0.5 bg-slate-900 text-white text-[9px] font-black rounded tracking-widest uppercase">PWA READY</span>
        </div>
        <p className="text-[12px] text-nokael-text-muted leading-relaxed">
          This is your unique driver link. Open this specific link in Chrome or Safari to install the Nokael Driver app to your home screen.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleCopyLink}
            className="flex-1 bg-slate-900 text-white hover:bg-slate-800 font-bold text-[11px] uppercase tracking-wider py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shadow"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
          </button>
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: 'Nokael Driver Portal',
                  url: window.location.href
                }).catch(() => {});
              } else {
                handleCopyLink();
              }
            }}
            className="flex-1 bg-white border border-nokael-border text-nokael-primary hover:bg-slate-50 font-bold text-[11px] uppercase tracking-wider py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shadow-sm"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share</span>
          </button>
        </div>
      </div>

      <div className="space-y-3 pb-4">
        <h2 className="text-[13px] font-semibold text-nokael-text-muted uppercase tracking-wide px-1">
          {jobs.length > 0 ? `Your Jobs (${jobs.length})` : 'Your Jobs'}
        </h2>
        {jobsLoading && jobs.length === 0 && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-nokael-primary animate-spin" />
          </div>
        )}
        {!jobsLoading && jobs.length === 0 && (
          <p className="text-nokael-text-muted text-[13px] px-1">No active jobs right now.</p>
        )}
        {jobs.map((job) => (
          <Link
            key={job.job_ref}
            to={`/${job.hub_token}/driver-hub`}
            className="nokael-card !p-4 flex items-center gap-3 no-underline hover:bg-slate-50 transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[12px] font-medium text-nokael-primary/50">{job.job_ref}</span>
                {job.urgency === 'immediate' && (
                  <span className="text-[10px] font-semibold text-red-500 uppercase">Urgent</span>
                )}
              </div>
              <p className="text-[14px] font-medium text-nokael-primary truncate">
                {job.pickup_location} → {job.delivery_location}
              </p>
              <p className="text-[12px] text-nokael-text-muted flex items-center gap-1">
                <Clock className="w-3 h-3" /> {job.status.replace('_', ' ')}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-nokael-primary/25 shrink-0" />
          </Link>
        ))}
      </div>

      <footer className="pb-6">
        <a href={DISPATCH_WA_URL} className="w-full bg-white border border-nokael-border p-4 rounded-2xl text-nokael-primary font-medium no-underline flex items-center justify-center gap-3 hover:bg-slate-50 transition-all">
          <MessageSquare className="w-5 h-5" />
          <span className="text-[14px]">Contact Dispatch</span>
        </a>
      </footer>
    </div>
  );
}
