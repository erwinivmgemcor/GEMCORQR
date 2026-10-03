// ============================================================
// GEMCOR ERP — Access Guard
// Only allows warehouse staff (with valid login) to view ERP pages
// Non-warehouse users are redirected to the main login
// ============================================================

(function() {
  'use strict';

  var RETURN_KEY = 'ivm_erpReturnUrl';

  function _redirectToLogin(reason) {
    // Save the current URL so we can come back after login
    try {
      sessionStorage.setItem(RETURN_KEY, window.location.href);
    } catch(e) {}

    console.warn('[ERP Guard] Access denied:', reason);

    // Redirect to main login page
    var mainUrl = '../index.html';
    window.location.replace(mainUrl);
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

    // Allow only warehouse role with a valid username
    if (role !== 'warehouse' || !username) {
      _redirectToLogin('Role=' + (role || 'none') + ' User=' + (username || 'none'));
      return;
    }

    // Optional: log access for audit
    console.log('[ERP Guard] Access granted for ' + username);
  }

  // Run immediately (before page renders)
  _checkAccess();
})();
