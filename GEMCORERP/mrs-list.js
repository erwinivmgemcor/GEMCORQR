// ============================================================
// GEMCOR ERP — MRS List Logic
// ============================================================

var _mrsAllDocs = [];
var _mrsFilteredDocs = [];
var _mrsCurrentPage = 1;
var _mrsPageSize = 50;
var _mrsSearchTimer = null;

document.addEventListener('DOMContentLoaded', function() {
  console.log('[MRS List] Initializing...');
  mrsCheckHealth();
  mrsListLoad();
  mrsListPopulateFilterOptions();
});

async function mrsCheckHealth() {
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

async function mrsListLoad() {
  var tbody = document.getElementById('mrsTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRS documents...</div></td></tr>';
  }
  
  try {
    var query = 'select=*&doc_type=eq.MRS&order=created_at.desc&limit=2000';
    
    var status = document.getElementById('mrsStatusFilter') ? document.getElementById('mrsStatusFilter').value : '';
    if (status) query += '&status=eq.' + encodeURIComponent(status);
    
    var requestor = document.getElementById('mrsRequestorFilter') ? document.getElementById('mrsRequestorFilter').value : '';
    if (requestor) query += '&requestor=eq.' + encodeURIComponent(requestor);
    
    var dept = document.getElementById('mrsDeptFilter') ? document.getElementById('mrsDeptFilter').value : '';
    if (dept) query += '&department=eq.' + encodeURIComponent(dept);
    
    var fromDate = document.getElementById('mrsDateFrom') ? document.getElementById('mrsDateFrom').value : '';
    if (fromDate) query += '&created_at=gte.' + encodeURIComponent(fromDate + 'T00:00:00');
    
    var toDate = document.getElementById('mrsDateTo') ? document.getElementById('mrsDateTo').value : '';
    if (toDate) query += '&created_at=lt.' + encodeURIComponent(toDate + 'T23:59:59');
    
    var rows = await erpFetch('erp_documents', query);
    _mrsAllDocs = rows || [];
    
    mrsListComputeKPIs();
    mrsListRender();
  } catch(err) {
    console.error('[mrsListLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill"></i> Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function mrsListComputeKPIs() {
  var total = _mrsAllDocs.length;
  var pending = 0, completed = 0, partial = 0;
  _mrsAllDocs.forEach(function(d) {
    var s = String(d.status || '').toUpperCase();
    if (s === 'PENDING') pending++;
    else if (s === 'COMPLETED') completed++;
    else if (s === 'PARTIAL') partial++;
  });
  document.getElementById('mrsKpiTotal').textContent = erpNum(total);
  document.getElementById('mrsKpiTotalSub').textContent = total + ' returns';
  document.getElementById('mrsKpiPending').textContent = erpNum(pending);
  document.getElementById('mrsKpiCompleted').textContent = erpNum(completed);
  document.getElementById('mrsKpiPartial').textContent = erpNum(partial);
}

function mrsListRender() {
  var tbody = document.getElementById('mrsTableBody');
  if (!tbody) return;
  
  var search = (document.getElementById('mrsSearchInput') ? document.getElementById('mrsSearchInput').value : '').toLowerCase().trim();
  _mrsFilteredDocs = _mrsAllDocs.filter(function(d) {
    if (!search) return true;
    var code = String(d.doc_no || '').toLowerCase();
    var req = String(d.requestor || '').toLowerCase();
    return code.indexOf(search) !== -1 || req.indexOf(search) !== -1;
  });
  
  var total = _mrsFilteredDocs.length;
  var start = (_mrsCurrentPage - 1) * _mrsPageSize;
  var end = Math.min(start + _mrsPageSize, total);
  var pageItems = _mrsFilteredDocs.slice(start, end);
  
  document.getElementById('mrsTableCount').textContent = total + ' items';
  document.getElementById('mrsPageTotal').textContent = total;
  document.getElementById('mrsPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('mrsPageEnd').textContent = end;
  document.getElementById('mrsPageLabel').textContent = 'Page ' + _mrsCurrentPage;
  document.getElementById('mrsBtnPrev').disabled = (_mrsCurrentPage <= 1);
  document.getElementById('mrsBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No MRS documents found.</td></tr>';
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
        '<button class="erp-action-btn primary" onclick="mrsListPrint(\'' + safeDoc + '\')" title="Print">' +
          '<i class="bi bi-printer"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="mrsListView(\'' + safeDoc + '\')" title="View">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function mrsListPrint(docNo) {
  erpOpenPrintPreview(docNo, 'MRS');
}

async function mrsListView(docNo) {
  erpPrintShowToast('Loading ' + docNo + '...');
  try {
    var result = await erpFetchDocWithItems(docNo, 'MRS');
    if (!result.success) { erpPrintShowToast('Failed: ' + result.error); return; }
    
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
    
    var modalEl = document.getElementById('erpItemModal');
    if (!modalEl) {
      var modalHtml = '<div class="modal fade" id="erpItemModal" tabindex="-1">' +
        '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
          '<div class="modal-content">' +
            '<div class="modal-header erp-modal-header">' +
              '<h5 class="modal-title">MRS Details</h5>' +
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

async function mrsListPopulateFilterOptions() {
  var selReq = document.getElementById('mrsRequestorFilter');
  var selDept = document.getElementById('mrsDeptFilter');
  if (!selReq || !selDept) return;
  
  try {
    var result = await erpGetDistinctValues('requestor');
    var requestorValues = (result.success && result.values.length > 0) ? result.values : [];
    if (requestorValues.length === 0) {
      try {
        var reqRows = await erpFetch('erp_requestors', 'select=name&order=name.asc');
        requestorValues = (reqRows || []).map(function(r) { return r.name; }).filter(Boolean);
      } catch(e) {}
    }
    selReq.innerHTML = '<option value="">All Requestors</option>';
    requestorValues.forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selReq.appendChild(opt);
    });
    
    var result2 = await erpGetDistinctValues('department');
    var deptValues = (result2.success && result2.values.length > 0) ? result2.values : [];
    if (deptValues.length === 0) {
      try {
        var deptRows = await erpFetch('erp_requestors', 'select=department&department=not.is.null&order=department.asc');
        var seen = {};
        deptValues = [];
        (deptRows || []).forEach(function(r) {
          if (r.department && !seen[r.department]) { seen[r.department] = true; deptValues.push(r.department); }
        });
      } catch(e) {}
    }
    selDept.innerHTML = '<option value="">All Departments</option>';
    deptValues.forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selDept.appendChild(opt);
    });
  } catch(err) {
    console.warn('[mrsListPopulateFilterOptions]', err);
  }
}

function mrsListOnSearch() {
  clearTimeout(_mrsSearchTimer);
  _mrsSearchTimer = setTimeout(function() {
    _mrsCurrentPage = 1;
    mrsListRender();
  }, 350);
}

function mrsListClearFilters() {
  ['mrsSearchInput','mrsStatusFilter','mrsRequestorFilter','mrsDeptFilter','mrsDateFrom','mrsDateTo'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _mrsCurrentPage = 1;
  mrsListLoad();
}

function mrsListPagePrev() {
  if (_mrsCurrentPage > 1) {
    _mrsCurrentPage--;
    mrsListRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrsListPageNext() {
  var maxPage = Math.ceil(_mrsFilteredDocs.length / _mrsPageSize);
  if (_mrsCurrentPage < maxPage) {
    _mrsCurrentPage++;
    mrsListRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrsListExport() {
  if (_mrsFilteredDocs.length === 0) { erpPrintShowToast('No data'); return; }
  var headers = ['MRS No.', 'Date', 'Requestor', 'Department', 'JO No.', 'Status', 'Items'];
  var rows = _mrsFilteredDocs.map(function(d) {
    return [d.doc_no || '', d.created_at ? new Date(d.created_at).toLocaleDateString() : '', d.requestor || '', d.department || '', d.jo_no || '', d.status || '', d.item_count || 0];
  });
  var csv = headers.map(_csvEscMrs).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscMrs).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRS_List_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  erpPrintShowToast('✅ Exported ' + rows.length + ' rows');
}

function _csvEscMrs(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function mrsListRefresh() {
  erpPrintShowToast('Refreshing...');
  mrsListLoad();
  mrsCheckHealth();
}

console.log('✅ mrs-list.js loaded');
