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

// ═══════════════════════════════════════════════════════════
// TRANSMITTAL LOGIC (v2 with Selection & DB Tracking)
// ═══════════════════════════════════════════════════════════
var _transmitMRRList = []; // Temporary storage para sa checklist

window.openTransmittalModal = async function() {
  if (!_mrrMon.filteredItems || _mrrMon.filteredItems.length === 0) {
    erpShowToast('Walang items na nakikita para i-transmit.', 'warning');
    return;
  }
  
  resetTransmittalModal();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('transmittalModal')).show();
  
  var tbody = document.getElementById('transmittalSelectionBody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    // 1. Kunin ang unique MRRs mula sa currently filtered items
    var uniqueMRRs = {};
    _mrrMon.filteredItems.forEach(function(it) {
      var mrrNo = it.mrr_no;
      if (!mrrNo) return;
      if (!uniqueMRRs[mrrNo]) {
        uniqueMRRs[mrrNo] = {
          mrrNo: mrrNo,
          date: it.mrr_date || it.processed_at || it.created_at,
          supplier: it.vendor || '—',
          poNo: it.po_no || it.ref_no || '—'
        };
      }
    });
    
    var mrrList = Object.values(uniqueMRRs);
    mrrList.sort(function(a, b) { return String(b.mrrNo).localeCompare(String(a.mrrNo)); });
    
    // 2. Kunin ang is_transmitted status sa DB para maiwasan ang doble
    if (mrrList.length > 0) {
      var mrrNosStr = mrrList.map(function(m) { return m.mrrNo; }).join(',');
      var docsRes = await erpFetch('documents', 'select=doc_no,is_transmitted&doc_no=in.(' + encodeURIComponent(mrrNosStr) + ')');
      
      var transmitStatusMap = {};
      (docsRes || []).forEach(function(d) {
        transmitStatusMap[d.doc_no] = d.is_transmitted === true;
      });
      
      // 3. I-merge ang status
      _transmitMRRList = mrrList.map(function(m) {
        m.isTransmitted = transmitStatusMap[m.mrrNo] === true;
        return m;
      });
    } else {
      _transmitMRRList = [];
    }
    
    renderTransmittalSelection();
    
  } catch(err) {
    console.error('[openTransmittalModal]', err);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Failed to load statuses.</td></tr>';
  }
};

function renderTransmittalSelection() {
  var tbody = document.getElementById('transmittalSelectionBody');
  var html = '';
  
  if (_transmitMRRList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No MRRs found.</td></tr>';
    return;
  }
  
  _transmitMRRList.forEach(function(m, idx) {
    // Auto-check kung HINDI PA naka-transmit
    var isChecked = !m.isTransmitted; 
    var rowClass = m.isTransmitted ? ' style="background:#f8fafc;opacity:0.7;"' : '';
    
    var statusBadge = m.isTransmitted 
      ? '<span class="badge bg-secondary">TRANSMITTED</span>'
      : '<span class="badge bg-success">READY</span>';
      
    var dateStr = '—';
    if (m.date) {
      try {
        dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
      } catch(e) {}
    }
    
    html += '<tr' + rowClass + '>' +
      '<td class="text-center align-middle">' +
        '<input type="checkbox" class="transmit-mrr-chk" data-idx="' + idx + '" ' +
        (isChecked ? 'checked' : '') + '>' +
      '</td>' +
      '<td class="align-middle"><strong>' + erpEsc(m.mrrNo) + '</strong></td>' +
      '<td class="align-middle">' + erpEsc(dateStr) + '</td>' +
      '<td class="align-middle">' + erpEsc(m.supplier) + '</td>' +
      '<td class="text-center align-middle">' + statusBadge + '</td>' +
    '</tr>';
  });
  
  tbody.innerHTML = html;
}

function toggleAllTransmittalMRRs(checked) {
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    chk.checked = checked; 
  });
}

