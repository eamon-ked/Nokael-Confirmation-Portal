import { useEffect, useRef, useState } from 'react';
import { parseMapInput, type MapInput } from '../lib/mapLink';

// ==========================================
// Address field for clients: search, paste a map link, or use my location
// ==========================================
// Same idea as the dispatch job form (nokael-concierge-V2 AddressSearch), sized
// for clients: suggestions from Mapbox Search Box, a pasted WhatsApp / Google
// Maps location or coordinates pins the point at once, and "Use my location"
// takes the phone's GPS. Typing plain text always works.
// Copy of client-portal/src/PlaceField.tsx (keep them in step). Styles:
// .place-* classes in each app's stylesheet.

export type LatLng = [number, number];
export interface PlaceValue {
  text: string;
  coords: LatLng | null;
  region: string | null;
}

const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
const DUBAI: [number, number] = [55.2708, 25.2048];

type Suggestion = { label: string; coords: LatLng; region: string | null };

/** "Name, address", without repeating the name when the address already starts with it. */
const labelOf = (p: any): string => {
  const name = (p?.name || '').trim();
  const addr = (p?.full_address || p?.place_formatted || '').trim();
  return !name ? addr : !addr || addr.toLowerCase().startsWith(name.toLowerCase()) ? addr || name : `${name}, ${addr}`;
};
const regionOf = (name?: string | null): string | null => {
  const n = (name || '').toLowerCase().replace(/[^a-z]/g, '');
  return n ? EMIRATES.find((e) => { const m = e.toLowerCase().replace(/[^a-z]/g, ''); return n.includes(m) || m.includes(n); }) ?? null : null;
};
const toSuggestion = (f: any): Suggestion | null => {
  const c = f?.geometry?.coordinates;
  if (!Array.isArray(c) || c.length !== 2) return null;
  return { label: labelOf(f.properties), coords: [c[1], c[0]], region: regionOf(f.properties?.context?.region?.name) };
};

const CENTERS: Record<string, [number, number]> = {
  'Abu Dhabi': [54.3773, 24.4539], Dubai: DUBAI, Sharjah: [55.4033, 25.3463], Ajman: [55.5136, 25.4052],
  'Umm Al Quwain': [55.5552, 25.5647], 'Ras Al Khaimah': [55.9432, 25.8007], Fujairah: [56.3265, 25.1288],
};

/** `exact` for a full name + address from a pasted link (autocomplete mode garbles those), searched near the city it names. */
async function search(q: string, signal: AbortSignal, exact = false): Promise<Suggestion[]> {
  const city = exact ? q.split(/\s*[,\-–]\s+/).map(regionOf).filter(Boolean).pop() : null;
  const qs = new URLSearchParams({ q, access_token: token!, country: 'ae', limit: '5', language: 'en', proximity: (city ? CENTERS[city] : DUBAI).join(','), ...(exact ? {} : { auto_complete: 'true' }) });
  const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${qs}`, { signal });
  if (!res.ok) return [];
  const all = ((await res.json())?.features ?? []).map(toSuggestion).filter((s: Suggestion | null): s is Suggestion => !!s?.label);
  return all.filter((s: Suggestion, i: number) => all.findIndex((o: Suggestion) => o.label === s.label) === i);
}

async function reverse(coords: LatLng): Promise<{ label: string; region: string | null }> {
  const fallback = { label: `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`, region: null };
  if (!token) return fallback;
  try {
    const qs = new URLSearchParams({ access_token: token, longitude: String(coords[1]), latitude: String(coords[0]), limit: '1', language: 'en' });
    const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/reverse?${qs}`);
    const s = res.ok ? toSuggestion((await res.json())?.features?.[0]) : null;
    return s?.label ? { label: s.label, region: s.region } : fallback;
  } catch {
    return fallback;
  }
}

