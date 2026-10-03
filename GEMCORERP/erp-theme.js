// ============================================================
// GEMCOR ERP — Shared Theme Manager
// Light / Dark / System toggle, shared across all ERP pages
// ============================================================

(function() {
  'use strict';

  var THEME_KEY = 'erp_theme';  // 'light' | 'dark' | 'system'

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'system';
    } catch(e) {
      return 'system';
    }
  }

  function getEffectiveTheme(theme) {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }

  function applyTheme(theme) {
    var effective = getEffectiveTheme(theme);
    document.documentElement.setAttribute('data-theme', effective);
    updateToggleButton(effective);
  }

  function updateToggleButton(effective) {
    var icon = document.getElementById('themeIcon');
    var btn = document.getElementById('themeToggleBtn');

    if (icon) {
      icon.className = effective === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    }
    if (btn) {
      btn.title = effective === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  }

  function toggleTheme() {
    var current = getStoredTheme();
    var effective = getEffectiveTheme(current);
    var next = effective === 'dark' ? 'light' : 'dark';

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch(e) {}

    applyTheme(next);

    // Toast (kung may erpShowToast function sa page)
    if (typeof window.erpShowToast === 'function') {
      window.erpShowToast(next === 'dark' ? '🌙 Dark mode on' : '☀️ Light mode on');
    } else if (typeof window.erpPrintShowToast === 'function') {
      window.erpPrintShowToast(next === 'dark' ? '🌙 Dark mode on' : '☀️ Light mode on');
    }
  }

  // ─── Initialize on load ───
  function init() {
    var saved = getStoredTheme();
    applyTheme(saved);

    // Watch OS theme changes (only if user chose 'system')
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
        if (getStoredTheme() === 'system') {
          applyTheme('system');
        }
      });
    }
  }

  // Apply ASAP (before render) to avoid flash
  init();

  // Re-apply after DOM loads (para ma-update yung icon kung existing)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyTheme(getStoredTheme());
    });
  } else {
    applyTheme(getStoredTheme());
  }

  // Expose globally
  window.erpToggleTheme = toggleTheme;
  window.erpApplyTheme = applyTheme;

  console.log('✅ erp-theme.js loaded');
})();