function backToTransmittalSelection() {
  document.getElementById('transmittalSelectionView').style.display = 'block';
  document.getElementById('transmittalPreviewView').style.display = 'none';
  document.getElementById('btnProceedToPreview').style.display = 'inline-block';
  document.getElementById('btnPrintTransmittal').style.display = 'none';
}

function buildTransmittalPreview() {
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx]);
    }
  });
  
  if (selectedMRRs.length === 0) {
    erpShowToast('Pumili ng kahit isang MRR para i-transmit.', 'warning');
    return;
  }
  
  // Setup Date
  document.getElementById('transmittalDate').textContent = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
  
  // Setup Prepared By
  document.getElementById('transmittalPreparedBy').textContent = localStorage.getItem('ivm_userFullname') || 'ADMIN';
  
  // Render Table Rows
  var tbody = document.getElementById('transmittalBody');
  var html = '';
  selectedMRRs.forEach(function(m) {
    var dateStr = '—';
    if (m.date) {
      try { dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }); } catch(e) {}
    }
    html += '<tr style="border-bottom: 1px solid #e2e8f0;">' +
      '<td style="padding: 10px 8px; text-align: center; font-weight: 600;">' + erpEsc(m.mrrNo) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(dateStr) + '</td>' +
      '<td style="padding: 10px 8px;">' + erpEsc(m.supplier) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(m.poNo) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
  
  // Switch Views
  document.getElementById('transmittalSelectionView').style.display = 'none';
  document.getElementById('transmittalPreviewView').style.display = 'block';
  document.getElementById('btnProceedToPreview').style.display = 'none';
  document.getElementById('btnPrintTransmittal').style.display = 'inline-block';
}

window.printTransmittal = async function() {
  var printContents = document.getElementById('transmittalSheet').innerHTML;
  
  // 1. Kunin ang mga naka-check para i-save sa DB
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx].mrrNo);
    }
  });
  
  // 2. I-flag as TRANSMITTED sa database
  if (selectedMRRs.length > 0) {
    try {
      var mrrNosStr = selectedMRRs.join(',');
      await fetch(erpUrl('documents?doc_no=in.(' + encodeURIComponent(mrrNosStr) + ')'), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          is_transmitted: true,
          transmitted_at: new Date().toISOString()
        })
      });
      console.log('Marked as transmitted:', selectedMRRs);
      erpShowToast('✅ ' + selectedMRRs.length + ' MRR(s) marked as transmitted.', 'success');
    } catch(err) {
      console.warn('Failed to mark as transmitted:', err);
    }
  }
  
  // 3. Print Logic
  var printWindow = window.open('', '_blank');
  printWindow.document.write(
    '<html><head><title>MRR Transmittal</title>' +
    '<style>' +
    '  body { font-family: "Inter", Arial, sans-serif; padding: 20px; }' +
    '  table { width: 100%; border-collapse: collapse; font-size: 12px; }' +
    '  th, td { padding: 8px; text-align: left; }' +
    '  th { border-top: 2px solid #000; border-bottom: 2px solid #000; text-align: center; font-weight: bold; }' +
    '  tr { border-bottom: 1px solid #ccc; }' +
    '  h3 { margin-bottom: 20px; }' +
    '  @media print { @page { size: portrait; margin: 0.5in; } body { padding: 0; } }' +
    '</style></head><body>' + printContents + '</body></html>'
  );
  
  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(function() {
    printWindow.print();
    printWindow.close();
    
    // I-refresh ang MRR Monitor para maging "TRANSMITTED" na sila sa susunod
    if (typeof mrrMonLoad === 'function') mrrMonLoad(); 
    
    // Isara ang modal
    bootstrap.Modal.getInstance(document.getElementById('transmittalModal')).hide();
  }, 250);
};

function resetTransmittalModal() {
  backToTransmittalSelection();
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(cb) { cb.checked = true; });
  var selectAllCb = document.getElementById('transmitSelectAll');
  if (selectAllCb) selectAllCb.checked = false;
}
// ═══════════════════════════════════════════════════════════
// GLOBAL VAR FOR CURRENT TRN
// ═══════════════════════════════════════════════════════════
var _currentTransmittalNo = '';

