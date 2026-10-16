// ============================================================
// GEMCOR ERP — SOF Tracker (v1.0)
// Reads from: erp_sof_allocations + erp_sof_allocation_items
// Uses RPCs: erp_sof_get_tracker_list, erp_sof_get_items, erp_sof_get_history
// ============================================================

var _sofTracker = {
  allAllocations: [],
  filteredAllocations: [],
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  currentSof: null,
  itemsModal: null,
  historyModal: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[SOF Tracker v1.0] Initializing...');

  sofTrackerCheckHealth();
  sofTrackerLoad();
  sofTrackerPopulateFilters();
});

async function sofTrackerCheckHealth() {
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
// LOAD DATA — via RPC erp_sof_get_tracker_list
// ═══════════════════════════════════════════════════════════
async function sofTrackerLoad() {
  var tbody = document.getElementById('sofTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="12" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading SOF allocations...</div></td></tr>';
  }

  try {
    var t0 = Date.now();
    var statusEl = document.getElementById('sofStatusFilter');
    var status = statusEl ? statusEl.value : null;

    var res = await fetch(erpUrl('rpc/erp_sof_get_tracker_list'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_status: status || null,
        p_client: null,
        p_search: null,
        p_limit: 500
      })
    });

    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText.substring(0, 150));
    }

    var data = await res.json();
    _sofTracker.allAllocations = (data && data.allocations) ? data.allocations : [];

    var elapsed = Date.now() - t0;
    console.log('[SOF Tracker] Loaded ' + _sofTracker.allAllocations.length + ' allocations in ' + elapsed + 'ms');

    sofTrackerComputeKPIs();
    sofTrackerApplyFilters();
  } catch(err) {
    console.error('[sofTrackerLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="12" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + sofTrackerEsc(err.message) + '</td></tr>';
    }
  }
}

window.sofTrackerLoad = sofTrackerLoad;

// ═══════════════════════════════════════════════════════════
// COMPUTE KPIs
// ═══════════════════════════════════════════════════════════
function sofTrackerComputeKPIs() {
  var allocations = _sofTracker.allAllocations;
  var total = allocations.length;
  var active = 0, completed = 0, cancelled = 0;
  var totalRemaining = 0;

  allocations.forEach(function(a) {
    var status = String(a.status || '').toUpperCase();
    if (status === 'ACTIVE') active++;
    else if (status === 'COMPLETED') completed++;
    else if (status === 'CANCELLED') cancelled++;

    totalRemaining += Number(a.total_remaining_qty || 0);
  });

  var el;
  el = document.getElementById('sofKpiTotal'); if (el) el.textContent = sofTrackerNum(total);
  el = document.getElementById('sofKpiActive'); if (el) el.textContent = sofTrackerNum(active);
  el = document.getElementById('sofKpiCompleted'); if (el) el.textContent = sofTrackerNum(completed);
  el = document.getElementById('sofKpiCancelled'); if (el) el.textContent = sofTrackerNum(cancelled);
  el = document.getElementById('sofKpiRemaining'); if (el) el.textContent = sofTrackerNum(totalRemaining);
}

