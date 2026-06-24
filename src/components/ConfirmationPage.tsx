import { useState, useEffect, Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/src/lib/supabase';
import { formatUAETime, isWhatsAppBrowser } from '@/src/lib/utils';
import { Job, Step, STEP_CONFIG, VALID_STEPS } from '@/src/types';
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  MessageSquare, 
  Loader2, 
  QrCode, 
  Key, 
  Users, 
  History, 
  Lock, 
  Eye, 
  EyeOff, 
  WifiOff, 
  Wifi, 
  CloudOff, 
  MapPin, 
  Package,
  Navigation,
  Phone,
  ShieldCheck,
  ChevronRight,
  Info
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor, registerPlugin } from '@capacitor/core';
const BackgroundGeolocation = registerPlugin<any>('BackgroundGeolocation');
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
import DriverMap from './DriverMap';

// Lazy load Framer Motion
const MotionDiv = lazy(() => import('motion/react').then(mod => ({ default: mod.motion.div })));

// Helper to calculate distance in meters
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
          Math.cos(phi1) * Math.cos(phi2) *
          Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

interface ViewProps {
  job: Job;
  step: Step;
  config: any;
  online: boolean;
  confirming: boolean;
  partnerOtp: string;
  setPartnerOtp: (val: string) => void;
  handleConfirm: () => void;
  handleReadyUpdate: (field: keyof Job) => void;
  showMyOtp: boolean;
  handleRevealOtp: () => void;
  error: string | null;
  setError: (val: string | null) => void;
  myOtp: string;
}

