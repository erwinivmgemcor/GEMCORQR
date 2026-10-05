// ============================================================
// GEMCOR ERP — Navigation Bar (Dropdown + Role-Aware)
// DOM-based rendering — no HTML string concat bugs
// ============================================================

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // NAV STRUCTURE
  // ═══════════════════════════════════════════════════════════
  var NAV_ITEMS = [
    // Warehouse-only links
    {
      type: 'link',
      id: 'stock-monitor',
      label: 'Stock Monitor',
      icon: 'bi-speedometer2',
      href: 'stock-monitor.html',
      roles: ['warehouse']
    },
    {
      type: 'link',
      id: 'weekly-monitor',
      label: 'Weekly Monitoring',
      icon: 'bi-calendar-week',
      href: 'weekly-monitor.html',
      roles: ['warehouse']
    },
    {
      type: 'link',
      id: 'usage-trend',
      label: 'Usage Trend',
      icon: 'bi-graph-up-arrow',
      href: 'usage-trend.html',
      roles: ['warehouse']
    },

    // MRIF dropdown
    {
      type: 'dropdown',
      id: 'mrif',
      label: 'MRIF',
      icon: 'bi-box-arrow-up',
      roles: ['warehouse', 'production'],
      items: [
        { id: 'mrif-list', label: 'View List', icon: 'bi-list-ul', href: 'mrif-list.html', roles: ['warehouse'] },
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
        { id: 'mrr-list', label: 'View List', icon: 'bi-list-ul', href: 'mrr-list.html', roles: ['warehouse'] },
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
        { id: 'mrs-list', label: 'View List', icon: 'bi-list-ul', href: 'mrs-list.html', roles: ['warehouse'] },
        { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle', href: 'new-mrs.html', roles: ['warehouse', 'production'] },
        { id: 'new-mrs-manual', label: 'Manual MRS', icon: 'bi-pencil-square', href: 'new-mrs-manual.html', roles: ['warehouse', 'production'] }
      ]
    }
  ];

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
  // RENDER NAV BAR
  // ═══════════════════════════════════════════════════════════
  function renderNavBar() {
    var current = _getCurrentPage();
    var userRole = _getUserRole();
    var container = document.getElementById('erpNavBar');
    if (!container) {
      console.warn('[erp-nav] #erpNavBar not found');
      return;
    }

    // Clear existing
    container.innerHTML = '';

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'erp-navbar';
    wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;';

    // Build items
    NAV_ITEMS.forEach(function(item) {
      if (!_isAllowed(item, userRole)) return;

      if (item.type === 'link') {
        wrapper.appendChild(_buildLink(item, current));
      } else if (item.type === 'dropdown') {
        var dropdown = _buildDropdown(item, current, userRole);
        if (dropdown) wrapper.appendChild(dropdown);
      }
    });

    container.appendChild(wrapper);

    // Attach event handlers
    _attachDropdownHandlers(container);
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD SIMPLE LINK
  // ═══════════════════════════════════════════════════════════
  function _buildLink(item, current) {
    var link = document.createElement('a');
    link.href = item.href;
    link.className = 'erp-nav-item' + (item.id === current ? ' active' : '');
    link.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span>';
    return link;
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD DROPDOWN
  // ═══════════════════════════════════════════════════════════
  function _buildDropdown(item, current, userRole) {
    // Filter sub-items by role
    var visibleSubs = (item.items || []).filter(function(sub) {
      return _isAllowed(sub, userRole);
    });
    if (visibleSubs.length === 0) return null;

    // Check if dropdown is active (current page is one of sub-items)
    var isActive = visibleSubs.some(function(sub) { return sub.id === current; });

    // Outer wrapper
    var dropdown = document.createElement('div');
    dropdown.className = 'erp-nav-dropdown' + (isActive ? ' active' : '');
    dropdown.style.cssText = 'position:relative;display:inline-block;';

    // Toggle button
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'erp-nav-item';
    toggle.setAttribute('data-dropdown-toggle', item.id);
    toggle.style.cssText = 'cursor:pointer;background:transparent;border:1.5px solid transparent;font-family:inherit;display:inline-flex;align-items:center;gap:6px;';
    toggle.innerHTML =
      '<i class="bi ' + item.icon + '"></i>' +
      '<span>' + item.label + '</span>' +
      '<i class="bi bi-chevron-down" data-caret="1" style="font-size:0.7rem;margin-left:2px;transition:transform 0.2s;"></i>';
    dropdown.appendChild(toggle);

    // Menu container
    var menu = document.createElement('div');
    menu.className = 'erp-nav-dropdown-menu';
    menu.setAttribute('data-dropdown-menu', item.id);
    menu.style.cssText =
      'display:none;' +
      'position:absolute;' +
      'top:calc(100% + 6px);' +
      'left:0;' +
      'background:#fff;' +
      'border-radius:8px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.15);' +
      'min-width:220px;' +
      'padding:6px 0;' +
      'z-index:9999;' +
      'overflow:hidden;';

    // Sub-items
    visibleSubs.forEach(function(sub) {
      var subLink = document.createElement('a');
      subLink.href = sub.href;
      subLink.className = 'erp-nav-dropdown-item';
      var isSubActive = (sub.id === current);
      subLink.style.cssText =
        'display:flex;' +
        'align-items:center;' +
        'gap:10px;' +
        'padding:10px 16px;' +
        'color:' + (isSubActive ? '#1e3a5f' : '#1f2937') + ';' +
        'text-decoration:none;' +
        'font-size:0.85rem;' +
        'font-weight:500;' +
        'background:' + (isSubActive ? '#e8f0fe' : 'transparent') + ';' +
        'white-space:nowrap;';
      subLink.innerHTML =
        '<i class="bi ' + sub.icon + '" style="font-size:1rem;width:18px;text-align:center;color:#6b7280;"></i>' +
        '<span>' + sub.label + '</span>';
      menu.appendChild(subLink);
    });

    dropdown.appendChild(menu);
    return dropdown;
  }

  // ═══════════════════════════════════════════════════════════
  // ATTACH DROPDOWN HANDLERS
  // ═══════════════════════════════════════════════════════════
  function _attachDropdownHandlers(container) {
    // Toggle on click
    container.querySelectorAll('[data-dropdown-toggle]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();

        var dropdownId = btn.getAttribute('data-dropdown-toggle');
        var menu = container.querySelector('[data-dropdown-menu="' + dropdownId + '"]');
        if (!menu) return;

        var isOpen = menu.style.display === 'block';

        // Close all menus first
        _closeAllMenus(container);

        // Toggle current
        if (!isOpen) {
          menu.style.display = 'block';
          var caret = btn.querySelector('i[data-caret="1"]');
          if (caret) caret.style.transform = 'rotate(180deg)';
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (container.contains(e.target)) return;
      _closeAllMenus(container);
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        _closeAllMenus(container);
      }
    });
  }

  function _closeAllMenus(container) {
    container.querySelectorAll('[data-dropdown-menu]').forEach(function(menu) {
      menu.style.display = 'none';
    });
    container.querySelectorAll('[data-dropdown-toggle]').forEach(function(btn) {
      var caret = btn.querySelector('i[data-caret="1"]');
      if (caret) caret.style.transform = '';
    });
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }

  console.log('✅ erp-nav.js loaded (dropdown + role-aware)');
})();
