// ============================================================
// GEMCOR ERP — Shared Navigation Component
// Injects a top nav bar into every page
// ============================================================

(function() {
  'use strict';
  
var NAV_ITEMS = [
  { id: 'stock-monitor', label: 'Stock Monitor', icon: 'bi-speedometer2', href: 'stock-monitor.html' },
  { id: 'weekly-monitor', label: 'Weekly Monitoring', icon: 'bi-calendar-week', href: 'weekly-monitor.html' },
  { id: 'usage-trend', label: 'Usage Trend', icon: 'bi-graph-up-arrow', href: 'usage-trend.html' },
  { id: 'mrif-list', label: 'MRIF', icon: 'bi-box-arrow-up', href: 'mrif-list.html' },
  { id: 'mrr-list', label: 'MRR', icon: 'bi-box-arrow-down', href: 'mrr-list.html' },
  { id: 'mrs-list', label: 'MRS', icon: 'bi-arrow-counterclockwise', href: 'mrs-list.html' }
];
  
function getCurrentPage() {
  var path = window.location.pathname;
  if (path.indexOf('weekly-monitor') !== -1) return 'weekly-monitor';
  if (path.indexOf('stock-monitor') !== -1) return 'stock-monitor';
  if (path.indexOf('usage-trend') !== -1) return 'usage-trend';
  if (path.indexOf('usage-entry') !== -1) return 'usage-entry';
  if (path.indexOf('mrif-list') !== -1) return 'mrif-list';
  if (path.indexOf('mrr-list') !== -1) return 'mrr-list';
  if (path.indexOf('mrs-list') !== -1) return 'mrs-list';
  return '';
}
  
  function renderNavBar() {
    var current = getCurrentPage();
    var container = document.getElementById('erpNavBar');
    if (!container) return;
    
    var html = '<div class="erp-navbar">';
    
    NAV_ITEMS.forEach(function(item) {
      var active = (item.id === current) ? ' active' : '';
      html += '<a href="' + item.href + '" class="erp-nav-item' + active + '">' +
        '<i class="bi ' + item.icon + '"></i>' +
        '<span>' + item.label + '</span>' +
      '</a>';
    });
    
    html += '</div>';
    container.innerHTML = html;
  }
  
  // Auto-render on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNavBar);
  } else {
    renderNavBar();
  }
  
  console.log('✅ erp-nav.js loaded');
})();
