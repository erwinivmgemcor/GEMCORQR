// ============================================================
// GEMCOR ERP — Access Guard (v3 — role-based)
// Warehouse: full access
// Production: restricted to specific pages
// ============================================================

(function() {
  'use strict';

  var RETURN_KEY = 'ivm_erpReturnUrl';
  var MAIN_LOGIN = '../index.html';

  // Pages na pwedeng i-access ng production users
  var PRODUCTION_ALLOWED = [
    'my-requests.html',
    'new-mrif.html',
    'new-mrs.html',
    'new-mrif-manual.html',
    'chat.html',
    'new-mrs-manual.html',
    'project-costing.html',
    'block-blast.html',  // Break Room (laro)
    'item-in-out.html',  // Item In & Out (view-only movement history)
    'about.html',        // About / FAQs / Process flow
    'sof-tracker.html'   // SOF Tracker (view-only for production)
  ];
  
  // Procurement / Finance: read-only, specific pages only
  var VIEWER_PAGES = {
    procurement: ['mrr-monitoring.html', 'prf-monitor.html', 'replenishment.html', 'sof-tracker.html', 'item-catalog.html', 'chat.html', 'about.html', 'item-in-out.html', 'block-blast.html'],
    finance: ['mrif-monitoring.html', 'project-costing.html', 'chat.html', 'about.html', 'item-in-out.html', 'block-blast.html']
  };
  var VIEWER_HOME = { procurement: 'mrr-monitoring.html', finance: 'mrif-monitoring.html' };

  // Write-actions hidden for read-only roles (matched by onclick text)
  var READONLY_WRITE_FNS = [
    'openTransmittalModal', 'openEditPrfItems', 'openEditPrfNo', 'bulkUpdateStatus',
    'prfSyncAndRecompute', 'savePoEdit', 'openPoEditModal', 'saveEditPrfItems', 'saveEditedPrfNo',
    'prfCancel', 'addEditPrfItem', 'editPrfRemoveItem', 'sofOpenManual', 'sofReleaseItem', 'sofManualSubmit'
  ];

  function _applyReadOnly(role) {
    try {
      var css = READONLY_WRITE_FNS.map(function(f) {
        return '[onclick*="' + f + '"]';
      }).join(',') + ',.item-select-cb,#selectAllItems,#bulkActionsBar,.bulk-status-btn,.erp-readonly-hide{display:none!important}' +
        '.erp-readonly-badge{position:fixed;right:14px;bottom:14px;z-index:9999;background:#1e3a5f;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:7px 12px;border-radius:20px;opacity:.9;pointer-events:none}';
      if (_getCurrentPage() === 'sof-tracker.html') css += 'a[href="stock-monitor.html"]{display:none!important}';
      // Procurement only needs the PRFs tab of Replenishment (Needs tab = create PRFs → hidden)
      if (_getCurrentPage() === 'replenishment.html') {
        css += '.rp-tabs,#rpTabNeeds,#rpBtnExport{display:none!important}';
        if (location.hash !== '#prfs') { try { history.replaceState(null, '', location.pathname + location.search + '#prfs'); } catch (e) {} }
      }
      var st = document.createElement('style');
      st.id = 'erp-readonly-css';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);

      // Block any write request (defense in depth). Read RPCs (POST /rpc/...) and
      // housekeeping tables (notifications / chat / presence / locks) stay allowed.
      var _fetch = window.fetch;
      var SAFE = /\/rest\/v1\/rpc\/(get_|erp_get_|erp_sof_get_|list_|search_|verify_|erp_search)|notif|alert|chat|presence|heartbeat|avatar|profile|password|setting|log_|erp_doc_open/i;
      window.fetch = function(input, init) {
        try {
          var url = (typeof input === 'string') ? input : (input && input.url) || '';
          var m = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && url.indexOf('/rest/v1/') !== -1 && !SAFE.test(url)) {
            console.warn('[ERP Guard] Read-only role blocked ' + m + ' ' + url);
            return Promise.resolve(new Response(JSON.stringify({ error: 'Read-only access' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
          }
        } catch (e) {}
        return _fetch.apply(this, arguments);
      };

      document.addEventListener('DOMContentLoaded', function() {
        var b = document.createElement('div');
        b.className = 'erp-readonly-badge';
        b.textContent = 'READ-ONLY · ' + role.toUpperCase();
        document.body.appendChild(b);
      });
    } catch (e) {}
  }

  // ✅ NEW: Admin-only pages
  var ADMIN_ONLY_PAGES = [
    'admin-users.html',
    'warehouse-kpi.html'
  ];

  function _redirectToLogin(reason) {
    try {
      sessionStorage.setItem(RETURN_KEY, window.location.href);
    } catch(e) {}
    console.warn('[ERP Guard] Access denied:', reason);
    window.location.replace(MAIN_LOGIN);
  }

  function _getCurrentPage() {
    var path = window.location.pathname;
    return path.substring(path.lastIndexOf('/') + 1);
  }

  function _checkAccess() {
    var role = '';
    var username = '';

    try {
      role = localStorage.getItem('ivm_userRole') || '';
      username = localStorage.getItem('ivm_username') || '';
    } catch(e) {
      _redirectToLogin('localStorage unavailable');
      return;
    }

       if (!username || !role) {
      _redirectToLogin('No session');
      return;
    }

    var currentPage = _getCurrentPage();

    // ✅ NEW: Check admin-only pages
    if (ADMIN_ONLY_PAGES.indexOf(currentPage) !== -1) {
      var isAdmin = localStorage.getItem('ivm_isAdmin') === 'true';
      if (!isAdmin) {
        console.warn('[ERP Guard] Admin-only page blocked for non-admin: ' + username);
        window.location.replace('management-dashboard.html');
        return;
      }
      console.log('[ERP Guard] ✓ Admin access granted for ' + username);
      return;
    }

    // Procurement / Finance: read-only, whitelisted pages
    if (VIEWER_PAGES[role]) {
      if (VIEWER_PAGES[role].indexOf(currentPage) !== -1) {
        _applyReadOnly(role);
        console.log('[ERP Guard] ✓ Read-only ' + role + ': ' + currentPage);
        return;
      }
      window.location.replace(VIEWER_HOME[role]);
      return;
    }

    // Warehouse: full access
    if (role === 'warehouse') {
      console.log('[ERP Guard] ✓ Warehouse access for ' + username);
      return;
    }

       // Production: only whitelisted pages
      // Production: only whitelisted pages
  if (role === 'production') {
    if (PRODUCTION_ALLOWED.indexOf(currentPage) !== -1) {
      // SOF Tracker is view-only for production: hides Manual Allocate / Release and blocks writes on this page
      if (currentPage === 'sof-tracker.html') _applyReadOnly('production');
      console.log('[ERP Guard] ✓ Production access: ' + currentPage);
      return;
    }
    // Redirect production to their home page
    console.warn('[ERP Guard] Production not allowed on ' + currentPage + ' — redirecting to My Requests');
    window.location.replace('my-requests.html');
    return;
  }

  _redirectToLogin('Unknown role: ' + role);
}  // ✅ IDINAGDAG — closing brace para sa _checkAccess() function

  _checkAccess();
})();
