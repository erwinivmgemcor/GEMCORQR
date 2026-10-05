// ============================================================
// GEMCOR ERP — Navigation Bar (STATIC — No Dropdowns)
// Simple, reliable, role-aware
// ============================================================

(function() {
  'use strict';

  var NAV_ITEMS = [
    { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] },
    { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
    { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
    { id: 'mrif-list', label: 'MRIF', icon: 'bi-box-arrow-up', href: 'mrif-list.html', roles: ['warehouse', 'production'] },
    { id: 'mrr-list', label: 'MRR', icon: 'bi-box-arrow-down', href: 'mrr-list.html', roles: ['warehouse'] },
    { id: 'mrs-list', label: 'MRS', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html', roles: ['warehouse', 'production'] }
  ];

  function _getUserRole() {
    try { return localStorage.getItem('ivm_userRole') || ''; } catch(e) { return ''; }
  }

  function _getCurrentPage() {
    var path = window.location.pathname;
    var pages = [
      'weekly-monitor', 'stock-monitor', 'usage-trend', 'usage-entry',
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

  function renderNavBar() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var container = document.getElementById('erpNavBar');
    if (!container) return;

    container.innerHTML = '';

    var nav = document.createElement('div');
    nav.className = 'erp-navbar';
    nav.style.cssText = 'display:flex;align-items:center;gap:4px;';

    NAV_ITEMS.forEach(function(item) {
      if (!_isAllowed(item, userRole)) return;

      var isActive = (item.id === current);
      var link = document.createElement('a');
      link.href = item.href;
      link.className = 'erp-nav-item' + (isActive ? ' active' : '');
      link.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span>';
      nav.appendChild(link);
    });

    container.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }

  console.log('✅ erp-nav.js loaded (static version)');
})();
