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
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
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
    await sofTrackerMergeMissing(_sofTracker.allAllocations);
    await sofTrackerEnrich(_sofTracker.allAllocations);
    await sofTrackerLoadPending();
    console.log('[SOF Tracker] Loaded ' + _sofTracker.allAllocations.length + ' allocations in ' + (Date.now() - t0) + 'ms');

    sofTrackerComputeKPIs();
    sofUpdatePendingPill();
    sofTrackerApplyFilters();
  } catch(err) {
    console.error('[sofTrackerLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

window.sofTrackerLoad = sofTrackerLoad;

// ═══════════════════════════════════════════════════════════
// MERGE — SOF na may allocation items pero wala sa listahan ng RPC
// (hal. galing sa Import Allocated). Binabasa nang direkta ang erp_sof_allocation_items
// at erp_sof_allocations, para lumabas pa rin sila sa tracker kahit hindi sila ibinalik ng RPC.
// ═══════════════════════════════════════════════════════════
_sofTracker.headers = {};
async function sofTrackerMergeMissing(list) {
  _sofTracker.headers = {};
  try {
    var heads = await erpFetchAll('erp_sof_allocations', 'select=*&order=sof_no.asc') || [];
    heads.forEach(function(h) { var k = sofKey(h.sof_no); if (k) _sofTracker.headers[k] = h; });

    var items = await erpFetchAll('erp_sof_allocation_items', 'select=sof_no,item_code,allocated_qty,used_qty&order=sof_no.asc,item_code.asc') || [];
    var have = {};
    list.forEach(function(a) { have[sofKey(a.sof_no)] = true; });

    var agg = {};
    items.forEach(function(r) {
      var k = sofKey(r.sof_no); if (!k) return;
      var g = agg[k] || (agg[k] = { sof_no: String(r.sof_no).trim(), n: 0, alloc: 0, used: 0 });
      g.n++; g.alloc += Number(r.allocated_qty || 0); g.used += Number(r.used_qty || 0);
    });

    var added = 0;
    Object.keys(agg).forEach(function(k) {
      if (have[k]) return;
      var g = agg[k], h = _sofTracker.headers[k] || {};
      var rem = g.alloc - g.used;
      list.push({
        sof_no: g.sof_no,
        client_name: h.client_name || '',          // raw (vendor / supplier) — i-enrich mamaya
        project_name: h.project_name || '',
        jo_no: h.jo_no || '',
        sof_date: h.sof_date || h.created_at || null,
        status: h.status || (g.alloc > 0 && rem <= 0 ? 'COMPLETED' : 'ACTIVE'),
        total_items: g.n,
        total_allocated_qty: g.alloc,
        total_used_qty: g.used,
        total_remaining_qty: rem,
        _merged: true
      });
      added++;
    });
    if (added) console.log('[SOF Tracker] Idinagdag mula sa items table (wala sa RPC list): ' + added + ' SOF');
  } catch (e) { console.warn('[SOF Tracker] merge missing', e.message); }
}

// ═══════════════════════════════════════════════════════════
// ENRICH — Client / Project / JO No.
// CLIENT: na-edit na client (client_override) → erp_sof_cache → MRIF documents → blangko. HINDI na ginagamit ang client_name ng allocation,
//         dahil supplier ang laman nito (hal. Yu Eng Kao, Greenlight), hindi ang tunay na client.
// PROJECT / JO: erp_sof_cache → MRIF documents → (kung wala) ang nasa allocation.
// ═══════════════════════════════════════════════════════════
async function sofTrackerEnrich(list) {
  try {
    var missing = list.filter(function(a) { return a.sof_no; }).map(function(a) { return String(a.sof_no); });
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
      var hd = (_sofTracker.headers || {})[sofKey(a.sof_no)] || {};
      a.supplier_name = a.client_name || hd.client_name || '';                 // VENDOR / supplier (editable)
      a.client_name   = hd.client_override || c.client_name || m.client_name || '';   // CLIENT: na-edit → SOF cache → MRIF → blangko
      a.project_name  = c.project_name || m.project     || a.project_name || '';
      a.jo_no         = a.jo_no        || c.jo_no       || m.jo_no        || '';
    });
  } catch(err) {
    console.warn('[sofTrackerEnrich]', err);
  }
}


// ═══════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// PENDING MRIF — para malaman ng warehouse kung kanino ibibigay ang allocated na item
// (MRIF na PENDING / PARTIAL na may balanse pa, kapareho ng SOF No.)
// ═══════════════════════════════════════════════════════════
_sofTracker.pending = {};