// ═══════════════════════════════════════════════════════════
// UPDATE PREVIEW PARA MAKAKUHA NG TRN
// ═══════════════════════════════════════════════════════════
// Hanapin ang existing buildTransmittalPreview at i-replace ng ganito:
window.buildTransmittalPreview = async function() {
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx]);
    }
  });
  
  if (selectedMRRs.length === 0) {
    erpShowToast('Pumili ng kahit isang MRR para i-transmit.', 'warning');
    return;
  }
  
  // Kunin ang susunod na TRN Number
  try {
    var res = await fetch(erpUrl('rpc/get_next_transmittal_no'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({})
    });
    if (res.ok) {
      _currentTransmittalNo = await res.json();
    } else {
      _currentTransmittalNo = 'TRN-' + new Date().toISOString().slice(0, 7) + '-XXX';
    }
  } catch(e) {
    _currentTransmittalNo = 'TRN-ERROR';
  }

  // Setup Date & TRN
  document.getElementById('transmittalDate').textContent = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
  document.getElementById('transmittalNo').textContent = _currentTransmittalNo;
  
  // Setup Prepared By
  document.getElementById('transmittalPreparedBy').textContent = localStorage.getItem('ivm_userFullname') || 'ADMIN';
  
  // Render Table Rows
  var tbody = document.getElementById('transmittalBody');
  var html = '';
  selectedMRRs.forEach(function(m) {
    var dateStr = '—';
    if (m.date) {
      try { dateStr = new Date(m.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }); } catch(e) {}
    }
    html += '<tr style="border-bottom: 1px solid #e2e8f0;">' +
      '<td style="padding: 10px 8px; text-align: center; font-weight: 600;">' + erpEsc(m.mrrNo) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(dateStr) + '</td>' +
      '<td style="padding: 10px 8px;">' + erpEsc(m.supplier) + '</td>' +
      '<td style="padding: 10px 8px; text-align: center;">' + erpEsc(m.poNo) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
  
  // Switch Views
  document.getElementById('transmittalSelectionView').style.display = 'none';
  document.getElementById('transmittalPreviewView').style.display = 'block';
  document.getElementById('btnProceedToPreview').style.display = 'none';
  document.getElementById('btnPrintTransmittal').style.display = 'inline-block';
};

// ═══════════════════════════════════════════════════════════
// UPDATE PRINT FUNCTION PARA MA-SAVE SA DB
// ═══════════════════════════════════════════════════════════
// Hanapin ang existing printTransmittal at palitan:
window.printTransmittal = async function() {
  var printContents = document.getElementById('transmittalSheet').innerHTML;
  
  var selectedMRRs = [];
  document.querySelectorAll('.transmit-mrr-chk').forEach(function(chk) {
    if (chk.checked) {
      var idx = parseInt(chk.getAttribute('data-idx'), 10);
      selectedMRRs.push(_transmitMRRList[idx].mrrNo);
    }
  });
  
  if (selectedMRRs.length > 0) {
    try {
      var currentUser = localStorage.getItem('ivm_userFullname') || 'ADMIN';
      
      // 1. Insert sa mrr_transmittals table
      await fetch(erpUrl('mrr_transmittals'), {
        method: 'POST',
        headers: erpHeaders({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          transmittal_no: _currentTransmittalNo,
          transmittal_date: new Date().toISOString().split('T')[0],
          prepared_by: currentUser
        })
      });

      // 2. Update ang documents table para ma-link sa TRN
      var mrrNosStr = selectedMRRs.join(',');
      await fetch(erpUrl('documents?doc_no=in.(' + encodeURIComponent(mrrNosStr) + ')'), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          is_transmitted: true,
          transmittal_no: _currentTransmittalNo,
          transmitted_at: new Date().toISOString()
        })
      });
      
      console.log('Transmittal saved:', _currentTransmittalNo);
      erpShowToast('✅ Transmittal ' + _currentTransmittalNo + ' saved!', 'success');
    } catch(err) {
      console.warn('Failed to save transmittal:', err);
      erpShowToast('⚠️ Warning: Na-print pero hindi na-save sa DB.', 'warning');
    }
  }
  
  var printWindow = window.open('', '_blank');
  printWindow.document.write(
    '<html><head><title>MRR Transmittal</title>' +
    '<style>' +
    '  body { font-family: "Inter", Arial, sans-serif; padding: 20px; }' +
    '  table { width: 100%; border-collapse: collapse; font-size: 12px; }' +
    '  th, td { padding: 8px; text-align: left; }' +
    '  th { border-top: 2px solid #000; border-bottom: 2px solid #000; text-align: center; font-weight: bold; }' +
    '  tr { border-bottom: 1px solid #ccc; }' +
    '  h3 { margin-bottom: 20px; }' +
    '  @media print { @page { size: portrait; margin: 0.5in; } body { padding: 0; } }' +
    '</style></head><body>' + printContents + '</body></html>'
  );
  
  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(function() {
    printWindow.print();
    printWindow.close();
    if (typeof mrrMonLoad === 'function') mrrMonLoad(); 
    bootstrap.Modal.getInstance(document.getElementById('transmittalModal')).hide();
  }, 250);
};

