// ============================================================
// NETWORK LAYER — Retry, timeout, offline banner, safe fetch
// ============================================================

// ─── Safe fetch: retry with exponential backoff + timeout ───
window.safeFetch = async function(url, options, opts) {
  opts = opts || {};
  var retries = opts.retries != null ? opts.retries : 2;
  var timeout = opts.timeout || 20000;
  var lastErr = null;

  for (var attempt = 0; attempt <= retries; attempt++) {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, timeout);
    try {
      var fetchOpts = Object.assign({ signal: ctrl.signal, redirect: 'follow' }, options || {});
      var res = await fetch(url, fetchOpts);
      clearTimeout(timer);
      if (!res.ok) {
        // Retry on 5xx but not on 4xx
        if (res.status >= 500 && attempt < retries) {
          await new Promise(function(r) { setTimeout(r, 400 * Math.pow(2, attempt)); });
          continue;
        }
        throw new Error('HTTP ' + res.status);
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        await new Promise(function(r) { setTimeout(r, 400 * Math.pow(2, attempt)); });
      }
    }
  }
  throw lastErr || new Error('Network failed');
};

// ─── Online/offline indicator ───
(function setupNetworkBanner() {
  if (document.getElementById('netBanner')) return;

  var style = document.createElement('style');
  style.textContent = `
    #netBanner {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 99997;
      padding: 8px 16px;
      text-align: center;
      font-weight: 600;
      font-size: 0.9rem;
      color: #fff;
      transform: translateY(-100%);
      transition: transform 0.3s ease;
      pointer-events: none;
    }
    #netBanner.show { transform: translateY(0); }
    #netBanner.offline { background: #dc3545; }
    #netBanner.slow { background: #f59e0b; }
  `;
  document.head.appendChild(style);

  var banner = document.createElement('div');
  banner.id = 'netBanner';
  document.body.appendChild(banner);

  var _slowTimer = null;
  var _origFetch = window.fetch;
  var _pendingCount = 0;

  window.fetch = function(input, init) {
    var start = Date.now();
    _pendingCount++;
    if (_pendingCount > 0 && !_slowTimer) {
      _slowTimer = setTimeout(function() {
        banner.textContent = '⚠️ Slow connection detected...';
        banner.className = 'show slow';
      }, 6000);
    }
    var p = _origFetch.apply(this, arguments);
    p.finally(function() {
      _pendingCount--;
      if (_pendingCount <= 0) {
        _pendingCount = 0;
        clearTimeout(_slowTimer);
        _slowTimer = null;
        if (navigator.onLine) {
          banner.className = '';
        }
      }
    });
    return p;
  };

  window.addEventListener('online', function() {
    banner.textContent = '✅ Back online';
    banner.className = 'show slow';
    setTimeout(function() { banner.className = ''; }, 2000);
    if (typeof state !== 'undefined' && state.currentModule) {
      // refresh in background
      setTimeout(function() {
        if (typeof loadWarehouseNotifications === 'function') loadWarehouseNotifications();
        if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
      }, 500);
    }
  });

  window.addEventListener('offline', function() {
    banner.textContent = '📡 You are offline — showing cached data';
    banner.className = 'show offline';
  });

  if (!navigator.onLine) {
    banner.textContent = '📡 You are offline — showing cached data';
    banner.className = 'show offline';
  }
})();

// ─── Stale-while-revalidate helper ───
window.swrFetch = async function(url, cacheKey, ttl, opts) {
  var cached = (typeof getCache === 'function') ? getCache(cacheKey) : null;
  var fresh = null;
  var fetchPromise = safeFetch(url, null, opts)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.success !== false && typeof setCache === 'function') {
        try { setCache(cacheKey, data, ttl); } catch(e) {}
      }
      return data;
    })
    .catch(function(e) { throw e; });

  if (cached) {
    // Return cached immediately, refresh in background
    fetchPromise.catch(function() {});
    return cached;
  }
  return await fetchPromise;
};

console.log('✅ net.js loaded');
