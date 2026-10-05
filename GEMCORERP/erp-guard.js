// ============================================================
// GEMCOR ERP — Access Guard (v2 - hybrid)
// Allows BOTH warehouse and production roles
// Some pages production-allowed, some warehouse-only
// ============================================================

(function() {
  'use strict';

  var RETURN_KEY = 'ivm_erpReturnUrl';
  var MAIN_LOGIN = '../index.html';

  // Pages na pwedeng i-access ng BOTH warehouse + production
  var PRODUCTION_ALLOWED_PAGES = [
    'new-mrif.html',
    'new-mrif-manual.html',
    'new-mrr-manual.html',  // if production can do manual MRR too
    // Add more pages here kung allowed sa production
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
    var allowedRoles = [];

    try {
      role = localStorage.getItem('ivm_userRole') || '';
      username = localStorage.getItem('ivm_username') || '';
      var rolesJson = localStorage.getItem('ivm_allowedRoles');
      if (rolesJson) {
        try { allowedRoles = JSON.parse(rolesJson); } catch(e) {}
      }
    } catch(e) {
      _redirectToLogin('localStorage unavailable');
      return;
    }

    // Must be logged in
    if (!username || !role) {
      _redirectToLogin('No user session');
      return;
    }

    // Warehouse users: full access to ERP
    if (role === 'warehouse') {
      console.log('[ERP Guard] ✓ Warehouse access for ' + username);
      return;
    }

    // Production users: restricted access — only some pages
    if (role === 'production') {
      var currentPage = _getCurrentPage();

      if (PRODUCTION_ALLOWED_PAGES.indexOf(currentPage) !== -1) {
        console.log('[ERP Guard] ✓ Production access allowed for ' + currentPage);
        return;
      }

      // Not allowed — redirect to legacy WMS
      _redirectToLogin('Production user — page ' + currentPage + ' not allowed');
      return;
    }

    // Unknown role
    _redirectToLogin('Unknown role: ' + role);
  }

  _checkAccess();
})();
