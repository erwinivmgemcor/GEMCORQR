// SIMPLE NAV BAR — ULTRA MINIMAL
// ============================================================

var ERP_NAV_ITEMS = [
  { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html' },
  { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html' },
  { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html' },
  { id: 'mrif-list', label: 'MRIF', icon: 'bi-box-arrow-up', href: 'mrif-list.html', children: [
    { id: 'mrif-list', label: 'View List', icon: 'bi-list-ul', href: 'mrif-list.html' },
    { id: 'new-mrif', label: 'New MRIF', icon: 'bi-plus-circle', href: 'new-mrif.html' },
    { id: 'new-mrif-manual', label: 'Manual MRIF', icon: 'bi-pencil-square', href: 'new-mrif-manual.html' }
  ]},
  { id: 'mrr-list', label: 'MRR', icon: 'bi-box-arrow-down', href: 'mrr-list.html', children: [
    { id: 'mrr-list', label: 'View List', icon: 'bi-list-ul', href: 'mrr-list.html' },
    { id: 'new-mrr', label: 'New MRR', icon: 'bi-plus-circle', href: 'new-mrr.html' },
    { id: 'new-mrr-manual', label: 'Manual MRR', icon: 'bi-pencil-square', href: 'new-mrr-manual.html' }
  ]},
  { id: 'mrs-list', label: 'MRS', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html', children: [
    { id: 'mrs-list', label: 'View List', icon: 'bi-list-ul', href: 'mrs-list.html' },
    { id: 'new-mrs', label: 'New MRS', icon: 'bi-plus-circle', href: 'new-mrs.html' },
    { id: 'new-mrs-manual', label: 'Manual MRS', icon: 'bi-pencil-square', href: 'new-mrs-manual.html' }
  ]}
];

function erpNavRender() {
  var container = document.getElementById('erpNavBar');
  if (!container) return;

  container.innerHTML = '';
  var nav = document.createElement('div');
  nav.className = 'erp-navbar';
  nav.style.cssText = 'display:flex;align-items:center;gap:4px;';

  ERP_NAV_ITEMS.forEach(function(item) {
    if (item.children && item.children.length > 0) {
      nav.appendChild(erpNavBuildDropdown(item));
    } else {
      nav.appendChild(erpNavBuildLink(item));
    }
  });

  container.appendChild(nav);
}

function erpNavBuildLink(item) {
  var a = document.createElement('a');
  a.href = item.href;
  a.className = 'erp-nav-item';
  a.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span>';
  return a;
}

function erpNavBuildDropdown(item) {
  var dd = document.createElement('div');
  dd.className = 'erp-nav-dropdown';
  dd.style.cssText = 'position:relative;display:inline-block;';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'erp-nav-item';
  btn.style.cssText = 'cursor:pointer;background:transparent;border:none;color:inherit;font-family:inherit;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;';
  btn.innerHTML = '<i class="bi ' + item.icon + '"></i><span>' + item.label + '</span><i class="bi bi-chevron-down" style="font-size:0.7rem;"></i>';
  
  btn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    var menu = this.nextElementSibling;
    var isOpen = menu.style.display === 'block';
    
    // Close all other menus
    document.querySelectorAll('.erp-nav-dropdown-menu').forEach(function(m) {
      m.style.display = 'none';
    });
    
    if (!isOpen) {
      menu.style.display = 'block';
    }
  };

  var menu = document.createElement('div');
  menu.className = 'erp-nav-dropdown-menu';
  menu.style.cssText = 'display:none;position:absolute;top:calc(100% + 6px);left:0;background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);min-width:220px;padding:6px 0;z-index:9999;';

  item.children.forEach(function(sub) {
    var subLink = document.createElement('a');
    subLink.href = sub.href;
    subLink.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;color:#1f2937;text-decoration:none;font-size:0.85rem;font-weight:500;white-space:nowrap;';
    subLink.onmouseenter = function() { this.style.background = '#f0f4f8'; };
    subLink.onmouseleave = function() { this.style.background = 'transparent'; };
    subLink.innerHTML = '<i class="bi ' + sub.icon + '" style="font-size:1rem;width:18px;text-align:center;color:#6b7280;"></i><span>' + sub.label + '</span>';
    menu.appendChild(subLink);
  });

  dd.appendChild(btn);
  dd.appendChild(menu);
  return dd;
}

// Close on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.erp-nav-dropdown')) {
    document.querySelectorAll('.erp-nav-dropdown-menu').forEach(function(m) {
      m.style.display = 'none';
    });
  }
});

// Init
// Force render — multiple attempts to be sure
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    erpNavRender();
    setTimeout(erpNavRender, 100);  // retry after 100ms
  });
} else {
  erpNavRender();
  setTimeout(erpNavRender, 100);  // retry after 100ms
}

// Also expose globally for manual retry
window.erpNavRender = erpNavRender;
console.log('✅ erp-nav.js loaded (simple version)');
