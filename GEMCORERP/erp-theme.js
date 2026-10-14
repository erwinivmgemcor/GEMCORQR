// ============================================================
// GEMCOR ERP — Theme Manager v2.0
// Single source of truth for Light/Dark/System themes
// ✅ 3 modes: light | dark | system
// ✅ Auto-detect system preference
// ✅ Save preference sa localStorage
// ✅ Apply before render (avoid flash)
// ✅ Listen for system theme changes
// ============================================================

(function() {
  'use strict';

  var THEME_KEY = 'erp_theme_mode';           // 'light' | 'dark' | 'system'
  var THEME_APPLIED_KEY = 'erp_theme_applied'; // resolved theme (for quick access)

  // ═══════════════════════════════════════════════════════════
  // PREVENT FLASH — Apply theme ASAP before DOM renders
  // ═══════════════════════════════════════════════════════════
  (function preventFlash() {
    try {
      // Add loading class para walang transition sa initial load
      document.documentElement.classList.add('theme-loading');

      var savedMode = localStorage.getItem(THEME_KEY) || 'system';
      var effective = savedMode;

      // Kung system mode, detect OS preference
      if (savedMode === 'system') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          effective = 'dark';
        } else {
          effective = 'light';
        }
      }

      // Apply agad sa <html> bago mag-render ang body
      document.documentElement.setAttribute('data-theme', effective);

      // Update meta theme-color
      var metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.content = effective === 'dark' ? '#0a1628' : '#1e3a5f';
      }
    } catch(e) {
      console.warn('[Theme] preventFlash error:', e);
    }
  })();

  // ═══════════════════════════════════════════════════════════
  // Get saved preference
  // ═══════════════════════════════════════════════════════════
  function getSavedMode() {
    try {
      return localStorage.getItem(THEME_KEY) || 'system';
    } catch(e) {
      return 'system';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Detect system preference
  // ═══════════════════════════════════════════════════════════
  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  // ═══════════════════════════════════════════════════════════
  // Resolve effective theme from mode
  // ═══════════════════════════════════════════════════════════
  function resolveTheme(mode) {
    if (mode === 'system') return getSystemTheme();
    return mode;
  }

  // ═══════════════════════════════════════════════════════════
  // Apply theme to DOM
  // ═══════════════════════════════════════════════════════════
  function applyTheme(mode) {
    var effective = resolveTheme(mode);
    
    // Set data-theme attribute sa <html>
    document.documentElement.setAttribute('data-theme', effective);
    
    // Save effective para sa quick access
    try {
      localStorage.setItem(THEME_APPLIED_KEY, effective);
    } catch(e) {}
    
    // Update toggle icons
    updateToggleIcons(effective);
    
    // Update meta theme-color (mobile browser address bar)
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = effective === 'dark' ? '#0a1628' : '#1e3a5f';
    }
    
    // Update theme menu active state
    updateThemeMenuActive(mode);
  }

  // ═══════════════════════════════════════════════════════════
  // Update all toggle button icons on page
  // ═══════════════════════════════════════════════════════════
  function updateToggleIcons(effective) {
    // Update all theme icons
    var icons = document.querySelectorAll('#themeIcon, .theme-icon');
    icons.forEach(function(icon) {
      icon.className = effective === 'dark' 
        ? 'bi bi-sun-fill' 
        : 'bi bi-moon-stars-fill';
    });
    
    // Update toggle button tooltip
    var btns = document.querySelectorAll('#themeToggleBtn, .theme-toggle-btn');
    btns.forEach(function(btn) {
      btn.title = effective === 'dark' 
        ? 'Switch to Light Mode' 
        : 'Switch to Dark Mode';
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Update theme menu active state
  // ═══════════════════════════════════════════════════════════
  function updateThemeMenuActive(mode) {
    var items = document.querySelectorAll('.theme-menu-item');
    items.forEach(function(item) {
      var itemMode = item.getAttribute('data-theme-mode');
      item.classList.toggle('active', itemMode === mode);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Toggle theme (cycle: light ↔ dark)
  // ═══════════════════════════════════════════════════════════
  function toggleTheme() {
    var currentMode = getSavedMode();
    var currentEffective = resolveTheme(currentMode);
    
    // Cycle: light ↔ dark
    var newMode = currentEffective === 'dark' ? 'light' : 'dark';
    
    try {
      localStorage.setItem(THEME_KEY, newMode);
    } catch(e) {}
    
    applyTheme(newMode);
    
    // Toast notification
    if (typeof erpShowToast === 'function') {
      erpShowToast(newMode === 'dark' ? '🌙 Dark mode' : '☀️ Light mode', 'info');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Set specific mode
  // ═══════════════════════════════════════════════════════════
  function setTheme(mode) {
    if (['light', 'dark', 'system'].indexOf(mode) === -1) return;
    
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch(e) {}
    
    applyTheme(mode);
    
    // Close theme menu kung bukas
    closeThemeMenu();
    
    // Toast notification
    if (typeof erpShowToast === 'function') {
      var labels = {
        light: '☀️ Light mode',
        dark: '🌙 Dark mode',
        system: '🖥️ System theme'
      };
      erpShowToast(labels[mode] || 'Theme changed', 'info');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Theme Menu (3 modes dropdown)
  // ═══════════════════════════════════════════════════════════
  function toggleThemeMenu() {
    var menu = document.getElementById('themeMenu');
    if (!menu) return;
    
    var isOpen = menu.classList.contains('open');
    
    // Close other menus
    document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
      m.classList.remove('open');
    });
    document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
      c.classList.remove('open');
    });
    
    if (!isOpen) {
      menu.classList.add('open');
      updateThemeMenuActive(getSavedMode());
    } else {
      menu.classList.remove('open');
    }
  }

  function closeThemeMenu() {
    var menu = document.getElementById('themeMenu');
    if (menu) menu.classList.remove('open');
  }

  // ═══════════════════════════════════════════════════════════
  // Initialize
  // ═══════════════════════════════════════════════════════════
  function init() {
    var savedMode = getSavedMode();
    applyTheme(savedMode);
    
    // Listen for system theme changes (kung naka-system mode)
    if (window.matchMedia) {
      var mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      var handleChange = function() {
        if (getSavedMode() === 'system') {
          applyTheme('system');
        }
      };
      
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleChange);
      }
    }
    
    // Remove loading class pagkatapos ng delay
    setTimeout(function() {
      document.documentElement.classList.remove('theme-loading');
    }, 100);
  }

  // Apply on init
  init();

  // Re-apply pagkatapos ng DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyTheme(getSavedMode());
    });
  } else {
    applyTheme(getSavedMode());
  }

  // Close theme menu kapag nag-click sa labas
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#themeMenu') && !e.target.closest('.theme-toggle-btn')) {
      closeThemeMenu();
    }
  });

  // Close sa ESC key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeThemeMenu();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Expose globals
  // ═══════════════════════════════════════════════════════════
  window.erpToggleTheme = toggleTheme;
  window.erpSetTheme = setTheme;
  window.erpGetTheme = function() { return getSavedMode(); };
  window.erpGetEffectiveTheme = function() { return resolveTheme(getSavedMode()); };
  window.erpToggleThemeMenu = toggleThemeMenu;
  window.erpCloseThemeMenu = closeThemeMenu;

  console.log('✅ erp-theme.js v2.0 loaded (3 modes: light/dark/system)');
})();
