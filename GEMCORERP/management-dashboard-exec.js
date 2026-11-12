// GEMCOR ERP — Management Dashboard: executive layer (₱-first view for owner/admin)
// Reads _mdash.allItems (already filtered) + 12-month stock ledger. Display only.
var _xd = { charts: {}, ledger: null, ledgerAt: 0 };
(function() {
  if (document.getElementById('xdBackCss')) return;
  var st = document.createElement('style'); st.id = 'xdBackCss';
  st.textContent = '.xd-back{display:inline-flex;align-items:center;gap:6px;margin:4px 0 8px;padding:5px 12px;border:1.5px solid #1e3a5f;background:#fff;color:#1e3a5f;border-radius:8px;font-size:.8rem;font-weight:700;cursor:pointer}.xd-back:hover{background:#1e3a5f;color:#fff}';
  document.head.appendChild(st);
})();
var XD_COLORS = ['#1e3a5f','#d9922e','#10b981','#8b5cf6','#06b6d4','#ec4899','#84cc16','#ef4444','#94a3b8'];

function xdP(n) { n = Number(n) || 0; var a = Math.abs(n);
  if (a >= 1e6) return '₱' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return '₱' + Math.round(n / 1e3) + 'K';
  return '₱' + Math.round(n).toLocaleString('en-PH'); }
function xdPct(a, b) { return b > 0 ? (a / b * 100) : 0; }
function xdVal(it) { var v = Number(it.on_hand_cost); return isNaN(v) || it.on_hand_cost == null ? Number(it.on_hand || 0) * Number(it.unit_cost || 0) : v; }
function xdMov(it) { var m = String(it.inventory_movement || '').toUpperCase();
  return m.indexOf('FAST') > -1 || m.indexOf('MODERATE') > -1 ? 'mv' : m.indexOf('SLOW') > -1 ? 'sl' : m.indexOf('NO MOVE') > -1 ? 'nm' : 'un'; }
function xdEsc(s) { return erpEsc(s); }

// ── Period selector: "All Time" actually meant last 30 days; make it honest, add current month ──
document.addEventListener('DOMContentLoaded', function() {
  var sel = document.getElementById('mdashFilterMonth'); if (!sel) return;
  var mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var h = '<option value="all" selected>Last 30 days</option>', d = new Date();
  for (var i = 0; i < 12; i++) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    h += '<option value="' + x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '">' + mn[x.getMonth()] + ' ' + x.getFullYear() + '</option>'; }
  sel.innerHTML = h;
});

async function xdLoadLedger(force) {
  if (!force && _xd.ledger && Date.now() - _xd.ledgerAt < 15 * 60 * 1000) return _xd.ledger;
  var from = new Date(); from.setMonth(from.getMonth() - 11); from.setDate(1);
  var iso = from.getFullYear() + '-' + String(from.getMonth() + 1).padStart(2, '0') + '-01T00:00:00';
  try {
    _xd.ledger = await erpFetchAll('erp_stock_ledger', 'select=item_code,qty_in,qty_out,transaction_type,reference_doc,transaction_date&transaction_date=gte.' + iso + '&order=transaction_date.asc,item_code.asc');
    _xd.ledgerAt = Date.now();
  } catch (e) { console.warn('[xd] ledger', e.message); _xd.ledger = null; }
  return _xd.ledger;
}

