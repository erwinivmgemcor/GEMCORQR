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
  locks: {},          // doc_no -> {locked_by, locked_by_name, locked_at, idle_seconds}  (requests being processed)
  assignByUser: {},   // username(lowercase) -> [categories]   (from the database)
  assignRows: [],     // raw rows: {username, fullname, category, is_active}
  assignSource: 'fallback',
  catByDoc: {},       // doc_no -> { COMPONENTS: n, ... }
  itemCat: {},        // item_code -> category
  renderToken: 0,
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
  var assignBtn = document.getElementById('allAssignBtn');
  if (assignBtn && arIsAdmin()) assignBtn.style.display = '';
  // assignments first, so the default filter ("mine") is right on the first load
  allRequestsLoadAssignments().then(function() {
    allRequestsInitCatFilter();
    allRequestsLoad();
  });
  // who is processing what: refresh every 20 s while the tab is visible
  setInterval(function() { if (!document.hidden) arRefreshLocks(true); }, 20000);
});

// ── "in process" locks (see doc-lock.js) ──
async function arRefreshLocks(rerender) {
  if (!window.erpDocLock) return;
  var map = await erpDocLock.list();
  if (map === null) return;                      // lock tables not installed → feature stays hidden
  _allRequests.locks = map;
  if (rerender && _allRequests.allDocs.length) allRequestsRenderNow();
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
  allRequestsRenderNow();
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
    
    var typeUpper = String(d.doc_type || '').toUpperCase();
    var typeBadge = typeUpper === 'MRIF' ? 'bg-warning text-dark' : 'bg-info text-dark';
    
    var safeDoc = String(d.doc_no || '').replace(/'/g, "\\'");
    
    html += '<tr' + (arIsMine(d.doc_no) ? ' class="ar-mine"' : '') + '>' +
      '<td><code>' + erpEsc(d.doc_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(d.requestor || '—') + '</td>' +
      '<td>' + erpEsc(d.department || '—') + '</td>' +
      '<td class="text-center"><span class="badge ' + typeBadge + '">' + typeUpper + '</span></td>' +
      '<td class="text-center">' + arCatCellHtml(d.doc_no) + '</td>' +
      '<td>' + erpEsc(d.jo_no || '—') + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '">' + statusUpper + '</span>' + arLockBadge(d.doc_no) + '</td>' +
      '<td class="text-center">' + (d.item_count || 0) + '</td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="viewRequestDetails(\'' + safeDoc + '\', \'' + typeUpper + '\')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
  allRequestsRenderMineBanner();
}

function arIsMine(docNo) {
  var mine = arMyCats();
  var c = _allRequests.catByDoc[docNo];
  return !!(mine.length && c && mine.some(function(m) { return c[m] > 0; }));
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
function processCurrentRequest() {
  if (!_allRequests.currentDoc) return;
  
  var doc = _allRequests.currentDoc.doc;
  var docNo = doc.doc_no;
  var docType = String(doc.doc_type || '').toUpperCase();

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
