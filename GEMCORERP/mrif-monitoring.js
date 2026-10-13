// ============================================================
// GEMCOR ERP — MRIF Monitoring (v1.0)
// Real-time monitoring of all MRIF items with status flags
// ============================================================

var _mrifMon = {
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
  console.log('[MRIF Monitoring v1.0] Initializing...');

  mrifMonCheckHealth();
  mrifMonLoad();
  mrifMonPopulateFilters();

  // Start auto-refresh
  mrifMonStartAutoRefresh();

  // Pause auto-refresh when tab hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      mrifMonStopAutoRefresh();
    } else {
      mrifMonStartAutoRefresh();
    }
  });
});

async function mrifMonCheckHealth() {
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
async function mrifMonLoad() {
  var tbody = document.getElementById('mrifMonTableBody');
  if (tbody && _mrifMon.allItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRIF items...</div></td></tr>';
  }

  try {
    var t0 = Date.now();

    // ═══ Query the view v_mrif_monitoring ═══
    // Order by needs_attention DESC (unserved first), then created_at DESC
    var rows = await erpFetch('v_mrif_monitoring',
      'select=*&order=needs_attention.desc,request_date.desc,line_no.asc&limit=10000');

    _mrifMon.allItems = rows || [];

    var elapsed = Date.now() - t0;
    console.log('[MRIF Monitoring] Loaded ' + _mrifMon.allItems.length + ' items in ' + elapsed + 'ms');

    mrifMonComputeKPIs();
    mrifMonApplyFilters();

  } catch(err) {
    console.error('[mrifMonLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="14" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function mrifMonComputeKPIs() {
  var items = _mrifMon.allItems;
  var totalDocs = {};
  var unserved = 0, partial = 0, served = 0;

  items.forEach(function(it) {
    if (it.mrif_no) totalDocs[it.mrif_no] = true;

    var status = String(it.item_status || '').toUpperCase();
    if (status === 'UNSERVED') unserved++;
    else if (status === 'PARTIAL') partial++;
    else if (status === 'SERVED') served++;
  });

  var totalDocsCount = Object.keys(totalDocs).length;

  // Update KPIs
  var el;
  el = document.getElementById('mrifMonKpiTotal');
  if (el) el.textContent = erpNum(totalDocsCount);
  
  el = document.getElementById('mrifMonKpiUnserved');
  if (el) el.textContent = erpNum(unserved);
  
  el = document.getElementById('mrifMonKpiPartial');
  if (el) el.textContent = erpNum(partial);
  
  el = document.getElementById('mrifMonKpiServed');
  if (el) el.textContent = erpNum(served);
  
  el = document.getElementById('mrifMonKpiItems');
  if (el) el.textContent = erpNum(items.length);

  // Update chip counts
  el = document.getElementById('chipCountAll');
  if (el) el.textContent = items.length;
  
  el = document.getElementById('chipCountUnserved');
  if (el) el.textContent = unserved;
  
  el = document.getElementById('chipCountPartial');
  if (el) el.textContent = partial;
  
  el = document.getElementById('chipCountServed');
  if (el) el.textContent = served;
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function mrifMonApplyFilters() {
  var search = (document.getElementById('mrifMonSearchInput') ? document.getElementById('mrifMonSearchInput').value : '').toLowerCase().trim();
  var docStatus = (document.getElementById('mrifMonDocStatusFilter') ? document.getElementById('mrifMonDocStatusFilter').value : '');
  var requestor = (document.getElementById('mrifMonRequestorFilter') ? document.getElementById('mrifMonRequestorFilter').value : '');
  var client = (document.getElementById('mrifMonClientFilter') ? document.getElementById('mrifMonClientFilter').value : '');
  var dateFrom = (document.getElementById('mrifMonDateFrom') ? document.getElementById('mrifMonDateFrom').value : '');
  var dateTo = (document.getElementById('mrifMonDateTo') ? document.getElementById('mrifMonDateTo').value : '');

  _mrifMon.filteredItems = _mrifMon.allItems.filter(function(it) {
    // Status filter (from chips)
    if (_mrifMon.activeStatusFilter) {
      var status = String(it.item_status || '').toUpperCase();
      if (status !== _mrifMon.activeStatusFilter) return false;
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
      var mrifNo = String(it.mrif_no || '').toLowerCase();
      var itemCode = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      var req = String(it.requestor || '').toLowerCase();
      var cli = String(it.client_name || '').toLowerCase();
      var soNo = String(it.so_no || '').toLowerCase();
      
      if (mrifNo.indexOf(search) === -1 &&
          itemCode.indexOf(search) === -1 &&
          desc.indexOf(search) === -1 &&
          req.indexOf(search) === -1 &&
          cli.indexOf(search) === -1 &&
          soNo.indexOf(search) === -1) return false;
    }

    return true;
  });

  _mrifMon.currentPage = 1;
  mrifMonRender();
}

function mrifMonFilterStatus(status) {
  _mrifMon.activeStatusFilter = status;
  
  // Update chip UI
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === status);
  });

  // Update doc status filter to match
  var docStatusFilter = document.getElementById('mrifMonDocStatusFilter');
  if (docStatusFilter) {
    if (status === 'SERVED') docStatusFilter.value = 'COMPLETED';
    else if (status === 'PARTIAL') docStatusFilter.value = 'PARTIAL';
    else docStatusFilter.value = '';
  }

  mrifMonApplyFilters();
}

function mrifMonFilterStatusChip(btn, status) {
  _mrifMon.activeStatusFilter = status;
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  mrifMonApplyFilters();
}

function mrifMonOnSearch() {
  clearTimeout(_mrifMon.searchTimer);
  _mrifMon.searchTimer = setTimeout(function() {
    mrifMonApplyFilters();
  }, 300);
}

function mrifMonClearFilters() {
  var s = document.getElementById('mrifMonSearchInput');
  var ds = document.getElementById('mrifMonDocStatusFilter');
  var r = document.getElementById('mrifMonRequestorFilter');
  var c = document.getElementById('mrifMonClientFilter');
  var df = document.getElementById('mrifMonDateFrom');
  var dt = document.getElementById('mrifMonDateTo');
  
  if (s) s.value = '';
  if (ds) ds.value = '';
  if (r) r.value = '';
  if (c) c.value = '';
  if (df) df.value = '';
  if (dt) dt.value = '';
  
  _mrifMon.activeStatusFilter = '';
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === '');
  });
  
  mrifMonApplyFilters();
}

