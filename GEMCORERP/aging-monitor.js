// ============================================================
// GEMCOR ERP — Aging Monitor (v3.0)  —  Stock age by RECEIPT date (FIFO)
//
// Question answered: "How long has the stock we are holding now been sitting in the warehouse?"
//
// Method (FIFO layers):
//   1. On-hand quantity comes from erp_items.
//   2. Every receipt (MRR) of that item is listed with its real date:
//        • Jan–Oct 2026 : aging-mrr-data.js  (from MRR_DATA_2026.xlsx, day-level dates)
//        • Nov 2026 on  : erp_stock_ledger   (live MRR transactions)
//   3. FIFO: the oldest stock is used first, so what is still on the shelf must come from the NEWEST
//      receipts. We walk receipts newest → oldest and "fill" the on-hand quantity.
//   4. Each filled layer has an age in days (today − MRR date) and a peso value (qty × unit cost).
//   5. On-hand that is larger than all 2026 receipts must have been in stock before the sheet starts
//      (Jan 2026) → bucket "Before 2026 / No Record" (always older than every dated bucket).
//
// Read-only — writes nothing.
// ============================================================

var AG_LIVE_FROM = '2026-11-01';          // receipts on/after this date come from the live ledger; earlier ones from the sheet
var AG_BUCKETS = [                          // age buckets in DAYS since MRR date (edit "max" to change thresholds)
  { k: 'B1', t: 'Fresh',   r: '0–30 days',    max: 30,       c: '#16a34a', d: 'Received within the last 30 days' },
  { k: 'B2', t: 'Normal',  r: '31–90 days',   max: 90,       c: '#3b82f6', d: 'Received 1 to 3 months ago' },
  { k: 'B3', t: 'Aging',   r: '91–180 days',  max: 180,      c: '#eab308', d: 'Received 3 to 6 months ago', dark: true },
  { k: 'B4', t: 'Old',     r: '181+ days',    max: Infinity, c: '#f97316', d: 'Received 6+ months ago (in 2026)' },
  { k: 'B5', t: 'Pre-2026', r: 'No receipt in 2026', max: null, c: '#dc2626', d: 'Stock older than the first 2026 receipt, or no receipt on record' }
];
var AG_AGED_FROM = 2;                       // index of first "aged" bucket (B3 = 91+ days)
var AG_OLD_FROM = 3;                        // index of first "old" bucket (B4 = 181+ days)
var AG_MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

var AG = {
  items: [], recs: [], base: [], view: [], mv: {}, open: {},
  bucket: '', cat: '', page: 1, pageSize: 100,
  sortKey: 'risk', sortDir: -1, timer: null, loadId: 0,
  todayN: 0, startN: 0, warn: [], stats: {}
};

