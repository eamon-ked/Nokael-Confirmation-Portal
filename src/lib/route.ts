// ==========================================
// Live route + ETA (Mapbox Directions API)
// ==========================================
// One Directions call returns both the road route (drawn on the map) and the
// travel time, so the line and the ETA always agree. Nothing is stored: an ETA
// depends on where the driver is right now.
//
// Kept deliberately quiet on the network. A new route is fetched only when:
//   - the next stop changes (pickup → drop-off), or there is no route yet;
//   - the driver has left the drawn route (a detour or wrong turn); or
//   - the route is ROUTE_MAX_AGE_MS old (traffic may have changed).
// Between fetches the minutes count down locally and the line is trimmed to
// start at the driver, so driving along the route costs no requests. Nothing
// is fetched while the tab is hidden.
//
// Copy of nokael-concierge-V2/src/lib/route.ts (the dispatcher dashboard) —
// keep the two in step so the portal and the dashboard show the same ETA.
//
// Provider: Mapbox `driving-traffic`, VITE_MAPBOX_TOKEN. Returns null — never
// a guess — when the token is missing, the request fails or no route exists.

import React from 'react';

export type LatLng = [number, number];

const validCoord = (lat?: number | null, lng?: number | null): LatLng | null =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
    ? [lat, lng]
    : null;

const distanceMeters = (a: LatLng, b: LatLng): number => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

/** Refetch a live route at least this often, for traffic. */
export const ROUTE_MAX_AGE_MS = 5 * 60 * 1000;
/** The driver counts as off the route beyond this distance from the line. */
export const OFF_ROUTE_M = 250;
/** Never refetch for an off-route driver more often than this. */
export const OFF_ROUTE_MIN_GAP_MS = 30 * 1000;

export interface RouteResult {
  /** Driving time in whole minutes (at least 1). */
  minutes: number;
  /** Road geometry, [lat, lng] (Leaflet order). */
  coords: LatLng[];
}

export async function getRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from[1]},${from[0]};${to[1]},${to[0]}?geometries=geojson&overview=full&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const route = (await res.json())?.routes?.[0];
    if (typeof route?.duration !== 'number') return null;
    const coords = ((route.geometry?.coordinates || []) as [number, number][]).map(([lng, lat]) => [lat, lng] as LatLng);
    return { minutes: Math.max(1, Math.round(route.duration / 60)), coords };
  } catch {
    return null;
  }
}

// Pickup → drop-off doesn't change, so look it up once per session.
const staticRoutes = new Map<string, Promise<RouteResult | null>>();
export function getStaticRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const key = `${from.join(',')};${to.join(',')}`;
  let hit = staticRoutes.get(key);
  if (!hit) {
    hit = getRoute(from, to).then(r => { if (!r) staticRoutes.delete(key); return r; });
    staticRoutes.set(key, hit);
  }
  return hit;
}

interface StopFields {
  status?: string | null;
  pickup_lat?: number | null; pickup_lng?: number | null;
  delivery_lat?: number | null; delivery_lng?: number | null;
  client_pickup_at?: string | null; driver_pickup_at?: string | null;
  driver_arrived_pickup_at?: string | null; driver_arrived_delivery_at?: string | null;
}

export interface NextStop {
  kind: 'pickup' | 'delivery';
  /** Null when the stop has no map location. */
  target: LatLng | null;
  /** The driver has tapped "arrived" here — no ETA any more. */
  arrived: boolean;
}

/**
 * Where the driver is heading: the pickup until the package is collected (by
 * either party), then the drop-off. Null once the job is over.
 */
export function nextStop(job: StopFields): NextStop | null {
  if (['completed', 'cancelled', 'returned'].includes(job.status || '')) return null;
  const collected = !!(job.driver_pickup_at || job.client_pickup_at);
  return collected
    ? { kind: 'delivery', target: validCoord(job.delivery_lat, job.delivery_lng), arrived: !!job.driver_arrived_delivery_at }
    : { kind: 'pickup', target: validCoord(job.pickup_lat, job.pickup_lng), arrived: !!job.driver_arrived_pickup_at };
}

/** Distance from p to segment a–b in metres (flat projection; fine at street scale). */
function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): { d: number; t: number } {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { d: distanceMeters(p, [ay + t * dy, (ax + t * dx) / k]), t };
}

