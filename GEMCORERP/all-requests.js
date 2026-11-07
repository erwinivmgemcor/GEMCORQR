// ============================================================
// GEMCOR ERP — All Requests (Warehouse View)
// Shows all production requests for processing
// ============================================================

// ═══════════════════════════════════════════════════════════
// WHO HANDLES WHICH CATEGORY
// Normally this comes from the database (admins change it with the "Assign" button).
// The list below is only a FALLBACK, used when the database part is not installed yet.
// Key = full name as shown top-right (UPPERCASE).
// ═══════════════════════════════════════════════════════════
var AR_ASSIGNMENTS = {
  'ERWIN SISTER': ['COMPONENTS'],
  'RICHEL LAYA':  ['CONSUMABLES'],
  'JOMAR BANDA':  ['FABMAT']
};
var AR_CATEGORIES = ['COMPONENTS', 'CONSUMABLES', 'FABMAT', 'OTHER'];

var _allRequests = {
  prints: {},        // doc_no -> {count, by, at}  (who printed it — see print-log.js)
  locks: {},          // doc_no -> {locked_by, locked_by_name, locked_at, idle_seconds}  (requests being processed)
  assignByUser: {},   // username(lowercase) -> [categories]   (from the database)
  assignRows: [],     // raw rows: {username, fullname, category, is_active}
  assignSource: 'fallback',
  catByDoc: {},       // doc_no -> { COMPONENTS: n, ... }
  itemCat: {},        // item_code -> category
  renderToken: 0,
  avail: {},          // doc_no -> {level:'ready'|'some'|'none'|'na', ok, some, total, lines}  (stock vs outstanding balance)
  availAt: 0,         // kailan huling na-compute (0 = kailangan ulitin)
  availBusy: false,
  readySeen: null,    // doc_no na 'ready' sa huling compute (para malaman kung may BAGONG ready)
  allDocs: [],
  filteredDocs: [],
  currentPage: 1,
  pageSize: 30,
  searchTimer: null,
  currentDoc: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[All Requests] Initializing...');
  
  allRequestsCheckHealth();
  allRequestsPopulateDeptFilter();
  var cbBtn = document.getElementById('allMonthCloseBtn');
  if (cbBtn && arCanCloseBalance()) cbBtn.style.display = '';
  var assignBtn = document.getElementById('allAssignBtn');
  if (assignBtn && arIsAdmin()) assignBtn.style.display = '';
  // assignments first, so the default filter ("mine") is right on the first load
  allRequestsLoadAssignments().then(function() {
    allRequestsInitCatFilter();
    allRequestsLoad();
  });
  // who is processing what: refresh every 20 s while the tab is visible
  arRefreshPrints(false);
  setInterval(function() { if (!document.hidden) { arRefreshLocks(true); arRefreshPrints(true); } }, 20000);
  // stock availability: bagong MRR natanggap? i-check kada 1 minuto at kapag bumalik sa tab
  setInterval(function() { if (!document.hidden) arAvailRefresh(); }, 60000);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) arAvailRefresh(); });
});

// ── "in process" locks (see doc-lock.js) ──
async function arRefreshLocks(rerender) {
  if (!window.erpDocLock) return;
  var map = await erpDocLock.list();
  if (map === null) return;                      // lock tables not installed → feature stays hidden
  _allRequests.locks = map;
  if (rerender && _allRequests.allDocs.length) allRequestsRenderNow();
}

async function arRefreshPrints(rerender) {
  if (!window.erpPrintLog) return;
  var map = await erpPrintLog.list();
  if (map === null) return;                      // print log table not installed → feature stays hidden
  _allRequests.prints = map;
  if (rerender && _allRequests.allDocs.length) allRequestsRenderNow();
}

