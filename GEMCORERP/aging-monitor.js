// ============================================================
// GEMCOR ERP — Aging Monitor (v1.0)
// Inventory aging per item: ilang araw nang walang labas (MRIF) / walang galaw.
// Reads: erp_items + erp_stock_ledger  •  Read-only, walang sinusulat sa database.
//
// Definitions (sumusunod sa convention ng Weekly Monitoring: MRIF / MRR / MRS sa transaction_type o reference_doc)
//   Last Issued   = pinakabagong MRIF na may qty_out
//   Last Received = pinakabagong MRR na may qty_in
//   Last Movement = pinakabago sa MRIF / MRR / MRS (hindi kasama ang manual ADJ)
//   Days Idle     = ngayon − petsa ng napiling basis
//     • Basis ISSUE: huling issue → kung never issued, huling receive → kung wala, unang record sa ledger
//     • Basis MOVE : huling movement → kung wala, unang record sa ledger
// ============================================================

var AG_DAY = 86400000;
var AG_BUCKETS = [
  { k: '0', t: '0–30 days',    min: 0,   max: 30,  c: '#16a34a' },
  { k: '1', t: '31–60 days',   min: 31,  max: 60,  c: '#65a30d' },
  { k: '2', t: '61–90 days',   min: 61,  max: 90,  c: '#eab308' },
  { k: '3', t: '91–180 days',  min: 91,  max: 180, c: '#f97316' },
  { k: '4', t: '181–365 days', min: 181, max: 365, c: '#ef4444' },
  { k: '5', t: 'Over 1 year',  min: 366, max: 1e9, c: '#991b1b' },
  { k: '6', t: 'No record',    min: null, max: null, c: '#94a3b8' }
];
var AG_CACHE_KEY = 'ag_dates_v1';
var AG_CACHE_MS = 10 * 60 * 1000;

