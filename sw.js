const CACHE_NAME = 'gemcor-wms-v2.1.0';
const urlsToCache = [
  '/GEMCORQR/',
  '/GEMCORQR/index.html',
  '/GEMCORQR/style.css',
  '/GEMCORQR/gemcor-logo.png',
  '/GEMCORQR/js/config.js',
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
  '/GEMCORQR/js/main.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).then(
          fetchResponse => {
            if (!fetchResponse || fetchResponse.status !== 200) return fetchResponse;
            const responseToCache = fetchResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseToCache));
            return fetchResponse;
          }
        );
      })
      .catch(() => {
        // Offline fallback – show a basic offline page
        return new Response('You are offline. Please reconnect.', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      })
  );
});
