// ============================================================
// SERVICE WORKER — v4
//  - Stale-while-revalidate for static assets
//  - NEVER cache config.js, /exec URLs, or any script.google.com request
//  - Cache cleared when CACHE_NAME changes
// ============================================================

const CACHE_NAME = 'gemcor-wms-v4.0.86';
const RUNTIME_CACHE = 'gemcor-runtime-v4.0.0';

const STATIC_ASSETS = [
  '/GEMCORQR/',
  '/GEMCORQR/index.html',
  '/GEMCORQR/style.css',
  '/GEMCORQR/manifest.json',
  '/GEMCORQR/gemcor-logo.png',
  '/GEMCORQR/js/net.js',
  '/GEMCORQR/js/cache.js',
  '/GEMCORQR/js/utils.js',
  '/GEMCORQR/js/state.js',
  '/GEMCORQR/js/auth.js',
  '/GEMCORQR/js/scanner.js',
  '/GEMCORQR/js/warehouse.js',
  '/GEMCORQR/js/requests.js',
  '/GEMCORQR/js/inventory.js',
  '/GEMCORQR/js/prints.js',
  '/GEMCORQR/js/notifications.js',
  '/GEMCORQR/js/analytics.js',
  '/GEMCORQR/js/history.js',
  '/GEMCORQR/js/pending.js',
  '/GEMCORQR/js/chat.js',
  '/GEMCORQR/js/editRequests.js',
  '/GEMCORQR/js/main.js',
  '/GEMCORQR/js/update.js',
  '/GEMCORQR/js/prewarm.js'
];

// ─── NEVER cache these ───
function _shouldNeverCache(url) {
  if (!url) return true;
  if (url.indexOf('script.google.com') !== -1) return true;
  if (url.indexOf('macros/s/') !== -1) return true;
  if (url.indexOf('/exec') !== -1) return true;
  if (url.indexOf('config.js') !== -1) return true;
  return false;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .catch(err => console.warn('[SW] Install precache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.filter(n => n !== CACHE_NAME && n !== RUNTIME_CACHE)
             .map(n => caches.delete(n))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  var url = event.request.url;

  // Never intercept non-GET
  if (event.request.method !== 'GET') return;

  // Never intercept GAS/exec/config.js
  if (_shouldNeverCache(url)) return;

  // Only handle same-origin GEMCORQR requests
  if (url.indexOf('/GEMCORQR/') === -1) return;

  // Stale-while-revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(cache => {
      return cache.match(event.request).then(cached => {
        var networkFetch = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone()).catch(() => {});
          }
          return response;
        }).catch(() => cached);

        return cached || networkFetch;
      });
    })
  );
});
