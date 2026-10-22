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
          '<td><a href="javascript:void(0)" style="font-weight:700;color:#1e3a5f;text-decoration:underline;cursor:pointer;" onclick="sofViewItems(\'' + sofTrackerEsc(a.sof_no) + '\')">' + sofTrackerEsc(a.sof_no) + '</a></td>' +
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

// ═══════════════════════════════════════════════════════════
// ✅ BAGONG FUNCTION: View Items ng isang SOF
// ═══════════════════════════════════════════════════════════
window.sofViewItems = async function(sofNo) {
  console.log('[SOF Tracker] Fetching items for SOF:', sofNo);
  
  // Gumawa tayo ng modal container kung wala pa
  var modalId = 'sofItemsModal';
  var existing = document.getElementById(modalId);
  if (existing) existing.remove();
  
  var wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="modal fade" id="' + modalId + '" tabindex="-1">' +
    '<div class="modal-dialog modal-xl modal-dialog-scrollable">' +
      '<div class="modal-content">' +
        '<div class="modal-header" style="background:#1e3a5f;color:#fff;">' +
          '<h5 class="modal-title"><i class="bi bi-list-check me-2"></i>SOF Allocation Details — ' + sofTrackerEsc(sofNo) + '</h5>' +
          '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
        '</div>' +
        '<div class="modal-body p-0" id="sofItemsModalBody">' +
          '<div class="text-center py-5"><div class="erp-spinner" style="margin:0 auto;"></div><div class="mt-2 text-muted">Loading items...</div></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
  document.body.appendChild(wrapper.firstChild);

  var modal = new bootstrap.Modal(document.getElementById(modalId));
  modal.show();

  try {
    // Fetch items from database
    var items = await erpFetch('erp_sof_allocation_items', 'select=*&sof_no=eq.' + encodeURIComponent(sofNo) + '&order=item_code.asc');
    
    var bodyEl = document.getElementById('sofItemsModalBody');
    
    if (!items || items.length === 0) {
      bodyEl.innerHTML = '<div class="text-center py-5 text-muted">Walang items na naka-allocate sa SOF na ito.</div>';
      return;
    }

    var html = '<div class="table-responsive">' +
      '<table class="erp-table" style="font-size:0.85rem;">' +
        '<thead>' +
          '<tr>' +
            '<th>#</th>' +
            '<th>Item Code</th>' +
            '<th>Description</th>' +
            '<th class="text-center">Unit</th>' +
            '<th class="text-end">Allocated Qty</th>' +
            '<th class="text-end">Used Qty</th>' +
            '<th class="text-end">Remaining Qty</th>' +
            '<th class="text-center">Status</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>';

    items.forEach(function(it, idx) {
      var alloc = Number(it.allocated_qty || 0);
      var used = Number(it.used_qty || 0);
      var remaining = alloc - used;
      
      var statusBadge = '';
      if (remaining === 0) statusBadge = '<span class="badge bg-success">FULLY USED</span>';
      else if (used > 0) statusBadge = '<span class="badge bg-warning text-dark">PARTIAL</span>';
      else statusBadge = '<span class="badge bg-primary">ACTIVE</span>';

      html += '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><code>' + sofTrackerEsc(it.item_code) + '</code></td>' +
        '<td>' + sofTrackerEsc(it.description || '—') + '</td>' +
        '<td class="text-center">' + sofTrackerEsc(it.unit || '—') + '</td>' +
        '<td class="text-end fw-bold">' + sofTrackerNum(alloc) + '</td>' +
        '<td class="text-end text-success fw-bold">' + sofTrackerNum(used) + '</td>' +
        '<td class="text-end text-danger fw-bold">' + sofTrackerNum(remaining) + '</td>' +
        '<td class="text-center">' + statusBadge + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    bodyEl.innerHTML = html;

  } catch(err) {
    console.error('[sofViewItems]', err);
    document.getElementById('sofItemsModalBody').innerHTML = 
      '<div class="alert alert-danger m-3">Failed to load items: ' + sofTrackerEsc(err.message) + '</div>';
  }
};
