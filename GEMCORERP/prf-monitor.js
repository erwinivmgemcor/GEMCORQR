// ============================================================
// GEMCOR ERP — PRF Monitor (v2)
// List + filter + view + edit + print
// ✅ v2: Item-Level KPI counting
// ============================================================

var _prfMonitor = {
  allPrfs: [],
  filteredPrfs: [],
  currentPage: 1,
  pageSize: 20,
  searchTimer: null,
  currentPrf: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[PRF Monitor v2] Initializing...');

  prfMonitorCheckHealth();
  prfMonitorLoad();
  prfMonitorPopulateFilters();
});

async function prfMonitorCheckHealth() {
  try {
    var result = await erpHealthCheck();
    var badge = document.getElementById('erpHealthBadge');
    if (!badge) return;
    var text = document.getElementById('erpHealthText');
    var dot = badge.querySelector('.dot');
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// LOAD PRFS
// ═══════════════════════════════════════════════════════════
async function prfMonitorLoad() {
  var tbody = document.getElementById('prfTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
    '<div class="erp-spinner"></div>' +
    '<div class="mt-2">Loading PRFs...</div></td></tr>';

  try {
    var query = 'select=*&order=created_at.desc&limit=2000';

    var catFilterEl = document.getElementById('prfCategoryFilter');
    if (catFilterEl && catFilterEl.value) {
      query += '&category=eq.' + encodeURIComponent(catFilterEl.value);
    }

    var reqFilterEl = document.getElementById('prfRequestorFilter');
    if (reqFilterEl && reqFilterEl.value) {
      query += '&requestor=eq.' + encodeURIComponent(reqFilterEl.value);
    }

    var fromDateEl = document.getElementById('prfDateFrom');
    if (fromDateEl && fromDateEl.value) {
      query += '&created_at=gte.' + encodeURIComponent(fromDateEl.value + 'T00:00:00');
    }

    var toDateEl = document.getElementById('prfDateTo');
    if (toDateEl && toDateEl.value) {
      query += '&created_at=lt.' + encodeURIComponent(toDateEl.value + 'T23:59:59');
    }

    var rows = await erpFetch('prf_documents', query);
    _prfMonitor.allPrfs = rows || [];

    console.log('[PRF Monitor v2] Loaded', _prfMonitor.allPrfs.length, 'PRFs');

    await prfMonitorComputeStatus();
    prfMonitorComputeKPIs();
    prfMonitorRender();

  } catch(err) {
    console.error('[prfMonitorLoad]', err);
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
      'Failed: ' + erpEsc(err.message) + '</td></tr>';
  }
}

// ═══════════════════════════════════════════════════════════
// COMPUTE STATUS (per document — for table)
// ═══════════════════════════════════════════════════════════
async function prfMonitorComputeStatus() {
  if (_prfMonitor.allPrfs.length === 0) return;

  try {
    var prfIds = _prfMonitor.allPrfs.map(function(p) { return p.id; });
    var itemsRes = await erpFetch('prf_items',
      'prf_id=in.(' + prfIds.join(',') + ')&select=prf_id,status&limit=10000');

    var itemsByPrf = {};
    (itemsRes || []).forEach(function(it) {
      if (!itemsByPrf[it.prf_id]) itemsByPrf[it.prf_id] = [];
      itemsByPrf[it.prf_id].push(it.status || 'UNSERVED');
    });

    _prfMonitor.allPrfs.forEach(function(prf) {
      var statuses = itemsByPrf[prf.id] || [];
      var counts = { UNSERVED: 0, STAGGERED: 0, SERVED: 0, CANCELED: 0 };
      statuses.forEach(function(s) {
        var key = String(s).toUpperCase();
        if (counts[key] !== undefined) counts[key]++;
      });

      var total = statuses.length;
      var servedCount = counts.SERVED;
      var canceledCount = counts.CANCELED;
      var activeCount = total - canceledCount;

      if (activeCount === 0) {
        prf._status = 'CANCELED';
      } else if (servedCount === activeCount) {
        prf._status = 'SERVED';
      } else if (servedCount > 0 || counts.STAGGERED > 0) {
        prf._status = 'STAGGERED';
      } else {
        prf._status = 'UNSERVED';
      }

      prf._statusCounts = counts;
      prf._statusTotal = total;
    });

  } catch(err) {
    console.warn('[PRF Monitor] Status compute failed:', err.message);
    _prfMonitor.allPrfs.forEach(function(p) { p._status = 'UNSERVED'; });
  }
}

// ═══════════════════════════════════════════════════════════
// COMPUTE KPIs — ✅ v2: ITEM-LEVEL COUNTING
// ═══════════════════════════════════════════════════════════
function prfMonitorComputeKPIs() {
  // Aggregate item-level counts from all PRFs
  var totalItems = 0;
  var unservedItems = 0;
  var staggeredItems = 0;
  var servedItems = 0;
  var canceledItems = 0;

  _prfMonitor.allPrfs.forEach(function(prf) {
    var counts = prf._statusCounts || { UNSERVED: 0, STAGGERED: 0, SERVED: 0, CANCELED: 0 };
    totalItems += (prf._statusTotal || 0);
    unservedItems += (counts.UNSERVED || 0);
    staggeredItems += (counts.STAGGERED || 0);
    servedItems += (counts.SERVED || 0);
    canceledItems += (counts.CANCELED || 0);
  });

  var prfCount = _prfMonitor.allPrfs.length;

  // Update KPI VALUES (item counts)
  document.getElementById('prfKpiTotal').textContent = erpNum(totalItems);
  document.getElementById('prfKpiUnserved').textContent = erpNum(unservedItems);
  document.getElementById('prfKpiStaggered').textContent = erpNum(staggeredItems);
  document.getElementById('prfKpiServed').textContent = erpNum(servedItems);
  document.getElementById('prfKpiCanceled').textContent = erpNum(canceledItems);

  // Update KPI SUBTITLES (show document count for context)
  var totalSub = document.getElementById('prfKpiTotalSub');
  var unservedSub = document.getElementById('prfKpiUnservedSub');
  var staggeredSub = document.getElementById('prfKpiStaggeredSub');
  var servedSub = document.getElementById('prfKpiServedSub');
  var canceledSub = document.getElementById('prfKpiCanceledSub');

  if (totalSub) totalSub.textContent = 'across ' + prfCount + ' PRF' + (prfCount === 1 ? '' : 's');
  if (unservedSub) unservedSub.textContent = 'items awaiting serving';
  if (staggeredSub) staggeredSub.textContent = 'partially served items';
  if (servedSub) servedSub.textContent = 'fully served items';
  if (canceledSub) canceledSub.textContent = 'canceled items';

  console.log('[PRF KPI]',
    'Items:', totalItems,
    '| Unserved:', unservedItems,
    '| Staggered:', staggeredItems,
    '| Served:', servedItems,
    '| Canceled:', canceledItems,
    '| PRFs:', prfCount);
}

// ═══════════════════════════════════════════════════════════
// RENDER TABLE
// ═══════════════════════════════════════════════════════════
function prfMonitorRender() {
  var tbody = document.getElementById('prfTableBody');
  if (!tbody) return;

  var searchInput = document.getElementById('prfSearchInput');
  var statusFilterEl = document.getElementById('prfStatusFilter');

  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';

  _prfMonitor.filteredPrfs = _prfMonitor.allPrfs.filter(function(p) {
    if (statusFilter && String(p._status || '').toUpperCase() !== statusFilter) return false;

    if (search) {
      var prfNo = String(p.prf_no || '').toLowerCase();
      var req = String(p.requestor || '').toLowerCase();
      if (prfNo.indexOf(search) === -1 && req.indexOf(search) === -1) return false;
    }
    return true;
  });

  var total = _prfMonitor.filteredPrfs.length;
  var start = (_prfMonitor.currentPage - 1) * _prfMonitor.pageSize;
  var end = Math.min(start + _prfMonitor.pageSize, total);
  var pageItems = _prfMonitor.filteredPrfs.slice(start, end);

  document.getElementById('prfTableCount').textContent = total + ' items';
  document.getElementById('prfPageTotal').textContent = total;
  document.getElementById('prfPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('prfPageEnd').textContent = end;
  document.getElementById('prfPageLabel').textContent = 'Page ' + _prfMonitor.currentPage;

  document.getElementById('prfBtnPrev').disabled = (_prfMonitor.currentPage <= 1);
  document.getElementById('prfBtnNext').disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No PRFs found.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(p) {
    var dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var status = String(p._status || 'UNSERVED').toUpperCase();
    var statusClass = '';
    var statusIcon = '';
    if (status === 'SERVED') { statusClass = 'status-completed'; statusIcon = 'bi-check-circle-fill'; }
    else if (status === 'STAGGERED') { statusClass = 'status-partial'; statusIcon = 'bi-hourglass'; }
    else if (status === 'CANCELED') { statusClass = 'status-pending'; statusIcon = 'bi-x-circle-fill'; }
    else { statusClass = 'status-pending'; statusIcon = 'bi-clock-history'; }

    var categoryBadge = 'bg-secondary';
    var cat = String(p.category || '').toUpperCase();
    if (cat === 'COMPONENTS') categoryBadge = 'bg-primary';
    else if (cat === 'FABMAT') categoryBadge = 'bg-warning text-dark';
    else if (cat === 'CONSUMABLES') categoryBadge = 'bg-info text-dark';
    else if (cat === 'EWMAT') categoryBadge = 'bg-danger';
    else if (cat === 'ENCLOSURE') categoryBadge = 'bg-success';

    var safePrf = String(p.prf_no || '').replace(/'/g, "\\'");
    var safeId = p.id;

    html += '<tr>' +
      '<td><code>' + erpEsc(p.prf_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(p.requestor || '—') + '</td>' +
      '<td class="text-center"><span class="badge ' + categoryBadge + '">' + erpEsc(cat || '—') + '</span></td>' +
      '<td class="text-center">' + (p.total_items || 0) + '</td>' +
      '<td class="text-center">' + erpNum(p.total_qty || 0) + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '"><i class="bi ' + statusIcon + ' me-1"></i>' + status + '</span></td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="viewPrfDetails(' + safeId + ')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="openPrfPrintPreview(' + safeId + ')" title="Print">' +
          '<i class="bi bi-printer"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="openEditPrfNo(' + safeId + ', \'' + safePrf + '\')" title="Edit PRF No.">' +
          '<i class="bi bi-pencil"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// VIEW DETAILS
// ═══════════════════════════════════════════════════════════
async function viewPrfDetails(prfId) {
  var prf = _prfMonitor.allPrfs.find(function(p) { return p.id === prfId; });
  if (!prf) return;

  _prfMonitor.currentPrf = prf;

  var modalEl = document.getElementById('prfDetailModal');
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  document.getElementById('prfDetailTitle').textContent = prf.prf_no;
  document.getElementById('prfDetailBody').innerHTML =
    '<div class="text-center py-4"><div class="erp-spinner"></div></div>';

  modal.show();

  try {
    var items = await erpFetch('prf_items', 'prf_id=eq.' + prfId + '&order=line_no.asc');

    var html = '';

    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>PRF No.:</strong> <code>' + erpEsc(prf.prf_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Category:</strong> <span class="badge bg-primary">' + erpEsc(prf.category) + '</span></div>';
    html += '<div class="col-md-6"><strong>Requestor:</strong> ' + erpEsc(prf.requestor || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Department:</strong> ' + erpEsc(prf.department || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Date:</strong> ' + (prf.created_at ? new Date(prf.created_at).toLocaleString() : '—') + '</div>';
    html += '<div class="col-md-6"><strong>Purpose:</strong> ' + erpEsc(prf.purpose || 'STOCK') + '</div>';
    if (prf.prepared_by) html += '<div class="col-md-6"><strong>Prepared By:</strong> ' + erpEsc(prf.prepared_by) + '</div>';
    if (prf.noted_by) html += '<div class="col-md-6"><strong>Noted By:</strong> ' + erpEsc(prf.noted_by) + '</div>';
    if (prf.approved_by) html += '<div class="col-md-6"><strong>Approved By:</strong> ' + erpEsc(prf.approved_by) + '</div>';
    if (prf.notes) html += '<div class="col-12"><strong>Notes:</strong> ' + erpEsc(prf.notes) + '</div>';
    html += '</div>';

    var counts = prf._statusCounts || {};
    html += '<div class="alert alert-info small">' +
      '<strong>Items:</strong> ' + (items.length) +
      ' · <span class="text-warning">Unserved: ' + (counts.UNSERVED || 0) + '</span>' +
      ' · <span class="text-info">Staggered: ' + (counts.STAGGERED || 0) + '</span>' +
      ' · <span class="text-success">Served: ' + (counts.SERVED || 0) + '</span>' +
      ' · <span class="text-danger">Canceled: ' + (counts.CANCELED || 0) + '</span>' +
      '</div>';

    html += '<h6 class="mt-3">Items (' + items.length + ')</h6>';
    html += '<div class="table-responsive"><table class="erp-table" style="font-size:0.85rem;">';
    html += '<thead><tr>' +
      '<th style="width:4%">#</th>' +
      '<th style="width:14%">Item Code</th>' +
      '<th style="width:24%">Description</th>' +
      '<th style="width:8%" class="text-center">On-Hand</th>' +
      '<th style="width:8%" class="text-center">Buffer</th>' +
      '<th style="width:8%" class="text-center">Qty Order</th>' +
      '<th style="width:6%" class="text-center">Unit</th>' +
      '<th style="width:12%" class="text-center">Status</th>' +
      '<th style="width:16%">Remarks</th>' +
    '</tr></thead><tbody>';

    if (items.length === 0) {
      html += '<tr><td colspan="9" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        var status = String(it.status || 'UNSERVED').toUpperCase();

        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
          '<td>' + erpEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + erpNum(it.stock_on_hand || 0) + '</td>' +
          '<td class="text-center">' + erpNum(it.buffer_stock || 0) + '</td>' +
          '<td class="text-center fw-bold">' + erpNum(it.qty_for_order || 0) + '</td>' +
          '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
          '<td class="text-center">' +
            '<select class="form-select form-select-sm" style="font-size:0.75rem;" onchange="updateItemStatus(' + it.id + ', this.value)">' +
              '<option value="UNSERVED"' + (status === 'UNSERVED' ? ' selected' : '') + '>UNSERVED</option>' +
              '<option value="STAGGERED"' + (status === 'STAGGERED' ? ' selected' : '') + '>STAGGERED</option>' +
              '<option value="SERVED"' + (status === 'SERVED' ? ' selected' : '') + '>SERVED</option>' +
              '<option value="CANCELED"' + (status === 'CANCELED' ? ' selected' : '') + '>CANCELED</option>' +
            '</select>' +
          '</td>' +
          '<td>' + erpEsc(it.remarks || '—') + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';

    document.getElementById('prfDetailBody').innerHTML = html;

  } catch(err) {
    console.error('[viewPrfDetails]', err);
    document.getElementById('prfDetailBody').innerHTML =
      '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// UPDATE ITEM STATUS
// ═══════════════════════════════════════════════════════════
async function updateItemStatus(itemId, newStatus) {
  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';

    var res = await fetch(erpUrl('prf_items?id=eq.' + itemId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: newStatus,
        updated_by: currentUser,
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) throw new Error('Update failed: ' + res.status);

    erpShowToast('✓ Status updated to ' + newStatus, 'success');
    prfMonitorLoad();
  } catch(err) {
    erpShowToast('Failed: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// EDIT PRF NO
// ═══════════════════════════════════════════════════════════
function openEditPrfNo(prfId, currentPrfNo) {
  document.getElementById('editPrfId').value = prfId;
  document.getElementById('editPrfOldNo').value = currentPrfNo;
  document.getElementById('editPrfOldNoDisplay').value = currentPrfNo;
  document.getElementById('editPrfNewNo').value = currentPrfNo;

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('editPrfNoModal'));
  modal.show();

  setTimeout(function() {
    var input = document.getElementById('editPrfNewNo');
    input.focus();
    input.select();
  }, 300);
}

async function saveEditedPrfNo() {
  var prfId = document.getElementById('editPrfId').value;
  var oldNo = document.getElementById('editPrfOldNo').value;
  var newNo = document.getElementById('editPrfNewNo').value.trim();

  if (!newNo) {
    erpShowToast('New PRF No. required', 'warning');
    return;
  }

  if (newNo === oldNo) {
    bootstrap.Modal.getInstance(document.getElementById('editPrfNoModal')).hide();
    return;
  }

  try {
    var res = await fetch(erpUrl('prf_documents?id=eq.' + prfId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        prf_no: newNo,
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) throw new Error('Update failed');

    await fetch(erpUrl('prf_items?prf_id=eq.' + prfId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({ prf_no: newNo })
    });

    bootstrap.Modal.getInstance(document.getElementById('editPrfNoModal')).hide();
    erpShowToast('✅ PRF No. updated to ' + newNo, 'success');

    prfMonitorLoad();
  } catch(err) {
    erpShowToast('Failed: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// FILTERS + PAGINATION
// ═══════════════════════════════════════════════════════════
async function prfMonitorPopulateFilters() {
  var cats = ['COMPONENTS', 'CONSUMABLES', 'ENCLOSURE', 'EWMAT', 'FABMAT', 'OFABP', 'PANEL', 'UNCATEGORIZED'];
  var catSel = document.getElementById('prfCategoryFilter');
  cats.forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catSel.appendChild(opt);
  });

  try {
    var rows = await erpFetch('prf_documents', 'select=requestor&requestor=not.is.null&limit=1000');
    var seen = {};
    var reqs = [];
    (rows || []).forEach(function(r) {
      var v = String(r.requestor || '').trim();
      if (v && !seen[v]) { seen[v] = true; reqs.push(v); }
    });
    var reqSel = document.getElementById('prfRequestorFilter');
    reqs.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      reqSel.appendChild(opt);
    });
  } catch(e) {}
}

function prfMonitorOnSearch() {
  clearTimeout(_prfMonitor.searchTimer);
  _prfMonitor.searchTimer = setTimeout(function() {
    _prfMonitor.currentPage = 1;
    prfMonitorRender();
  }, 300);
}

function prfMonitorClearFilters() {
  document.getElementById('prfSearchInput').value = '';
  document.getElementById('prfCategoryFilter').value = '';
  document.getElementById('prfStatusFilter').value = '';
  document.getElementById('prfRequestorFilter').value = '';
  document.getElementById('prfDateFrom').value = '';
  document.getElementById('prfDateTo').value = '';
  _prfMonitor.currentPage = 1;
  prfMonitorLoad();
}

function prfMonitorPagePrev() {
  if (_prfMonitor.currentPage > 1) {
    _prfMonitor.currentPage--;
    prfMonitorRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function prfMonitorPageNext() {
  var total = _prfMonitor.filteredPrfs.length;
  var maxPage = Math.ceil(total / _prfMonitor.pageSize);
  if (_prfMonitor.currentPage < maxPage) {
    _prfMonitor.currentPage++;
    prfMonitorRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function prfMonitorRefresh() {
  erpShowToast('Refreshing...', 'info');
  prfMonitorLoad();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function prfMonitorExport() {
  if (_prfMonitor.filteredPrfs.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }
  var headers = ['PRF No.', 'Date', 'Requestor', 'Category', 'Items', 'Total Qty', 'Status'];
  var rows = _prfMonitor.filteredPrfs.map(function(p) {
    return [
      p.prf_no || '',
      p.created_at ? new Date(p.created_at).toLocaleDateString() : '',
      p.requestor || '',
      p.category || '',
      p.total_items || 0,
      p.total_qty || 0,
      p._status || 'UNSERVED'
    ];
  });
  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEsc).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'PRF_Export_' + new Date().toISOString().slice(0, 10) + '.csv';
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
// PRINT (delegates to prf-print.js)
// ═══════════════════════════════════════════════════════════
function printCurrentPrf() {
  if (!_prfMonitor.currentPrf) {
    erpShowToast('No PRF selected', 'warning');
    return;
  }
  if (typeof openPrfPrintPreview === 'function') {
    openPrfPrintPreview(_prfMonitor.currentPrf.id);
  } else {
    erpShowToast('Print module not loaded', 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

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

console.log('✅ prf-monitor.js v2 loaded (item-level KPI)');
