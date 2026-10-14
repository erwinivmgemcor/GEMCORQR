// ============================================================
// GEMCOR ERP — PWA Manager v1.0
//  - Service Worker registration + auto-update
//  - Install prompt (auto + manual)
//  - Offline detection + indicator
//  - Standalone detection
// ============================================================

(function() {
  'use strict';

  var _pwaState = {
    deferredPrompt: null,
    isInstalled: false,
    isStandalone: false,
    swRegistration: null,
    updateReady: false
  };

  // ═══════════════════════════════════════════════════════════
  // DETECT STANDALONE MODE
  // ═══════════════════════════════════════════════════════════
  function detectStandalone() {
    _pwaState.isStandalone = (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true ||
      document.referrer.indexOf('android-app://') === 0
    );
    
    console.log('[PWA] Standalone mode:', _pwaState.isStandalone);
    
    if (_pwaState.isStandalone) {
      document.documentElement.classList.add('pwa-standalone');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REGISTER SERVICE WORKER
  // ═══════════════════════════════════════════════════════════
  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service Worker not supported');
      return;
    }
    
    try {
      var reg = await navigator.serviceWorker.register('/GEMCORQR/GEMCORERP/sw.js', {
        scope: '/GEMCORQR/GEMCORERP/'
      });
      
      _pwaState.swRegistration = reg;
      console.log('[PWA] ✅ SW registered, scope:', reg.scope);
      
      // Check for updates
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        
        console.log('[PWA] New SW installing...');
        
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA] New version ready');
            _pwaState.updateReady = true;
            showUpdateBanner();
          }
        });
      });
      
      // Check for updates periodically (every 30 min)
      setInterval(function() {
        if (navigator.onLine) reg.update().catch(function() {});
      }, 30 * 60 * 1000);
      
      // Check on visibility change
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden && navigator.onLine) {
          reg.update().catch(function() {});
        }
      });
      
    } catch (err) {
      console.error('[PWA] SW registration failed:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INSTALL PROMPT
  // ═══════════════════════════════════════════════════════════
  window.addEventListener('beforeinstallprompt', function(e) {
    // Prevent default mini-infobar
    e.preventDefault();
    
    // Store event for later
    _pwaState.deferredPrompt = e;
    
    console.log('[PWA] Install prompt available');
    
    // Show auto-prompt banner (with delay)
    setTimeout(function() {
      showInstallBanner();
    }, 3000);
  });

  // Detect successful install
  window.addEventListener('appinstalled', function() {
    console.log('[PWA] ✅ App installed');
    _pwaState.isInstalled = true;
    _pwaState.deferredPrompt = null;
    hideInstallBanner();
    
    if (typeof erpShowToast === 'function') {
      erpShowToast('✅ GEMCOR ERP installed sa home screen!', 'success');
    }
  });

  // ═══════════════════════════════════════════════════════════
  // SHOW INSTALL BANNER
  // ═══════════════════════════════════════════════════════════
  function showInstallBanner() {
    // Huwag mag-show kung:
    // - Naka-install na
    // - Nasa standalone mode
    // - Naka-dismiss na (via localStorage)
    // - Walang deferred prompt
    
    if (_pwaState.isInstalled || _pwaState.isStandalone) return;
    if (!_pwaState.deferredPrompt) return;
    if (localStorage.getItem('pwa_install_dismissed') === 'true') return;
    
    var banner = document.getElementById('pwaInstallBanner');
    if (banner) {
      banner.style.display = 'flex';
      banner.style.animation = 'slideUpBanner 0.4s ease';
    }
  }

  function hideInstallBanner() {
    var banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════
  // INSTALL APP (triggered by user)
  // ═══════════════════════════════════════════════════════════
  async function installApp() {
    if (!_pwaState.deferredPrompt) {
      console.log('[PWA] No install prompt available');
      
      // Fallback instructions
      if (typeof erpShowToast === 'function') {
        erpShowToast('Para i-install: Browser menu (⋮) → "Add to Home Screen"', 'info');
      }
      return;
    }
    
    _pwaState.deferredPrompt.prompt();
    
    var { outcome } = await _pwaState.deferredPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    
    if (outcome === 'accepted') {
      console.log('[PWA] ✅ User accepted install');
    } else {
      console.log('[PWA] ❌ User dismissed install');
    }
    
    _pwaState.deferredPrompt = null;
    hideInstallBanner();
  }

  // ═══════════════════════════════════════════════════════════
  // DISMISS INSTALL BANNER (permanent)
  // ═══════════════════════════════════════════════════════════
  function dismissInstallBanner() {
    localStorage.setItem('pwa_install_dismissed', 'true');
    hideInstallBanner();
    console.log('[PWA] Install banner dismissed permanently');
  }

  // ═══════════════════════════════════════════════════════════
  // UPDATE BANNER
  // ═══════════════════════════════════════════════════════════
  function showUpdateBanner() {
    var banner = document.getElementById('pwaUpdateBanner');
    if (banner) {
      banner.style.display = 'flex';
      banner.style.animation = 'slideUpBanner 0.4s ease';
    }
  }

  function hideUpdateBanner() {
    var banner = document.getElementById('pwaUpdateBanner');
    if (banner) banner.style.display = 'none';
  }

  async function applyUpdate() {
    if (!_pwaState.swRegistration || !_pwaState.swRegistration.waiting) {
      console.log('[PWA] No update to apply');
      return;
    }
    
    _pwaState.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    
    setTimeout(function() {
      window.location.reload();
    }, 500);
  }

  // ═══════════════════════════════════════════════════════════
  // OFFLINE DETECTION
  // ═══════════════════════════════════════════════════════════
  function updateOnlineStatus() {
    var indicator = document.getElementById('pwaOfflineIndicator');
    var isOnline = navigator.onLine;
    
    console.log('[PWA] Online status:', isOnline);
    
    if (indicator) {
      indicator.style.display = isOnline ? 'none' : 'flex';
    }
    
    // Also check API health
    if (typeof checkApiHealth === 'function' && isOnline) {
      checkApiHealth(true).then(function(ok) {
        if (!ok && indicator) {
          indicator.style.display = 'flex';
          var text = document.getElementById('pwaOfflineText');
          if (text) text.textContent = 'API offline — cached data ang ginagamit';
        }
      });
    }
  }

  window.addEventListener('online', function() {
    console.log('[PWA] Back online');
    updateOnlineStatus();
    
    if (typeof erpShowToast === 'function') {
      erpShowToast('✅ Back online', 'success');
    }
  });

  window.addEventListener('offline', function() {
    console.log('[PWA] Offline');
    updateOnlineStatus();
    
    if (typeof erpShowToast === 'function') {
      erpShowToast('⚠️ Offline mode — cached data lang ang available', 'warning');
    }
  });

  // ═══════════════════════════════════════════════════════════
  // MANUAL INSTALL BUTTON
  // ═══════════════════════════════════════════════════════════
  function injectInstallButton() {
    // Skip kung naka-install na
    if (_pwaState.isInstalled || _pwaState.isStandalone) return;
    
    // Skip kung naka-dismiss na
    if (localStorage.getItem('pwa_install_dismissed') === 'true') return;
    
    // Check kung may existing install button na
    if (document.getElementById('pwaInstallBtn')) return;
    
    // Inject sa topbar
    var topbarRight = document.querySelector('.erp-thin-topbar-right');
    if (!topbarRight) return;
    
    var btn = document.createElement('button');
    btn.id = 'pwaInstallBtn';
    btn.className = 'erp-icon-btn';
    btn.title = 'Install GEMCOR ERP';
    btn.innerHTML = '<i class="bi bi-download"></i>';
    btn.onclick = installApp;
    
    // Insert before the last child (user menu)
    var lastChild = topbarRight.lastElementChild;
    if (lastChild) {
      topbarRight.insertBefore(btn, lastChild);
    } else {
      topbarRight.appendChild(btn);
    }
    
    console.log('[PWA] Install button injected');
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    detectStandalone();
    updateOnlineStatus();
    registerSW();
    
    // Inject install button after nav loads
    setTimeout(injectInstallButton, 1000);
  }

  // Expose globals
  window.pwaInstall = installApp;
  window.pwaDismissInstall = dismissInstallBanner;
  window.pwaApplyUpdate = applyUpdate;
  window.pwaHideUpdate = hideUpdateBanner;
  window.pwaIsStandalone = function() { return _pwaState.isStandalone; };
  window.pwaIsInstalled = function() { return _pwaState.isInstalled; };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('✅ pwa.js v1.0 loaded');
})();
