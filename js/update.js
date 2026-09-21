// ============================================================
// AUTO-UPDATE SYSTEM
// Detects new service worker versions, shows a prominent
// "New version available" banner, and updates in one click.
// ============================================================

(function() {
  'use strict';

  var CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
  var _registration = null;
  var _updateReady = false;
  var _reloading = false;

  // ─── Inject banner CSS once ───
  function _ensureStyles() {
    if (document.getElementById('updateBannerStyles')) return;
    var style = document.createElement('style');
    style.id = 'updateBannerStyles';
    style.textContent =
      '@keyframes pulseUpdate {' +
      '  0%, 100% { box-shadow: 0 0 0 4px rgba(34,197,94,0.25); }' +
      '  50%      { box-shadow: 0 0 0 10px rgba(34,197,94,0); }' +
      '}' +
      '#updateBanner button:hover { opacity: 0.92; }' +
      '#updateBanner #updateBannerBtn:hover { background: #16a34a !important; }' +
      '@media (max-width: 540px) {' +
      '  #updateBanner { flex-direction: column; text-align: center; gap: 10px; padding: 14px 16px !important; }' +
      '}' +
      '#sidebarAppVersion { cursor: pointer; transition: color 0.15s; }' +
      '#sidebarAppVersion:hover { color: #fff !important; }' +
      '#sidebarAppVersion .update-dot {' +
      '  display: inline-block; width: 8px; height: 8px; border-radius: 50%;' +
      '  background: #f59e0b; margin-left: 6px; vertical-align: middle;' +
      '  animation: pulseUpdate 1.6s ease-in-out infinite;' +
      '}';
    document.head.appendChild(style);
  }

  // ─── Build (or return) the update banner ───
  function _ensureBanner() {
    var el = document.getElementById('updateBanner');
    if (el) return el;
    _ensureStyles();

    el = document.createElement('div');
    el.id = 'updateBanner';
    el.style.cssText = [
      'position:fixed',
      'top:16px',
      'left:50%',
      'transform:translateX(-50%) translateY(-150%)',
      'z-index:99999',
      'background:linear-gradient(135deg, #1e3a5f 0%, #2a4a73 100%)',
      'color:#fff',
      'padding:14px 20px',
      'border-radius:14px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.35)',
      'display:flex',
      'align-items:center',
      'gap:16px',
      'font-family:inherit',
      'font-size:0.9rem',
      'font-weight:600',
      'max-width:calc(100vw - 32px)',
      'transition:transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s',
      'opacity:0',
      'pointer-events:none',
      'border:1px solid rgba(255,255,255,0.15)',
      'flex-wrap:wrap',
      'justify-content:center'
    ].join(';');

    el.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:10px;white-space:nowrap;">' +
        '<span style="width:10px;height:10px;background:#22c55e;border-radius:50%;box-shadow:0 0 0 4px rgba(34,197,94,0.25);animation:pulseUpdate 1.6s ease-in-out infinite;"></span>' +
        '<span>🆕 <strong>New version available!</strong></span>' +
      '</span>' +
      '<span style="font-weight:400;font-size:0.82rem;opacity:0.85;white-space:nowrap;">' +
        'Update now to get the latest fixes.' +
      '</span>' +
      '<button id="updateBannerBtn" type="button" style="' +
        'background:#22c55e;color:#fff;border:none;padding:8px 18px;' +
        'border-radius:8px;font-weight:700;font-size:0.85rem;cursor:pointer;' +
        'transition:background 0.15s;white-space:nowrap;' +
      '">Update Now</button>' +
      '<button id="updateBannerDismiss" type="button" title="Later" style="' +
        'background:transparent;color:rgba(255,255,255,0.6);border:none;' +
        'font-size:1.2rem;line-height:1;cursor:pointer;padding:4px 6px;' +
      '">×</button>';

    document.body.appendChild(el);

    document.getElementById('updateBannerBtn').addEventListener('click', function() {
      applyUpdate();
    });
    document.getElementById('updateBannerDismiss').addEventListener('click', function() {
      hideBanner();
    });

    return el;
  }

  function showBanner() {
    var el = _ensureBanner();
    // Reflect availability on the sidebar version too
    _flagSidebarVersion(true);
    requestAnimationFrame(function() {
      el.style.transform = 'translateX(-50%) translateY(0)';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    });
  }

  function hideBanner() {
    var el = document.getElementById('updateBanner');
    if (!el) return;
    el.style.transform = 'translateX(-50%) translateY(-150%)';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
  }

  // ─── Add a small pulsing dot next to the version in the sidebar ───
  function _flagSidebarVersion(show) {
    var el = document.getElementById('sidebarAppVersion');
    if (!el) return;
    var dot = el.querySelector('.update-dot');
    if (show && !dot) {
      var span = document.createElement('span');
      span.className = 'update-dot';
      span.title = 'New version available — click to update';
      el.appendChild(span);
    } else if (!show && dot) {
      dot.remove();
    }
  }

  // ─── Apply the update ───
  function applyUpdate() {
    if (_reloading) return;
    _reloading = true;

    var btn = document.getElementById('updateBannerBtn');
    if (btn) {
      btn.textContent = 'Updating...';
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
    }

    var waitingWorker = _registration && _registration.waiting;
    if (waitingWorker) {
      // Tell the waiting SW to take over immediately
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      // Fallback: if controllerchange doesn't fire in 1.5s, force reload anyway
      setTimeout(function() {
        if (_reloading) window.location.reload();
      }, 1500);
    } else {
      // No waiting worker → hard reload
      window.location.reload();
    }
  }

  // ─── Watch a newly-installing SW ───
  function _watchInstalling(worker) {
    worker.addEventListener('statechange', function() {
      if (worker.state === 'installed') {
        if (navigator.serviceWorker.controller) {
          // A new SW is installed and waiting → this is a genuine update
          _updateReady = true;
          showBanner();
        }
        // else: first-ever install → nothing to update
      }
    });
  }

  // ─── Wire up the SW ───
  function _setup() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/GEMCORQR/sw.js')
      .then(function(reg) {
        _registration = reg;

        // Case 1: A new SW is already waiting when the page loads
        if (reg.waiting && navigator.serviceWorker.controller) {
          _updateReady = true;
          showBanner();
        }

        // Case 2: A new SW installs after the page loads
        reg.addEventListener('updatefound', function() {
          var newWorker = reg.installing;
          if (!newWorker) return;
          _watchInstalling(newWorker);
        });

        // Poll for updates every 15 min
        setInterval(function() {
          if (!navigator.onLine) return;
          reg.update().catch(function() {});
        }, CHECK_INTERVAL_MS);

        // Also check when the tab regains focus
        document.addEventListener('visibilitychange', function() {
          if (!document.hidden && navigator.onLine) {
            reg.update().catch(function() {});
          }
        });

        // And when we come back online
        window.addEventListener('online', function() {
          reg.update().catch(function() {});
        });

        // Quick boot check: 20s and 60s after page load
        setTimeout(function() { reg.update().catch(function() {}); }, 20000);
        setTimeout(function() { reg.update().catch(function() {}); }, 60000);
      })
      .catch(function(err) {
        console.warn('[SW] Registration failed:', err);
      });

    // When the new SW takes over → reload the page once
    var _refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (_refreshing) return;
      _refreshing = true;
      if (_reloading || _updateReady) {
        window.location.reload();
      }
    });

    // Click the sidebar version footer to manually check
    document.addEventListener('click', function(e) {
      var target = e.target.closest && e.target.closest('#sidebarAppVersion');
      if (!target) return;
      window.checkForUpdates();
    });

    // Expose manual trigger for debugging / app code
    window.checkForUpdates = function() {
      if (!_registration) {
        if (typeof showToast === 'function') showToast('Update system not ready yet.', 'warning');
        return;
      }
      if (typeof showToast === 'function') showToast('Checking for updates...', 'info');
      _registration.update().then(function() {
        if (_registration.waiting) {
          showBanner();
        } else {
          if (typeof showToast === 'function') showToast('✅ You are on the latest version.', 'success');
        }
      }).catch(function() {
        if (typeof showToast === 'function') showToast('Update check failed.', 'warning');
      });
    };
    window.applyAppUpdate = applyUpdate;
    window.showUpdateBanner = showBanner;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setup);
  } else {
    _setup();
  }
})();