function sofKey(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

async function sofTrackerLoadPending() {
  _sofTracker.pending = {};
  try {
    var docs = await erpFetchAll('documents',
      'select=doc_no,sof_no,status,requestor,department,jo_no,created_at&doc_type=eq.MRIF&status=in.(PENDING,PARTIAL)&sof_no=not.is.null&order=created_at.asc') || [];
    docs = docs.filter(function(d) { return sofKey(d.sof_no) !== ''; });
    var byDoc = {}; docs.forEach(function(d) { byDoc[d.doc_no] = d; });
    // Natitirang allocation kada SOF + item (wala nang remaining = wala nang ibibigay)
    var rem = {};
    (await erpFetchAll('erp_sof_allocation_items', 'select=sof_no,item_code,allocated_qty,used_qty&order=sof_no.asc') || []).forEach(function(r) {
      rem[sofKey(r.sof_no) + '|' + sofKey(r.item_code)] = Number(r.allocated_qty || 0) - Number(r.used_qty || 0);
    });
    var nos = Object.keys(byDoc);
    for (var i = 0; i < nos.length; i += 80) {
      var inList = '(' + nos.slice(i, i + 80).map(function(x) { return '"' + String(x).replace(/"/g, '') + '"'; }).join(',') + ')';
      var lines = await erpFetchAll('doc_items', 'select=doc_no,item_code,requested_qty,issued_qty&doc_no=in.' + encodeURIComponent(inList) + '&order=doc_no.asc,id.asc') || [];
      lines.forEach(function(l) {
        var need = Number(l.requested_qty || 0) - Number(l.issued_qty || 0);
        var d = byDoc[l.doc_no];
        if (!d || need <= 0.0001) return;                       // served na ang line → hindi ipapakita
        var sk = sofKey(d.sof_no), ik = sofKey(l.item_code);
        if (!(rem[sk + '|' + ik] > 0.0001)) return;             // walang natirang allocation para sa item na ito
        var P = _sofTracker.pending[sk] = _sofTracker.pending[sk] || { docs: {}, lines: {} };
        P.docs[d.doc_no] = d;
        (P.lines[ik] = P.lines[ik] || []).push({ doc_no: d.doc_no, requestor: d.requestor, department: d.department, jo_no: d.jo_no, created_at: d.created_at, status: d.status, need: need });
      });
    }
  } catch (e) { console.warn('[SOF Tracker] pending MRIF', e.message); }
}

// Warehouse / admin lang ang puwedeng mag-process
function sofCanProcess() {
  try { return localStorage.getItem('ivm_userRole') === 'warehouse' || localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; }
}
function sofMrifLink(docNo) {
  var esc = sofTrackerEsc(docNo);
  if (!sofCanProcess()) return '<code>' + esc + '</code>';
  return '<a class="sof-mrif-link" href="process-mrif.html?doc=' + encodeURIComponent(docNo) + '" onclick="event.stopPropagation()" title="I-process ang ' + esc + '"><code>' + esc + '</code> <i class="bi bi-box-arrow-up-right"></i></a>';
}

function sofPendingDocs(sofNo) {
  var P = _sofTracker.pending[sofKey(sofNo)];
  return P ? Object.keys(P.docs).length : 0;
}

// Ilang SOF ang may natirang allocation AT may naghihintay na MRIF
function sofUpdatePendingPill() {
  var n = _sofTracker.allAllocations.filter(function(a) { return !sofIsReleased(a) && Number(a.total_remaining_qty || 0) > 0 && sofPendingDocs(a.sof_no) > 0; }).length;
  var pe = document.getElementById('sofPillPending'); if (pe) pe.textContent = n;
}

(function() {
  var st = document.createElement('style');
  st.textContent = '.sof-pend-chip{display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:.7rem;font-weight:700;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;white-space:nowrap}' +
    '.sof-mrif-link{text-decoration:none;font-weight:700}.sof-mrif-link:hover code{background:#fed7aa}.sof-mrif-link i{font-size:.7rem}' +
    '.sof-pend-line{font-size:.78rem;line-height:1.35;padding:2px 0}.sof-pend-line code{font-size:.74rem}' +
    '.sof-pend-banner{background:#fff7ed;border-bottom:1px solid #fed7aa;color:#9a3412;padding:10px 16px;font-size:.85rem}';
  document.head.appendChild(st);
})();

// Vendor na ipapakita (itatago kung kapareho lang ng client)
function sofVendorShown(a) {
  var v = String(a.supplier_name || '').trim(), c = String(a.client_name || '').trim();
  return (v && v.toLowerCase() !== c.toLowerCase()) ? v : '';
}

// Na-release na = walang natirang naka-allocate (0 / 0) at hindi cancelled.
function sofIsReleased(a) {
  return String(a.status || '').toUpperCase() !== 'CANCELLED' && Number(a.total_allocated_qty || 0) <= 0;
}

function sofTrackerComputeKPIs() {
  var total = 0, released = 0;
  var active = 0, cancelled = 0;
  var totalRemaining = 0;

  _sofTracker.allAllocations.forEach(function(a) {
    var status = String(a.status || '').toUpperCase();
    if (sofIsReleased(a)) { released++; return; }
    total++;
    if (status === 'ACTIVE') active++;
    else if (status === 'CANCELLED') cancelled++;
    totalRemaining += Number(a.total_remaining_qty || 0);
  });

  var completed = 0;
  _sofTracker.allAllocations.forEach(function(a) { if (!sofIsReleased(a) && String(a.status || '').toUpperCase() === 'COMPLETED') completed++; });
  var pe;
  pe = document.getElementById('sofPillAll'); if (pe) pe.textContent = total;
  pe = document.getElementById('sofPillActive'); if (pe) pe.textContent = active;
  pe = document.getElementById('sofPillCompleted'); if (pe) pe.textContent = completed;
  pe = document.getElementById('sofPillCancelled'); if (pe) pe.textContent = cancelled;
  pe = document.getElementById('sofPillReleased'); if (pe) pe.textContent = released;

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
    // Released tab = mga na-release na (0/0). Sa ibang tab, nakatago sila — maliban kung may hinahanap.
    var rel = sofIsReleased(a);
    if (statusFilter === 'RELEASED') { if (!rel) return false; }
    else if (statusFilter === 'PENDINGMRIF') {
      if (rel || !(Number(a.total_remaining_qty || 0) > 0 && sofPendingDocs(a.sof_no) > 0)) return false;
    } else {
      if (rel && !search) return false;
      if (statusFilter && String(a.status || '').toUpperCase() !== statusFilter) return false;
    }

    if (search) {
      var sofNo = String(a.sof_no || '').toLowerCase();
      var client = String(a.client_name || '').toLowerCase();
      var project = String(a.project_name || '').toLowerCase();
      var joNo = String(a.jo_no || '').toLowerCase();
      var vendor = String(a.supplier_name || '').toLowerCase();
      
      if (sofNo.indexOf(search) === -1 &&
          client.indexOf(search) === -1 &&
          vendor.indexOf(search) === -1 &&
          project.indexOf(search) === -1 &&
          joNo.indexOf(search) === -1) return false;
    }
    return true;
  });

  sofSyncPills(statusFilter);
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
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      '<div class="sof-empty"><i class="bi bi-inbox"></i>No SOF allocations found.</div></td></tr>';
    return;
  }

  var html = '';
  _sofTracker.filteredAllocations.forEach(function(a) {
    var status = sofIsReleased(a) ? 'RELEASED' : String(a.status || 'ACTIVE').toUpperCase();
    var dateStr = a.sof_date ? new Date(a.sof_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var allocated = Number(a.total_allocated_qty || 0);
    var used = Number(a.total_used_qty || 0);
    var remaining = Number(a.total_remaining_qty || 0);
    var pct = allocated > 0 ? Math.max(0, Math.min(100, Math.round(used / allocated * 100))) : 0;
    var barCls = status === 'CANCELLED' ? 'cancelled' : (allocated > 0 && remaining <= 0 ? 'full' : '');
    var stCls = (status === 'ACTIVE' || status === 'COMPLETED' || status === 'CANCELLED') ? status : 'OTHER';

    var sofJs = sofTrackerEsc(a.sof_no).replace(/'/g, "\\'");
    var client = a.client_name || '';
    var project = a.project_name || '';

    html += '<tr class="sof-row" onclick="sofViewItems(\'' + sofJs + '\')" title="I-click para makita ang mga item">' +
      '<td><a href="javascript:void(0)" class="sof-link" onclick="event.stopPropagation();sofViewItems(\'' + sofJs + '\')">' +
        '<i class="bi bi-file-earmark-text"></i><span>' + sofTrackerEsc(a.sof_no) + '</span>' +
        '<span class="sof-go"><i class="bi bi-arrow-right"></i></span></a>' +
        (remaining > 0 && sofPendingDocs(a.sof_no) > 0 ? '<div><span class="sof-pend-chip" title="May MRIF na naghihintay ng item na naka-allocate sa SOF na ito"><i class="bi bi-hourglass-split"></i>' + sofPendingDocs(a.sof_no) + ' MRIF pending</span></div>' : '') +
      '</td>' +
      '<td><div class="sof-client">' +
        (client ? '<div class="sof-avatar" style="background:' + sofAvatarColor(client) + '">' + sofInitials(client) + '</div>' : '') +
        '<div style="min-width:0"><div class="sof-client-name">' + sofTrackerEsc(client) + '</div>' +
        (project ? '<div class="sof-client-sub"><i class="bi bi-folder2-open"></i>' + sofTrackerEsc(project) + '</div>' : '') +
        (sofVendorShown(a) ? '<div class="sof-client-sub"><i class="bi bi-truck"></i>Vendor: ' + sofTrackerEsc(sofVendorShown(a)) + '</div>' : '') + '</div>' +
      '</div></td>' +
      '<td><span class="sof-jo">' + sofTrackerEsc(a.jo_no || '—') + '</span></td>' +
      '<td class="sof-date">' + sofTrackerEsc(dateStr) + '</td>' +
      '<td class="text-center"><span class="sof-items-chip"><i class="bi bi-box-seam"></i>' + (a.total_items || 0) + '</span></td>' +
      '<td><div class="sof-usage">' +
        '<div class="sof-usage-top"><span><b>' + sofTrackerNum(used) + '</b> / ' + sofTrackerNum(allocated) + ' used</span><b>' + pct + '%</b></div>' +
        '<div class="sof-bar ' + barCls + '"><span style="width:' + pct + '%"></span></div>' +
      '</div></td>' +
      '<td class="text-center"><span class="sof-rem ' + (remaining > 0 ? 'has' : 'zero') + '">' + sofTrackerNum(remaining) + '</span></td>' +
      '<td class="text-center"><span class="sof-status ' + stCls + '">' + sofTrackerEsc(status) + '</span></td>' +
      '<td class="text-center" onclick="event.stopPropagation()">' + (sofCanProcess()
        ? '<button type="button" class="btn btn-sm btn-outline-secondary" title="Edit Client / Vendor" onclick="event.stopPropagation();sofEditParties(\'' + sofJs + '\')"><i class="bi bi-pencil-square"></i></button>'
        : '') + '</td>' +
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

function sofSyncPills(status) {
  document.querySelectorAll('#sofPills .sof-pill').forEach(function(p) {
    p.classList.toggle('active', (p.getAttribute('data-status') || '') === (status || ''));
  });
}
function sofSetStatus(status) {
  var sel = document.getElementById('sofStatusFilter');
  if (sel) sel.value = status || '';
  sofTrackerApplyFilters();
}
window.sofSetStatus = sofSetStatus;

// Initials + pare-parehong kulay para sa bawat client
function sofInitials(name) {
  var parts = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[1][0] : (parts[0][1] || ''))).toUpperCase();
}
function sofAvatarColor(seed) {
  var palette = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5', '#0d9488'];
  var h = 0, s = String(seed || '');
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
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
// v2.2 — SOF ITEMS MODAL: status filter, search, pending-MRIF filter,
//         sort, totals footer, export CSV
// ═══════════════════════════════════════════════════════════
var _sofItemsView = { sofNo: '', items: [], PEND: { docs: {}, lines: {} }, status: 'ALL', q: '', pend: false, sort: 'code' };

(function() {
  if (document.getElementById('sofItemsCss')) return;
  var st = document.createElement('style');
  st.id = 'sofItemsCss';
  st.textContent =
    '#sofItemsModal .erp-table thead th{position:sticky;top:0;z-index:2;background:#f1f5f9;box-shadow:0 1px 0 #e2e8f0}' +
    '.sof-ctl{padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0}' +
    '.sof-fchip{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border:1.5px solid #e2e8f0;background:#fff;border-radius:999px;font-size:.8rem;font-weight:600;color:#334155;cursor:pointer;transition:all .12s}' +
    '.sof-fchip:hover{border-color:#1e3a5f}' +
    '.sof-fchip .dot{width:8px;height:8px;border-radius:50%;background:#94a3b8}' +
    '.sof-fchip .n{background:#f1f5f9;border-radius:999px;padding:0 7px;font-size:.72rem;color:#475569}' +
    '.sof-fchip.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}' +
    '.sof-fchip.on .n{background:rgba(255,255,255,.22);color:#fff}' +
    '.sof-fchip.k-ACTIVE .dot{background:#0d6efd}.sof-fchip.k-PARTIAL .dot{background:#f59e0b}.sof-fchip.k-FULL .dot{background:#198754}' +
    '.sof-prog{height:6px;min-width:90px;background:#e2e8f0;border-radius:99px;overflow:hidden}.sof-prog>div{height:100%;background:#198754}' +
    '.sof-info{display:grid;grid-template-columns:2fr 2fr 2fr 1fr 1fr;gap:12px 20px;padding:14px 16px;background:#fff;border-bottom:1px solid #e2e8f0}' +
    '@media(max-width:768px){.sof-info{grid-template-columns:1fr 1fr}}' +
    '.sof-info .lbl{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:3px}' +
    '.sof-info .val{font-weight:600;color:#0f172a;word-break:break-word}' +
    '.sof-info .val.empty{color:#94a3b8;font-weight:500}' +
    '.sof-info .sof-avatar{flex:0 0 auto}' +
    '.sof-items-foot{display:flex;flex-wrap:wrap;gap:6px 22px;align-items:center;width:100%;font-size:.85rem}' +
    '.sof-items-foot b{font-variant-numeric:tabular-nums}';
  document.head.appendChild(st);
})();

function sofItemsCompute() {
  var v = _sofItemsView;
  return v.items.map(function(it) {
    var alloc = Number(it.allocated_qty || 0);
    var used = Number(it.used_qty || 0);
    var rem = alloc - used;
    return {
      it: it, alloc: alloc, used: used, rem: rem,
      key: rem <= 0 ? 'FULL' : (used > 0 ? 'PARTIAL' : 'ACTIVE'),
      pl: (v.PEND.lines[sofKey(it.item_code)] || [])
    };
  });
}

// Search + pending filter lang (para tama ang bilang sa chips), tapos status filter
function sofItemsBase() {
  var v = _sofItemsView, q = v.q.trim().toLowerCase();
  return sofItemsCompute().filter(function(r) {
    if (v.pend && !r.pl.length) return false;
    if (q) {
      var hay = (String(r.it.item_code || '') + ' ' + String(r.it.description || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function sofItemsRender() {
  var v = _sofItemsView;
  var base = sofItemsBase();
  var counts = { ALL: base.length, ACTIVE: 0, PARTIAL: 0, FULL: 0 };
  base.forEach(function(r) { counts[r.key]++; });

  var rows = base.filter(function(r) { return v.status === 'ALL' || r.key === v.status; });
  var order = { ACTIVE: 0, PARTIAL: 1, FULL: 2 };
  rows.sort(function(a, b) {
    if (v.sort === 'rem') return b.rem - a.rem;
    if (v.sort === 'used') return b.used - a.used;
    if (v.sort === 'status') return (order[a.key] - order[b.key]) || String(a.it.item_code).localeCompare(String(b.it.item_code));
    return String(a.it.item_code).localeCompare(String(b.it.item_code));
  });

  // chips
  var defs = [['ALL', 'All'], ['ACTIVE', 'Available'], ['PARTIAL', 'Partial'], ['FULL', 'Fully Served']];
  var chipEl = document.getElementById('sofFChips');
  if (chipEl) {
    chipEl.innerHTML = defs.map(function(d) {
      return '<button type="button" class="sof-fchip k-' + d[0] + (v.status === d[0] ? ' on' : '') + '" onclick="sofItemsSetStatus(\'' + d[0] + '\')">' +
        (d[0] === 'ALL' ? '' : '<span class="dot"></span>') + d[1] + '<span class="n">' + counts[d[0]] + '</span></button>';
    }).join('');
  }

  // rows
  var tb = document.getElementById('sofItemsTbody');
  if (tb) {
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-5">' +
        '<i class="bi bi-funnel fs-3 d-block mb-2"></i>Walang item na tumutugma sa filter. ' +
        '<a href="#" onclick="sofItemsReset();return false;">I-reset ang filters</a></td></tr>';
    } else {
      tb.innerHTML = rows.map(function(r, idx) {
        var it = r.it;
        var badge = r.key === 'FULL' ? '<span class="badge bg-success">FULLY SERVED</span>'
                  : r.key === 'PARTIAL' ? '<span class="badge bg-warning text-dark">PARTIAL</span>'
                  : '<span class="badge bg-primary">AVAILABLE</span>';
        var pendHtml = r.pl.length ? r.pl.map(function(x, i) {
          return '<div class="sof-pend-line">' + (i === 0 && r.rem > 0 ? '<span class="badge bg-warning text-dark me-1">UNA</span>' : '') +
            sofMrifLink(x.doc_no) + ' <b>' + sofTrackerEsc(x.requestor || '—') + '</b>' +
            (x.department ? ' <span class="text-muted">(' + sofTrackerEsc(x.department) + ')</span>' : '') +
            ' · kailangan <b>' + sofTrackerNum(x.need) + '</b>' + (x.status === 'PARTIAL' ? ' <span class="text-muted">(partial)</span>' : '') + '</div>';
        }).join('') : '<span class="text-muted">—</span>';
        var pct = r.alloc > 0 ? Math.min(100, Math.round(r.used / r.alloc * 100)) : 0;
        return '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + sofTrackerEsc(it.item_code) + '</code></td>' +
          '<td>' + sofTrackerEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + sofTrackerEsc(it.unit || '—') + '</td>' +
          '<td class="text-end fw-bold">' + sofTrackerNum(r.alloc) + '</td>' +
          '<td class="text-end text-success fw-bold">' + sofTrackerNum(r.used) + '</td>' +
          '<td class="text-end text-danger fw-bold">' + sofTrackerNum(r.rem) + '</td>' +
          '<td style="min-width:110px"><div class="sof-prog" title="' + pct + '% used"><div style="width:' + pct + '%"></div></div><div class="small text-muted mt-1">' + pct + '%</div></td>' +
          '<td>' + pendHtml + '</td>' +
          '<td class="text-center">' + badge + '</td>' +
          '<td class="text-center">' + (r.rem > 0
            ? '<button class="btn btn-sm btn-outline-danger" title="Alisin ang allocation — ibalik sa free on-hand" data-code="' + sofTrackerEsc(it.item_code) + '" onclick="sofItemsRelease(this.dataset.code)"><i class="bi bi-x-circle me-1"></i>Remove Allocation</button>'
            : '') + '</td>' +
        '</tr>';
      }).join('');
    }
  }

  // footer totals (ng nakikitang rows)
  var tA = 0, tU = 0, tR = 0;
  rows.forEach(function(r) { tA += r.alloc; tU += r.used; tR += Math.max(0, r.rem); });
  var foot = document.getElementById('sofItemsFooter');
  if (foot) {
    var filtered = (v.status !== 'ALL' || v.q.trim() || v.pend);
    foot.innerHTML = '<div class="sof-items-foot">' +
      '<span>Showing <b>' + rows.length + '</b> of <b>' + v.items.length + '</b> item(s)' + (filtered ? ' <span class="text-muted">(filtered)</span>' : '') + '</span>' +
      '<span>Allocated: <b>' + sofTrackerNum(tA) + '</b></span>' +
      '<span class="text-success">Used: <b>' + sofTrackerNum(tU) + '</b></span>' +
      '<span class="text-danger">Remaining: <b>' + sofTrackerNum(tR) + '</b></span>' +
      '<span class="text-muted">' + (tA > 0 ? Math.round(tU / tA * 100) : 0) + '% used</span>' +
    '</div>';
  }
  window._sofItemsVisible = rows;
}

window.sofItemsSetStatus = function(st) { _sofItemsView.status = st; sofItemsRender(); };
window.sofItemsSearch    = function(val) { _sofItemsView.q = val || ''; sofItemsRender(); };
window.sofItemsTogglePend = function(on) { _sofItemsView.pend = !!on; sofItemsRender(); };
window.sofItemsSort      = function(val) { _sofItemsView.sort = val; sofItemsRender(); };
window.sofItemsReset = function() {
  var v = _sofItemsView;
  v.status = 'ALL'; v.q = ''; v.pend = false; v.sort = 'code';
  var i = document.getElementById('sofItemsSearch'); if (i) i.value = '';
  var c = document.getElementById('sofItemsPend');   if (c) c.checked = false;
  var o = document.getElementById('sofItemsSort');   if (o) o.value = 'code';
  sofItemsRender();
};

window.sofItemsRelease = function(code) {
  var r = sofItemsCompute().filter(function(x) { return String(x.it.item_code) === String(code); })[0];
  if (!r || r.rem <= 0) return;
  sofReleaseItem(_sofItemsView.sofNo, code, r.rem);
};

window.sofItemsExport = function() {
  var rows = window._sofItemsVisible || [];
  if (!rows.length) return erpShowToast('Walang i-e-export', 'warning');
  function q(x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }
  var inf = _sofItemsView.info || {};
  var lines = [['SOF No', 'Client', 'Vendor', 'Project', 'JO No', 'Item Code', 'Description', 'Unit', 'Allocated', 'Used', 'Remaining', 'Status', 'Pending MRIF'].map(q).join(',')];
  rows.forEach(function(r) {
    var pend = r.pl.map(function(x) { return x.doc_no + ' ' + (x.requestor || '') + ' (' + x.need + ')'; }).join(' | ');
    lines.push([_sofItemsView.sofNo, inf.client || '', inf.vendor || '', inf.project || '', inf.jo || '', r.it.item_code, r.it.description || '', r.it.unit || '', r.alloc, r.used, r.rem,
      r.key === 'FULL' ? 'FULLY SERVED' : (r.key === 'ACTIVE' ? 'AVAILABLE' : r.key), pend].map(q).join(','));
  });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'SOF-' + String(_sofItemsView.sofNo).replace(/[^\w-]+/g, '_') + '-items.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
};


function sofItemsFillInfo(sofNo) {
  var box = document.getElementById('sofItemsInfo');
  if (!box) return;
  var a = (_sofTracker.allAllocations || []).filter(function(x) { return String(x.sof_no) === String(sofNo); })[0] || {};
  var v = _sofItemsView;
  v.info = { client: a.client_name || '', vendor: sofVendorShown(a), project: a.project_name || '', jo: a.jo_no || '' };

  function cell(label, value, extra) {
    return '<div><div class="lbl">' + label + '</div><div class="val' + (value ? '' : ' empty') + '">' +
      (value ? (extra || '') + sofTrackerEsc(value) : '—') + '</div></div>';
  }
  var client = a.client_name || '';
  var clientHtml = '<div><div class="lbl">Client</div>' +
    (client
      ? '<div class="d-flex align-items-center gap-2"><div class="sof-avatar" style="background:' + sofAvatarColor(client) + '">' + sofInitials(client) + '</div>' +
        '<div class="val">' + sofTrackerEsc(client) + '</div></div>'
      : '<div class="val empty">—</div>') + '</div>';

  var dateStr = a.sof_date ? new Date(a.sof_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  box.innerHTML = clientHtml +
    cell('Vendor', sofVendorShown(a), '<i class="bi bi-truck me-1 text-muted"></i>') +
    cell('Project', a.project_name || '', '<i class="bi bi-folder2-open me-1 text-muted"></i>') +
    '<div><div class="lbl">JO No.</div><div class="val' + (a.jo_no ? '' : ' empty') + '">' +
      (a.jo_no ? '<span class="sof-jo">' + sofTrackerEsc(a.jo_no) + '</span>' : '—') + '</div></div>' +
    cell('SOF Date', dateStr);
}

window.sofViewItems = async function(sofNo) {
  console.log('[SOF Tracker] Fetching items for SOF:', sofNo);

  var v = _sofItemsView;
  // Kung ibang SOF na, i-reset ang filters. Kung pareho (hal. pagkatapos mag-release), panatilihin.
  if (String(v.sofNo) !== String(sofNo)) {
    v.status = 'ALL'; v.q = ''; v.pend = false; v.sort = 'code';
  }
  v.sofNo = sofNo;

  var modalId = 'sofItemsModal';
  var existing = document.getElementById(modalId);
  if (existing) existing.remove();

  var wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="modal fade" id="' + modalId + '" tabindex="-1">' +
    '<div class="modal-dialog modal-xl modal-dialog-scrollable">' +
      '<div class="modal-content">' +
        '<div class="modal-header" style="background:#1e3a5f;color:#fff;">' +
          '<h5 class="modal-title"><i class="bi bi-list-check me-2"></i>SOF Allocation Details — ' + sofTrackerEsc(sofNo) + '</h5>' +
          (sofCanProcess() ? '<button type="button" class="btn btn-sm btn-light ms-3" onclick="sofEditParties(\'' + sofTrackerEsc(sofNo).replace(/'/g, "\\'") + '\')"><i class="bi bi-pencil-square me-1"></i>Edit Client / Vendor</button>' : '') +
          '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
        '</div>' +
        '<div class="sof-info" id="sofItemsInfo"></div>' +
        '<div class="sof-ctl" id="sofItemsCtl" style="display:none;">' +
          '<div class="d-flex flex-wrap gap-2 align-items-center mb-2" id="sofFChips"></div>' +
          '<div class="d-flex flex-wrap gap-2 align-items-center">' +
            '<div class="input-group input-group-sm" style="max-width:300px;">' +
              '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
              '<input type="text" id="sofItemsSearch" class="form-control" placeholder="Hanapin item code / description..." autocomplete="off" oninput="sofItemsSearch(this.value)">' +
            '</div>' +
            '<select id="sofItemsSort" class="form-select form-select-sm" style="width:auto;" onchange="sofItemsSort(this.value)">' +
              '<option value="code">Sort: Item code</option>' +
              '<option value="rem">Sort: Remaining (pinakamarami)</option>' +
              '<option value="used">Sort: Used (pinakamarami)</option>' +
              '<option value="status">Sort: Status</option>' +
            '</select>' +
            '<div class="form-check form-switch mb-0 ms-1">' +
              '<input class="form-check-input" type="checkbox" id="sofItemsPend" onchange="sofItemsTogglePend(this.checked)">' +
              '<label class="form-check-label small" for="sofItemsPend">May pending MRIF lang</label>' +
            '</div>' +
            '<div class="ms-auto d-flex gap-2">' +
              '<button type="button" class="btn btn-sm btn-outline-secondary" onclick="sofItemsReset()"><i class="bi bi-x-circle me-1"></i>Reset</button>' +
              '<button type="button" class="btn btn-sm btn-outline-success" onclick="sofItemsExport()"><i class="bi bi-download me-1"></i>Export CSV</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-body p-0" id="sofItemsModalBody">' +
          '<div class="text-center py-5"><div class="erp-spinner" style="margin:0 auto;"></div><div class="mt-2 text-muted">Loading items...</div></div>' +
        '</div>' +
        '<div class="modal-footer justify-content-start py-2" id="sofItemsFooter" style="background:#f8fafc;"></div>' +
      '</div>' +
    '</div>' +
  '</div>';
  document.body.appendChild(wrapper.firstChild);

  var modal = new bootstrap.Modal(document.getElementById(modalId));
  modal.show();
  sofItemsFillInfo(sofNo);

  try {
    var items = await erpFetch('erp_sof_allocation_items', 'select=*&sof_no=eq.' + encodeURIComponent(sofNo) + '&order=item_code.asc');
    var bodyEl = document.getElementById('sofItemsModalBody');

    if (!items || items.length === 0) {
      bodyEl.innerHTML = '<div class="text-center py-5 text-muted">Walang items na naka-allocate sa SOF na ito.</div>';
      document.getElementById('sofItemsFooter').style.display = 'none';
      return;
    }

    v.items = items;
    v.PEND = _sofTracker.pending[sofKey(sofNo)] || { docs: {}, lines: {} };

    var pdocs = Object.keys(v.PEND.docs || {});
    var banner = pdocs.length
      ? '<div class="sof-pend-banner"><i class="bi bi-hourglass-split me-1"></i><b>' + pdocs.length + ' MRIF pending</b> para sa SOF na ito: ' +
        pdocs.map(function(n) { var d = v.PEND.docs[n]; return sofMrifLink(n) + ' ' + sofTrackerEsc(d.requestor || ''); }).join(' · ') + '</div>'
      : '';

    bodyEl.innerHTML = banner +
      '<div class="table-responsive">' +
      '<table class="erp-table" style="font-size:0.85rem;">' +
        '<thead><tr>' +
          '<th>#</th><th>Item Code</th><th>Description</th>' +
          '<th class="text-center">Unit</th>' +
          '<th class="text-end">Allocated Qty</th><th class="text-end">Used Qty</th><th class="text-end">Remaining Qty</th>' +
          '<th>Usage</th>' +
          '<th>Pending MRIF (kanino ibibigay)</th>' +
          '<th class="text-center">Status</th><th class="text-center">Action</th>' +
        '</tr></thead>' +
        '<tbody id="sofItemsTbody"></tbody>' +
      '</table></div>';

    // ibalik ang naka-save na filter values sa controls
    document.getElementById('sofItemsCtl').style.display = '';
    document.getElementById('sofItemsSearch').value = v.q;
    document.getElementById('sofItemsPend').checked = v.pend;
    document.getElementById('sofItemsSort').value = v.sort;

    sofItemsRender();

  } catch (err) {
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
  var q = prompt('Ilang qty ng ' + itemCode + ' ang aalisin sa allocation ng ' + sofNo + '?\n(Remaining: ' + remaining + ')\n\nMababawasan ang reservation at babalik sa free on-hand.', remaining);
  if (q === null) return;
  var qty = Number(q);
  if (!(qty > 0) || qty > remaining) return erpShowToast('Invalid qty (1 hanggang ' + remaining + ')', 'warning');
  var reason = prompt('Reason sa pag-alis ng allocation? (required)');
  if (!reason || !reason.trim()) return erpShowToast('Reason is required', 'warning');
  try {
    var r = await sofRpc('erp_sof_release', { p_sof_no: sofNo, p_item_code: itemCode, p_qty: qty, p_user: sofUser(), p_reason: reason.trim() });
    if (!r || !r.success) return erpShowToast((r && r.error) || 'Failed', 'danger');
    erpShowToast('✅ Allocation removed: ' + r.released + ' — pwede nang gamitin ng kahit anong MRIF', 'success');
    var m = document.getElementById('sofItemsModal'); if (m) { bootstrap.Modal.getInstance(m).hide(); }
    sofTrackerLoad();
    setTimeout(function() { sofViewItems(sofNo); }, 400);
  } catch (e) {
    erpShowToast('Failed: ' + e.message + ' (na-run mo na ba ang sof-manual.sql?)', 'danger');
  }
};


// ═══════════════════════════════════════════════════════════
// v2.3 — EDIT CLIENT / VENDOR (warehouse / admin lang)
// Needs sof-edit.sql (erp_sof_update_parties)
// ═══════════════════════════════════════════════════════════
window.sofEditParties = function(sofNo) {
  if (!sofCanProcess()) return erpShowToast('Warehouse / admin lang ang puwedeng mag-edit', 'warning');
  var a = (_sofTracker.allAllocations || []).filter(function(x) { return String(x.sof_no) === String(sofNo); })[0];
  if (!a) return erpShowToast('SOF not found', 'warning');

  var clients = {}, vendors = {};
  _sofTracker.allAllocations.forEach(function(x) {
    if (x.client_name) clients[x.client_name] = 1;
    if (x.supplier_name) vendors[x.supplier_name] = 1;
  });
  function dl(id, obj) { return '<datalist id="' + id + '">' + Object.keys(obj).sort().map(function(n) { return '<option value="' + sofTrackerEsc(n) + '">'; }).join('') + '</datalist>'; }

  var old = document.getElementById('sofEditModal'); if (old) old.remove();
  var w = document.createElement('div');
  w.innerHTML =
  '<div class="modal fade" id="sofEditModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
    '<div class="modal-header" style="background:#1e3a5f;color:#fff;"><h5 class="modal-title"><i class="bi bi-pencil-square me-2"></i>Edit Client / Vendor — SOF ' + sofTrackerEsc(sofNo) + '</h5>' +
      '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
    '<div class="modal-body">' +
      '<div class="mb-3"><label class="form-label fw-bold small mb-1">Client</label>' +
        '<input id="seClient" class="form-control" list="seClientList" autocomplete="off" value="' + sofTrackerEsc(a.client_name || '') + '" placeholder="e.g. PARKLINS">' + dl('seClientList', clients) +
        '<div class="form-text">Ang customer ng project. Iwanang blangko para gamitin ulit ang client mula sa SOF Monitoring / MRIF.</div></div>' +
      '<div class="mb-2"><label class="form-label fw-bold small mb-1">Vendor / Supplier</label>' +
        '<input id="seVendor" class="form-control" list="seVendorList" autocomplete="off" value="' + sofTrackerEsc(a.supplier_name || '') + '" placeholder="e.g. Yu Eng Kao">' + dl('seVendorList', vendors) +
        '<div class="form-text">Ang pinagbilhan / supplier ng allocated na stock.</div></div>' +
      '<div class="alert alert-danger py-2 small d-none mt-3 mb-0" id="seErr"></div>' +
    '</div>' +
    '<div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>' +
      '<button class="btn btn-primary" id="seSave" onclick="sofEditPartiesSave(\'' + String(sofNo).replace(/'/g, "\\'") + '\')"><i class="bi bi-check2-circle me-1"></i>Save</button></div>' +
  '</div></div></div>';
  document.body.appendChild(w.firstChild);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('sofEditModal')).show();
};

window.sofEditPartiesSave = async function(sofNo) {
  var client = document.getElementById('seClient').value.trim();
  var vendor = document.getElementById('seVendor').value.trim();
  var err = document.getElementById('seErr'), btn = document.getElementById('seSave');
  err.classList.add('d-none'); btn.disabled = true;
  try {
    var r = await sofRpc('erp_sof_update_parties', { p_sof_no: sofNo, p_client: client, p_vendor: vendor, p_user: sofUser(), p_only_if_blank: false });
    if (!r || !r.success) throw new Error((r && r.error) || 'Failed');
    var a = (_sofTracker.allAllocations || []).filter(function(x) { return String(x.sof_no) === String(sofNo); })[0];
    var hd = _sofTracker.headers[sofKey(sofNo)];
    if (hd) { hd.client_override = client || null; hd.client_name = vendor; }
    bootstrap.Modal.getInstance(document.getElementById('sofEditModal')).hide();
    erpShowToast('✅ Na-save ang Client / Vendor ng SOF ' + sofNo, 'success');
    if (a && client) {                       // may bagong client → i-update agad
      a.client_name = client; a.supplier_name = vendor;
      sofTrackerApplyFilters();
      if (document.getElementById('sofItemsInfo') && String(_sofItemsView.sofNo) === String(sofNo)) sofItemsFillInfo(sofNo);
    } else {                                 // blangko → ibalik sa client mula sa cache / MRIF
      await sofTrackerLoad();
      if (document.getElementById('sofItemsInfo') && String(_sofItemsView.sofNo) === String(sofNo)) sofItemsFillInfo(sofNo);
    }
  } catch (e) {
    var m = String(e.message || e);
    var missing = /could not find the function|404|PGRST202/i.test(m);
    err.textContent = missing ? 'Wala pa ang function sa database. I-run muna ang sof-edit.sql sa Supabase SQL Editor, tapos subukan ulit.' : m;
    err.classList.remove('d-none');
  } finally { btn.disabled = false; }
};