/** Nearest point of the route to p: its distance and the line from there on. */
export function locateOnRoute(p: LatLng, coords: LatLng[]): { d: number; rest: LatLng[] } {
  if (coords.length < 2) return { d: coords.length ? distanceMeters(p, coords[0]) : Infinity, rest: coords };
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const s = distanceToSegment(p, coords[i], coords[i + 1]);
    if (s.d < best.d) best = { d: s.d, i, t: s.t };
  }
  const a = coords[best.i], b = coords[best.i + 1];
  const onLine: LatLng = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
  return { d: best.d, rest: [onLine, ...coords.slice(best.i + 1)] };
}

export interface LiveRoute {
  stop: NextStop | null;
  /** Minutes left, counted down locally between fetches. Null when unknown. */
  minutes: number | null;
  /** Clock time the driver should reach the next stop. */
  arriveAt: Date | null;
  /** Road line from the driver to the next stop (empty when unknown). */
  coords: LatLng[];
  /** True only before the first answer — later refetches keep the old value on screen. */
  loading: boolean;
  /** When the current route was fetched; changes only on a new lookup (use it to refit a map). */
  fetchedAt: number | null;
}

type Fetched = { destKey: string; at: number; result: RouteResult | null };

/**
 * Live route and ETA from the driver to the job's next stop. `driver` is the
 * driver's latest fix and `fixAt` when it was taken; each new fix re-checks
 * the refetch rules above, but only fetches when one of them says so.
 */
export function useLiveRoute(job: StopFields | null, driver: LatLng | null, fixAt?: number | string | null): LiveRoute {
  const stop = job ? nextStop(job) : null;
  const dest = stop && !stop.arrived ? stop.target : null;
  const destKey = dest ? dest.join(',') : '';

  const [fetched, setFetched] = React.useState<Fetched | null>(null);
  const inFlight = React.useRef<string | null>(null);
  const lastRef = React.useRef<Fetched | null>(null);
  lastRef.current = fetched;
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // A local clock for the countdown — re-renders only, no requests.
  const [now, setNow] = React.useState(() => Date.now());
  const counting = !!fetched?.result && fetched.destKey === destKey;
  React.useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [counting]);

  const lat = driver?.[0], lng = driver?.[1];
  React.useEffect(() => {
    if (!dest || lat == null || lng == null || !import.meta.env.VITE_MAPBOX_TOKEN) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const here: LatLng = [lat, lng];
    const last = lastRef.current;
    const t = Date.now();
    const sameStop = last?.destKey === destKey;
    const age = sameStop ? t - last!.at : Infinity;
    const offRoute = sameStop && last!.result ? locateOnRoute(here, last!.result.coords).d > OFF_ROUTE_M : true;
    const due = !sameStop || age >= ROUTE_MAX_AGE_MS || (offRoute && age >= OFF_ROUTE_MIN_GAP_MS);
    if (!due || inFlight.current === destKey) return;

    // Not cancelled when the next fix arrives mid-request: the answer is still
    // the freshest route, and dropping it would only cause another request.
    inFlight.current = destKey;
    getRoute(here, dest).then(result => {
      if (inFlight.current === destKey) inFlight.current = null;
      if (!mounted.current) return;
      // A failed refetch keeps the last good route rather than blanking it.
      setFetched(prev => ({ destKey, at: Date.now(), result: result ?? (prev?.destKey === destKey ? prev.result : null) }));
      setNow(Date.now());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey, lat, lng, fixAt]);

  const current = fetched && fetched.destKey === destKey ? fetched : null;
  if (!dest || !current?.result) {
    return { stop, minutes: null, arriveAt: null, coords: [], loading: !!dest && lat != null && !current, fetchedAt: null };
  }
  const arriveAt = new Date(current.at + current.result.minutes * 60_000);
  const minutes = Math.max(1, Math.round((arriveAt.getTime() - now) / 60_000));
  const coords = lat != null && lng != null ? locateOnRoute([lat, lng], current.result.coords).rest : current.result.coords;
  return { stop, minutes, arriveAt, coords, loading: false, fetchedAt: current.at };
}
