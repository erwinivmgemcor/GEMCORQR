// ============================================================
// GEMCOR ERP — MRR Monitoring (v1.0)
// Real-time monitoring of all MRR items with creator info
// ============================================================

var _mrrMon = {
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
  console.log('[MRR Monitoring v1.0] Initializing...');

  mrrMonCheckHealth();
  mrrMonLoad();
  mrrMonPopulateFilters();

  // Start auto-refresh
  mrrMonStartAutoRefresh();

  // Pause auto-refresh when tab hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      mrrMonStopAutoRefresh();
    } else {
      mrrMonStartAutoRefresh();
    }
  });
});

async function mrrMonCheckHealth() {
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
async function mrrMonLoad() {
  var tbody = document.getElementById('mrrMonTableBody');
  if (tbody && _mrrMon.allItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading MRR items...</div></td></tr>';
  }

  try {
    var t0 = Date.now();

    // ═══ Query the view v_mrr_monitoring ═══
    var rows = await erpFetch('v_mrr_monitoring',
      'select=*&order=mrr_date.desc,line_no.asc&limit=10000');

    _mrrMon.allItems = rows || [];

    var elapsed = Date.now() - t0;
    console.log('[MRR Monitoring] Loaded ' + _mrrMon.allItems.length + ' items in ' + elapsed + 'ms');

    mrrMonComputeKPIs();
    mrrMonApplyFilters();

  } catch(err) {
    console.error('[mrrMonLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="15" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function mrrMonComputeKPIs() {
  var items = _mrrMon.allItems;
  var totalDocs = {};
  var pending = 0, partial = 0, complete = 0;

  items.forEach(function(it) {
    if (it.mrr_no) totalDocs[it.mrr_no] = true;

    var status = String(it.item_status || '').toUpperCase();
    if (status === 'PENDING') pending++;
    else if (status === 'PARTIAL') partial++;
    else if (status === 'COMPLETE') complete++;
  });

  var totalDocsCount = Object.keys(totalDocs).length;

  // Update KPIs
  var el;
  el = document.getElementById('mrrMonKpiTotal');
  if (el) el.textContent = erpNum(totalDocsCount);
  
  el = document.getElementById('mrrMonKpiPending');
  if (el) el.textContent = erpNum(pending);
  
  el = document.getElementById('mrrMonKpiPartial');
  if (el) el.textContent = erpNum(partial);
  
  el = document.getElementById('mrrMonKpiComplete');
  if (el) el.textContent = erpNum(complete);
  
  el = document.getElementById('mrrMonKpiItems');
  if (el) el.textContent = erpNum(items.length);

  // Update chip counts
  el = document.getElementById('mrrChipCountAll');
  if (el) el.textContent = items.length;
  
  el = document.getElementById('mrrChipCountPending');
  if (el) el.textContent = pending;
  
  el = document.getElementById('mrrChipCountPartial');
  if (el) el.textContent = partial;
  
  el = document.getElementById('mrrChipCountComplete');
  if (el) el.textContent = complete;
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function mrrMonApplyFilters() {
  var search = (document.getElementById('mrrMonSearchInput') ? document.getElementById('mrrMonSearchInput').value : '').toLowerCase().trim();
  var docStatus = (document.getElementById('mrrMonDocStatusFilter') ? document.getElementById('mrrMonDocStatusFilter').value : '');
  var vendor = (document.getElementById('mrrMonVendorFilter') ? document.getElementById('mrrMonVendorFilter').value : '');
  var creator = (document.getElementById('mrrMonCreatorFilter') ? document.getElementById('mrrMonCreatorFilter').value : '');
  var dateFrom = (document.getElementById('mrrMonDateFrom') ? document.getElementById('mrrMonDateFrom').value : '');
  var dateTo = (document.getElementById('mrrMonDateTo') ? document.getElementById('mrrMonDateTo').value : '');

  _mrrMon.filteredItems = _mrrMon.allItems.filter(function(it) {
    // Status filter (from chips)
    if (_mrrMon.activeStatusFilter) {
      var status = String(it.item_status || '').toUpperCase();
      if (status !== _mrrMon.activeStatusFilter) return false;
    }

    // Doc status filter
    if (docStatus && String(it.doc_status || '').toUpperCase() !== docStatus) return false;

    // Vendor filter
    if (vendor && String(it.vendor || '') !== vendor) return false;

    // Creator filter
    if (creator && String(it.prepared_by || '') !== creator) return false;

    // Date range filter
    if (dateFrom || dateTo) {
      var mrrDate = it.mrr_date ? new Date(it.mrr_date) : null;
      if (mrrDate) {
        if (dateFrom) {
          var fromD = new Date(dateFrom + 'T00:00:00');
          if (mrrDate < fromD) return false;
        }
        if (dateTo) {
          var toD = new Date(dateTo + 'T23:59:59');
          if (mrrDate > toD) return false;
        }
      }
    }

    // Search filter
    if (search) {
      var mrrNo = String(it.mrr_no || '').toLowerCase();
      var itemCode = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      var poNo = String(it.po_no || '').toLowerCase();
      var vend = String(it.vendor || '').toLowerCase();
      var prepBy = String(it.prepared_by || '').toLowerCase();
      var drNo = String(it.dr_no || '').toLowerCase();
      
      if (mrrNo.indexOf(search) === -1 &&
          itemCode.indexOf(search) === -1 &&
          desc.indexOf(search) === -1 &&
          poNo.indexOf(search) === -1 &&
          vend.indexOf(search) === -1 &&
          prepBy.indexOf(search) === -1 &&
          drNo.indexOf(search) === -1) return false;
    }

    return true;
  });

  _mrrMon.currentPage = 1;
  mrrMonRender();
}

function mrrMonFilterStatus(status) {
  _mrrMon.activeStatusFilter = status;
  
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === status);
  });

  mrrMonApplyFilters();
}

function mrrMonFilterStatusChip(btn, status) {
  _mrrMon.activeStatusFilter = status;
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  mrrMonApplyFilters();
}

function mrrMonOnSearch() {
  clearTimeout(_mrrMon.searchTimer);
  _mrrMon.searchTimer = setTimeout(function() {
    mrrMonApplyFilters();
  }, 300);
}

function mrrMonClearFilters() {
  var s = document.getElementById('mrrMonSearchInput');
  var ds = document.getElementById('mrrMonDocStatusFilter');
  var v = document.getElementById('mrrMonVendorFilter');
  var c = document.getElementById('mrrMonCreatorFilter');
  var df = document.getElementById('mrrMonDateFrom');
  var dt = document.getElementById('mrrMonDateTo');
  
  if (s) s.value = '';
  if (ds) ds.value = '';
  if (v) v.value = '';
  if (c) c.value = '';
  if (df) df.value = '';
  if (dt) dt.value = '';
  
  _mrrMon.activeStatusFilter = '';
  document.querySelectorAll('.filter-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.getAttribute('data-status') === '');
  });
  
  mrrMonApplyFilters();
}

