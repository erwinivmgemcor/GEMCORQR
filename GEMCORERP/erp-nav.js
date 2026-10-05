// ============================================================
// GEMCOR ERP — Navigation Bar (Dropdown + Role-Aware)
// DOM-based + Event Delegation — walang duplicate handlers
// ============================================================

(function() {
  'use strict';

  var NAV_ITEMS = [
    { type: 'link', id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html', roles: ['warehouse'] },
    { type: 'link', id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html', roles: ['warehouse'] },
    { type: 'link', id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html', roles: ['warehouse'] },
    { 
      type: 'dropdown', id: 'mrif', label: 'MRIF', icon: 'bi-box-arrow-up',
      roles: ['warehouse', 'production'],
      items: [
        { id: 'mrif-list', label: 'View List', icon: 'bi-list-ul', href: 'mrif-list.html', roles: ['warehouse'] },
        { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html', roles: ['warehouse', 'production'] },
        { id: 'new-mrif-manual', label: 'Manual MRIF', icon: 'bi-pencil-square', href: 'new-mrif-manual.html', roles: ['warehouse', 'production'] }
      ]
    },
    { 
      type: 'dropdown', id: 'mrr', label: 'MRR', icon: 'bi-box-arrow-down',
      roles: ['warehouse'],
      items: [
        { id: 'mrr-list', label: 'View List', icon: 'bi-list-ul', href: 'mrr-list.html', roles: ['warehouse'] },
        { id: 'new-mrr', label: 'New MRR', icon: 'bi-plus-circle', href: 'new-mrr.html', roles: ['warehouse'] },
        { id: 'new-mrr-manual', label: 'Manual MRR', icon: 'bi-pencil-square', href: 'new-mrr-manual.html', roles: ['warehouse'] }
      ]
    },
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

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  function renderNavBar() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var container = document.getElementById('erpNavBar');
    if (!container) return;

    container.innerHTML = '';

    var wrapper = document.createElement('div');
    wrapper.className = 'erp-navbar';
    wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;';

    NAV_ITEMS.forEach(function(item) {
      if (!_isAllowed(item, userRole)) return;

      if (item.type === 'link') {
        wrapper.appendChild(_buildLink(item, current));
      } else if (item.type === 'dropdown') {
        var dd = _buildDropdown(item, current, userRole);
        if (dd) wrapper.appendChild(dd);
      }
    });

    container.appendChild(wrapper);
  }

  function _buildLink(item, current) {
    var link = document.createElement('a');
    link.href = item.href;
    link.className = 'erp-nav-item' + (item.id === current ? ' active' : '');
    link.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span>';
    return link;
  }

  function _buildDropdown(item, current, userRole) {
    var visibleSubs = (item.items || []).filter(function(sub) { return _isAllowed(sub, userRole); });
    if (visibleSubs.length === 0) return null;

    var isActive = visibleSubs.some(function(sub) { return sub.id === current; });

    var dd = document.createElement('div');
    dd.className = 'erp-nav-dropdown' + (isActive ? ' active' : '');
    dd.style.cssText = 'position:relative;display:inline-block;';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'erp-nav-item';
    toggle.setAttribute('data-dropdown-toggle', item.id);
    toggle.style.cssText = 'cursor:pointer;background:transparent;border:1.5px solid transparent;font-family:inherit;display:inline-flex;align-items:center;gap:6px;';
    toggle.innerHTML =
      '<i class="bi ' + item.icon + '"></i>' +
      '<span>' + item.label + '</span>' +
      '<i class="bi bi-chevron-down" data-caret="1" style="font-size:0.7rem;margin-left:2px;transition:transform 0.2s;"></i>';
    dd.appendChild(toggle);

    var menu = document.createElement('div');
    menu.className = 'erp-nav-dropdown-menu';
    menu.setAttribute('data-dropdown-menu', item.id);
    menu.style.cssText =
      'display:none;position:absolute;top:calc(100% + 6px);left:0;' +
      'background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.15);' +
      'min-width:220px;padding:6px 0;z-index:9999;overflow:hidden;';

    visibleSubs.forEach(function(sub) {
      var isSubActive = (sub.id === current);
      var subLink = document.createElement('a');
      subLink.href = sub.href;
      subLink.className = 'erp-nav-dropdown-item';
      subLink.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:10px 16px;' +
        'color:' + (isSubActive ? '#1e3a5f' : '#1f2937') + ';' +
        'text-decoration:none;font-size:0.85rem;font-weight:500;' +
        'background:' + (isSubActive ? '#e8f0fe' : 'transparent') + ';' +
        'white-space:nowrap;';
      subLink.innerHTML =
        '<i class="bi ' + sub.icon + '" style="font-size:1rem;width:18px;text-align:center;color:#6b7280;"></i>' +
        '<span>' + sub.label + '</span>';
      menu.appendChild(subLink);
    });

    dd.appendChild(menu);
    return dd;
  }

  // ═══════════════════════════════════════════════════════════
  // EVENT DELEGATION — single listener, walang duplicates
  // ═══════════════════════════════════════════════════════════
  function _attachGlobalHandlers() {
    // ONE listener for the whole document
    if (window._erpNavHandlerAttached) return;
    window._erpNavHandlerAttached = true;

    document.addEventListener('click', function(e) {
      // Find kung may naka-click na toggle button
      var toggle = e.target.closest('[data-dropdown-toggle]');
      
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();

        var container = document.getElementById('erpNavBar');
        if (!container) return;

        var dropdownId = toggle.getAttribute('data-dropdown-toggle');
        var menu = container.querySelector('[data-dropdown-menu="' + dropdownId + '"]');
        if (!menu) return;

        var isOpen = menu.style.display === 'block';

        // Close ALL menus
        container.querySelectorAll('[data-dropdown-menu]').forEach(function(m) {
          m.style.display = 'none';
        });
        container.querySelectorAll('[data-dropdown-toggle] i[data-caret="1"]').forEach(function(c) {
          c.style.transform = '';
        });

        // Open current if it was closed
        if (!isOpen) {
          menu.style.display = 'block';
          var caret = toggle.querySelector('i[data-caret="1"]');
          if (caret) caret.style.transform = 'rotate(180deg)';
        }
        return;
      }

      // Click outside any dropdown — close all
      if (!e.target.closest('.erp-nav-dropdown')) {
        var container2 = document.getElementById('erpNavBar');
        if (container2) {
          container2.querySelectorAll('[data-dropdown-menu]').forEach(function(m) {
            m.style.display = 'none';
          });
          container2.querySelectorAll('[data-dropdown-toggle] i[data-caret="1"]').forEach(function(c) {
            c.style.transform = '';
          });
        }
      }
    });

    // Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var container = document.getElementById('erpNavBar');
        if (container) {
          container.querySelectorAll('[data-dropdown-menu]').forEach(function(m) {
            m.style.display = 'none';
          });
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    renderNavBar();
    _attachGlobalHandlers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('✅ erp-nav.js loaded (dropdown + role-aware)');
})();