// ═══════════════════════════════════════════════════════════
// APPLY FILTERS
// ═══════════════════════════════════════════════════════════
function sofTrackerApplyFilters() {
  var search = (document.getElementById('sofSearchInput') ? document.getElementById('sofSearchInput').value : '').toLowerCase().trim();
  var statusFilter = (document.getElementById('sofStatusFilter') ? document.getElementById('sofStatusFilter').value : '');
  var clientFilter = (document.getElementById('sofClientFilter') ? document.getElementById('sofClientFilter').value : '');
  var dateFrom = (document.getElementById('sofDateFrom') ? document.getElementById('sofDateFrom').value : '');
  var dateTo = (document.getElementById('sofDateTo') ? document.getElementById('sofDateTo').value : '');

  _sofTracker.filteredAllocations = _sofTracker.allAllocations.filter(function(a) {
    // Status filter
    if (statusFilter && String(a.status || '').toUpperCase() !== statusFilter) return false;

    // Client filter
    if (clientFilter && String(a.client_name || '') !== clientFilter) return false;

    // Date range filter
    if (dateFrom || dateTo) {
      var sofDate = a.sof_date ? new Date(a.sof_date) : null;
      if (sofDate) {
        if (dateFrom) {
          var fromD = new Date(dateFrom + 'T00:00:00');
          if (sofDate < fromD) return false;
        }
        if (dateTo) {
          var toD = new Date(dateTo + 'T23:59:59');
          if (sofDate > toD) return false;
        }
      }
    }

    // Search filter
    if (search) {
      var sofNo = String(a.sof_no || '').toLowerCase();
      var client = String(a.client_name || '').toLowerCase();
      var project = String(a.project_name || '').toLowerCase();
      var joNo = String(a.jo_no || '').toLowerCase();
      if (sofNo.indexOf(search) === -1 &&
          client.indexOf(search) === -1 &&
          project.indexOf(search) === -1 &&
          joNo.indexOf(search) === -1) return false;
    }

    return true;
  });

  _sofTracker.currentPage = 1;
  sofTrackerRender();
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function sofTrackerRender() {
  var tbody = document.getElementById('sofTableBody');
  if (!tbody) return;

  var total = _sofTracker.filteredAllocations.length;
  var start = (_sofTracker.currentPage - 1) * _sofTracker.pageSize;
  var end = Math.min(start + _sofTracker.pageSize, total);
  var pageItems = _sofTracker.filteredAllocations.slice(start, end);

  // Update pagination
  var el;
  el = document.getElementById('sofTableCount'); if (el) el.textContent = total + ' items';
  el = document.getElementById('sofPageTotal'); if (el) el.textContent = total;
  el = document.getElementById('sofPageStart'); if (el) el.textContent = total > 0 ? start + 1 : 0;
  el = document.getElementById('sofPageEnd'); if (el) el.textContent = end;
  el = document.getElementById('sofPageLabel'); if (el) el.textContent = 'Page ' + _sofTracker.currentPage;
  el = document.getElementById('sofBtnPrev'); if (el) el.disabled = (_sofTracker.currentPage <= 1);
  el = document.getElementById('sofBtnNext'); if (el) el.disabled = (end >= total);

  // Update subtitle
  var subtitleEl = document.getElementById('sofTableSubtitle');
  if (subtitleEl) {
    var hasFilter = document.getElementById('sofSearchInput').value ||
                    document.getElementById('sofStatusFilter').value ||
                    document.getElementById('sofClientFilter').value ||
                    document.getElementById('sofDateFrom').value ||
                    document.getElementById('sofDateTo').value;
    subtitleEl.textContent = hasFilter ? 'Filtered results' : 'All SOFs';
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No SOF allocations found.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(a) {
    var status = String(a.status || 'ACTIVE').toUpperCase();
    var dateStr = a.sof_date ? new Date(a.sof_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var allocated = Number(a.total_allocated_qty || 0);
    var used = Number(a.total_used_qty || 0);
    var remaining = Number(a.total_remaining_qty || 0);

    // Progress %
    var progressPct = allocated > 0 ? Math.round((used / allocated) * 100) : 0;
    var progressClass = progressPct >= 100 ? '' : (progressPct > 0 ? 'partial' : 'empty');

    var safeSof = String(a.sof_no || '').replace(/'/g, "\\'");
    var safeId = a.id;

    html += '<tr>' +
      '<td><code style="font-weight:700;color:#1e3a5f;">' + sofTrackerEsc(a.sof_no) + '</code></td>' +
      '<td>' + sofTrackerEsc(sofTrackerTruncate(a.client_name || '—', 25)) + '</td>' +
      '<td>' + sofTrackerEsc(sofTrackerTruncate(a.project_name || '—', 20)) + '</td>' +
      '<td>' + sofTrackerEsc(a.jo_no || '—') + '</td>' +
      '<td>' + sofTrackerEsc(dateStr) + '</td>' +
      '<td class="text-center">' + (a.total_items || 0) + '</td>' +
      '<td class="text-end fw-bold">' + sofTrackerNum(allocated) + '</td>' +
      '<td class="text-end text-success fw-bold">' + sofTrackerNum(used) + '</td>' +
      '<td class="text-end text-danger fw-bold">' + sofTrackerNum(remaining) + '</td>' +
      '<td class="text-center">' +
        '<div class="sof-progress">' +
          '<div class="sof-progress-bar ' + progressClass + '" style="width:' + progressPct + '%"></div>' +
        '</div>' +
        '<div class="sof-progress-label">' + progressPct + '%</div>' +
      '</td>' +
      '<td class="text-center"><span class="sof-status-' + status + '">' + status + '</span></td>' +
      '<td class="text-center">' +
        '<button class="sof-action-btn primary" onclick="sofTrackerViewItems(' + safeId + ', \'' + safeSof + '\')" title="View Items">' +
          '<i class="bi bi-list-ul"></i>' +
        '</button>' +
        '<button class="sof-action-btn" onclick="sofTrackerViewHistory(' + safeId + ', \'' + safeSof + '\')" title="View History">' +
          '<i class="bi bi-clock-history"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// VIEW ITEMS MODAL
// ═══════════════════════════════════════════════════════════
async function sofTrackerViewItems(sofId, sofNo) {
  _sofTracker.currentSof = { id: sofId, sof_no: sofNo };

  var modalEl = document.getElementById('sofItemsModal');
  var titleEl = document.getElementById('sofItemsTitle');
  var bodyEl = document.getElementById('sofItemsBody');

  if (titleEl) titleEl.textContent = 'SOF Items: ' + sofNo;
  if (bodyEl) {
    bodyEl.innerHTML = '<div class="text-center py-4"><div class="erp-spinner" style="margin:0 auto;"></div></div>';
  }

  if (!_sofTracker.itemsModal) {
    _sofTracker.itemsModal = new bootstrap.Modal(modalEl);
  }
  _sofTracker.itemsModal.show();

  try {
    var res = await fetch(erpUrl('rpc/erp_sof_get_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_sof_no: sofNo })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    var data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.error) || 'Failed to load items');
    }

    var sof = data.sof || {};
    var items = data.items || [];

    var html = '';

    // SOF Header Info
    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>SOF No:</strong> <code>' + sofTrackerEsc(sof.sof_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Status:</strong> <span class="sof-status-' + String(sof.status || '').toUpperCase() + '">' + sofTrackerEsc(sof.status) + '</span></div>';
    html += '<div class="col-md-6"><strong>Client:</strong> ' + sofTrackerEsc(sof.client_name || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Project:</strong> ' + sofTrackerEsc(sof.project_name || '—') + '</div>';
    html += '<div class="col-md-6"><strong>JO No:</strong> ' + sofTrackerEsc(sof.jo_no || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Date:</strong> ' + (sof.sof_date ? new Date(sof.sof_date).toLocaleDateString() : '—') + '</div>';
    html += '</div>';

    // Summary
    html += '<div class="alert alert-info small py-2">' +
      '<strong>Items:</strong> ' + (sof.total_items || 0) + ' · ' +
      '<strong>Allocated:</strong> ' + sofTrackerNum(sof.total_allocated_qty || 0) + ' · ' +
      '<strong class="text-success">Used:</strong> ' + sofTrackerNum(sof.total_used_qty || 0) + ' · ' +
      '<strong class="text-danger">Remaining:</strong> ' + sofTrackerNum((sof.total_allocated_qty || 0) - (sof.total_used_qty || 0)) +
      '</div>';

    // Items Table
    html += '<div class="table-responsive">';
    html += '<table class="erp-table" style="font-size:0.85rem;">';
    html += '<thead><tr>' +
      '<th style="width:4%">#</th>' +
      '<th style="width:15%">Item Code</th>' +
      '<th style="width:30%">Description</th>' +
      '<th style="width:10%" class="text-end">Allocated</th>' +
      '<th style="width:10%" class="text-end">Used</th>' +
      '<th style="width:10%" class="text-end">Remaining</th>' +
      '<th style="width:8%" class="text-center">Unit</th>' +
      '<th style="width:13%" class="text-center">Status</th>' +
      '</tr></thead><tbody>';

    if (items.length === 0) {
      html += '<tr><td colspan="8" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        var itemStatus = String(it.status || 'OPEN').toUpperCase();
        var statusClass = 'bg-secondary';
        if (itemStatus === 'OPEN') statusClass = 'bg-info text-dark';
        else if (itemStatus === 'PARTIAL') statusClass = 'bg-warning text-dark';
        else if (itemStatus === 'CLOSED') statusClass = 'bg-success';
        else if (itemStatus === 'CANCELLED') statusClass = 'bg-danger';

        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + sofTrackerEsc(it.item_code) + '</code></td>' +
          '<td>' + sofTrackerEsc(it.description || '—') + '</td>' +
          '<td class="text-end fw-bold">' + sofTrackerNum(it.allocated_qty) + '</td>' +
          '<td class="text-end text-success fw-bold">' + sofTrackerNum(it.used_qty) + '</td>' +
          '<td class="text-end text-danger fw-bold">' + sofTrackerNum(it.remaining_qty) + '</td>' +
          '<td class="text-center">' + sofTrackerEsc(it.unit || '—') + '</td>' +
          '<td class="text-center"><span class="badge ' + statusClass + '">' + itemStatus + '</span></td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';

    if (bodyEl) bodyEl.innerHTML = html;
  } catch(err) {
    console.error('[sofTrackerViewItems]', err);
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="alert alert-danger">Failed to load: ' + sofTrackerEsc(err.message) + '</div>';
    }
  }
}

window.sofTrackerViewItems = sofTrackerViewItems;

// ═══════════════════════════════════════════════════════════
// VIEW HISTORY MODAL
// ═══════════════════════════════════════════════════════════
async function sofTrackerViewHistory(sofId, sofNo) {
  var modalEl = document.getElementById('sofHistoryModal');
  var titleEl = document.getElementById('sofHistoryTitle');
  var bodyEl = document.getElementById('sofHistoryBody');

  if (titleEl) titleEl.textContent = 'History: ' + sofNo;
  if (bodyEl) {
    bodyEl.innerHTML = '<div class="text-center py-4"><div class="erp-spinner" style="margin:0 auto;"></div></div>';
  }

  if (!_sofTracker.historyModal) {
    _sofTracker.historyModal = new bootstrap.Modal(modalEl);
  }
  _sofTracker.historyModal.show();

  try {
    var res = await fetch(erpUrl('rpc/erp_sof_get_history'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_sof_no: sofNo, p_limit: 200 })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    var data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.error) || 'Failed to load history');
    }

    var history = data.history || [];

    if (history.length === 0) {
      bodyEl.innerHTML = '<div class="text-center py-4 text-muted">' +
        '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
        'No history entries.</div>';
      return;
    }

    var html = '<div style="padding:8px 0;">';

    history.forEach(function(h) {
      var ts = h.created_at ? new Date(h.created_at) : null;
      var tsStr = ts ? ts.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }) : '—';

      var actionLabel = String(h.action || '').replace(/_/g, ' ');

      html += '<div class="sof-history-item history-' + sofTrackerEsc(h.action) + '">';
      html += '<div class="d-flex justify-content-between align-items-start gap-2 mb-1">';
      html += '<div>';
      html += '<strong style="color:#0f172a;">' + sofTrackerEsc(actionLabel) + '</strong>';
      if (h.item_code) {
        html += ' <code style="font-size:0.78rem;">' + sofTrackerEsc(h.item_code) + '</code>';
      }
      html += '</div>';
      html += '<small class="text-muted">' + sofTrackerEsc(tsStr) + '</small>';
      html += '</div>';

      if (h.old_value || h.new_value) {
        html += '<div class="small">';
        if (h.old_value) html += '<span class="text-muted">From: </span><code>' + sofTrackerEsc(h.old_value) + '</code> ';
        if (h.new_value) html += '<span class="text-muted">→</span> <code>' + sofTrackerEsc(h.new_value) + '</code>';
        if (h.delta) html += ' <span class="badge bg-light text-dark">Δ ' + sofTrackerNum(h.delta) + '</span>';
        html += '</div>';
      }

      if (h.reference_doc) {
        html += '<div class="small text-muted mt-1">' +
          '<i class="bi bi-link-45deg me-1"></i>' +
          'Ref: <code>' + sofTrackerEsc(h.reference_doc) + '</code>' +
          (h.reference_type ? ' (' + sofTrackerEsc(h.reference_type) + ')' : '') +
          '</div>';
      }

      if (h.reason) {
        html += '<div class="small mt-1" style="color:#475569;">' +
          '<i class="bi bi-chat-left-text me-1"></i>' + sofTrackerEsc(h.reason) + '</div>';
      }

      if (h.performed_by_fullname || h.performed_by) {
        html += '<div class="small text-muted mt-1">' +
          '<i class="bi bi-person me-1"></i>' +
          sofTrackerEsc(h.performed_by_fullname || h.performed_by) + '</div>';
      }

      html += '</div>';
    });

    html += '</div>';
    bodyEl.innerHTML = html;

  } catch(err) {
    console.error('[sofTrackerViewHistory]', err);
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="alert alert-danger m-3">Failed: ' + sofTrackerEsc(err.message) + '</div>';
    }
  }
}

window.sofTrackerViewHistory = sofTrackerViewHistory;

// ═══════════════════════════════════════════════════════════
// POPULATE CLIENT FILTER
// ═══════════════════════════════════════════════════════════
async function sofTrackerPopulateFilters() {
  try {
    var res = await fetch(erpUrl('rpc/erp_sof_get_tracker_list'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_limit: 500 })
    });

    if (!res.ok) return;

    var data = await res.json();
    var allocations = (data && data.allocations) ? data.allocations : [];

    var seen = {};
    var clients = [];
    allocations.forEach(function(a) {
      var v = String(a.client_name || '').trim();
      if (v && !seen[v]) {
        seen[v] = true;
        clients.push(v);
      }
    });

    var sel = document.getElementById('sofClientFilter');
    if (!sel) return;

    clients.sort().forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });

    console.log('[SOF Tracker] Loaded ' + clients.length + ' clients for filter');
  } catch(e) {
    console.warn('[SOF Tracker] Filter populate failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
function sofTrackerOnSearch() {
  clearTimeout(_sofTracker.searchTimer);
  _sofTracker.searchTimer = setTimeout(function() {
    _sofTracker.currentPage = 1;
    sofTrackerApplyFilters();
  }, 300);
}

window.sofTrackerOnSearch = sofTrackerOnSearch;

// ═══════════════════════════════════════════════════════════
// PAGINATION
// ═══════════════════════════════════════════════════════════
function sofTrackerPagePrev() {
  if (_sofTracker.currentPage > 1) {
    _sofTracker.currentPage--;
    sofTrackerRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function sofTrackerPageNext() {
  var maxPage = Math.ceil(_sofTracker.filteredAllocations.length / _sofTracker.pageSize);
  if (_sofTracker.currentPage < maxPage) {
    _sofTracker.currentPage++;
    sofTrackerRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

window.sofTrackerPagePrev = sofTrackerPagePrev;
window.sofTrackerPageNext = sofTrackerPageNext;

// ═══════════════════════════════════════════════════════════
// CLEAR FILTERS
// ═══════════════════════════════════════════════════════════
function sofTrackerClearFilters() {
  var s = document.getElementById('sofSearchInput');
  var st = document.getElementById('sofStatusFilter');
  var c = document.getElementById('sofClientFilter');
  var df = document.getElementById('sofDateFrom');
  var dt = document.getElementById('sofDateTo');
  if (s) s.value = '';
  if (st) st.value = '';
  if (c) c.value = '';
  if (df) df.value = '';
  if (dt) dt.value = '';
  _sofTracker.currentPage = 1;
  sofTrackerLoad();
}

window.sofTrackerClearFilters = sofTrackerClearFilters;

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function sofTrackerRefresh() {
  erpShowToast('Refreshing...', 'info');
  sofTrackerLoad();
  sofTrackerCheckHealth();
}

window.sofTrackerRefresh = sofTrackerRefresh;

// ═══════════════════════════════════════════════════════════
// PRINT CURRENT SOF (placeholder)
// ═══════════════════════════════════════════════════════════
function sofTrackerPrintCurrent() {
  if (!_sofTracker.currentSof) {
    erpShowToast('No SOF selected', 'warning');
    return;
  }
  erpShowToast('Print feature coming soon', 'info');
  // TODO: Implement print in future update
}

window.sofTrackerPrintCurrent = sofTrackerPrintCurrent;

// ═══════════════════════════════════════════════════════════
// CREATE NEW SOF (placeholder — Part 5 or 6)
// ═══════════════════════════════════════════════════════════
function sofTrackerCreateNew() {
  erpShowToast('Create SOF feature coming soon', 'info');
  // TODO: Implement create SOF modal in future update
}

window.sofTrackerCreateNew = sofTrackerCreateNew;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function sofTrackerNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function sofTrackerTruncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function sofTrackerEsc(s) {
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

console.log('✅ sof-tracker.js v1.0 loaded');
