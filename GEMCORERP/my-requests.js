// ============================================================
// GEMCOR ERP — My Requests (Production's home page)
// v2.1 — FIXED: use username for edit_requests query
// ============================================================

var _myRequests = {
  allDocs: [],
  filteredDocs: [],
  currentPage: 1,
  pageSize: 20,
  searchTimer: null,
  currentUser: '',           // Fullname (for documents.requestor)
  currentUsername: '',       // NEW: Username (for edit_requests.requested_by)
  currentDetails: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[My Requests] Initializing...');
  
  myRequestsCheckHealth();
  
  // ═══ Set BOTH fullname and username ═══
  var userFullname = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || '';
  var username = localStorage.getItem('ivm_username') || '';
  
  _myRequests.currentUser = userFullname;         // For documents.requestor
  _myRequests.currentUsername = username;         // For edit_requests.requested_by
  
  console.log('[My Requests] User:', userFullname, '| Username:', username);
  
  var welcomeName = document.getElementById('welcomeName');
  if (welcomeName) welcomeName.textContent = userFullname || 'User';
  
  // Load department from users table
  loadUserInfo();
  
  // Load requests
  myRequestsLoad();
});

async function myRequestsCheckHealth() {
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

async function loadUserInfo() {
  var username = localStorage.getItem('ivm_username') || '';
  if (!username) return;
  
  try {
    var rows = await erpFetch('users', 
      'username=eq.' + encodeURIComponent(username) + 
      '&select=fullname,department&limit=1');
    
    if (rows && rows[0]) {
      var u = rows[0];
      var welcomeName = document.getElementById('welcomeName');
      var welcomeDept = document.getElementById('welcomeDept');
      
      if (welcomeName) welcomeName.textContent = u.fullname || username;
      if (welcomeDept) welcomeDept.textContent = 'Department: ' + (u.department || 'Not set');
    }
  } catch(err) {
    console.warn('[My Requests] Could not load user info:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD REQUESTS
// ═══════════════════════════════════════════════════════════
async function myRequestsLoad() {
  var tbody = document.getElementById('myTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
    '<div class="erp-spinner"></div>' +
    '<div class="mt-2">Loading your requests...</div></td></tr>';
  
  var userFullname = _myRequests.currentUser;
  if (!userFullname) {
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
      'Could not determine user. Please log in again.</td></tr>';
    return;
  }
  
  try {
    // Load only MRIF and MRS for this requestor (by fullname)
    var rows = await erpFetch('documents',
      'requestor=eq.' + encodeURIComponent(userFullname) +
      '&or=(doc_type.eq.MRIF,doc_type.eq.MRS)' +
      '&order=created_at.desc' +
      '&limit=500');
    
    _myRequests.allDocs = rows || [];
    console.log('[My Requests] Loaded ' + _myRequests.allDocs.length + ' requests');
    
    myRequestsComputeKPIs();
    await myRequestsRender();
    if (typeof mrdOnLoaded === 'function') mrdOnLoaded();
  } catch(err) {
    console.error('[myRequestsLoad]', err);
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
      'Failed: ' + erpEsc(err.message) + '</td></tr>';
  }
}

function myRequestsComputeKPIs() {
  var total = _myRequests.allDocs.length;
  var pending = 0, completed = 0, partial = 0;
  
  _myRequests.allDocs.forEach(function(d) {
    var s = String(d.status || '').toUpperCase();
    if (s === 'PENDING') pending++;
    else if (s === 'COMPLETED') completed++;
    else if (s === 'PARTIAL') partial++;
  });
  
  var el;
  el = document.getElementById('myKpiTotal');
  if (el) el.textContent = total;
  el = document.getElementById('myKpiPending');
  if (el) el.textContent = pending;
  el = document.getElementById('myKpiCompleted');
  if (el) el.textContent = completed;
  el = document.getElementById('myKpiPartial');
  if (el) el.textContent = partial;
}

// ═══════════════════════════════════════════════════════════
// RENDER — With Edit Request integration
// ═══════════════════════════════════════════════════════════
async function myRequestsRender() {
  var tbody = document.getElementById('myTableBody');
  if (!tbody) return;
  
  // Apply search + filter
  var searchInput = document.getElementById('mySearchInput');
  var typeFilterEl = document.getElementById('myTypeFilter');
  var statusFilterEl = document.getElementById('myStatusFilter');
  
  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var typeFilter = typeFilterEl ? typeFilterEl.value : '';
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';
  
  _myRequests.filteredDocs = _myRequests.allDocs.filter(function(d) {
    if (typeFilter && String(d.doc_type).toUpperCase() !== typeFilter) return false;
    if (statusFilter && String(d.status).toUpperCase() !== statusFilter) return false;
    
    if (search) {
      var docNo = String(d.doc_no || '').toLowerCase();
      var jo = String(d.jo_no || '').toLowerCase();
      var po = String(d.po_no || '').toLowerCase();
      if (docNo.indexOf(search) === -1 && jo.indexOf(search) === -1 && po.indexOf(search) === -1) {
        return false;
      }
    }
    return true;
  });
  
  // ═══ Prefetch edit permissions — FIXED: use USERNAME ═══
  var editPermMap = {};
  try {
    var allPerms = await erpFetch('edit_requests',
      'select=*' +
      '&requested_by=eq.' + encodeURIComponent(_myRequests.currentUsername) +  // ← FIXED
      '&order=created_at.desc&limit=500');
    
    console.log('[My Requests] Found', (allPerms || []).length, 'edit requests');
    
    (allPerms || []).forEach(function(p) {
      // Keep only the latest per doc_no
      if (!editPermMap[p.doc_no] || 
          new Date(p.created_at) > new Date(editPermMap[p.doc_no].created_at)) {
        editPermMap[p.doc_no] = p;
      }
    });
    
    console.log('[My Requests] Edit permission map:', Object.keys(editPermMap));
  } catch(e) {
    console.warn('[My Requests] Could not fetch edit permissions:', e.message);
  }
  
  // Pagination
  var total = _myRequests.filteredDocs.length;
  var start = (_myRequests.currentPage - 1) * _myRequests.pageSize;
  var end = Math.min(start + _myRequests.pageSize, total);
  var pageItems = _myRequests.filteredDocs.slice(start, end);
  
  var el;
  el = document.getElementById('myTableCount');
  if (el) el.textContent = total + ' items';
  el = document.getElementById('myPageTotal');
  if (el) el.textContent = total;
  el = document.getElementById('myPageStart');
  if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('myPageEnd');
  if (el) el.textContent = end;
  el = document.getElementById('myPageLabel');
  if (el) el.textContent = 'Page ' + _myRequests.currentPage;
  
  el = document.getElementById('myBtnPrev');
  if (el) el.disabled = (_myRequests.currentPage <= 1);
  el = document.getElementById('myBtnNext');
  if (el) el.disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No requests found. Click "New MRIF" or "New MRS" to create one.</td></tr>';
    return;
  }
  
  var html = '';
  pageItems.forEach(function(d) {
    var dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';
    
    var statusUpper = String(d.status || 'PENDING').toUpperCase();
    var statusClass = 'status-pending';
    if (statusUpper === 'COMPLETED') statusClass = 'status-completed';
    else if (statusUpper === 'PARTIAL') statusClass = 'status-partial';
    
    var typeUpper = String(d.doc_type || '').toUpperCase();
    var typeBadge = typeUpper === 'MRIF' ? 'bg-warning text-dark' : 'bg-info text-dark';
    
    var safeDoc = String(d.doc_no || '').replace(/'/g, "\\'");
    
    // ═══ Edit permission state ═══
    var perm = editPermMap[d.doc_no];
    var editPerm = perm ? { status: perm.status, request: perm } : { status: 'NONE', request: null };
    
    html += '<tr>' +
      '<td><code>' + erpEsc(d.doc_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + (typeof mrdAgeSub === 'function' ? mrdAgeSub(d) : '') + '</td>' +
      '<td class="text-center"><span class="badge ' + typeBadge + '">' + typeUpper + '</span></td>' +
      '<td>' + erpEsc(d.jo_no || '—') + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '">' + statusUpper + '</span></td>' +
      '<td class="text-center" data-prog-doc="' + erpEsc(d.doc_no) + '">' + (typeof mrdProgressCell === 'function' ? mrdProgressCell(d) : '') + '</td>' +
      '<td class="text-center">' + (d.item_count || 0) + '</td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="viewRequestDetails(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="discussDocument(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="Discuss">' +
          '<i class="bi bi-chat-dots"></i>' +
        '</button>' +
      '</td>' +
      '<td class="text-center">' +
        renderEditButton(d.doc_no, typeUpper, statusUpper, editPerm) +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// VIEW DETAILS MODAL
// ═══════════════════════════════════════════════════════════
async function viewRequestDetails(docNo, docType) {
  var modalEl = document.getElementById('requestDetailModal');
  if (!modalEl) return;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  
  var titleEl = document.getElementById('detailModalTitle');
  if (titleEl) titleEl.textContent = docNo;
  
  var bodyEl = document.getElementById('requestDetailBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="text-center py-4"><div class="erp-spinner"></div></div>';
  
  modal.show();
  
  try {
    // Fetch doc + items
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    var itemsRes = await erpFetch('doc_items', 'doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');
    
    if (!docRes || docRes.length === 0) {
      if (bodyEl) bodyEl.innerHTML = '<div class="alert alert-danger">Document not found</div>';
      return;
    }
    
    var doc = docRes[0];
    var items = itemsRes || [];
    
    _myRequests.currentDetails = { doc: doc, items: items };
    
    // Build modal content
    var html = '';
    
    // Doc info
    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>Doc No:</strong> <code>' + erpEsc(doc.doc_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-primary">' + erpEsc(doc.doc_type) + '</span></div>';
    html += '<div class="col-md-6"><strong>Status:</strong> ' + erpEsc(doc.status) + '</div>';
    html += '<div class="col-md-6"><strong>Date:</strong> ' + (doc.created_at ? new Date(doc.created_at).toLocaleString() : '—') + '</div>';
    if (doc.jo_no) html += '<div class="col-md-6"><strong>JO No:</strong> ' + erpEsc(doc.jo_no) + '</div>';
    if (doc.gem_so_no) html += '<div class="col-md-6"><strong>GEM SO No:</strong> ' + erpEsc(doc.gem_so_no) + '</div>';
    if (doc.client_name) html += '<div class="col-md-6"><strong>Client:</strong> ' + erpEsc(doc.client_name) + '</div>';
    if (doc.project) html += '<div class="col-md-6"><strong>Project:</strong> ' + erpEsc(doc.project) + '</div>';
    if (doc.department) html += '<div class="col-md-6"><strong>Department:</strong> ' + erpEsc(doc.department) + '</div>';
    html += '</div>';
    if (typeof mrdStepperHtml === 'function') html += mrdStepperHtml(doc);
    
    // QR Code
    var qrData = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '') + '../?doc=' + encodeURIComponent(docNo) + '&view=print';
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrData);
    
    html += '<div class="text-center mb-3">';
    html += '<img src="' + qrUrl + '" alt="QR" style="max-width:200px;border:1px solid #ddd;border-radius:8px;padding:8px;background:#fff;">';
    html += '<div class="text-muted small mt-2">Show this QR to the warehouse team</div>';
    html += '</div>';
    
    // Items table
    html += '<h6 class="mt-3">Items (' + items.length + ')</h6>';
    html += '<div class="table-responsive">';
    html += '<table class="erp-table" style="font-size:0.85rem;">';
    html += '<thead><tr>' +
      '<th>#</th><th>Item Code</th><th>Description</th>' +
      '<th class="text-center">Req Qty</th>' +
      '<th class="text-center">Issued Qty</th>' +
      '<th style="min-width:110px">Progress</th>' +
      '<th class="text-center">Unit</th>' +
      '<th>Remarks</th>' +
      '</tr></thead><tbody>';
    
    if (items.length === 0) {
      html += '<tr><td colspan="8" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
          '<td>' + erpEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + (it.requested_qty || 0) + '</td>' +
          '<td class="text-center">' + (it.issued_qty || 0) + '</td>' +
          '<td>' + (typeof mrdBarHtml === 'function' ? mrdBarHtml(mrdItemPct(it), true) : '') + '</td>' +
          '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
          '<td>' + erpEsc(it.remarks || '—') + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    
    if (bodyEl) bodyEl.innerHTML = html;
    
  } catch(err) {
    console.error('[viewRequestDetails]', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
}

window.viewRequestDetails = viewRequestDetails;

// ═══════════════════════════════════════════════════════════
// QR DOWNLOAD
// ═══════════════════════════════════════════════════════════
function downloadQr() {
  if (!_myRequests.currentDetails || !_myRequests.currentDetails.doc) {
    erpShowToast('No QR to download', 'warning');
    return;
  }
  
  var docNo = _myRequests.currentDetails.doc.doc_no;
  var modalBody = document.getElementById('requestDetailBody');
  if (!modalBody) return;
  
  var img = modalBody.querySelector('img');
  if (!img) {
    erpShowToast('QR image not found', 'warning');
    return;
  }
  
  // Download via canvas
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  var qrImg = new Image();
  qrImg.crossOrigin = 'Anonymous';
  qrImg.onload = function() {
    var padding = 20;
    var textHeight = 60;
    canvas.width = qrImg.width + padding * 2;
    canvas.height = qrImg.height + padding * 2 + textHeight;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(docNo, canvas.width / 2, 25);
    ctx.font = '12px Arial';
    ctx.fillStyle = '#6b7280';
    ctx.fillText('GEMCOR ERP', canvas.width / 2, 45);
    ctx.drawImage(qrImg, padding, padding + textHeight);
    var link = document.createElement('a');
    link.download = 'QR-' + docNo + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    erpShowToast('✅ QR downloaded', 'success');
  };
  qrImg.onerror = function() {
    erpShowToast('Failed to load QR image', 'danger');
  };
  qrImg.src = img.src;
}

window.downloadQr = downloadQr;

// ═══════════════════════════════════════════════════════════
// FILTERS + PAGINATION
// ═══════════════════════════════════════════════════════════
function myRequestsOnSearch() {
  clearTimeout(_myRequests.searchTimer);
  _myRequests.searchTimer = setTimeout(function() {
    _myRequests.currentPage = 1;
    myRequestsRender();
  }, 300);
}

window.myRequestsOnSearch = myRequestsOnSearch;

function myRequestsClearFilters() {
  var s = document.getElementById('mySearchInput');
  var t = document.getElementById('myTypeFilter');
  var st = document.getElementById('myStatusFilter');
  if (s) s.value = '';
  if (t) t.value = '';
  if (st) st.value = '';
  _myRequests.currentPage = 1;
  myRequestsRender();
}

window.myRequestsClearFilters = myRequestsClearFilters;

function myRequestsPagePrev() {
  if (_myRequests.currentPage > 1) {
    _myRequests.currentPage--;
    myRequestsRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.myRequestsPagePrev = myRequestsPagePrev;

function myRequestsPageNext() {
  var total = _myRequests.filteredDocs.length;
  var maxPage = Math.ceil(total / _myRequests.pageSize);
  if (_myRequests.currentPage < maxPage) {
    _myRequests.currentPage++;
    myRequestsRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.myRequestsPageNext = myRequestsPageNext;

function myRequestsRefresh() {
  if (typeof _mrd !== 'undefined') _mrd.progressAt = 0;
  erpShowToast('Refreshing...', 'info');
  myRequestsLoad();
  myRequestsCheckHealth();
}

window.myRequestsRefresh = myRequestsRefresh;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ my-requests.js v2.1 loaded (username fix for edit requests)');
