// ==========================================
// Google Maps links and pasted coordinates
// ==========================================
// Operators find places on Google Maps far more easily than on our map. This
// turns whatever they copy from it into a point:
//   • a full link   https://www.google.com/maps/place/Dubai+Mall/@25.19,55.27,17z/data=…!3d25.1975!4d55.2796
//   • a short link  https://maps.app.goo.gl/AbC123  (resolved server-side: /api/maps/resolve)
//   • coordinates   25.197525, 55.279601   ·   25°11'51.1"N 55°16'46.6"E
// Pure — no DOM, no fetch. Copy of nokael-concierge-V2/src/lib/mapLink.ts: keep them in step.

export type LatLng = [number, number];

export type MapInput =
  /** precise: the place's own pin (!3d!4d, q=, a typed pair) rather than the map's centre (@lat,lng). */
  | { kind: 'coords'; coords: LatLng; precise: boolean; name: string | null }
  /** A short link that only Google can expand. */
  | { kind: 'short'; url: string }
  /** A Google Maps link with a place name but no coordinates in it. */
  | { kind: 'place'; name: string };

const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co'];
// Links that only their own service can expand (followed server-side, /api/maps/resolve).
export const RESOLVABLE_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|consent\.google\.com|(www\.|maps\.)?google\.[a-z.]+|maps\.apple|(www\.)?maps\.apple\.com)$/i;

const inRange = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
    ? [lat, lng]
    : null;

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/** "25.1975, 55.2796" (also space- or semicolon-separated). */
const decimalPair = (s: string): LatLng | null => {
  const m = s.trim().match(new RegExp(String.raw`^\(?\s*(${NUM})\s*[,;\s]\s*(${NUM})\s*\)?$`));
  return m ? inRange(parseFloat(m[1]), parseFloat(m[2])) : null;
};

/** 25°11'51.1"N 55°16'46.6"E, 25.1975° N, 55.2796° E, N25 11.852 E55 16.777 … */
const hemispherePair = (s: string): LatLng | null => {
  const part = String.raw`([NS])?\s*(\d{1,3}(?:\.\d+)?)\s*°?\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′’]?\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|''|′′)?\s*)?([NSEW])?`;
  const m = s.trim().match(new RegExp(String.raw`^${part}\s*[,;]?\s*${part.replace('[NS]', '[EW]')}$`, 'i'));
  if (!m) return null;
  const toDeg = (pre: string | undefined, d: string, mi: string | undefined, se: string | undefined, post: string | undefined) => {
    const hemi = (pre || post || '').toUpperCase();
    const v = parseFloat(d) + (mi ? parseFloat(mi) / 60 : 0) + (se ? parseFloat(se) / 3600 : 0);
    return { v: hemi === 'S' || hemi === 'W' ? -v : v, hemi };
  };
  const a = toDeg(m[1], m[2], m[3], m[4], m[5]);
  const b = toDeg(m[6], m[7], m[8], m[9], m[10]);
  // Needs at least one hemisphere letter, or it's just a decimal pair.
  if (!a.hemi && !b.hemi) return null;
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === 'N' || b.hemi === 'S' || !b.hemi)) return inRange(b.v, a.v);
  return inRange(a.v, b.v);
};

const plainName = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const name = decodeURIComponent(s.replace(/\+/g, ' ')).trim();
  return name && !decimalPair(name) && !hemispherePair(name) ? name : null;
};

/** Read a Google Maps URL. Returns null for links that aren't Google Maps. */
export function parseGoogleMapsUrl(raw: string): MapInput | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.includes(host)) return { kind: 'short', url: url.toString() };

  // Consent interstitial (EU): the real link is in ?continue=.
  if (host === 'consent.google.com') {
    const next = url.searchParams.get('continue');
    return next ? parseGoogleMapsUrl(next) : null;
  }

  const isGoogle = /(^|\.)google\.[a-z.]+$/.test(host);
  if (!isGoogle || !(host.startsWith('maps.') || url.pathname.startsWith('/maps'))) return null;

  const full = decodeURIComponent(url.toString());
  const placeName = plainName(url.pathname.match(/\/maps\/place\/([^/@]+)/)?.[1]);

  // 1. The place's own pin, in the data= blob: …!3d25.1975!4d55.2796 (last pair wins).
  const pins = [...full.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const pin = pins.length ? inRange(parseFloat(pins[pins.length - 1][1]), parseFloat(pins[pins.length - 1][2])) : null;
  if (pin) return { kind: 'coords', coords: pin, precise: true, name: placeName };

  // 2. Coordinates given as the query: ?q=, ?query=, ?ll=, directions destination.
  for (const key of ['q', 'query', 'll', 'destination', 'daddr', 'center']) {
    const v = url.searchParams.get(key);
    const c = v ? decimalPair(v.replace(/^loc:/, '')) || hemispherePair(v) : null;
    if (c) return { kind: 'coords', coords: c, precise: key !== 'center', name: placeName };
  }

  // 3. Coordinates as the path: /maps/place/25.19,55.27  /maps/search/25.19,+55.27
  //    and dropped pins: /maps/place/25°11'51.1"N+55°16'46.6"E
  const pathPair = url.pathname.match(/\/maps\/(?:place|search|dir\/[^/]*)\/([^/@]+)/)?.[1];
  const pathText = pathPair ? decodeURIComponent(pathPair).replace(/\+/g, ' ') : '';
  const pathCoords = pathText ? decimalPair(pathText) || hemispherePair(pathText) : null;
  if (pathCoords) return { kind: 'coords', coords: pathCoords, precise: true, name: null };

  // 4. Only the map's centre: …/@25.19,55.27,17z — close, but check the pin.
  const at = full.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const centre = at ? inRange(parseFloat(at[1]), parseFloat(at[2])) : null;
  if (centre) return { kind: 'coords', coords: centre, precise: false, name: placeName };

  // 5. A name only (…/maps/place/Dubai+Mall or ?q=Dubai+Mall) — search for it.
  const name = placeName ?? plainName(url.searchParams.get('q') ?? url.searchParams.get('query'));
  return name ? { kind: 'place', name } : null;
}

