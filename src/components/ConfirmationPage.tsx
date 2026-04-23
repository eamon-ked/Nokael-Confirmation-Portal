import { useState, useEffect, Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/src/lib/supabase';
import { formatUAETime, isWhatsAppBrowser } from '@/src/lib/utils';
import { Job, Step, STEP_CONFIG, VALID_STEPS } from '@/src/types';
import { AlertCircle, CheckCircle2, Clock, MessageSquare, Loader2, QrCode, Key, Users, History, Lock, Eye, EyeOff, WifiOff, Wifi, CloudOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  cacheJobData, 
  getCachedJob, 
  verifyOtpOffline, 
  queueConfirmation, 
  isOnline,
  setupConnectivityListeners 
} from '@/src/lib/offline';
import { syncPendingConfirmations, startAutoSync, stopAutoSync } from '@/src/lib/sync';
import { cacheCurrentPage } from '@/src/lib/serviceWorker';

// Lazy load Framer Motion
const MotionDiv = lazy(() => import('motion/react').then(mod => ({ default: mod.motion.div })));

export default function ConfirmationPage() {
  const { token, step: stepParam } = useParams<{ token: string; step: string }>();
  const step = stepParam as Step;

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partnerOtp, setPartnerOtp] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showMyOtp, setShowMyOtp] = useState(false);
  const [otpRevealTimer, setOtpRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [online, setOnline] = useState(isOnline());
  const [pendingSync, setPendingSync] = useState(false);
  const [offlineVerified, setOfflineVerified] = useState(false);

  // Auto-hide OTP after 10 seconds for security
  function handleRevealOtp() {
    if (otpRevealTimer) clearTimeout(otpRevealTimer);
    setShowMyOtp(true);
    const timer = setTimeout(() => setShowMyOtp(false), 10000);
    setOtpRevealTimer(timer);
  }

  const isValidStep = VALID_STEPS.includes(step);
  const stepIndex = VALID_STEPS.indexOf(step) + 1;

  useEffect(() => {
    if (!isValidStep || !token) {
      setLoading(false);
      return;
    }
    fetchJob();

    // Setup connectivity listeners
    const cleanup = setupConnectivityListeners(
      () => {
        setOnline(true);
        syncPendingConfirmations().then(() => fetchJob());
      },
      () => setOnline(false)
    );

    // Start auto-sync
    startAutoSync();

    const channel = supabase
      .channel('job-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, () => {
        fetchJob();
      })
      .subscribe();

    return () => { 
      channel.unsubscribe(); 
      cleanup();
      stopAutoSync();
    };
  }, [token, step]);

  async function fetchJob() {
    try {
      setLoading(true);
      setError(null);
      
      const config = STEP_CONFIG[step];

      // Try online fetch first
      if (isOnline()) {
        const { data, error: supabaseError } = await supabase
          .from('jobs')
          .select(`
            job_ref, pickup_emirate, pickup_location, delivery_emirate, delivery_location, 
            item_type, status, sender_name, recipient_name,
            client_pickup_at, driver_pickup_at, driver_delivery_at, client_delivery_at,
            ${config.my_otp_field}, otp_sender, otp_driver_pickup, otp_driver_delivery, otp_recipient
          `)
          .eq(config.token_field, token)
          .single();

        if (supabaseError || !data) {
          // Try cached data as fallback
          const cached = await getCachedJob(token!);
          if (cached) {
            setJob(cached.job_data as Job);
            setPendingSync(true);
          } else {
            setError('This link is not valid or has expired.');
          }
        } else {
          setJob(data as Job);
          
          // Cache job data for offline use
          const partnerOtpField = getPartnerOtpField(step);
          const partnerOtp = data[partnerOtpField] as string;
          const myOtp = data[config.my_otp_field] as string;
          
          await cacheJobData(token!, step, data, partnerOtp, myOtp);
          
          // Also cache the page itself for offline loading
          cacheCurrentPage().catch(err => console.warn('Page caching failed:', err));
        }
      } else {
        // Offline - use cached data
        const cached = await getCachedJob(token!);
        if (cached) {
          setJob(cached.job_data as Job);
          setPendingSync(true);
        } else {
          setError('No internet connection and no cached data available.');
        }
      }
    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again or contact Nokael dispatch.');
    } finally {
      setLoading(false);
    }
  }

  function getPartnerOtpField(step: Step): keyof Job {
    const mapping: Record<Step, keyof Job> = {
      'client-pickup': 'otp_driver_pickup',
      'driver-pickup': 'otp_sender',
      'driver-delivery': 'otp_recipient',
      'client-delivery': 'otp_driver_delivery',
    };
    return mapping[step];
  }

  async function handleConfirm() {
    if (confirming || partnerOtp.length !== 6) return;
    setConfirming(true);
    setError(null);

    try {
      const position = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => resolve(null),
          { timeout: 5000, enableHighAccuracy: true }
        );
      });

      const lat = position?.coords.latitude ?? null;
      const lng = position?.coords.longitude ?? null;

      if (isOnline()) {
        // Online - verify with server
        const { data, error: rpcError } = await supabase.rpc('confirm_job_step', {
          p_token: token,
          p_step: config.rpc_step,
          p_otp: partnerOtp,
          p_lat: lat,
          p_lng: lng
        });

        if (rpcError) {
          throw rpcError;
        }

        if (data?.error) {
          if (data.error === 'invalid_otp') {
            setError(`Incorrect code. ${data.attempts_left} attempts remaining.`);
            setAttemptsLeft(data.attempts_left);
            setPartnerOtp('');
          } else if (data.error === 'max_attempts_reached') {
            setIsLocked(true);
            setError('Too many incorrect attempts. Please contact Nokael dispatch.');
          } else {
            setError(data.error);
          }
        } else {
          await fetchJob();
        }
      } else {
        // Offline - verify locally and queue for sync
        const verification = await verifyOtpOffline(token!, partnerOtp);

        if (!verification.valid) {
          if (verification.error === 'no_cached_data') {
            setError('Cannot verify offline - no cached data. Connect to internet first.');
          } else {
            setError('Incorrect code. Please try again.');
            setPartnerOtp('');
          }
        } else {
          // Valid OTP - queue for sync
          await queueConfirmation(token!, config.rpc_step, partnerOtp, lat, lng);
          setOfflineVerified(true);
          setPendingSync(true);
          setPartnerOtp('');
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to confirm. Please check your connection.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 text-nokael-primary animate-spin" />
        <p className="text-nokael-text-muted text-sm font-medium">Verifying security context...</p>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8 text-center px-6">
        <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center shadow-inner">
          <Lock className="w-10 h-10 text-red-500" />
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-black text-nokael-primary uppercase tracking-tighter italic">SECURITY LOCKOUT</h1>
          <p className="text-nokael-text-muted text-sm leading-relaxed max-w-[300px]">Too many incorrect secure code attempts. For safety, this job has been locked. Please contact our operations team to verify and reset.</p>
        </div>
        <div className="flex flex-col w-full gap-3">
          <a href="https://wa.me/971509999999" className="nokael-button bg-[#059669] gap-2">
            <MessageSquare className="w-5 h-5" />
            WhatsApp Nokael Dispatch
          </a>
        </div>
      </div>
    );
  }

  if (!isValidStep || error?.includes('not valid')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-slate-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-nokael-primary">Invalid Link</h1>
          <p className="text-nokael-text-muted text-sm">This link is not valid or has expired.</p>
        </div>
        <a href="https://wa.me/971509999999" className="text-nokael-accent font-bold text-sm underline underline-offset-4">Contact Nokael Dispatch</a>
      </div>
    );
  }

  const config = STEP_CONFIG[step];
  const isConfirmed = job && job[config.at_field] !== null;
  const isPartnerConfirmed = job && job[config.partner_at_field] !== null;
  const isHandoverComplete = isConfirmed && isPartnerConfirmed;
  
  const statusRank: Record<string, number> = { 'pending': 0, 'client_pickup': 1, 'driver_pickup': 2, 'driver_delivery': 3, 'completed': 4 };

  let state: 'invalid' | 'confirmed' | 'not_yet' | 'ready' | 'waiting_partner' = 'ready';
  if (!job) state = 'invalid';
  else if (isHandoverComplete) state = 'confirmed';
  else if (isConfirmed && !isPartnerConfirmed) state = 'waiting_partner';
  else {
    if (statusRank[job.status] < statusRank[config.prerequisite_status]) state = 'not_yet';
    else state = 'ready';
  }

  const myOtp = job ? (job[config.my_otp_field] as string) : '';

  return (
    <div className="max-w-md mx-auto px-6 py-10 space-y-8">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <img src="/nokael-logo.svg" alt="Nokael" className="h-6" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <span className="text-lg font-[850] tracking-tighter text-nokael-primary uppercase italic">NOKAEL</span>
        </div>
        <div className="flex items-center gap-2">
          {!online && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 rounded-full">
              <WifiOff className="w-3 h-3 text-amber-600" />
              <span className="text-[9px] font-black text-amber-600 tracking-widest uppercase">Offline</span>
            </div>
          )}
          {pendingSync && online && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 rounded-full">
              <CloudOff className="w-3 h-3 text-blue-600 animate-pulse" />
              <span className="text-[9px] font-black text-blue-600 tracking-widest uppercase">Syncing...</span>
            </div>
          )}
          {!isConfirmed && online && !pendingSync && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-nokael-success/10 rounded-full">
               <div className="w-1.5 h-1.5 bg-nokael-success rounded-full animate-pulse" />
               <span className="text-[9px] font-black text-nokael-success tracking-widest uppercase">Live Session</span>
            </div>
          )}
        </div>
      </header>

      {offlineVerified && !online ? (
        <div className="nokael-card text-center space-y-6 !p-8 border-amber-500/20 bg-amber-500/[0.02]">
          <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto">
            <CloudOff className="w-8 h-8 text-amber-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-nokael-primary">Verified Offline</h2>
            <p className="text-nokael-text-muted text-sm px-4">
              OTP verified successfully. This confirmation will sync to the server when you reconnect to the internet.
            </p>
          </div>
          <div className="pt-4 border-t border-nokael-border">
            <div className="info-label">Status</div>
            <div className="text-xs font-bold text-amber-600 flex items-center justify-center gap-2">
              <WifiOff className="w-4 h-4" />
              Pending Sync
            </div>
          </div>
        </div>
      ) : state === 'confirmed' ? (
        <Suspense fallback={null}>
          <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="nokael-card text-center space-y-6 !p-8 border-nokael-success/20 bg-nokael-success/[0.02]">
            <div className="w-16 h-16 bg-nokael-success/10 rounded-full flex items-center justify-center mx-auto"><CheckCircle2 className="w-8 h-8 text-nokael-success" /></div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-nokael-primary">Verified & Logged</h2>
              <p className="text-nokael-text-muted text-sm px-4">The handover is successful. Both digital signatures match.</p>
            </div>
            <div className="pt-6 border-t border-nokael-border">
              <div className="info-label">Verification Time (UAE)</div>
              <div className="text-xs font-bold text-nokael-text-main">{formatUAETime(job && (job[config.at_field] as string))}</div>
            </div>
          </MotionDiv>
        </Suspense>
      ) : state === 'waiting_partner' ? (
        <div className="space-y-6">
          <div className="nokael-card text-center space-y-4 border-nokael-accent/20 bg-nokael-accent/[0.02]">
            <History className="w-12 h-12 text-nokael-accent mx-auto animate-[spin_3s_linear_infinite]" />
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-nokael-primary tracking-tight">Syncing Handover...</h3>
              <p className="text-sm text-nokael-text-muted px-6">You've confirmed. Waiting for the <span className="font-bold text-nokael-accent uppercase">{config.partner_role}</span> to enter your code on their device.</p>
            </div>
          </div>

          <section className="space-y-6">
             <div className="nokael-card !bg-white space-y-4">
                <div className="text-center space-y-1">
                   <p className="info-label">Your Secure Code</p>
                   <button
                     onClick={handleRevealOtp}
                     className="w-full relative flex items-center justify-center py-5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 transition-all active:scale-[0.98]"
                   >
                     {showMyOtp ? (
                       <span className="text-4xl font-black font-mono tracking-[0.2em] text-nokael-primary select-all">{myOtp}</span>
                     ) : (
                       <div className="flex items-center gap-2 text-nokael-text-muted">
                         <Eye className="w-4 h-4" />
                         <span className="text-[11px] font-black uppercase tracking-widest">Tap to reveal</span>
                       </div>
                     )}
                   </button>
                   <p className="text-[10px] text-nokael-text-muted font-bold pt-2">
                     {showMyOtp ? '⚠ Hides in 10s — share verbally only' : 'Read this aloud to the ' + config.partner_role + ' only'}
                   </p>
                </div>
             </div>

             <button onClick={() => setShowQr(!showQr)} className="w-full flex items-center justify-center gap-3 p-4 bg-white border border-nokael-border rounded-xl text-[11px] font-extrabold uppercase tracking-widest text-nokael-text-muted transition-colors active:bg-slate-50">
                <QrCode className="w-4 h-4" />
                {showQr ? 'Hide QR Code' : 'Show Partner QR'}
             </button>

             {showQr && <div className="p-6 bg-white border border-nokael-border rounded-2xl flex justify-center shadow-xl mx-auto w-fit"><QRCodeSVG value={window.location.href} size={160} /></div>}
          </section>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-4">
             <div className="flex justify-between items-center">
               <div className="step-pill !bg-slate-100 !text-slate-600">Phase {stepIndex} of 4</div>
             </div>
            <h1 className="text-3xl font-black text-nokael-primary leading-none tracking-tighter uppercase italic">Secure Verification</h1>
            <p className="text-sm text-nokael-text-muted line-clamp-2 leading-relaxed font-medium">Verify the physical handover with the {config.partner_role} to continue the chain of custody.</p>
          </div>

          {state === 'not_yet' ? (
            <div className="space-y-4">
              <div className="bg-slate-100/50 border border-nokael-border rounded-2xl p-6 flex flex-col items-center gap-3 text-center">
                <Clock className="w-7 h-7 text-slate-300" />
                <p className="text-sm text-nokael-text-muted leading-relaxed font-medium px-4">{config.not_yet_message}</p>
              </div>
              {/* Show own OTP even in not_yet so partner can pre-share their code */}
              <div className="nokael-card !p-5 space-y-3">
                <p className="info-label !mb-0">Your Code — Share with {config.partner_role}</p>
                <button
                  onClick={handleRevealOtp}
                  className="w-full flex items-center justify-center h-12 rounded-xl border-2 border-dashed border-nokael-border bg-slate-50 transition-all active:scale-[0.98]"
                >
                  {showMyOtp ? (
                    <span className="text-2xl font-black font-mono tracking-[0.3em] text-nokael-primary select-all">{myOtp}</span>
                  ) : (
                    <div className="flex items-center gap-2 text-nokael-text-muted">
                      <Eye className="w-4 h-4" />
                      <span className="text-[11px] font-black uppercase tracking-widest">Tap to reveal</span>
                    </div>
                  )}
                </button>
                <p className="text-[10px] text-nokael-text-muted font-bold">
                  {showMyOtp ? '⚠ Hides in 10s — share verbally only' : 'The ' + config.partner_role + ' will enter this on their device'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* OTP Input Section */}
              <div className="space-y-4">
                <div className="info-label text-center">
                  Enter {config.partner_role}'s Code
                  {!online && <span className="ml-2 text-amber-600">(Offline Mode)</span>}
                </div>
                <div className="relative">
                  <input 
                    type="text" 
                    inputMode="numeric"
                    placeholder="      "
                    className={`w-full h-20 bg-white border-2 rounded-2xl text-3xl font-black font-mono tracking-[0.5em] text-center focus:ring-4 transition-all outline-none 
                      ${error?.includes('Incorrect') ? 'border-red-200 focus:ring-red-50 bg-red-50/10' : 'border-nokael-border focus:ring-slate-100 focus:border-nokael-primary shadow-sm'}`}
                    value={partnerOtp}
                    onChange={(e) => {
                      setPartnerOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                      setError('');
                    }}
                    autoFocus
                  />
                  <div className="absolute -bottom-2 -right-1">
                    {partnerOtp.length === 6 && <div className="w-3 h-3 bg-nokael-accent rounded-full animate-ping" />}
                  </div>
                </div>
                
                {error && (
                  <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-red-500 uppercase tracking-wider">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {error}
                  </div>
                )}
              </div>

              {/* Action Section */}
              <div className="space-y-4">
                <button
                  className="nokael-button h-16 text-lg font-black uppercase tracking-widest shadow-lg shadow-nokael-primary/10"
                  onClick={handleConfirm}
                  disabled={confirming || partnerOtp.length !== 6}
                >
                  {confirming ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <span className="flex items-center gap-2">
                      {!online && <WifiOff className="w-5 h-5" />}
                      {config.button_text}
                    </span>
                  )}
                </button>

                {!online && (
                  <div className="text-center text-xs text-amber-600 font-bold bg-amber-50 p-3 rounded-lg border border-amber-200">
                    ⚠️ Offline mode: Verification will sync when connection returns
                  </div>
                )}

                <div className="nokael-card !p-5 !bg-nokael-accent/[0.03] border-nokael-accent/10 space-y-4">
                   <div className="flex items-center justify-between">
                      <span className="info-label !mb-0">Share Code with {config.partner_role}</span>
                      <div className="px-2 py-0.5 bg-nokael-accent/10 rounded text-[9px] font-black text-nokael-accent uppercase tracking-widest leading-none">Private</div>
                   </div>
                   <button
                     onClick={handleRevealOtp}
                     className="w-full relative flex items-center justify-center h-14 rounded-xl border-2 border-dashed border-nokael-border bg-slate-50 transition-all active:scale-[0.98]"
                   >
                     {showMyOtp ? (
                       <span className="text-3xl font-black font-mono tracking-[0.3em] text-nokael-primary select-all">{myOtp}</span>
                     ) : (
                       <div className="flex items-center gap-2 text-nokael-text-muted">
                         <Eye className="w-4 h-4" />
                         <span className="text-[11px] font-black uppercase tracking-widest">Tap to reveal</span>
                       </div>
                     )}
                   </button>
                   <p className="text-[10px] text-nokael-text-muted font-bold">
                     {showMyOtp ? '⚠ Code visible — hides automatically in 10s' : 'Read this aloud to the ' + config.partner_role + ' only'}
                   </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="pt-8 text-center space-y-6">
        <div className="flex items-center justify-center gap-4 text-[10px] font-black text-nokael-text-muted/40 uppercase tracking-widest">
           <div className="h-px w-8 bg-slate-200" />
           <span>Ref: {job?.job_ref}</span>
           <div className="h-px w-8 bg-slate-200" />
        </div>
        <div className="whatsapp-support">
          <a href="https://wa.me/971509999999" className="text-[#059669] text-xs font-black no-underline inline-flex items-center gap-2 opacity-100 hover:scale-105 transition-all">
            <div className="w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center shadow-lg"><MessageSquare className="w-4 h-4 text-white fill-white" /></div>
            Incident Response? WhatsApp Dispatch
          </a>
        </div>
      </footer>
    </div>
  );
}
