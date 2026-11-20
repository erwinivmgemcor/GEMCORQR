// ============================================================
// GEMCOR ERP — Aging Monitor (v2.0)
// Shows how long stock has been sitting without being issued.
// Data : erp_items + erp_v_item_monthly (same source as Monthly Movement:
//        legacy sheet Jan–Oct 2026 + live system from Nov 2026).
// Read-only — writes nothing.
//
// Aging = whole months since the item was last ISSUED (MRIF). Current month = 0.
//   ACTIVE   issued this month or last month            (0–1)
//   NEW      received in the last 2 months, not used yet (so it is not called idle)
//   SLOW     last issued 2–3 months ago
//   AGING    last issued 4–6 months ago
//   DORMANT  last issued 7+ months ago
//   NONE     never issued since the data starts (Jan 2026)
// "Idle" = AGING + DORMANT + NONE (4+ months).
// ============================================================

var AG_START = { y: 2026, m: 1 };
var AG_MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var AG_T = { activeMax: 1, slowMax: 3, agingMax: 6, newRecv: 2 };   // thresholds in months
var AG_STATUS = [
  { k: 'ACTIVE',  t: 'Active',    d: 'Issued this month or last month',        c: '#16a34a', r: 0 },
  { k: 'NEW',     t: 'New Stock', d: 'Received in the last 2 months, not used yet', c: '#3b82f6', r: 1 },
  { k: 'SLOW',    t: 'Slow',      d: 'Last issued 2–3 months ago',             c: '#eab308', r: 2, dark: true },
  { k: 'AGING',   t: 'Aging',     d: 'Last issued 4–6 months ago',             c: '#f97316', r: 3 },
  { k: 'DORMANT', t: 'Dormant',   d: 'Last issued 7+ months ago',              c: '#ef4444', r: 4 },
  { k: 'NONE',    t: 'No Usage',  d: 'Never issued since ' + AG_MN[AG_START.m - 1] + ' ' + AG_START.y, c: '#991b1b', r: 5 }
];
var AG_IDLE = { AGING: 1, DORMANT: 1, NONE: 1 };

var AG = {
  items: [], recs: [], base: [], view: [],
  status: '', cat: '', page: 1, pageSize: 100,
  sortKey: 'risk', sortDir: -1, timer: null, loadId: 0, nowIdx: 0
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  var sel = document.getElementById('agStatus');
  if (sel) sel.innerHTML = '<option value="">All Statuses</option>' +
    AG_STATUS.map(function(s) { return '<option value="' + s.k + '">' + s.t + '</option>'; }).join('');
  var sl = document.getElementById('agStartLbl'); if (sl) sl.textContent = AG_MN[AG_START.m - 1] + ' ' + AG_START.y;
  agCheckHealth();
  agLoad();
});

async function agCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var r = await erpHealthCheck();
    if (r.success) { dot.className = 'dot dot-ok'; text.textContent = 'Connected (' + r.latency + 'ms)'; }
    else { dot.className = 'dot dot-error'; text.textContent = 'Offline'; }
  } catch (e) { dot.className = 'dot dot-error'; text.textContent = 'Error'; }
}

// ═══════════════════════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════════════════════
function agMonthIdx(s) {
  s = String(s || '');
  var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10);
  return (isNaN(y) || isNaN(m)) ? 0 : y * 12 + m;
}
function agIdxLabel(idx) {
  if (!idx) return '';
  var y = Math.floor((idx - 1) / 12), m = (idx - 1) % 12;
  return AG_MN[m] + ' ' + y;
}

