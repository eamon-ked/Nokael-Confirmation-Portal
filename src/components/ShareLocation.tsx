import { useState } from 'react';
import { CheckCircle2, Crosshair, Loader2 } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { store } from '@/src/lib/clientApp';
import { formatUAETime } from '@/src/lib/utils';

// ==========================================
// "Share my exact location" on a client link
// ==========================================
// The person at a stop knows exactly where the driver should come (the right
// villa, gate or loading bay). One tap sends the phone's GPS fix, which
// becomes that stop's pin for the driver (share_my_location). Shown until the
// driver arrives there. Prominent when the stop has no pin yet, a small link
// when it has one.

type Fix = { lat: number; lng: number; accuracy: number };

/** Best GPS fix within a few seconds: stops early once it's within 25 m. */
function bestFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) { reject(new Error('unavailable')); return; }
    let best: Fix | null = null;
    let id = 0;
    const finish = () => {
      navigator.geolocation.clearWatch(id);
      window.clearTimeout(timer);
      if (best) resolve(best); else reject(new Error('timeout'));
    };
    const timer = window.setTimeout(finish, 8000);
    id = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!best || coords.accuracy < best.accuracy) best = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        if (best.accuracy <= 25) finish();
      },
      err => {
        navigator.geolocation.clearWatch(id);
        window.clearTimeout(timer);
        if (best) resolve(best);
        else reject(new Error(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 },
    );
  });
}

const MESSAGES: Record<string, string> = {
  denied: 'Location is blocked for this page. Allow location in your browser settings, then try again.',
  unavailable: 'We couldn’t get your location. Turn on location (precise) and try again.',
  timeout: 'Your phone took too long to find you. Step outside or near a window and try again.',
  inaccurate: 'Your location isn’t precise enough yet. Turn on precise location, step outside and try again.',
  driver_arrived: 'The driver is already there, so the location can’t be changed now.',
  closed: 'This job is finished, so the location can’t be changed.',
  not_supported: 'This link can’t change the location. Please send it to dispatch on WhatsApp.',
};

interface Props {
  token: string;
  /** "drop-off", "pickup" or "stop": what the person is standing at. */
  place: string;
  hasPin: boolean;
  disabled?: boolean;
  onShared: () => void;
}

export default function ShareLocation({ token, place, hasPin, disabled, onShared }: Props) {
  const key = `nokael_pin_shared_${token}`;
  const [sharedAt, setSharedAt] = useState<string | null>(() => store.get(key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const fix = await bestFix();
      const { data, error: err } = await supabase.rpc('share_my_location', {
        p_token: token, p_lat: fix.lat, p_lng: fix.lng, p_accuracy_m: fix.accuracy,
      });
      const res = data as { ok?: boolean; error?: string; shared_at?: string } | null;
      if (err || !res?.ok) throw new Error(res?.error || 'unavailable');
      const at = res.shared_at || new Date().toISOString();
      store.set(key, at);
      setSharedAt(at);
      onShared();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unavailable';
      setError(MESSAGES[code] ?? MESSAGES.unavailable);
    } finally {
      setBusy(false);
    }
  };

  if (sharedAt) {
    return (
      <p className="text-[13px] text-nokael-text-muted px-1 flex items-center gap-1.5 flex-wrap">
        <CheckCircle2 className="w-4 h-4 text-nokael-success" /> You shared your exact location {formatUAETime(sharedAt)}. The driver navigates there.
        <button onClick={share} disabled={busy || disabled} className="underline font-medium text-nokael-primary disabled:opacity-60">
          {busy ? 'Sharing…' : 'Share again'}
        </button>
        {error && <span className="basis-full text-[12px] text-red-600">{error}</span>}
      </p>
    );
  }

  if (hasPin) {
    return (
      <div className="px-1 space-y-1">
        <button onClick={share} disabled={busy || disabled}
          className="text-[13px] font-medium text-nokael-primary inline-flex items-center gap-1.5 underline disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          {busy ? 'Finding you…' : `At the ${place} now? Share your exact location`}
        </button>
        {error && <p className="text-[12px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <section className="nokael-card space-y-2">
      <button onClick={share} disabled={busy || disabled} className="nokael-button gap-2 w-full disabled:opacity-60">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Crosshair className="w-5 h-5" />}
        {busy ? 'Finding you…' : 'Share my exact location'}
      </button>
      <p className="text-[12px] text-nokael-text-muted text-center">
        Tap this while you’re at the {place}. The driver comes straight to you, no need to explain the way.
      </p>
      {error && <p className="text-[12px] text-red-600 text-center">{error}</p>}
    </section>
  );
}
