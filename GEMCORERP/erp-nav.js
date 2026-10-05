// ============================================================
// GEMCOR ERP — Navigation Bar (Dropdown + Role-Aware)
// ============================================================

(function() {
  'use strict';

  // Nav structure with dropdowns
  var NAV_ITEMS = [
    // Warehouse-only (single link)
    { type: 'link', id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] },
    { type: 'link', id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
    { type: 'link', id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
    
    // MRIF dropdown
    { 
      type: 'dropdown', 
      id: 'mrif', 
      label: 'MRIF', 
      icon: 'bi-box-arrow-up',
      roles: ['warehouse', 'production'],
      items: [
        { id: 'mrif-list', label: 'View MRIF List', icon: 'bi-list-ul', href: 'mrif-list.html', roles: ['warehouse'] },
        { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html', roles: ['warehouse', 'production'] },
        { id: 'new-mrif-manual', label: 'Manual MRIF', icon: 'bi-pencil-square', href: 'new-mrif-manual.html', roles: ['warehouse', 'production'] }
      ]
    },
    
    // MRR dropdown
    { 
      type: 'dropdown', 
      id: 'mrr', 
      label: 'MRR', 
      icon: 'bi-box-arrow-down',
      roles: ['warehouse'],
      items: [
        { id: 'mrr-list', label: 'View MRR List', icon: 'bi-list-ul', href: 'mrr-list.html', roles: ['warehouse'] },
        { id: 'new-mrr', label: 'New MRR', icon: 'bi-plus-circle', href: 'new-mrr.html', roles: ['warehouse'] },
        { id: 'new-mrr-manual', label: 'Manual MRR', icon: 'bi-pencil-square', href: 'new-mrr-manual.html', roles: ['warehouse'] }
      ]
    },
    
    // MRS dropdown
    { 
      type: 'dropdown', 
      id: 'mrs', 
      label: 'MRS', 
      icon: 'bi-arrow-counterclockwise',
      roles: ['warehouse', 'production'],
      items: [
        { id: 'mrs-list', label: 'View MRS List', icon: 'bi-list-ul', href: 'mrs-list.html', roles: ['warehouse'] },
        { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle', href: 'new-mrs.html', roles: ['warehouse', 'production'] },
        { id: 'new-mrs-manual', label: 'Manual MRS', icon: 'bi-pencil-square', href: 'new-mrs-manual.html', roles: ['warehouse', 'production'] }
      ]
    }
  ];

  function _getUserRole() {
    try {
      return localStorage.getItem('ivm_userRole') || '';
    } catch(e) { return ''; }
  }

  function getCurrentPage() {
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
    var current = getCurrentPage();
    var userRole = _getUserRole();
    var container = document.getElementById('erpNavBar');
    if (!container) return;

    var html = '<div class="erp-navbar">';

    NAV_ITEMS.forEach(function(item) {
      if (!_isAllowed(item, userRole)) return;

      if (item.type === 'link') {
        var active = (item.id === current) ? ' active' : '';
        html += '<a href="' + item.href + '" class="erp-nav-item' + active + '">' +
          '<i class="bi ' + item.icon + '"></i>' +
          '<span>' + item.label + '</span>' +
        '</a>';
      } else if (item.type === 'dropdown') {
        // Check kung may visible sub-items
        var visibleSubs = (item.items || []).filter(function(sub) {
          return _isAllowed(sub, userRole);
        });
        if (visibleSubs.length === 0) return;

        // Is dropdown active? (any sub-item matches current page)
        var dropdownActive = visibleSubs.some(function(sub) { return sub.id === current; });
        var activeClass = dropdownActive ? ' active' : '';

        html += '<div class="erp-nav-dropdown' + activeClass + '" data-dropdown="' + item.id + '">' +
          '<button class="erp-nav-item erp-nav-dropdown-toggle" type="button">' +
            '<i class="bi ' + item.icon + '"></i>' +
            '<span>' + item.label + '</span>' +
            '<i class="bi bi-chevron-down erp-dropdown-caret"></i>' +
          '</button>' +
          '<div class="erp-nav-dropdown-menu">';

        visibleSubs.forEach(function(sub) {
          var subActive = (sub.id === current) ? ' active' : '';
          html += '<a href="' + sub.href + '" class="erp-nav-dropdown-item' + subActive + '">' +
            '<i class="bi ' + sub.icon + '"></i>' +
            '<span>' + sub.label + '</span>' +
          '</a>';
        });

        html += '</div></div>';
      }
    });

    html += '</div>';
    container.innerHTML = html;

    // Attach dropdown toggle handlers
    container.querySelectorAll('.erp-nav-dropdown-toggle').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var dropdown = btn.closest('.erp-nav-dropdown');
        var wasOpen = dropdown.classList.contains('open');

        // Close all other dropdowns
        container.querySelectorAll('.erp-nav-dropdown').forEach(function(d) {
          d.classList.remove('open');
        });

        // Toggle current
        if (!wasOpen) dropdown.classList.add('open');
      });
    });

    // Close dropdowns pag click outside
    document.addEventListener('click', function() {
      container.querySelectorAll('.erp-nav-dropdown').forEach(function(d) {
        d.classList.remove('open');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }

  console.log('✅ erp-nav.js loaded (dropdown + role-aware)');
})();
