/**
 * Service Worker for Nokael Confirmation Portal
 * Enables offline page loading and asset caching
 */

// Bump these version suffixes on every deploy that fixes a bug — the fetch
// handler below serves JS/CSS cache-first, so devices that already installed
// an old service worker will keep running a stale (possibly broken/
// misconfigured) bundle indefinitely unless the cache name changes.
const CACHE_NAME = 'nokael-v2';
const RUNTIME_CACHE = 'nokael-runtime-v2';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/nokael-logo.jpg',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/index.css',
  '/src/components/ConfirmationPage.tsx',
  '/src/lib/supabase.ts',
  '/src/lib/utils.ts',
  '/src/lib/offline.ts',
  '/src/lib/sync.ts',
  '/src/types.ts',
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching app shell');
      return cache.addAll(PRECACHE_ASSETS.map(url => new Request(url, { cache: 'reload' })));
    }).catch(err => {
      console.warn('[SW] Precache failed (non-critical):', err);
      // Don't fail install if precache fails - some assets may not exist yet
      return Promise.resolve();
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // Skip Supabase API calls (always try network)
  if (url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(request).catch((err) => {
        console.log('[SW] Supabase request failed (offline):', url.pathname);
        // Return a proper error response instead of letting it fail silently
        return new Response(
          JSON.stringify({ error: 'offline', message: 'No internet connection' }),
          { 
            status: 503, 
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // Network-first strategy for HTML pages
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch((err) => {
          console.log('[SW] Network failed, serving from cache:', request.url);
          // Network failed - try cache
          return caches.match(request).then((cached) => {
            if (cached) {
              console.log('[SW] Serving from cache (offline):', request.url);
              return cached;
            }
            // Return offline page if available
            return caches.match('/index.html').then((indexPage) => {
              if (indexPage) {
                return indexPage;
              }
              // Last resort - return error page
              return new Response(
                '<html><body><h1>Offline</h1><p>No internet connection and page not cached.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            });
          });
        })
    );
    return;
  }

  // Cache-first strategy for assets (JS, CSS, images)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Return cached version, but update in background
        fetch(request).then((response) => {
          if (response.ok) {
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, response);
            });
          }
        }).catch(() => {
          // Ignore background update errors
        });
        return cached;
      }

      // Not in cache - fetch from network
      return fetch(request).then((response) => {
        // Cache successful responses
        if (response.ok && (
          request.url.includes('.js') ||
          request.url.includes('.css') ||
          request.url.includes('.svg') ||
          request.url.includes('.png') ||
          request.url.includes('.jpg')
        )) {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch((err) => {
        console.log('[SW] Asset fetch failed:', request.url);
        // Return empty response for failed assets
        return new Response('', { status: 404, statusText: 'Not Found' });
      });
    })
  );
});

// Message event - manual cache refresh
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data === 'CACHE_CURRENT_PAGE') {
    // Cache the current page for offline use
    event.waitUntil(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.addAll([
          '/',
          '/index.html',
        ]);
      })
    );
  }
});