async function mrrMonPopulateFilters() {
  // Populate vendors
  try {
    var rows = await erpFetch('v_mrr_monitoring', 'select=vendor&vendor=not.is.null&limit=1000');
    var seen = {};
    var vendors = [];
    (rows || []).forEach(function(r) {
      var v = String(r.vendor || '').trim();
      if (v && !seen[v]) { seen[v] = true; vendors.push(v); }
    });
    var sel = document.getElementById('mrrMonVendorFilter');
    vendors.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('Vendor filter:', e.message); }

  // Populate creators
  try {
    var rows2 = await erpFetch('v_mrr_monitoring', 'select=prepared_by&prepared_by=not.is.null&limit=1000');
    var seen2 = {};
    var creators = [];
    (rows2 || []).forEach(function(r) {
      var v = String(r.prepared_by || '').trim();
      if (v && !seen2[v]) { seen2[v] = true; creators.push(v); }
    });
    var sel2 = document.getElementById('mrrMonCreatorFilter');
    creators.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel2.appendChild(opt);
    });
  } catch(e) { console.warn('Creator filter:', e.message); }
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function mrrMonRender() {
  var tbody = document.getElementById('mrrMonTableBody');
  if (!tbody) return;

  var total = _mrrMon.filteredItems.length;
  var start = (_mrrMon.currentPage - 1) * _mrrMon.pageSize;
  var end = Math.min(start + _mrrMon.pageSize, total);
  var pageItems = _mrrMon.filteredItems.slice(start, end);

  // Update pagination
  var el;
  el = document.getElementById('mrrMonTableCount'); if (el) el.textContent = total + ' items';
  el = document.getElementById('mrrMonPageTotal'); if (el) el.textContent = total;
  el = document.getElementById('mrrMonPageStart'); if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('mrrMonPageEnd'); if (el) el.textContent = end;
  el = document.getElementById('mrrMonPageLabel'); if (el) el.textContent = 'Page ' + _mrrMon.currentPage;
  el = document.getElementById('mrrMonBtnPrev'); if (el) el.disabled = (_mrrMon.currentPage <= 1);
  el = document.getElementById('mrrMonBtnNext'); if (el) el.disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="erp-empty">' +
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
      rowClass = 'completed-row';
      statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle-fill me-1"></i>COMPLETE</span>';
    }

    var dateStr = it.mrr_date ? new Date(it.mrr_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit'
    }) : '—';

    var qty = Number(it.requested_qty || 0);
    var recv = Number(it.received_qty || 0);

    var creatorName = it.prepared_by || it.created_by || '—';
    var processedName = it.processed_by || '—';

    html += '<tr class="' + rowClass + '">' +
      '<td><code>' + erpEsc(it.mrr_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.po_no || '—') + '</code></td>' +
      '<td>' + erpEsc(truncate(it.vendor || '—', 25)) + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.ref_no || '—') + '</code></td>' +
      '<td class="text-center">' + (it.line_no || '—') + '</td>' +
      '<td><code style="font-size:0.72rem;">' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(truncate(it.description || '—', 45)) + '</td>' +
      '<td class="text-center">' + erpNum(qty) + '</td>' +
      '<td class="text-center">' + (recv > 0 ? '<strong>' + erpNum(recv) + '</strong>' : '—') + '</td>' +
      '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
      '<td class="text-center">' + statusBadge + '</td>' +
      '<td><span class="creator-badge"><i class="bi bi-person"></i> ' + erpEsc(truncate(creatorName, 18)) + '</span></td>' +
      '<td>' + erpEsc(truncate(processedName, 18)) + '</td>' +
      '<td title="' + erpEsc(it.remarks || '') + '">' + erpEsc(truncate(it.remarks || '', 20)) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// AUTO-REFRESH