// ═══════════════════════════════════════════════════════════
// TRANSMITTAL HISTORY LOGIC
// ═══════════════════════════════════════════════════════════
window.openTransmittalHistoryModal = async function() {
  var modalEl = document.getElementById('transmittalHistoryModal');
  var tbody = document.getElementById('transmittalHistoryBody');
  
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    var rows = await erpFetch('mrr_transmittals', 'select=*&order=created_at.desc&limit=100');
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">No transmittals generated yet.</td></tr>';
      return;
    }
    
    var html = '';
    rows.forEach(function(r) {
      var dateStr = r.transmittal_date ? new Date(r.transmittal_date).toLocaleDateString() : '—';
      var safeTrn = String(r.transmittal_no).replace(/'/g, "\\'");
      
      html += '<tr>' +
        '<td><strong style="color:#dc2626;">' + erpEsc(r.transmittal_no) + '</strong></td>' +
        '<td>' + erpEsc(dateStr) + '</td>' +
        '<td>' + erpEsc(r.prepared_by) + '</td>' +
        '<td class="text-center">' +
          '<button class="btn btn-sm btn-outline-primary" onclick="viewTransmittalMRRs(\'' + safeTrn + '\')">' +
            '<i class="bi bi-eye me-1"></i>View MRRs' +
          '</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch(err) {
    console.error('[openTransmittalHistoryModal]', err);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-3">Failed to load history.</td></tr>';
  }
};

window.viewTransmittalMRRs = async function(trnNo) {
  var modalEl = document.getElementById('viewTrnMRRsModal');
  var tbody = document.getElementById('viewTrnMRRsBody');
  var titleEl = document.getElementById('viewTrnTitle');
  
  titleEl.textContent = trnNo;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    var rows = await erpFetch('documents', 'select=doc_no,vendor,po_no,receiving_date&transmittal_no=eq.' + encodeURIComponent(trnNo) + '&order=doc_no.asc');
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">No MRRs found for this transmittal.</td></tr>';
      return;
    }
    
    var html = '';
    rows.forEach(function(r) {
      var dateStr = r.receiving_date ? new Date(r.receiving_date).toLocaleDateString() : '—';
      html += '<tr>' +
        '<td><strong>' + erpEsc(r.doc_no) + '</strong></td>' +
        '<td>' + erpEsc(r.vendor || '—') + '</td>' +
        '<td>' + erpEsc(r.po_no || '—') + '</td>' +
        '<td>' + erpEsc(dateStr) + '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  } catch(err) {
    console.error('[viewTransmittalMRRs]', err);
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-3">Failed to load MRRs.</td></tr>';
  }
};
