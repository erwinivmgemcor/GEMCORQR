// ============================================================
// GEMCOR ERP — Edit Requests (Warehouse Approval)
// v1.0 — Approve/reject production edit requests
// ============================================================

var _erState = {
  allRequests: [],
  filteredRequests: [],
  currentPage: 1,
  pageSize: 20,
  searchTimer: null,
  currentUser: '',
  currentUsername: '',
  rejectModal: null,
  viewDocModal: null,
  pollTimer: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Edit Requests] Initializing...');
  
  _erState.currentUser = localStorage.getItem('ivm_userFullname') || 
                         localStorage.getItem('ivm_username') || '';
  _erState.currentUsername = localStorage.getItem('ivm_username') || '';
  
  console.log('[Edit Requests] User:', _erState.currentUser);
  
  erCheckHealth();
  erLoadEditRequests();
  
  // Auto-refresh every 60s
  _erState.pollTimer = setInterval(function() {
    if (!document.hidden) {
      erLoadEditRequests();
    }
  }, 60000);
});

async function erCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var result = await erpHealthCheck();
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(err) {
    dot.className = 'dot dot-error';
    text.textContent = 'Error';
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD REQUESTS
// ═══════════════════════════════════════════════════════════
async function erLoadEditRequests() {
  var container = document.getElementById('erListContainer');
  if (container) {
    container.innerHTML = '<div class="text-center py-4">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2 text-muted">Loading edit requests...</div>' +
      '</div>';
  }
  
  try {
    var status = document.getElementById('erStatusFilter') ? document.getElementById('erStatusFilter').value : 'PENDING';
    var docType = document.getElementById('erDocTypeFilter') ? document.getElementById('erDocTypeFilter').value : '';
    
    // Build query
    var query = 'select=*&order=created_at.desc&limit=500';
    if (status) query += '&status=eq.' + encodeURIComponent(status);
    if (docType) query += '&doc_type=eq.' + encodeURIComponent(docType);
    
    console.log('[Edit Requests] Loading with query:', query);
    
    var rows = await erpFetch('edit_requests', query);
    _erState.allRequests = rows || [];
    
    console.log('[Edit Requests] Loaded ' + _erState.allRequests.length + ' requests');
    
    erComputeKPIs();
    erRender();
    
  } catch(err) {
    console.error('[erLoadEditRequests]', err);
    if (container) {
      container.innerHTML = '<div class="text-center py-4 text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>' +
        'Failed to load: ' + erEsc(err.message) +
        '</div>';
    }
  }
}

window.erLoadEditRequests = erLoadEditRequests;

// ═══════════════════════════════════════════════════════════
// COMPUTE KPIs
// ═══════════════════════════════════════════════════════════
function erComputeKPIs() {
  // For KPI, load all statuses
  erFetchAllStatuses().then(function(all) {
    var pending = 0, approved = 0, rejected = 0, total = all.length;
    
    all.forEach(function(r) {
      var s = String(r.status || '').toUpperCase();
      if (s === 'PENDING') pending++;
      else if (s === 'APPROVED') approved++;
      else if (s === 'REJECTED') rejected++;
    });
    
    var el;
    el = document.getElementById('erKpiPending');
    if (el) el.textContent = pending;
    el = document.getElementById('erKpiApproved');
    if (el) el.textContent = approved;
    el = document.getElementById('erKpiRejected');
    if (el) el.textContent = rejected;
    el = document.getElementById('erKpiTotal');
    if (el) el.textContent = total;
  });
}

async function erFetchAllStatuses() {
  try {
    var rows = await erpFetch('edit_requests', 'select=*&limit=500');
    return rows || [];
  } catch(e) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function erRender() {
  var container = document.getElementById('erListContainer');
  if (!container) return;
  
  // Apply search filter
  var search = (document.getElementById('erSearchInput') ? document.getElementById('erSearchInput').value : '').toLowerCase().trim();
  
  _erState.filteredRequests = _erState.allRequests.filter(function(r) {
    if (!search) return true;
    var docNo = String(r.doc_no || '').toLowerCase();
    var reqBy = String(r.requested_by_fullname || r.requested_by || '').toLowerCase();
    var reason = String(r.reason || '').toLowerCase();
    return docNo.indexOf(search) !== -1 || reqBy.indexOf(search) !== -1 || reason.indexOf(search) !== -1;
  });
  
  var total = _erState.filteredRequests.length;
  var start = (_erState.currentPage - 1) * _erState.pageSize;
  var end = Math.min(start + _erState.pageSize, total);
  var pageItems = _erState.filteredRequests.slice(start, end);
  
  // Update counts
  var el;
  el = document.getElementById('erTableCount');
  if (el) el.textContent = total + ' items';
  el = document.getElementById('erPageTotal');
  if (el) el.textContent = total;
  el = document.getElementById('erPageStart');
  if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('erPageEnd');
  if (el) el.textContent = end;
  el = document.getElementById('erPageLabel');
  if (el) el.textContent = 'Page ' + _erState.currentPage;
  
  el = document.getElementById('erBtnPrev');
  if (el) el.disabled = (_erState.currentPage <= 1);
  el = document.getElementById('erBtnNext');
  if (el) el.disabled = (end >= total);
  
  // Update subtitle
  var statusFilter = document.getElementById('erStatusFilter');
  var subtitleEl = document.getElementById('erTableSubtitle');
  if (subtitleEl && statusFilter) {
    var sv = statusFilter.value;
    if (sv === 'PENDING') subtitleEl.textContent = 'Pending approval';
    else if (sv === 'APPROVED') subtitleEl.textContent = 'Approved';
    else if (sv === 'REJECTED') subtitleEl.textContent = 'Rejected';
    else subtitleEl.textContent = 'All requests';
  }
  
  if (pageItems.length === 0) {
    var emptyMsg = 'No edit requests found.';
    if (search) emptyMsg = 'No results for "' + erEsc(search) + '".';
    
    container.innerHTML = '<div class="text-center text-muted py-5">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      '<div>' + emptyMsg + '</div>' +
      '</div>';
    return;
  }
  
  // ═══ Render each request as a card ═══
  var html = '';
  pageItems.forEach(function(r) {
    html += erRenderRequestCard(r);
  });
  
  container.innerHTML = html;
}

function erRenderRequestCard(r) {
  var docType = String(r.doc_type || '').toUpperCase();
  var status = String(r.status || 'PENDING').toUpperCase();
  var docNo = r.doc_no || '';
  var requestor = r.requested_by_fullname || r.requested_by || 'Unknown';
  var reason = r.reason || '—';
  var createdStr = r.created_at ? new Date(r.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '—';
  
  // Type badge
  var typeBadgeClass = 'bg-secondary';
  if (docType === 'MRIF') typeBadgeClass = 'bg-warning text-dark';
  else if (docType === 'MRR') typeBadgeClass = 'bg-success';
  else if (docType === 'MRS') typeBadgeClass = 'bg-danger';
  
  // Status badge
  var statusBadgeClass = 'bg-secondary';
  var statusIcon = 'bi-clock';
  if (status === 'PENDING') { statusBadgeClass = 'bg-warning text-dark'; statusIcon = 'bi-hourglass-split'; }
  else if (status === 'APPROVED') { statusBadgeClass = 'bg-success'; statusIcon = 'bi-check-circle-fill'; }
  else if (status === 'REJECTED') { statusBadgeClass = 'bg-danger'; statusIcon = 'bi-x-circle-fill'; }
  else if (status === 'COMPLETED') { statusBadgeClass = 'bg-info text-dark'; statusIcon = 'bi-check-all'; }
  
  // Additional info based on status
  var additionalInfo = '';
  if (status === 'APPROVED' && r.approved_by) {
    var apprAt = r.approved_at ? new Date(r.approved_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '—';
    additionalInfo = '<div class="er-req-meta-row">' +
      '<i class="bi bi-check-circle text-success me-1"></i>' +
      'Approved by <strong>' + erEsc(r.approved_by) + '</strong> on ' + erEsc(apprAt) +
      '</div>';
  } else if (status === 'REJECTED' && r.reject_reason) {
    additionalInfo = '<div class="er-req-meta-row text-danger">' +
      '<i class="bi bi-x-circle me-1"></i>' +
      'Rejected: <em>' + erEsc(r.reject_reason) + '</em>' +
      '</div>';
  }
  
  // Action buttons
  var safeDoc = String(docNo).replace(/'/g, "\\'");
  var actionsHtml = '';
  if (status === 'PENDING') {
    actionsHtml = 
      '<button class="erp-action-btn primary" onclick="erViewDoc(\'' + safeDoc + '\', \'' + docType + '\')" title="View Document">' +
        '<i class="bi bi-eye"></i>' +
      '</button>' +
      '<button class="btn btn-sm btn-success ms-2" onclick="erApprove(\'' + r.id + '\')">' +
        '<i class="bi bi-check-circle me-1"></i>Approve' +
      '</button>' +
      '<button class="btn btn-sm btn-outline-danger ms-2" onclick="erOpenRejectModal(\'' + r.id + '\')">' +
        '<i class="bi bi-x-circle me-1"></i>Reject' +
      '</button>';
  } else if (status === 'APPROVED') {
    actionsHtml = 
      '<button class="erp-action-btn primary" onclick="erViewDoc(\'' + safeDoc + '\', \'' + docType + '\')" title="View Document">' +
        '<i class="bi bi-eye"></i>' +
      '</button>' +
      '<span class="badge bg-success ms-2">' +
        '<i class="bi bi-check-circle-fill me-1"></i>Approved' +
      '</span>';
  } else if (status === 'REJECTED') {
    actionsHtml = 
      '<button class="erp-action-btn primary" onclick="erViewDoc(\'' + safeDoc + '\', \'' + docType + '\')" title="View Document">' +
        '<i class="bi bi-eye"></i>' +
      '</button>' +
      '<span class="badge bg-danger ms-2">' +
        '<i class="bi bi-x-circle-fill me-1"></i>Rejected' +
      '</span>';
  }
  
  // ═══ Card HTML ═══
  var card = '<div class="er-req-card mb-3" data-req-id="' + r.id + '">';
  card +=   '<div class="er-req-card-header">';
  card +=     '<div class="d-flex align-items-center gap-2 flex-wrap">';
  card +=       '<span class="erp-badge bg-primary"><i class="bi bi-file-earmark-text me-1"></i>' + erEsc(docNo) + '</span>';
  card +=       '<span class="badge ' + typeBadgeClass + '">' + docType + '</span>';
  card +=       '<span class="badge ' + statusBadgeClass + '"><i class="bi ' + statusIcon + ' me-1"></i>' + status + '</span>';
  card +=     '</div>';
  card +=     '<div class="er-req-actions">' + actionsHtml + '</div>';
  card +=   '</div>';
  card +=   '<div class="er-req-card-body">';
  card +=     '<div class="er-req-meta-row">';
  card +=       '<i class="bi bi-person me-1"></i>';
  card +=       'Requestor: <strong>' + erEsc(requestor) + '</strong>';
  card +=     '</div>';
  card +=     '<div class="er-req-meta-row">';
  card +=       '<i class="bi bi-clock me-1"></i>';
  card +=       'Requested: ' + erEsc(createdStr);
  card +=     '</div>';
  card +=     '<div class="er-req-reason">';
  card +=       '<i class="bi bi-chat-left-text me-1"></i>';
  card +=       '<strong>Reason:</strong> ' + erEsc(reason);
  card +=     '</div>';
  card +=     additionalInfo;
  card +=   '</div>';
  card += '</div>';
  
  return card;
}

// ═══════════════════════════════════════════════════════════
// APPROVE
// ═══════════════════════════════════════════════════════════
async function erApprove(reqId) {
  if (!reqId) return;
  
  if (!confirm('Approve this edit request?\n\nThe requestor will be able to edit their document.')) {
    return;
  }
  
  try {
    console.log('[Edit Requests] Approving:', reqId);
    
    var res = await fetch(erpUrl('edit_requests?id=eq.' + reqId), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        status: 'APPROVED',
        approved_by: _erState.currentUsername,
        approved_at: new Date().toISOString()
      })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' ' + errText);
    }
    
    var result = await res.json();
    console.log('[Edit Requests] ✅ Approved:', result);
    
    erShowToast('✅ Edit request approved', 'success');
    erLoadEditRequests();
    
  } catch(err) {
    console.error('[erApprove]', err);
    erShowToast('Failed to approve: ' + err.message, 'danger');
  }
}

window.erApprove = erApprove;

// ═══════════════════════════════════════════════════════════
// REJECT MODAL
// ═══════════════════════════════════════════════════════════
function erOpenRejectModal(reqId) {
  if (!reqId) return;
  
  // Find request
  var req = _erState.allRequests.find(function(r) {
    return String(r.id) === String(reqId);
  });
  
  if (!req) {
    erShowToast('Request not found', 'warning');
    return;
  }
  
  var idEl = document.getElementById('erRejectReqId');
  var docEl = document.getElementById('erRejectDocNo');
  var reqEl = document.getElementById('erRejectRequestor');
  var reasonEl = document.getElementById('erRejectReason');
  
  if (idEl) idEl.value = reqId;
  if (docEl) docEl.textContent = req.doc_no || '—';
  if (reqEl) reqEl.textContent = req.requested_by_fullname || req.requested_by || '—';
  if (reasonEl) reasonEl.value = '';
  
  var modalEl = document.getElementById('erRejectModal');
  if (!_erState.rejectModal) {
    _erState.rejectModal = new bootstrap.Modal(modalEl, { backdrop: 'static' });
  }
  _erState.rejectModal.show();
  
  setTimeout(function() {
    if (reasonEl) reasonEl.focus();
  }, 300);
}

window.erOpenRejectModal = erOpenRejectModal;

async function erConfirmReject() {
  var reqIdEl = document.getElementById('erRejectReqId');
  var reasonEl = document.getElementById('erRejectReason');
  var btn = document.getElementById('erRejectConfirmBtn');
  
  var reqId = reqIdEl ? reqIdEl.value : '';
  var reason = reasonEl ? reasonEl.value.trim() : '';
  
  if (!reason) {
    erShowToast('Rejection reason is required', 'warning');
    if (reasonEl) reasonEl.focus();
    return;
  }
  
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Rejecting...';
  
  try {
    console.log('[Edit Requests] Rejecting:', reqId, '| Reason:', reason);
    
    var res = await fetch(erpUrl('edit_requests?id=eq.' + reqId), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        status: 'REJECTED',
        approved_by: _erState.currentUsername,
        approved_at: new Date().toISOString(),
        reject_reason: reason
      })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status);
    }
    
    var result = await res.json();
    console.log('[Edit Requests] ✅ Rejected:', result);
    
    if (_erState.rejectModal) {
      _erState.rejectModal.hide();
    }
    
    erShowToast('✅ Edit request rejected', 'success');
    erLoadEditRequests();
    
  } catch(err) {
    console.error('[erConfirmReject]', err);
    erShowToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

window.erConfirmReject = erConfirmReject;

// ═══════════════════════════════════════════════════════════
// VIEW DOC
// ═══════════════════════════════════════════════════════════
async function erViewDoc(docNo, docType) {
  var modalEl = document.getElementById('erViewDocModal');
  var titleEl = document.getElementById('erViewDocTitle');
  var bodyEl = document.getElementById('erViewDocBody');
  
  if (!modalEl || !bodyEl) return;
  
  if (titleEl) titleEl.textContent = docNo;
  bodyEl.innerHTML = '<div class="text-center py-4"><div class="erp-spinner"></div></div>';
  
  if (!_erState.viewDocModal) {
    _erState.viewDocModal = new bootstrap.Modal(modalEl);
  }
  _erState.viewDocModal.show();
  
  try {
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    var itemsRes = await erpFetch('doc_items', 'doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');
    
    if (!docRes || docRes.length === 0) {
      bodyEl.innerHTML = '<div class="alert alert-warning">Document not found</div>';
      return;
    }
    
    var doc = docRes[0];
    var items = itemsRes || [];
    
    var html = '';
    
    // Doc info
    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>Doc No:</strong> <code>' + erEsc(doc.doc_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-primary">' + erEsc(doc.doc_type) + '</span></div>';
    html += '<div class="col-md-6"><strong>Status:</strong> ' + erEsc(doc.status) + '</div>';
    html += '<div class="col-md-6"><strong>Requestor:</strong> ' + erEsc(doc.requestor || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Department:</strong> ' + erEsc(doc.department || '—') + '</div>';
    if (doc.jo_no) html += '<div class="col-md-6"><strong>JO No:</strong> ' + erEsc(doc.jo_no) + '</div>';
    if (doc.gem_so_no) html += '<div class="col-md-6"><strong>GEM SO:</strong> ' + erEsc(doc.gem_so_no) + '</div>';
    html += '</div>';
    
    // Items
    html += '<h6 class="mt-3">Items (' + items.length + ')</h6>';
    html += '<div class="table-responsive">';
    html += '<table class="erp-table" style="font-size:0.85rem;">';
    html += '<thead><tr>' +
      '<th>#</th><th>Item Code</th><th>Description</th>' +
      '<th class="text-center">Req Qty</th>' +
      '<th class="text-center">Unit</th>' +
      '</tr></thead><tbody>';
    
    if (items.length === 0) {
      html += '<tr><td colspan="5" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + erEsc(it.item_code) + '</code></td>' +
          '<td>' + erEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + (it.requested_qty || 0) + '</td>' +
          '<td class="text-center">' + erEsc(it.unit || '—') + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    
    bodyEl.innerHTML = html;
    
  } catch(err) {
    console.error('[erViewDoc]', err);
    bodyEl.innerHTML = '<div class="alert alert-danger">Failed: ' + erEsc(err.message) + '</div>';
  }
}

window.erViewDoc = erViewDoc;

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function erOnSearch() {
  clearTimeout(_erState.searchTimer);
  _erState.searchTimer = setTimeout(function() {
    _erState.currentPage = 1;
    erRender();
  }, 300);
}

window.erOnSearch = erOnSearch;

function erClearFilters() {
  var s = document.getElementById('erSearchInput');
  var st = document.getElementById('erStatusFilter');
  var dt = document.getElementById('erDocTypeFilter');
  if (s) s.value = '';
  if (st) st.value = 'PENDING';
  if (dt) dt.value = '';
  _erState.currentPage = 1;
  erLoadEditRequests();
}

window.erClearFilters = erClearFilters;

function erPagePrev() {
  if (_erState.currentPage > 1) {
    _erState.currentPage--;
    erRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.erPagePrev = erPagePrev;

function erPageNext() {
  var total = _erState.filteredRequests.length;
  var maxPage = Math.ceil(total / _erState.pageSize);
  if (_erState.currentPage < maxPage) {
    _erState.currentPage++;
    erRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.erPageNext = erPageNext;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function erShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// ═══════════════════════════════════════════════════════════
// STYLES — Inject inline (no separate CSS file)
// ═══════════════════════════════════════════════════════════
(function injectStyles() {
  var styleId = 'erRequestCardStyles';
  if (document.getElementById(styleId)) return;
  
  var style = document.createElement('style');
  style.id = styleId;
  style.textContent = [
    '.er-req-card {',
    '  background: #fff;',
    '  border: 1px solid #e2e8f0;',
    '  border-radius: 12px;',
    '  overflow: hidden;',
    '  transition: all 0.15s;',
    '}',
    '.er-req-card:hover {',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.06);',
    '  border-color: #cbd5e1;',
    '}',
    '.er-req-card-header {',
    '  padding: 14px 18px;',
    '  background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);',
    '  border-bottom: 1px solid #f0f4f8;',
    '  display: flex;',
    '  justify-content: space-between;',
    '  align-items: center;',
    '  flex-wrap: wrap;',
    '  gap: 10px;',
    '}',
    '.er-req-actions {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 4px;',
    '  flex-wrap: wrap;',
    '}',
    '.er-req-card-body {',
    '  padding: 14px 18px;',
    '}',
    '.er-req-meta-row {',
    '  font-size: 0.85rem;',
    '  color: #475569;',
    '  margin-bottom: 6px;',
    '}',
    '.er-req-meta-row:last-child { margin-bottom: 0; }',
    '.er-req-reason {',
    '  margin-top: 10px;',
    '  padding: 10px 14px;',
    '  background: #fffbeb;',
    '  border-left: 3px solid #f59e0b;',
    '  border-radius: 6px;',
    '  font-size: 0.85rem;',
    '  color: #78350f;',
    '}',
    '@media (max-width: 767.98px) {',
    '  .er-req-card-header { flex-direction: column; align-items: stretch; }',
    '  .er-req-actions { margin-top: 8px; }',
    '}'
  ].join('\n');
  
  document.head.appendChild(style);
})();

console.log('✅ edit-requests.js v1.0 loaded');
