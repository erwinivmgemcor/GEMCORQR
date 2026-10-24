// ============================================================
// GEMCOR ERP — Service Worker v1.0
//  - Cache-first for static assets (HTML, CSS, JS, images)
//  - Network-first for API calls (Supabase)
//  - NEVER cache Supabase endpoints
//  - Auto-cleanup of old caches
// ============================================================

const CACHE_NAME = 'gemcor-erp-v1.0.1';
const RUNTIME_CACHE = 'gemcor-erp-runtime-v1.0.1';

// ═══════════════════════════════════════════════════════════
// STATIC ASSETS — Pre-cache on install
// ═══════════════════════════════════════════════════════════
const STATIC_ASSETS = [
  '/GEMCORQR/GEMCORERP/',
  '/GEMCORQR/GEMCORERP/index.html',
  '/GEMCORQR/GEMCORERP/login.html',
  '/GEMCORQR/GEMCORERP/manifest.json',
  '/GEMCORQR/GEMCORERP/erp-config.js',
  '/GEMCORQR/GEMCORERP/erp-theme.js',
  '/GEMCORQR/GEMCORERP/erp-guard.js',
  '/GEMCORQR/GEMCORERP/erp-nav.js',
  '/GEMCORQR/GEMCORERP/erp-supabase.js',
  '/GEMCORQR/GEMCORERP/erp-nav.css',
  '/GEMCORQR/GEMCORERP/erp-notif.css',
  '/GEMCORQR/GEMCORERP/erp-styles.css',
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
  
  // Google Apps Script (legacy)
  if (url.indexOf('script.google.com') !== -1) return true;
  if (url.indexOf('macros/s/') !== -1) return true;
  if (url.indexOf('/exec') !== -1) return true;
  
  // External APIs
  if (url.indexOf('api.qrserver.com') !== -1) return true;
  
  return false;
}

// ═══════════════════════════════════════════════════════════
// INSTALL — Pre-cache static assets
// ═══════════════════════════════════════════════════════════
self.addEventListener('install', function(event) {
  console.log('[SW] Installing v1.0.0...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS).catch(function(err) {
          console.warn('[SW] Some assets failed to cache:', err);
        });
      })
      .then(function() {
        console.log('[SW] ✅ Install complete');
        return self.skipWaiting();  // Activate immediately
      })
  );
});

// ═══════════════════════════════════════════════════════════
// ACTIVATE — Clean up old caches
// ═══════════════════════════════════════════════════════════
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating v1.0.0...');
  
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) {
          return n !== CACHE_NAME && n !== RUNTIME_CACHE;
        }).map(function(n) {
          console.log('[SW] Deleting old cache:', n);
          return caches.delete(n);
        })
      );
    }).then(function() {
      console.log('[SW] ✅ Activated — claiming clients');
      return self.clients.claim();  // Take control immediately
    })
  );
});

// ═══════════════════════════════════════════════════════════
// MESSAGE — Handle SKIP_WAITING from update banner
// ═══════════════════════════════════════════════════════════
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received — activating new version');
    self.skipWaiting();
  }
});

// ═══════════════════════════════════════════════════════════
// FETCH — Cache strategy
// ═══════════════════════════════════════════════════════════
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  
  // Never cache Supabase/API
  if (_shouldNeverCache(url)) {
    // Let browser handle it directly
    return;
  }
  
  // Only handle same-origin requests
  if (url.indexOf('/GEMCORQR/') === -1) return;
  
  // ═══ Network-first for HTML/JS/CSS — para laging bago ang code (iwas lumang JS) ═══
  var path = url.split('?')[0];
  if (/\.(js|html|css)$/i.test(path)) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(RUNTIME_CACHE).then(function(c) { c.put(event.request, copy); }).catch(function() {});
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // ═══ Stale-while-revalidate (images, etc.) ═══
  // Return cached version if available, fetch fresh in background
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

console.log('[SW] Service worker loaded');
