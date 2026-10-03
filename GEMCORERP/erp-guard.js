// ============================================================
// GEMCOR ERP — Access Guard
// Only warehouse staff (with valid login) can view ERP pages.
// Non-warehouse users are redirected to the main login.
// ============================================================

(function() {
  'use strict';

  var RETURN_KEY = 'ivm_erpReturnUrl';
  var MAIN_LOGIN = '../index.html';

  function _redirectToLogin(reason) {
    // Save current URL so we can come back after successful login
    try {
      sessionStorage.setItem(RETURN_KEY, window.location.href);
    } catch(e) {}

    console.warn('[ERP Guard] Access denied:', reason);

    // Redirect to main login page
    window.location.replace(MAIN_LOGIN);
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
      _redirectToLogin('Role=' + (role || 'none') + ' | User=' + (username || 'none'));
      return;
    }

    console.log('[ERP Guard] ✓ Access granted for ' + username);
  }

  // Run immediately before page renders
  _checkAccess();
})();
