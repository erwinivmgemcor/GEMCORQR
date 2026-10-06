// ============================================================
// GEMCOR ERP — Navigation Bar + User Menu + Notifications
// Premium v2.4 — with notification bell
// ============================================================

(function() {
  'use strict';

  var NAV_ITEMS = [
    // WAREHOUSE
    { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] },
    { id: 'all-requests', label: 'All Requests', icon: 'bi-inbox-fill', href: 'all-requests.html', roles: ['warehouse'] },
    { id: 'prf-monitor', label: 'PRF Monitor', icon: 'bi-file-earmark-text', href: 'prf-monitor.html', roles: ['warehouse'] },
    { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
    { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
    { id: 'mrif-list', label: 'MRIF', icon: 'bi-box-arrow-up', href: 'mrif-list.html', roles: ['warehouse'] },
    { id: 'mrr-list', label: 'MRR', icon: 'bi-box-arrow-down', href: 'mrr-list.html', roles: ['warehouse'] },
    { id: 'mrs-list', label: 'MRS', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html', roles: ['warehouse'] },

    // PRODUCTION
    { id: 'my-requests', label: 'My Requests', icon: 'bi-list-check', href: 'my-requests.html', roles: ['production'] },
    { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html', roles: ['production'] },
    { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle', href: 'new-mrs.html', roles: ['production'] }
  ];

  function _getUserRole() {
    try { return localStorage.getItem('ivm_userRole') || ''; } catch(e) { return ''; }
  }

  function _getCurrentPage() {
    var path = window.location.pathname;
    var pages = [
      'weekly-monitor', 'stock-monitor', 'usage-trend', 'usage-entry',
      'all-requests', 'prf-monitor', 'new-prf',
      'my-requests',
      'new-mrif-manual', 'new-mrr-manual', 'new-mrs-manual',
      'new-mrif', 'new-mrr', 'new-mrs',
      'mrif-list', 'mrr-list', 'mrs-list'
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

  function _buildNavItems(userRole, current) {
    var nav = document.createElement('div');
    nav.className = 'erp-navbar';

    NAV_ITEMS.forEach(function(item) {
      if (!_isAllowed(item, userRole)) return;
      var isActive = (item.id === current);
      var link = document.createElement('a');
      link.href = item.href;
      link.className = 'erp-nav-item' + (isActive ? ' active' : '');
      link.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span>';
      nav.appendChild(link);
    });

    return nav;
  }

  function _buildUserMenu(userInfo) {
    var menu = document.createElement('div');
    menu.className = 'erp-user-menu';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'erp-user-toggle';
    toggle.innerHTML =
      '<div class="erp-user-avatar">' + (userInfo.initials || '?') + '</div>' +
      '<div class="erp-user-info">' +
        '<div class="erp-user-name">' + (userInfo.fullname || 'User') + '</div>' +
        '<div class="erp-user-role">' + (userInfo.role || 'user') + '</div>' +
      '</div>' +
      '<i class="bi bi-chevron-down erp-user-caret"></i>';

    var dropdown = document.createElement('div');
    dropdown.className = 'erp-user-dropdown';

    dropdown.innerHTML =
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
      '</button>';

    menu.appendChild(toggle);
    menu.appendChild(dropdown);

    toggle.onclick = function(e) {
      e.stopPropagation();
      var isOpen = menu.classList.contains('open');
      document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
        m.classList.remove('open');
      });
      document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
        c.classList.remove('open');
      });
      if (!isOpen) menu.classList.add('open');
    };

    return menu;
  }

  function renderNavBar() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var userInfo = _getUserInfo();

    // 1. Nav items sa #erpNavBar
    var navContainer = document.getElementById('erpNavBar');
    if (navContainer) {
      navContainer.innerHTML = '';
      navContainer.appendChild(_buildNavItems(userRole, current));
    }

    // 2. Bell + User menu sa .erp-topbar-right
    var topbarRight = document.querySelector('.erp-topbar-right');
    if (topbarRight) {
      // Remove existing
      var existingNotif = document.getElementById('erpBellContainer');
      if (existingNotif) existingNotif.remove();
      var existingNotifDD = document.getElementById('erpNotifContainer');
      if (existingNotifDD) existingNotifDD.remove();
      var existingUser = topbarRight.querySelector('.erp-user-menu');
      if (existingUser) existingUser.remove();

      // Insert bell container
      var bellContainer = document.createElement('div');
      bellContainer.id = 'erpBellContainer';
      topbarRight.insertBefore(bellContainer, topbarRight.firstChild);

      // Insert notif dropdown container (fixed positioned, outside flow)
      var notifDD = document.createElement('div');
      notifDD.id = 'erpNotifContainer';
      document.body.appendChild(notifDD);

      // Insert user menu
      var userMenu = _buildUserMenu(userInfo);
      var mainSystemLink = topbarRight.querySelector('a.erp-btn-outline');
      if (mainSystemLink) {
        topbarRight.insertBefore(userMenu, mainSystemLink);
      } else {
        topbarRight.appendChild(userMenu);
      }
    }

    // Re-init notifications (para mag-fetch agad)
    if (typeof initNotifications === 'function') {
      setTimeout(initNotifications, 100);
    }
  }

  document.addEventListener('click', function() {
    document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
      m.classList.remove('open');
    });
    document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
      c.classList.remove('open');
    });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
        m.classList.remove('open');
      });
      document.querySelectorAll('#erpNotifContainer.open').forEach(function(c) {
        c.classList.remove('open');
      });
    }
  });

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }

  console.log('✅ erp-nav.js loaded (premium v2.4 — with notifications)');
})();
