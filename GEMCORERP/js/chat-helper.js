// ============================================================
// GEMCOR ERP — Chat Helper (Lightweight)
// v1.1 — Role-based access for MRR threads
// No dependencies — safe to load anywhere
// ============================================================

(function() {
  'use strict';
  
  // ═══════════════════════════════════════════════════════════
  // ROLE CHECK — MRR is warehouse-only
  // ═══════════════════════════════════════════════════════════
  function _canDiscussDoc(docType) {
    var userRole = localStorage.getItem('ivm_userRole') || '';
    var typeUpper = String(docType || '').toUpperCase();
    
    // Production users cannot discuss MRR threads
    if (typeUpper === 'MRR' && userRole !== 'warehouse') {
      return false;
    }
    return true;
  }
  
  // ═══════════════════════════════════════════════════════════
  // DISCUSS DOCUMENT — Redirect to chat with doc context
  // ═══════════════════════════════════════════════════════════
  window.discussDocument = function(docNo, docType) {
    if (!docNo) {
      console.warn('[Chat Helper] No docNo provided');
      return;
    }
    
    // ═══ Role-based access check ═══
    if (!_canDiscussDoc(docType)) {
      console.warn('[Chat Helper] Access denied: MRR is warehouse-only');
      if (typeof erpShowToast === 'function') {
        erpShowToast('MRR discussions are accessible to warehouse only', 'warning');
      } else {
        alert('MRR discussions are accessible to warehouse only');
      }
      return;
    }
    
    // Save intent (in case of login redirect)
    try {
      localStorage.setItem('ivm_chat_open_doc', docNo);
      localStorage.setItem('ivm_chat_open_type', docType || '');
    } catch(e) {}
    
    // Build URL
    var url = 'chat.html?doc=' + encodeURIComponent(docNo) + 
              '&type=' + encodeURIComponent(docType || '');
    
    console.log('[Chat Helper] Opening:', url);
    
    // Navigate
    window.location.href = url;
  };
  
  // ═══════════════════════════════════════════════════════════
  // DISCUSS USER — DM a specific user
  // ═══════════════════════════════════════════════════════════
  window.discussUser = function(username) {
    if (!username) return;
    
    try {
      localStorage.setItem('ivm_chat_open_user', username);
    } catch(e) {}
    
    var url = 'chat.html?user=' + encodeURIComponent(username);
    
    console.log('[Chat Helper] Opening DM:', url);
    window.location.href = url;
  };
  
  console.log('✅ chat-helper.js v1.1 loaded (with MRR role check)');
})();
