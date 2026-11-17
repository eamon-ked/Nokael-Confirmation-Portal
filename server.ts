import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import fs from 'fs';
import { parseMapUrl, RESOLVABLE_HOST } from './src/lib/mapLink';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Records one APK download. Fire-and-forget: a failure here must never affect the
 * download. Uses the same public Supabase URL and anon key the web apps ship with.
 */
async function logApkDownload(req: express.Request, distPath: string) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    const ip = String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.ip ?? '').split(',')[0].trim();
    let version: string | null = null;
    try {
      version = JSON.parse(fs.readFileSync(path.join(distPath, 'android', 'version.json'), 'utf-8')).versionName ?? null;
    } catch { /* no manifest: count without a version */ }
    await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/log_app_download`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_version: version,
        p_ip_hash: ip ? createHash('sha256').update(`nokael-apk:${ip}`).digest('hex').slice(0, 32) : null,
        p_country: String(req.headers['cf-ipcountry'] ?? '') || null,
        p_user_agent: String(req.headers['user-agent'] ?? '') || null,
      }),
    });
  } catch (err) {
    console.warn('[apk] download not logged:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Map short links (maps.app.goo.gl/…, maps.apple/p/…) → a point or a place name
// ---------------------------------------------------------------------------
// Clients paste links shared from Google Maps / WhatsApp into the address
// fields (PlaceField). A short link is only a redirect the browser can't follow
// across origins, so we follow it here: Google / Apple map hosts only, a few hops, and a
// per-IP limit. Same logic as the dashboard's routes/maps.ts.
const MAPS_HOST = RESOLVABLE_HOST;
const resolveHits = new Map<string, number[]>();

async function expandMapsLink(start: string): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop < 6; hop++) {
    const url = new URL(current);
    if (url.protocol !== 'https:' || !MAPS_HOST.test(url.hostname)) return null;
    const parsed = parseMapUrl(current);
    if (parsed && parsed.kind !== 'short') return current;
    // Not a browser UA: maps.app.goo.gl answers browsers with a JavaScript page instead of the redirect.
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NokaelLinkResolver/1.0)' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) { current = new URL(location, current).toString(); continue; }
    return current;
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.post('/api/maps/resolve', express.json({ limit: '4kb' }), async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    const hits = (resolveHits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 20) return res.status(429).json({ error: 'Too many links. Try again in a minute.' });
    hits.push(now);
    resolveHits.set(ip, hits);
    if (resolveHits.size > 5000) resolveHits.clear();

    const raw = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!raw || raw.length > 2000) return res.status(400).json({ error: 'Paste a Google Maps link.' });
    try {
      const final = await expandMapsLink(raw);
      const parsed = final ? parseMapUrl(final) : null;
      if (!parsed || parsed.kind === 'short') return res.status(422).json({ error: 'Couldn’t read a location from that link.' });
      res.json(parsed);
    } catch {
      res.status(502).json({ error: 'Couldn’t reach Google Maps to open that link.' });
    }
  });

  // Client app manifest: one installable app per client app token, so the
  // home-screen icon opens /app/<token> (the re-booking app) rather than a
  // tracking link that closes 24h after delivery. A blob: manifest isn't
  // reliably installable in Chrome, hence a real URL. Registered before Vite
  // and the SPA catch-all so it works in dev and production.
  app.get('/app/:appToken/manifest.webmanifest', (req, res) => {
    const t = req.params.appToken;
    if (!/^[0-9a-f-]{36}$/i.test(t)) return res.sendStatus(404);
    res.set('Content-Type', 'application/manifest+json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(JSON.stringify({
      id: `/app/${t}`,
      name: 'Nokael — book a delivery',
      short_name: 'Nokael',
      description: 'Book and track Nokael deliveries.',
      start_url: `/app/${t}`,
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f2f4f7',
      theme_color: '#0f172a',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), 'dist');

    // Count Android APK downloads (public.log_app_download), then serve the file as usual.
    // Only a full GET counts: HEAD and resumed (Range) requests are the same download.
    // The database keeps one row per connection, version and day; the IP is only hashed.
    app.get('/android/nokael-driver.apk', (req, _res, next) => {
      const range = req.headers.range;
      if (!range || /^bytes=0-/.test(range)) void logApkDownload(req, distPath);
      next();
    });

    app.use(express.static(distPath));

    // Driver web app (PWA), built into dist/driver-app by `npm run build:driver`.
    // Shared with drivers as https://coc.nokael.com/driver-app/ — its routes live in
    // the URL hash, so anything else under the prefix just gets its index.html.
    const driverAppPath = path.join(distPath, 'driver-app');
    app.get('/driver-app/*', (req, res) => {
      // A missing file (e.g. an old hashed asset) is a real 404, never the HTML page.
      if (path.extname(req.path)) return res.sendStatus(404);
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(driverAppPath, 'index.html'));
    });

    // Client dashboard, built into dist/portal by `npm run build:portal` (own codebase
    // in client-portal/). Registered before the SPA catch-all so /portal/* never falls
    // through to the confirmation app's /:token/:step route.
    const portalPath = path.join(distPath, 'portal');
    app.use('/portal', express.static(portalPath, { index: false }));
    app.get(['/portal', '/portal/*'], (req, res) => {
      if (path.extname(req.path)) return res.sendStatus(404);
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(portalPath, 'index.html'));
    });
    
    // Handle SPA routing
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
