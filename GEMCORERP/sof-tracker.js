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
        var res = await fetch(erpUrl('rpc/erp_sof_get_tracker_list_v2'), { // <--- Ito ang pinalitan
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_limit: 500 })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    _sofTracker.allAllocations = (data && data.allocations) ? data.allocations : [];
    await sofTrackerEnrich(_sofTracker.allAllocations);
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
// ENRICH — punan ang Project / JO No. / Client na blangko
// Source order: allocation mismo → erp_sof_cache → MRIF documents
// ═══════════════════════════════════════════════════════════
async function sofTrackerEnrich(list) {
  try {
    var missing = list.filter(function(a) {
      return a.sof_no && (!a.project_name || !a.jo_no || !a.client_name);
    }).map(function(a) { return String(a.sof_no); });
    if (missing.length === 0) return;

    var cacheBySof = {}, mrifBySof = {};
    for (var i = 0; i < missing.length; i += 40) {
      var chunk = missing.slice(i, i + 40);
      var inList = '(' + chunk.map(function(x) { return '"' + x.replace(/"/g, '') + '"'; }).join(',') + ')';
      try {
        var cache = await erpFetch('erp_sof_cache', 'select=sof_no,jo_no,client_name,project_name&sof_no=in.' + encodeURIComponent(inList));
        (cache || []).forEach(function(r) { if (!cacheBySof[r.sof_no]) cacheBySof[r.sof_no] = r; });
      } catch(e) { console.warn('[SOF enrich] cache', e.message); }
      try {
        var docs = await erpFetch('documents', 'select=sof_no,jo_no,client_name,project&doc_type=eq.MRIF&order=created_at.desc&sof_no=in.' + encodeURIComponent(inList));
        (docs || []).forEach(function(r) { if (!mrifBySof[r.sof_no]) mrifBySof[r.sof_no] = r; });
      } catch(e) { console.warn('[SOF enrich] docs', e.message); }
    }

    list.forEach(function(a) {
      var c = cacheBySof[a.sof_no] || {};
      var m = mrifBySof[a.sof_no] || {};
      if (!a.client_name)  a.client_name  = c.client_name  || m.client_name || '';
      if (!a.project_name) a.project_name = c.project_name || m.project     || '';
      if (!a.jo_no)        a.jo_no        = c.jo_no        || m.jo_no       || '';
    });
  } catch(err) {
    console.warn('[sofTrackerEnrich]', err);
  }
}


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
            '<th class="text-center">Action</th>' +
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
        '<td class="text-center">' + (remaining > 0
          ? '<button class="btn btn-sm btn-outline-danger" title="Ibalik sa free on-hand" onclick="sofReleaseItem(\'' + sofTrackerEsc(sofNo).replace(/'/g, "\\'") + '\',\'' + sofTrackerEsc(it.item_code).replace(/'/g, "\\'") + '\',' + remaining + ')"><i class="bi bi-unlock me-1"></i>Release</button>'
          : '') + '</td>' +
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

// ═══════════════════════════════════════════════════════════
// v2.1 — MANUAL ALLOCATE (walang MRR) + RELEASE (ibalik sa free on-hand)
// Needs sof-manual.sql
// ═══════════════════════════════════════════════════════════
var _sofManual = { items: [], timer: null };

async function sofRpc(name, body) {
  var res = await fetch(erpUrl('rpc/' + name), { method: 'POST', headers: erpHeaders(), body: JSON.stringify(body) });
  var text = await res.text(), data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) throw new Error((data && (data.message || data.error)) || text || ('HTTP ' + res.status));
  return data;
}
function sofUser() { return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE'; }

window.sofOpenManual = function() {
  _sofManual.items = [];
  var old = document.getElementById('sofManualModal'); if (old) old.remove();
  var w = document.createElement('div');
  w.innerHTML =
  '<div class="modal fade" id="sofManualModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
    '<div class="modal-header" style="background:#1e3a5f;color:#fff;"><h5 class="modal-title"><i class="bi bi-plus-circle me-2"></i>Manual SOF Allocation</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
    '<div class="modal-body">' +
      '<div class="alert alert-info py-2 small mb-3">Magre-reserve ito ng stock para sa SOF kahit walang MRR. Hindi nito ginagalaw ang on-hand — nababawasan lang ang <b>Available</b>. Kung may existing na SOF#, idadagdag sa allocation niya.</div>' +
      '<div class="row g-2 mb-3">' +
        '<div class="col-md-4"><label class="form-label small fw-bold">SOF No. *</label><input id="smSof" class="form-control" list="smSofList" placeholder="e.g. SOF-2610-001"><datalist id="smSofList"></datalist></div>' +
        '<div class="col-md-4"><label class="form-label small fw-bold">Client</label><input id="smClient" class="form-control" placeholder="optional"></div>' +
        '<div class="col-md-4"><label class="form-label small fw-bold">Project / JO No.</label><input id="smProject" class="form-control" placeholder="optional"></div>' +
      '</div>' +
      '<label class="form-label small fw-bold">Add item</label>' +
      '<input id="smSearch" class="form-control" placeholder="Item code o description…" oninput="sofManualSearch()" autocomplete="off">' +
      '<div id="smResults" class="list-group mb-3" style="max-height:220px;overflow:auto;"></div>' +
      '<table class="table table-sm align-middle"><thead><tr><th>Item</th><th class="text-end">On-hand</th><th class="text-end">Free</th><th style="width:120px">Qty to allocate</th><th></th></tr></thead><tbody id="smRows"><tr><td colspan="5" class="text-muted text-center py-3">Wala pang item.</td></tr></tbody></table>' +
      '<label class="form-label small fw-bold">Reason *</label><textarea id="smReason" class="form-control" rows="2" placeholder="e.g. Pre-reserve para sa SOF, walang MRR pa"></textarea>' +
    '</div>' +
    '<div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="smSubmit" onclick="sofManualSubmit()"><i class="bi bi-check2-circle me-1"></i>Allocate</button></div>' +
  '</div></div></div>';
  document.body.appendChild(w.firstChild);
  var dl = document.getElementById('smSofList');
  dl.innerHTML = (_sofTracker.allAllocations || []).map(function(a) { return '<option value="' + sofTrackerEsc(a.sof_no) + '">'; }).join('');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('sofManualModal')).show();
};

window.sofManualSearch = function() {
  clearTimeout(_sofManual.timer);
  _sofManual.timer = setTimeout(async function() {
    var term = document.getElementById('smSearch').value.trim().replace(/[*,()]/g, ' ').trim();
    var box = document.getElementById('smResults');
    if (term.length < 2) { box.innerHTML = ''; return; }
    try {
      var t = encodeURIComponent(term);
      var rows = await erpFetch('erp_items', 'select=item_code,description,base_unit,on_hand&is_deleted=eq.false&is_active=eq.true' +
        '&or=(item_code.ilike.*' + t + '*,description.ilike.*' + t + '*)&order=item_code.asc&limit=20') || [];
      if (!rows.length) { box.innerHTML = '<div class="list-group-item text-muted small">No match</div>'; return; }
      var codes = rows.map(function(r) { return r.item_code; });
      var resv = {};
      var al = await erpFetch('erp_sof_allocation_items', 'select=item_code,allocated_qty,used_qty&item_code=in.(' + encodeURIComponent(codes.join(',')) + ')') || [];
      al.forEach(function(a) { var rem = Number(a.allocated_qty || 0) - Number(a.used_qty || 0); if (rem > 0) resv[a.item_code] = (resv[a.item_code] || 0) + rem; });
      rows.forEach(function(r) { r.free = Number(r.on_hand || 0) - (resv[r.item_code] || 0); r.reserved = resv[r.item_code] || 0; });
      window._smFound = rows;
      box.innerHTML = rows.map(function(r, i) {
        return '<button type="button" class="list-group-item list-group-item-action py-1" onclick="sofManualPick(' + i + ')">' +
          '<code>' + sofTrackerEsc(r.item_code) + '</code> <span class="small">' + sofTrackerEsc((r.description || '').substring(0, 70)) + '</span>' +
          '<span class="float-end small">on-hand <b>' + sofTrackerNum(r.on_hand) + '</b> · free <b class="' + (r.free > 0 ? 'text-success' : 'text-danger') + '">' + sofTrackerNum(r.free) + '</b></span></button>';
      }).join('');
    } catch (e) { box.innerHTML = '<div class="list-group-item text-danger small">' + sofTrackerEsc(e.message) + '</div>'; }
  }, 200);
};

window.sofManualPick = function(i) {
  var r = (window._smFound || [])[i]; if (!r) return;
  if (!_sofManual.items.some(function(x) { return x.item_code === r.item_code; })) _sofManual.items.push({ item_code: r.item_code, description: r.description, on_hand: r.on_hand, free: r.free, qty: '' });
  document.getElementById('smSearch').value = ''; document.getElementById('smResults').innerHTML = '';
  sofManualRenderRows();
};

function sofManualRenderRows() {
  var tb = document.getElementById('smRows');
  if (!_sofManual.items.length) { tb.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-3">Wala pang item.</td></tr>'; return; }
  tb.innerHTML = _sofManual.items.map(function(x, i) {
    return '<tr><td><code>' + sofTrackerEsc(x.item_code) + '</code><div class="small text-muted">' + sofTrackerEsc((x.description || '').substring(0, 60)) + '</div></td>' +
      '<td class="text-end">' + sofTrackerNum(x.on_hand) + '</td>' +
      '<td class="text-end ' + (x.free > 0 ? 'text-success' : 'text-danger') + ' fw-bold">' + sofTrackerNum(x.free) + '</td>' +
      '<td><input type="number" min="0" step="any" class="form-control form-control-sm" value="' + sofTrackerEsc(x.qty) + '" oninput="_sofManual.items[' + i + '].qty=this.value"></td>' +
      '<td><button class="btn btn-sm btn-link text-danger" onclick="_sofManual.items.splice(' + i + ',1);sofManualRenderRows()"><i class="bi bi-x-lg"></i></button></td></tr>';
  }).join('');
}
window.sofManualRenderRows = sofManualRenderRows;

window.sofManualSubmit = async function() {
  var sof = document.getElementById('smSof').value.trim();
  var reason = document.getElementById('smReason').value.trim();
  var items = _sofManual.items.filter(function(x) { return Number(x.qty) > 0; }).map(function(x) { return { item_code: x.item_code, qty: Number(x.qty) }; });
  if (!sof) return erpShowToast('SOF No. is required', 'warning');
  if (!items.length) return erpShowToast('Maglagay ng qty sa kahit isang item', 'warning');
  if (!reason) return erpShowToast('Reason is required', 'warning');
  if (!confirm('Allocate ' + items.length + ' item(s) to ' + sof + '?')) return;
  var btn = document.getElementById('smSubmit'); btn.disabled = true;
  try {
    var r = await sofRpc('erp_sof_manual_allocate', {
      p_sof_no: sof, p_items: items, p_user: sofUser(), p_reason: reason,
      p_header: { client_name: document.getElementById('smClient').value.trim(), project_name: document.getElementById('smProject').value.trim() }
    });
    if (!r || !r.success) {
      var d = (r && r.details || []).map(function(x) { return x.item_code + ': ' + x.error; }).join('\n');
      alert((r && r.error || 'Failed') + (d ? '\n\n' + d : ''));
      return;
    }
    erpShowToast('✅ Allocated ' + r.items + ' item(s) to ' + r.sof_no, 'success');
    bootstrap.Modal.getInstance(document.getElementById('sofManualModal')).hide();
    sofTrackerLoad();
  } catch (e) {
    erpShowToast('Failed: ' + e.message + ' (na-run mo na ba ang sof-manual.sql?)', 'danger');
  } finally { btn.disabled = false; }
};

window.sofReleaseItem = async function(sofNo, itemCode, remaining) {
  var q = prompt('Release ilang qty ng ' + itemCode + ' mula sa ' + sofNo + '?\n(Remaining: ' + remaining + ')\n\nMababawasan ang reservation at babalik sa free on-hand.', remaining);
  if (q === null) return;
  var qty = Number(q);
  if (!(qty > 0) || qty > remaining) return erpShowToast('Invalid qty (1 hanggang ' + remaining + ')', 'warning');
  var reason = prompt('Reason sa pag-release? (required)');
  if (!reason || !reason.trim()) return erpShowToast('Reason is required', 'warning');
  try {
    var r = await sofRpc('erp_sof_release', { p_sof_no: sofNo, p_item_code: itemCode, p_qty: qty, p_user: sofUser(), p_reason: reason.trim() });
    if (!r || !r.success) return erpShowToast((r && r.error) || 'Failed', 'danger');
    erpShowToast('✅ Released ' + r.released + ' — pwede nang gamitin ng kahit anong MRIF', 'success');
    var m = document.getElementById('sofItemsModal'); if (m) { bootstrap.Modal.getInstance(m).hide(); }
    sofTrackerLoad();
    setTimeout(function() { sofViewItems(sofNo); }, 400);
  } catch (e) {
    erpShowToast('Failed: ' + e.message + ' (na-run mo na ba ang sof-manual.sql?)', 'danger');
  }
};
