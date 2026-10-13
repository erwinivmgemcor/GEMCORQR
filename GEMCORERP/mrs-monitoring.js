// ============================================================
// GEMCOR ERP — MRS Monitoring (v1.0)
// Real-time monitoring of all MRS items
// Patterned after MRIF/MRR monitoring
// ============================================================

var _mrsMon = {
  allItems: [],
  filteredItems: [],
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  autoRefreshTimer: null,
  autoRefreshEnabled: true,
  REFRESH_INTERVAL: 30000,  // 30 seconds
  activeStatusFilter: ''
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[MRS Monitoring v1.0] Initializing...');

  mrsMonCheckHealth();
  mrsMonLoad();
  mrsMonPopulateFilters();

  mrsMonStartAutoRefresh();

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      mrsMonStopAutoRefresh();
    } else {
      mrsMonStartAutoRefresh();
    }
  });
});

async function mrsMonCheckHealth() {
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
// LOAD DATA FROM SUPABASE VIEW
// ═══════════════════════════════════════════════════════════
async function mrsMonLoad() {
  var tbody = document.getElementById('mrsMonTableBody');
  if (tbody && _mrsMon.allItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRS items...</div></td></tr>';
  }

  try {
    var t0 = Date.now();

    var rows = await erpFetch('v_mrs_monitoring',
      'select=*&order=needs_attention.desc,request_date.desc,line_no.asc&limit=10000');

    _mrsMon.allItems = rows || [];

    var elapsed = Date.now() - t0;
    console.log('[MRS Monitoring] Loaded ' + _mrsMon.allItems.length + ' items in ' + elapsed + 'ms');

    mrsMonComputeKPIs();
    mrsMonApplyFilters();

  } catch(err) {
    console.error('[mrsMonLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="14" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function mrsMonComputeKPIs() {
  var items = _mrsMon.allItems;
  var totalDocs = {};
  var pending = 0, partial = 0, returned = 0;

  items.forEach(function(it) {
    if (it.mrs_no) totalDocs[it.mrs_no] = true;

    var status = String(it.item_status || '').toUpperCase();
    if (status === 'PENDING') pending++;
    else if (status === 'PARTIAL') partial++;
    else if (status === 'RETURNED') returned++;
  });

  var totalDocsCount = Object.keys(totalDocs).length;

  // Update KPIs
  var el;
  el = document.getElementById('mrsMonKpiTotal');
  if (el) el.textContent = erpNum(totalDocsCount);
  
  el = document.getElementById('mrsMonKpiPending');
  if (el) el.textContent = erpNum(pending);
  
  el = document.getElementById('mrsMonKpiPartial');
  if (el) el.textContent = erpNum(partial);
  
  el = document.getElementById('mrsMonKpiReturned');
  if (el) el.textContent = erpNum(returned);
  
  el = document.getElementById('mrsMonKpiItems');
  if (el) el.textContent = erpNum(items.length);

  // Update chip counts
  el = document.getElementById('mrsChipCountAll');
  if (el) el.textContent = items.length;
  
  el = document.getElementById('mrsChipCountPending');
  if (el) el.textContent = pending;
  
  el = document.getElementById('mrsChipCountPartial');
  if (el) el.textContent = partial;
  
  el = document.getElementById('mrsChipCountReturned');
  if (el) el.textContent = returned;
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function mrsMonApplyFilters() {
  var search = (document.getElementById('mrsMonSearchInput') ? document.getElementById('mrsMonSearchInput').value : '').toLowerCase().trim();
  var docStatus = (document.getElementById('mrsMonDocStatusFilter') ? document.getElementById('mrsMonDocStatusFilter').value : '');
  var requestor = (document.getElementById('mrsMonRequestorFilter') ? document.getElementById('mrsMonRequestorFilter').value : '');
  var client = (document.getElementById('mrsMonClientFilter') ? document.getElementById('mrsMonClientFilter').value : '');
  var dateFrom = (document.getElementById('mrsMonDateFrom') ? document.getElementById('mrsMonDateFrom').value : '');
  var dateTo = (document.getElementById('mrsMonDateTo') ? document.getElementById('mrsMonDateTo').value : '');

  _mrsMon.filteredItems = _mrsMon.allItems.filter(function(it) {
    // Status filter (from chips)
    if (_mrsMon.activeStatusFilter) {
      var status = String(it.item_status || '').toUpperCase();
      if (status !== _mrsMon.activeStatusFilter) return false;
    }

    // Doc status filter
    if (docStatus && String(it.doc_status || '').toUpperCase() !== docStatus) return false;

    // Requestor filter
    if (requestor && String(it.requestor || '') !== requestor) return false;

    // Client filter
    if (client && String(it.client_name || '') !== client) return false;

    // Date range filter
    if (dateFrom || dateTo) {
      var reqDate = it.request_date ? new Date(it.request_date) : null;
      if (reqDate) {
        if (dateFrom) {
          var fromD = new Date(dateFrom + 'T00:00:00');
          if (reqDate < fromD) return false;
        }
        if (dateTo) {
          var toD = new Date(dateTo + 'T23:59:59');
          if (reqDate > toD) return false;
        }
      }
    }

    // Search filter
    if (search) {
      var mrsNo = String(it.mrs_no || '').toLowerCase();
      var itemCode = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      var req = String(it.requestor || '').toLowerCase();
      var cli = String(it.client_name || '').toLowerCase();
      var joNo = String(it.jo_no || '').toLowerCase();
      var gemSo = String(it.gem_so_no || '').toLowerCase();
      
      if (mrsNo.indexOf(search) === -1 &&
          itemCode.indexOf(search) === -1 &&
          desc.indexOf(search) === -1 &&
          req.indexOf(search) === -1 &&
          cli.indexOf(search) === -1 &&
          joNo.indexOf(search) === -1 &&
          gemSo.indexOf(search) === -1) return false;
    }

    return true;
  });

  _mrsMon.currentPage = 1;
  mrsMonRender();
}

function mrsMonFilterStatus(status) {
  _mrsMon.activeStatusFilter = status;
  
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === status);
  });

  mrsMonApplyFilters();
}

function mrsMonFilterStatusChip(btn, status) {
  _mrsMon.activeStatusFilter = status;
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  mrsMonApplyFilters();
}

function mrsMonOnSearch() {
  clearTimeout(_mrsMon.searchTimer);
  _mrsMon.searchTimer = setTimeout(function() {
    mrsMonApplyFilters();
  }, 300);
}

function mrsMonClearFilters() {
  var s = document.getElementById('mrsMonSearchInput');
  var ds = document.getElementById('mrsMonDocStatusFilter');
  var r = document.getElementById('mrsMonRequestorFilter');
  var c = document.getElementById('mrsMonClientFilter');
  var df = document.getElementById('mrsMonDateFrom');
  var dt = document.getElementById('mrsMonDateTo');
  
  if (s) s.value = '';
  if (ds) ds.value = '';
  if (r) r.value = '';
  if (c) c.value = '';
  if (df) df.value = '';
  if (dt) dt.value = '';
  
  _mrsMon.activeStatusFilter = '';
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === '');
  });
  
  mrsMonApplyFilters();
}

