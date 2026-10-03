// ============================================================
// GEMCOR ERP — MRIF List Logic
// ============================================================

var _mrifAllDocs = [];
var _mrifFilteredDocs = [];
var _mrifCurrentPage = 1;
var _mrifPageSize = 50;
var _mrifSearchTimer = null;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[MRIF List] Initializing...');
  mrifCheckHealth();
  mrifListLoad();
  mrifListPopulateFilterOptions();
});

async function mrifCheckHealth() {
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
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function mrifListLoad() {
  var tbody = document.getElementById('mrifTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRIF documents...</div></td></tr>';
  }
  
  try {
    // Build query
    var query = 'select=*&doc_type=eq.MRIF&order=created_at.desc&limit=2000';
    
    var status = document.getElementById('mrifStatusFilter') ? document.getElementById('mrifStatusFilter').value : '';
    if (status) query += '&status=eq.' + encodeURIComponent(status);
    
    var requestor = document.getElementById('mrifRequestorFilter') ? document.getElementById('mrifRequestorFilter').value : '';
    if (requestor) query += '&requestor=eq.' + encodeURIComponent(requestor);
    
    var dept = document.getElementById('mrifDeptFilter') ? document.getElementById('mrifDeptFilter').value : '';
    if (dept) query += '&department=eq.' + encodeURIComponent(dept);
    
    var fromDate = document.getElementById('mrifDateFrom') ? document.getElementById('mrifDateFrom').value : '';
    if (fromDate) query += '&created_at=gte.' + encodeURIComponent(fromDate + 'T00:00:00');
    
    var toDate = document.getElementById('mrifDateTo') ? document.getElementById('mrifDateTo').value : '';
    if (toDate) query += '&created_at=lt.' + encodeURIComponent(toDate + 'T23:59:59');
    
    var rows = await erpFetch('erp_documents', query);
    _mrifAllDocs = rows || [];
    
    // Compute KPIs
    mrifListComputeKPIs();
    
    // Apply client-side search filter
    mrifListRender();
  } catch(err) {
    console.error('[mrifListLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill"></i> Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// KPI COMPUTATION
// ═══════════════════════════════════════════════════════════
function mrifListComputeKPIs() {
  var total = _mrifAllDocs.length;
  var pending = 0, completed = 0, partial = 0;
  
  _mrifAllDocs.forEach(function(d) {
    var s = String(d.status || '').toUpperCase();
    if (s === 'PENDING') pending++;
    else if (s === 'COMPLETED') completed++;
    else if (s === 'PARTIAL') partial++;
  });
  
  document.getElementById('mrifKpiTotal').textContent = erpNum(total);
  document.getElementById('mrifKpiTotalSub').textContent = total + ' documents';
  document.getElementById('mrifKpiPending').textContent = erpNum(pending);
  document.getElementById('mrifKpiCompleted').textContent = erpNum(completed);
  document.getElementById('mrifKpiPartial').textContent = erpNum(partial);
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function mrifListRender() {
  var tbody = document.getElementById('mrifTableBody');
  if (!tbody) return;
  
  // Apply search filter
  var search = (document.getElementById('mrifSearchInput') ? document.getElementById('mrifSearchInput').value : '').toLowerCase().trim();
  _mrifFilteredDocs = _mrifAllDocs.filter(function(d) {
    if (!search) return true;
    var code = String(d.doc_no || '').toLowerCase();
    var req = String(d.requestor || '').toLowerCase();
    return code.indexOf(search) !== -1 || req.indexOf(search) !== -1;
  });
  
  // Pagination
  var total = _mrifFilteredDocs.length;
  var start = (_mrifCurrentPage - 1) * _mrifPageSize;
  var end = Math.min(start + _mrifPageSize, total);
  var pageItems = _mrifFilteredDocs.slice(start, end);
  
  document.getElementById('mrifTableCount').textContent = total + ' items';
  document.getElementById('mrifPageTotal').textContent = total;
  document.getElementById('mrifPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('mrifPageEnd').textContent = end;
  document.getElementById('mrifPageLabel').textContent = 'Page ' + _mrifCurrentPage;
  
  document.getElementById('mrifBtnPrev').disabled = (_mrifCurrentPage <= 1);
  document.getElementById('mrifBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No MRIF documents found.</td></tr>';
    return;
  }
  
  var html = '';
  pageItems.forEach(function(d) {
    var dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString() : '—';
    var statusUpper = String(d.status || 'PENDING').toUpperCase();
    var statusClass = 'status-pending';
    if (statusUpper === 'COMPLETED') statusClass = 'status-completed';
    else if (statusUpper === 'PARTIAL') statusClass = 'status-partial';
    
    var safeDoc = String(d.doc_no || '').replace(/'/g, "\\'");
    
    html += '<tr>' +
      '<td><code>' + erpEsc(d.doc_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(d.requestor || '—') + '</td>' +
      '<td>' + erpEsc(d.department || '—') + '</td>' +
      '<td>' + erpEsc(d.jo_no || '—') + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '">' + statusUpper + '</span></td>' +
      '<td class="text-center">' + (d.item_count || 0) + '</td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="mrifListPrint(\'' + safeDoc + '\')" title="Print Preview">' +
          '<i class="bi bi-printer"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="mrifListView(\'' + safeDoc + '\')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════
function mrifListPrint(docNo) {
  erpOpenPrintPreview(docNo, 'MRIF');
}

async function mrifListView(docNo) {
  // Fetch doc + items, show in a modal
  erpPrintShowToast('Loading ' + docNo + '...');
  
  try {
    var result = await erpFetchDocWithItems(docNo, 'MRIF');
    if (!result.success) {
      erpPrintShowToast('Failed: ' + result.error);
      return;
    }
    
    var info = result.info || {};
    var items = result.items || [];
    
    var html = '<div style="padding:20px;font-family:Inter,sans-serif;">';
    html += '<h5>' + erpEsc(docNo) + '</h5>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">';
    html += '<div><strong>Requestor:</strong> ' + erpEsc(info.Requestor || '—') + '</div>';
    html += '<div><strong>Department:</strong> ' + erpEsc(info.Department || '—') + '</div>';
    html += '<div><strong>JO No.:</strong> ' + erpEsc(info['JO No.'] || '—') + '</div>';
    html += '<div><strong>GEM SO No.:</strong> ' + erpEsc(info['GEM SO No.'] || '—') + '</div>';
    html += '</div>';
    
    html += '<table class="table table-sm table-bordered"><thead><tr>';
    html += '<th>#</th><th>Item Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Remarks</th>';
    html += '</tr></thead><tbody>';
    items.forEach(function(it, i) {
      html += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><code>' + erpEsc(it.inventoryId) + '</code></td>' +
        '<td>' + erpEsc(it.description) + '</td>' +
        '<td>' + (it.expectedQty || 0) + '</td>' +
        '<td>' + erpEsc(it.unit) + '</td>' +
        '<td>' + erpEsc(it.remarks) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    
    // Show in generic modal
    var modalEl = document.getElementById('erpItemModal');
    if (!modalEl) {
      // Create modal on the fly
      var modalHtml = '<div class="modal fade" id="erpItemModal" tabindex="-1">' +
        '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
          '<div class="modal-content">' +
            '<div class="modal-header erp-modal-header">' +
              '<h5 class="modal-title">MRIF Details</h5>' +
              '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
            '</div>' +
            '<div class="modal-body" id="erpItemModalBody"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
      var wrapper = document.createElement('div');
      wrapper.innerHTML = modalHtml;
      document.body.appendChild(wrapper.firstChild);
      modalEl = document.getElementById('erpItemModal');
    }
    
    document.getElementById('erpItemModalBody').innerHTML = html;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    
  } catch(err) {
    erpPrintShowToast('Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
async function mrifListPopulateFilterOptions() {
  try {
    var result = await erpGetDistinctValues('requestor');
    if (result.success) {
      var sel = document.getElementById('mrifRequestorFilter');
      result.values.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      });
    }
    
    var result2 = await erpGetDistinctValues('department');
    if (result2.success) {
      var sel2 = document.getElementById('mrifDeptFilter');
      result2.values.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel2.appendChild(opt);
      });
    }
  } catch(err) {
    console.warn('[mrifListPopulateFilterOptions]', err);
  }
}

function mrifListOnSearch() {
  clearTimeout(_mrifSearchTimer);
  _mrifSearchTimer = setTimeout(function() {
    _mrifCurrentPage = 1;
    mrifListRender();
  }, 350);
}

function mrifListClearFilters() {
  var s = document.getElementById('mrifSearchInput');
  var st = document.getElementById('mrifStatusFilter');
  var r = document.getElementById('mrifRequestorFilter');
  var d = document.getElementById('mrifDeptFilter');
  var df = document.getElementById('mrifDateFrom');
  var dt = document.getElementById('mrifDateTo');
  if (s) s.value = '';
  if (st) st.value = '';
  if (r) r.value = '';
  if (d) d.value = '';
  if (df) df.value = '';
  if (dt) dt.value = '';
  _mrifCurrentPage = 1;
  mrifListLoad();
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function mrifListPagePrev() {
  if (_mrifCurrentPage > 1) {
    _mrifCurrentPage--;
    mrifListRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrifListPageNext() {
  var total = _mrifFilteredDocs.length;
  var maxPage = Math.ceil(total / _mrifPageSize);
  if (_mrifCurrentPage < maxPage) {
    _mrifCurrentPage++;
    mrifListRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function mrifListExport() {
  if (_mrifFilteredDocs.length === 0) {
    erpPrintShowToast('No data to export');
    return;
  }
  
  var headers = ['MRIF No.', 'Date', 'Requestor', 'Department', 'JO No.', 'Status', 'Items'];
  var rows = _mrifFilteredDocs.map(function(d) {
    return [
      d.doc_no || '',
      d.created_at ? new Date(d.created_at).toLocaleDateString() : '',
      d.requestor || '',
      d.department || '',
      d.jo_no || '',
      d.status || '',
      d.item_count || 0
    ];
  });
  
  var csv = headers.map(_csvEscMrif).join(',') + '\n';
  rows.forEach(function(row) {
    csv += row.map(_csvEscMrif).join(',') + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRIF_List_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  erpPrintShowToast('✅ Exported ' + rows.length + ' rows');
}

function _csvEscMrif(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mrifListRefresh() {
  erpPrintShowToast('Refreshing...');
  mrifListLoad();
  mrifCheckHealth();
}

console.log('✅ mrif-list.js loaded');
