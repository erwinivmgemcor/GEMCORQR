// ============================================================
// GEMCOR ERP — Theme Manager (Light Mode Only)
// v3.0 — Dark mode removed for stability
// ============================================================

(function() {
  'use strict';

  // Force light mode always
  function applyLightMode() {
    document.documentElement.setAttribute('data-theme', 'light');
    
    // Update meta theme-color
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = '#1e3a5f';
    }
    
    // Remove any saved dark theme preference
    try {
      localStorage.removeItem('erp_theme_mode');
      localStorage.removeItem('erp_theme_applied');
    } catch(e) {}
  }

  // Apply ASAP
  applyLightMode();

  // Re-apply on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLightMode);
  } else {
    applyLightMode();
  }

  // Stub functions para hindi mag-break ang existing code
  window.erpToggleTheme = function() {
    console.log('[Theme] Dark mode disabled');
  };
  window.erpSetTheme = function() {};
  window.erpGetTheme = function() { return 'light'; };
  window.erpGetEffectiveTheme = function() { return 'light'; };
  window.erpToggleThemeMenu = function() {};
  window.erpCloseThemeMenu = function() {};

  console.log('✅ erp-theme.js v3.0 loaded (light mode only)');
})();
