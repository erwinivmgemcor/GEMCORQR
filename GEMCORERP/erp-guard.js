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
    'new-mrs.html'
    'new-mrif-manual.html'
    'new-mrs-manual.html'
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

    // Warehouse: full access
    if (role === 'warehouse') {
      console.log('[ERP Guard] ✓ Warehouse access for ' + username);
      return;
    }

    // Production: only whitelisted pages
    if (role === 'production') {
      if (PRODUCTION_ALLOWED.indexOf(currentPage) !== -1) {
        console.log('[ERP Guard] ✓ Production access: ' + currentPage);
        return;
      }
      // Redirect production to their home page
      console.warn('[ERP Guard] Production not allowed on ' + currentPage + ' — redirecting to My Requests');
      window.location.replace('my-requests.html');
      return;
    }

    _redirectToLogin('Unknown role: ' + role);
  }

  _checkAccess();
})();
