// ============================================================
// GEMCOR ERP — Edit Request Permission (Production)
// v1.0 — Production users request edit permission
// ✅ Uses edit_requests table
// ✅ Status: PENDING → APPROVED → COMPLETED
// ✅ Reason required
// ============================================================

// ═══════════════════════════════════════════════════════════
// CHECK EDIT PERMISSION — Get current state for a document
// ═══════════════════════════════════════════════════════════
async function checkEditPermission(docNo) {
  if (!docNo) return null;
  
  var currentUser = localStorage.getItem('ivm_username') || '';
  if (!currentUser) return null;
  
  try {
    // Query edit_requests table
    var rows = await erpFetch('edit_requests',
      'select=*' +
      '&doc_no=eq.' + encodeURIComponent(docNo) +
      '&requested_by=eq.' + encodeURIComponent(currentUser) +
      '&order=created_at.desc' +
      '&limit=1');
    
    if (!rows || rows.length === 0) {
      return { status: 'NONE', request: null };
    }
    
    return { 
      status: rows[0].status || 'PENDING', 
      request: rows[0] 
    };
    
  } catch(err) {
    console.warn('[EditPermission] Failed to check:', err.message);
    return { status: 'ERROR', request: null, error: err.message };
  }
}

window.checkEditPermission = checkEditPermission;

// ═══════════════════════════════════════════════════════════
// REQUEST EDIT PERMISSION — Creates edit_requests row
// ═══════════════════════════════════════════════════════════
async function requestEditPermission(docNo, docType) {
  if (!docNo) {
    erpShowToast('No document selected', 'warning');
    return false;
  }
  
  var currentUser = localStorage.getItem('ivm_username') || '';
  var currentFullname = localStorage.getItem('ivm_userFullname') || currentUser;
  
  if (!currentUser) {
    erpShowToast('Please log in again', 'danger');
    return false;
  }
  
  // ═══ Get reason from user ═══
  var reason = prompt(
    'Request Edit Permission\n\n' +
    'Document: ' + docNo + '\n' +
    'Type: ' + (docType || 'MRIF') + '\n\n' +
    'Why do you need to edit this document?',
    ''
  );
  
  if (reason === null) return false; // User cancelled
  
  reason = String(reason).trim();
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    return false;
  }
  
  // ═══ Confirm ═══
  if (!confirm('Submit edit request?\n\nReason: ' + reason)) {
    return false;
  }
  
  try {
    // ═══ Check if there's already a PENDING request ═══
    var existing = await erpFetch('edit_requests',
      'select=id,status' +
      '&doc_no=eq.' + encodeURIComponent(docNo) +
      '&requested_by=eq.' + encodeURIComponent(currentUser) +
      '&status=eq.PENDING' +
      '&limit=1');
    
    if (existing && existing.length > 0) {
      erpShowToast('You already have a PENDING edit request for this document', 'warning');
      return false;
    }
    
    // ═══ Insert new request ═══
    var res = await fetch(erpUrl('edit_requests'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: String(docType || 'MRIF').toUpperCase(),
        requested_by: currentUser,
        requested_by_fullname: currentFullname,
        reason: reason,
        status: 'PENDING',
        created_at: new Date().toISOString()
      })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' ' + errText);
    }
    
    var result = await res.json();
    console.log('[EditPermission] ✅ Created:', result);
    
    erpShowToast('✅ Edit request submitted. Warehouse will review shortly.', 'success');
    
    // Refresh the page/section
    setTimeout(function() {
      if (typeof loadMyRequests === 'function') {
        loadMyRequests();
      } else {
        window.location.reload();
      }
    }, 1000);
    
    return true;
    
  } catch(err) {
    console.error('[EditPermission] Failed:', err);
    erpShowToast('Failed to submit: ' + err.message, 'danger');
    return false;
  }
}

window.requestEditPermission = requestEditPermission;

// ═══════════════════════════════════════════════════════════
// RENDER EDIT BUTTON — Returns HTML based on state
// ═══════════════════════════════════════════════════════════
function renderEditButton(docNo, docType, docStatus, editPerm) {
  var statusUpper = String(docStatus || '').toUpperCase();
  var safeDoc = String(docNo).replace(/'/g, "\\'");
  var safeType = String(docType || 'MRIF').replace(/'/g, "\\'");
  
  // ═══ Document-level lock check ═══
  if (statusUpper === 'COMPLETED') {
    return '<span class="btn btn-sm btn-outline-success disabled" title="Document is fully processed">' +
      '<i class="bi bi-lock-fill me-1"></i>Locked (Completed)' +
    '</span>';
  }
  
  if (statusUpper === 'PARTIAL') {
    return '<span class="btn btn-sm btn-outline-secondary disabled" title="Partially-issued documents cannot be edited">' +
      '<i class="bi bi-lock-fill me-1"></i>Locked (Partial)' +
    '</span>';
  }
  
  // ═══ Edit request state check ═══
  var editStatus = (editPerm && editPerm.status) ? String(editPerm.status).toUpperCase() : 'NONE';
  
  if (editStatus === 'PENDING') {
    return '<span class="btn btn-sm btn-outline-warning disabled" title="Waiting for warehouse approval">' +
      '<i class="bi bi-hourglass-split me-1"></i>Edit Pending Approval' +
    '</span>';
  }
  
  if (editStatus === 'APPROVED') {
    return '<button class="btn btn-sm btn-success fw-bold" onclick="openProductionEdit(\'' + safeDoc + '\', \'' + safeType + '\')">' +
      '<i class="bi bi-pencil-square me-1"></i>Edit Now' +
    '</button>';
  }
  
  if (editStatus === 'REJECTED') {
    var rejectReason = editPerm.request && editPerm.request.reject_reason 
      ? String(editPerm.request.reject_reason).replace(/"/g, '&quot;') 
      : '';
    var titleAttr = rejectReason ? ' title="Rejected: ' + rejectReason + '"' : '';
    return '<button class="btn btn-sm btn-outline-danger" ' +
      'onclick="requestEditPermission(\'' + safeDoc + '\', \'' + safeType + '\')"' + titleAttr + '>' +
      '<i class="bi bi-x-circle me-1"></i>Rejected — Request Again' +
    '</button>';
  }
  
  // NONE or COMPLETED edit request → Request Edit
  return '<button class="btn btn-sm btn-outline-warning" ' +
    'onclick="requestEditPermission(\'' + safeDoc + '\', \'' + safeType + '\')">' +
    '<i class="bi bi-pencil me-1"></i>Request Edit' +
  '</button>';
}

window.renderEditButton = renderEditButton;

// ═══════════════════════════════════════════════════════════
// OPEN PRODUCTION EDIT — Placeholder (Phase 4D)
// ═══════════════════════════════════════════════════════════
function openProductionEdit(docNo, docType) {
  // For now, just a placeholder — to be implemented sa Phase 4D
  erpShowToast('Opening edit form for ' + docNo + '...', 'info');
  
  // TODO: Implement actual edit modal in Phase 4D
  // For now, just a placeholder that shows message
  setTimeout(function() {
    alert('Edit form coming soon.\n\nDocument: ' + docNo + '\nType: ' + docType + '\n\nThis will be implemented in the next phase.');
  }, 500);
}

window.openProductionEdit = openProductionEdit;

console.log('✅ edit-request-permission.js v1.0 loaded');