// ═══════════════════════════════════════════════════════════
function mrrMonStartAutoRefresh() {
  if (!_mrrMon.autoRefreshEnabled) return;
  mrrMonStopAutoRefresh();
  _mrrMon.autoRefreshTimer = setInterval(function() {
    if (!document.hidden && _mrrMon.autoRefreshEnabled) {
      console.log('[MRR Monitoring] Auto-refreshing...');
      mrrMonLoad();
    }
  }, _mrrMon.REFRESH_INTERVAL);
  console.log('[MRR Monitoring] Auto-refresh started (every ' + (_mrrMon.REFRESH_INTERVAL/1000) + 's)');
}

function mrrMonStopAutoRefresh() {
  if (_mrrMon.autoRefreshTimer) {
    clearInterval(_mrrMon.autoRefreshTimer);
    _mrrMon.autoRefreshTimer = null;
  }
}

function mrrMonToggleAuto() {
  _mrrMon.autoRefreshEnabled = !_mrrMon.autoRefreshEnabled;
  var icon = document.getElementById('autoToggleIcon');
  var textEl = document.getElementById('liveUpdateText');
  
  if (_mrrMon.autoRefreshEnabled) {
    if (icon) icon.className = 'bi bi-pause-fill';
    if (textEl) textEl.textContent = 'Live';
    mrrMonStartAutoRefresh();
    erpShowToast('✅ Auto-refresh ON', 'success');
  } else {
    if (icon) icon.className = 'bi bi-play-fill';
    if (textEl) textEl.textContent = 'Paused';
    mrrMonStopAutoRefresh();
    erpShowToast('⏸️ Auto-refresh OFF', 'info');
  }
}

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function mrrMonPagePrev() {
  if (_mrrMon.currentPage > 1) {
    _mrrMon.currentPage--;
    mrrMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function mrrMonPageNext() {
  var maxPage = Math.ceil(_mrrMon.filteredItems.length / _mrrMon.pageSize);
  if (_mrrMon.currentPage < maxPage) {
    _mrrMon.currentPage++;
    mrrMonRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function mrrMonRefresh() {
  erpShowToast('Refreshing...', 'info');
  mrrMonLoad();
  mrrMonCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function mrrMonExport() {
  if (_mrrMon.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = [
    'MRR No.', 'Date', 'PO No.', 'Vendor', 'Ref No.', 'Item#', 'Item Code',
    'Description', 'Qty', 'Received', 'Unit', 'Status',
    'Created By', 'Processed By', 'DR No.', 'Remarks'
  ];

  var rows = _mrrMon.filteredItems.map(function(it) {
    return [
      it.mrr_no || '',
      it.mrr_date ? new Date(it.mrr_date).toLocaleDateString() : '',
      it.po_no || '',
      it.vendor || '',
      it.ref_no || '',
      it.line_no || '',
      it.item_code || '',
      it.description || '',
      it.requested_qty || 0,
      it.received_qty || 0,
      it.unit || '',
      it.item_status || '',
      it.prepared_by || '',
      it.processed_by || '',
      it.dr_no || '',
      it.remarks || ''
    ];
  });

  var csv = headers.map(_csvEscMrrMon).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscMrrMon).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MRR_Monitoring_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function _csvEscMrrMon(val) {
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

console.log('✅ mrr-monitoring.js v1.0 loaded');
