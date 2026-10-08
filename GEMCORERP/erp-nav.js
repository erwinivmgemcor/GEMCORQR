// ============================================================
// GEMCOR ERP — Navigation & Layout System v8.0
// Professional Enterprise Design
// Clean, Minimal, Self-Contained
// ============================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // NAVIGATION STRUCTURE
  // Grouped, role-based, priority-ordered
  // ═══════════════════════════════════════════════════════════
  var NAV_GROUPS = [
    {
      id: 'main',
      label: '',
      items: [
        {
          id: 'management-dashboard',
          label: 'Dashboard',
          icon: 'bi-grid-1x2',
          href: 'management-dashboard.html',
          roles: ['warehouse']
        },
        {
          id: 'stock-monitor',
          label: 'Stock Monitor',
          icon: 'bi-box-seam',
          href: 'stock-monitor.html',
          roles: ['warehouse']
        }
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      items: [
        {
          id: 'inventory-count',
          label: 'Inventory Count',
          icon: 'bi-clipboard-check',
          href: 'inventory-count.html',
          roles: ['warehouse']
        }
      ]
    },
    {
      id: 'documents',
      label: 'Documents',
      items: [
        {
          id: 'all-requests',
          label: 'All Requests',
          icon: 'bi-inbox',
          href: 'all-requests.html',
          roles: ['warehouse']
        },
        {
          id: 'mrif-list',
          label: 'MRIF — Issuance',
          icon: 'bi-box-arrow-up-right',
          href: 'mrif-list.html',
          roles: ['warehouse']
        },
        {
          id: 'mrr-list',
          label: 'MRR — Receiving',
          icon: 'bi-box-arrow-in-down',
          href: 'mrr-list.html',
          roles: ['warehouse']
        },
        {
          id: 'mrs-list',
          label: 'MRS — Returns',
          icon: 'bi-arrow-counterclockwise',
          href: 'mrs-list.html',
          roles: ['warehouse']
        },
        {
          id: 'prf-monitor',
          label: 'PRF Monitor',
          icon: 'bi-file-earmark-text',
          href: 'prf-monitor.html',
          roles: ['warehouse']
        }
      ]
    },
    {
      id: 'reports',
      label: 'Reports',
      items: [
        {
          id: 'weekly-monitor',
          label: 'Weekly Monitoring',
          icon: 'bi-calendar-week',
          href: 'weekly-monitor.html',
          roles: ['warehouse']
        },
        {
          id: 'usage-trend',
          label: 'Usage Trend',
          icon: 'bi-graph-up-arrow',
          href: 'usage-trend.html',
          roles: ['warehouse']
        },
        {
          id: 'process-history',
          label: 'Process History',
          icon: 'bi-clock-history',
          href: 'process-history.html',
          roles: ['warehouse']
        }
      ]
    },
    {
      id: 'production',
      label: 'Production',
      items: [
        {
          id: 'my-requests',
          label: 'My Requests',
          icon: 'bi-list-check',
          href: 'my-requests.html',
          roles: ['production']
        },
        {
          id: 'new-mrif',
          label: 'New MRIF',
          icon: 'bi-plus-circle',
          href: 'new-mrif.html',
          roles: ['production']
        },
        {
          id: 'new-mrs',
          label: 'New MRS',
          icon: 'bi-plus-circle',
          href: 'new-mrs.html',
          roles: ['production']
        }
      ]
    }
  ];

  // Page title mapping
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

  var STORAGE_KEYS = {
    sidebarCollapsed: 'erp_sidebar_collapsed',
    theme: 'erp_theme'
  };

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  function _getUserRole() {
    try {
      return localStorage.getItem('ivm_userRole') || '';
    } catch(e) {
      return '';
    }
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
    var info = {
      username: '',
      fullname: '',
      role: '',
      department: '',
      initials: ''
    };
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
    try {
      return localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === 'true';
    } catch(e) {
      return false;
    }
  }

  function _setCollapsed(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(collapsed));
    } catch(e) {}
  }

  function _escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ═══════════════════════════════════════════════════════════
  // CLEANUP — Remove old nav elements
  // ═══════════════════════════════════════════════════════════

  function _removeOldNav() {
    var selectors = [
      'nav.erp-topbar',
      '.erp-topbar',
      '#erpNavBar',
      '#erpSidebar',
      '#erpThinTopbar',
      '#erpSidebarBackdrop',
      '.erp-mobile-menu-btn'
    ];

    selectors.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) {
        el.remove();
      });
    });

    // Also remove old notif container to prevent duplicates
    var oldNotif = document.getElementById('erpNotifContainer');
    if (oldNotif) oldNotif.remove();
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD SIDEBAR
  // ═══════════════════════════════════════════════════════════

  function _buildSidebar(userRole, currentPage) {
    var sidebar = document.createElement('aside');
    sidebar.id = 'erpSidebar';
    sidebar.className = 'erp-sidebar' + (_isCollapsed() ? ' collapsed' : '');

    // ─── Brand ───
    var brand = document.createElement('div');
    brand.className = 'erp-sidebar-brand';

    var toggleIcon = _isCollapsed() ? 'bi bi-chevron-right' : 'bi bi-chevron-left';

    brand.innerHTML =
      '<img src="../gemcor-logo.png" alt="GEMCOR" class="erp-sidebar-logo" onerror="this.style.display=\'none\'">' +
      '<div class="erp-sidebar-brand-text">' +
        '<div class="erp-sidebar-brand-main">GEMCOR ERP</div>' +
        '<div class="erp-sidebar-brand-sub">Inventory System</div>' +
      '</div>' +
      '<button class="erp-sidebar-toggle" type="button" title="Toggle sidebar" aria-label="Toggle sidebar">' +
        '<i class="' + toggleIcon + '"></i>' +
      '</button>';

    var toggleBtn = brand.querySelector('.erp-sidebar-toggle');
    toggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      var willCollapse = !sidebar.classList.contains('collapsed');

      if (willCollapse) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('erp-sidebar-collapsed');
      } else {
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('erp-sidebar-collapsed');
      }

      _setCollapsed(willCollapse);

      // Update icon
      var icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.className = willCollapse ? 'bi bi-chevron-right' : 'bi bi-chevron-left';
      }
    });

    sidebar.appendChild(brand);

    // ─── Nav ───
    var nav = document.createElement('nav');
    nav.className = 'erp-sidebar-nav';

    NAV_GROUPS.forEach(function(group) {
      var allowedItems = group.items.filter(function(item) {
        return _isAllowed(item, userRole);
      });

      if (allowedItems.length === 0) return;

      // Group label
      if (group.label) {
        var label = document.createElement('div');
        label.className = 'erp-sidebar-group-label';
        label.textContent = group.label;
        nav.appendChild(label);
      }

      // Items
      allowedItems.forEach(function(item) {
        var isActive = (item.id === currentPage);

        var link = document.createElement('a');
        link.href = item.href;
        link.className = 'erp-sidebar-item' + (isActive ? ' active' : '');
        link.title = item.label;
        link.setAttribute('data-nav-id', item.id);

        link.innerHTML =
          '<i class="bi ' + item.icon + '"></i>' +
          '<span class="erp-sidebar-item-label">' + _escapeHtml(item.label) + '</span>';

        nav.appendChild(link);
      });
    });

    sidebar.appendChild(nav);

    // ─── Footer ───
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

    topbar.innerHTML =
      '<div class="erp-thin-topbar-left">' +
        '<h1 class="erp-thin-page-title">' + _escapeHtml(pageTitle) + '</h1>' +
        '<div class="erp-search-bar" onclick="if(window.erpOpenSearch)erpOpenSearch()">' +
          '<i class="bi bi-search"></i>' +
          '<span>Search...</span>' +
          '<kbd class="erp-search-kbd">⌘K</kbd>' +
        '</div>' +
      '</div>' +
      '<div class="erp-thin-topbar-right">' +
        '<div class="erp-health-dot" id="erpHealthDot" title="Checking...">' +
          '<span class="erp-health-text" id="erpHealthText">Checking...</span>' +
        '</div>' +
        '<button class="erp-icon-btn" id="erpThemeToggleBtn" type="button" title="Toggle theme" aria-label="Toggle theme">' +
          '<i class="bi bi-moon-stars" id="erpThemeIcon"></i>' +
        '</button>' +
        '<div id="erpBellContainer"></div>' +
        '<div class="erp-user-menu" id="erpUserMenu">' +
          '<button class="erp-user-toggle" type="button" aria-label="User menu">' +
            '<div class="erp-user-avatar">' + _escapeHtml(userInfo.initials || '?') + '</div>' +
            '<div class="erp-user-info">' +
              '<div class="erp-user-name">' + _escapeHtml(userInfo.fullname || 'User') + '</div>' +
              '<div class="erp-user-role">' + _escapeHtml(userInfo.role || 'user') + '</div>' +
            '</div>' +
            '<i class="bi bi-chevron-down erp-user-caret"></i>' +
          '</button>' +
          '<div class="erp-user-dropdown">' +
            '<div class="erp-user-dropdown-header">' +
              '<div class="fullname">' + _escapeHtml(userInfo.fullname || 'User') + '</div>' +
              '<div class="meta">' +
                '<i class="bi bi-person-badge"></i> ' + _escapeHtml(userInfo.username || '') +
                (userInfo.department ? ' · ' + _escapeHtml(userInfo.department) : '') +
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
          '</div>' +
        '</div>' +
      '</div>';

    // Attach theme toggle
    var themeBtn = topbar.querySelector('#erpThemeToggleBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (typeof erpToggleTheme === 'function') {
          erpToggleTheme();
        } else {
          // Fallback inline toggle
          var current = document.documentElement.getAttribute('data-theme') || 'light';
          var next = current === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          try { localStorage.setItem(STORAGE_KEYS.theme, next); } catch(e2) {}
        }
        setTimeout(_updateThemeIcon, 50);
      });
    }

    // Attach user menu toggle
    var userMenu = topbar.querySelector('#erpUserMenu');
    if (userMenu) {
      var userToggle = userMenu.querySelector('.erp-user-toggle');
      userToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        var isOpen = userMenu.classList.contains('open');

        // Close others
        document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
          m.classList.remove('open');
        });
        document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
          c.classList.remove('open');
        });

        if (!isOpen) userMenu.classList.add('open');
      });
    }

    return topbar;
  }

  // ═══════════════════════════════════════════════════════════
  // NOTIFICATION CONTAINER (placeholder, filled by notifications.js)
  // ═══════════════════════════════════════════════════════════

  function _ensureNotifContainer() {
    var existing = document.getElementById('erpNotifContainer');
    if (existing) return existing;

    var container = document.createElement('div');
    container.id = 'erpNotifContainer';
    document.body.appendChild(container);
    return container;
  }

  // ═══════════════════════════════════════════════════════════
  // THEME ICON
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
        if (text) text.textContent = 'Checking...';
      }
    } catch (err) {
      dot.className = 'erp-health-dot offline';
      dot.title = 'Error';
      if (text) text.textContent = 'Error';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MOBILE — Backdrop + Menu Button
  // ═══════════════════════════════════════════════════════════

  function _buildBackdrop() {
    var backdrop = document.createElement('div');
    backdrop.id = 'erpSidebarBackdrop';
    backdrop.className = 'erp-sidebar-backdrop';

    backdrop.addEventListener('click', function() {
      var sidebar = document.getElementById('erpSidebar');
      if (sidebar) sidebar.classList.remove('mobile-open');
      backdrop.classList.remove('show');
    });

    return backdrop;
  }

  function _buildMobileBtn() {
    var btn = document.createElement('button');
    btn.className = 'erp-mobile-menu-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open menu');
    btn.innerHTML = '<i class="bi bi-list"></i>';

    btn.addEventListener('click', function() {
      var sidebar = document.getElementById('erpSidebar');
      var backdrop = document.getElementById('erpSidebarBackdrop');
      if (sidebar) sidebar.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('show');
    });

    return btn;
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════

  function renderNav() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var userInfo = _getUserInfo();

    // Remove any old nav
    _removeOldNav();

    // Build components
    var sidebar = _buildSidebar(userRole, current);
    var topbar = _buildTopbar(userInfo, current);
    var backdrop = _buildBackdrop();
    var mobileBtn = _buildMobileBtn();

    // Insert into DOM (in correct order for stacking)
    document.body.insertBefore(backdrop, document.body.firstChild);
    document.body.insertBefore(mobileBtn, document.body.firstChild);
    document.body.insertBefore(topbar, document.body.firstChild);
    document.body.insertBefore(sidebar, document.body.firstChild);

    // Ensure notif container exists
    _ensureNotifContainer();

    // Body classes
    document.body.classList.add('erp-has-sidebar');
    if (_isCollapsed()) {
      document.body.classList.add('erp-sidebar-collapsed');
    }

    // Update theme icon
    _updateThemeIcon();

    // Health check (delayed to let other scripts load)
    setTimeout(_checkHealth, 300);

    // Initialize notifications if available
    if (typeof initNotifications === 'function') {
      setTimeout(function() {
        try { initNotifications(); } catch(e) {
          console.warn('[Nav] initNotifications error:', e);
        }
      }, 100);
    }

    // Listen for theme changes from external sources
    document.addEventListener('erp-theme-changed', _updateThemeIcon);
    document.addEventListener('erpThemeChanged', _updateThemeIcon);

    console.log('[Nav v8.0] Rendered. Page:', current, '| Role:', userRole, '| Collapsed:', _isCollapsed());
  }

  // ═══════════════════════════════════════════════════════════
  // GLOBAL EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════

  // Close dropdowns on outside click
  document.addEventListener('click', function(e) {
    // User menu
    if (!e.target.closest('.erp-user-menu')) {
      document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
        m.classList.remove('open');
      });
    }

    // Notification container
    if (!e.target.closest('#erpNotifContainer') && !e.target.closest('#erpBellContainer')) {
      document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
        c.classList.remove('open');
      });
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    // Escape closes everything
    if (e.key === 'Escape') {
      document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
        m.classList.remove('open');
      });
      document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
        c.classList.remove('open');
      });

      var sidebar = document.getElementById('erpSidebar');
      var backdrop = document.getElementById('erpSidebarBackdrop');
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('show');
    }

    // Cmd/Ctrl + K — search
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (typeof window.erpOpenSearch === 'function') {
        window.erpOpenSearch();
      } else {
        console.log('[Nav] Search not implemented yet');
      }
    }
  });

  // ═══════════════════════════════════════════════════════════
  // GLOBAL USER ACTIONS
  // ═══════════════════════════════════════════════════════════

  window.erpUserLogout = function() {
    var userInfo = _getUserInfo();
    var name = userInfo.fullname || 'user';

    if (!confirm('Logout ' + name + '?')) return;

    try {
      var keysToRemove = [
        'ivm_username',
        'ivm_userFullname',
        'ivm_userRole',
        'ivm_allowedRoles',
        'ivm_requestorName',
        'ivm_userDepartment',
        'ivm_chatUnread',
        'ivm_editReqCount'
      ];
      keysToRemove.forEach(function(k) {
        localStorage.removeItem(k);
      });
      sessionStorage.clear();
    } catch(e) {}

    window.location.href = '../index.html';
  };

  window.erpUserRefresh = function() {
    if (typeof erpClearCache === 'function') {
      erpClearCache();
    }
    location.reload();
  };

  window.erpUserSettings = function() {
    if (typeof erpShowToast === 'function') {
      erpShowToast('Settings — coming soon', 'info');
    } else {
      alert('Settings — coming soon');
    }
  };

  // ═══════════════════════════════════════════════════════════
  // EXPOSE GLOBALS
  // ═══════════════════════════════════════════════════════════

  window.erpRenderNav = renderNav;
  window.erpNavState = {
    isCollapsed: _isCollapsed,
    setCollapsed: _setCollapsed,
    getCurrentPage: _getCurrentPage,
    getUserInfo: _getUserInfo
  };

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }

  console.log('✅ erp-nav.js v8.0 loaded');
})();
