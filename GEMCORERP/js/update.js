// ============================================================
// GEMCOR ERP — Auto-Update System
//  - Detects new service worker versions
//  - Shows "Update Available" banner
//  - One-click update (no hard-refresh needed)
// ============================================================

(function() {
  'use strict';
  
  var CHECK_INTERVAL_MS = 15 * 60 * 1000;  // Check every 15 minutes
  var _registration = null;
  var _updateReady = false;
  var _reloading = false;
  
  // ═══════════════════════════════════════════════════════════
  // STYLES — Inject once
  // ═══════════════════════════════════════════════════════════
  function _ensureStyles() {
    if (document.getElementById('updateBannerStyles')) return;
    
    var style = document.createElement('style');
    style.id = 'updateBannerStyles';
    style.textContent = [
      '@keyframes pulseUpdateDot {',
      '  0%, 100% { transform: scale(1); opacity: 1; }',
      '  50% { transform: scale(1.3); opacity: 0.6; }',
      '}',
      '#gemcorUpdateBanner {',
      '  position: fixed;',
      '  top: 16px;',
      '  left: 50%;',
      '  transform: translateX(-50%) translateY(-150%);',
      '  z-index: 99999;',
      '  background: linear-gradient(135deg, #1e3a5f 0%, #2a4a73 100%);',
      '  color: #fff;',
      '  padding: 14px 22px;',
      '  border-radius: 14px;',
      '  box-shadow: 0 12px 40px rgba(0,0,0,0.35);',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 16px;',
      '  font-family: Inter, -apple-system, sans-serif;',
      '  font-size: 0.9rem;',
      '  font-weight: 600;',
      '  max-width: calc(100vw - 32px);',
      '  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s;',
      '  opacity: 0;',
      '  pointer-events: none;',
      '  border: 1px solid rgba(255,255,255,0.15);',
      '  flex-wrap: wrap;',
      '  justify-content: center;',
      '}',
      '#gemcorUpdateBanner.show {',
      '  transform: translateX(-50%) translateY(0);',
      '  opacity: 1;',
      '  pointer-events: auto;',
      '}',
      '#gemcorUpdateBanner .update-dot {',
      '  width: 10px;',
      '  height: 10px;',
      '  background: #22c55e;',
      '  border-radius: 50%;',
      '  box-shadow: 0 0 0 4px rgba(34,197,94,0.25);',
      '  animation: pulseUpdateDot 1.4s ease-in-out infinite;',
      '}',
      '#gemcorUpdateBanner .update-info {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  white-space: nowrap;',
      '}',
      '#gemcorUpdateBanner .update-hint {',
      '  font-weight: 400;',
      '  font-size: 0.82rem;',
      '  opacity: 0.85;',
      '  white-space: nowrap;',
      '}',
      '#gemcorUpdateBanner .update-btn {',
      '  background: #22c55e;',
      '  color: #fff;',
      '  border: none;',
      '  padding: 8px 18px;',
      '  border-radius: 8px;',
      '  font-weight: 700;',
      '  font-size: 0.85rem;',
      '  cursor: pointer;',
      '  transition: background 0.15s;',
      '  white-space: nowrap;',
      '  font-family: inherit;',
      '}',
      '#gemcorUpdateBanner .update-btn:hover {',
      '  background: #16a34a;',
      '}',
      '#gemcorUpdateBanner .update-btn:disabled {',
      '  opacity: 0.7;',
      '  cursor: wait;',
      '}',
      '#gemcorUpdateBanner .update-close {',
      '  background: transparent;',
      '  color: rgba(255,255,255,0.6);',
      '  border: none;',
      '  font-size: 1.3rem;',
      '  line-height: 1;',
      '  cursor: pointer;',
      '  padding: 4px 6px;',
      '  font-family: inherit;',
      '}',
      '#gemcorUpdateBanner .update-close:hover {',
      '  color: #fff;',
      '}',
      '@media (max-width: 540px) {',
      '  #gemcorUpdateBanner {',
      '    flex-direction: column;',
      '    text-align: center;',
      '    gap: 10px;',
      '    padding: 14px 16px;',
      '  }',
      '}'
    ].join('');
    document.head.appendChild(style);
  }
  
  // ═══════════════════════════════════════════════════════════
  // BUILD BANNER — Lazy creation
  // ═══════════════════════════════════════════════════════════
  function _ensureBanner() {
    var el = document.getElementById('gemcorUpdateBanner');
    if (el) return el;
    
    _ensureStyles();
    
    el = document.createElement('div');
    el.id = 'gemcorUpdateBanner';
    el.innerHTML = [
      '<span class="update-dot"></span>',
      '<span class="update-info">🆕 <strong>New version available!</strong></span>',
      '<span class="update-hint">Update to get the latest fixes.</span>',
      '<button class="update-btn" id="gemcorUpdateBtn" type="button">Update Now</button>',
      '<button class="update-close" id="gemcorUpdateClose" type="button" title="Later">×</button>'
    ].join('');
    
    document.body.appendChild(el);
    
    // Attach handlers
    document.getElementById('gemcorUpdateBtn').addEventListener('click', applyUpdate);
    document.getElementById('gemcorUpdateClose').addEventListener('click', hideBanner);
    
    return el;
  }
  
  // ═══════════════════════════════════════════════════════════
  // SHOW / HIDE BANNER
  // ═══════════════════════════════════════════════════════════
  function showBanner() {
    var el = _ensureBanner();
    requestAnimationFrame(function() {
      el.classList.add('show');
    });
  }
  
  function hideBanner() {
    var el = document.getElementById('gemcorUpdateBanner');
    if (el) el.classList.remove('show');
  }
  
  // ═══════════════════════════════════════════════════════════
  // APPLY UPDATE — Send SKIP_WAITING + reload
  // ═══════════════════════════════════════════════════════════
  function applyUpdate() {
    if (_reloading) return;
    _reloading = true;
    
    var btn = document.getElementById('gemcorUpdateBtn');
    if (btn) {
      btn.textContent = 'Updating...';
      btn.disabled = true;
    }
    
    var waitingWorker = _registration && _registration.waiting;
    
    if (waitingWorker) {
      // Send SKIP_WAITING signal to activate new SW
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      
      // Reload after a short delay
      setTimeout(function() {
        window.location.reload();
      }, 800);
    } else {
      // No waiting worker — just reload
      window.location.reload();
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // WATCH INSTALLING — Detect new version
  // ═══════════════════════════════════════════════════════════
  function _watchInstalling(worker) {
    worker.addEventListener('statechange', function() {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        console.log('[Update] New version ready');
        _updateReady = true;
        showBanner();
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // MANUAL CHECK — For debugging
  // ═══════════════════════════════════════════════════════════
  function checkForUpdates() {
    if (!_registration) {
      console.log('[Update] SW not registered yet');
      return;
    }
    
    console.log('[Update] Checking for updates...');
    
    _registration.update()
      .then(function() {
        if (_registration.waiting) {
          console.log('[Update] New version found');
          showBanner();
        } else {
          console.log('[Update] Already on latest version');
          if (typeof erpShowToast === 'function') {
            erpShowToast('✅ You are on the latest version', 'success');
          }
        }
      })
      .catch(function(err) {
        console.warn('[Update] Check failed:', err);
      });
  }
  
  // ═══════════════════════════════════════════════════════════
  // SETUP — Register SW, watch for updates
  // ═══════════════════════════════════════════════════════════
  function _setup() {
    _ensureStyles();
    
    // Expose globals
    window.gemcorCheckForUpdates = checkForUpdates;
    window.gemcorApplyUpdate = applyUpdate;
    window.gemcorShowUpdateBanner = showBanner;
    window.gemcorHideUpdateBanner = hideBanner;
    
    // Feature check
    if (!('serviceWorker' in navigator)) {
      console.log('[Update] Service Worker not supported');
      return;
    }
    
    // Register SW
    navigator.serviceWorker.register('/GEMCORQR/GEMCORERP/sw.js', {
      scope: '/GEMCORQR/GEMCORERP/'
    })
    .then(function(reg) {
      _registration = reg;
      console.log('[Update] SW registered, scope:', reg.scope);
      
      // Check if may waiting worker na (from previous session)
      if (reg.waiting && navigator.serviceWorker.controller) {
        console.log('[Update] Waiting worker found');
        _updateReady = true;
        showBanner();
      }
      
      // Listen for new installations
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        console.log('[Update] New worker installing...');
        _watchInstalling(newWorker);
      });
      
      // Auto-check periodically
      setInterval(function() {
        if (!navigator.onLine) return;
        reg.update().catch(function() {});
      }, CHECK_INTERVAL_MS);
      
      // Check when tab becomes visible
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden && navigator.onLine) {
          reg.update().catch(function() {});
        }
      });
      
      // Check when online
      window.addEventListener('online', function() {
        reg.update().catch(function() {});
      });
      
      // Initial check after page load
      setTimeout(function() { reg.update().catch(function() {}); }, 10000);
      setTimeout(function() { reg.update().catch(function() {}); }, 60000);
    })
    .catch(function(err) {
      console.warn('[Update] SW registration failed:', err);
    });
    
    // Handle controllerchange (SW took over)
    var _refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (_refreshing) return;
      _refreshing = true;
      
      if (_reloading || _updateReady) {
        console.log('[Update] Reloading page after SW activation');
        window.location.reload();
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _setup);
  } else {
    _setup();
  }
  
  console.log('[Update] Auto-update system loaded');
})();