function mdashExecRender() {
  var host = document.getElementById('xdRoot'); if (!host) return;
  var items = (_mdash.allItems || []).map(function(it) { return { it: it, v: xdVal(it), m: xdMov(it) }; });
  var total = items.reduce(function(s, x) { return s + x.v; }, 0);
  var seg = { mv: 0, sl: 0, nm: 0, un: 0 }, cats = {}, locs = {}, noCost = 0, noCostN = 0, over = [], idle = [], low = [], lowSum = 0;
  items.forEach(function(x) {
    var it = x.it; seg[x.m] += x.v;
    var c = it.category || 'Uncategorized'; (cats[c] = cats[c] || { v: 0, n: 0 }); cats[c].v += x.v; cats[c].n++;
    if (Number(it.on_hand) > 0 && !(Number(it.unit_cost) > 0)) noCostN++;
    if (x.m === 'nm' && x.v > 0) idle.push(x);
    var avg = Number(it.ave_monthly_consumption || 0), oh = Number(it.on_hand || 0), uc = Number(it.unit_cost || 0);
    if (avg > 0 && oh > avg * 12) { var ex = (oh - avg * 12) * uc; if (ex > 0) over.push({ it: it, v: ex, sub: (oh / avg).toFixed(0) + ' mo. of stock' }); }
    var buf = Number(it.buffer_stock || 0);
    if (buf > 0 && oh < buf) { var need = (buf - oh) * uc; lowSum += need; low.push({ it: it, v: need, sub: oh + ' of ' + buf + ' ' + (it.base_unit || '') }); }
  });
  var sorted = items.slice().sort(function(a, b) { return b.v - a.v; });
  var top20 = sorted.slice(0, 20).reduce(function(s, x) { return s + x.v; }, 0);
  var overSum = over.reduce(function(s, x) { return s + x.v; }, 0);
  var idleSum = seg.nm;
  var act = (_mdash.data && _mdash.data.activity) || {};

  var findings = [];
  if (total > 0) {
    findings.push(['var(--nm)', '<b>' + xdP(seg.nm + seg.sl) + '</b> (' + xdPct(seg.nm + seg.sl, total).toFixed(0) + '%) of stock value is in slow or non-moving items.']);
    if (overSum > 0) findings.push(['var(--sl)', '<b>' + xdP(overSum) + '</b> is held beyond 12 months of usage across ' + over.length + ' items.']);
    if (low.length) findings.push(['var(--sl)', '<b>' + low.length + ' items</b> are below buffer; restocking them costs about <b>' + xdP(lowSum) + '</b>.']);
    findings.push(['var(--ink)', 'The top 20 items hold <b>' + xdPct(top20, total).toFixed(0) + '%</b> of total value. Count and protect these first.']);
    if (act.mrr_value != null) findings.push([Number(act.mrr_value) > Number(act.mrif_value || 0) ? 'var(--sl)' : 'var(--mv)',
      'In this period you received <b>' + xdP(act.mrr_value) + '</b> and issued <b>' + xdP(act.mrif_value || 0) + '</b>; stock ' + (Number(act.mrr_value) >= Number(act.mrif_value || 0) ? 'grew' : 'shrank') + ' by <b>' + xdP(Math.abs(Number(act.mrr_value) - Number(act.mrif_value || 0))) + '</b>.']);
    if (noCostN) findings.push(['var(--un)', '<b>' + noCostN + ' items</b> have stock but no unit cost, so the total above is understated.']);
  } else findings.push(['var(--un)', 'No stock value for the current filters.']);

  var labels = { mv: 'Moving', sl: 'Slow', nm: 'No movement', un: 'Unclassified' };
  var cl = { mv: 'var(--mv)', sl: 'var(--sl)', nm: 'var(--nm)', un: 'var(--un)' };
  var catArr = Object.keys(cats).map(function(k) { return { k: k, v: cats[k].v, n: cats[k].n }; }).sort(function(a, b) { return b.v - a.v; });
  var topC = catArr.slice(0, 8), restV = catArr.slice(8).reduce(function(s, c) { return s + c.v; }, 0);
  if (catArr.length > 8) topC.push({ k: 'Others (' + (catArr.length - 8) + ')', v: restV, n: 0, other: 1 });
  var maxC = topC.length ? topC[0].v : 1;

  var abc = { A: { v: 0, n: 0 }, B: { v: 0, n: 0 }, C: { v: 0, n: 0 } };
  items.forEach(function(x) { var k = String(x.it.abc_classification || '').toUpperCase(); if (abc[k]) { abc[k].v += x.v; abc[k].n++; } });
  var abcCol = { A: '#dc2626', B: '#f59e0b', C: '#94a3b8' };

  function list(arr, empty) { return arr.length ? '<ul class="xd-list">' + arr.map(function(x) {
    return '<li><code>' + xdEsc(x.it.item_code) + '</code><b>' + xdP(x.v) + '</b><span>' + xdEsc(String(x.it.description || '').substring(0, 42)) + '</span><small>' + xdEsc(x.sub || x.it.category || '') + '</small></li>'; }).join('') + '</ul>' : '<div class="xd-empty">' + empty + '</div>'; }
  var byV = function(a, b) { return b.v - a.v; };
  var topItems = sorted.slice(0, 8).map(function(x) { return { it: x.it, v: x.v, sub: xdPct(x.v, total).toFixed(1) + '% of total' }; });
  idle.sort(byV); over.sort(byV); low.sort(byV);

  host.innerHTML =
    '<div class="xd-card xd-hero"><div><p class="xd-h">Capital in stock</p><p class="xd-s">Where the company’s money sits in the warehouse right now</p>' +
    '<div class="xd-num xd-big">' + xdP(total).replace('₱', '₱') + '</div>' +
    '<div class="xd-bar">' + ['mv', 'sl', 'nm', 'un'].map(function(k) { return '<i style="width:0;background:' + cl[k] + '" data-w="' + xdPct(seg[k], total) + '"></i>'; }).join('') + '</div>' +
    '<div class="xd-leg">' + ['mv', 'sl', 'nm', 'un'].map(function(k) { return '<div style="--c:' + cl[k] + '"><b class="xd-num">' + xdP(seg[k]) + '</b>' + labels[k] + ' · ' + xdPct(seg[k], total).toFixed(0) + '%</div>'; }).join('') + '</div></div>' +
    '<div><p class="xd-h">What needs your attention</p><p class="xd-s">Generated from the current filters</p><ul class="xd-find">' + findings.map(function(f) { return '<li style="--c:' + f[0] + '">' + f[1] + '</li>'; }).join('') + '</ul></div></div>' +

    '<div class="xd-grid"><div class="xd-card"><p class="xd-h">Value by category</p><p class="xd-s">Click a category to filter the whole dashboard</p><div class="xd-cat"><div class="xd-cv"><canvas id="xdCat"></canvas></div><div class="xd-rank">' +
    topC.map(function(c, i) { return '<div class="xd-row" style="--c:' + XD_COLORS[i] + ';--w:' + Math.max(2, c.v / maxC * 100) + '%" ' + (c.other ? '' : 'data-cat="' + xdEsc(c.k) + '"') + '><span>' + xdEsc(c.k) + (c.n ? ' · ' + c.n + ' items' : '') + '</span><em>' + xdP(c.v) + ' · ' + xdPct(c.v, total).toFixed(0) + '%</em><u></u></div>'; }).join('') + '</div></div></div>' +
    '<div class="xd-card"><p class="xd-h">Received vs issued, by month</p><p class="xd-s">Peso value of MRR in and MRIF out, last 12 months</p><div class="xd-ch"><canvas id="xdFlow"></canvas></div><div class="xd-note" id="xdFlowNote">Loading ledger…</div></div></div>' +

    '<div class="xd-grid"><div class="xd-card"><p class="xd-h" id="xdPiT">Issued to production</p><p class="xd-s" id="xdPiS">Loading ledger…</p><div id="xdPiL"></div></div>' +
    '<div class="xd-card"><p class="xd-h" id="xdPrT">Received</p><p class="xd-s" id="xdPrS">Loading ledger…</p><div id="xdPrL"></div></div></div>' +

    '<div class="xd-grid"><div class="xd-card"><p class="xd-h">ABC classes and top items</p><p class="xd-s">A items are the few that carry most of the value</p><div class="xd-abc">' +
    ['A', 'B', 'C'].map(function(k) { return '<div style="--c:' + abcCol[k] + '"><small>Class ' + k + ' · ' + abc[k].n + ' items</small><span class="xd-num">' + xdP(abc[k].v) + '</span><small>' + xdPct(abc[k].v, total).toFixed(0) + '% of value</small></div>'; }).join('') + '</div>' +
    '<p class="xd-h" style="font-size:.82rem">Top 8 items by value</p>' + list(topItems, 'No items.') + '</div>' +
    '<div class="xd-card"><p class="xd-h">Restock cost</p><p class="xd-s">Items below buffer, ranked by peso needed to reach buffer</p>' + list(low.slice(0, 8), 'No items below buffer.') + '</div></div>' +

    '<div class="xd-grid"><div class="xd-card"><p class="xd-h">Idle capital</p><p class="xd-s">Items with stock but no movement: ' + xdP(idleSum) + ' in ' + idle.length + ' items</p>' + list(idle.slice(0, 8), 'Nothing idle.') + '</div>' +
    '<div class="xd-card"><p class="xd-h">Overstock</p><p class="xd-s">Value above 12 months of average usage: ' + xdP(overSum) + '</p>' + list(over.slice(0, 8), 'No overstock found.') + '</div></div>';

  if (_mdash.filters && _mdash.filters.category) {
    var catCard = host.querySelector('.xd-grid .xd-card'), catHd = catCard && catCard.querySelector('.xd-h');
    if (catHd) catHd.insertAdjacentHTML('afterend',
      '<button type="button" class="xd-back" onclick="mdashClearFilter(\'category\')"><i class="bi bi-arrow-left"></i> Back to all categories</button>');
  }

  requestAnimationFrame(function() { host.querySelectorAll('.xd-bar i').forEach(function(b) { b.style.width = b.dataset.w + '%'; }); });
  host.querySelectorAll('[data-cat]').forEach(function(r) { r.addEventListener('click', function() {
    var s = document.getElementById('mdashFilterCategory'); s.value = (s.value === r.dataset.cat) ? '' : r.dataset.cat; s.dispatchEvent(new Event('change')); }); });

  if (_xd.charts.cat) _xd.charts.cat.destroy();
  _xd.charts.cat = new Chart(document.getElementById('xdCat'), { type: 'doughnut',
    data: { labels: topC.map(function(c) { return c.k; }), datasets: [{ data: topC.map(function(c) { return c.v; }), backgroundColor: XD_COLORS, borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { return c.label + ': ' + xdP(c.parsed) + ' (' + xdPct(c.parsed, total).toFixed(1) + '%)'; } } } } },
    plugins: [{ id: 'ctr', afterDraw: function(ch) { var c = ch.ctx, a = ch.chartArea, x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
      c.save(); c.textAlign = 'center'; c.fillStyle = '#0a1628'; c.font = '800 24px "Barlow Condensed", Inter, sans-serif'; c.fillText(xdP(total), x, y + 4);
      c.fillStyle = '#64748b'; c.font = '11px Inter, sans-serif'; c.fillText(catArr.length + ' categories', x, y + 20); c.restore(); } }] });

  xdLoadLedger(false).then(function(l) { xdRenderFlow(l); xdRenderPeriod(l); });
}

