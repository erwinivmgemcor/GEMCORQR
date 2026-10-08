// ============================================================
// GEMCOR ERP — Navigation System v5.0
// Sidebar Fixed Layout (auto-inject, walang overlap)
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
        { id: 'management-dashboard', label: 'Dashboard', icon: 'bi-graph-up-arrow', href: 'management-dashboard.html', roles: ['warehouse'] },
        { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'inventory',
      label: 'INVENTORY',
      items: [
        { id: 'inventory-count', label: 'Inventory Count', icon: 'bi-clipboard-check', href: 'inventory-count.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'documents',
      label: 'DOCUMENTS',
      items: [
        { id: 'all-requests', label: 'All Requests', icon: 'bi-inbox-fill', href: 'all-requests.html', roles: ['warehouse'] },
        { id: 'mrif-list', label: 'MRIF — Issuance', icon: 'bi-box-arrow-up', href: 'mrif-list.html', roles: ['warehouse'] },
        { id: 'mrr-list', label: 'MRR — Receiving', icon: 'bi-box-arrow-down', href: 'mrr-list.html', roles: ['warehouse'] },
        { id: 'mrs-list', label: 'MRS — Returns', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html', roles: ['warehouse'] },
        { id: 'prf-monitor', label: 'PRF Monitor', icon: 'bi-file-earmark-ruled', href: 'prf-monitor.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'reports',
      label: 'REPORTS',
      items: [
        { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
        { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up', href: 'usage-trend.html', roles: ['warehouse'] },
        { id: 'process-history', label: 'Process History', icon: 'bi-clock-history', href: 'process-history.html', roles: ['warehouse'] }
      ]
    },
    {
      id: 'production',
      label: 'PRODUCTION',
      items: [
        { id: 'my-requests', label: 'My Requests', icon: 'bi-list-check', href: 'my-requests.html', roles: ['production'] },
        { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html', roles: ['production'] },
        { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle', href: 'new-mrs.html', roles: ['production'] }
      ]
    }
  ];

  var SIDEBAR_WIDTH = 240;
  var SIDEBAR_WIDTH_COLLAPSED = 64;
  var SIDEBAR_STATE_KEY = 'erp_sidebar_collapsed';

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function _getUserRole() {
    try { return localStorage.getItem('ivm_userRole') || ''; } catch(e) { return ''; }
  }

  function _getCurrentPage() {
    var path = window.location.pathname;
    var pages = [
      'management-dashboard', 'weekly-monitor', 'stock-monitor', 'usage-trend', 'usage-entry',
      'all-requests', 'prf-monitor', 'new-prf', 'process-history', 'my-requests',
      'new-mrif-manual', 'new-mrr-manual', 'new-mrs-manual',
      'new-mrif', 'new-mrr', 'new-mrs',
      'mrif-list', 'mrr-list', 'mrs-list', 'inventory-count'
    ];
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

  // ═══════════════════════════════════════════════════════════
  // REMOVE OLD NAVBAR
  // ═══════════════════════════════════════════════════════════
  function _removeOldNav() {
    // Remove existing topbar
    var oldTopbar = document.querySelector('nav.erp-topbar');
    if (oldTopbar) oldTopbar.remove();

    // Remove existing navbar container
    var oldNavBar = document.getElementById('erpNavBar');
    if (oldNavBar) oldNavBar.remove();

    // Remove old sidebar (if re-rendering)
    var oldSidebar = document.getElementById('erpSidebar');
    if (oldSidebar) oldSidebar.remove();

    // Remove old topbar (thin version)
    var oldThinTopbar = document.getElementById('erpThinTopbar');
    if (oldThinTopbar) oldThinTopbar.remove();

    // Remove old nav backdrop
    var oldBackdrop = document.getElementById('erpSidebarBackdrop');
    if (oldBackdrop) oldBackdrop.remove();
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD SIDEBAR
  // ═══════════════════════════════════════════════════════════
  function _buildSidebar(userRole, currentPage) {
    var sidebar = document.createElement('aside');
    sidebar.id = 'erpSidebar';
    sidebar.className = 'erp-sidebar' + (_isCollapsed() ? ' collapsed' : '');

    // ─── Logo section ───
    var brand = document.createElement('div');
    brand.className = 'erp-sidebar-brand';

    var logo = document.createElement('img');
    logo.src = '../gemcor-logo.png';
    logo.alt = 'GEMCOR';
    logo.className = 'erp-sidebar-logo';
    logo.onerror = function() { this.style.display = 'none'; };

    var brandText = document.createElement('div');
    brandText.className = 'erp-sidebar-brand-text';
    brandText.innerHTML = '<div class="erp-sidebar-brand-main">GEMCOR</div><div class="erp-sidebar-brand-sub">ERP System</div>';

    var toggle = document.createElement('button');
    toggle.className = 'erp-sidebar-toggle';
    toggle.title = 'Toggle sidebar';
    toggle.innerHTML = '<i class="bi bi-list"></i>';
    toggle.onclick = function() {
      var isCollapsed = sidebar.classList.toggle('collapsed');
      _setCollapsed(isCollapsed);
      document.body.classList.toggle('erp-sidebar-collapsed', isCollapsed);
    };

    brand.appendChild(logo);
    brand.appendChild(brandText);
    brand.appendChild(toggle);
    sidebar.appendChild(brand);

    // ─── Nav items ───
    var nav = document.createElement('nav');
    nav.className = 'erp-sidebar-nav';

    NAV_GROUPS.forEach(function(group) {
      var allowedItems = group.items.filter(function(item) {
        return _isAllowed(item, userRole);
      });
      if (allowedItems.length === 0) return;

      // Group label
      if (group.label) {
        var lbl = document.createElement('div');
        lbl.className = 'erp-sidebar-group-label';
        lbl.textContent = group.label;
        nav.appendChild(lbl);
      }

      // Items
      allowedItems.forEach(function(item) {
        var isActive = (item.id === currentPage);
        var a = document.createElement('a');
        a.href = item.href;
        a.className = 'erp-sidebar-item' + (isActive ? ' active' : '');
        a.title = item.label;

        var icon = document.createElement('i');
        icon.className = 'bi ' + item.icon;

        var label = document.createElement('span');
        label.className = 'erp-sidebar-item-label';
        label.textContent = item.label;

        a.appendChild(icon);
        a.appendChild(label);
        nav.appendChild(a);
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

    // Left: page title
    var left = document.createElement('div');
    left.className = 'erp-thin-topbar-left';

    var titleMap = {
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
      'process-history': 'Process History',
      'my-requests': 'My Requests',
      'new-mrif': 'New MRIF',
      'new-mrr': 'New MRR',
      'new-mrs': 'New MRS'
    };

    var pageTitle = titleMap[currentPage] || 'GEMCOR ERP';

    left.innerHTML =
      '<h1 class="erp-thin-page-title">' + pageTitle + '</h1>';
    topbar.appendChild(left);

    // Right: Bell + User menu
    var right = document.createElement('div');
    right.className = 'erp-thin-topbar-right';

    // Bell container
    var bellContainer = document.createElement('div');
    bellContainer.id = 'erpBellContainer';
    right.appendChild(bellContainer);

    // Notification dropdown container (appended to body)
    var notifDD = document.createElement('div');
    notifDD.id = 'erpNotifContainer';
    document.body.appendChild(notifDD);

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
    topbar.appendChild(right);

    return topbar;
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD BACKDROP (for mobile)
  // ═══════════════════════════════════════════════════════════
  function _buildBackdrop() {
    var backdrop = document.createElement('div');
    backdrop.id = 'erpSidebarBackdrop';
    backdrop.className = 'erp-sidebar-backdrop';
    backdrop.onclick = function() {
      document.getElementById('erpSidebar').classList.remove('mobile-open');
      backdrop.classList.remove('show');
    };
    return backdrop;
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════
  function renderNav() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var userInfo = _getUserInfo();

    // Remove old elements
    _removeOldNav();

    // Build new elements
    var sidebar = _buildSidebar(userRole, current);
    var topbar = _buildTopbar(userInfo, current);
    var backdrop = _buildBackdrop();

    // Insert into body (FIRST child)
    document.body.insertBefore(backdrop, document.body.firstChild);
    document.body.insertBefore(topbar, document.body.firstChild);
    document.body.insertBefore(sidebar, document.body.firstChild);

    // Set body class for layout
    document.body.classList.add('erp-has-sidebar');
    if (_isCollapsed()) {
      document.body.classList.add('erp-sidebar-collapsed');
    }

    // Init notifications
    if (typeof initNotifications === 'function') {
      setTimeout(initNotifications, 100);
    }

    console.log('[Nav] Sidebar rendered. Current page:', current);
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
  });

  // ═══════════════════════════════════════════════════════════
  // USER MENU ACTIONS
  // ═══════════════════════════════════════════════════════════
  window.erpUserLogout = function() {
    var userInfo = _getUserInfo();
    if (!confirm('Logout ' + (userInfo.fullname || 'user') + '?')) return;
    try {
      localStorage.removeItem('ivm_username');
      localStorage.removeItem('ivm_userFullname');
      localStorage.removeItem('ivm_userRole');
      localStorage.removeItem('ivm_allowedRoles');
      localStorage.removeItem('ivm_requestorName');
      localStorage.removeItem('ivm_userDepartment');
      localStorage.removeItem('ivm_chatUnread');
      localStorage.removeItem('ivm_editReqCount');
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
      erpShowToast('Settings page — coming soon', 'info');
    } else {
      alert('Settings — coming soon');
    }
  };

  // Expose for debugging
  window.erpRenderNav = renderNav;

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }

  console.log('✅ erp-nav.js loaded (v5.0 — fixed sidebar)');
})();