// ── Waze ────────────────────────────────────────────────────────────────────
// Shared as "Use Waze to drive to …: https://waze.com/ul/hthqejr0bf". The part
// after /ul/h is a geohash of the point, so no lookup is needed. Older links
// carry ?ll=lat,lng or ?to=ll.lat,lng.

const GEOHASH = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Centre of a geohash cell (9 characters ≈ ±2 m). */
export function decodeGeohash(hash: string): LatLng | null {
  let lat: [number, number] = [-90, 90];
  let lng: [number, number] = [-180, 180];
  let even = true;
  for (const ch of hash.toLowerCase()) {
    const v = GEOHASH.indexOf(ch);
    if (v < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((v >> bit) & 1) range[0] = mid; else range[1] = mid;
      even = !even;
    }
  }
  return hash.length >= 5 ? inRange((lat[0] + lat[1]) / 2, (lng[0] + lng[1]) / 2) : null;
}

export function parseWazeUrl(url: URL): MapInput | null {
  if (!/(^|\.)waze\.com$/i.test(url.hostname)) return null;
  const gh = url.pathname.match(/\/ul\/h([0-9b-hjkmnp-z]{5,12})\/?$/i)?.[1];
  if (gh) {
    const c = decodeGeohash(gh);
    if (c) return { kind: 'coords', coords: c, precise: gh.length >= 8, name: null };
  }
  for (const key of ['ll', 'to', 'latlng', 'from']) {
    const v = url.searchParams.get(key)?.replace(/^ll\./, '');
    const c = v ? decimalPair(v) : null;
    if (c) return { kind: 'coords', coords: c, precise: true, name: null };
  }
  const q = plainName(url.searchParams.get('q'));
  return q ? { kind: 'place', name: q } : null;
}

// ── Apple Maps ──────────────────────────────────────────────────────────────
// maps.apple/p/… is a short link (resolved server-side) to
// maps.apple.com/place?coordinate=24.47,54.37&name=…; older links use ?ll=,
// ?daddr=, ?sll= or ?q= / ?address=.

export function parseAppleUrl(url: URL): MapInput | null {
  const host = url.hostname.toLowerCase();
  if (host === 'maps.apple') return { kind: 'short', url: url.toString() };
  if (host !== 'maps.apple.com' && host !== 'www.maps.apple.com') return null;
  const rawName = plainName(url.searchParams.get('name') ?? url.searchParams.get('q') ?? url.searchParams.get('address'));
  const name = rawName && !/^(my location|dropped pin)$/i.test(rawName) ? rawName : null;
  for (const key of ['coordinate', 'll', 'daddr', 'q', 'sll', 'center']) {
    const c = decimalPair(url.searchParams.get(key) ?? '');
    if (c) return { kind: 'coords', coords: c, precise: key !== 'sll' && key !== 'center', name };
  }
  return name ? { kind: 'place', name } : null;
}

/** Any supported map link: Google Maps, Waze or Apple Maps. Null for other links. */
export function parseMapUrl(raw: string): MapInput | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return parseWazeUrl(url) ?? parseAppleUrl(url) ?? parseGoogleMapsUrl(raw);
}

/** Anything pasted into the search box that names a point. Null means: plain text, search it. */
export function parseMapInput(text: string): MapInput | null {
  const s = text.trim();
  if (!s) return null;
  // A link anywhere in the text ("Use Waze to drive to …: https://waze.com/ul/…").
  const link = s.match(/https?:\/\/\S+/)?.[0];
  if (link) return parseMapUrl(link.replace(/[).,]+$/, ''));
  const coords = decimalPair(s) || hemispherePair(s);
  return coords ? { kind: 'coords', coords, precise: true, name: null } : null;
}
