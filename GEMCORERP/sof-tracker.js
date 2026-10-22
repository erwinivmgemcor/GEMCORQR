// ============================================================
// GEMCOR ERP — SOF Tracker (v2.0)
// Reads from: erp_sof_allocations + erp_sof_allocation_items
// Uses RPC: erp_sof_get_tracker_list
// No writes — pure display
// ============================================================

var _sofTracker = {
  allAllocations: [],
  filteredAllocations: [],
  searchTimer: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[SOF Tracker v2.0] Initializing...');
  sofTrackerCheckHealth();
  sofTrackerLoad();
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
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function sofTrackerLoad() {
  var tbody = document.getElementById('sofTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading SOF allocations...</div></td></tr>';
  }

  try {
    var t0 = Date.now();
    var res = await fetch(erpUrl('rpc/erp_sof_get_tracker_list'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_limit: 500 })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    _sofTracker.allAllocations = (data && data.allocations) ? data.allocations : [];
    console.log('[SOF Tracker] Loaded ' + _sofTracker.allAllocations.length + ' allocations in ' + (Date.now() - t0) + 'ms');

    sofTrackerComputeKPIs();
    sofTrackerApplyFilters();
  } catch(err) {
    console.error('[sofTrackerLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="10" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

window.sofTrackerLoad = sofTrackerLoad;

// ═══════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════
function sofTrackerComputeKPIs() {
  var total = _sofTracker.allAllocations.length;
  var active = 0, cancelled = 0;
  var totalRemaining = 0;

  _sofTracker.allAllocations.forEach(function(a) {
    var status = String(a.status || '').toUpperCase();
    if (status === 'ACTIVE') active++;
    else if (status === 'CANCELLED') cancelled++;
    totalRemaining += Number(a.total_remaining_qty || 0);
  });

  var el;
  el = document.getElementById('sofKpiTotal'); if (el) el.textContent = sofTrackerNum(total);
  el = document.getElementById('sofKpiActive'); if (el) el.textContent = sofTrackerNum(active);
  el = document.getElementById('sofKpiCancelled'); if (el) el.textContent = sofTrackerNum(cancelled);
  el = document.getElementById('sofKpiRemaining'); if (el) el.textContent = sofTrackerNum(totalRemaining);
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function sofTrackerApplyFilters() {
  var search = (document.getElementById('sofSearchInput').value || '').toLowerCase().trim();
  var statusFilter = (document.getElementById('sofStatusFilter').value || '').toUpperCase();

  _sofTracker.filteredAllocations = _sofTracker.allAllocations.filter(function(a) {
    if (statusFilter && String(a.status || '').toUpperCase() !== statusFilter) return false;

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

  sofTrackerRender();
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function sofTrackerRender() {
  var tbody = document.getElementById('sofTableBody');
  if (!tbody) return;

  var total = _sofTracker.filteredAllocations.length;
  
  var elCount = document.getElementById('sofTableCount');
  if (elCount) elCount.textContent = total + ' items';

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No SOF allocations found.</td></tr>';
    return;
  }

  var html = '';
  _sofTracker.filteredAllocations.forEach(function(a) {
    var status = String(a.status || 'ACTIVE').toUpperCase();
    var dateStr = a.sof_date ? new Date(a.sof_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var allocated = Number(a.total_allocated_qty || 0);
    var used = Number(a.total_used_qty || 0);
    var remaining = Number(a.total_remaining_qty || 0);

    var statusClass = 'bg-secondary';
    if (status === 'ACTIVE') statusClass = 'bg-primary';
    else if (status === 'COMPLETED') statusClass = 'bg-success';
    else if (status === 'CANCELLED') statusClass = 'bg-danger';

    html += '<tr>' +
      '<td><code style="font-weight:700;color:#1e3a5f;">' + sofTrackerEsc(a.sof_no) + '</code></td>' +
      '<td>' + sofTrackerEsc(a.client_name || '—') + '</td>' +
      '<td>' + sofTrackerEsc(a.project_name || '—') + '</td>' +
      '<td>' + sofTrackerEsc(a.jo_no || '—') + '</td>' +
      '<td>' + sofTrackerEsc(dateStr) + '</td>' +
      '<td class="text-center">' + (a.total_items || 0) + '</td>' +
      '<td class="text-end fw-bold">' + sofTrackerNum(allocated) + '</td>' +
      '<td class="text-end text-success fw-bold">' + sofTrackerNum(used) + '</td>' +
      '<td class="text-end text-danger fw-bold">' + sofTrackerNum(remaining) + '</td>' +
      '<td class="text-center"><span class="badge ' + statusClass + '">' + status + '</span></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function sofTrackerOnSearch() {
  clearTimeout(_sofTracker.searchTimer);
  _sofTracker.searchTimer = setTimeout(sofTrackerApplyFilters, 300);
}

function sofTrackerClearFilters() {
  document.getElementById('sofSearchInput').value = '';
  document.getElementById('sofStatusFilter').value = '';
  sofTrackerApplyFilters();
}

function sofTrackerRefresh() {
  erpShowToast('Refreshing...', 'info');
  sofTrackerLoad();
}

function sofTrackerNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function sofTrackerEsc(s) {
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

window.sofTrackerOnSearch = sofTrackerOnSearch;
window.sofTrackerClearFilters = sofTrackerClearFilters;
window.sofTrackerRefresh = sofTrackerRefresh;

console.log('✅ sof-tracker.js v2.0 loaded');
