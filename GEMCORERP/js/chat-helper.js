// ============================================================
// GEMCOR ERP — Chat Helper (Lightweight)
// Shared across pages for discussDocument() function
// No dependencies — safe to load anywhere
// ============================================================

(function() {
  'use strict';
  
  // ═══════════════════════════════════════════════════════════
  // DISCUSS DOCUMENT — Redirect to chat with doc context
  // ═══════════════════════════════════════════════════════════
  window.discussDocument = function(docNo, docType) {
    if (!docNo) {
      console.warn('[Chat Helper] No docNo provided');
      return;
    }
    
    // Save intent (in case may login redirect)
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
  
  console.log('✅ chat-helper.js loaded');
})();