// ── Period range ayon sa Month filter ──
function xdPeriodRange() {
  var m = (_mdash.filters && _mdash.filters.month) || 'all', now = new Date();
  if (m !== 'all') {
    var p = m.split('-'), names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return { from: new Date(+p[0], +p[1] - 1, 1), to: new Date(+p[0], +p[1], 1), label: names[+p[1] - 1] + ' ' + p[0] };
  }
  return { from: new Date(now.getTime() - 30 * 86400000), to: new Date(now.getTime() + 1), label: 'the last 30 days' };
}

// Top issued / received items sa napiling period (mula sa stock ledger)
function xdRenderPeriod(ledger) {
  var iL = document.getElementById('xdPiL'), rL = document.getElementById('xdPrL');
  if (!iL || !rL) return;
  var R = xdPeriodRange();
  var set = function(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; };
  set('xdPiT', 'Issued to production · ' + R.label); set('xdPrT', 'Received · ' + R.label);
  if (!ledger) { set('xdPiS', 'Could not load the stock ledger.'); set('xdPrS', 'Could not load the stock ledger.'); return; }

  var meta = {}; (_mdash.allItems || []).forEach(function(it) { meta[it.item_code] = it; });
  var iss = {}, rec = {};
  ledger.forEach(function(t) {
    var it = meta[t.item_code]; if (!it || !t.transaction_date) return;
    var d = new Date(t.transaction_date); if (d < R.from || d >= R.to) return;
    var tag = (String(t.transaction_type || '') + ' ' + String(t.reference_doc || '')).toUpperCase(), uc = Number(it.unit_cost || 0);
    if (tag.indexOf('MRIF') > -1) { var q = Number(t.qty_out || 0) - Number(t.qty_in || 0); (iss[t.item_code] = iss[t.item_code] || { q: 0, v: 0 }); iss[t.item_code].q += q; iss[t.item_code].v += q * uc; }
    else if (tag.indexOf('MRR') > -1) { var q2 = Number(t.qty_in || 0) - Number(t.qty_out || 0); (rec[t.item_code] = rec[t.item_code] || { q: 0, v: 0 }); rec[t.item_code].q += q2; rec[t.item_code].v += q2 * uc; }
  });

  function build(map, subId, listEl, emptyMsg) {
    var arr = Object.keys(map).map(function(k) { return { it: meta[k], q: map[k].q, v: map[k].v }; }).filter(function(x) { return x.q > 0; }).sort(function(a, b) { return b.v - a.v || b.q - a.q; });
    var tot = arr.reduce(function(s, x) { return s + x.v; }, 0);
    set(subId, arr.length ? xdP(tot) + ' across ' + arr.length + ' items (top 8 below, valued at current unit cost)' : emptyMsg);
    listEl.innerHTML = arr.length ? '<ul class="xd-list">' + arr.slice(0, 8).map(function(x) {
      return '<li><code>' + xdEsc(x.it.item_code) + '</code><b>' + xdP(x.v) + '</b><span>' + xdEsc(String(x.it.description || '').substring(0, 42)) + '</span><small>' + erpNum(x.q) + ' ' + xdEsc(x.it.base_unit || '') + '</small></li>';
    }).join('') + '</ul>' : '<div class="xd-empty">Nothing recorded in this period.</div>';
  }
  build(iss, 'xdPiS', iL, 'No MRIF issuance in this period for the current filters.');
  build(rec, 'xdPrS', rL, 'No MRR receiving in this period for the current filters.');
}