// ── date helpers (all in whole days, timezone-safe) ──────────
function agDayN(iso) {                       // 'YYYY-MM-DD' → day number
  var s = String(iso || '').slice(0, 10), y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (!y || !m || !d) return 0;
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function agNToLabel(n) {
  if (!n) return '';
  var d = new Date(n * 86400000);
  return AG_MN[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}
function agBucketOf(age, pre) {
  if (pre) return 4;
  for (var i = 0; i < 4; i++) if (age <= AG_BUCKETS[i].max) return i;
  return 3;
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  var sel = document.getElementById('agBucketSel');
  if (sel) sel.innerHTML = '<option value="">All Ages</option>' +
    AG_BUCKETS.map(function(b) { return '<option value="' + b.k + '">' + b.t + ' (' + b.r + ')</option>'; }).join('');
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
var AG_CACHE_KEY = 'ag_cache_v4', AG_CACHE_MS = 10 * 60 * 1000;   // cache 10 min — para hindi paulit-ulit na basahin ang buong erp_items / history (egress)
function agCacheGet() {
  try { var o = JSON.parse(sessionStorage.getItem(AG_CACHE_KEY) || 'null'); if (o && Date.now() - o.t < AG_CACHE_MS) return o; } catch (e) {}
  return null;
}
function agCacheSet(items, live, mv, warn) {
  try { sessionStorage.setItem(AG_CACHE_KEY, JSON.stringify({ t: Date.now(), items: items, live: live, mv: mv, warn: warn })); } catch (e) {}
}

async function agLoad(force) {
  var myId = ++AG.loadId;
  var tbody = document.getElementById('agBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading aging data…</div></td></tr>';
  AG.warn = [];
  try {
    var legacy = window.AG_MRR_LEGACY;
    if (!legacy || !legacy.items) throw new Error('aging-mrr-data.js is missing — copy it next to aging-monitor.html');

    var cached = force ? null : agCacheGet(), items, live = [], mv = {};
    if (cached) { items = cached.items; live = cached.live; mv = cached.mv; AG.warn = cached.warn || []; }
    else {
    items = await erpFetchAll('erp_items',
      'select=item_code,description,category,location,base_unit,on_hand,unit_cost' +
      '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false&asset_type=is.null&order=item_code.asc');

    // Live receipts (Nov 2026 →): MRR lines lang ang itinatabi. Failure here must not break the page.
    try {
      live = await erpFetchAll('erp_stock_ledger',
        'select=item_code,qty_in,transaction_type,reference_doc,transaction_date' +
        '&qty_in=gt.0&transaction_date=gte.' + encodeURIComponent(AG_LIVE_FROM) + '&order=transaction_date.asc');
      live = (live || []).filter(function(tx) {
        var tag = (String(tx.transaction_type || '') + ' ' + String(tx.reference_doc || '')).toUpperCase();
        return tag.indexOf('MRR') !== -1 && tag.indexOf('MRIF') === -1;
      });
    } catch (e) {
      console.warn('[Aging] live receipts unavailable', e);
      AG.warn.push('Live receipts from ' + agNToLabel(agDayN(AG_LIVE_FROM)) + ' onward could not be loaded, so newer receipts are missing from the ages below.');
    }

    // Last issued month per item (Monthly Movement source). Optional.
    try {
      var hist = await erpFetchAll('erp_v_item_monthly', 'select=item_code,month_start,mrif_qty&order=item_code.asc,month_start.asc');
      (hist || []).forEach(function(r) {
        if (!(Number(r.mrif_qty || 0) > 0)) return;
        var k = String(r.month_start || '').slice(0, 7);
        if (k > (mv[r.item_code] || '')) mv[r.item_code] = k;
      });
    } catch (e) { console.warn('[Aging] monthly history unavailable', e); }
    agCacheSet(items, live, mv, AG.warn);
    }

    if (myId !== AG.loadId) return;

    var now = new Date();
    AG.todayN = Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    AG.startN = agDayN(legacy.from);
    AG.items = items || [];
    AG.mv = mv;

    // Merge receipts per item: [{n: dayNumber, q: qty, ref: doc}]
    var rec = {}, liveN = 0;
    Object.keys(legacy.items).forEach(function(code) {
      rec[code] = legacy.items[code].map(function(x) { return { n: agDayN(x[0]), q: Number(x[1]), ref: x[2], src: 'Sheet' }; });
    });
    (live || []).forEach(function(tx) {
      var tag = (String(tx.transaction_type || '') + ' ' + String(tx.reference_doc || '')).toUpperCase();
      if (tag.indexOf('MRR') === -1 || tag.indexOf('MRIF') !== -1) return;
      var n = agDayN(tx.transaction_date); if (!n || String(tx.transaction_date).slice(0, 10) < AG_LIVE_FROM) return;
      (rec[tx.item_code] || (rec[tx.item_code] = [])).push({ n: n, q: Number(tx.qty_in || 0), ref: tx.reference_doc || 'MRR', src: 'System' });
      liveN++;
    });

    var codes = {}; AG.items.forEach(function(it) { codes[it.item_code] = 1; });
    var unmatched = Object.keys(legacy.items).filter(function(c) { return !codes[c]; }).length;
    AG.stats = { legacyRows: legacy.rows, legacyTo: legacy.to, liveRows: liveN, unmatched: unmatched };
    AG.rec = rec;

    var u = document.getElementById('agUpdated');
    if (u) u.textContent = 'Updated ' + now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) +
      ' • receipts: ' + agNToLabel(AG.startN) + ' – today';

    agPopulateFilters();
    agBuild();
    agApply();
  } catch (err) {
    console.error('[agLoad]', err);
    var s = document.getElementById('agSummary');
    if (s) { s.className = 'ag-summary bad'; s.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i><div>Could not load aging data: ' + erpEsc(err.message || err) + '</div>'; }
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="erp-empty text-danger"><i class="bi bi-exclamation-triangle-fill me-2"></i>Failed to load.</td></tr>';
  }
}

// ═══════════════════════════════════════════════════════════
// BUILD — FIFO layers per item
// ═══════════════════════════════════════════════════════════
function agBuild() {
  AG.recs = AG.items.map(function(it) {
    var oh = Math.max(0, Number(it.on_hand || 0)), cost = Number(it.unit_cost || 0);
    var list = (AG.rec[it.item_code] || []).slice().sort(function(a, b) { return b.n - a.n; });   // newest first
    var left = oh, layers = [], lastRecv = list.length ? list[0].n : 0;
    for (var i = 0; i < list.length && left > 1e-9; i++) {
      var take = Math.min(left, list[i].q);
      if (take <= 0) continue;
      layers.push({ n: list[i].n, ref: list[i].ref, src: list[i].src, recvQty: list[i].q, q: take, pre: false });
      left -= take;
    }
    if (left > 1e-9) layers.push({ n: 0, ref: '', src: '', recvQty: 0, q: left, pre: true });     // before the first 2026 receipt

    var bq = [0, 0, 0, 0, 0], bv = [0, 0, 0, 0, 0], wAge = 0, oldest = 0;
    layers.forEach(function(L) {
      L.age = L.pre ? (AG.todayN - AG.startN + 1) : Math.max(0, AG.todayN - L.n);   // pre-2026: at least this old
      L.b = agBucketOf(L.age, L.pre);
      L.v = L.q * cost;
      bq[L.b] += L.q; bv[L.b] += L.v;
      wAge += L.age * L.q;
      if (L.age > oldest) oldest = L.age;
    });
    var topB = -1; for (var b = 4; b >= 0; b--) if (bq[b] > 0) { topB = b; break; }
    var lm = AG.mv[it.item_code] || '';
    return {
      code: it.item_code, desc: it.description || '', cat: it.category || '', loc: it.location || '', unit: it.base_unit || '',
      oh: oh, cost: cost, val: oh * cost, layers: layers, bq: bq, bv: bv,
      oldest: oldest, avg: oh > 0 ? wAge / oh : 0, pre: bq[4] > 0, top: topB,
      lastRecv: lastRecv, lastIss: lm, hasRec: list.length > 0
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
// FILTER
// ═══════════════════════════════════════════════════════════
function agBIdx(k) { for (var i = 0; i < AG_BUCKETS.length; i++) if (AG_BUCKETS[i].k === k) return i; return -1; }

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
  var bi = AG.bucket ? agBIdx(AG.bucket) : -1;
  AG.view = bi < 0 ? AG.base.slice() : AG.base.filter(function(r) { return r.bq[bi] > 0; });
  AG.page = 1;

  var ss = document.getElementById('agBucketSel'); if (ss) ss.value = AG.bucket;
  agRenderSummary();
  agRenderBuckets();
  agRenderCats();
  agSortView();
  agRender();
}

function agOnSearch() { clearTimeout(AG.timer); AG.timer = setTimeout(agApply, 250); }
function agSetBucket(k) { AG.bucket = (AG.bucket === k) ? '' : k; agApply(); }
function agSetBucketFromSelect() { AG.bucket = document.getElementById('agBucketSel').value; agApply(); }
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
  AG.bucket = ''; AG.sortKey = 'risk'; AG.sortDir = -1;
  agApply();
}
function agRefresh() { agToast('Refreshing…'); agLoad(true); }

// "value in focus": value in selected bucket, otherwise value aged 90+ days
function agFocusVal(r) {
  var bi = AG.bucket ? agBIdx(AG.bucket) : -1;
  if (bi >= 0) return r.bv[bi];
  var s = 0; for (var i = AG_AGED_FROM; i < 5; i++) s += r.bv[i]; return s;
}

function agSort(key) {
  if (AG.sortKey === key) AG.sortDir = -AG.sortDir;
  else { AG.sortKey = key; AG.sortDir = (key === 'code') ? 1 : -1; }
  agSortView(); AG.page = 1; agRender();
}

function agSortView() {
  var k = AG.sortKey, d = AG.sortDir;
  var sub = document.getElementById('agSubtitle');
  if (sub) sub.textContent = k === 'risk' ? 'Highest aged value first' :
    k === 'oldest' ? 'Sorted by oldest stock age' : k === 'value' ? 'Sorted by stock value' : k === 'onhand' ? 'Sorted by on-hand quantity' :
    k === 'recv' ? 'Sorted by last received date' : k === 'focus' ? 'Sorted by aged value' : 'Sorted by item code';
  AG.view.sort(function(a, b) {
    var r;
    if (k === 'code') r = String(a.code).localeCompare(String(b.code));
    else if (k === 'onhand') r = a.oh - b.oh;
    else if (k === 'value') r = a.val - b.val;
    else if (k === 'oldest') r = a.oldest - b.oldest;
    else if (k === 'recv') r = a.lastRecv - b.lastRecv;
    else r = agFocusVal(a) - agFocusVal(b);          // 'risk' / 'focus'
    if (r === 0) r = a.oldest - b.oldest;
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
function agDays(n) { return Math.round(n).toLocaleString('en-US') + ' day' + (Math.round(n) === 1 ? '' : 's'); }
function agPl(n, w) { return n.toLocaleString('en-US') + ' ' + w + (n === 1 ? '' : 's'); }

function agTotals() {
  var t = { value: 0, items: AG.base.length, bv: [0, 0, 0, 0, 0], bn: [0, 0, 0, 0, 0], wAge: 0, qtyV: 0 };
  AG.base.forEach(function(r) {
    t.value += r.val;
    var seen = {};
    r.layers.forEach(function(L) { t.bv[L.b] += L.v; t.wAge += L.age * L.v; t.qtyV += L.v; seen[L.b] = 1; });
    Object.keys(seen).forEach(function(b) { t.bn[b]++; });
  });
  t.avg = t.qtyV > 0 ? t.wAge / t.qtyV : 0;
  t.agedV = 0; t.oldV = 0;
  for (var i = AG_AGED_FROM; i < 5; i++) t.agedV += t.bv[i];
  for (var j = AG_OLD_FROM; j < 5; j++) t.oldV += t.bv[j];
  t.agedN = 0; AG.base.forEach(function(r) { for (var i = AG_AGED_FROM; i < 5; i++) if (r.bq[i] > 0) { t.agedN++; break; } });
  return t;
}

function agRenderSummary() {
  var t = agTotals(), box = document.getElementById('agSummary');
  var noCost = AG.base.filter(function(r) { return r.oh > 0 && !r.cost; }).length;

  agSet('agKpiTotal', agPesoShort(t.value));
  agSet('agKpiTotalSub', agPl(t.items, 'item') + (document.getElementById('agZero').checked ? '' : ' with stock'));
  agSet('agKpiAvg', t.items ? Math.round(t.avg) + ' days' : '—');
  agSet('agKpiAvgSub', 'Average age of stock on hand, weighted by peso value');
  agSet('agKpiAged', agPesoShort(t.agedV));
  agSet('agKpiAgedSub', agPct(t.agedV, t.value) + '% of value • ' + agPl(t.agedN, 'item'));
  agSet('agKpiOld', agPesoShort(t.oldV));
  agSet('agKpiOldSub', agPct(t.oldV, t.value) + '% of value • received 6+ months ago');

  if (!t.items) { box.className = 'ag-summary'; box.innerHTML = '<i class="bi bi-inbox"></i><div>No items match the current filters.</div>'; return; }

  var pct = agPct(t.agedV, t.value), cls, icon, html;
  if (t.agedV <= 0) {
    cls = 'good'; icon = 'bi-check-circle-fill';
    html = '<b>No aged stock.</b> Everything in this view was received within the last 90 days.';
  } else {
    cls = pct >= 30 ? 'bad' : pct >= 15 ? 'warn' : 'good';
    icon = cls === 'good' ? 'bi-info-circle-fill' : 'bi-exclamation-triangle-fill';
    html = '<b>' + agPesoShort(t.agedV) + ' (' + pct + '%)</b> of stock value — <b>' + agPl(t.agedN, 'item') +
      '</b> — has been in the warehouse for more than 90 days since it was received.';
    var sub = [];
    if (t.bv[4] > 0) sub.push(agPesoShort(t.bv[4]) + ' of it was already in stock before the first 2026 receipt.');
    var top = agAgedCats()[0];
    if (top) sub.push('Largest aged category: ' + erpEsc(top.name) + ' (' + agPesoShort(top.v) + ').');
    if (sub.length) html += '<span class="sub">' + sub.join(' ') + '</span>';
  }
  if (noCost) html += '<span class="sub">' + agPl(noCost, 'item') + ' with stock have no unit cost, so they are counted as ₱0.</span>';
  AG.warn.forEach(function(w) { html += '<span class="sub text-danger">⚠ ' + erpEsc(w) + '</span>'; });
  box.className = 'ag-summary ' + cls;
  box.innerHTML = '<i class="bi ' + icon + '"></i><div>' + html + '</div>';
}

function agRenderBuckets() {
  var t = agTotals();
  document.getElementById('agStack').innerHTML = AG_BUCKETS.map(function(s, i) {
    var w = t.value > 0 ? (t.bv[i] / t.value * 100) : 0;
    return '<span style="width:' + w.toFixed(2) + '%;background:' + s.c + '" title="' + s.t + ' — ' + agPesoShort(t.bv[i]) + ' (' + Math.round(w) + '%)"></span>';
  }).join('');
  document.getElementById('agBuckets').innerHTML = AG_BUCKETS.map(function(s, i) {
    return '<div class="ag-bucket' + (AG.bucket === s.k ? ' on' : '') + '" style="--c:' + s.c + '" onclick="agSetBucket(\'' + s.k + '\')" title="Click to filter">' +
      '<div class="t">' + s.t + '</div><div class="r">' + s.r + '</div><div class="d">' + s.d + '</div>' +
      '<div class="v">' + agPesoShort(t.bv[i]) + '</div>' +
      '<div class="n">' + agPl(t.bn[i], 'item') + '</div>' +
      '<div class="p">' + agPct(t.bv[i], t.value) + '% of stock value</div></div>';
  }).join('');
}

function agAgedCats() {
  var m = {};
  AG.base.forEach(function(r) {
    var v = 0; for (var i = AG_AGED_FROM; i < 5; i++) v += r.bv[i];
    if (v > 0) { var c = r.cat || '(No category)'; m[c] = (m[c] || 0) + v; }
  });
  return Object.keys(m).map(function(k) { return { name: k, v: m[k] }; }).sort(function(a, b) { return b.v - a.v; });
}

function agRenderCats() {
  var list = agAgedCats(), host = document.getElementById('agCats');
  if (!list.length) { host.innerHTML = '<div class="ag-empty">No stock older than 90 days in this view.</div>'; return; }
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

function agMix(r) {
  if (r.oh <= 0) return '<span class="text-muted">—</span>';
  var tot = r.val > 0 ? r.val : r.oh, use = r.val > 0 ? r.bv : r.bq;
  return '<div class="ag-mix">' + AG_BUCKETS.map(function(b, i) {
    var w = use[i] / tot * 100; if (w <= 0) return '';
    return '<span style="width:' + w.toFixed(1) + '%;background:' + b.c + '" title="' + b.t + ': ' + erpNum(r.bq[i]) + ' ' + erpEsc(r.unit) + (r.val > 0 ? ' • ' + agPeso(r.bv[i]) : '') + '"></span>';
  }).join('') + '</div>';
}

function agBadge(r) {
  if (r.top < 0) return '<span class="text-muted">—</span>';
  var b = AG_BUCKETS[r.top];
  return '<span class="ag-badge' + (b.dark ? ' dark-text' : '') + '" style="--c:' + b.c + '" title="Oldest stock on hand: ' + erpEsc(b.d) + '">' + b.t + '</span>';
}

function agLayerRows(r) {
  var h = '<table class="ag-lay"><thead><tr><th>Received</th><th>MRR No.</th><th class="text-end">Received Qty</th><th class="text-end">Still On Hand</th><th class="text-end">Age</th><th class="text-end">Value</th><th>Bucket</th></tr></thead><tbody>';
  r.layers.slice().sort(function(a, b) { return b.age - a.age; }).forEach(function(L) {
    var b = AG_BUCKETS[L.b];
    h += '<tr><td>' + (L.pre ? 'Before ' + agNToLabel(AG.startN) : agNToLabel(L.n)) + '</td>' +
      '<td>' + (L.pre ? '<span class="text-muted">No MRR on record</span>' : erpEsc(L.ref)) + '</td>' +
      '<td class="text-end">' + (L.pre ? '—' : erpNum(L.recvQty)) + '</td>' +
      '<td class="text-end fw-bold">' + erpNum(L.q) + '</td>' +
      '<td class="text-end">' + (L.pre ? '≥ ' : '') + agDays(L.age) + '</td>' +
      '<td class="text-end">' + (r.cost ? agPeso(L.v) : '—') + '</td>' +
      '<td><span class="ag-dot" style="background:' + b.c + '"></span>' + b.t + '</td></tr>';
  });
  return h + '</tbody></table>';
}

function agToggle(code) { AG.open[code] = !AG.open[code]; agRender(); }

function agRender() {
  var tbody = document.getElementById('agBody');
  var total = AG.view.length;
  agSet('agCount', agPl(total, 'item'));
  var bi = AG.bucket ? agBIdx(AG.bucket) : -1;
  agSet('agFocusHead', bi >= 0 ? 'Value in ' + AG_BUCKETS[bi].t : 'Aged Value (90+ d)');

  document.querySelectorAll('#ag-page th i[data-s]').forEach(function(i) {
    var s = i.getAttribute('data-s');
    i.className = 'bi' + ((s === AG.sortKey || (s === 'focus' && AG.sortKey === 'risk')) ? (AG.sortDir === 1 ? ' bi-caret-up-fill' : ' bi-caret-down-fill') : '');
  });

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="11" class="erp-empty"><i class="bi bi-inbox fs-3 d-block mb-2"></i>No items match the current filters.</td></tr>';
    document.getElementById('agPager').innerHTML = '';
    return;
  }

  var pages = Math.max(1, Math.ceil(total / AG.pageSize));
  if (AG.page > pages) AG.page = pages;
  var from = (AG.page - 1) * AG.pageSize, to = Math.min(total, from + AG.pageSize);

  var html = '';
  for (var i = from; i < to; i++) {
    var r = AG.view[i], fv = agFocusVal(r), open = !!AG.open[r.code];
    html += '<tr class="ag-row' + (open ? ' open' : '') + '" onclick="agToggle(\'' + erpEsc(r.code).replace(/'/g, "\\'") + '\')" title="Click to see receipt layers">' +
      '<td class="text-muted">' + (i + 1) + '</td>' +
      '<td><i class="bi bi-chevron-' + (open ? 'down' : 'right') + ' ag-chev"></i><a class="ag-item-link" href="item-in-out.html?code=' + encodeURIComponent(r.code) + '" onclick="event.stopPropagation()" title="View Item In &amp; Out">' + erpEsc(r.code) + '</a></td>' +
      '<td><div class="ag-desc" title="' + erpEsc(r.desc) + '">' + erpEsc(r.desc || '—') + '</div><div class="ag-cat-s">' + erpEsc(r.cat || '') + '</div></td>' +
      '<td class="text-end fw-bold">' + erpNum(r.oh) + ' <span class="text-muted fw-normal small">' + erpEsc(r.unit) + '</span></td>' +
      '<td class="text-end fw-bold">' + (r.cost ? agPeso(r.val) : '<span class="text-warning" title="No unit cost">—</span>') + '</td>' +
      '<td>' + agMix(r) + '</td>' +
      '<td class="text-end fw-bold">' + (r.cost ? (fv > 0 ? agPeso(fv) : '<span class="text-muted fw-normal">–</span>') : '—') + '</td>' +
      '<td class="text-center ag-idle">' + (r.oh > 0 ? (r.pre ? '≥ ' : '') + Math.round(r.oldest) + ' d' : '—') + '</td>' +
      '<td class="ag-date' + (r.lastRecv ? '' : ' none') + '">' + (r.lastRecv ? agNToLabel(r.lastRecv) : '—') + '</td>' +
      '<td class="ag-date' + (r.lastIss ? '' : ' none') + '">' + (r.lastIss ? AG_MN[+r.lastIss.slice(5, 7) - 1] + ' ' + r.lastIss.slice(0, 4) : '—') + '</td>' +
      '<td class="text-center">' + agBadge(r) + '</td>' +
    '</tr>';
    if (open) html += '<tr class="ag-detail"><td></td><td colspan="10">' + agLayerRows(r) +
      '<div class="ag-lay-note">FIFO: the oldest receipts are assumed used first, so the stock on hand is taken from the newest receipts.</div></td></tr>';
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
  function iso(n) { return n ? new Date(n * 86400000).toISOString().slice(0, 10) : ''; }
  var head = ['Item Code', 'Description', 'Category', 'Location', 'Unit', 'On-Hand', 'Unit Cost', 'Stock Value',
    'Oldest Stock (days)', 'Avg Age (days)', 'Last Received', 'Last Issued (YYYY-MM)', 'Status (oldest stock)'];
  AG_BUCKETS.forEach(function(b) { head.push(b.t + ' Qty'); head.push(b.t + ' Value'); });
  var lines = [head.map(q).join(',')];
  rows.forEach(function(r) {
    var line = [r.code, r.desc, r.cat, r.loc, r.unit, r.oh, r.cost, r.val.toFixed(2),
      r.oh > 0 ? Math.round(r.oldest) : '', r.oh > 0 ? Math.round(r.avg) : '', iso(r.lastRecv), r.lastIss, r.top >= 0 ? AG_BUCKETS[r.top].t : ''];
    for (var i = 0; i < 5; i++) { line.push(r.bq[i]); line.push(r.bv[i].toFixed(2)); }
    lines.push(line.map(q).join(','));
  });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Stock_Aging_' + new Date().toISOString().slice(0, 10) + '.csv';
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
window.agSort = agSort; window.agSetBucket = agSetBucket; window.agSetBucketFromSelect = agSetBucketFromSelect;
window.agPage = agPage; window.agExport = agExport; window.agToggle = agToggle;
console.log('✅ aging-monitor.js v3.1 loaded');