async function agLoad() {
  var myId = ++AG.loadId;
  var tbody = document.getElementById('agBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading aging data…</div></td></tr>';
  try {
    var res = await Promise.all([
      erpFetchAll('erp_items',
        'select=item_code,description,category,location,base_unit,on_hand,unit_cost' +
        '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false&order=item_code.asc'),
      erpFetchAll('erp_v_item_monthly', 'select=item_code,month_start,mrif_qty,mrr_qty&order=item_code.asc,month_start.asc')
    ]);
    if (myId !== AG.loadId) return;

    var now = new Date();
    AG.nowIdx = now.getFullYear() * 12 + now.getMonth() + 1;
    AG.items = res[0] || [];

    // last issued / last received month + total issued, per item
    var mv = {};
    (res[1] || []).forEach(function(r) {
      var idx = agMonthIdx(r.month_start); if (!idx) return;
      var o = mv[r.item_code] || (mv[r.item_code] = { li: 0, lr: 0, ytd: 0 });
      var a = Number(r.mrif_qty || 0), b = Number(r.mrr_qty || 0);
      if (a > 0) { if (idx > o.li) o.li = idx; o.ytd += a; }
      if (b > 0 && idx > o.lr) o.lr = idx;
    });
    AG.mv = mv;

    var u = document.getElementById('agUpdated');
    if (u) u.textContent = 'Updated ' + now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) +
      ' • data from ' + AG_MN[AG_START.m - 1] + ' ' + AG_START.y + ' to date';

    agPopulateFilters();
    agBuild();
    agApply();
  } catch (err) {
    console.error('[agLoad]', err);
    var msg = 'Monthly history is not available (' + erpEsc(err.message || err) + '). Make sure erp-history-setup.sql and erp-history-import.sql were run in Supabase — the same data used by Monthly Movement.';
    var s = document.getElementById('agSummary');
    if (s) { s.className = 'ag-summary bad'; s.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i><div>' + msg + '</div>'; }
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="erp-empty text-danger"><i class="bi bi-exclamation-triangle-fill me-2"></i>Failed to load.</td></tr>';
  }
}

function agStatusOf(idle, recAgo) {
  if (idle !== null && idle <= AG_T.activeMax) return 'ACTIVE';
  if (recAgo !== null && recAgo <= AG_T.newRecv) return 'NEW';
  if (idle === null) return 'NONE';
  if (idle <= AG_T.slowMax) return 'SLOW';
  if (idle <= AG_T.agingMax) return 'AGING';
  return 'DORMANT';
}
function agDef(k) { return AG_STATUS.filter(function(s) { return s.k === k; })[0]; }

function agBuild() {
  AG.recs = AG.items.map(function(it) {
    var m = AG.mv[it.item_code] || { li: 0, lr: 0, ytd: 0 };
    var oh = Number(it.on_hand || 0), cost = Number(it.unit_cost || 0);
    var idle = m.li ? Math.max(0, AG.nowIdx - m.li) : null;
    var recAgo = m.lr ? Math.max(0, AG.nowIdx - m.lr) : null;
    var st = agStatusOf(idle, recAgo);
    return {
      code: it.item_code, desc: it.description || '', cat: it.category || '', loc: it.location || '',
      unit: it.base_unit || '', oh: oh, cost: cost, val: Math.max(0, oh) * cost,
      li: m.li, lr: m.lr, ytd: m.ytd, idle: idle, st: st, rank: agDef(st).r
    };
  });
}

function agPopulateFilters() {
  function fill(id, key) {
    var sel = document.getElementById(id); if (!sel) return;
    var keep = sel.value, seen = {};
    AG.items.forEach(function(it) { var v = String(it[key] || '').trim(); if (v) seen[v] = 1; });
    var first = sel.options[0].outerHTML;
    sel.innerHTML = first + Object.keys(seen).sort().map(function(v) { return '<option value="' + erpEsc(v) + '">' + erpEsc(v) + '</option>'; }).join('');
    sel.value = keep;
  }
  fill('agCategory', 'category');
  fill('agLocation', 'location');
}

// ═══════════════════════════════════════════════════════════
// FILTER + COMPUTE
// ═══════════════════════════════════════════════════════════
function agApply() {
  var q = (document.getElementById('agSearch').value || '').toLowerCase().trim();
  var cat = document.getElementById('agCategory').value;
  var loc = document.getElementById('agLocation').value;
  var withZero = document.getElementById('agZero').checked;

  AG.base = AG.recs.filter(function(r) {
    if (!withZero && !(r.oh > 0)) return false;
    if (cat && r.cat !== cat) return false;
    if (loc && r.loc !== loc) return false;
    if (q && (r.code + ' ' + r.desc).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  AG.view = AG.status ? AG.base.filter(function(r) { return r.st === AG.status; }) : AG.base.slice();
  AG.page = 1;

  var ss = document.getElementById('agStatus'); if (ss) ss.value = AG.status;
  agRenderSummary();
  agRenderBuckets();
  agRenderCats();
  agSortView();
  agRender();
}

function agOnSearch() { clearTimeout(AG.timer); AG.timer = setTimeout(agApply, 250); }
function agSetStatus(k) { AG.status = (AG.status === k) ? '' : k; agApply(); }
function agSetStatusFromSelect() { AG.status = document.getElementById('agStatus').value; agApply(); }
function agSetCat(c) {
  var sel = document.getElementById('agCategory');
  sel.value = (sel.value === c) ? '' : c;
  agApply();
}

function agClear() {
  document.getElementById('agSearch').value = '';
  document.getElementById('agCategory').value = '';
  document.getElementById('agLocation').value = '';
  document.getElementById('agZero').checked = false;
  AG.status = ''; AG.sortKey = 'risk'; AG.sortDir = -1;
  agApply();
}

function agRefresh() { agToast('Refreshing…'); agLoad(); }

function agSort(key) {
  if (AG.sortKey === key) AG.sortDir = -AG.sortDir;
  else { AG.sortKey = key; AG.sortDir = (key === 'code') ? 1 : -1; }
  agSortView(); AG.page = 1; agRender();
}

function agSortView() {
  var k = AG.sortKey, d = AG.sortDir;
  var sub = document.getElementById('agSubtitle');
  if (sub) sub.textContent = k === 'risk' ? 'Worst status first, then highest value' :
    k === 'idle' ? 'Sorted by months idle' : k === 'value' ? 'Sorted by stock value' : k === 'onhand' ? 'Sorted by on-hand quantity' : 'Sorted by item code';
  AG.view.sort(function(a, b) {
    var r;
    if (k === 'code') r = String(a.code).localeCompare(String(b.code));
    else if (k === 'onhand') r = a.oh - b.oh;
    else if (k === 'value') r = a.val - b.val;
    else if (k === 'idle') r = (a.idle === null ? 99 : a.idle) - (b.idle === null ? 99 : b.idle);
    else r = a.rank - b.rank;
    if (r === 0) r = a.val - b.val;   // tie-break: higher value first when sorting descending
    return r * d;
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function agPeso(n) { return '₱' + Math.round(Number(n || 0)).toLocaleString('en-US'); }
function agPesoShort(n) {
  n = Number(n || 0); var a = Math.abs(n);
  if (a >= 1e6) return '₱' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return '₱' + Math.round(n / 1e3).toLocaleString('en-US') + 'K';
  return agPeso(n);
}
function agPct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
function agSet(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

function agTotals() {
  var t = { value: 0, items: AG.base.length, by: {} };
  AG_STATUS.forEach(function(s) { t.by[s.k] = { n: 0, v: 0 }; });
  AG.base.forEach(function(r) { t.value += r.val; t.by[r.st].n++; t.by[r.st].v += r.val; });
  t.idleN = t.by.AGING.n + t.by.DORMANT.n + t.by.NONE.n;
  t.idleV = t.by.AGING.v + t.by.DORMANT.v + t.by.NONE.v;
  return t;
}

function agRenderSummary() {
  var t = agTotals(), box = document.getElementById('agSummary');

  agSet('agKpiTotal', agPesoShort(t.value));
  agSet('agKpiTotalSub', t.items.toLocaleString('en-US') + ' item' + (t.items === 1 ? '' : 's') + (document.getElementById('agZero').checked ? '' : ' with stock'));
  agSet('agKpiActive', agPesoShort(t.by.ACTIVE.v));
  agSet('agKpiActiveSub', agPct(t.by.ACTIVE.v, t.value) + '% of value • ' + t.by.ACTIVE.n.toLocaleString('en-US') + (t.by.ACTIVE.n === 1 ? ' item' : ' items'));
  agSet('agKpiIdle', agPesoShort(t.idleV));
  agSet('agKpiIdleSub', agPct(t.idleV, t.value) + '% of value • ' + t.idleN.toLocaleString('en-US') + (t.idleN === 1 ? ' item' : ' items'));
  agSet('agKpiNone', agPesoShort(t.by.NONE.v));
  agSet('agKpiNoneSub', t.by.NONE.n.toLocaleString('en-US') + (t.by.NONE.n === 1 ? ' item' : ' items') + ' never issued');

  if (!t.items) { box.className = 'ag-summary'; box.innerHTML = '<i class="bi bi-inbox"></i><div>No items match the current filters.</div>'; return; }

  var pct = agPct(t.idleV, t.value), cls, icon, html;
  if (t.idleN === 0) {
    cls = 'good'; icon = 'bi-check-circle-fill';
    html = '<b>All stock is moving.</b> Nothing in this view has been idle for 4 months or more.';
  } else {
    cls = pct >= 20 ? 'bad' : pct >= 8 ? 'warn' : 'good';
    icon = cls === 'good' ? 'bi-info-circle-fill' : 'bi-exclamation-triangle-fill';
    html = '<b>' + agPesoShort(t.idleV) + ' (' + pct + '%)</b> of stock value — <b>' + t.idleN.toLocaleString('en-US') + ' item' + (t.idleN === 1 ? '' : 's') +
      '</b> — has not been issued in 4 or more months.';
    var sub = [];
    if (t.by.NONE.n) sub.push(agPesoShort(t.by.NONE.v) + ' of it (' + t.by.NONE.n.toLocaleString('en-US') + (t.by.NONE.n === 1 ? ' item' : ' items') + ') has had no issuance at all since ' + AG_MN[AG_START.m - 1] + ' ' + AG_START.y + '.');
    var top = agIdleCats()[0];
    if (top) sub.push('Largest idle category: ' + erpEsc(top.name) + ' (' + agPesoShort(top.v) + ').');
    if (sub.length) html += '<span class="sub">' + sub.join(' ') + '</span>';
  }
  box.className = 'ag-summary ' + cls;
  box.innerHTML = '<i class="bi ' + icon + '"></i><div>' + html + '</div>';
}

function agRenderBuckets() {
  var t = agTotals();
  document.getElementById('agStack').innerHTML = AG_STATUS.map(function(s) {
    var w = t.value > 0 ? (t.by[s.k].v / t.value * 100) : 0;
    return '<span style="width:' + w.toFixed(2) + '%;background:' + s.c + '" title="' + s.t + ' — ' + agPesoShort(t.by[s.k].v) + ' (' + Math.round(w) + '%)"></span>';
  }).join('');
  document.getElementById('agBuckets').innerHTML = AG_STATUS.map(function(s) {
    var b = t.by[s.k];
    return '<div class="ag-bucket' + (AG.status === s.k ? ' on' : '') + '" style="--c:' + s.c + '" onclick="agSetStatus(\'' + s.k + '\')" title="Click to filter">' +
      '<div class="t">' + s.t + '</div><div class="d">' + s.d + '</div>' +
      '<div class="v">' + agPesoShort(b.v) + '</div>' +
      '<div class="n">' + b.n.toLocaleString('en-US') + ' item' + (b.n === 1 ? '' : 's') + '</div>' +
      '<div class="p">' + agPct(b.v, t.value) + '% of stock value</div></div>';
  }).join('');
}

function agIdleCats() {
  var m = {};
  AG.base.forEach(function(r) { if (AG_IDLE[r.st] && r.val > 0) { var c = r.cat || '(No category)'; m[c] = (m[c] || 0) + r.val; } });
  return Object.keys(m).map(function(k) { return { name: k, v: m[k] }; }).sort(function(a, b) { return b.v - a.v; });
}

function agRenderCats() {
  var list = agIdleCats(), host = document.getElementById('agCats');
  if (!list.length) { host.innerHTML = '<div class="ag-empty">No idle stock (4+ months) in this view.</div>'; return; }
  var total = list.reduce(function(s, x) { return s + x.v; }, 0), max = list[0].v, cur = document.getElementById('agCategory').value;
  host.innerHTML = list.slice(0, 8).map(function(x) {
    var real = x.name === '(No category)' ? '' : x.name;
    return '<div class="ag-cat' + (cur && cur === real ? ' on' : '') + '" data-c="' + erpEsc(real) + '" title="' + erpEsc(x.name) + '">' +
      '<div class="nm">' + erpEsc(x.name) + '</div>' +
      '<div class="tk"><div class="fl" style="width:' + Math.max(2, x.v / max * 100).toFixed(1) + '%"></div></div>' +
      '<div class="vl">' + agPesoShort(x.v) + '<small>' + agPct(x.v, total) + '%</small></div></div>';
  }).join('');
  host.querySelectorAll('.ag-cat').forEach(function(el) {
    el.onclick = function() { var c = el.getAttribute('data-c'); if (c) agSetCat(c); };
  });
}

function agRender() {
  var tbody = document.getElementById('agBody');
  var total = AG.view.length;
  agSet('agCount', total.toLocaleString('en-US') + ' item' + (total === 1 ? '' : 's'));

  document.querySelectorAll('#ag-page th i[data-s]').forEach(function(i) {
    i.className = 'bi' + (i.getAttribute('data-s') === AG.sortKey ? (AG.sortDir === 1 ? ' bi-caret-up-fill' : ' bi-caret-down-fill') : '');
  });

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty"><i class="bi bi-inbox fs-3 d-block mb-2"></i>No items match the current filters.</td></tr>';
    document.getElementById('agPager').innerHTML = '';
    return;
  }

  var pages = Math.max(1, Math.ceil(total / AG.pageSize));
  if (AG.page > pages) AG.page = pages;
  var from = (AG.page - 1) * AG.pageSize, to = Math.min(total, from + AG.pageSize);

  var html = '';
  for (var i = from; i < to; i++) {
    var r = AG.view[i], d = agDef(r.st);
    var idleTxt = r.idle === null ? '—' : (r.idle === 0 ? 'This month' : r.idle + (r.idle === 1 ? ' month' : ' months'));
    var li = agIdxLabel(r.li), lr = agIdxLabel(r.lr);
    html += '<tr>' +
      '<td class="text-muted">' + (i + 1) + '</td>' +
      '<td><a class="ag-item-link" href="item-in-out.html?code=' + encodeURIComponent(r.code) + '" title="View Item In &amp; Out">' + erpEsc(r.code) + '</a></td>' +
      '<td><div class="ag-desc" title="' + erpEsc(r.desc) + '">' + erpEsc(r.desc || '—') + '</div></td>' +
      '<td>' + erpEsc(r.cat || '—') + '</td>' +
      '<td class="text-end fw-bold">' + erpNum(r.oh) + ' <span class="text-muted fw-normal small">' + erpEsc(r.unit) + '</span></td>' +
      '<td class="text-end fw-bold">' + (r.cost ? agPeso(r.val) : '<span class="text-warning" title="No unit cost">—</span>') + '</td>' +
      '<td class="ag-date' + (li ? '' : ' none') + '">' + (li || '—') + '</td>' +
      '<td class="ag-date' + (lr ? '' : ' none') + '">' + (lr || '—') + '</td>' +
      '<td class="text-center ag-idle"' + (r.idle === null ? ' title="Never issued since ' + AG_MN[AG_START.m - 1] + ' ' + AG_START.y + '"' : '') + '>' + idleTxt + '</td>' +
      '<td class="text-center"><span class="ag-badge' + (d.dark ? ' dark-text' : '') + '" style="--c:' + d.c + '" title="' + erpEsc(d.d) + '">' + d.t + '</span></td>' +
    '</tr>';
  }
  tbody.innerHTML = html;

  document.getElementById('agPager').innerHTML =
    '<span>Showing <b>' + (from + 1).toLocaleString('en-US') + '–' + to.toLocaleString('en-US') + '</b> of <b>' + total.toLocaleString('en-US') + '</b></span>' +
    '<span><button ' + (AG.page <= 1 ? 'disabled' : '') + ' onclick="agPage(-1)"><i class="bi bi-chevron-left"></i> Prev</button> ' +
    '<span class="mx-2">Page ' + AG.page + ' / ' + pages + '</span> ' +
    '<button ' + (AG.page >= pages ? 'disabled' : '') + ' onclick="agPage(1)">Next <i class="bi bi-chevron-right"></i></button></span>';
}

function agPage(d) {
  AG.page += d; agRender();
  var w = document.querySelector('#ag-page .erp-table-wrap'); if (w) w.scrollTop = 0;
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function agExport() {
  var rows = AG.view;
  if (!rows.length) return agToast('Nothing to export');
  function q(x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }
  function ym(idx) { return idx ? (Math.floor((idx - 1) / 12) + '-' + String((idx - 1) % 12 + 1).padStart(2, '0')) : ''; }
  var lines = [['Item Code', 'Description', 'Category', 'Location', 'Unit', 'On-Hand', 'Unit Cost', 'Stock Value', 'Last Issued (YYYY-MM)', 'Last Received (YYYY-MM)', 'Months Idle', 'Status', 'Total Issued Since ' + AG_MN[AG_START.m - 1] + ' ' + AG_START.y].map(q).join(',')];
  rows.forEach(function(r) {
    lines.push([r.code, r.desc, r.cat, r.loc, r.unit, r.oh, r.cost, r.val.toFixed(2), ym(r.li), ym(r.lr), r.idle === null ? '' : r.idle, agDef(r.st).t, r.ytd].map(q).join(','));
  });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Inventory_Aging_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
  agToast('✅ Exported ' + rows.length + ' items');
}

function agToast(msg) {
  var el = document.getElementById('erpToast');
  if (!el || typeof bootstrap === 'undefined') { console.log('[Aging]', msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 }).show();
}

window.agRefresh = agRefresh; window.agApply = agApply; window.agClear = agClear; window.agOnSearch = agOnSearch;
window.agSort = agSort; window.agSetStatus = agSetStatus; window.agSetStatusFromSelect = agSetStatusFromSelect;
window.agPage = agPage; window.agExport = agExport;
console.log('✅ aging-monitor.js v2.0 loaded');