async function mrifMonPopulateFilters() {
  // Populate requestors
  try {
    var rows = await erpFetch('v_mrif_monitoring', 'select=requestor&requestor=not.is.null&limit=1000');
    var seen = {};
    var reqs = [];
    (rows || []).forEach(function(r) {
      var v = String(r.requestor || '').trim();
      if (v && !seen[v]) { seen[v] = true; reqs.push(v); }
    });
    var sel = document.getElementById('mrifMonRequestorFilter');
    reqs.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('Requestor filter:', e.message); }

  // Populate clients
  try {
    var rows2 = await erpFetch('v_mrif_monitoring', 'select=client_name&client_name=not.is.null&limit=1000');
    var seen2 = {};
    var clients = [];
    (rows2 || []).forEach(function(r) {
      var v = String(r.client_name || '').trim();
      if (v && !seen2[v]) { seen2[v] = true; clients.push(v); }
    });
    var sel2 = document.getElementById('mrifMonClientFilter');
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
function mrifMonRender() {
  var tbody = document.getElementById('mrifMonTableBody');
  if (!tbody) return;

  var total = _mrifMon.filteredItems.length;
  var start = (_mrifMon.currentPage - 1) * _mrifMon.pageSize;
  var end = Math.min(start + _mrifMon.pageSize, total);
  var pageItems = _mrifMon.filteredItems.slice(start, end);

  // Update pagination
  var el;
  el = document.getElementById('mrifMonTableCount'); if (el) el.textContent = total + ' items';
  el = document.getElementById('mrifMonPageTotal'); if (el) el.textContent = total;
  el = document.getElementById('mrifMonPageStart'); if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('mrifMonPageEnd'); if (el) el.textContent = end;
  el = document.getElementById('mrifMonPageLabel'); if (el) el.textContent = 'Page ' + _mrifMon.currentPage;
  el = document.getElementById('mrifMonBtnPrev'); if (el) el.disabled = (_mrifMon.currentPage <= 1);
  el = document.getElementById('mrifMonBtnNext'); if (el) el.disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var itemStatus = String(it.item_status || 'UNSERVED').toUpperCase();
    var rowClass = '';
    var statusBadge = '';
    
    if (itemStatus === 'UNSERVED') {
      rowClass = 'needs-attention';
      statusBadge = '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle-fill me-1"></i>UNSERVED</span>';
    } else if (itemStatus === 'PARTIAL') {
      rowClass = 'partial-attention';
      statusBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-hourglass-split me-1"></i>PARTIAL</span>';
    } else {
      rowClass = 'served-row';
      statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle-fill me-1"></i>SERVED</span>';
    }

    var dateStr = it.request_date ? new Date(it.request_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    }) : '—';

    var requestedQty = Number(it.requested_qty || 0);
    var issuedQty = Number(it.issued_qty || 0);
    var remainingQty = Number(it.remaining_qty || 0);
    var remainingClass = remainingQty > 0 ? 'text-danger fw-bold' : 'text-muted';

    html += '<tr class="' + rowClass + '">' +
      '<td><code>' + erpEsc(it.mrif_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(it.so_no || '—') + '</td>' +
      '<td>' + erpEsc(truncate(it.client_name || '—', 20)) + '</td>' +
      '<td class="text-center">' + (it.line_no || '—') + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(truncate(it.description || '—', 50)) + '</td>' +
      '<td class="text-center">' + erpNum(requestedQty) + '</td>' +
      '<td class="text-center">' + (issuedQty > 0 ? '<strong>' + erpNum(issuedQty) + '</strong>' : '—') + '</td>' +
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
function mrifMonStartAutoRefresh() {
  if (!_mrifMon.autoRefreshEnabled) return;
  mrifMonStopAutoRefresh();
  _mrifMon.autoRefreshTimer = setInterval(function() {
    if (!document.hidden && _mrifMon.autoRefreshEnabled) {
      console.log('[MRIF Monitoring] Auto-refreshing...');
      mrifMonLoad();
    }
  }, _mrifMon.REFRESH_INTERVAL);
  console.log('[MRIF Monitoring] Auto-refresh started (every ' + (_mrifMon.REFRESH_INTERVAL/1000) + 's)');
}

function mrifMonStopAutoRefresh() {
  if (_mrifMon.autoRefreshTimer) {
    clearInterval(_mrifMon.autoRefreshTimer);
    _mrifMon.autoRefreshTimer = null;
  }
}

function mrifMonToggleAuto() {
  _mrifMon.autoRefreshEnabled = !_mrifMon.autoRefreshEnabled;
  var icon = document.getElementById('autoToggleIcon');
  var textEl = document.getElementById('liveUpdateText');
  
  if (_mrifMon.autoRefreshEnabled) {
    if (icon) icon.className = 'bi bi-pause-fill';
    if (textEl) textEl.textContent = 'Live';
    mrifMonStartAutoRefresh();
    erpShowToast('✅ Auto-refresh ON', 'success');
  } else {
    if (icon) icon.className = 'bi bi-play-fill';
    if (textEl) textEl.textContent = 'Paused';
    mrifMonStopAutoRefresh();
    erpShowToast('⏸️ Auto-refresh OFF', 'info');
  }
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function mrifMonPagePrev() {
  if (_mrifMon.currentPage > 1) {
    _mrifMon.currentPage--;
    mrifMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrifMonPageNext() {
  var maxPage = Math.ceil(_mrifMon.filteredItems.length / _mrifMon.pageSize);
  if (_mrifMon.currentPage < maxPage) {
    _mrifMon.currentPage++;
    mrifMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mrifMonRefresh() {
  erpShowToast('Refreshing...', 'info');
  mrifMonLoad();
  mrifMonCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function mrifMonExport() {
  if (_mrifMon.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = [
    'MRIF No.', 'Date', 'SO No.', 'Client Name', 'Item#', 'Item Code',
    'Description', 'Req Qty', 'Issued Qty', 'Remaining', 'Unit',
    'Item Status', 'Requestor', 'Department', 'JO No.', 'Project', 'Remarks'
  ];

  var rows = _mrifMon.filteredItems.map(function(it) {
    return [
      it.mrif_no || '',
      it.request_date ? new Date(it.request_date).toLocaleDateString() : '',
      it.so_no || '',
      it.client_name || '',
      it.line_no || '',
      it.item_code || '',
      it.description || '',
      it.requested_qty || 0,
      it.issued_qty || 0,
      it.remaining_qty || 0,
      it.unit || '',
      it.item_status || '',
      it.requestor || '',
      it.department || '',
      it.jo_no || '',
      it.project || '',
      it.remarks || ''
    ];
  });

  var csv = headers.map(_csvEscMrifMon).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscMrifMon).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRIF_Monitoring_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function _csvEscMrifMon(val) {
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

console.log('✅ mrif-monitoring.js v1.0 loaded');
