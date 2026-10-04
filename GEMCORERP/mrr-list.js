// ============================================================
// GEMCOR ERP — MRR List Logic
// ============================================================

var _mrrAllDocs = [];
var _mrrFilteredDocs = [];
var _mrrCurrentPage = 1;
var _mrrPageSize = 50;
var _mrrSearchTimer = null;

document.addEventListener('DOMContentLoaded', function() {
  console.log('[MRR List] Initializing...');
  mrrCheckHealth();
  mrrListLoad();
  mrrListPopulateFilterOptions();
});

async function mrrCheckHealth() {
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

async function mrrListLoad() {
  var tbody = document.getElementById('mrrTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRR documents...</div></td></tr>';
  }
  
  try {
    var query = 'select=*&doc_type=eq.MRR&order=created_at.desc&limit=2000';
    
    var status = document.getElementById('mrrStatusFilter') ? document.getElementById('mrrStatusFilter').value : '';
    if (status) query += '&status=eq.' + encodeURIComponent(status);
    
    var vendor = document.getElementById('mrrVendorFilter') ? document.getElementById('mrrVendorFilter').value : '';
    if (vendor) query += '&vendor=eq.' + encodeURIComponent(vendor);
    
    var fromDate = document.getElementById('mrrDateFrom') ? document.getElementById('mrrDateFrom').value : '';
    if (fromDate) query += '&created_at=gte.' + encodeURIComponent(fromDate + 'T00:00:00');
    
    var toDate = document.getElementById('mrrDateTo') ? document.getElementById('mrrDateTo').value : '';
    if (toDate) query += '&created_at=lt.' + encodeURIComponent(toDate + 'T23:59:59');
    
    var rows = await erpFetch('documents', query);
    _mrrAllDocs = rows || [];
    
    mrrListComputeKPIs();
    mrrListRender();
  } catch(err) {
    console.error('[mrrListLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill"></i> Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function mrrListComputeKPIs() {
  var total = _mrrAllDocs.length;
  var pending = 0, completed = 0, partial = 0;
  _mrrAllDocs.forEach(function(d) {
    var s = String(d.status || '').toUpperCase();
    if (s === 'PENDING') pending++;
    else if (s === 'COMPLETED') completed++;
    else if (s === 'PARTIAL') partial++;
  });
  document.getElementById('mrrKpiTotal').textContent = erpNum(total);
  document.getElementById('mrrKpiTotalSub').textContent = total + ' receipts';
  document.getElementById('mrrKpiPending').textContent = erpNum(pending);
  document.getElementById('mrrKpiCompleted').textContent = erpNum(completed);
  document.getElementById('mrrKpiPartial').textContent = erpNum(partial);
}

function mrrListRender() {
  var tbody = document.getElementById('mrrTableBody');
  if (!tbody) return;
  
  var search = (document.getElementById('mrrSearchInput') ? document.getElementById('mrrSearchInput').value : '').toLowerCase().trim();
  _mrrFilteredDocs = _mrrAllDocs.filter(function(d) {
    if (!search) return true;
    var code = String(d.doc_no || '').toLowerCase();
    var po = String(d.po_no || '').toLowerCase();
    var vend = String(d.vendor || '').toLowerCase();
    return code.indexOf(search) !== -1 || po.indexOf(search) !== -1 || vend.indexOf(search) !== -1;
  });
  
  var total = _mrrFilteredDocs.length;
  var start = (_mrrCurrentPage - 1) * _mrrPageSize;
  var end = Math.min(start + _mrrPageSize, total);
  var pageItems = _mrrFilteredDocs.slice(start, end);
  
  document.getElementById('mrrTableCount').textContent = total + ' items';
  document.getElementById('mrrPageTotal').textContent = total;
  document.getElementById('mrrPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('mrrPageEnd').textContent = end;
  document.getElementById('mrrPageLabel').textContent = 'Page ' + _mrrCurrentPage;
  document.getElementById('mrrBtnPrev').disabled = (_mrrCurrentPage <= 1);
  document.getElementById('mrrBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No MRR documents found.</td></tr>';
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
      '<td>' + erpEsc(d.po_no || '—') + '</td>' +
      '<td>' + erpEsc(d.vendor || '—') + '</td>' +
      '<td>' + erpEsc(d.dr_no || '—') + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '">' + statusUpper + '</span></td>' +
      '<td class="text-center">' + (d.item_count || 0) + '</td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="mrrListPrint(\'' + safeDoc + '\')" title="Print">' +
          '<i class="bi bi-printer"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="mrrListView(\'' + safeDoc + '\')" title="View">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function mrrListPrint(docNo) {
  erpOpenPrintPreview(docNo, 'MRR');
}

async function mrrListView(docNo) {
  erpPrintShowToast('Loading ' + docNo + '...');
  try {
    var result = await erpFetchDocWithItems(docNo, 'MRR');
    if (!result.success) { erpPrintShowToast('Failed: ' + result.error); return; }
    
    var info = result.info || {};
    var items = result.items || [];
    
    var html = '<div style="padding:20px;font-family:Inter,sans-serif;">';
    html += '<h5>' + erpEsc(docNo) + '</h5>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">';
    html += '<div><strong>PO No.:</strong> ' + erpEsc(info['PO No.'] || '—') + '</div>';
    html += '<div><strong>Vendor:</strong> ' + erpEsc(info['Vendor/Client'] || '—') + '</div>';
    html += '<div><strong>DR No.:</strong> ' + erpEsc(info['DR No.'] || '—') + '</div>';
    html += '<div><strong>Receiving Site:</strong> ' + erpEsc(info['Receiving Site'] || '—') + '</div>';
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
              '<h5 class="modal-title">MRR Details</h5>' +
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

async function mrrListPopulateFilterOptions() {
  var selVendor = document.getElementById('mrrVendorFilter');
  if (!selVendor) return;
  
  try {
    var result = await erpGetDistinctValues('vendor');
    var vendorValues = (result.success && result.values.length > 0) ? result.values : [];
    
    if (vendorValues.length === 0) {
      try {
        var vendRows = await erpFetch('erp_vendors', 'select=name&order=name.asc');
        vendorValues = (vendRows || []).map(function(r) { return r.name; }).filter(Boolean);
      } catch(e) { console.warn('[Vendor fallback]', e.message); }
    }
    
    selVendor.innerHTML = '<option value="">All Suppliers</option>';
    vendorValues.forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selVendor.appendChild(opt);
    });
    console.log('[MRR Filters] Vendors:', vendorValues.length);
  } catch(err) {
    console.warn('[mrrListPopulateFilterOptions]', err);
  }
}

function mrrListOnSearch() {
  clearTimeout(_mrrSearchTimer);
  _mrrSearchTimer = setTimeout(function() {
    _mrrCurrentPage = 1;
    mrrListRender();
  }, 350);
}

function mrrListClearFilters() {
  ['mrrSearchInput','mrrStatusFilter','mrrVendorFilter','mrrDateFrom','mrrDateTo'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _mrrCurrentPage = 1;
  mrrListLoad();
}

function mrrListPagePrev() {
  if (_mrrCurrentPage > 1) {
    _mrrCurrentPage--;
    mrrListRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrrListPageNext() {
  var maxPage = Math.ceil(_mrrFilteredDocs.length / _mrrPageSize);
  if (_mrrCurrentPage < maxPage) {
    _mrrCurrentPage++;
    mrrListRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrrListExport() {
  if (_mrrFilteredDocs.length === 0) { erpPrintShowToast('No data'); return; }
  var headers = ['MRR No.', 'Date', 'PO No.', 'Vendor', 'DR No.', 'Status', 'Items'];
  var rows = _mrrFilteredDocs.map(function(d) {
    return [d.doc_no || '', d.created_at ? new Date(d.created_at).toLocaleDateString() : '', d.po_no || '', d.vendor || '', d.dr_no || '', d.status || '', d.item_count || 0];
  });
  var csv = headers.map(_csvEscMrr).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscMrr).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRR_List_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  erpPrintShowToast('✅ Exported ' + rows.length + ' rows');
}

function _csvEscMrr(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function mrrListRefresh() {
  erpPrintShowToast('Refreshing...');
  mrrListLoad();
  mrrCheckHealth();
}

console.log('✅ mrr-list.js loaded');
