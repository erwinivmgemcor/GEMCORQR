// ============================================================
// GEMCOR ERP — Navigation Bar (Dropdown + Role-Aware + Inline Styles)
// ============================================================

(function() {
  'use strict';

  var NAV_ITEMS = [
    // Warehouse-only
    { type: 'link', id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] },
    { type: 'link', id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
    { type: 'link', id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
    
    // MRIF dropdown
    { 
      type: 'dropdown', id: 'mrif', label: 'MRIF', icon: 'bi-box-arrow-up',
      roles: ['warehouse', 'production'],
      items: [
        { id: 'mrif-list', label: 'View List', icon: 'bi-list-ul', href: 'mrif-list.html', roles: ['warehouse'] },
        { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html', roles: ['warehouse', 'production'] },
        { id: 'new-mrif-manual', label: 'Manual MRIF', icon: 'bi-pencil-square', href: 'new-mrif-manual.html', roles: ['warehouse', 'production'] }
      ]
    },
    
    // MRR dropdown
    { 
      type: 'dropdown', id: 'mrr', label: 'MRR', icon: 'bi-box-arrow-down',
      roles: ['warehouse'],
      items: [
        { id: 'mrr-list', label: 'View List', icon: 'bi-list-ul', href: 'mrr-list.html', roles: ['warehouse'] },
        { id: 'new-mrr', label: 'New MRR', icon: 'bi-plus-circle', href: 'new-mrr.html', roles: ['warehouse'] },
        { id: 'new-mrr-manual', label: 'Manual MRR', icon: 'bi-pencil-square', href: 'new-mrr-manual.html', roles: ['warehouse'] }
      ]
    },
    
    // MRS dropdown
    { 
      type: 'dropdown', id: 'mrs', label: 'MRS', icon: 'bi-arrow-counterclockwise',
      roles: ['warehouse', 'production'],
      items: [
        { id: 'mrs-list', label: 'View List', icon: 'bi-list-ul', href: 'mrs-list.html', roles: ['warehouse'] },
        { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle', href: 'new-mrs.html', roles: ['warehouse', 'production'] },
        { id: 'new-mrs-manual', label: 'Manual MRS', icon: 'bi-pencil-square', href: 'new-mrs-manual.html', roles: ['warehouse', 'production'] }
      ]
    }
  ];

  function _getUserRole() {
    try { return localStorage.getItem('ivm_userRole') || ''; } catch(e) { return ''; }
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

    var html = '<div class="erp-navbar" style="display:flex;align-items:center;gap:4px;">';

    NAV_ITEMS.forEach(function(item) {
      if (!_isAllowed(item, userRole)) return;

      if (item.type === 'link') {
        var active = (item.id === current) ? ' active' : '';
        html += '<a href="' + item.href + '" class="erp-nav-item' + active + '">' +
          '<i class="bi ' + item.icon + '"></i>' +
          '<span>' + item.label + '</span>' +
        '</a>';
      } else if (item.type === 'dropdown') {
        var visibleSubs = (item.items || []).filter(function(sub) { return _isAllowed(sub, userRole); });
        if (visibleSubs.length === 0) return;

        var dropdownActive = visibleSubs.some(function(sub) { return sub.id === current; });
        var activeClass = dropdownActive ? ' active' : '';

        html += '<div class="erp-nav-dropdown' + activeClass + '" style="position:relative;display:inline-block;">' +
          '<button class="erp-nav-item" type="button" data-dropdown-toggle="' + item.id + '" style="cursor:pointer;background:transparent;border:1.5px solid transparent;font-family:inherit;display:inline-flex;align-items:center;gap:6px;">' +
            '<i class="bi ' + item.icon + '"></i>' +
            '<span>' + item.label + '</span>' +
            '<i class="bi bi-chevron-down" style="font-size:0.7rem;margin-left:2px;transition:transform 0.2s;"></i>' +
          '</button>' +
          '<div class="erp-nav-dropdown-menu" data-dropdown-menu="' + item.id + '" style="display:none;position:absolute;top:calc(100% + 6px);left:0;background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);min-width:200px;padding:6px 0;z-index:9999;overflow:hidden;">';

        visibleSubs.forEach(function(sub) {
          var subActive = (sub.id === current) ? ' active' : '';
          var bg = subActive ? '#e8f0fe' : 'transparent';
          var color = subActive ? '#1e3a5f' : '#1f2937';
          html += '<a href="' + sub.href + '" class="erp-nav-dropdown-item' + subActive + '" style="display:flex;align-items:center;gap:10px;padding:10px 16px;color:' + color + ';text-decoration:none;font-size:0.85rem;font-weight:500;background:' + bg + ';white-space:nowrap;">' +
            '<i class="bi ' + sub.icon + '" style="font-size:1rem;width:18px;text-align:center;color:#6b7280;"></i>' +
            '<span>' + sub.label + '</span>' +
          '</a>';
        });

        html += '</div></div>';
      }
    });

    html += '</div>';
    container.innerHTML = html;

    // Attach toggle handlers
    container.querySelectorAll('[data-dropdown-toggle]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        
        var dropdownId = btn.getAttribute('data-dropdown-toggle');
        var menu = container.querySelector('[data-dropdown-menu="' + dropdownId + '"]');
        if (!menu) return;

        var isOpen = menu.style.display === 'block';

        // Close all menus
        container.querySelectorAll('.erp-nav-dropdown-menu').forEach(function(m) {
          m.style.display = 'none';
        });
        container.querySelectorAll('[data-dropdown-toggle]').forEach(function(b) {
          var caret = b.querySelector('i:last-child');
          if (caret) caret.style.transform = '';
        });

        // Toggle current
        if (!isOpen) {
          menu.style.display = 'block';
          var caret = btn.querySelector('i:last-child');
          if (caret) caret.style.transform = 'rotate(180deg)';
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (container.contains(e.target)) return;
      container.querySelectorAll('.erp-nav-dropdown-menu').forEach(function(m) {
        m.style.display = 'none';
      });
      container.querySelectorAll('[data-dropdown-toggle]').forEach(function(b) {
        var caret = b.querySelector('i:last-child');
        if (caret) caret.style.transform = '';
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        container.querySelectorAll('.erp-nav-dropdown-menu').forEach(function(m) {
          m.style.display = 'none';
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }

  console.log('✅ erp-nav.js loaded (dropdown + role-aware)');
})();