function xdRenderFlow(ledger) {
  var note = document.getElementById('xdFlowNote'), cv = document.getElementById('xdFlow'); if (!cv) return;
  if (!ledger) { if (note) note.textContent = 'Could not load the stock ledger.'; return; }
  var cost = {}; (_mdash.allItems || []).forEach(function(it) { cost[it.item_code] = Number(it.unit_cost || 0); });
  var now = new Date(), keys = [], lab = [], rec = {}, iss = {};
  for (var i = 11; i >= 0; i--) { var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); keys.push(k); rec[k] = 0; iss[k] = 0;
    lab.push(d.toLocaleString('en', { month: 'short' }) + (d.getMonth() === 0 || i === 11 ? ' ' + String(d.getFullYear()).slice(2) : '')); }
  ledger.forEach(function(t) {
    if (!(t.item_code in cost) || !t.transaction_date) return;
    var k = String(t.transaction_date).slice(0, 7); if (!(k in rec)) return;
    var tag = (String(t.transaction_type || '') + ' ' + String(t.reference_doc || '')).toUpperCase(), uc = cost[t.item_code];
    if (tag.indexOf('MRIF') > -1) iss[k] += (Number(t.qty_out || 0) - Number(t.qty_in || 0)) * uc;
    else if (tag.indexOf('MRR') > -1) rec[k] += (Number(t.qty_in || 0) - Number(t.qty_out || 0)) * uc;
  });
  var selM = (_mdash.filters && _mdash.filters.month) || 'all';
  if (_xd.charts.flow) _xd.charts.flow.destroy();
  _xd.charts.flow = new Chart(cv, { type: 'bar',
    data: { labels: lab, datasets: [
      { label: 'Received (MRR)', data: keys.map(function(k) { return Math.round(rec[k]); }), backgroundColor: keys.map(function(k) { return selM === 'all' || selM === k ? '#10b981' : 'rgba(16,185,129,.25)'; }), borderRadius: 3 },
      { label: 'Issued (MRIF)', data: keys.map(function(k) { return Math.round(iss[k]); }), backgroundColor: keys.map(function(k) { return selM === 'all' || selM === k ? '#1e3a5f' : 'rgba(30,58,95,.25)'; }), borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + xdP(c.parsed.y); } } } },
      scales: { y: { beginAtZero: true, ticks: { callback: function(v) { return xdP(v); }, font: { size: 10 } } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } } });
  if (note) note.textContent = 'Valued at each item’s current unit cost, so older months are approximate. Respects the category, class and location filters.' + (selM !== 'all' ? ' The selected month is highlighted.' : '');
}
