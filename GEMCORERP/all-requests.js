// ============================================================
// GEMCOR ERP — All Requests (Warehouse View)
// Shows all production requests for processing
// ============================================================

var _allRequests = {
  allDocs: [],
  filteredDocs: [],
  currentPage: 1,
  pageSize: 30,
  searchTimer: null,
  currentDoc: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[All Requests] Initializing...');
  
  allRequestsCheckHealth();
  allRequestsLoad();
  allRequestsPopulateDeptFilter();
});

async function allRequestsCheckHealth() {
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

async function allRequestsPopulateDeptFilter() {
  try {
    var rows = await erpFetch('documents',
      'select=department&department=not.is.null&department=neq.&order=department.asc&limit=1000');
    
    var seen = {};
    var depts = [];
    (rows || []).forEach(function(r) {
      var d = String(r.department || '').trim();
      if (d && !seen[d]) {
        seen[d] = true;
        depts.push(d);
      }
    });
    
    var sel = document.getElementById('allDeptFilter');
    sel.innerHTML = '<option value="">All Departments</option>';
    depts.sort().forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
  } catch(err) {
    console.warn('[All Requests] Dept filter failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD REQUESTS
// ═══════════════════════════════════════════════════════════
async function allRequestsLoad() {
  var tbody = document.getElementById('allTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
    '<div class="erp-spinner"></div>' +
    '<div class="mt-2">Loading requests...</div></td></tr>';
  
  try {
    // Build query
    var query = 'select=*&or=(doc_type.eq.MRIF,doc_type.eq.MRS)';
    
    // Status filter
    var statusFilter = document.getElementById('allStatusFilter').value;
    if (statusFilter) {
      if (statusFilter.indexOf(',') !== -1) {
        var statuses = statusFilter.split(',');
        query += '&status=in.(' + statuses.join(',') + ')';
      } else {
        query += '&status=eq.' + statusFilter;
      }
    }
    
    // Type filter
    var typeFilter = document.getElementById('allTypeFilter').value;
    if (typeFilter) {
      query = query.replace('or=(doc_type.eq.MRIF,doc_type.eq.MRS)', 'doc_type=eq.' + typeFilter);
    }
    
    // Dept filter
    var deptFilter = document.getElementById('allDeptFilter').value;
    if (deptFilter) {
      query += '&department=eq.' + encodeURIComponent(deptFilter);
    }
    
    // Date range
    var fromDate = document.getElementById('allDateFrom').value;
    if (fromDate) {
      query += '&created_at=gte.' + encodeURIComponent(fromDate + 'T00:00:00');
    }
    
    var toDate = document.getElementById('allDateTo').value;
    if (toDate) {
      query += '&created_at=lt.' + encodeURIComponent(toDate + 'T23:59:59');
    }
    
    query += '&order=created_at.desc&limit=2000';
    
    var rows = await erpFetch('documents', query);
    _allRequests.allDocs = rows || [];
    
    console.log('[All Requests] Loaded ' + _allRequests.allDocs.length + ' requests');
    
    allRequestsComputeKPIs();
    allRequestsRender();
    
  } catch(err) {
    console.error('[allRequestsLoad]', err);
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
      'Failed: ' + erpEsc(err.message) + '</td></tr>';
  }
}

function allRequestsComputeKPIs() {
  var docs = _allRequests.allDocs;
  var pending = 0, partial = 0, today = 0, completedToday = 0;
  
  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  docs.forEach(function(d) {
    var s = String(d.status || '').toUpperCase();
    if (s === 'PENDING') pending++;
    else if (s === 'PARTIAL') partial++;
    
    var created = d.created_at ? new Date(d.created_at) : null;
    if (created && created >= todayStart) today++;
    
    var processed = d.processed_at ? new Date(d.processed_at) : null;
    if (processed && processed >= todayStart && s === 'COMPLETED') completedToday++;
  });
  
  document.getElementById('allKpiPending').textContent = pending;
  document.getElementById('allKpiPartial').textContent = partial;
  document.getElementById('allKpiToday').textContent = today;
  document.getElementById('allKpiCompletedToday').textContent = completedToday;
}

function allRequestsRender() {
  var tbody = document.getElementById('allTableBody');
  if (!tbody) return;
  
  var search = (document.getElementById('allSearchInput').value || '').toLowerCase().trim();
  
  _allRequests.filteredDocs = _allRequests.allDocs.filter(function(d) {
    if (!search) return true;
    var docNo = String(d.doc_no || '').toLowerCase();
    var req = String(d.requestor || '').toLowerCase();
    var jo = String(d.jo_no || '').toLowerCase();
    return docNo.indexOf(search) !== -1 || req.indexOf(search) !== -1 || jo.indexOf(search) !== -1;
  });
  
  var total = _allRequests.filteredDocs.length;
  var start = (_allRequests.currentPage - 1) * _allRequests.pageSize;
  var end = Math.min(start + _allRequests.pageSize, total);
  var pageItems = _allRequests.filteredDocs.slice(start, end);
  
  document.getElementById('allTableCount').textContent = total + ' items';
  document.getElementById('allPageTotal').textContent = total;
  document.getElementById('allPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('allPageEnd').textContent = end;
  document.getElementById('allPageLabel').textContent = 'Page ' + _allRequests.currentPage;
  
  document.getElementById('allBtnPrev').disabled = (_allRequests.currentPage <= 1);
  document.getElementById('allBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No requests found.</td></tr>';
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
    
    html += '<tr>' +
      '<td><code>' + erpEsc(d.doc_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(d.requestor || '—') + '</td>' +
      '<td>' + erpEsc(d.department || '—') + '</td>' +
      '<td class="text-center"><span class="badge ' + typeBadge + '">' + typeUpper + '</span></td>' +
      '<td>' + erpEsc(d.jo_no || '—') + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '">' + statusUpper + '</span></td>' +
      '<td class="text-center">' + (d.item_count || 0) + '</td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="viewRequestDetails(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// VIEW DETAILS
// ═══════════════════════════════════════════════════════════
async function viewRequestDetails(docNo, docType) {
  var modalEl = document.getElementById('requestDetailModal');
  if (!modalEl) return;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  
  document.getElementById('detailModalTitle').textContent = docNo;
  document.getElementById('requestDetailBody').innerHTML = 
    '<div class="text-center py-4"><div class="erp-spinner"></div></div>';
  document.getElementById('btnProcessRequest').style.display = 'none';
  
  modal.show();
  
  try {
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    var itemsRes = await erpFetch('doc_items', 'doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');
    
    if (!docRes || docRes.length === 0) {
      document.getElementById('requestDetailBody').innerHTML = 
        '<div class="alert alert-danger">Document not found</div>';
      return;
    }
    
    var doc = docRes[0];
    var items = itemsRes || [];
    
    _allRequests.currentDoc = { doc: doc, items: items };
    
    // Build content
    var html = '';
    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>Doc No:</strong> <code>' + erpEsc(doc.doc_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-primary">' + erpEsc(doc.doc_type) + '</span></div>';
    html += '<div class="col-md-6"><strong>Status:</strong> ' + erpEsc(doc.status) + '</div>';
    html += '<div class="col-md-6"><strong>Date:</strong> ' + (doc.created_at ? new Date(doc.created_at).toLocaleString() : '—') + '</div>';
    html += '<div class="col-md-6"><strong>Requestor:</strong> ' + erpEsc(doc.requestor || '—') + '</div>';
    if (doc.department) html += '<div class="col-md-6"><strong>Department:</strong> ' + erpEsc(doc.department) + '</div>';
    if (doc.jo_no) html += '<div class="col-md-6"><strong>JO No:</strong> ' + erpEsc(doc.jo_no) + '</div>';
    if (doc.gem_so_no) html += '<div class="col-md-6"><strong>GEM SO No:</strong> ' + erpEsc(doc.gem_so_no) + '</div>';
    if (doc.client_name) html += '<div class="col-md-6"><strong>Client:</strong> ' + erpEsc(doc.client_name) + '</div>';
    if (doc.project) html += '<div class="col-md-6"><strong>Project:</strong> ' + erpEsc(doc.project) + '</div>';
    html += '</div>';
    
    // Items table
    html += '<h6 class="mt-3">Items (' + items.length + ')</h6>';
    html += '<div class="table-responsive">';
    html += '<table class="erp-table" style="font-size:0.85rem;">';
    html += '<thead><tr>' +
      '<th>#</th><th>Item Code</th><th>Description</th>' +
      '<th class="text-center">Req Qty</th>' +
      '<th class="text-center">Issued Qty</th>' +
      '<th class="text-center">Unit</th>' +
      '<th>Remarks</th>' +
      '</tr></thead><tbody>';
    
    if (items.length === 0) {
      html += '<tr><td colspan="7" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
          '<td>' + erpEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + (it.requested_qty || 0) + '</td>' +
          '<td class="text-center">' + (it.issued_qty || 0) + '</td>' +
          '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
          '<td>' + erpEsc(it.remarks || '—') + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    
    document.getElementById('requestDetailBody').innerHTML = html;
    
    // Show Process button if status is PENDING or PARTIAL
    var status = String(doc.status || '').toUpperCase();
    if (status === 'PENDING' || status === 'PARTIAL') {
      document.getElementById('btnProcessRequest').style.display = 'inline-flex';
    }
    
  } catch(err) {
    console.error('[viewRequestDetails]', err);
    document.getElementById('requestDetailBody').innerHTML = 
      '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// PROCESS REQUEST (placeholder — full processing page to follow)
// ═══════════════════════════════════════════════════════════
function processCurrentRequest() {
  if (!_allRequests.currentDoc) return;
  
  var doc = _allRequests.currentDoc.doc;
  var docNo = doc.doc_no;
  var docType = String(doc.doc_type || '').toUpperCase();
  
  // Close modal
  var modalEl = document.getElementById('requestDetailModal');
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
  
  // Navigate to process page
  if (docType === 'MRIF') {
    window.location.href = 'process-mrif.html?doc=' + encodeURIComponent(docNo);
  } else if (docType === 'MRS') {
    window.location.href = 'process-mrs.html?doc=' + encodeURIComponent(docNo);
  } else if (docType === 'MRR') {
    window.location.href = 'process-mrr.html?doc=' + encodeURIComponent(docNo);
  } else {
    erpShowToast('Unknown doc type: ' + docType, 'warning');
  }
}
// ═══════════════════════════════════════════════════════════
// FILTERS + PAGINATION
// ═══════════════════════════════════════════════════════════
function allRequestsOnSearch() {
  clearTimeout(_allRequests.searchTimer);
  _allRequests.searchTimer = setTimeout(function() {
    _allRequests.currentPage = 1;
    allRequestsRender();
  }, 300);
}

function allRequestsClearFilters() {
  document.getElementById('allSearchInput').value = '';
  document.getElementById('allTypeFilter').value = '';
  document.getElementById('allStatusFilter').value = 'PENDING,PARTIAL';
  document.getElementById('allDeptFilter').value = '';
  document.getElementById('allDateFrom').value = '';
  document.getElementById('allDateTo').value = '';
  _allRequests.currentPage = 1;
  allRequestsLoad();
}

function allRequestsPagePrev() {
  if (_allRequests.currentPage > 1) {
    _allRequests.currentPage--;
    allRequestsRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function allRequestsPageNext() {
  var total = _allRequests.filteredDocs.length;
  var maxPage = Math.ceil(total / _allRequests.pageSize);
  if (_allRequests.currentPage < maxPage) {
    _allRequests.currentPage++;
    allRequestsRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function allRequestsRefresh() {
  erpShowToast('Refreshing...', 'info');
  allRequestsLoad();
  allRequestsCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function allRequestsExport() {
  if (_allRequests.filteredDocs.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }
  
  var headers = ['Doc No.', 'Date', 'Requestor', 'Department', 'Type', 'JO No.', 'Status', 'Items'];
  var rows = _allRequests.filteredDocs.map(function(d) {
    return [
      d.doc_no || '',
      d.created_at ? new Date(d.created_at).toLocaleDateString() : '',
      d.requestor || '',
      d.department || '',
      d.doc_type || '',
      d.jo_no || '',
      d.status || '',
      d.item_count || 0
    ];
  });
  
  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) {
    csv += row.map(_csvEsc).join(',') + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'All_Requests_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function _csvEsc(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ all-requests.js loaded');
