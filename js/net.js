// ============================================================
// NETWORK LAYER — safeFetch helper + offline pill
// v3 — REMOVED global fetch monkey-patch (was aborting GAS calls)
//      safeFetch is opt-in only. Default fetch has no timeout.
//      GAS cold starts can take 15-30s — we no longer abort them.
// ============================================================

// ─── Opt-in safeFetch (only use when you explicitly want retry+timeout) ───
window.safeFetch = async function(url, options, opts) {
  opts = opts || {};
  var retries = opts.retries != null ? opts.retries : 0;
  var timeout = opts.timeout || 90000;   // ★ 90s default (GAS cold starts)
  var lastErr = null;

  for (var attempt = 0; attempt <= retries; attempt++) {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, timeout);
    try {
      var fetchOpts = Object.assign({ signal: ctrl.signal, redirect: 'follow' }, options || {});
      var res = await fetch(url, fetchOpts);
      clearTimeout(timer);
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await new Promise(function(r) { setTimeout(r, 1500 * Math.pow(2, attempt)); });
          continue;
        }
        throw new Error('HTTP ' + res.status);
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // Never retry on abort — server may still be processing
      if (e.name === 'AbortError') throw e;
      if (attempt < retries) {
        await new Promise(function(r) { setTimeout(r, 1500 * Math.pow(2, attempt)); });
      }
    }
  }
  throw lastErr || new Error('Network failed');
};

// ─── Network status pill (bottom-right) ───
(function setupNetworkBanner() {
  if (document.getElementById('netPill')) return;

  var style = document.createElement('style');
  style.textContent = `
    #netPill {
      position: fixed; bottom: 20px; right: 20px; z-index: 99997;
      padding: 10px 16px 10px 14px; border-radius: 24px;
      font-weight: 600; font-size: 0.82rem; color: #fff;
      display: flex; align-items: center; gap: 8px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
      transform: translateY(120%);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s;
      opacity: 0; pointer-events: none;
      max-width: calc(100vw - 40px); white-space: nowrap;
    }
    #netPill.show { transform: translateY(0); opacity: 1; }
    #netPill.offline { background: #dc3545; }
    #netPill.slow    { background: #f59e0b; color: #1f2937; }
    #netPill.online  { background: #198754; }
    #netPill .net-dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: currentColor; opacity: 0.9;
      animation: netPulse 1.4s ease-in-out infinite; flex-shrink: 0;
    }
    #netPill.offline .net-dot,
    #netPill.online .net-dot { animation: none; }
    @keyframes netPulse {
      0%, 100% { opacity: 0.5; transform: scale(0.85); }
      50%      { opacity: 1;   transform: scale(1); }
    }
    @media (max-width: 576px) {
      #netPill { bottom: 12px; right: 12px; font-size: 0.75rem; padding: 8px 12px 8px 10px; }
    }
  `;
  document.head.appendChild(style);

  var pill = document.createElement('div');
  pill.id = 'netPill';
  pill.innerHTML = '<span class="net-dot"></span><span id="netPillText"></span>';
  document.body.appendChild(pill);

  var _hideTimer = null;

  function _showPill(text, cls, autoHideMs) {
    var textEl = document.getElementById('netPillText');
    if (textEl) textEl.textContent = text;
    pill.className = 'show ' + (cls || '');
    if (_hideTimer) clearTimeout(_hideTimer);
    if (autoHideMs) {
      _hideTimer = setTimeout(function() { pill.className = ''; }, autoHideMs);
    }
  }

  function _hidePill() {
    if (_hideTimer) clearTimeout(_hideTimer);
    pill.className = '';
  }

  window.addEventListener('online', function() {
    _showPill('Back online', 'online', 2000);
    setTimeout(function() {
      if (typeof flushOfflineQueue === 'function') flushOfflineQueue();
      if (typeof state !== 'undefined' && state.currentModule) {
        setTimeout(function() {
          if (typeof loadWarehouseNotifications === 'function') loadWarehouseNotifications();
          if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
        }, 500);
      }
    }, 300);
  });

  window.addEventListener('offline', function() {
    _showPill('Offline — showing cached data', 'offline', 0);
  });

  if (!navigator.onLine) _showPill('Offline — showing cached data', 'offline', 0);

  window.showNetPill = _showPill;
  window.hideNetPill = _hidePill;
})();

// ─── SWR helper ───
window.swrFetch = async function(url, cacheKey, ttl, opts) {
  var cached = (typeof getCache === 'function') ? getCache(cacheKey) : null;
  var fetchPromise = safeFetch(url, null, opts)
    .then(function(res) { return res.text(); })
    .then(function(text) {
      var trimmed = String(text || '').trim();
      if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
      var data = JSON.parse(trimmed);
      if (data && data.success !== false && typeof setCache === 'function') {
        try { setCache(cacheKey, data, ttl); } catch(e) {}
      }
      return data;
    })
    .catch(function(e) { throw e; });

  if (cached) {
    fetchPromise.catch(function() {});
    return cached;
  }
  return await fetchPromise;
};

// ─── Offline POST queue ───
var QUEUE_KEY = 'ivm_offlineQueue';

function _getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; }
}
function _saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch(e) {}
}

window.queueOfflinePost = function(url, body, label) {
  var q = _getQueue();
  q.push({ url: url, body: body, label: label || 'Transaction', ts: Date.now() });
  _saveQueue(q);
  if (typeof showToast === 'function') {
    showToast('📥 ' + label + ' saved offline. Will sync when connection returns.', 'warning');
  }
};

window.flushOfflineQueue = async function() {
  if (!navigator.onLine) return;
  var q = _getQueue();
  if (q.length === 0) return;
  var remaining = [];
  var successCount = 0;
  for (var i = 0; i < q.length; i++) {
    try {
      var res = await fetch(q[i].url, {
        method: 'POST',
        body: q[i].body,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow'
      });
      var text = await res.text();
      var trimmed = String(text || '').trim();
      if (!trimmed || trimmed.charAt(0) === '<') { remaining.push(q[i]); continue; }
      var data = JSON.parse(trimmed);
      if (data && data.success) successCount++;
      else remaining.push(q[i]);
    } catch(e) {
      remaining.push(q[i]);
    }
  }
  _saveQueue(remaining);
  if (successCount > 0 && typeof showToast === 'function') {
    showToast('✅ Synced ' + successCount + ' queued transaction(s).', 'success');
    if (typeof fetchPendingDocs === 'function') fetchPendingDocs(true);
    if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
  }
};

window.addEventListener('online', function() {
  setTimeout(flushOfflineQueue, 1000);
});

setTimeout(function() {
  if (navigator.onLine && _getQueue().length > 0) flushOfflineQueue();
}, 3000);

console.log('✅ net.js loaded (v3 — no global fetch override, GAS-safe)');
