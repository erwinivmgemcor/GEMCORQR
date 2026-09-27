// ============================================================
// PRE-WARM — keep the GAS endpoint warm to avoid cold-start lag
// Pings the server every 4 minutes so the first user action in
// a session is instant (no 3-5s cold start).
// ============================================================

(function() {
  'use strict';

  var PREWARM_INTERVAL = 4 * 60 * 1000; // 4 minutes
  var _timer = null;
  var _lastPing = 0;

  function pingOnce() {
    if (!navigator.onLine) return;
    if (!window.API_URL) return;
    var now = Date.now();
    if (now - _lastPing < 60 * 1000) return; // don't ping more than once per minute
    _lastPing = now;

    // Fire-and-forget, no response handling
    fetch(window.API_URL + '?action=ping&_t=' + now, {
      redirect: 'follow',
      cache: 'no-store'
    }).catch(function() {});
  }

  function start() {
    if (_timer) clearInterval(_timer);
    pingOnce();
    _timer = setInterval(function() {
      if (!document.hidden) pingOnce();
    }, PREWARM_INTERVAL);
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  // Pause when hidden, resume when visible
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  });

  window.addEventListener('online', function() { pingOnce(); });

  // Expose
  window.prewarmGAS = pingOnce;
  window.startPrewarm = start;
  window.stopPrewarm = stop;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  console.log('✅ prewarm.js loaded — will ping GAS every 4 minutes');
})();