function arPrintBadge(docNo) {
  var p = _allRequests.prints && _allRequests.prints[docNo];
  if (!p) return '';
  var when = new Date(p.at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return '<div style="margin-top:4px;"><span title="' + erpEsc('Printed ' + p.count + 'x. Last printed by ' + p.by + ' on ' + when) + '" ' +
    'style="display:inline-block;font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#166534;">🖨 Printed · ' +
    erpEsc(p.by) + ' · ' + erpEsc(when) + (p.count > 1 ? ' ×' + p.count : '') + '</span></div>';
}

function arLockOf(docNo) {
  var l = _allRequests.locks && _allRequests.locks[docNo];
  if (!l) return null;
  var mine = String(l.locked_by || '').toLowerCase() === arUsername().toLowerCase();
  return { mine: mine, name: l.locked_by_name || l.locked_by, since: l.locked_at, row: l };
}

function arLockBadge(docNo) {
  var l = arLockOf(docNo);
  if (!l) return '';
  var mins = Math.max(0, Math.round((Date.now() - new Date(l.since).getTime()) / 60000));
  var t = mins >= 1 ? mins + ' min' : 'just now';
  return '<div style="margin-top:4px;"><span title="' + erpEsc(l.mine ? 'You are processing this' : l.name + ' is processing this since ' + new Date(l.since).toLocaleTimeString()) + '" ' +
    'style="display:inline-block;font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:999px;' +
    (l.mine ? 'background:#dbeafe;color:#1e40af;' : 'background:#fee2e2;color:#991b1b;') + '">🔒 ' +
    (l.mine ? 'You' : erpEsc(l.name)) + ' · ' + t + '</span></div>';
}

function arIsAdmin() {
  try { return localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; }
}
function arUsername() {
  try { return String(localStorage.getItem('ivm_username') || ''); } catch (e) { return ''; }
}

// ── assignments from the database (RPC erp_get_category_assignments) ──
async function allRequestsLoadAssignments() {
  try {
    var res = await fetch(erpUrl('rpc/erp_get_category_assignments'), { method: 'POST', headers: erpHeaders(), body: '{}' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var rows = await res.json();
    var by = {};
    (rows || []).forEach(function(r) {
      if (r.is_active === false) return;
      var u = String(r.username || '').toLowerCase();
      (by[u] = by[u] || []).push(String(r.category || '').toUpperCase());
    });
    _allRequests.assignRows = rows || [];
    _allRequests.assignByUser = by;
    _allRequests.assignSource = 'db';
  } catch (e) {
    console.warn('[All Requests] assignments table not available, using built-in list:', e.message);
    _allRequests.assignSource = 'fallback';
  }
  arRenderAssignWarn();
}

// admin-only warning: a category nobody handles (someone left / was reassigned)
function arRenderAssignWarn() {
  var el = document.getElementById('allAssignWarn');
  if (!el) return;
  if (!arIsAdmin() || _allRequests.assignSource !== 'db') { el.style.display = 'none'; return; }
  var covered = {};
  _allRequests.assignRows.forEach(function(r) { if (r.is_active !== false) covered[String(r.category).toUpperCase()] = true; });
  var missing = ['COMPONENTS', 'CONSUMABLES', 'FABMAT'].filter(function(c) { return !covered[c]; });
  if (!missing.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-2"></i><strong>No one is assigned to ' + missing.join(', ') + '.</strong> ' +
    'Requests with these items have no owner. <a href="javascript:void(0)" onclick="arOpenAssignModal()">Assign now</a>';
}

// ═══════════════════════════════════════════════════════════
// CATEGORY (Components / Consumables / Fabmat)
// ═══════════════════════════════════════════════════════════
function arNormCat(c) {
  var t = String(c || '').toUpperCase().trim();
  if (t.indexOf('COMPONENT') === 0) return 'COMPONENTS';
  if (t.indexOf('CONSUMABLE') === 0) return 'CONSUMABLES';
  if (t.indexOf('FABMAT') === 0 || t.indexOf('FAB MAT') === 0) return 'FABMAT';
  return 'OTHER';
}

function arMyCats() {
  if (_allRequests.assignSource === 'db') {
    return _allRequests.assignByUser[arUsername().toLowerCase()] || [];
  }
  var name = '';
  try { name = (localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || ''); } catch (e) {}
  return AR_ASSIGNMENTS[String(name).toUpperCase().trim()] || [];
}

function allRequestsInitCatFilter() {
  var sel = document.getElementById('allCatFilter');
  if (!sel) return;
  var mine = arMyCats();
  var html = '<option value="">All Categories</option>';
  if (mine.length) html += '<option value="MINE">★ Mine (' + mine.join(' + ') + ')</option>';
  AR_CATEGORIES.forEach(function(c) { html += '<option value="' + c + '">' + c + '</option>'; });
  sel.innerHTML = html;
  var saved = '';
  try { saved = localStorage.getItem('ar_cat_filter') || ''; } catch (e) {}
  // default: people with an assignment start on their own category
  var start = saved && (saved !== 'MINE' || mine.length) ? saved : (mine.length ? 'MINE' : '');
  sel.value = start;
  if (sel.value !== start) sel.value = '';
}

function allRequestsOnCatChange() {
  try { localStorage.setItem('ar_cat_filter', document.getElementById('allCatFilter').value); } catch (e) {}
  _allRequests.currentPage = 1;
  allRequestsRender();
}

function arCatFilterValue() {
  var el = document.getElementById('allCatFilter');
  return el ? el.value : '';
}

// does this request contain the wanted category (or any of my categories)?
function arDocHasCat(docNo, filter) {
  var c = _allRequests.catByDoc[docNo];
  if (!c) return false;
  if (filter === 'MINE') return arMyCats().some(function(m) { return c[m] > 0; });
  return c[filter] > 0;
}

// Load the categories of the given requests (doc_items → erp_items). Returns true when something new was loaded.
async function allRequestsEnsureCats(docs) {
  var missing = [];
  (docs || []).forEach(function(d) { if (d.doc_no && !_allRequests.catByDoc[d.doc_no]) missing.push(d.doc_no); });
  if (!missing.length) return false;

  try {
    var lines = [];
    for (var i = 0; i < missing.length; i += 60) {
      var chunk = missing.slice(i, i + 60).map(function(n) { return '"' + String(n).replace(/"/g, '') + '"'; }).join(',');
      var part = await erpFetchAll('doc_items', 'select=doc_no,item_code&doc_no=in.(' + encodeURIComponent(chunk) + ')&order=doc_no.asc');
      lines = lines.concat(part || []);
    }
    var needCodes = {};
    lines.forEach(function(l) { if (l.item_code && _allRequests.itemCat[l.item_code] === undefined) needCodes[l.item_code] = true; });
    var codes = Object.keys(needCodes);
    for (var k = 0; k < codes.length; k += 120) {
      var cc = codes.slice(k, k + 120).map(function(c) { return '"' + String(c).replace(/"/g, '') + '"'; }).join(',');
      var rows = await erpFetchAll('erp_items', 'select=item_code,category&item_code=in.(' + encodeURIComponent(cc) + ')&order=item_code.asc');
      (rows || []).forEach(function(r) { _allRequests.itemCat[r.item_code] = arNormCat(r.category); });
    }
    missing.forEach(function(n) { _allRequests.catByDoc[n] = {}; });
    lines.forEach(function(l) {
      var cat = _allRequests.itemCat[l.item_code] || 'OTHER';
      var m = _allRequests.catByDoc[l.doc_no];
      if (m) m[cat] = (m[cat] || 0) + 1;
    });
    return true;
  } catch (e) {
    console.warn('[All Requests] categories unavailable:', e.message);
    missing.forEach(function(n) { _allRequests.catByDoc[n] = { _err: 1 }; });
    return false;
  }
}

function arCatCellHtml(docNo) {
  var c = _allRequests.catByDoc[docNo];
  if (!c) return '<span class="text-muted small">…</span>';
  if (c._err) return '<span class="text-muted small" title="Could not load categories">n/a</span>';
  var mine = arMyCats();
  var keys = AR_CATEGORIES.filter(function(k) { return c[k] > 0; });
  if (!keys.length) return '<span class="text-muted small">—</span>';
  return keys.map(function(k) {
    var isMine = mine.indexOf(k) !== -1;
    return '<span class="ar-cat ' + k + (isMine ? ' mine' : '') + '" title="' + c[k] + ' item(s) ' + k + (isMine ? ' — yours' : '') + '">' +
      (isMine ? '★ ' : '') + k + ' · ' + c[k] + '</span>';
  }).join('');
}

async function allRequestsCheckHealth() {
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

async function allRequestsPopulateDeptFilter() {
  try {
    var rows = await erpFetch('documents',
      'select=department&department=not.is.null&department=neq.&order=department.asc&limit=1000');
    
    var seen = {};
    var depts = [];
    (rows || []).forEach(function(r) {
      var d = String(r.department || '').trim();
      if (d && !seen[d]) {
        seen[d] = true;
        depts.push(d);
      }
    });
    
    var sel = document.getElementById('allDeptFilter');
    sel.innerHTML = '<option value="">All Departments</option>';
    depts.sort().forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
  } catch(err) {
    console.warn('[All Requests] Dept filter failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD REQUESTS
// ═══════════════════════════════════════════════════════════
async function allRequestsLoad() {
  var tbody = document.getElementById('allTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="10" class="erp-empty">' +
    '<div class="erp-spinner"></div>' +
    '<div class="mt-2">Loading requests...</div></td></tr>';
  
  try {
    // Build query
    var query = 'select=*&or=(doc_type.eq.MRIF,doc_type.eq.MRS)';
    
    // Status filter
    var statusFilter = document.getElementById('allStatusFilter').value;
    if (statusFilter) {
      if (statusFilter.indexOf(',') !== -1) {
        var statuses = statusFilter.split(',');
        query += '&status=in.(' + statuses.join(',') + ')';
      } else {
        query += '&status=eq.' + statusFilter;
      }
    }
    
    // Type filter
    var typeFilter = document.getElementById('allTypeFilter').value;
    if (typeFilter) {
      query = query.replace('or=(doc_type.eq.MRIF,doc_type.eq.MRS)', 'doc_type=eq.' + typeFilter);
    }
    
    // Dept filter
    var deptFilter = document.getElementById('allDeptFilter').value;
    if (deptFilter) {
      query += '&department=eq.' + encodeURIComponent(deptFilter);
    }
    
    // Date range
    var fromDate = document.getElementById('allDateFrom').value;
    if (fromDate) {
      query += '&created_at=gte.' + encodeURIComponent(fromDate + 'T00:00:00');
    }
    
    var toDate = document.getElementById('allDateTo').value;
    if (toDate) {
      query += '&created_at=lt.' + encodeURIComponent(toDate + 'T23:59:59');
    }
    
    query += '&order=created_at.desc&limit=2000';
    
    var rows = await erpFetch('documents', query);
    rows = rows || [];

    // Processed na ang MRS (one-shot) kahit hindi tugma ang returned — alisin sa pending/partial queue.
    var sf = String(statusFilter || '').toUpperCase();
    if (sf.indexOf('PENDING') !== -1 || sf.indexOf('PARTIAL') !== -1) {
      rows = rows.filter(function(d) {
        return !(String(d.doc_type || '').toUpperCase() === 'MRS' && d.processed_at);
      });
    }
    _allRequests.allDocs = rows;
    _allRequests.availAt = 0;

    console.log('[All Requests] Loaded ' + _allRequests.allDocs.length + ' requests');
    
    allRequestsComputeKPIs();
    await arRefreshLocks(false);
    allRequestsRender();
    
  } catch(err) {
    console.error('[allRequestsLoad]', err);
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty text-danger">' +
      'Failed: ' + erpEsc(err.message) + '</td></tr>';
  }
}

function allRequestsComputeKPIs() {
  var docs = _allRequests.allDocs;
  var pending = 0, partial = 0, today = 0, completedToday = 0;
  
  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  docs.forEach(function(d) {
    var s = String(d.status || '').toUpperCase();
    if (s === 'PENDING') pending++;
    else if (s === 'PARTIAL') partial++;
    
    var created = d.created_at ? new Date(d.created_at) : null;
    if (created && created >= todayStart) today++;
    
    var processed = d.processed_at ? new Date(d.processed_at) : null;
    if (processed && processed >= todayStart && s === 'COMPLETED') completedToday++;
  });
  
  document.getElementById('allKpiPending').textContent = pending;
  document.getElementById('allKpiPartial').textContent = partial;
  document.getElementById('allKpiToday').textContent = today;
  document.getElementById('allKpiCompletedToday').textContent = completedToday;
}

// Wrapper: when a category filter is active we need every request's categories first
async function allRequestsRender() {
  var tok = ++_allRequests.renderToken;
  var f = arCatFilterValue();
  if (f) {
    var tbody0 = document.getElementById('allTableBody');
    if (tbody0 && _allRequests.allDocs.some(function(d) { return !_allRequests.catByDoc[d.doc_no]; })) {
      tbody0.innerHTML = '<tr><td colspan="10" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Checking categories...</div></td></tr>';
    }
    await allRequestsEnsureCats(_allRequests.allDocs);
    if (tok !== _allRequests.renderToken) return;
  }
  if (arAvailFilterValue() && !_allRequests.availAt) {
    var tb1 = document.getElementById('allTableBody');
    if (tb1) tb1.innerHTML = '<tr><td colspan="10" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Checking stock availability...</div></td></tr>';
    await arLoadAvailability();
    if (tok !== _allRequests.renderToken) return;
  }
  allRequestsRenderNow();
  arCatCardsLoad(tok);
  // stock availability (background) — i-refresh ang view kapag may nagbago
  if (!_allRequests.availAt || (Date.now() - _allRequests.availAt) > 30000) {
    arLoadAvailability().then(function(changed) {
      if (changed && tok === _allRequests.renderToken) allRequestsRenderNow();
    });
  }
  // fill the Category column for the rows on screen (and the "for you" banner) if not loaded yet
  var start = (_allRequests.currentPage - 1) * _allRequests.pageSize;
  var visible = _allRequests.filteredDocs.slice(start, start + _allRequests.pageSize);
  var changed = await allRequestsEnsureCats(visible);
  if (tok !== _allRequests.renderToken) return;
  if (changed) allRequestsRenderNow();
}

function allRequestsRenderNow() {
  var tbody = document.getElementById('allTableBody');
  if (!tbody) return;
  
  var search = (document.getElementById('allSearchInput').value || '').toLowerCase().trim();
  
  var catFilter = arCatFilterValue();
  _allRequests.filteredDocs = _allRequests.allDocs.filter(function(d) {
    if (catFilter && !arDocHasCat(d.doc_no, catFilter)) return false;
    var af = arAvailFilterValue();
    if (af) {
      var av = _allRequests.avail[d.doc_no];
      if (!av) return false;
      if (af === 'ready' && av.level !== 'ready') return false;
      if (af === 'any' && av.level !== 'ready' && av.level !== 'some') return false;
    }
    if (!search) return true;
    var docNo = String(d.doc_no || '').toLowerCase();
    var req = String(d.requestor || '').toLowerCase();
    var jo = String(d.jo_no || '').toLowerCase();
    return docNo.indexOf(search) !== -1 || req.indexOf(search) !== -1 || jo.indexOf(search) !== -1;
  });
  
  var total = _allRequests.filteredDocs.length;
  var start = (_allRequests.currentPage - 1) * _allRequests.pageSize;
  var end = Math.min(start + _allRequests.pageSize, total);
  var pageItems = _allRequests.filteredDocs.slice(start, end);
  
  document.getElementById('allTableCount').textContent = total + ' items';
  document.getElementById('allPageTotal').textContent = total;
  document.getElementById('allPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('allPageEnd').textContent = end;
  document.getElementById('allPageLabel').textContent = 'Page ' + _allRequests.currentPage;
  
  document.getElementById('allBtnPrev').disabled = (_allRequests.currentPage <= 1);
  document.getElementById('allBtnNext').disabled = (end >= total);
  
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No requests found.</td></tr>';
    return;
  }
  
  var html = '';
  pageItems.forEach(function(d) {
    var dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';
    
    var statusUpper = String(d.status || 'PENDING').toUpperCase();
    var statusClass = 'status-pending';
    if (statusUpper === 'COMPLETED') statusClass = 'status-completed';
    else if (statusUpper === 'PARTIAL') statusClass = 'status-partial';
    else if (statusUpper === 'CANCELLED') statusClass = 'status-cancelled';
    
    var typeUpper = String(d.doc_type || '').toUpperCase();
    var typeBadge = typeUpper === 'MRIF' ? 'bg-warning text-dark' : 'bg-info text-dark';
    
    var safeDoc = String(d.doc_no || '').replace(/'/g, "\\'");
    var canCancelDoc = statusUpper === 'PENDING' && (
      (typeUpper === 'MRIF' && typeof window.mrifCanCancel === 'function' && window.mrifCanCancel()) ||
      (typeUpper === 'MRS'  && typeof window.mrsCanCancel  === 'function' && window.mrsCanCancel()));
    var canEditDoc = (localStorage.getItem('ivm_userRole') === 'warehouse') && (statusUpper === 'PENDING' || statusUpper === 'PARTIAL' || (statusUpper === 'COMPLETED' && typeUpper === 'MRIF'));
    
    html += '<tr' + (arIsMine(d.doc_no) ? ' class="ar-mine"' : '') + '>' +
      '<td><code>' + erpEsc(d.doc_no) + '</code>' + arPrintBadge(d.doc_no) + '</td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(d.requestor || '—') + '</td>' +
      '<td>' + erpEsc(d.department || '—') + '</td>' +
      '<td class="text-center"><span class="badge ' + typeBadge + '">' + typeUpper + '</span></td>' +
      '<td class="text-center">' + arCatCellHtml(d.doc_no) + '</td>' +
      '<td>' + erpEsc(d.jo_no || '—') + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '">' + statusUpper + '</span>' + arLockBadge(d.doc_no) + arAvailChip(d) + '</td>' +
      '<td class="text-center">' + (d.item_count || 0) + '</td>' +
      '<td class="text-center" style="white-space:nowrap;">' +
        '<button class="erp-action-btn" onclick="erpOpenPrintPreview(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="Print Preview">' +
          '<i class="bi bi-printer"></i>' +
        '</button> ' +
        '<button class="erp-action-btn primary" onclick="viewRequestDetails(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
        (canEditDoc ? ' <button class="erp-action-btn" onclick="openWarehouseEdit(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="Edit (fix unit, qty, items)">' +
          '<i class="bi bi-pencil-square"></i>' +
        '</button>' : '') +
        (canCancelDoc ? ' <button class="erp-action-btn" style="color:#b91c1c" onclick="' + (typeUpper === 'MRS' ? 'mrsCancel' : 'mrifCancel') + '(\'' + safeDoc + '\')" title="Cancel ' + typeUpper + ' (nagawa nang mali / duplicate)">' +
          '<i class="bi bi-x-circle"></i>' +
        '</button>' : '') +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
  allRequestsRenderMineBanner();
  arRenderAvailBanner();
}

function arIsMine(docNo) {
  var mine = arMyCats();
  var c = _allRequests.catByDoc[docNo];
  return !!(mine.length && c && mine.some(function(m) { return c[m] > 0; }));
}

// ── Requests per category (cards). Counts requests (not lines); a request with 2 categories counts in both. ──
function arRenderCatCards() {
  var el = document.getElementById('allCatCards');
  if (!el) return;
  var docs = _allRequests.allDocs || [];
  var stat = {};
  AR_CATEGORIES.forEach(function(k) { stat[k] = { req: 0, lines: 0, open: 0 }; });
  var unknown = 0;
  docs.forEach(function(d) {
    var c = _allRequests.catByDoc[d.doc_no];
    if (!c) { unknown++; return; }
    if (c._err) return;
    var s = String(d.status || '').toUpperCase();
    var isOpen = (s === 'PENDING' || s === 'PARTIAL') && !(String(d.doc_type || '').toUpperCase() === 'MRS' && d.processed_at);
    AR_CATEGORIES.forEach(function(k) {
      if (c[k] > 0) { stat[k].req++; stat[k].lines += c[k]; if (isOpen) stat[k].open++; }
    });
  });
  var cur = arCatFilterValue();
  el.innerHTML = AR_CATEGORIES.map(function(k) {
    var st = stat[k];
    return '<div class="ar-cc ' + k + (cur === k ? ' active' : '') + '" onclick="arCatCardClick(\'' + k + '\')" title="Click to filter">' +
      '<div class="t">' + k + '</div>' +
      '<div class="n">' + st.req + '</div>' +
      '<div class="s">request' + (st.req === 1 ? '' : 's') + ' · ' + st.lines + ' line' + (st.lines === 1 ? '' : 's') + '</div>' +
      '<div class="p">' + (st.open ? st.open + ' waiting to process' : '&nbsp;') + '</div>' +
    '</div>';
  }).join('') + (unknown ? '<div class="text-muted small" style="grid-column:1/-1;">counting ' + unknown + ' more request(s)…</div>' : '');
}

function arCatCardClick(k) {
  var sel = document.getElementById('allCatFilter');
  if (!sel) return;
  sel.value = (sel.value === k) ? '' : k;
  allRequestsOnCatChange();
}

// load categories of ALL loaded requests in the background so the cards are complete
async function arCatCardsLoad(tok) {
  arRenderCatCards();
  var changed = await allRequestsEnsureCats(_allRequests.allDocs);
  if (tok !== undefined && tok !== _allRequests.renderToken) return;
  if (changed) arRenderCatCards();
}

// "For you" banner: how many active requests contain my category
function allRequestsRenderMineBanner() {
  var el = document.getElementById('allMineBanner');
  if (!el) return;
  var mine = arMyCats();
  if (!mine.length) { el.style.display = 'none'; return; }
  var active = _allRequests.allDocs.filter(function(d) {
    var s = String(d.status || '').toUpperCase();
    return s === 'PENDING' || s === 'PARTIAL';
  });
  var known = active.filter(function(d) { return _allRequests.catByDoc[d.doc_no]; });
  var mineN = known.filter(function(d) { return arIsMine(d.doc_no); }).length;
  var unknown = active.length - known.length;
  var filtering = arCatFilterValue() === 'MINE';
  el.style.display = 'block';
  el.style.background = mineN ? '#e0f2fe' : '#f1f5f9';
  el.style.border = '1px solid ' + (mineN ? '#7dd3fc' : '#e2e8f0');
  el.innerHTML = '<i class="bi bi-star-fill me-2" style="color:#0ea5e9;"></i>' +
    '<strong>' + (mineN ? mineN + ' active request' + (mineN === 1 ? '' : 's') + ' for you' : 'Nothing waiting for you right now') + '</strong> ' +
    '<span class="text-muted">(' + mine.join(' + ') + ')' + (unknown ? ' · checking ' + unknown + ' more…' : '') + '</span> ' +
    (filtering
      ? '<a href="javascript:void(0)" onclick="document.getElementById(\'allCatFilter\').value=\'\';allRequestsOnCatChange()">Show all categories</a>'
      : '<a href="javascript:void(0)" onclick="document.getElementById(\'allCatFilter\').value=\'MINE\';allRequestsOnCatChange()">Show only mine</a>');
}

// ═══════════════════════════════════════════════════════════
// VIEW DETAILS
// ═══════════════════════════════════════════════════════════
async function viewRequestDetails(docNo, docType) {
  var modalEl = document.getElementById('requestDetailModal');
  if (!modalEl) return;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  
  document.getElementById('detailModalTitle').textContent = docNo;
  document.getElementById('requestDetailBody').innerHTML = 
    '<div class="text-center py-4"><div class="erp-spinner"></div></div>';
  document.getElementById('btnProcessRequest').style.display = 'none';
  
  modal.show();
  
  try {
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    var itemsRes = await erpFetch('doc_items', 'doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');
    
    if (!docRes || docRes.length === 0) {
      document.getElementById('requestDetailBody').innerHTML = 
        '<div class="alert alert-danger">Document not found</div>';
      return;
    }
    
    var doc = docRes[0];
    var items = itemsRes || [];
    
    _allRequests.currentDoc = { doc: doc, items: items };

    // category of each line
    var unk = {};
    items.forEach(function(it) { if (it.item_code && _allRequests.itemCat[it.item_code] === undefined) unk[it.item_code] = true; });
    var unkCodes = Object.keys(unk);
    if (unkCodes.length) {
      try {
        var cq = unkCodes.slice(0, 300).map(function(c) { return '"' + String(c).replace(/"/g, '') + '"'; }).join(',');
        var cr = await erpFetchAll('erp_items', 'select=item_code,category&item_code=in.(' + encodeURIComponent(cq) + ')&order=item_code.asc');
        (cr || []).forEach(function(r) { _allRequests.itemCat[r.item_code] = arNormCat(r.category); });
      } catch (ce) { console.warn('[viewRequestDetails] categories unavailable:', ce.message); }
    }
    var myCats = arMyCats();
    
    // Build content
    var html = '';
    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>Doc No:</strong> <code>' + erpEsc(doc.doc_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-primary">' + erpEsc(doc.doc_type) + '</span></div>';
    html += '<div class="col-md-6"><strong>Status:</strong> ' + erpEsc(doc.status) + '</div>';
    html += '<div class="col-md-6"><strong>Date:</strong> ' + (doc.created_at ? new Date(doc.created_at).toLocaleString() : '—') + '</div>';
    html += '<div class="col-md-6"><strong>Requestor:</strong> ' + erpEsc(doc.requestor || '—') + '</div>';
    if (doc.department) html += '<div class="col-md-6"><strong>Department:</strong> ' + erpEsc(doc.department) + '</div>';
    if (doc.jo_no) html += '<div class="col-md-6"><strong>JO No:</strong> ' + erpEsc(doc.jo_no) + '</div>';
    if (doc.gem_so_no) html += '<div class="col-md-6"><strong>GEM SO No:</strong> ' + erpEsc(doc.gem_so_no) + '</div>';
    if (doc.client_name) html += '<div class="col-md-6"><strong>Client:</strong> ' + erpEsc(doc.client_name) + '</div>';
    if (doc.project) html += '<div class="col-md-6"><strong>Project:</strong> ' + erpEsc(doc.project) + '</div>';
    if (doc.carried_from) html += '<div class="col-12"><span class="badge bg-info text-dark"><i class="bi bi-arrow-return-right me-1"></i>Carried from ' + erpEsc(doc.carried_from) + (doc.created_at ? ' · ' + erpEsc(arCbFmt(doc.created_at)) : '') + '</span></div>';
    if (doc.carried_to) html += '<div class="col-12"><span class="badge bg-secondary"><i class="bi bi-arrow-right me-1"></i>Balance carried to ' + erpEsc(doc.carried_to) + '</span></div>';
    if (doc.closed_at) html += '<div class="col-12"><span class="badge bg-dark"><i class="bi bi-clock me-1"></i>Closed: ' + erpEsc(arCbFmt(doc.closed_at)) + '</span></div>';
    html += '</div>';
    
    // Items table
    html += '<h6 class="mt-3">Items (' + items.length + ')</h6>';
    html += '<div class="table-responsive">';
    html += '<table class="erp-table" style="font-size:0.85rem;">';
    html += '<thead><tr>' +
      '<th>#</th><th>Item Code</th><th>Description</th><th class="text-center">Category</th>' +
      '<th class="text-center">Req Qty</th>' +
      '<th class="text-center">Issued Qty</th>' +
      '<th class="text-center">Unit</th>' +
      '<th>Remarks</th>' +
      '</tr></thead><tbody>';
    
    if (items.length === 0) {
      html += '<tr><td colspan="8" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
          '<td>' + erpEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + (function() {
            var k = _allRequests.itemCat[it.item_code];
            if (!k) return '<span class="text-muted">—</span>';
            var mn = myCats.indexOf(k) !== -1;
            return '<span class="ar-cat ' + k + (mn ? ' mine' : '') + '">' + (mn ? '★ ' : '') + k + '</span>';
          })() + '</td>' +
          '<td class="text-center">' + (it.requested_qty || 0) + '</td>' +
          '<td class="text-center">' + (it.issued_qty || 0) + '</td>' +
          '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
          '<td>' + erpEsc(it.remarks || '—') + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    
    document.getElementById('requestDetailBody').innerHTML = html;
    
    // Renumber (admin, MRIF, PENDING lang, wala pang naka-issue)
    var rbtn = document.getElementById('btnRenumber');
    if (rbtn) {
      var st0 = String(doc.status || '').toUpperCase();
      var anyIssued = (items || []).some(function(it) { return Number(it.issued_qty || 0) > 0; });
      rbtn.style.display = (arIsAdmin() && String(doc.doc_type || '').toUpperCase() === 'MRIF' && st0 === 'PENDING' && !doc.processed_at && !anyIssued) ? 'inline-flex' : 'none';
    }

    // Show Process button if status is PENDING or PARTIAL
    var status = String(doc.status || '').toUpperCase();
    var mrsDone = String(doc.doc_type || '').toUpperCase() === 'MRS' && doc.processed_at;
    if ((status === 'PENDING' || status === 'PARTIAL') && !mrsDone) {
      var pbtn = document.getElementById('btnProcessRequest');
      pbtn.style.display = 'inline-flex';
      var lk = arLockOf(doc.doc_no);
      if (lk && !lk.mine && !arIsAdmin()) {
        pbtn.disabled = true;
        pbtn.innerHTML = '<i class="bi bi-lock-fill me-1"></i>In process by ' + erpEsc(lk.name);
      } else {
        pbtn.disabled = false;
        pbtn.innerHTML = '<i class="bi bi-play-circle me-1"></i>Process Request';
      }
    }
    
  } catch(err) {
    console.error('[viewRequestDetails]', err);
    document.getElementById('requestDetailBody').innerHTML = 
      '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// PROCESS REQUEST (placeholder — full processing page to follow)
// ═══════════════════════════════════════════════════════════
async function arRenumberCurrent() {
  if (!_allRequests.currentDoc) return;
  var old = _allRequests.currentDoc.doc.doc_no;
  var ans = prompt('Renumber ' + old + '\n\nBlangko = kunin ang SUSUNOD na numero sa series.\nO mag-type ng sarili mong numero (hal. 21980):', '');
  if (ans === null) return;
  ans = String(ans).trim();
  var num = null;
  if (ans !== '') {
    num = parseInt(ans, 10);
    if (!(num > 0)) return erpShowToast('Invalid number', 'warning');
  }
  if (!confirm('Papalitan ang ' + old + ' ng bagong numero. Tuloy?')) return;
  try {
    var res = await fetch(erpUrl('rpc/erp_renumber_doc'), {
      method: 'POST', headers: erpHeaders(),
      body: JSON.stringify({ p_doc_no: old, p_username: arUsername(), p_new_number: num })
    });
    var text = await res.text(), data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) throw new Error((data && (data.message || data.error)) || text || ('HTTP ' + res.status));
    if (!data || !data.success) return erpShowToast((data && data.error) || 'Failed', 'danger');
    erpShowToast('✅ ' + data.old + ' → ' + data['new'], 'success');
    var m = bootstrap.Modal.getInstance(document.getElementById('requestDetailModal')); if (m) m.hide();
    if (typeof allRequestsLoad === 'function') allRequestsLoad();
  } catch (e) {
    erpShowToast('Failed: ' + e.message + ' (na-run mo na ba ang renumber-doc.sql?)', 'danger');
  }
}
window.arRenumberCurrent = arRenumberCurrent;

function processCurrentRequest() {
  if (!_allRequests.currentDoc) return;
  
  var doc = _allRequests.currentDoc.doc;
  var docNo = doc.doc_no;
  var docType = String(doc.doc_type || '').toUpperCase();

  if (String(doc.status || '').toUpperCase() === 'CANCELLED') {
    erpShowToast(docNo + ' ay CANCELLED na at hindi na maipoproseso.', 'warning');
    return;
  }

  var lk = arLockOf(docNo);
  if (lk && !lk.mine && !arIsAdmin()) {
    erpShowToast(lk.name + ' is already processing this request', 'warning');
    return;
  }
  
  // Close modal
  var modalEl = document.getElementById('requestDetailModal');
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
  
  // Navigate to process page
  if (docType === 'MRIF') {
    window.location.href = 'process-mrif.html?doc=' + encodeURIComponent(docNo);
  } else if (docType === 'MRS') {
    window.location.href = 'process-mrs.html?doc=' + encodeURIComponent(docNo);
  } else if (docType === 'MRR') {
    window.location.href = 'process-mrr.html?doc=' + encodeURIComponent(docNo);
  } else {
    erpShowToast('Unknown doc type: ' + docType, 'warning');
  }
}
// ═══════════════════════════════════════════════════════════
// FILTERS + PAGINATION
// ═══════════════════════════════════════════════════════════
function allRequestsOnSearch() {
  clearTimeout(_allRequests.searchTimer);
  _allRequests.searchTimer = setTimeout(function() {
    _allRequests.currentPage = 1;
    allRequestsRender();
  }, 300);
}

function allRequestsClearFilters() {
  document.getElementById('allSearchInput').value = '';
  document.getElementById('allTypeFilter').value = '';
  document.getElementById('allStatusFilter').value = 'PENDING,PARTIAL';
  document.getElementById('allDeptFilter').value = '';
  var avf = document.getElementById('allAvailFilter'); if (avf) avf.value = '';
  document.getElementById('allDateFrom').value = '';
  document.getElementById('allDateTo').value = '';
  try { localStorage.removeItem('ar_cat_filter'); } catch (e) {}
  allRequestsInitCatFilter();
  _allRequests.currentPage = 1;
  allRequestsLoad();
}

function allRequestsPagePrev() {
  if (_allRequests.currentPage > 1) {
    _allRequests.currentPage--;
    allRequestsRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function allRequestsPageNext() {
  var total = _allRequests.filteredDocs.length;
  var maxPage = Math.ceil(total / _allRequests.pageSize);
  if (_allRequests.currentPage < maxPage) {
    _allRequests.currentPage++;
    allRequestsRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// After a Warehouse Edit is saved, reload this table (warehouse-edit.js calls these hooks)
window.mrifListRefresh = function() { allRequestsLoad(); };
window.mrsListRefresh = function() { allRequestsLoad(); };

function allRequestsRefresh() {
  erpShowToast('Refreshing...', 'info');
  allRequestsLoad();
  allRequestsCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function allRequestsExport() {
  if (_allRequests.filteredDocs.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }
  
  var headers = ['Doc No.', 'Date', 'Requestor', 'Department', 'Type', 'JO No.', 'Status', 'Items'];
  var rows = _allRequests.filteredDocs.map(function(d) {
    return [
      d.doc_no || '',
      d.created_at ? new Date(d.created_at).toLocaleDateString() : '',
      d.requestor || '',
      d.department || '',
      d.doc_type || '',
      d.jo_no || '',
      d.status || '',
      d.item_count || 0
    ];
  });
  
  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) {
    csv += row.map(_csvEsc).join(',') + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'All_Requests_' + new Date().toISOString().slice(0, 10) + '.csv';
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
// HELPERS
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// STOCK AVAILABILITY — may stock na ba para sa naka-pending / partial na MRIF?
// Parehong rule ng Process MRIF:
//   Walang SOF ang MRIF : available = on-hand − lahat ng naka-reserve sa SOF
//   May SOF ang MRIF    : available = natitirang reserve ng SOF na iyon + libreng stock (max: on-hand)
// Kinukumpara sa BALANSE ng bawat line (requested − issued). Hindi nagbabago ng kahit ano sa database.
// Paalala: bawat MRIF ay sinusuri nang hiwalay — kung dalawang MRIF ang naghihintay sa parehong item,
// pareho silang puwedeng lumabas na "ready" kahit hindi sapat para sa dalawa.
// ═══════════════════════════════════════════════════════════
(function() {
  var st = document.createElement('style');
  st.textContent =
    '.ar-avail{display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:700;white-space:nowrap;cursor:help}' +
    '.ar-avail-ready{background:#dcfce7;color:#166534;border:1px solid #86efac}' +
    '.ar-avail-some{background:#fef9c3;color:#854d0e;border:1px solid #fde047}' +
    '.ar-avail-pulse{animation:arAvailPulse 1.6s ease-in-out 3}' +
    '@keyframes arAvailPulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}50%{box-shadow:0 0 0 6px rgba(34,197,94,0)}}';
  document.head.appendChild(st);
})();

function arAvailFilterValue() {
  var el = document.getElementById('allAvailFilter');
  return el ? el.value : '';
}

function allRequestsOnAvailChange() {
  _allRequests.currentPage = 1;
  allRequestsRender();
}

function arIsActiveMrif(d) {
  var s = String(d.status || '').toUpperCase();
  return String(d.doc_type || '').toUpperCase() === 'MRIF' && (s === 'PENDING' || s === 'PARTIAL');
}

function arNumFmt(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

function arQuote(list) {
  return list.map(function(c) { return '"' + String(c).replace(/"/g, '') + '"'; }).join(',');
}

// Ibinabalik true kapag may na-compute (para mag-re-render)
async function arLoadAvailability() {
  if (_allRequests.availBusy) return false;
  var docs = (_allRequests.allDocs || []).filter(arIsActiveMrif);
  if (!docs.length) {
    _allRequests.avail = {}; _allRequests.availAt = Date.now(); _allRequests.readySeen = _allRequests.readySeen || {};
    return true;
  }
  _allRequests.availBusy = true;
  try {
    // 1) mga line (balanse)
    var lines = [];
    for (var i = 0; i < docs.length; i += 60) {
      var chunk = encodeURIComponent(arQuote(docs.slice(i, i + 60).map(function(d) { return d.doc_no; })));
      var part = await erpFetchAll('doc_items', 'select=doc_no,item_code,requested_qty,issued_qty&doc_no=in.(' + chunk + ')&order=doc_no.asc');
      lines = lines.concat(part || []);
    }
    var need = lines.filter(function(l) { return l.item_code && (Number(l.requested_qty || 0) - Number(l.issued_qty || 0)) > 0; });

    // 2) on-hand + SOF reservations
    var codeSet = {}; need.forEach(function(l) { codeSet[l.item_code] = true; });
    var codes = Object.keys(codeSet);
    var onHand = {}, reservedAll = {}, reservedBySof = {};
    for (var k = 0; k < codes.length; k += 120) {
      var cl = encodeURIComponent(arQuote(codes.slice(k, k + 120)));
      var items = await erpFetchAll('erp_items', 'select=item_code,on_hand&item_code=in.(' + cl + ')&order=item_code.asc');
      (items || []).forEach(function(r) { onHand[r.item_code] = Number(r.on_hand || 0); });
      var alloc = await erpFetchAll('erp_sof_allocation_items', 'select=id,item_code,sof_no,allocated_qty,used_qty&item_code=in.(' + cl + ')&order=id.asc');
      (alloc || []).forEach(function(r) {
        var rem = Number(r.allocated_qty || 0) - Number(r.used_qty || 0);
        if (rem <= 0) return;
        reservedAll[r.item_code] = (reservedAll[r.item_code] || 0) + rem;
        var key = r.item_code + '||' + String(r.sof_no || '').trim();
        reservedBySof[key] = (reservedBySof[key] || 0) + rem;
      });
    }

    // 3) per MRIF
    var byDoc = {};
    need.forEach(function(l) { (byDoc[l.doc_no] = byDoc[l.doc_no] || []).push(l); });
    var result = {};
    docs.forEach(function(d) {
      var ls = byDoc[d.doc_no] || [];
      if (!ls.length) { result[d.doc_no] = { level: 'na', ok: 0, some: 0, total: 0, lines: [] }; return; }
      var sof = String(d.sof_no || d.gem_so_no || '').trim();
      var ok = 0, some = 0, detail = [];
      ls.forEach(function(l) {
        var n = Number(l.requested_qty || 0) - Number(l.issued_qty || 0);
        var oh = onHand[l.item_code] || 0;
        var free = Math.max(oh - (reservedAll[l.item_code] || 0), 0);
        var usable = sof ? Math.max(Math.min(oh, (reservedBySof[l.item_code + '||' + sof] || 0) + free), 0) : free;
        if (usable >= n) ok++;
        if (usable > 0) some++;
        detail.push({ code: l.item_code, need: n, usable: usable });
      });
      var level = ok === ls.length ? 'ready' : (some > 0 ? 'some' : 'none');
      result[d.doc_no] = { level: level, ok: ok, some: some, total: ls.length, lines: detail };
    });

    // 4) may BAGONG ready? (hindi tumutunog sa unang load)
    var nowReady = {};
    Object.keys(result).forEach(function(k) { if (result[k].level === 'ready') nowReady[k] = true; });
    if (_allRequests.readySeen) {
      var fresh = Object.keys(nowReady).filter(function(k) { return !_allRequests.readySeen[k]; });
      if (fresh.length) arAnnounceReady(fresh);
    }
    _allRequests.readySeen = nowReady;
    _allRequests.avail = result;
    _allRequests.availAt = Date.now();
    return true;
  } catch (e) {
    // Mas mabuting walang indicator kaysa maling "ready"
    console.warn('[All Requests] stock availability unavailable:', e.message);
    _allRequests.avail = {};
    _allRequests.availAt = Date.now();
    return true;
  } finally {
    _allRequests.availBusy = false;
  }
}

function arAnnounceReady(docNos) {
  try {
    var msg = docNos.length === 1
      ? '🟢 ' + docNos[0] + ' — may stock na! Pwede nang i-issue.'
      : '🟢 ' + docNos.length + ' MRIF ang may stock na — pwede nang i-issue.';
    erpShowToast(msg, 'success');
    if (window.erpAlerts && typeof window.erpAlerts.play === 'function') window.erpAlerts.play('done');
  } catch (e) {}
}

async function arAvailRefresh() {
  if (!(_allRequests.allDocs || []).length) return;
  _allRequests.availAt = 0;
  var changed = await arLoadAvailability();
  if (changed) allRequestsRenderNow();
}

function arAvailChip(d) {
  if (!arIsActiveMrif(d)) return '';
  var a = _allRequests.avail[d.doc_no];
  if (!a || (a.level !== 'ready' && a.level !== 'some')) return '';
  var tip = a.lines.slice(0, 8).map(function(l) {
    return l.code + ': kailangan ' + arNumFmt(l.need) + ' · available ' + arNumFmt(l.usable);
  }).join('\n') + (a.lines.length > 8 ? '\n… +' + (a.lines.length - 8) + ' pa' : '');
  if (a.level === 'ready') {
    return '<div class="ar-avail ar-avail-ready ar-avail-pulse" title="' + erpEsc('Kumpleto na ang stock para sa balanse ng request na ito.\n' + tip) + '">' +
      '<i class="bi bi-check-circle-fill"></i> Ready to issue</div>';
  }
  return '<div class="ar-avail ar-avail-some" title="' + erpEsc('May stock na ang ilang items (hindi pa lahat).\n' + tip) + '">' +
    '<i class="bi bi-box-seam"></i> ' + a.some + ' of ' + a.total + ' may stock</div>';
}

function arRenderAvailBanner() {
  var el = document.getElementById('allAvailBanner');
  if (!el) return;
  var docs = (_allRequests.allDocs || []).filter(arIsActiveMrif);
  var ready = docs.filter(function(d) { var a = _allRequests.avail[d.doc_no]; return a && a.level === 'ready'; });
  var some = docs.filter(function(d) { var a = _allRequests.avail[d.doc_no]; return a && a.level === 'some'; });
  if (!ready.length && !some.length) { el.style.display = 'none'; return; }
  var mineReady = ready.filter(function(d) { return arIsMine(d.doc_no); }).length;
  var af = arAvailFilterValue();
  el.style.display = 'block';
  el.style.background = ready.length ? '#f0fdf4' : '#fefce8';
  el.style.border = '1px solid ' + (ready.length ? '#86efac' : '#fde047');
  el.innerHTML = '<i class="bi bi-box-seam-fill me-2" style="color:' + (ready.length ? '#16a34a' : '#ca8a04') + ';"></i>' +
    (ready.length
      ? '<strong>' + ready.length + ' request' + (ready.length === 1 ? '' : 's') + ' ready to issue</strong> <span class="text-muted">— kumpleto na ang stock' +
        (mineReady ? ' · <b>' + mineReady + ' sa inyo</b>' : '') + '</span>'
      : '<strong>' + some.length + ' request' + (some.length === 1 ? '' : 's') + ' may available nang items</strong> <span class="text-muted">— hindi pa kumpleto</span>') +
    (some.length && ready.length ? ' <span class="text-muted">· +' + some.length + ' may partial stock</span>' : '') + ' ' +
    (af
      ? '<a href="javascript:void(0)" onclick="document.getElementById(\'allAvailFilter\').value=\'\';allRequestsOnAvailChange()">Show all</a>'
      : '<a href="javascript:void(0)" onclick="document.getElementById(\'allAvailFilter\').value=\'' + (ready.length ? 'ready' : 'any') + '\';allRequestsOnAvailChange()">Show ' + (ready.length ? 'ready only' : 'them') + '</a>');
}

console.log('✅ all-requests.js loaded');


// ═══════════════════════════════════════════════════════════
// ADMIN: ASSIGN PEOPLE TO CATEGORIES
// Saved immediately through RPC erp_set_category_assignees (admin only).
// ═══════════════════════════════════════════════════════════
var AR_REAL_CATS = ['COMPONENTS', 'CONSUMABLES', 'FABMAT'];
var _arUsers = [];

function arEnsureAssignModal() {
  if (document.getElementById('arAssignModal')) return;
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="modal fade" id="arAssignModal" tabindex="-1"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title"><i class="bi bi-people-fill me-2"></i>Who handles which category</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body" id="arAssignBody"></div>' +
      '<div class="modal-footer"><div class="me-auto small text-muted"><i class="bi bi-info-circle me-1"></i>Changes save right away. A person can handle more than one category, and a category can have more than one person.</div>' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>' +
    '</div></div></div>';
  document.body.appendChild(wrap.firstChild);
}

async function arOpenAssignModal() {
  if (!arIsAdmin()) { erpShowToast('Admin only', 'warning'); return; }
  if (_allRequests.assignSource !== 'db') {
    erpShowToast('Assignments are not set up in the database yet (run the SQL first).', 'warning');
    return;
  }
  arEnsureAssignModal();
  var body = document.getElementById('arAssignBody');
  body.innerHTML = '<div class="text-center py-4"><div class="erp-spinner"></div></div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('arAssignModal')).show();
  try {
    _arUsers = await erpFetchAll('v_users_admin', 'select=username,fullname,is_active,roles&order=fullname.asc');
  } catch (e) {
    body.innerHTML = '<div class="alert alert-danger">Could not load users: ' + erpEsc(e.message) + '</div>';
    return;
  }
  arRenderAssignModal();
}

function arRenderAssignModal() {
  var body = document.getElementById('arAssignBody');
  if (!body) return;
  var html = '';
  AR_REAL_CATS.forEach(function(cat) {
    var rows = _allRequests.assignRows.filter(function(r) { return String(r.category).toUpperCase() === cat; });
    var assigned = {};
    rows.forEach(function(r) { assigned[String(r.username).toLowerCase()] = true; });
    var activeCount = rows.filter(function(r) { return r.is_active !== false; }).length;

    html += '<div class="card mb-3"><div class="card-body py-3">' +
      '<div class="d-flex align-items-center mb-2"><span class="ar-cat ' + cat + '" style="font-size:0.85rem;">' + cat + '</span>' +
      (activeCount === 0 ? '<span class="ms-2 small text-danger fw-bold"><i class="bi bi-exclamation-triangle-fill me-1"></i>No one assigned</span>' : '') + '</div>' +
      '<div class="mb-2">';
    if (!rows.length) html += '<span class="text-muted small">—</span>';
    rows.forEach(function(r) {
      var inactive = r.is_active === false;
      html += '<span class="badge rounded-pill bg-light text-dark border me-1 mb-1" style="font-size:0.8rem;padding:6px 10px;' + (inactive ? 'opacity:.6;' : '') + '">' +
        erpEsc(r.fullname || r.username) + (inactive ? ' <span class="text-danger">(inactive)</span>' : '') +
        ' <a href="javascript:void(0)" class="text-danger ms-1" title="Remove" onclick="arAssignRemove(\'' + cat + '\', \'' + encodeURIComponent(r.username) + '\')"><i class="bi bi-x-circle-fill"></i></a></span>';
    });
    html += '</div><div class="d-flex gap-2"><select class="form-select form-select-sm" id="arAdd_' + cat + '" style="max-width:320px;"><option value="">+ Add person…</option>';
    _arUsers.filter(function(u) { return u.is_active !== false && !assigned[String(u.username).toLowerCase()]; })
      .sort(function(a, b) {
        var aw = (a.roles || []).indexOf('warehouse') !== -1 ? 0 : 1, bw = (b.roles || []).indexOf('warehouse') !== -1 ? 0 : 1;
        return aw - bw || String(a.fullname || '').localeCompare(String(b.fullname || ''));
      })
      .forEach(function(u) {
        html += '<option value="' + erpEsc(u.username) + '">' + erpEsc(u.fullname || u.username) +
          ((u.roles || []).indexOf('warehouse') !== -1 ? '' : ' (not warehouse)') + '</option>';
      });
    html += '</select><button class="btn btn-sm btn-primary" onclick="arAssignAdd(\'' + cat + '\')"><i class="bi bi-plus-lg"></i> Add</button></div>' +
      '</div></div>';
  });
  body.innerHTML = html;
}

function arAssignAdd(cat) {
  var sel = document.getElementById('arAdd_' + cat);
  if (!sel || !sel.value) { erpShowToast('Choose a person first', 'warning'); return; }
  var list = _allRequests.assignRows.filter(function(r) { return String(r.category).toUpperCase() === cat; })
    .map(function(r) { return r.username; });
  list.push(sel.value);
  arSaveCategory(cat, list);
}

function arAssignRemove(cat, encUsername) {
  var u = decodeURIComponent(encUsername);
  var list = _allRequests.assignRows.filter(function(r) { return String(r.category).toUpperCase() === cat; })
    .map(function(r) { return r.username; })
    .filter(function(x) { return String(x).toLowerCase() !== String(u).toLowerCase(); });
  arSaveCategory(cat, list);
}

async function arSaveCategory(cat, usernames) {
  try {
    var res = await fetch(erpUrl('rpc/erp_set_category_assignees'), {
      method: 'POST', headers: erpHeaders(),
      body: JSON.stringify({ p_category: cat, p_usernames: usernames, p_admin: arUsername() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    await allRequestsLoadAssignments();
    arRenderAssignModal();
    // my own category may have changed → refresh the filter and the table
    var cur = arCatFilterValue();
    allRequestsInitCatFilter();
    var sel = document.getElementById('allCatFilter');
    if (sel && cur && Array.prototype.some.call(sel.options, function(o) { return o.value === cur; })) sel.value = cur;
    allRequestsRender();
    erpShowToast('Saved', 'success');
  } catch (e) {
    console.error('[arSaveCategory]', e);
    erpShowToast('Could not save: ' + e.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// CLOSE BALANCE (MRIF) — pili lang ang isasara, kahit anong petsa
//   needs erp-close-balance-mrif.sql
// Para sa mga MRIF na kailangan nang ipadala sa Finance (hal. Consumables /
// Fabmat na regular ang gamit) nang hindi kasama ang mga MRIF na matagal
// pa (hal. Components na naghihintay ng delivery).
// Sa bawat napili: ang NAIBIGAY lang ang mananatili sa lumang MRIF; ang
// balanse ay lilipat sa bagong MRIF (PENDING). Hindi ginagalaw ang stock at SOF.
// ═══════════════════════════════════════════════════════════
var _cb = { rows: [], sel: {}, cat: 'ALL', q: '', until: '', phrase: '', stage: 'pick' };

function arCanCloseBalance() {
  try { return arIsAdmin() || String(localStorage.getItem('ivm_userRole') || '').toLowerCase().indexOf('warehouse') !== -1; }
  catch (e) { return false; }
}

async function arCbRpc(body) {
  var res = await fetch(erpUrl('rpc/erp_close_balance_mrif'), { method: 'POST', headers: erpHeaders(), body: JSON.stringify(body) });
  var text = await res.text(), data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    var msg = (data && (data.message || data.error)) || text || ('HTTP ' + res.status);
    if (res.status === 404 || /could not find the function|PGRST202/i.test(msg)) {
      throw new Error('Wala pa sa Supabase ang erp_close_balance_mrif. Nothing was closed. (Run erp-close-balance-mrif.sql muna.)');
    }
    throw new Error(msg);
  }
  return data;
}

function arCbToday() {
  var n = new Date(), p = function(x) { return String(x).padStart(2, '0'); };
  return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
}

async function arOpenCloseBalance() {
  var old = document.getElementById('closeBalModal'); if (old) old.remove();
  _cb = { rows: [], sel: {}, cat: 'ALL', q: '', until: '', phrase: '', stage: 'pick' };
  var w = document.createElement('div');
  w.innerHTML =
  '<div class="modal fade" id="closeBalModal" tabindex="-1" data-bs-backdrop="static"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
    '<div class="modal-header" style="background:#92400e;color:#fff;"><h5 class="modal-title"><i class="bi bi-send-check me-2"></i>Close Balance — MRIF <span class="small fw-normal opacity-75">(pili lang ang isasara)</span></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
    '<div class="modal-body" id="cbBody"><div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading MRIFs…</div></div>' +
    '<div class="modal-footer flex-column align-items-stretch" id="cbFooter"></div>' +
  '</div></div></div>';
  document.body.appendChild(w.firstChild);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('closeBalModal')).show();
  try {
    await arCbLoadRows();
    arCbRenderPick();
  } catch (e) {
    console.error('[CloseBalance]', e);
    document.getElementById('cbBody').innerHTML = '<div class="alert alert-danger">Failed to load: ' + erpEsc(e.message) + '</div>';
  }
}

async function arCbLoadRows() {
  var docs = await erpFetchAll('documents', 'select=doc_no,status,requestor,department,jo_no,created_at&doc_type=eq.MRIF&status=in.(PENDING,PARTIAL)&order=created_at.asc');
  docs = docs || [];
  var lines = [];
  for (var i = 0; i < docs.length; i += 60) {
    var chunk = docs.slice(i, i + 60).map(function(d) { return '"' + String(d.doc_no).replace(/"/g, '') + '"'; }).join(',');
    var part = await erpFetchAll('doc_items', 'select=doc_no,requested_qty,issued_qty&doc_no=in.(' + encodeURIComponent(chunk) + ')&order=doc_no.asc');
    lines = lines.concat(part || []);
  }
  var agg = {};
  lines.forEach(function(l) {
    var a = agg[l.doc_no] || (agg[l.doc_no] = { lines: 0, linesLeft: 0, issued: 0, left: 0 });
    var req = Number(l.requested_qty) || 0, iss = Number(l.issued_qty) || 0;
    a.lines++; a.issued += iss;
    if (req - iss > 0) { a.linesLeft++; a.left += (req - iss); }
  });
  await allRequestsEnsureCats(docs);
  try { await arRefreshLocks(false); } catch (e) {}
  _cb.rows = docs.map(function(d) {
    var a = agg[d.doc_no] || { lines: 0, linesLeft: 0, issued: 0, left: 0 };
    var cats = _allRequests.catByDoc[d.doc_no] || {};
    return { doc_no: d.doc_no, status: d.status, requestor: d.requestor, department: d.department, jo_no: d.jo_no,
             created_at: d.created_at, lines: a.lines, linesLeft: a.linesLeft, issued: a.issued, left: a.left, cats: cats };
  });
}

function arCbVisible() {
  var q = String(_cb.q || '').toLowerCase().trim();
  return _cb.rows.filter(function(r) {
    if (_cb.cat !== 'ALL' && !(r.cats[_cb.cat] > 0)) return false;
    if (_cb.until && r.created_at && String(r.created_at).slice(0, 10) > _cb.until) return false;
    if (q) {
      var hay = (r.doc_no + ' ' + (r.requestor || '') + ' ' + (r.jo_no || '') + ' ' + (r.department || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

var AR_CB_CAT_STYLE = { COMPONENTS: 'bg-primary', CONSUMABLES: 'bg-success', FABMAT: 'bg-warning text-dark', OTHER: 'bg-secondary' };

function arCbRenderPick() {
  _cb.stage = 'pick';
  var body = document.getElementById('cbBody'), foot = document.getElementById('cbFooter');
  var catCount = { ALL: _cb.rows.length };
  AR_CATEGORIES.forEach(function(c) { catCount[c] = _cb.rows.filter(function(r) { return r.cats[c] > 0; }).length; });
  var chips = ['ALL'].concat(AR_CATEGORIES).map(function(c) {
    var label = c === 'ALL' ? 'All' : c.charAt(0) + c.slice(1).toLowerCase();
    var on = _cb.cat === c;
    return '<button type="button" class="btn btn-sm ' + (on ? 'btn-dark' : 'btn-outline-secondary') + '" onclick="arCbSetCat(\'' + c + '\')">' + label + ' <span class="badge ' + (on ? 'bg-light text-dark' : 'bg-secondary') + '">' + (catCount[c] || 0) + '</span></button>';
  }).join(' ');

  body.innerHTML =
    '<div class="alert alert-warning py-2 small mb-3">Piliin ang mga MRIF na <b>isasara na</b> (kahit anong petsa — hindi kailangang month-end). ' +
    'Sa bawat napili, ang <b>naibigay lang</b> ang mananatili sa lumang MRIF (handa na para sa Finance); ang <b>balanse</b> ay lilipat sa bagong MRIF na PENDING. ' +
    'Ang hindi napili ay <b>hindi gagalawin</b>. Hindi ginagalaw ang stock at SOF. Per-MRIF ang pagsara — kasama ang lahat ng line ng napili.</div>' +
    '<div class="d-flex flex-wrap gap-2 align-items-center mb-2"><span class="small fw-bold">Category:</span>' + chips + '</div>' +
    '<div class="row g-2 align-items-end mb-2">' +
      '<div class="col-md-4"><input id="cbSearch" class="form-control form-control-sm" placeholder="Search MRIF no., requestor, JO, dept…" value="' + erpEsc(_cb.q) + '" oninput="arCbSearch(this.value)"></div>' +
      '<div class="col-auto"><label class="form-label small mb-0">Ginawa hanggang</label><input type="date" class="form-control form-control-sm" value="' + erpEsc(_cb.until) + '" onchange="arCbUntil(this.value)"></div>' +
      '<div class="col-auto ms-auto d-flex gap-2"><button class="btn btn-sm btn-outline-primary" onclick="arCbSelectShown(true)">Select all shown</button><button class="btn btn-sm btn-outline-secondary" onclick="arCbSelectShown(false)">Unselect shown</button></div>' +
    '</div>' +
    '<div id="cbTable"></div>';

  arCbRenderTable();
  foot.innerHTML =
    '<div class="d-flex flex-wrap gap-3 align-items-center">' +
      '<div class="small text-muted"><i class="bi bi-clock me-1"></i>Itatala ang mismong petsa at oras ng pag-Apply.</div>' +
      '<div class="small" id="cbSelInfo"></div>' +
      '<div class="ms-auto d-flex gap-2"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>' +
      '<button class="btn btn-warning fw-bold" id="cbReview" onclick="arCbReview()" disabled><i class="bi bi-eye me-1"></i>Review selected</button></div>' +
    '</div>';
  arCbUpdateInfo();
}

function arCbRenderTable() {
  var el = document.getElementById('cbTable'); if (!el) return;
  var rows = arCbVisible();
  if (!rows.length) {
    el.innerHTML = '<div class="text-center py-4 text-muted">' + (_cb.rows.length ? 'Walang tugma sa filter.' : 'Walang PENDING o PARTIAL na MRIF. ✅') + '</div>';
    return;
  }
  var allOn = rows.every(function(r) { return _cb.sel[r.doc_no]; });
  el.innerHTML = '<div class="table-responsive" style="max-height:48vh;overflow-y:auto;"><table class="table table-sm table-hover align-middle" style="font-size:.85rem">' +
    '<thead class="table-light sticky-top"><tr><th style="width:34px"><input type="checkbox" class="form-check-input" ' + (allOn ? 'checked' : '') + ' onchange="arCbSelectShown(this.checked)"></th>' +
    '<th>MRIF</th><th>Date</th><th>Status</th><th>Requestor</th><th>Dept</th><th>JO</th><th>Categories</th><th class="text-end">Issued</th><th class="text-end">Balance</th></tr></thead><tbody>' +
    rows.map(function(r) {
      var lk = arLockOf(r.doc_no);
      var cats = AR_CATEGORIES.filter(function(c) { return r.cats[c] > 0; }).map(function(c) {
        return '<span class="badge ' + AR_CB_CAT_STYLE[c] + ' me-1">' + c.charAt(0) + c.slice(1).toLowerCase() + ' ' + r.cats[c] + '</span>';
      }).join('') || '<span class="text-muted">—</span>';
      return '<tr class="' + (_cb.sel[r.doc_no] ? 'table-warning' : '') + '" style="cursor:pointer" onclick="arCbRowClick(event,\'' + erpEsc(String(r.doc_no).replace(/'/g, "\\'")) + '\')">' +
        '<td><input type="checkbox" class="form-check-input" data-doc="' + erpEsc(r.doc_no) + '" ' + (_cb.sel[r.doc_no] ? 'checked' : '') + ' onchange="arCbToggle(this)"></td>' +
        '<td><code>' + erpEsc(r.doc_no) + '</code>' + (lk ? '<div class="small text-danger"><i class="bi bi-lock-fill"></i> ' + erpEsc(lk.name) + '</div>' : '') + '</td>' +
        '<td>' + (r.created_at ? new Date(r.created_at).toLocaleDateString() : '—') + '</td>' +
        '<td>' + erpEsc(r.status) + '</td><td>' + erpEsc(r.requestor || '—') + '</td><td>' + erpEsc(r.department || '—') + '</td><td>' + erpEsc(r.jo_no || '—') + '</td>' +
        '<td>' + cats + '</td>' +
        '<td class="text-end">' + Number(r.issued).toLocaleString() + '</td>' +
        '<td class="text-end fw-bold">' + Number(r.left).toLocaleString() + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function arCbUpdateInfo() {
  var n = Object.keys(_cb.sel).filter(function(k) { return _cb.sel[k]; }).length;
  var info = document.getElementById('cbSelInfo'), btn = document.getElementById('cbReview');
  if (info) info.innerHTML = '<b>' + n + '</b> selected' + (n ? '' : ' <span class="text-muted">— pumili muna ng MRIF</span>');
  if (btn) { btn.disabled = n === 0; btn.innerHTML = '<i class="bi bi-eye me-1"></i>Review selected (' + n + ')'; }
}

function arCbSetCat(c) { _cb.cat = c; arCbRenderPick(); }
function arCbSearch(v) { _cb.q = v; arCbRenderTable(); arCbUpdateInfo(); }
function arCbUntil(v) { _cb.until = v; arCbRenderTable(); }
function arCbToggle(cb) { _cb.sel[cb.getAttribute('data-doc')] = cb.checked; arCbRenderTable(); arCbUpdateInfo(); }
function arCbRowClick(ev, docNo) {
  if (ev.target && ev.target.tagName === 'INPUT') return;
  _cb.sel[docNo] = !_cb.sel[docNo]; arCbRenderTable(); arCbUpdateInfo();
}
function arCbSelectShown(on) {
  arCbVisible().forEach(function(r) { _cb.sel[r.doc_no] = !!on; });
  arCbRenderTable(); arCbUpdateInfo();
}
function arCbSelected() { return Object.keys(_cb.sel).filter(function(k) { return _cb.sel[k]; }); }
function arCbFmt(iso) {
  var d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// Step 2 — dry run (walang binabago) para makita ang eksaktong mangyayari
async function arCbReview() {
  var picked = arCbSelected(); if (!picked.length) return;
  var body = document.getElementById('cbBody'), foot = document.getElementById('cbFooter');
  body.innerHTML = '<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Checking…</div>';
  foot.innerHTML = '';
  try {
    var r = await arCbRpc({ p_user: arUsername(), p_doc_nos: picked, p_apply: false });
    if (!r || !r.success) throw new Error((r && r.error) || 'Failed');
    _cb.stage = 'confirm'; _cb.phrase = r.confirm_phrase;
    var docs = r.docs || [], locked = docs.filter(function(d) { return d.locked_by; }).length;
    var badge = { CARRIED: '<span class="badge bg-info text-dark">May matitira → bagong MRIF</span>', CANCELLED: '<span class="badge bg-secondary">Walang naibigay → buong lilipat, CANCELLED ang luma</span>', COMPLETED: '<span class="badge bg-success">Kumpleto na</span>' };
    body.innerHTML =
      '<div class="alert alert-info py-2 small">Isasara ang <b>' + docs.length + '</b> na MRIF · isasara ngayon (<b>' + erpEsc(arCbFmt(r.closed_at)) + '</b>) · ang bagong MRIF (balanse) ay dated sa mismong oras ng pagsara' +
      (locked ? ' · <span class="text-danger"><b>' + locked + '</b> ang may nagpoproseso ngayon</span>' : '') + '. Ang hindi napili ay hindi gagalawin.</div>' +
      ((r.skipped && r.skipped.length) ? '<div class="alert alert-secondary py-2 small">Nilaktawan (hindi na PENDING/PARTIAL): ' + r.skipped.map(erpEsc).join(', ') + '</div>' : '') +
      '<div class="table-responsive"><table class="table table-sm align-middle" style="font-size:.85rem"><thead><tr><th>MRIF</th><th>Status</th><th>Requestor</th><th>Dept</th><th>JO</th><th class="text-center">Lines na lilipat</th><th class="text-end">Qty na lilipat</th><th>Gagawin</th></tr></thead><tbody>' +
      docs.map(function(d) {
        return '<tr' + (d.locked_by ? ' class="table-warning"' : '') + '><td><code>' + erpEsc(d.doc_no) + '</code>' + (d.locked_by ? '<div class="small text-danger"><i class="bi bi-lock-fill"></i> ' + erpEsc(d.locked_by) + '</div>' : '') + '</td><td>' + erpEsc(d.status) + '</td><td>' + erpEsc(d.requestor || '—') + '</td><td>' + erpEsc(d.department || '—') + '</td><td>' + erpEsc(d.jo_no || '—') + '</td><td class="text-center">' + d.lines_to_carry + ' / ' + d.lines + '</td><td class="text-end">' + Number(d.qty_to_carry).toLocaleString() + '</td><td>' + (badge[d.action] || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    foot.innerHTML =
      '<div class="d-flex flex-wrap gap-2 align-items-center"><label class="small mb-0">I-type ang <b><code>' + erpEsc(_cb.phrase) + '</code></b> para ituloy:</label>' +
      '<input id="cbConfirm" class="form-control form-control-sm" style="max-width:220px" autocomplete="off" oninput="arCbCheck()" placeholder="' + erpEsc(_cb.phrase) + '">' +
      '<div class="ms-auto d-flex gap-2"><button class="btn btn-outline-secondary" onclick="arCbRenderPick()"><i class="bi bi-arrow-left me-1"></i>Back</button>' +
      '<button class="btn btn-warning fw-bold" id="cbGo" disabled onclick="arCbApply()"><i class="bi bi-send-check me-1"></i>Close balance of ' + docs.length + ' MRIF</button></div></div>';
  } catch (e) {
    body.innerHTML = '<div class="alert alert-danger">' + erpEsc(e.message) + '</div>';
    foot.innerHTML = '<div class="text-end"><button class="btn btn-outline-secondary" onclick="arCbRenderPick()"><i class="bi bi-arrow-left me-1"></i>Back</button></div>';
  }
}

function arCbCheck() {
  var ok = String(document.getElementById('cbConfirm').value || '').trim().toUpperCase() === String(_cb.phrase).toUpperCase();
  document.getElementById('cbGo').disabled = !ok;
}

async function arCbApply() {
  var btn = document.getElementById('cbGo'); btn.disabled = true;
  var orig = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Closing…';
  try {
    var r = await arCbRpc({ p_user: arUsername(), p_doc_nos: arCbSelected(), p_apply: true, p_confirm: document.getElementById('cbConfirm').value.trim() });
    if (!r || !r.success) throw new Error((r && r.error) || 'Failed');
    document.getElementById('cbBody').innerHTML =
      '<div class="text-center py-4"><i class="bi bi-check-circle-fill text-success" style="font-size:3rem"></i><h5 class="mt-2">Tapos na ang Close Balance</h5>' +
      '<div class="text-muted">' + r.docs_carried + ' MRIF ang inilipat · ' + r.lines_carried + ' line(s) · ' + r.cancelled_originals + ' na walang naibigay ay na-CANCEL' + (r.already_complete ? ' · ' + r.already_complete + ' ay kumpleto na (na-COMPLETED lang)' : '') + ' · mga bagong MRIF ay PENDING</div><div class="mt-2"><span class="badge bg-dark"><i class="bi bi-clock me-1"></i>Closed: ' + erpEsc(arCbFmt(r.closed_at)) + '</span></div></div>';
    document.getElementById('cbFooter').innerHTML = '<div class="text-end"><button class="btn btn-primary" data-bs-dismiss="modal">Done</button></div>';
    if (typeof allRequestsLoad === 'function') allRequestsLoad();
  } catch (e) {
    erpShowToast('Failed: ' + e.message, 'danger');
    btn.disabled = false; btn.innerHTML = orig;
  }
}

window.arOpenCloseBalance = arOpenCloseBalance; window.arOpenMonthClose = arOpenCloseBalance;
window.arCbSetCat = arCbSetCat; window.arCbSearch = arCbSearch; window.arCbUntil = arCbUntil; window.arCbToggle = arCbToggle;
window.arCbRowClick = arCbRowClick; window.arCbSelectShown = arCbSelectShown; window.arCbReview = arCbReview;
window.arCbCheck = arCbCheck; window.arCbApply = arCbApply; window.arCbRenderPick = arCbRenderPick;
