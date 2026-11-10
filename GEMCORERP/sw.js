// ============================================================
// GEMCOR ERP — Service Worker v1.0
//  - Cache-first for static assets (HTML, CSS, JS, images)
//  - Network-first for API calls (Supabase)
//  - NEVER cache Supabase endpoints
//  - Auto-cleanup of old caches
// ============================================================

const CACHE_NAME = 'gemcor-erp-v1.0.22';
const RUNTIME_CACHE = 'gemcor-erp-runtime-v1.0.22';

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
  '/GEMCORQR/GEMCORERP/erp-profile.js',
  '/GEMCORQR/GEMCORERP/erp-profile.css',
  '/GEMCORQR/GEMCORERP/erp-avatars.js',
  '/GEMCORQR/GEMCORERP/erp-chat-alerts.js',
  '/GEMCORQR/GEMCORERP/erp-notif.css',
  '/GEMCORQR/GEMCORERP/erp-styles.css',
  '/GEMCORQR/GEMCORERP/js/update.js',
  // ── Offline page + Break Room (Crate Blast) ──
  '/GEMCORQR/GEMCORERP/offline.html',
  '/GEMCORQR/GEMCORERP/block-blast.html',
  '/GEMCORQR/GEMCORERP/blockblast.js',
  '/GEMCORQR/GEMCORERP/blockblast.css',
  '/GEMCORQR/GEMCORERP/erp-netwatch.js',
  '/GEMCORQR/GEMCORERP/fonts/BarlowCondensed-700.woff2',
  '/GEMCORQR/GEMCORERP/fonts/BarlowCondensed-800.woff2',
  '/GEMCORQR/gemcor-logo.png'
];

// ═══════════════════════════════════════════════════════════
// OFFLINE FALLBACK — kapag pumalya ang network at walang cached
// na kopya ng page, ibigay ang offline.html (may laro).
// ═══════════════════════════════════════════════════════════
var OFFLINE_URL = '/GEMCORQR/GEMCORERP/offline.html';

function _offlineFallback(request) {
  if (request.mode === 'navigate') {
    return caches.match(OFFLINE_URL).then(function(r) {
      return r || new Response('Offline', { status: 503, statusText: 'Offline' });
    });
  }
  return Response.error();
}

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
  
  var path = url.split('?')[0];

  // ═══ INSTANT: Break Room (game) at offline page — cache muna, update sa background ═══
  // Walang hinihintay na network, kaya agad bumubukas kahit walang internet / mahina ang signal.
  if (/\/(block-blast\.html|blockblast\.js|blockblast\.css|offline\.html|erp-netwatch\.js)$/i.test(path)) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(function(cached) {
        var update = fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(event.request, copy); }).catch(function() {});
          }
          return response;
        }).catch(function() { return cached || _offlineFallback(event.request); });
        return cached || update;
      })
    );
    return;
  }

  // ═══ Network-first (may 3s timeout) para sa HTML/JS/CSS — laging bago ang code,
  //     pero kapag mabagal/walang net, cache ang gagamitin agad (hindi maghihintay ng minuto) ═══
  if (/\.(js|html|css)$/i.test(path)) {
    event.respondWith(
      new Promise(function(resolve) {
        var settled = false;
        function fromCache() {
          return caches.match(event.request, { ignoreSearch: true }).then(function(r) { return r || null; });
        }
        var timer = setTimeout(function() {
          fromCache().then(function(r) { if (r && !settled) { settled = true; resolve(r); } });
        }, 3000);
        fetch(event.request).then(function(response) {
          clearTimeout(timer);
          if (response && response.status === 200) {
            var copy = response.clone();
            caches.open(RUNTIME_CACHE).then(function(c) { c.put(event.request, copy); }).catch(function() {});
          }
          if (!settled) { settled = true; resolve(response); }
        }).catch(function() {
          clearTimeout(timer);
          if (settled) return;
          fromCache().then(function(r) { settled = true; resolve(r || _offlineFallback(event.request)); });
        });
      })
    );
    return;
  }

  // ═══ Stale-while-revalidate (images, etc.) ═══
  // Return cached version if available, fetch fresh in background
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(function(cache) {
      // Hanapin sa runtime cache, tapos sa precache (fonts, logo, atbp.)
      return cache.match(event.request).then(function(hit) {
        return hit || caches.match(event.request);
      }).then(function(cached) {
        var networkFetch = fetch(event.request).then(function(response) {
          // Cache successful responses
          if (response && response.status === 200) {
            cache.put(event.request, response.clone()).catch(function() {});
          }
          return response;
        }).catch(function() {
          // Network failed — return cached if available
          return cached || _offlineFallback(event.request);
        });
        
        // Return cached first (fast), network updates in background
        return cached || networkFetch;
      });
    })
  );
});

console.log('[SW] Service worker loaded');