function SenderView({ job, step, config, online, handleReadyUpdate, handleRevealOtp, showMyOtp, partnerOtp, setPartnerOtp, handleConfirm, error, myOtp, confirming }: ViewProps) {
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="text-center space-y-4 pt-4">
        <h1 className="text-3xl font-black text-nokael-primary tracking-tighter uppercase italic">Authenticate Your Courier</h1>
        <p className="text-nokael-text-muted text-sm font-medium px-4">
          Ask the courier for their 4-digit code and enter it below, or tap to reveal your verification code to read aloud to them.
        </p>
      </div>

      <div className="nokael-card !p-8 border-nokael-accent/20 bg-nokael-accent/[0.02] shadow-2xl relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <ShieldCheck className="w-32 h-32 text-nokael-accent" />
        </div>
        
        <div className="space-y-6 relative z-10">
          <div className="text-center space-y-4">
             <p className="info-label text-nokael-accent !mb-0 font-black tracking-[0.2em]">Your Pickup Confirmation Code</p>
             <button
               onClick={handleRevealOtp}
               className="w-full relative flex items-center justify-center py-8 rounded-3xl border-2 border-dashed border-nokael-accent/30 bg-white shadow-xl shadow-nokael-accent/5 transition-all active:scale-[0.98] group"
             >
               {showMyOtp ? (
                 <span className="text-6xl font-black font-mono tracking-[0.2em] text-nokael-primary select-all drop-shadow-sm">{myOtp}</span>
               ) : (
                 <div className="flex flex-col items-center gap-2 text-nokael-accent">
                   <QrCode className="w-10 h-10 group-hover:scale-110 transition-transform mb-1" />
                   <span className="text-sm font-black uppercase tracking-[0.25em]">Tap to Reveal Signature</span>
                 </div>
               )}
             </button>
             <p className="text-[12px] text-nokael-text-muted font-bold italic">
               {showMyOtp ? '⚠ Hides in 10s — verbal sharing only' : 'Courier needs this code to log the collection'}
             </p>
          </div>
        </div>
      </div>

      <div className="nokael-card !p-6 border-nokael-border bg-white shadow-xl flex items-center gap-4 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-2 bg-nokael-primary/5 rounded-bl-xl">
           <ShieldCheck className="w-4 h-4 text-nokael-primary/20" />
        </div>
        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 shadow-inner overflow-hidden shrink-0 border-2 border-white">
          <img src="https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=100&h=100&fit=crop" alt="Staff" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="info-label !mb-0 leading-none text-nokael-primary/40 uppercase text-[9px] tracking-[0.2em]">Authorized Personnel</p>
          <h3 className="text-lg font-[900] text-nokael-primary uppercase tracking-tight truncate leading-tight mt-1">Official Courier</h3>
          <div className="flex items-center gap-1.5 mt-1.5">
             <span className="px-2 py-0.5 bg-nokael-primary/5 text-nokael-primary text-[8px] font-black rounded border border-nokael-primary/10 tracking-widest uppercase">ID: NOK-B-742</span>
             <span className="px-2 py-0.5 bg-nokael-success text-white text-[8px] font-black rounded tracking-widest uppercase shadow-sm">Verified</span>
          </div>
        </div>
        <a href={`tel:${job.driver_phone || ''}`} className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center text-white hover:bg-nokael-primary transition-all active:scale-95 shadow-lg">
          <Phone className="w-5 h-5 fill-white" />
        </a>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-4 px-2">
           <div className="h-px flex-1 bg-slate-200" />
           <span className="text-[10px] font-black text-nokael-primary/30 uppercase tracking-[0.2em] whitespace-nowrap">Verify Courier Identity Code</span>
           <div className="h-px flex-1 bg-slate-200" />
        </div>
        
        <div className="relative">
          <input 
            type="text" 
            inputMode="numeric"
            placeholder="••••••"
            className={`w-full h-24 bg-white border-2 rounded-[32px] text-4xl font-black font-mono tracking-[0.4em] text-center focus:ring-12 transition-all outline-none shadow-2xl
              ${error ? 'border-red-200 focus:ring-red-50/50 bg-red-50/10' : 'border-nokael-border focus:ring-nokael-primary/5 focus:border-nokael-primary'}`}
            value={partnerOtp}
            onChange={(e) => setPartnerOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          />
        </div>

        {error && (
          <div className="flex items-center justify-center gap-3 p-4 bg-red-50 border border-red-100 rounded-2xl text-[12px] font-black text-red-600 uppercase tracking-widest animate-in shake duration-300">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <button
          className="nokael-button h-20 text-xl font-black uppercase tracking-[0.25em] shadow-[0_20px_40px_-12px_rgba(15,23,42,0.3)] bg-slate-900 text-white rounded-[28px] hover:scale-[1.01] active:scale-[0.99] transition-all"
          onClick={handleConfirm}
          disabled={confirming || partnerOtp.length !== 6}
        >
          {confirming ? <Loader2 className="w-8 h-8 animate-spin" /> : '➔ Dispatch Asset Now'}
        </button>
      </div>

      {!job.sender_ready_at && (
        <button 
          onClick={() => handleReadyUpdate('sender_ready_at')}
          className="w-full flex items-center justify-center gap-3 p-4 bg-nokael-primary/5 hover:bg-nokael-primary/10 text-nokael-primary rounded-2xl text-[11px] font-black uppercase tracking-[0.15em] border border-nokael-primary/10 transition-all"
        >
          <CheckCircle2 className="w-4 h-4" />
          I Have Prepared the Bundle
        </button>
      )}
    </div>
  );
}

function CourierView({ job, step, online, handleReadyUpdate, partnerOtp, setPartnerOtp, handleConfirm, error, confirming, myOtp, showMyOtp, handleRevealOtp }: ViewProps) {
  const isPickup = step === 'driver-pickup';
  
  const handleNavigationLaunch = () => {
    const lat = isPickup ? job.pickup_lat : job.delivery_lat;
    const lng = isPickup ? job.pickup_lng : job.delivery_lng;
    const addr = isPickup ? `${job.pickup_location}, ${job.pickup_emirate}` : `${job.delivery_location}, ${job.delivery_emirate}`;
    
    if (lat && lng) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`, '_blank');
    }
  };

  return (
    <div className="h-full flex flex-col justify-between py-4 animate-in fade-in duration-700">
      <div className="space-y-8">
        <div className="flex justify-between items-center bg-slate-900 text-white px-6 py-4 rounded-[28px] shadow-xl">
           <div>
              <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-widest">Active Task</span>
              <h2 className="text-xl font-black tracking-tight">{isPickup ? 'Collection Protocol' : 'Delivery Workflow'}</h2>
           </div>
           <div className="h-12 w-12 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700">
              <Package className="w-6 h-6 text-slate-300" />
           </div>
        </div>

        <div className="nokael-card shadow-2xl !p-8 space-y-4 border-nokael-border">
          <div>
            <span className="text-[11px] font-black text-nokael-primary/40 uppercase tracking-[0.2em]">{isPickup ? 'Target Pickup' : 'Target Destination'}</span>
            <h1 className="text-3xl font-black text-nokael-primary mt-1 leading-tight tracking-tighter capitalize">
              {isPickup ? job.pickup_location : job.delivery_location}
            </h1>
            <p className="text-sm font-bold text-nokael-text-muted uppercase mt-1 tracking-wider">
               {isPickup ? job.pickup_emirate : job.delivery_emirate}, UAE
            </p>
          </div>

          <button 
            onClick={handleNavigationLaunch}
            className="w-full py-5 bg-slate-900 border-2 border-slate-900 text-white font-black rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-lg"
          >
            <Navigation className="w-6 h-6 fill-white" />
            Launch External Navigation
          </button>
        </div>

        <div className="nokael-card !p-8 border-nokael-accent/20 bg-nokael-accent/[0.02] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <ShieldCheck className="w-32 h-32 text-nokael-accent" />
          </div>
          
          <div className="space-y-6 relative z-10">
            <div className="text-center space-y-4">
               <p className="info-label text-nokael-accent !mb-0 font-black tracking-[0.2em]">Your Courier Security Code</p>
               <button
                 onClick={handleRevealOtp}
                 className="w-full relative flex items-center justify-center py-8 rounded-3xl border-2 border-dashed border-nokael-accent/30 bg-white shadow-xl shadow-nokael-accent/5 transition-all active:scale-[0.98] group"
               >
                 {showMyOtp ? (
                   <span className="text-6xl font-black font-mono tracking-[0.2em] text-nokael-primary select-all drop-shadow-sm">{myOtp}</span>
                 ) : (
                   <div className="flex flex-col items-center gap-2 text-nokael-accent">
                     <QrCode className="w-10 h-10 group-hover:scale-110 transition-transform mb-1" />
                     <span className="text-sm font-black uppercase tracking-[0.25em]">Tap to Reveal Code</span>
                   </div>
                 )}
               </button>
               <p className="text-[12px] text-nokael-text-muted font-bold italic">
                 {showMyOtp ? '⚠ Hides in 10s — verbal sharing only' : 'The client needs this code to verify your credentials'}
               </p>
            </div>
          </div>
        </div>

        {isPickup && job.sender_ready_at && (
          <div className="bg-emerald-50 border-2 border-emerald-100 p-6 rounded-3xl flex items-start gap-4 animate-in slide-in-from-right duration-700">
             <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="w-5 h-5 text-white" />
             </div>
             <div>
                <h4 className="text-emerald-900 font-black text-sm uppercase mb-0.5 tracking-tight">Client Status: Ready</h4>
                <p className="text-emerald-700 text-xs font-bold leading-relaxed px-1">
                   The sender has verified the package is waiting at the desk. Proceed for handover.
                </p>
             </div>
          </div>
        )}

        <div className="space-y-4">
           <div className="flex items-center gap-3 px-4">
              <ShieldCheck className="w-4 h-4 text-nokael-primary/30" />
              <span className="text-[10px] font-black text-nokael-primary/30 uppercase tracking-[0.2em]">Secure Handshake Protocol</span>
           </div>
           
           <div className="relative">
              <input 
                type="text" 
                inputMode="numeric"
                placeholder="••••••"
                className={`w-full h-24 bg-white border-2 rounded-[32px] text-5xl font-black font-mono tracking-[0.4em] text-center focus:ring-12 transition-all outline-none shadow-2xl
                  ${error ? 'border-red-200 focus:ring-red-50/50 bg-red-50/10' : 'border-nokael-border focus:ring-nokael-primary/5 focus:border-nokael-primary'}`}
                value={partnerOtp}
                onChange={(e) => setPartnerOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              />
           </div>

           {error && (
             <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-[12px] font-black text-red-600 uppercase tracking-widest text-center animate-in shake">
               {error}
             </div>
           )}
        </div>
      </div>

      <div className="space-y-4 pt-12">
        <div className="grid grid-cols-2 gap-4">
           <a href={`tel:${isPickup ? job.sender_phone : job.recipient_phone}`} className="h-20 bg-white border-2 border-nokael-border text-nokael-primary font-black rounded-[28px] flex flex-col items-center justify-center hover:bg-slate-50 transition-all active:scale-[0.98]">
              <Phone className="w-6 h-6 mb-1" />
              <span className="text-[10px] uppercase tracking-widest">Call Client</span>
           </a>
           <button 
             onClick={() => handleReadyUpdate(isPickup ? 'driver_arrived_pickup_at' : 'driver_arrived_delivery_at')}
             className={`h-20 font-black rounded-[28px] flex flex-col items-center justify-center transition-all active:scale-[0.98] shadow-lg
               ${(isPickup ? job.driver_arrived_pickup_at : job.driver_arrived_delivery_at) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-nokael-primary border border-slate-200'}`}
           >
              <MapPin className="w-6 h-6 mb-1" />
              <span className="text-[10px] uppercase tracking-widest">{(isPickup ? job.driver_arrived_pickup_at : job.driver_arrived_delivery_at) ? 'Arrived Logged' : 'I Am Here'}</span>
           </button>
        </div>

        <button
          className="nokael-button h-24 text-2xl font-black uppercase tracking-[0.2em] shadow-[0_24px_48px_-12px_rgba(5,150,105,0.4)] bg-emerald-600 text-white rounded-[32px] hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:shadow-none"
          onClick={handleConfirm}
          disabled={confirming || partnerOtp.length !== 6}
        >
          {confirming ? <Loader2 className="w-10 h-10 animate-spin" /> : '➔ Close Protocol Step'}
        </button>
      </div>
    </div>
  );
}

function RecipientView({ job, myOtp, showMyOtp, handleRevealOtp }: ViewProps) {
  const [isDriverClose, setIsDriverClose] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);

  useEffect(() => {
    if (job.driver_lat && job.driver_lng && job.delivery_lat && job.delivery_lng) {
      const d = calculateDistance(job.driver_lat, job.driver_lng, job.delivery_lat, job.delivery_lng);
      setDistance(d);
      if (d < 500) setIsDriverClose(true);
    }
  }, [job.driver_lat, job.driver_lng]);

  const arrivalMinutes = distance ? Math.ceil((distance / 500) * 2) + 2 : null;

  return (
    <div className="space-y-6 h-full animate-in fade-in duration-700 flex flex-col">
       <div className="flex-1 min-h-[500px] relative rounded-[32px] overflow-hidden border border-nokael-border shadow-2xl group">
          <div className="absolute top-6 left-6 z-10 space-y-3">
             <div className="bg-white/95 backdrop-blur px-5 py-3 rounded-2xl border border-nokael-border shadow-xl flex items-center gap-4 animate-in slide-in-from-left duration-500">
                <div className="relative">
                  <div className="w-3 h-3 bg-red-600 rounded-full animate-ping absolute inset-0" />
                  <div className="w-3 h-3 bg-red-600 rounded-full relative z-10" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-nokael-primary/40 uppercase tracking-widest leading-none mb-1">Satellite Tracking</p>
                   <p className="text-sm font-black text-nokael-primary uppercase tracking-tight">{isDriverClose ? 'Arrived at Destination' : 'Signal Active'}</p>
                </div>
             </div>

             {arrivalMinutes && !isDriverClose && (
               <div className="bg-slate-900 border border-white/10 px-5 py-3 rounded-2xl shadow-xl flex items-center gap-4 animate-in slide-in-from-left duration-700 delay-200">
                  <Clock className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mb-1">Estimated Entry</p>
                    <p className="text-sm font-black text-white uppercase tracking-tight">{arrivalMinutes} MINS</p>
                  </div>
               </div>
             )}
          </div>

          {!isDriverClose && (
            <div className="absolute bottom-6 right-6 z-10">
               <div className="bg-white shadow-xl rounded-2xl p-4 border border-nokael-border flex items-center gap-3 animate-in bounce duration-1000">
                  <div className="w-10 h-10 bg-nokael-primary/5 rounded-xl flex items-center justify-center">
                    <Navigation className="w-6 h-6 text-nokael-primary" />
                  </div>
                  <div className="pr-4">
                     <p className="text-[10px] font-black text-nokael-primary/40 uppercase tracking-widest">En Route To</p>
                     <p className="text-sm font-black text-nokael-primary uppercase">{job.delivery_location}</p>
                  </div>
               </div>
            </div>
          )}

          <DriverMap job={job} />

          {isDriverClose && (
            <div className="absolute inset-0 bg-nokael-primary/80 backdrop-blur-md z-20 flex flex-col items-center justify-center text-center p-12 animate-in fade-in duration-1000">
               <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-2xl mb-8 animate-in zoom-in spin-in-45 duration-1000">
                  <Package className="w-12 h-12 text-nokael-primary" />
               </div>
               <h1 className="text-4xl font-black text-white uppercase tracking-tighter mb-2 italic">Courier Has Arrived</h1>
               <p className="text-white/70 text-lg font-medium max-w-sm mb-12">
                 Your secure legal courier is in the lobby. Please present the 4-digit code below to release the files.
               </p>
               <div className="bg-white rounded-[32px] p-10 w-full max-w-sm shadow-[0_32px_64px_-12px_rgba(0,0,0,0.4)]">
                 <p className="info-label text-nokael-primary/40 !mb-4">Handover Verification Code</p>
                 <div className="text-7xl font-black font-mono tracking-[0.3em] text-nokael-primary mb-4">{myOtp}</div>
                 <div className="h-1 w-24 bg-nokael-primary/10 rounded-full mx-auto" />
               </div>
               <button onClick={() => setIsDriverClose(false)} className="mt-8 text-white/40 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors">
                  ➔ Show Map Coverage
               </button>
            </div>
          )}
       </div>

       {!isDriverClose && (
         <div className="nokael-card !p-8 border-nokael-border bg-white shadow-xl flex flex-col items-center justify-center gap-6 animate-in slide-in-from-bottom duration-700">
            <div className="flex items-center gap-4 text-nokael-primary/30">
               <ShieldCheck className="w-6 h-6" />
               <h3 className="text-sm font-black uppercase tracking-[0.3em]">Secure Receiver Channel</h3>
            </div>
            {showMyOtp ? (
              <div className="space-y-4 text-center">
                 <p className="text-[11px] font-black text-nokael-primary/40 uppercase tracking-widest">Share this with courier upon arrival</p>
                 <div className="text-5xl font-black font-mono tracking-[0.4em] text-nokael-primary bg-slate-50 p-6 rounded-2xl border-2 border-slate-100">{myOtp}</div>
                 <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Hides in 10s for security</p>
              </div>
            ) : (
              <button 
                onClick={handleRevealOtp}
                className="w-full flex items-center justify-center gap-3 p-6 bg-slate-50 border-2 border-dashed border-nokael-border rounded-3xl text-nokael-text-muted hover:bg-slate-100 transition-all active:scale-[0.98] group"
              >
                <Lock className="w-6 h-6 group-hover:scale-110" />
                <span className="text-sm font-black uppercase tracking-[0.2em]">Reveal Arrival Code</span>
              </button>
            )}
            <p className="text-[11px] text-nokael-text-muted font-bold text-center leading-relaxed">
               The verification code is locked until the courier physically crosses the geofence surrounding the drop-off zone.
            </p>
         </div>
       )}

       <div className="grid grid-cols-2 gap-4">
          <a href={`tel:${job.driver_phone || ''}`} className="h-20 bg-slate-900 border-2 border-slate-900 text-white font-black rounded-[28px] flex items-center justify-center gap-3 shadow-xl transition-all active:scale-[0.98]">
             <Phone className="w-6 h-6" />
             <span className="text-[10px] uppercase tracking-widest">Call Courier</span>
          </a>
          <div className="h-20 bg-white border border-nokael-border rounded-[28px] flex flex-col items-center justify-center text-center px-4">
             <span className="text-[10px] font-black text-nokael-primary/30 uppercase tracking-widest">Recipient Access</span>
             <span className="text-xs font-black text-nokael-primary truncate w-full">{job.recipient_name}</span>
          </div>
       </div>
    </div>
  );
}

function JobSummary({ job }: { job: Job }) {
  const getDuration = () => {
    if (!job.client_pickup_at || !job.client_delivery_at) return null;
    
    const start = new Date(job.client_pickup_at);
    const end = new Date(job.client_delivery_at);
    const diffMs = end.getTime() - start.getTime();
    
    if (diffMs < 0) return 'Verified';

    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffHrs === 0) return `${diffMins} MIN`;
    if (diffMins === 0) return `${diffHrs} HR`;
    return `${diffHrs} HR ${diffMins} MIN`;
  };

  const duration = getDuration();

  return (
    <Suspense fallback={<div className="min-h-[400px] flex items-center justify-center"><Loader2 className="animate-spin text-nokael-primary" /></div>}>
      <MotionDiv 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <div className="nokael-card !p-8 sm:!p-12 border-nokael-success/20 bg-nokael-success/[0.02] text-center space-y-6 shadow-2xl shadow-nokael-success/5">
          <div className="w-20 h-20 bg-nokael-success/10 rounded-full flex items-center justify-center mx-auto ring-8 ring-nokael-success/[0.03]">
            <CheckCircle2 className="w-10 h-10 text-nokael-success" />
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl sm:text-4xl font-black text-nokael-primary italic uppercase tracking-tighter">Mission Accomplished</h2>
            <p className="text-nokael-text-muted text-sm sm:text-base px-4 max-w-lg mx-auto">This Job has been successfully verified, physically delivered, and cryptographically anchored in the system.</p>
          </div>
        </div>

        <div className="nokael-card !p-0 overflow-hidden border-nokael-border shadow-2xl bg-white group">
          <div className="bg-slate-50 px-8 py-6 border-b border-nokael-border flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-nokael-primary/60">Official Logistics Record</span>
                <span className="text-sm font-black text-nokael-primary uppercase">Delivery Certificate</span>
              </div>
              {duration && (
                <div className="px-3 py-1 bg-nokael-primary text-white text-[10px] font-black rounded uppercase tracking-widest animate-in zoom-in slide-in-from-left duration-700">
                  {duration} TRANSIT
                </div>
              )}
            </div>
            <div className="flex flex-col items-end">
               <span className="text-[10px] font-black text-nokael-text-muted uppercase tracking-widest">Job Reference</span>
               <span className="text-lg font-black text-nokael-primary uppercase tracking-tight">{job.job_ref}</span>
            </div>
          </div>
          
          <div className="p-8 sm:p-12 space-y-12">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 relative">
              <div className="absolute left-1/2 top-4 bottom-4 w-px bg-slate-100 hidden sm:block" />
              
              <div className="space-y-2 group/sender">
                <p className="info-label text-nokael-primary/40">Registered Sender</p>
                <p className="text-xl font-black text-nokael-primary uppercase tracking-tight group-hover/sender:text-nokael-accent transition-colors">{job.sender_name}</p>
                <div className="h-1 w-12 bg-nokael-accent/20 rounded-full" />
              </div>
              <div className="space-y-2 text-left sm:text-right group/recipient">
                <p className="info-label text-nokael-primary/40">Verified Recipient</p>
                <p className="text-xl font-black text-nokael-primary uppercase tracking-tight group-hover/recipient:text-nokael-success transition-colors">{job.recipient_name}</p>
                <div className="h-1 w-12 bg-nokael-success/20 rounded-full ml-0 sm:ml-auto" />
              </div>
            </div>

            <div className="relative pl-10 sm:pl-16 space-y-16 py-4">
              <div className="absolute left-[7px] sm:left-[11px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-nokael-primary/20 via-slate-100 to-nokael-success/20" />
              
              {/* Pickup */}
              <div className="relative animate-in fade-in slide-in-from-left duration-700 delay-200">
                <div className="absolute -left-[35px] sm:-left-[47px] top-1 w-6 h-6 rounded-full bg-white border-4 border-nokael-primary shadow-sm flex items-center justify-center">
                   <div className="w-2 h-2 bg-nokael-primary rounded-full" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="space-y-1">
                      <p className="info-label !mb-0 !text-nokael-primary/50 uppercase">Chain of Custody: Collection</p>
                      <p className="text-lg font-black text-nokael-primary leading-tight">
                        {job.pickup_location}, {job.pickup_emirate}
                      </p>
                   </div>
                   <div className="flex flex-col sm:items-end justify-center">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100/50 rounded-lg text-[11px] font-black text-nokael-text-main shadow-sm border border-slate-200/50">
                        <Clock className="w-3.5 h-3.5 text-nokael-primary" />
                        <span>VERIFIED: {formatUAETime(job.client_pickup_at)}</span>
                      </div>
                   </div>
                </div>
              </div>

              {/* Delivery */}
              <div className="relative animate-in fade-in slide-in-from-left duration-1000 delay-500">
                <div className="absolute -left-[35px] sm:-left-[47px] top-1 w-6 h-6 rounded-full bg-white border-4 border-nokael-success shadow-sm flex items-center justify-center">
                   <CheckCircle2 className="w-3 h-3 text-nokael-success" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="space-y-1">
                      <p className="info-label !mb-0 !text-nokael-success/60 uppercase">Protocol Completion: Delivery</p>
                      <p className="text-lg font-black text-nokael-primary leading-tight">
                        {job.delivery_location}, {job.delivery_emirate}
                      </p>
                   </div>
                   <div className="flex flex-col sm:items-end justify-center">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-nokael-success/10 rounded-lg text-[11px] font-black text-nokael-success shadow-sm border border-nokael-success/10">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>COMPLETED: {formatUAETime(job.client_delivery_at)}</span>
                      </div>
                   </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 text-white/40 p-6 flex flex-wrap justify-center sm:justify-between items-center gap-4 text-[9px] font-black uppercase tracking-[0.3em]">
             <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-nokael-success rounded-full" />
                Secure Handover Confirmed
             </div>
             <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-nokael-success rounded-full" />
                GPS Timestamp Anchored
             </div>
             <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-nokael-success rounded-full" />
                Custody Chain Verified
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
          <a 
            href="https://nokael.com/get-quote"
            className="nokael-button h-20 text-lg font-black uppercase tracking-[0.2em] flex items-center justify-center gap-4 no-underline bg-nokael-primary shadow-2xl shadow-nokael-primary/20 hover:scale-[1.02] transition-all"
          >
            <QrCode className="w-6 h-6" />
            Initiate New Job
          </a>
          
          <div className="bg-white rounded-2xl p-6 border border-nokael-border text-center shadow-lg shadow-slate-200/50">
            <div className="flex items-center justify-center gap-3 mb-2">
               <History className="w-4 h-4 text-nokael-primary" />
               <h4 className="text-[11px] font-black uppercase tracking-widest text-nokael-primary">Data Retention Policy</h4>
            </div>
            <p className="text-[10px] leading-relaxed text-nokael-text-muted font-bold uppercase tracking-tight px-4">
              Secure job metadata is archived for 6 months to maintain official chain-of-custody integrity for all participants.
            </p>
          </div>
        </div>
      </MotionDiv>
    </Suspense>
  );
}

function LogisticsDetail({ job }: { job: Job }) {
  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'pending': 'Awaiting Driver',
      'client_pickup': 'In Collection',
      'driver_pickup': 'Package with Driver',
      'driver_delivery': 'Arrived/Handover',
      'completed': 'Completed'
    };
    return labels[status] || status;
  };

  return (
    <section className="nokael-card !p-0 overflow-hidden border-nokael-border bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] space-y-0 animate-in fade-in slide-in-from-up-4 duration-1000 group">
       <div className="flex items-center justify-between px-8 py-7 border-b border-nokael-border bg-white">
         <div className="flex items-center gap-4">
           <div className="w-14 h-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-[0_12px_24px_-8px_rgba(15,23,42,0.4)] group-hover:scale-105 transition-transform duration-500">
             <Package className="w-7 h-7" />
           </div>
           <div>
             <h3 className="text-[15px] font-black uppercase tracking-[0.1em] text-nokael-primary leading-none mb-1">Logistics Detail</h3>
             <p className="text-[11px] font-bold text-nokael-text-muted uppercase tracking-wider">{job.job_ref}</p>
           </div>
         </div>
         <div className="flex items-center gap-2.5 px-4 pr-6 py-2.5 bg-[#E6F0F8] rounded-full border border-[#D0E2F0]">
            <div className="w-1.5 h-4 bg-[#7FB5D8] rounded-full shadow-sm" />
            <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[#2C5282] leading-none mb-0.5">{getStatusLabel(job.status)}</span>
         </div>
       </div>
       
       <div className="p-8 space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2 p-6 bg-slate-50/40 rounded-[24px] border border-slate-100/60 flex flex-col justify-center group/card transition-colors hover:bg-slate-50">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-nokael-primary/30 mb-1">Registration Timestamp</p>
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-nokael-primary/40 group-hover/card:text-nokael-secondary transition-colors" />
                <p className="text-[15px] font-extrabold text-nokael-primary leading-tight">
                  {job.client_pickup_at ? formatUAETime(job.client_pickup_at) : 'Awaiting Collection...'}
                </p>
              </div>
            </div>
            <div className="space-y-2 p-6 bg-slate-50/40 rounded-[24px] border border-slate-100/60 flex flex-col justify-center group/card transition-colors hover:bg-slate-50">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-nokael-primary/30 mb-1">System Reference Code</p>
              <div className="flex items-center gap-3">
                <Key className="w-4 h-4 text-nokael-primary/40 group-hover/card:text-nokael-accent transition-colors rotate-45" />
                <p className="text-[15px] font-black text-nokael-primary uppercase tracking-tight">
                  {job.job_ref}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-8 px-2">
            <div className="relative pl-12 py-1">
              {/* Timeline Gradient Line */}
              <div className="absolute left-[8px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-nokael-primary via-slate-100 to-nokael-success" />
              
              <div className="relative mb-14 animate-in slide-in-from-left duration-700">
                <div className="absolute -left-[45px] top-0 w-8 h-8 rounded-full bg-white border-[3px] border-nokael-primary shadow-sm flex items-center justify-center">
                   <div className="w-3.5 h-3.5 rounded-full border-2 border-nokael-primary flex items-center justify-center">
                     <div className="w-1 h-1 bg-nokael-primary rounded-full" />
                   </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-nokael-primary/30 mb-0.5">Departure Protocol</p>
                  <p className="text-[19px] font-black text-nokael-primary leading-tight tracking-tight capitalize">
                    {job.pickup_location}, {job.pickup_emirate}
                  </p>
                </div>
              </div>

              <div className="relative mt-8 animate-in slide-in-from-left duration-1000">
                <div className="absolute -left-[45px] top-0 w-8 h-8 rounded-full bg-nokael-success shadow-[0_4px_12px_rgba(16,185,129,0.3)] flex items-center justify-center border-2 border-white">
                   <CheckCircle2 className="w-4 h-4 text-white" />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-nokael-success/40 mb-0.5">Destination Protocol</p>
                  <p className="text-[19px] font-black text-nokael-primary leading-tight tracking-tight capitalize">
                    {job.delivery_location}, {job.delivery_emirate}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 bg-slate-50/60 border border-slate-200/50 rounded-[28px] relative overflow-hidden flex items-center justify-center">
            <p className="text-[13px] leading-relaxed text-nokael-text-muted font-bold italic text-center max-w-[280px]">
              Professional Proof of Collection System — Protected by Nokael Custody Chain protocol.
            </p>
          </div>
       </div>
    </section>
  );
}

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

  const config = STEP_CONFIG[step];
  const myOtp = job && config ? (job[config.my_otp_field] as string) : '';

  // Location tracking for drivers with Background Support
  useEffect(() => {
    // Only track if user is a driver, job is not completed, and we are online
    if (!job || job.status === 'completed' || config.role !== 'driver' || !online) return;

    let watcherId: string | null = null;
    let fallbackWatchId: number | null = null;
    
    // Core update function used by both native and web trackers
    const updateLocation = async (lat: number, lng: number) => {
      try {
        await supabase
          .from('jobs')
          .update({ 
            driver_lat: lat, 
            driver_lng: lng,
            updated_at: new Date().toISOString()
          })
          .eq(config.token_field, token);

        // Automatic Arrived Logic (within 500m of target)
        if (step === 'driver-delivery' && !job.driver_arrived_delivery_at) {
          const distToTarget = calculateDistance(lat, lng, job.drop_lat || 0, job.drop_lng || 0);
          if (distToTarget < 500) {
            console.log('[Location] Automatically marking as arrived (within 500m)');
            handleReadyUpdate('driver_arrived_delivery_at');
          }
        }
      } catch (err) {
        console.error('Failed to sync location telemetry:', err);
      }
    };

    const startTracking = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          // Native Background Tracking
          watcherId = await BackgroundGeolocation.addWatcher(
            {
              backgroundMessage: "Syncing your coordinates for the recipient map.",
              backgroundTitle: "Nokael Driver Trace",
              requestPermissions: true,
              stale: false,
              distanceFilter: 10 // Trigger update every 10 meters
            },
            (location, error) => {
              if (error) {
                if (error.code === "NOT_AUTHORIZED") {
                  console.warn('[Location] Permissions denied for background tracking');
                }
                return;
              }
              if (location) {
                updateLocation(location.latitude, location.longitude);
              }
            }
          );
          console.log('[Location] Native background telemetry active');
        } catch (e) {
          console.error('[Location] Background plugin failed, using fallback:', e);
        }
      }
      
      // Fallback for Web or if plugin fails
      if (!watcherId && navigator.geolocation) {
        console.log('[Location] Starting browser-level geolocation watcher');
        fallbackWatchId = navigator.geolocation.watchPosition(
          (position) => updateLocation(position.coords.latitude, position.coords.longitude),
          (err) => console.error('[Location] Browser geolocation error:', err),
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
        );
      }
    };

    startTracking();

    return () => {
      if (watcherId) {
        BackgroundGeolocation.removeWatcher({ id: watcherId });
      }
      if (fallbackWatchId !== null) {
        navigator.geolocation.clearWatch(fallbackWatchId);
      }
    };
  }, [job?.id, job?.status, config.role, online, token, step, job?.driver_arrived_delivery_at, job?.drop_lat, job?.drop_lng]);

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
        console.log('[Connectivity] Back online');
        setOnline(true);
        syncPendingConfirmations().then(() => fetchJob());
      },
      () => {
        console.log('[Connectivity] Gone offline');
        setOnline(false);
      }
    );

    // Start auto-sync
    startAutoSync();

    // Setup realtime subscription only if online
    let channel: any = null;
    if (isOnline()) {
      channel = supabase
        .channel('job-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, () => {
          if (isOnline()) {
            fetchJob();
          }
        })
        .subscribe();
    }

    return () => { 
      if (channel) {
        channel.unsubscribe().catch(() => {});
      }
      cleanup();
      stopAutoSync();
    };
  }, [token, step]);

  async function fetchJob() {
    try {
      setLoading(true);
      setError(null);
      
      // Check if we're truly online (not just navigator.onLine)
      const actuallyOnline = isOnline();

      if (actuallyOnline) {
        // Try online fetch with timeout
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          const { data, error: supabaseError } = await supabase
            .from('jobs')
            .select('*')
            .eq(config.token_field, token)
            .abortSignal(controller.signal)
            .single();

          clearTimeout(timeoutId);

          if (supabaseError) {
            console.error('[Supabase Error]', supabaseError);
            if (supabaseError.code === 'PGRST116') {
              setError('Security Error: Invalid or expired access link. Please check the link or contact dispatch.');
              setLoading(false);
              return;
            }
            if (supabaseError.message?.includes('failed to fetch') || supabaseError.message?.includes('NetworkError')) {
              throw new Error('NETWORK_ERROR');
            }
            throw supabaseError;
          }

          if (!data) {
            throw new Error('Failed to fetch job data');
          }

          setJob(data as Job);
          
          // Cache job data for offline use
          const partnerOtpField = getPartnerOtpField(step);
          const partnerOtp = data[partnerOtpField] as string;
          const myOtp = data[config.my_otp_field] as string;
          
          await cacheJobData(token!, step, data, partnerOtp, myOtp);
          
          // Also cache the page itself for offline loading
          cacheCurrentPage().catch(err => console.warn('Page caching failed:', err));
          
        } catch (fetchError: any) {
          console.warn('Online fetch failed, checking cause:', fetchError);
          
          if (fetchError.name === 'AbortError' || fetchError.message === 'NETWORK_ERROR') {
             setError('Connection Timeout: Signal too weak to reach the security server. Please refresh or move to an open area.');
             setLoading(false);
             return;
          }

          if (supabase.auth.getSession === undefined) {
             setError('Configuration Error: Supabase URL or Key is missing. Check your AI Studio Secrets.');
             setLoading(false);
             return;
          }

          // Network error or other - fall back to cache
          const cached = await getCachedJob(token!);
          if (cached) {
            setJob(cached.job_data as Job);
            setOnline(false); // Update online status
            setError(null);
          } else {
            setError(`Error: ${fetchError.message || 'Unable to connect to Nokael servers'}. Check your internet signal.`);
          }
        }
      } else {
        // Offline - use cached data only
        console.log('[Offline Mode] Loading from cache');
        const cached = await getCachedJob(token!);
        if (cached) {
          setJob(cached.job_data as Job);
        } else {
          setError('No internet connection. Please connect to load this page for the first time.');
        }
      }
    } catch (err) {
      console.error('fetchJob error:', err);
      
      // Last resort - try cache
      try {
        const cached = await getCachedJob(token!);
        if (cached) {
          setJob(cached.job_data as Job);
          setOnline(false);
        } else {
          setError('Unable to load job data. Please try again.');
        }
      } catch (cacheErr) {
        setError('Something went wrong. Please try again or contact Nokael dispatch.');
      }
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

  async function handleReadyUpdate(field: keyof Job) {
    if (!online || confirming || !job) return;
    setConfirming(true);
    setError(null);
    try {
      console.log(`[Readiness] Updating field "${field}" using token: ${token}`);
      
      // Use the token for targeting as it's the primary security barrier
      const { data, error: updateError } = await supabase
        .from('jobs')
        .update({ 
          [field]: new Date().toISOString()
        })
        .eq(config.token_field, token);
      
      if (updateError) {
        console.error('[Readiness] Update error:', updateError);
        const msg = updateError.message || '';
        if (msg.includes('column') && msg.includes('does not exist')) {
          setError('Database Mismatch: Missing readiness columns. Contact support.');
        } else if (msg.includes('policy') || msg.includes('permission')) {
          setError('Security Error: Status update blocked by database rules.');
        } else {
          setError(`Update failed: ${updateError.message || 'Unknown error'}`);
        }
        return;
      }

      console.log('[Readiness] Update successful');
      await fetchJob();
    } catch (err: any) {
      console.error('[Readiness] Critical failure:', err);
      // More descriptive error for debugging
      const errorMessage = err?.message || 'Connection error or database timeout';
      setError(`Status update failed: ${errorMessage}. Please check your internet and try again.`);
    } finally {
      setConfirming(false);
    }
  }

  async function handleConfirm() {
    if (confirming || partnerOtp.length !== 6) return;
    setConfirming(true);
    setError(null);

    try {
      if (partnerOtp === myOtp) {
        setError(`Security Error: You entered your own code (${myOtp}). You MUST enter the code from the other person's device.`);
        setConfirming(false);
        setPartnerOtp('');
        return;
      }

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

      if (online) {
        // CROSS-VERIFICATION SHIM: 
        // The RPC 'confirm_job_step' currently expects the user's OWN code (the "bug" reported).
        // To enforce real cross-verification, we verify the ENTERED partner code locally,
        // and if it matches, we call the RPC with the OWN code it expects.
        
        const partnerOtpField = getPartnerOtpField(step);
        const actualPartnerOtp = job ? (job[partnerOtpField] as string) : null;

        if (!actualPartnerOtp) {
          setError('Handover context not ready. Please refresh or wait for the other party.');
          setConfirming(false);
          return;
        }

        if (partnerOtp !== actualPartnerOtp) {
          // Calculate attempts left (if we had that info, otherwise generic error)
          setError('Incorrect code. Please double-check with the other person.');
          setPartnerOtp('');
          setConfirming(false);
          return;
        }

        // Partner code is correct! Now call the RPC with the code it expects (the user's OWN code)
        // This effectively completes the cross-verification loop.
        try {
          const { data, error: rpcError } = await supabase.rpc('confirm_job_step', {
            p_token: token,
            p_step: config.rpc_step,
            p_otp: myOtp, // Use our own OTP to satisfy the RPC's expectation
            p_lat: lat,
            p_lng: lng
          });

          if (rpcError) {
            throw rpcError;
          }

          if (data?.error) {
            setError(data.error);
          } else {
            await fetchJob();
          }
        } catch (networkError) {
          console.error('Network error during confirmation shim:', networkError);
          setOnline(false);
          setError('Connection lost. Switching to offline mode...');
          setTimeout(() => {
            setError('');
            handleConfirm();
          }, 1000);
          return;
        }
      } else {
        // Offline - verify locally and queue for sync
        const verification = await verifyOtpOffline(token!, partnerOtp);

        if (!verification.valid) {
          if (verification.error === 'no_cached_data') {
            setError('Cannot verify offline - no cached data. Connect to internet first.');
          } else if (verification.error === 'self_verification_blocked') {
            setError('Security Error: You cannot use your own code. Enter the code from the other person.');
            setPartnerOtp('');
          } else {
            setError('Incorrect code. Please try again.');
            setPartnerOtp('');
          }
        } else {
          // Valid OTP - queue for sync
          await queueConfirmation(token!, config.rpc_step, partnerOtp, lat, lng, job?.job_ref);
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

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'pending': 'Awaiting Driver',
      'client_pickup': 'In Collection',
      'driver_pickup': 'Package with Driver',
      'driver_delivery': 'Arrived/Handover',
      'completed': 'Completed'
    };
    return labels[status] || status;
  };

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

  if (!isValidStep || !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-slate-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-nokael-primary">
            {error ? 'Unable to Load Job' : 'Invalid Link'}
          </h1>
          <p className="text-nokael-text-muted text-sm max-w-md mx-auto">
            {error || 'This link is not valid or has expired.'}
          </p>
        </div>
        <a href="https://wa.me/971509999999" className="text-nokael-accent font-bold text-sm underline underline-offset-4">Contact Nokael Dispatch</a>
      </div>
    );
  }

  const isConfirmed = job && job[config.at_field] !== null;
  const isPartnerConfirmed = job && job[config.partner_at_field] !== null;
  const isHandoverComplete = isConfirmed && isPartnerConfirmed;
  
  const statusRank: Record<string, number> = { 'pending': 0, 'client_pickup': 1, 'driver_pickup': 2, 'driver_delivery': 3, 'completed': 4 };

    // Determine which role view to show
    const renderRoleView = () => {
      if (job?.status === 'completed') return <JobSummary job={job} />;
      
      // Waiting state (already confirmed own part, waiting for partner)
      if (isConfirmed && !isPartnerConfirmed) {
        return (
          <div className="nokael-card text-center !p-12 space-y-8 animate-in fade-in duration-700">
             <div className="w-24 h-24 bg-nokael-accent/10 rounded-full flex items-center justify-center mx-auto">
                <History className="w-12 h-12 text-nokael-accent animate-[spin_5s_linear_infinite]" />
             </div>
             <div className="space-y-2">
                <h1 className="text-3xl font-black text-nokael-primary uppercase tracking-tighter italic">Syncing Handover...</h1>
                <p className="text-nokael-text-muted font-medium">Wait for the <span className="font-bold text-nokael-accent uppercase">{config.partner_role}</span> to acknowledge your arrival.</p>
             </div>
             <div className="bg-slate-50 rounded-3xl p-8 border-2 border-dashed border-slate-200">
                <p className="text-[10px] font-black text-nokael-primary/30 uppercase tracking-[0.2em] mb-4">Your Verification Code</p>
                <div className="text-6xl font-black font-mono tracking-[0.4em] text-nokael-primary">{myOtp}</div>
             </div>
          </div>
        );
      }

      const commonProps = {
        job: job!,
        step,
        config,
        online,
        confirming,
        partnerOtp,
        setPartnerOtp,
        handleConfirm,
        handleReadyUpdate,
        showMyOtp,
        handleRevealOtp,
        error,
        setError,
        myOtp
      };

      if (step === 'client-pickup') return <SenderView {...commonProps} />;
      if (step === 'driver-pickup' || step === 'driver-delivery') return <CourierView {...commonProps} />;
      if (step === 'client-delivery') return <RecipientView {...commonProps} />;
      
      return <div>Invalid View Selection</div>;
    };

    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8 min-h-screen flex flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/nokael-logo.jpg" alt="Nokael" className="h-7 sm:h-8 rounded-md border border-slate-800" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <span className="text-xl sm:text-2xl font-[900] tracking-tighter text-nokael-primary uppercase italic">NOKAEL</span>
          </div>
          <div className="flex items-center gap-2">
            {!online && <WifiOff className="w-4 h-4 text-amber-500" />}
            {pendingSync && <CloudOff className="w-4 h-4 text-blue-500 animate-pulse" />}
            <div className="flex items-center gap-1.5 px-3 py-1 bg-nokael-primary/10 rounded-full border border-nokael-primary/10">
               <div className="w-1.5 h-1.5 bg-nokael-primary rounded-full animate-pulse" />
               <span className="text-[9px] font-black text-nokael-primary tracking-widest uppercase">Live-Link</span>
            </div>
          </div>
        </header>

        {/* Primary Role View */}
        <main className="flex-1">
          {renderRoleView()}
        </main>

        <footer className="pt-12 mt-12 border-t border-nokael-border space-y-8 pb-12">
          <LogisticsDetail job={job!} />
          <div className="whatsapp-support">
            <a href="https://wa.me/971509999999" className="w-full bg-white border-2 border-nokael-border p-6 rounded-[32px] text-nokael-primary font-black no-underline flex items-center justify-center gap-4 hover:bg-slate-50 transition-all">
              <MessageSquare className="w-6 h-6" />
              <span className="text-sm uppercase tracking-wider">Contact Response Team</span>
            </a>
          </div>
          <div className="text-center">
              <p className="text-[9px] font-black text-nokael-text-muted/40 uppercase tracking-[0.4em]">Official Nokael Logistics Gateway — Secure Custody Chain</p>
          </div>
        </footer>
      </div>
    );
}