var AG = {
  items: [], dates: {}, recs: [], base: [], view: [],
  bucket: '', page: 1, pageSize: 100,
  sortKey: 'days', sortDir: -1,
  timer: null, loadId: 0, now: Date.now()
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  agCheckHealth();
  agLoad(false);
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
async function agLoad(force) {
  var myId = ++AG.loadId;
  var tbody = document.getElementById('agBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="erp-empty"><div class="erp-spinner"></div>' +
    '<div class="mt-2">Binabasa ang items at stock ledger… (maaaring matagalan nang kaunti sa unang load)</div></td></tr>';
  try {
    AG.now = Date.now();
    var res = await Promise.all([
      erpFetchAll('erp_items',
        'select=item_code,description,category,location,base_unit,on_hand,unit_cost,inventory_movement' +
        '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false&order=item_code.asc'),
      agGetDates(!!force)
    ]);
    if (myId !== AG.loadId) return;

    AG.items = res[0] || [];
    AG.dates = res[1].map;
    var u = document.getElementById('agUpdated');
    if (u) u.textContent = 'Updated ' + new Date(res[1].at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) +
      (res[1].cached ? ' (cached — i-click ang ↻ para sa bago)' : ' • ' + res[1].rows.toLocaleString('en-US') + ' ledger rows');

    agPopulateFilters();
    agBuild();
    agApply();
  } catch (err) {
    console.error('[agLoad]', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="erp-empty text-danger"><i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + erpEsc(err.message) + '</td></tr>';
  }
}

// Kinukuha ang petsa kada item mula sa ledger (may 10-min cache sa browser para mabilis ang balik)
async function agGetDates(force) {
  if (!force) {
    try {
      var c = JSON.parse(sessionStorage.getItem(AG_CACHE_KEY) || 'null');
      if (c && c.d && (Date.now() - c.t) < AG_CACHE_MS) return { map: c.d, rows: c.n || 0, at: c.t, cached: true };
    } catch (e) {}
  }
  var rows = await erpFetchAll('erp_stock_ledger',
    'select=item_code,qty_in,qty_out,transaction_type,reference_doc,transaction_date&order=transaction_date.desc,item_code.asc') || [];
  var map = agAggregate(rows);
  var now = Date.now();
  try { sessionStorage.setItem(AG_CACHE_KEY, JSON.stringify({ t: now, n: rows.length, d: map })); } catch (e) {}
  return { map: map, rows: rows.length, at: now, cached: false };
}

// i = last issued, r = last received, s = last returned (MRS), f = first record (any type)
function agAggregate(rows) {
  var m = {};
  rows.forEach(function(tx) {
    var code = tx.item_code; if (!code) return;
    var ts = tx.transaction_date ? new Date(tx.transaction_date).getTime() : NaN;
    if (isNaN(ts)) return;
    var o = m[code] || (m[code] = { i: 0, r: 0, s: 0, f: ts });
    if (ts < o.f) o.f = ts;
    var tag = (String(tx.transaction_type || '') + ' ' + String(tx.reference_doc || '')).toUpperCase();
    var qin = Number(tx.qty_in || 0), qout = Number(tx.qty_out || 0);
    if (tag.indexOf('MRIF') > -1)      { if (qout > 0 && ts > o.i) o.i = ts; }
    else if (tag.indexOf('MRR') > -1)  { if (qin > 0 && ts > o.r) o.r = ts; }
    else if (tag.indexOf('MRS') > -1)  { if (qin > 0 && ts > o.s) o.s = ts; }
  });
  return m;
}

function agBuild() {
  AG.recs = AG.items.map(function(it) {
    var d = AG.dates[it.item_code] || {};
    var oh = Number(it.on_hand || 0), cost = Number(it.unit_cost || 0);
    return {
      code: it.item_code, desc: it.description || '', cat: it.category || '', loc: it.location || '',
      unit: it.base_unit || '', oh: oh, cost: cost, val: Math.max(0, oh) * cost,
      iss: d.i || 0, rec: d.r || 0, mv: Math.max(d.i || 0, d.r || 0, d.s || 0), first: d.f || 0,
      mvName: it.inventory_movement || '',
      days: null, b: '6', never: false
    };
  });
}

function agPopulateFilters() {
  function fill(id, key) {
    var sel = document.getElementById(id); if (!sel) return;
    var keep = sel.value, seen = {};
    AG.items.forEach(function(it) { var v = (it[key] || '').trim(); if (v) seen[v] = 1; });
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
function agBucketOf(days) {
  if (days === null) return '6';
  for (var i = 0; i < 6; i++) if (days >= AG_BUCKETS[i].min && days <= AG_BUCKETS[i].max) return AG_BUCKETS[i].k;
  return '5';
}
function agBucketDef(k) { return AG_BUCKETS[Number(k)]; }

function agApply() {
  var q = (document.getElementById('agSearch').value || '').toLowerCase().trim();
  var basis = document.getElementById('agBasis').value;
  var cat = document.getElementById('agCategory').value;
  var loc = document.getElementById('agLocation').value;
  var onlyNever = document.getElementById('agNever').checked;
  var withZero = document.getElementById('agZero').checked;

  var base = AG.recs.filter(function(r) {
    if (!withZero && !(r.oh > 0)) return false;
    if (cat && r.cat !== cat) return false;
    if (loc && r.loc !== loc) return false;
    if (q && (r.code + ' ' + r.desc).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });

  base.forEach(function(r) {
    var ref, never;
    if (basis === 'MOVE') { never = !r.mv; ref = r.mv || r.first; }
    else { never = !r.iss; ref = r.iss || r.rec || r.first; }
    r.never = never;
    r.days = ref ? Math.max(0, Math.floor((AG.now - ref) / AG_DAY)) : null;
    r.b = agBucketOf(r.days);
  });
  if (onlyNever) base = base.filter(function(r) { return r.never; });

  AG.base = base;
  AG.view = AG.bucket === '' ? base : base.filter(function(r) { return r.b === AG.bucket; });
  AG.page = 1;

  var nl = document.getElementById('agKpiNeverLbl');
  if (nl) nl.textContent = basis === 'MOVE' ? 'No Movement' : 'Never Issued';
  var nc = document.getElementById('agNeverLbl');
  if (nc) nc.textContent = basis === 'MOVE' ? ' Walang galaw lang (never moved)' : ' Never issued lang';
  var st = document.getElementById('agSubtitle');
  if (st) st.textContent = basis === 'MOVE' ? 'Batay sa huling galaw (labas o pasok)' : 'Batay sa huling labas (MRIF)';

  agRenderKPIs();
  agRenderBuckets();
  agSortView();
  agRender();
}

function agOnSearch() { clearTimeout(AG.timer); AG.timer = setTimeout(agApply, 250); }

function agSetBucket(k) { AG.bucket = (AG.bucket === k) ? '' : k; agApply(); }

function agClear() {
  document.getElementById('agSearch').value = '';
  document.getElementById('agCategory').value = '';
  document.getElementById('agLocation').value = '';
  document.getElementById('agBasis').value = 'ISSUE';
  document.getElementById('agNever').checked = false;
  document.getElementById('agZero').checked = false;
  AG.bucket = '';
  AG.sortKey = 'days'; AG.sortDir = -1;
  agApply();
}

function agRefresh() { agToast('Refreshing...'); agLoad(true); }

function agSort(key) {
  if (AG.sortKey === key) AG.sortDir = -AG.sortDir;
  else { AG.sortKey = key; AG.sortDir = (key === 'code') ? 1 : -1; }
  agSortView(); AG.page = 1; agRender();
}

function agSortView() {
  var k = AG.sortKey, d = AG.sortDir;
  AG.view.sort(function(a, b) {
    var r;
    if (k === 'code') r = String(a.code).localeCompare(String(b.code));
    else if (k === 'onhand') r = a.oh - b.oh;
    else if (k === 'value') r = a.val - b.val;
    else r = (a.days === null ? -1 : a.days) - (b.days === null ? -1 : b.days);
    if (r === 0) r = b.val - a.val;
    return r * d;
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function agPeso(n) { return erpPeso(Math.round(Number(n || 0))); }
function agDate(ts) { return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
function agDur(days) {
  if (days === null) return '—';
  if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
  return days.toLocaleString('en-US') + ' d';
}
function agSet(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }

function agRenderKPIs() {
  var b = AG.base, tv = 0, av = 0, an = 0, nv = 0, nn = 0, old = null;
  b.forEach(function(r) {
    tv += r.val;
    if (r.days !== null && r.days > 90) { an++; av += r.val; }
    if (r.never) { nn++; nv += r.val; }
    if (r.days !== null && (!old || r.days > old.days)) old = r;
  });
  agSet('agKpiItems', erpNum(b.length));
  agSet('agKpiItemsSub', document.getElementById('agZero').checked ? 'Kasama ang walang stock' : 'Items na may stock');
  agSet('agKpiValue', agPeso(tv));
  agSet('agKpiAged', erpNum(an) + ' item' + (an === 1 ? '' : 's'));
  agSet('agKpiAgedSub', agPeso(av) + ' • ' + (tv > 0 ? Math.round(av / tv * 100) : 0) + '% ng value');
  agSet('agKpiNever', erpNum(nn));
  agSet('agKpiNeverSub', agPeso(nv) + ' ang naka-tengga');
  agSet('agKpiOldest', old ? agDur(old.days) : '—');
  agSet('agKpiOldestSub', old ? old.code : ' ');
}

function agRenderBuckets() {
  var tv = 0, agg = {};
  AG_BUCKETS.forEach(function(x) { agg[x.k] = { n: 0, v: 0 }; });
  AG.base.forEach(function(r) { agg[r.b].n++; agg[r.b].v += r.val; tv += r.val; });
  document.getElementById('agBuckets').innerHTML = AG_BUCKETS.map(function(x) {
    var a = agg[x.k], pct = tv > 0 ? Math.round(a.v / tv * 100) : 0;
    return '<div class="ag-bucket' + (AG.bucket === x.k ? ' on' : '') + '" style="--c:' + x.c + '" onclick="agSetBucket(\'' + x.k + '\')" title="I-click para i-filter">' +
      '<div class="t">' + x.t + '</div><div class="n">' + erpNum(a.n) + '</div>' +
      '<div class="v">' + agPeso(a.v) + '</div><div class="p">' + pct + '% ng stock value</div>' +
      '<div class="bar"><span style="width:' + pct + '%"></span></div></div>';
  }).join('');
}

function agRender() {
  var tbody = document.getElementById('agBody');
  var total = AG.view.length;
  agSet('agCount', erpNum(total) + ' item' + (total === 1 ? '' : 's'));

  // sort icons
  document.querySelectorAll('#ag-page th i[data-s]').forEach(function(i) {
    i.className = 'bi' + (i.getAttribute('data-s') === AG.sortKey ? (AG.sortDir === 1 ? ' bi-caret-up-fill' : ' bi-caret-down-fill') : '');
  });

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="11" class="erp-empty"><i class="bi bi-inbox fs-3 d-block mb-2"></i>Walang item na tumutugma sa filters.</td></tr>';
    document.getElementById('agPager').innerHTML = '';
    return;
  }

  var pages = Math.max(1, Math.ceil(total / AG.pageSize));
  if (AG.page > pages) AG.page = pages;
  var from = (AG.page - 1) * AG.pageSize, to = Math.min(total, from + AG.pageSize);
  var basis = document.getElementById('agBasis').value;
  var tagTxt = basis === 'MOVE' ? 'NO MOVEMENT' : 'NEVER ISSUED';

  var html = '';
  for (var i = from; i < to; i++) {
    var r = AG.view[i], bd = agBucketDef(r.b);
    var lastRec = agDate(r.rec), lastIss = agDate(r.iss);
    html += '<tr>' +
      '<td class="text-muted">' + (i + 1) + '</td>' +
      '<td><a class="ag-item-link" href="item-in-out.html?code=' + encodeURIComponent(r.code) + '" title="Tingnan ang Item In &amp; Out">' + erpEsc(r.code) + '</a></td>' +
      '<td><div class="ag-desc" title="' + erpEsc(r.desc) + '">' + erpEsc(r.desc || '—') + '</div></td>' +
      '<td>' + erpEsc(r.cat || '—') + '</td>' +
      '<td>' + erpEsc(r.loc || '—') + '</td>' +
      '<td class="text-end fw-bold">' + erpNum(r.oh) + ' <span class="text-muted fw-normal small">' + erpEsc(r.unit) + '</span></td>' +
      '<td class="text-end fw-bold">' + (r.cost ? agPeso(r.val) : '<span class="text-warning" title="Walang unit cost">—</span>') + '</td>' +
      '<td class="ag-date' + (lastRec ? '' : ' none') + '">' + (lastRec || '—') + '</td>' +
      '<td class="ag-date' + (lastIss ? '' : ' none') + '">' + (lastIss || '—') + '</td>' +
      '<td class="text-center"><span class="ag-days' + (r.b === '2' ? ' b2' : '') + '" style="--c:' + bd.c + '">' + (r.days === null ? '—' : r.days.toLocaleString('en-US')) + '</span>' +
        (r.never ? '<div><span class="ag-tag">' + tagTxt + '</span></div>' : '') + '</td>' +
      '<td class="text-center"><span class="ag-badge">' + bd.t + '</span></td>' +
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
  if (!rows.length) return agToast('Walang i-e-export');
  function q(x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }
  function iso(ts) { return ts ? new Date(ts).toISOString().slice(0, 10) : ''; }
  var basis = document.getElementById('agBasis').value;
  var lines = [['Item Code', 'Description', 'Category', 'Location', 'Unit', 'On-Hand', 'Unit Cost', 'Stock Value', 'Last Received', 'Last Issued', 'Last Movement', 'Days Idle (' + (basis === 'MOVE' ? 'since last movement' : 'since last issued') + ')', 'Aging Bucket', basis === 'MOVE' ? 'No Movement' : 'Never Issued', 'Movement Class'].map(q).join(',')];
  rows.forEach(function(r) {
    lines.push([r.code, r.desc, r.cat, r.loc, r.unit, r.oh, r.cost, r.val.toFixed(2), iso(r.rec), iso(r.iss), iso(r.mv),
      r.days === null ? '' : r.days, agBucketDef(r.b).t, r.never ? 'YES' : '', r.mvName].map(q).join(','));
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
window.agSort = agSort; window.agSetBucket = agSetBucket; window.agPage = agPage; window.agExport = agExport;
console.log('✅ aging-monitor.js v1.0 loaded');
