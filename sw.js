// ============================================================
// GEMCOR ERP — Service Worker v5.0
//  - Cache-first for static assets (HTML, CSS, JS, images)
//  - Network-first for API calls (Supabase, GAS)
//  - Offline fallback page
//  - Auto-cleanup of old caches
//  - Background sync support
// ============================================================

const CACHE_VERSION = '5.0.0';
const STATIC_CACHE = `gemcor-erp-static-v${CACHE_VERSION}`;
const RUNTIME_CACHE = `gemcor-erp-runtime-v${CACHE_VERSION}`;
const OFFLINE_URL = '/GEMCORQR/GEMCORERP/offline.html';

// ═══════════════════════════════════════════════════════════
// STATIC ASSETS — Pre-cache on install
// ═══════════════════════════════════════════════════════════
const STATIC_ASSETS = [
  '/GEMCORQR/GEMCORERP/',
  '/GEMCORQR/GEMCORERP/index.html',
  '/GEMCORQR/GEMCORERP/login.html',
  '/GEMCORQR/GEMCORERP/offline.html',
  '/GEMCORQR/GEMCORERP/manifest.json',
  '/GEMCORQR/GEMCORERP/erp-config.js',
  '/GEMCORQR/GEMCORERP/erp-theme.js',
  '/GEMCORQR/GEMCORERP/erp-guard.js',
  '/GEMCORQR/GEMCORERP/erp-nav.js',
  '/GEMCORQR/GEMCORERP/erp-supabase.js',
  '/GEMCORQR/GEMCORERP/erp-nav.css',
  '/GEMCORQR/GEMCORERP/erp-notif.css',
  '/GEMCORQR/GEMCORERP/erp-styles.css',
  '/GEMCORQR/GEMCORERP/erp-design-system.css',
  '/GEMCORQR/GEMCORERP/erp-theme.css',
  '/GEMCORQR/GEMCORERP/admin-supabase.css',
  '/GEMCORQR/gemcor-logo.png'
];

// ═══════════════════════════════════════════════════════════
// NEVER CACHE — Supabase and API endpoints
// ═══════════════════════════════════════════════════════════
function _shouldNeverCache(url) {
  if (!url) return true;
  
  // Supabase endpoints — always fresh
  if (url.indexOf('supabase.co') !== -1) return true;
  if (url.indexOf('/rest/v1/') !== -1) return true;
  if (url.indexOf('/rpc/') !== -1) return true;
  if (url.indexOf('/auth/v1/') !== -1) return true;
  if (url.indexOf('/realtime/v1/') !== -1) return true;
  if (url.indexOf('/storage/v1/') !== -1) return true;
  
  // Google Apps Script
  if (url.indexOf('script.google.com') !== -1) return true;
  if (url.indexOf('macros/s/') !== -1) return true;
  if (url.indexOf('/exec') !== -1) return true;
  
  // External APIs
  if (url.indexOf('api.qrserver.com') !== -1) return true;
  if (url.indexOf('cdn.jsdelivr.net') !== -1) return true;
  if (url.indexOf('fonts.googleapis.com') !== -1) return true;
  if (url.indexOf('fonts.gstatic.com') !== -1) return true;
  if (url.indexOf('unpkg.com') !== -1) return true;
  
  return false;
}

// ═══════════════════════════════════════════════════════════
// INSTALL — Pre-cache static assets
// ═══════════════════════════════════════════════════════════
self.addEventListener('install', function(event) {
  console.log('[SW v5.0] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        console.log('[SW] Pre-caching', STATIC_ASSETS.length, 'static assets');
        return cache.addAll(STATIC_ASSETS).catch(function(err) {
          console.warn('[SW] Some assets failed to cache:', err);
        });
      })
      .then(function() {
        console.log('[SW] ✅ Install complete');
        return self.skipWaiting();
      })
  );
});

// ═══════════════════════════════════════════════════════════
// ACTIVATE — Clean up old caches
// ═══════════════════════════════════════════════════════════
self.addEventListener('activate', function(event) {
  console.log('[SW v5.0] Activating...');
  
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) {
          return n !== STATIC_CACHE && n !== RUNTIME_CACHE;
        }).map(function(n) {
          console.log('[SW] Deleting old cache:', n);
          return caches.delete(n);
        })
      );
    }).then(function() {
      console.log('[SW] ✅ Activated — claiming clients');
      return self.clients.claim();
    })
  );
});

// ═══════════════════════════════════════════════════════════
// MESSAGE — Handle SKIP_WAITING + other commands
// ═══════════════════════════════════════════════════════════
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(n) { return caches.delete(n); }));
      }).then(function() {
        console.log('[SW] All caches cleared');
      })
    );
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

// ═══════════════════════════════════════════════════════════
// FETCH — Cache strategy
// ═══════════════════════════════════════════════════════════
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip cross-origin requests
  if (url.indexOf('/GEMCORQR/') === -1 && url.indexOf(self.location.origin) === -1) {
    return;
  }
  
  // Never cache API calls
  if (_shouldNeverCache(url)) {
    // Network-first with no cache fallback for APIs
    return;
  }
  
  // Handle navigation requests (HTML pages) — offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Cache successful navigation
          if (response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(RUNTIME_CACHE).then(function(cache) {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline — try cache, then offline page
          return caches.match(event.request)
            .then(function(cached) {
              if (cached) return cached;
              return caches.match(OFFLINE_URL);
            });
        })
    );
    return;
  }
  
  // For other GET requests — stale-while-revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(function(cache) {
      return cache.match(event.request).then(function(cached) {
        var networkFetch = fetch(event.request).then(function(response) {
          // Cache successful responses
          if (response && response.status === 200) {
            cache.put(event.request, response.clone()).catch(function() {});
          }
          return response;
        }).catch(function() {
          // Network failed — return cached if available
          return cached;
        });
        
        // Return cached first (fast), network updates in background
        return cached || networkFetch;
      });
    })
  );
});

// ═══════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Stub (disabled for now)
// ═══════════════════════════════════════════════════════════
self.addEventListener('push', function(event) {
  console.log('[SW] Push received (not implemented)');
  // Placeholder — enable later if needed
});

// ═══════════════════════════════════════════════════════════
// BACKGROUND SYNC — Stub
// ═══════════════════════════════════════════════════════════
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-queue') {
    console.log('[SW] Background sync triggered');
    // Placeholder — enable later if needed
  }
});

console.log('[SW] Service Worker v5.0 loaded');