async function mrsMonPopulateFilters() {
  // Populate requestors
  try {
    var rows = await erpFetch('v_mrs_monitoring', 'select=requestor&requestor=not.is.null&limit=1000');
    var seen = {};
    var reqs = [];
    (rows || []).forEach(function(r) {
      var v = String(r.requestor || '').trim();
      if (v && !seen[v]) { seen[v] = true; reqs.push(v); }
    });
    var sel = document.getElementById('mrsMonRequestorFilter');
    reqs.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('Requestor filter:', e.message); }

  // Populate clients
  try {
    var rows2 = await erpFetch('v_mrs_monitoring', 'select=client_name&client_name=not.is.null&limit=1000');
    var seen2 = {};
    var clients = [];
    (rows2 || []).forEach(function(r) {
      var v = String(r.client_name || '').trim();
      if (v && !seen2[v]) { seen2[v] = true; clients.push(v); }
    });
    var sel2 = document.getElementById('mrsMonClientFilter');
    clients.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel2.appendChild(opt);
    });
  } catch(e) { console.warn('Client filter:', e.message); }
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function mrsMonRender() {
  var tbody = document.getElementById('mrsMonTableBody');
  if (!tbody) return;

  var total = _mrsMon.filteredItems.length;
  var start = (_mrsMon.currentPage - 1) * _mrsMon.pageSize;
  var end = Math.min(start + _mrsMon.pageSize, total);
  var pageItems = _mrsMon.filteredItems.slice(start, end);

  // Update pagination
  var el;
  el = document.getElementById('mrsMonTableCount'); if (el) el.textContent = total + ' items';
  el = document.getElementById('mrsMonPageTotal'); if (el) el.textContent = total;
  el = document.getElementById('mrsMonPageStart'); if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('mrsMonPageEnd'); if (el) el.textContent = end;
  el = document.getElementById('mrsMonPageLabel'); if (el) el.textContent = 'Page ' + _mrsMon.currentPage;
  el = document.getElementById('mrsMonBtnPrev'); if (el) el.disabled = (_mrsMon.currentPage <= 1);
  el = document.getElementById('mrsMonBtnNext'); if (el) el.disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var itemStatus = String(it.item_status || 'PENDING').toUpperCase();
    var rowClass = '';
    var statusBadge = '';
    
    if (itemStatus === 'PENDING') {
      rowClass = 'pending-attention';
      statusBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i>PENDING</span>';
    } else if (itemStatus === 'PARTIAL') {
      rowClass = 'partial-attention';
      statusBadge = '<span class="badge bg-primary"><i class="bi bi-hourglass-split me-1"></i>PARTIAL</span>';
    } else {
      rowClass = 'returned-row';
      statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle-fill me-1"></i>RETURNED</span>';
    }

    var dateStr = it.request_date ? new Date(it.request_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    }) : '—';

    var qtyReturned = Number(it.qty_returned || 0);
    var atlQty = Number(it.atl_qty || 0);
    var remainingQty = Number(it.remaining_qty || 0);
    var remainingClass = remainingQty > 0 ? 'text-danger fw-bold' : 'text-muted';

    html += '<tr class="' + rowClass + '">' +
      '<td><code>' + erpEsc(it.mrs_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(it.jo_no || '—') + '</td>' +
      '<td>' + erpEsc(truncate(it.client_name || '—', 20)) + '</td>' +
      '<td class="text-center">' + (it.line_no || '—') + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(truncate(it.description || '—', 50)) + '</td>' +
      '<td class="text-center">' + erpNum(qtyReturned) + '</td>' +
      '<td class="text-center">' + (atlQty > 0 ? '<strong>' + erpNum(atlQty) + '</strong>' : '—') + '</td>' +
      '<td class="text-center ' + remainingClass + '">' + (remainingQty > 0 ? erpNum(remainingQty) : '—') + '</td>' +
      '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
      '<td class="text-center">' + statusBadge + '</td>' +
      '<td>' + erpEsc(truncate(it.requestor || '—', 20)) + '</td>' +
      '<td title="' + erpEsc(it.remarks || '') + '">' + erpEsc(truncate(it.remarks || '', 30)) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// AUTO-REFRESH
// ═══════════════════════════════════════════════════════════
function mrsMonStartAutoRefresh() {
  if (!_mrsMon.autoRefreshEnabled) return;
  mrsMonStopAutoRefresh();
  _mrsMon.autoRefreshTimer = setInterval(function() {
    if (!document.hidden && _mrsMon.autoRefreshEnabled) {
      console.log('[MRS Monitoring] Auto-refreshing...');
      mrsMonLoad();
    }
  }, _mrsMon.REFRESH_INTERVAL);
  console.log('[MRS Monitoring] Auto-refresh started (every ' + (_mrsMon.REFRESH_INTERVAL/1000) + 's)');
}

function mrsMonStopAutoRefresh() {
  if (_mrsMon.autoRefreshTimer) {
    clearInterval(_mrsMon.autoRefreshTimer);
    _mrsMon.autoRefreshTimer = null;
  }
}

function mrsMonToggleAuto() {
  _mrsMon.autoRefreshEnabled = !_mrsMon.autoRefreshEnabled;
  var icon = document.getElementById('autoToggleIcon');
  var textEl = document.getElementById('liveUpdateText');
  
  if (_mrsMon.autoRefreshEnabled) {
    if (icon) icon.className = 'bi bi-pause-fill';
    if (textEl) textEl.textContent = 'Live';
    mrsMonStartAutoRefresh();
    erpShowToast('✅ Auto-refresh ON', 'success');
  } else {
    if (icon) icon.className = 'bi bi-play-fill';
    if (textEl) textEl.textContent = 'Paused';
    mrsMonStopAutoRefresh();
    erpShowToast('⏸️ Auto-refresh OFF', 'info');
  }
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function mrsMonPagePrev() {
  if (_mrsMon.currentPage > 1) {
    _mrsMon.currentPage--;
    mrsMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrsMonPageNext() {
  var maxPage = Math.ceil(_mrsMon.filteredItems.length / _mrsMon.pageSize);
  if (_mrsMon.currentPage < maxPage) {
    _mrsMon.currentPage++;
    mrsMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mrsMonRefresh() {
  erpShowToast('Refreshing...', 'info');
  mrsMonLoad();
  mrsMonCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function mrsMonExport() {
  if (_mrsMon.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = [
    'MRS No.', 'Date', 'JO No.', 'GEM SO No.', 'Client Name', 'Project',
    'Item#', 'Item Code', 'Description', 'Qty Returned', 'ATL Qty',
    'Remaining', 'Unit', 'Item Status', 'Requestor', 'Department', 'Remarks'
  ];

  var rows = _mrsMon.filteredItems.map(function(it) {
    return [
      it.mrs_no || '',
      it.request_date ? new Date(it.request_date).toLocaleDateString() : '',
      it.jo_no || '',
      it.gem_so_no || '',
      it.client_name || '',
      it.project || '',
      it.line_no || '',
      it.item_code || '',
      it.description || '',
      it.qty_returned || 0,
      it.atl_qty || 0,
      it.remaining_qty || 0,
      it.unit || '',
      it.item_status || '',
      it.requestor || '',
      it.department || '',
      it.remarks || ''
    ];
  });

  var csv = headers.map(_csvEscMrsMon).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscMrsMon).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRS_Monitoring_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function _csvEscMrsMon(val) {
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
function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ mrs-monitoring.js v1.0 loaded');
