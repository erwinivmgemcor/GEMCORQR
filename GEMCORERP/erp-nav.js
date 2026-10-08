// ============================================================
// GEMCOR ERP — Navigation System v6.0
// Stripe + GitHub Hybrid Design
// ============================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // NAV STRUCTURE
  // ═══════════════════════════════════════════════════════════
  var NAV_GROUPS = [
    {
      id: 'main',
      label: '',
      items: [
        { id: 'management-dashboard', label: 'Dashboard', icon: 'bi-grid-1x2-fill', href: 'management-dashboard.html', roles: ['warehouse'] },
        { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-box-seam-fill', href: 'stock-monitor.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      items: [
        { id: 'inventory-count', label: 'Inventory Count', icon: 'bi-clipboard-check-fill', href: 'inventory-count.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'documents',
      label: 'Documents',
      items: [
        { id: 'all-requests', label: 'All Requests', icon: 'bi-inbox-fill', href: 'all-requests.html', roles: ['warehouse'] },
        { id: 'mrif-list', label: 'MRIF — Issuance', icon: 'bi-box-arrow-up-right', href: 'mrif-list.html', roles: ['warehouse'] },
        { id: 'mrr-list', label: 'MRR — Receiving', icon: 'bi-box-arrow-in-down', href: 'mrr-list.html', roles: ['warehouse'] },
        { id: 'mrs-list', label: 'MRS — Returns', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html', roles: ['warehouse'] },
        { id: 'prf-monitor', label: 'PRF Monitor', icon: 'bi-file-earmark-text-fill', href: 'prf-monitor.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'reports',
      label: 'Reports',
      items: [
        { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week-fill', href: 'weekly-monitor.html', roles: ['warehouse'] },
        { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
        { id: 'process-history', label: 'Process History', icon: 'bi-clock-history', href: 'process-history.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'production',
      label: 'Production',
      items: [
        { id: 'my-requests', label: 'My Requests', icon: 'bi-list-check', href: 'my-requests.html', roles: ['production'] },
        { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle-fill', href: 'new-mrif.html', roles: ['production'] },
        { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle-fill', href: 'new-mrs.html', roles: ['production'] }
      ]
    }
  ];

  // Page title map
  var PAGE_TITLES = {
    'management-dashboard': 'Management Dashboard',
    'stock-monitor': 'Stock Monitor',
    'inventory-count': 'Inventory Count',
    'all-requests': 'All Requests',
    'mrif-list': 'MRIF List',
    'mrr-list': 'MRR List',
    'mrs-list': 'MRS List',
    'prf-monitor': 'PRF Monitor',
    'weekly-monitor': 'Weekly Monitoring',
    'usage-trend': 'Usage Trend',
    'usage-entry': 'Usage Entry',
    'process-history': 'Process History',
    'my-requests': 'My Requests',
    'new-mrif': 'New MRIF',
    'new-mrr': 'New MRR',
    'new-mrs': 'New MRS'
  };

  var SIDEBAR_STATE_KEY = 'erp_sidebar_collapsed';

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function _getUserRole() {
    try { return localStorage.getItem('ivm_userRole') || ''; } catch(e) { return ''; }
  }

  function _getCurrentPage() {
    var path = window.location.pathname;
    var pages = Object.keys(PAGE_TITLES);
    for (var i = 0; i < pages.length; i++) {
      if (path.indexOf(pages[i]) !== -1) return pages[i];
    }
    return '';
  }

  function _isAllowed(item, userRole) {
    if (!item.roles) return true;
    return item.roles.indexOf(userRole) !== -1;
  }

  function _getUserInfo() {
    var info = { username: '', fullname: '', role: '', department: '', initials: '' };
    try {
      info.username = localStorage.getItem('ivm_username') || '';
      info.fullname = localStorage.getItem('ivm_userFullname') || info.username;
      info.role = localStorage.getItem('ivm_userRole') || '';
      info.department = localStorage.getItem('ivm_userDepartment') || '';

      if (info.fullname) {
        var parts = info.fullname.trim().split(/\s+/);
        if (parts.length >= 2) {
          info.initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        } else if (parts[0]) {
          info.initials = parts[0].substring(0, 2).toUpperCase();
        }
      }
    } catch(e) {}
    return info;
  }

  function _isCollapsed() {
    try { return localStorage.getItem(SIDEBAR_STATE_KEY) === 'true'; }
    catch(e) { return false; }
  }

  function _setCollapsed(collapsed) {
    try { localStorage.setItem(SIDEBAR_STATE_KEY, String(collapsed)); }
    catch(e) {}
  }

  function _getTheme() {
    try { return localStorage.getItem('erp_theme') || 'light'; }
    catch(e) { return 'light'; }
  }

  // ═══════════════════════════════════════════════════════════
  // REMOVE OLD NAV
  // ═══════════════════════════════════════════════════════════
  function _removeOldNav() {
    ['nav.erp-topbar', '.erp-topbar', '#erpNavBar', '#erpSidebar', '#erpThinTopbar', '#erpSidebarBackdrop', '.erp-mobile-menu-btn'].forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) {
        if (el.tagName !== 'NAV' || !el.classList.contains('erp-topbar')) {
          el.remove();
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD SIDEBAR
  // ═══════════════════════════════════════════════════════════
  function _buildSidebar(userRole, currentPage) {
    var sidebar = document.createElement('aside');
    sidebar.id = 'erpSidebar';
    sidebar.className = 'erp-sidebar' + (_isCollapsed() ? ' collapsed' : '');

    // Brand
    var brand = document.createElement('div');
    brand.className = 'erp-sidebar-brand';
    brand.innerHTML =
      '<img src="../gemcor-logo.png" alt="GEMCOR" class="erp-sidebar-logo" onerror="this.style.display=\'none\'">' +
      '<div class="erp-sidebar-brand-text">' +
        '<div class="erp-sidebar-brand-main">GEMCOR ERP</div>' +
        '<div class="erp-sidebar-brand-sub">Inventory System</div>' +
      '</div>' +
      '<button class="erp-sidebar-toggle" title="Toggle sidebar"><i class="bi bi-layout-sidebar-inset"></i></button>';

    brand.querySelector('.erp-sidebar-toggle').onclick = function() {
      var isCollapsed = sidebar.classList.toggle('collapsed');
      _setCollapsed(isCollapsed);
      document.body.classList.toggle('erp-sidebar-collapsed', isCollapsed);
    };
    sidebar.appendChild(brand);

    // Nav
    var nav = document.createElement('nav');
    nav.className = 'erp-sidebar-nav';

    NAV_GROUPS.forEach(function(group) {
      var allowed = group.items.filter(function(item) {
        return _isAllowed(item, userRole);
      });
      if (allowed.length === 0) return;

      if (group.label) {
        var lbl = document.createElement('div');
        lbl.className = 'erp-sidebar-group-label';
        lbl.textContent = group.label;
        nav.appendChild(lbl);
      }

      allowed.forEach(function(item) {
        var isActive = (item.id === currentPage);
        var a = document.createElement('a');
        a.href = item.href;
        a.className = 'erp-sidebar-item' + (isActive ? ' active' : '');
        a.title = item.label;
        a.innerHTML =
          '<i class="bi ' + item.icon + '"></i>' +
          '<span class="erp-sidebar-item-label">' + item.label + '</span>';
        nav.appendChild(a);
      });
    });

    sidebar.appendChild(nav);

    // Footer
    var footer = document.createElement('div');
    footer.className = 'erp-sidebar-footer';
    footer.innerHTML = '<span class="erp-sidebar-version">v1.0.0</span>';
    sidebar.appendChild(footer);

    return sidebar;
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD TOPBAR
  // ═══════════════════════════════════════════════════════════
  function _buildTopbar(userInfo, currentPage) {
    var topbar = document.createElement('div');
    topbar.id = 'erpThinTopbar';
    topbar.className = 'erp-thin-topbar';

    var pageTitle = PAGE_TITLES[currentPage] || 'GEMCOR ERP';

    // Left: Title + Search
    var left = document.createElement('div');
    left.className = 'erp-thin-topbar-left';
    left.innerHTML =
      '<h1 class="erp-thin-page-title">' + pageTitle + '</h1>' +
      '<div class="erp-search-bar" onclick="if(window.erpOpenSearch)erpOpenSearch()">' +
        '<i class="bi bi-search"></i>' +
        '<span>Search...</span>' +
        '<kbd class="erp-search-kbd">⌘K</kbd>' +
      '</div>';
    topbar.appendChild(left);

    // Right: Health + Theme + Bell + Settings + User
    var right = document.createElement('div');
    right.className = 'erp-thin-topbar-right';

    // Health dot
    var healthDot = document.createElement('div');
    healthDot.className = 'erp-health-dot';
    healthDot.id = 'erpHealthDot';
    healthDot.title = 'Checking connection...';
    healthDot.innerHTML = '<span class="erp-health-text" id="erpHealthText">Checking...</span>';
    right.appendChild(healthDot);

    // Theme toggle
    var themeBtn = document.createElement('button');
    themeBtn.className = 'erp-icon-btn';
    themeBtn.title = 'Toggle theme';
    themeBtn.id = 'erpThemeToggleBtn';
    themeBtn.innerHTML = '<i class="bi bi-moon-stars" id="erpThemeIcon"></i>';
    themeBtn.onclick = function() {
      if (typeof erpToggleTheme === 'function') erpToggleTheme();
      setTimeout(_updateThemeIcon, 100);
    };
    right.appendChild(themeBtn);

    // Bell container
    var bellContainer = document.createElement('div');
    bellContainer.id = 'erpBellContainer';
    right.appendChild(bellContainer);

    // Settings
    var settingsBtn = document.createElement('button');
    settingsBtn.className = 'erp-icon-btn';
    settingsBtn.title = 'Settings';
    settingsBtn.innerHTML = '<i class="bi bi-gear"></i>';
    settingsBtn.onclick = function() { window.erpUserSettings(); };
    right.appendChild(settingsBtn);

    // User menu
    var userMenu = document.createElement('div');
    userMenu.className = 'erp-user-menu';
    userMenu.innerHTML =
      '<button class="erp-user-toggle" type="button">' +
        '<div class="erp-user-avatar">' + (userInfo.initials || '?') + '</div>' +
        '<div class="erp-user-info">' +
          '<div class="erp-user-name">' + (userInfo.fullname || 'User') + '</div>' +
          '<div class="erp-user-role">' + (userInfo.role || 'user') + '</div>' +
        '</div>' +
        '<i class="bi bi-chevron-down erp-user-caret"></i>' +
      '</button>' +
      '<div class="erp-user-dropdown">' +
        '<div class="erp-user-dropdown-header">' +
          '<div class="fullname">' + (userInfo.fullname || 'User') + '</div>' +
          '<div class="meta">' +
            '<i class="bi bi-person-badge"></i> ' + (userInfo.username || '') +
            (userInfo.department ? ' · ' + userInfo.department : '') +
          '</div>' +
        '</div>' +
        '<button class="erp-user-dropdown-item" type="button" onclick="erpUserRefresh()">' +
          '<i class="bi bi-arrow-clockwise"></i> Refresh Data' +
        '</button>' +
        '<button class="erp-user-dropdown-item" type="button" onclick="erpUserSettings()">' +
          '<i class="bi bi-gear"></i> Settings' +
        '</button>' +
        '<div class="erp-user-dropdown-divider"></div>' +
        '<button class="erp-user-dropdown-item danger" type="button" onclick="erpUserLogout()">' +
          '<i class="bi bi-box-arrow-right"></i> Logout' +
        '</button>' +
      '</div>';

    userMenu.querySelector('.erp-user-toggle').onclick = function(e) {
      e.stopPropagation();
      var isOpen = userMenu.classList.contains('open');
      document.querySelectorAll('.erp-user-menu.open').forEach(function(m) { m.classList.remove('open'); });
      document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) { c.classList.remove('open'); });
      if (!isOpen) userMenu.classList.add('open');
    };

    right.appendChild(userMenu);

    // Notification dropdown container
    var notifDD = document.createElement('div');
    notifDD.id = 'erpNotifContainer';
    document.body.appendChild(notifDD);

    topbar.appendChild(right);
    return topbar;
  }

  // ═══════════════════════════════════════════════════════════
  // THEME ICON UPDATE
  // ═══════════════════════════════════════════════════════════
  function _updateThemeIcon() {
    var icon = document.getElementById('erpThemeIcon');
    if (!icon) return;
    var effective = document.documentElement.getAttribute('data-theme') || 'light';
    icon.className = effective === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
  }

  // ═══════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ═══════════════════════════════════════════════════════════
  async function _checkHealth() {
    var dot = document.getElementById('erpHealthDot');
    var text = document.getElementById('erpHealthText');
    if (!dot) return;

    try {
      if (typeof erpHealthCheck === 'function') {
        var result = await erpHealthCheck();
        if (result.success) {
          dot.className = 'erp-health-dot';
          dot.title = 'Connected (' + result.latency + 'ms)';
          if (text) text.textContent = 'Connected';
        } else {
          dot.className = 'erp-health-dot offline';
          dot.title = 'Offline';
          if (text) text.textContent = 'Offline';
        }
      } else {
        dot.className = 'erp-health-dot pending';
        dot.title = 'Checking...';
      }
    } catch(err) {
      dot.className = 'erp-health-dot offline';
      dot.title = 'Error';
      if (text) text.textContent = 'Error';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BACKDROP
  // ═══════════════════════════════════════════════════════════
  function _buildBackdrop() {
    var backdrop = document.createElement('div');
    backdrop.id = 'erpSidebarBackdrop';
    backdrop.className = 'erp-sidebar-backdrop';
    backdrop.onclick = function() {
      var sb = document.getElementById('erpSidebar');
      if (sb) sb.classList.remove('mobile-open');
      backdrop.classList.remove('show');
    };
    return backdrop;
  }

  // ═══════════════════════════════════════════════════════════
  // MOBILE MENU BUTTON
  // ═══════════════════════════════════════════════════════════
  function _buildMobileBtn() {
    var btn = document.createElement('button');
    btn.className = 'erp-mobile-menu-btn';
    btn.innerHTML = '<i class="bi bi-list"></i>';
    btn.onclick = function() {
      var sb = document.getElementById('erpSidebar');
      var bd = document.getElementById('erpSidebarBackdrop');
      if (sb) sb.classList.add('mobile-open');
      if (bd) bd.classList.add('show');
    };
    return btn;
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════
  function renderNav() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var userInfo = _getUserInfo();

    _removeOldNav();

    var sidebar = _buildSidebar(userRole, current);
    var topbar = _buildTopbar(userInfo, current);
    var backdrop = _buildBackdrop();
    var mobileBtn = _buildMobileBtn();

    document.body.insertBefore(backdrop, document.body.firstChild);
    document.body.insertBefore(mobileBtn, document.body.firstChild);
    document.body.insertBefore(topbar, document.body.firstChild);
    document.body.insertBefore(sidebar, document.body.firstChild);

    document.body.classList.add('erp-has-sidebar');
    if (_isCollapsed()) {
      document.body.classList.add('erp-sidebar-collapsed');
    }

    // Update theme icon
    _updateThemeIcon();

    // Health check
    setTimeout(_checkHealth, 300);

    // Init notifications
    if (typeof initNotifications === 'function') {
      setTimeout(initNotifications, 100);
    }

    console.log('[Nav v6.0] Rendered. Page:', current, '| Role:', userRole);
  }

  // ═══════════════════════════════════════════════════════════
  // GLOBAL EVENTS
  // ═══════════════════════════════════════════════════════════
  document.addEventListener('click', function() {
    document.querySelectorAll('.erp-user-menu.open').forEach(function(m) { m.classList.remove('open'); });
    document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) { c.classList.remove('open'); });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.erp-user-menu.open').forEach(function(m) { m.classList.remove('open'); });
      document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) { c.classList.remove('open'); });
      var sidebar = document.getElementById('erpSidebar');
      var backdrop = document.getElementById('erpSidebarBackdrop');
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('show');
    }
    // Cmd/Ctrl + K search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (window.erpOpenSearch) window.erpOpenSearch();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // USER ACTIONS
  // ═══════════════════════════════════════════════════════════
  window.erpUserLogout = function() {
    var userInfo = _getUserInfo();
    if (!confirm('Logout ' + (userInfo.fullname || 'user') + '?')) return;
    try {
      ['ivm_username', 'ivm_userFullname', 'ivm_userRole', 'ivm_allowedRoles', 'ivm_requestorName', 'ivm_userDepartment', 'ivm_chatUnread', 'ivm_editReqCount'].forEach(function(k) {
        localStorage.removeItem(k);
      });
      sessionStorage.clear();
    } catch(e) {}
    window.location.href = '../index.html';
  };

  window.erpUserRefresh = function() {
    if (typeof erpClearCache === 'function') erpClearCache();
    location.reload();
  };

  window.erpUserSettings = function() {
    if (typeof erpShowToast === 'function') {
      erpShowToast('Settings — coming soon', 'info');
    } else {
      alert('Settings — coming soon');
    }
  };

  window.erpRenderNav = renderNav;

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }

  // Re-apply theme on toggles
  window.addEventListener('erp-theme-changed', _updateThemeIcon);

  console.log('✅ erp-nav.js loaded (v6.0 — Stripe + GitHub hybrid)');
})();
