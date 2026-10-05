(function() {
  'use strict';

  // Nav items with role visibility
  var NAV_ITEMS = [
    // Warehouse-only
    { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] },
    { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
    { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
    { id: 'mrif-list', label: 'MRIF', icon: 'bi-box-arrow-up', href: 'mrif-list.html', roles: ['warehouse'] },
    { id: 'mrr-list', label: 'MRR', icon: 'bi-box-arrow-down', href: 'mrr-list.html', roles: ['warehouse'] },
    { id: 'mrs-list', label: 'MRS', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html', roles: ['warehouse'] },
    
    // Both warehouse + production can access
    { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html', roles: ['warehouse', 'production'] },
    { id: 'new-mrif-manual', label: 'Manual MRIF', icon: 'bi-pencil-square', href: 'new-mrif-manual.html', roles: ['warehouse', 'production'] }
  ];

  function _getUserRole() {
    try {
      return localStorage.getItem('ivm_userRole') || '';
    } catch(e) { return ''; }
  }

  function getCurrentPage() {
    var path = window.location.pathname;
    if (path.indexOf('weekly-monitor') !== -1) return 'weekly-monitor';
    if (path.indexOf('stock-monitor') !== -1) return 'stock-monitor';
    if (path.indexOf('usage-trend') !== -1) return 'usage-trend';
    if (path.indexOf('new-mrif-manual') !== -1) return 'new-mrif-manual';
    if (path.indexOf('new-mrif') !== -1) return 'new-mrif';
    if (path.indexOf('mrif-list') !== -1) return 'mrif-list';
    if (path.indexOf('mrr-list') !== -1) return 'mrr-list';
    if (path.indexOf('mrs-list') !== -1) return 'mrs-list';
    return '';
  }

  function renderNavBar() {
    var current = getCurrentPage();
    var userRole = _getUserRole();
    var container = document.getElementById('erpNavBar');
    if (!container) return;

    var html = '<div class="erp-navbar">';

    NAV_ITEMS.forEach(function(item) {
      // Check kung visible sa role
      if (item.roles && item.roles.indexOf(userRole) === -1) {
        return; // Skip — role not allowed
      }

      var active = (item.id === current) ? ' active' : '';
      html += '<a href="' + item.href + '" class="erp-nav-item' + active + '">' +
        '<i class="bi ' + item.icon + '"></i>' +
        '<span>' + item.label + '</span>' +
      '</a>';
    });

    html += '</div>';
    container.innerHTML = html;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }

  console.log('✅ erp-nav.js loaded (role-aware)');
})();