/** Expand a maps.app.goo.gl link on our server (browsers can't follow it cross-origin). */
async function resolveShort(url: string): Promise<MapInput> {
  const res = await fetch('/api/maps/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!res.ok) throw new Error('resolve_failed');
  return (await res.json()) as MapInput;
}

function deviceFix(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) { reject(new Error('Location isn’t available in this browser.')); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([coords.latitude, coords.longitude]),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Location is blocked. Allow it in your browser settings, or type the address.'
        : 'Couldn’t find your location. Type the address instead.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}

interface Props {
  label: string;
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  placeholder?: string;
  /** Offer "Use my location" (the client is usually at the pickup). */
  locate?: boolean;
}

export default function PlaceField({ label, value, onChange, placeholder = 'Search a place or paste a map link', locate }: Props) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const picked = useRef<string | null>(value.coords ? value.text : null);
  // Set by onPaste: pasted coordinates pin at once; typed ones wait for a tap (a half-typed pair must not fire).
  const pasting = useRef(false);

  useEffect(() => {
    const q = query.trim();
    if (!token || q.length < 3 || parseMapInput(q) || /^https?:\/\//i.test(q)) { setItems([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      search(q, controller.signal).then((r) => { setItems(r); setOpen(r.length > 0); }).catch(() => {});
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  const typedInput = parseMapInput(query.trim());
  const typedPoint: LatLng | null = typedInput?.kind === 'coords' ? typedInput.coords : null;

  const pin = async (coords: LatLng, name?: string | null) => {
    const found = await reverse(coords);
    const text = name ? `${name}, ${found.label}` : found.label;
    picked.current = text;
    onChange({ text, coords, region: found.region });
  };

  const onText = async (text: string) => {
    setNote(null);
    const pasted = parseMapInput(text);
    const wasPaste = pasting.current;
    pasting.current = false;
    // Links are never typed by hand, so a link's point pins at once; typed coordinates wait for a tap.
    if (pasted?.kind === 'coords' && (wasPaste || /https?:\/\//i.test(text))) {
      setBusy(true);
      await pin(pasted.coords, pasted.name);
      setBusy(false);
      setQuery('');
      return;
    }
    if (pasted?.kind === 'short' || pasted?.kind === 'place') {
      setBusy(true);
      onChange({ text: '', coords: null, region: null });
      try {
        const found = pasted.kind === 'short' ? await resolveShort(pasted.url) : pasted;
        if (found.kind === 'coords') { await pin(found.coords, found.name); return; }
        if (found.kind === 'place') {
          // Saved places come as "Name, floor - street - area - city": try all of it, then name + city.
          const parts = found.name.split(/\s*[,\-–]\s+/).filter(Boolean);
          for (const q of [found.name, parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : '']) {
            const [hit] = q && token ? await search(q, new AbortController().signal, true) : [];
            if (hit) { picked.current = hit.label; onChange({ text: hit.label, coords: hit.coords, region: hit.region }); return; }
          }
          onChange({ text: found.name, coords: null, region: null });
        }
      } catch {
        setNote('Couldn’t open that link. Type the address, or use “Use my location”.');
      } finally {
        setBusy(false);
        setQuery('');
      }
      return;
    }
    setQuery(text);
    // Adding detail after a picked place ("…, villa 12") keeps its pin.
    const keep = picked.current && text.startsWith(picked.current) ? value.coords : null;
    if (!keep) picked.current = null;
    onChange({ text, coords: keep, region: keep ? value.region : null });
  };

  const useMine = async () => {
    setBusy(true);
    setNote(null);
    try {
      await pin(await deviceFix());
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="place-field">
      <span className="place-label">{label}</span>
      <div className="place-box">
        <input
          className="place-input"
          value={value.text}
          onChange={(e) => void onText(e.target.value)}
          onPaste={() => { pasting.current = true; }}
          onFocus={() => items.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          maxLength={500}
          disabled={busy}
          autoComplete="off"
        />
        {typedPoint && !busy && (
          <ul className="place-list" role="listbox">
            <li role="option" aria-selected={false}
              onMouseDown={async (e) => { e.preventDefault(); setBusy(true); await pin(typedPoint); setBusy(false); setQuery(''); }}>
              Pin at {typedPoint[0].toFixed(5)}, {typedPoint[1].toFixed(5)}
            </li>
          </ul>
        )}
        {!typedPoint && open && items.length > 0 && (
          <ul className="place-list" role="listbox">
            {items.map((s) => (
              <li key={s.label} role="option" aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault();
                  picked.current = s.label;
                  setQuery('');
                  setOpen(false);
                  onChange({ text: s.label, coords: s.coords, region: s.region });
                }}>
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="place-meta">
        {busy ? <span>Finding the spot…</span>
          : value.coords ? <span className="place-pinned">✓ Exact spot pinned</span>
          : <span>Tip: paste a WhatsApp or Google Maps location.</span>}
        {locate && !busy && (
          <button type="button" className="place-locate" onClick={useMine}>Use my location</button>
        )}
      </div>
      {note && <p className="place-note">{note}</p>}
    </div>
  );
}
