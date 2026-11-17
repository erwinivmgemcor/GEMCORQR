// ============================================================
// GEMCOR ERP — Weekly Monitoring v2
// Ledger-based weekly report: MRR / MRIF / MRS / ADJ, peso value,
// week-over-week change, stock health, needs-attention list,
// sortable table + per-item transaction drawer.
// Gumagamit ng erpFetchAll (pinipigilan ang 1000-row cut-off ng Supabase).
// ============================================================

var WK = {
  items: [],          // lahat ng active items (raw)
  recs: [],           // per-item weekly records
  filtered: [],
  agg: null, prev: null,
  weekStart: null, weekEnd: null,
  days: [],           // 7 ISO date strings (Mon–Sun)
  page: 1, size: 50,
  sortKey: 'valOut', sortDir: -1,
  chip: 'MOVE', rank: 'val',
  charts: {}, loadId: 0, searchTimer: null, printBackup: null
};

var WK_TYPES = ['MRR', 'MRIF', 'MRS', 'ADJ'];
var WK_COLS = [
  { k: 'code', t: 'Item Code' }, { k: 'desc', t: 'Description' }, { k: 'cat', t: 'Category' },
  { k: 'opening', t: 'Opening', n: 1 }, { k: 'in', t: 'In', n: 1, cls: 'text-success' },
  { k: 'out', t: 'Out', n: 1, cls: 'text-danger' }, { k: 'closing', t: 'Closing', n: 1 },
  { k: 'unit', t: 'Unit' }, { k: 'docs', t: 'Docs', ns: 1 }, { k: 'valOut', t: 'Value Out ₱', n: 1 },
  { k: 'onhand', t: 'On-Hand Now', n: 1 }, { k: 'buffer', t: 'Buffer', n: 1 },
  { k: 'cover', t: 'Cover (days)', n: 1 }, { k: 'sev', t: 'Status' }
];

document.addEventListener('DOMContentLoaded', function () {
  erpCheckHealth();
  wkRenderHead();
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') erpWeeklyCloseDrawer(); });
  window.addEventListener('beforeprint', wkBeforePrint);
  window.addEventListener('afterprint', wkAfterPrint);
  erpWeekToday();
});

async function erpCheckHealth() {
  var badge = document.getElementById('erpHealthBadge'); if (!badge) return;
  var text = document.getElementById('erpHealthText'), dot = badge.querySelector('.dot');
  try {
    var r = await erpHealthCheck();
    if (r.success) { dot.className = 'dot dot-ok'; text.textContent = 'Connected (' + r.latency + 'ms)'; }
    else { dot.className = 'dot dot-error'; text.textContent = 'Offline'; }
  } catch (e) { dot.className = 'dot dot-error'; text.textContent = 'Error'; }
}

// ═══ WEEK MANAGEMENT ═══════════════════════════════════════
function wkMonday(date) {
  var d = new Date(date); d.setHours(0, 0, 0, 0);
  var day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d;
}
function wkISO(date) {
  var d = new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function wkDisp(date) {
  var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
}
function wkSetWeek(monday) {
  WK.weekStart = monday;
  WK.weekEnd = new Date(monday); WK.weekEnd.setDate(WK.weekEnd.getDate() + 6);
  WK.days = [];
  for (var i = 0; i < 7; i++) { var d = new Date(monday); d.setDate(d.getDate() + i); WK.days.push(wkISO(d)); }
  var el = document.getElementById('erpWeekDates');
  if (el) el.textContent = wkDisp(WK.weekStart) + ' — ' + wkDisp(WK.weekEnd);
  var sub = document.getElementById('wkTableSubtitle');
  if (sub) sub.textContent = wkISO(WK.weekStart) === wkISO(wkMonday(new Date())) ? 'Current week' : 'Week of ' + wkDisp(WK.weekStart);
  erpWeeklyLoad();
}
function erpWeekToday() { wkSetWeek(wkMonday(new Date())); }
function erpWeekPrev() { var d = new Date(WK.weekStart); d.setDate(d.getDate() - 7); wkSetWeek(d); }
function erpWeekNext() { var d = new Date(WK.weekStart); d.setDate(d.getDate() + 7); wkSetWeek(d); }

// ═══ DATA LOADING ══════════════════════════════════════════
async function erpWeeklyLoad() {
  var myLoad = ++WK.loadId;
  var tbody = document.getElementById('wkTableBody');
  tbody.innerHTML = '<tr><td colspan="14" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading weekly data...</div></td></tr>';

  var startD = new Date(WK.weekStart);
  var prevD = new Date(startD); prevD.setDate(prevD.getDate() - 7);
  var endD = new Date(WK.weekEnd); endD.setDate(endD.getDate() + 1);
  var fromISO = wkISO(prevD) + 'T00:00:00', toISO = wkISO(endD) + 'T00:00:00';

  try {
    // Items: isang beses lang kunin, i-reuse sa pagpalit ng week
    if (!WK.items.length) {
      WK.items = await erpFetchAll('erp_items',
        'select=item_code,description,category,location,base_unit,on_hand,unit_cost,abc_classification,inventory_movement,' +
        'buffer_stock,reorder_point,ave_daily_consumption,ave_monthly_consumption' +
        '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false&order=item_code.asc');
    }
    // Ledger: current week + previous week (para sa week-over-week)
    var ledger = await erpFetchAll('erp_stock_ledger',
      'select=item_code,qty_in,qty_out,transaction_type,reference_doc,transaction_date,balance_before,balance_after' +
      '&transaction_date=gte.' + encodeURIComponent(fromISO) + '&transaction_date=lt.' + encodeURIComponent(toISO) +
      '&order=transaction_date.asc,item_code.asc');
    if (myLoad !== WK.loadId) return;   // may mas bagong load na

    var map = {}; WK.items.forEach(function (it) { map[it.item_code] = it; });
    var prevDays = []; for (var i = 0; i < 7; i++) { var p = new Date(prevD); p.setDate(p.getDate() + i); prevDays.push(wkISO(p)); }

    WK.agg = wkAggregate(ledger, WK.days, map);
    WK.prev = wkAggregate(ledger, prevDays, map);
    WK.recs = wkBuildRecords(WK.items, WK.agg.per);
    WK.page = 1;

    var u = document.getElementById('wkUpdated');
    if (u) u.textContent = 'Updated ' + new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) + ' • ' + WK.agg.tx + ' transactions';

    wkPopulateFilters(); wkRenderKPIs(); wkRenderInsights(); wkRenderCharts(); wkRenderChips(); erpWeeklyRender();
  } catch (err) {
    console.error('[erpWeeklyLoad]', err);
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty text-danger"><i class="bi bi-exclamation-triangle-fill"></i> Failed to load: ' + erpEsc(err.message) + '</td></tr>';
  }
}

function wkType(tx) {
  var t = (String(tx.transaction_type || '') + ' ' + String(tx.reference_doc || '')).toUpperCase();
  if (t.indexOf('MRIF') > -1) return 'MRIF';
  if (t.indexOf('MRR') > -1) return 'MRR';
  if (t.indexOf('MRS') > -1) return 'MRS';
  if (t.indexOf('ADJ') > -1) return 'ADJ';
  return 'OTHER';
}

function wkAggregate(rows, dayKeys, map) {
  var per = {}, tot = { recvV: 0, issV: 0, retV: 0, adjV: 0, tx: 0 }, docs = { MRR: {}, MRIF: {}, MRS: {}, ADJ: {} };
  var daily = dayKeys.map(function () { return { recv: 0, iss: 0, n: 0 }; });
  var catIss = {};
  rows.forEach(function (tx) {
    var di = dayKeys.indexOf(String(tx.transaction_date || '').slice(0, 10));
    if (di < 0) return;
    var it = map[tx.item_code]; if (!it) return;
    var qin = Number(tx.qty_in || 0), qout = Number(tx.qty_out || 0), cost = Number(it.unit_cost || 0), type = wkType(tx);
    var p = per[tx.item_code] || (per[tx.item_code] = {
      in: 0, out: 0, opening: Number(tx.balance_before || 0), closing: 0, tx: 0, types: {}, valIn: 0, valOut: 0, valRecv: 0, valIss: 0, txs: []
    });
    p.in += qin; p.out += qout; p.closing = Number(tx.balance_after || 0); p.tx++;
    p.valIn += qin * cost; p.valOut += qout * cost;
    var ty = p.types[type] || (p.types[type] = { n: 0, in: 0, out: 0 }); ty.n++; ty.in += qin; ty.out += qout;
    p.txs.push({ d: tx.transaction_date, type: type, ref: tx.reference_doc, in: qin, out: qout, bal: Number(tx.balance_after || 0) });
    tot.tx++; daily[di].n++;
    if (docs[type] && tx.reference_doc) docs[type][tx.reference_doc] = 1;
    var net = (qin - qout) * cost;
    if (type === 'MRR') { tot.recvV += net; daily[di].recv += net; p.valRecv += net; }
    else if (type === 'MRIF') { tot.issV -= net; daily[di].iss -= net; p.valIss -= net;
      var c = it.category || 'Uncategorized'; catIss[c] = (catIss[c] || 0) - net; }
    else if (type === 'MRS') tot.retV += net;
    else if (type === 'ADJ') tot.adjV += net;
  });
  return { per: per, tot: tot, tx: tot.tx, daily: daily, catIss: catIss,
    docCount: { MRR: Object.keys(docs.MRR).length, MRIF: Object.keys(docs.MRIF).length, MRS: Object.keys(docs.MRS).length, ADJ: Object.keys(docs.ADJ).length } };
}

function wkStatus(oh, buf) {
  if (oh < 0) return 'NEG'; if (oh === 0) return 'OUT';
  if (buf > 0 && oh <= buf) return 'BELOW'; if (buf > 0 && oh <= buf * 1.25) return 'LOW'; return 'OK';
}
var WK_SEV = { NEG: 0, OUT: 1, BELOW: 2, LOW: 3, OK: 4 };
var WK_LBL = { NEG: 'Negative', OUT: 'Out of stock', BELOW: 'Below buffer', LOW: 'Near buffer', OK: 'OK' };

function wkBuildRecords(items, per) {
  return items.map(function (it) {
    var p = per[it.item_code], oh = Number(it.on_hand || 0), buf = Number(it.buffer_stock || 0), ad = Number(it.ave_daily_consumption || 0);
    var st = wkStatus(oh, buf), t = p ? p.types : {};
    return {
      code: it.item_code, desc: it.description || '', cat: it.category || '', loc: it.location || '', unit: it.base_unit || '',
      cost: Number(it.unit_cost || 0), abc: it.abc_classification || '', mov: it.inventory_movement || '',
      opening: p ? p.opening : oh, closing: p ? p.closing : oh,
      in: p ? p.in : 0, out: p ? p.out : 0, tx: p ? p.tx : 0, types: t, txs: p ? p.txs : [],
      valIn: p ? p.valIn : 0, valOut: p ? p.valOut : 0,
      onhand: oh, buffer: buf, cover: ad > 0 && oh > 0 ? oh / ad : null, aveDay: ad,
      status: st, sev: WK_SEV[st],
      issued: !!(t.MRIF && t.MRIF.out - t.MRIF.in > 0), received: !!(t.MRR && t.MRR.in - t.MRR.out > 0),
      returned: !!(t.MRS && t.MRS.n), adjusted: !!(t.ADJ && t.ADJ.n)
    };
  });
}

// ═══ KPIs ══════════════════════════════════════════════════
function wkPeso(n) { n = Number(n || 0); var a = Math.abs(n);
  if (a >= 1e6) return (n < 0 ? '−' : '') + '₱' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (n < 0 ? '−' : '') + '₱' + (a / 1e3).toFixed(1) + 'K';
  return (n < 0 ? '−' : '') + '₱' + a.toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
function wkDelta(cur, prev) {
  if (!prev && !cur) return '<span class="d">no change</span>';
  if (!prev) return '<span class="d">new vs last week</span>';
  var pct = ((cur - prev) / Math.abs(prev)) * 100, up = pct >= 0;
  return '<span class="d ' + (Math.abs(pct) < 1 ? '' : up ? 'up' : 'down') + '">' + (up ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '% vs last week</span>';
}
function wkAttentionList() {
  var R = WK.recs, act = R.filter(function (r) { return r.issued; });
  return [
    { key: 'OUT', tone: 'red', n: act.filter(function (r) { return r.status === 'OUT' || r.status === 'NEG'; }).length, t: 'Issued this week and now out of stock / negative', s: 'Reorder or verify the count immediately' },
    { key: 'BELOW', tone: 'amber', n: act.filter(function (r) { return r.status === 'BELOW'; }).length, t: 'Issued this week and now below buffer', s: 'Candidates for PRF / replenishment' },
    { key: 'COVER', tone: 'amber', n: act.filter(function (r) { return r.cover !== null && r.cover < 7 && r.status !== 'BELOW'; }).length, t: 'Less than 7 days of cover left', s: 'Based on average daily consumption' },
    { key: 'NEG', tone: 'red', n: R.filter(function (r) { return r.onhand < 0; }).length, t: 'Items with negative on-hand (all items)', s: 'Data issue — check unprocessed MRR / counts' },
    { key: 'ADJ', tone: 'blue', n: R.filter(function (r) { return r.adjusted; }).length, t: 'Items with manual adjustments (ADJ)', s: 'Review who changed the on-hand and why' },
    { key: 'RET', tone: 'blue', n: R.filter(function (r) { return r.returned; }).length, t: 'Items returned to stock (MRS)', s: 'Returned stock is on-hand and issuable' }
  ];
}
function wkRenderKPIs() {
  var t = WK.agg.tot, p = WK.prev.tot, d = WK.agg.docCount, R = WK.recs;
  var net = t.recvV + t.retV - t.issV + t.adjV, pnet = p.recvV + p.retV - p.issV + p.adjV;
  var attn = wkAttentionList().filter(function (x) { return x.tone === 'red' || x.tone === 'amber'; }).reduce(function (s, x) { return s + x.n; }, 0);
  function card(color, label, val, sub, delta, chip) {
    return '<div class="wk-kpi' + (chip ? ' clickable" onclick="erpWeeklySetChip(\'' + chip + '\')' : '') + '" style="--k:' + color + '">' +
      '<div class="l">' + label + '</div><div class="v">' + val + '</div><div class="s">' + sub + '</div>' + (delta || '') + '</div>';
  }
  document.getElementById('wkKpis').innerHTML =
    card('#059669', 'Received (MRR)', wkPeso(t.recvV), d.MRR + ' MRR docs • ' + R.filter(function (r) { return r.received; }).length + ' items', wkDelta(t.recvV, p.recvV), 'RECV') +
    card('#dc2626', 'Issued (MRIF)', wkPeso(t.issV), d.MRIF + ' MRIF docs • ' + R.filter(function (r) { return r.issued; }).length + ' items', wkDelta(t.issV, p.issV), 'ISS') +
    card('#7c3aed', 'Returned (MRS)', wkPeso(t.retV), d.MRS + ' MRS docs', wkDelta(t.retV, p.retV), 'RET') +
    card('#3b82f6', 'Net stock value change', (net >= 0 ? '+' : '') + wkPeso(net), 'Received + returns − issued ± adjustments', wkDelta(net, pnet)) +
    card('#0ea5e9', 'Transactions', erpNum(WK.agg.tx), R.filter(function (r) { return r.tx > 0; }).length + ' active items', wkDelta(WK.agg.tx, WK.prev.tx), 'MOVE') +
    card(attn ? '#d97706' : '#059669', 'Needs attention', erpNum(attn), attn ? 'Stock-outs, below buffer, low cover' : 'All good this week', '', null);
}
function wkRenderInsights() {
  var list = wkAttentionList().filter(function (x) { return x.n > 0; }), host = document.getElementById('wkInsights');
  host.innerHTML = list.length ? list.map(function (x) {
    return '<div class="wk-ins ' + x.tone + '" onclick="erpWeeklySetChip(\'' + x.key + '\')"><span class="n">' + erpNum(x.n) + '</span><div>' + x.t + '<small>' + x.s + '</small></div></div>';
  }).join('') : '<div class="wk-allgood"><i class="bi bi-check-circle-fill"></i> Nothing urgent — no issued item is out of stock or below buffer.</div>';
}

// ═══ CHARTS ════════════════════════════════════════════════
function wkTheme() {
  var s = getComputedStyle(document.documentElement);
  return { text: s.getPropertyValue('--chart-text').trim() || '#64748b', grid: s.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,.25)' };
}
function wkMakeChart(id, emptyId, cfg, hasData) {
  var cv = document.getElementById(id), em = document.getElementById(emptyId);
  if (WK.charts[id]) { WK.charts[id].destroy(); WK.charts[id] = null; }
  cv.style.display = hasData ? '' : 'none'; em.style.display = hasData ? 'none' : 'flex';
  if (hasData) WK.charts[id] = new Chart(cv.getContext('2d'), cfg);
}
function wkRenderCharts() {
  if (typeof Chart === 'undefined') return;
  var th = wkTheme(), dn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var labels = WK.days.map(function (d, i) { return dn[i] + ' ' + Number(d.slice(8)); }), dl = WK.agg.daily;
  var axis = { ticks: { color: th.text, font: { size: 10 } }, grid: { color: th.grid } };
  wkMakeChart('chartDaily', 'emptyDaily', {
    type: 'bar',
    data: { labels: labels, datasets: [
      { label: 'Received ₱', data: dl.map(function (x) { return Math.round(x.recv); }), backgroundColor: '#10b981', borderRadius: 4, yAxisID: 'y' },
      { label: 'Issued ₱', data: dl.map(function (x) { return Math.round(x.iss); }), backgroundColor: '#ef4444', borderRadius: 4, yAxisID: 'y' },
      { type: 'line', label: 'Transactions', data: dl.map(function (x) { return x.n; }), borderColor: '#3b82f6', backgroundColor: '#3b82f6', tension: .3, yAxisID: 'y1' }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: th.text, boxWidth: 12 } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.dataset.yAxisID === 'y' ? wkPeso(c.parsed.y) : c.parsed.y); } } } },
      scales: { x: { ticks: axis.ticks, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: th.text, font: { size: 10 }, callback: function (v) { return wkPeso(v); } }, grid: axis.grid },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: th.text, precision: 0, font: { size: 10 } } } } }
  }, WK.agg.tx > 0);

  var cats = Object.keys(WK.agg.catIss).map(function (k) { return [k, WK.agg.catIss[k]]; }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
  var top = cats.slice(0, 8), rest = cats.slice(8).reduce(function (s, x) { return s + x[1]; }, 0);
  if (rest > 0) top.push(['Others (' + (cats.length - 8) + ')', rest]);
  wkMakeChart('chartCat', 'emptyCat', {
    type: 'bar',
    data: { labels: top.map(function (x) { return x[0]; }), datasets: [{ data: top.map(function (x) { return Math.round(x[1]); }), backgroundColor: '#1e3a5f', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return wkPeso(c.parsed.x); } } } },
      scales: { x: { beginAtZero: true, ticks: { color: th.text, font: { size: 10 }, callback: function (v) { return wkPeso(v); } }, grid: axis.grid }, y: { ticks: { color: th.text, font: { size: 10 } }, grid: { display: false } } } }
  }, top.length > 0);

  wkTopChart('chartTopIn', 'emptyIn', 'received', '#10b981', th);
  wkTopChart('chartTopOut', 'emptyOut', 'issued', '#ef4444', th);
}
function wkTopChart(id, emptyId, kind, color, th) {
  var isIn = kind === 'received', byVal = WK.rank === 'val';
  var rows = WK.recs.filter(function (r) { return isIn ? r.received : r.issued; }).map(function (r) {
    var t = isIn ? r.types.MRR : r.types.MRIF, q = isIn ? t.in - t.out : t.out - t.in;
    return { r: r, q: q, v: q * r.cost };
  }).sort(function (a, b) { return byVal ? b.v - a.v : b.q - a.q; }).slice(0, 10);
  wkMakeChart(id, emptyId, {
    type: 'bar',
    data: { labels: rows.map(function (x) { return x.r.code; }), datasets: [{ data: rows.map(function (x) { return byVal ? Math.round(x.v) : x.q; }), backgroundColor: color, borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      onClick: function (e, els) { if (els.length) erpWeeklyOpenItem(rows[els[0].index].r.code); },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var x = rows[c.dataIndex];
        return [String(x.r.desc).substring(0, 55), erpNum(x.q) + ' ' + x.r.unit + '  •  ' + wkPeso(x.v)]; } } } },
      scales: { x: { beginAtZero: true, ticks: { color: th.text, font: { size: 10 }, callback: function (v) { return byVal ? wkPeso(v) : erpNum(v); } }, grid: { color: th.grid } },
        y: { ticks: { color: th.text, font: { size: 10 } }, grid: { display: false } } } }
  }, rows.length > 0);
}
function erpWeeklySetRank(m) {
  WK.rank = m;
  document.querySelectorAll('#wkRankSeg button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-rank') === m); });
  var th = wkTheme(); wkTopChart('chartTopIn', 'emptyIn', 'received', '#10b981', th); wkTopChart('chartTopOut', 'emptyOut', 'issued', '#ef4444', th);
}

// ═══ FILTER CHIPS + FILTERS ════════════════════════════════
var WK_CHIPS = [
  { k: 'MOVE', t: 'With movement', f: function (r) { return r.tx > 0; } },
  { k: 'RECV', t: 'Received', f: function (r) { return r.received; } },
  { k: 'ISS', t: 'Issued', f: function (r) { return r.issued; } },
  { k: 'RET', t: 'Returned (MRS)', f: function (r) { return r.returned; } },
  { k: 'ADJ', t: 'Adjusted', f: function (r) { return r.adjusted; } },
  { k: 'OUT', t: 'Issued → stock-out', f: function (r) { return r.issued && (r.status === 'OUT' || r.status === 'NEG'); } },
  { k: 'BELOW', t: 'Issued → below buffer', f: function (r) { return r.issued && r.status === 'BELOW'; } },
  { k: 'COVER', t: 'Cover < 7 days', f: function (r) { return r.issued && r.cover !== null && r.cover < 7 && r.status !== 'BELOW'; } },
  { k: 'NEG', t: 'Negative on-hand', f: function (r) { return r.onhand < 0; } },
  { k: 'IDLE', t: 'No movement', f: function (r) { return r.tx === 0; } },
  { k: 'ALL', t: 'All items', f: function () { return true; } }
];
function wkRenderChips() {
  document.getElementById('wkChips').innerHTML = WK_CHIPS.map(function (c) {
    var n = WK.recs.filter(c.f).length;
    return '<button class="wk-chip' + (c.k === WK.chip ? ' active' : '') + '" onclick="erpWeeklySetChip(\'' + c.k + '\')">' + c.t + '<b>' + erpNum(n) + '</b></button>';
  }).join('');
}
function erpWeeklySetChip(k) {
  WK.chip = k; WK.page = 1; wkRenderChips(); erpWeeklyRender();
  var tbl = document.querySelector('.erp-table-card'); if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function wkPopulateFilters() {
  var cs = document.getElementById('wkCategoryFilter'), ls = document.getElementById('wkLocationFilter'), cc = cs.value, lc = ls.value, c = {}, l = {};
  WK.recs.forEach(function (r) { if (r.cat) c[r.cat] = 1; if (r.loc) l[r.loc] = 1; });
  cs.innerHTML = '<option value="">All Categories</option>' + Object.keys(c).sort().map(function (x) { return '<option value="' + erpEsc(x) + '"' + (x === cc ? ' selected' : '') + '>' + erpEsc(x) + '</option>'; }).join('');
  ls.innerHTML = '<option value="">All Locations</option>' + Object.keys(l).sort().map(function (x) { return '<option value="' + erpEsc(x) + '"' + (x === lc ? ' selected' : '') + '>' + erpEsc(x) + '</option>'; }).join('');
}
function erpWeeklyFilterChanged() { WK.page = 1; erpWeeklyRender(); }
function erpWeeklyOnSearch() { clearTimeout(WK.searchTimer); WK.searchTimer = setTimeout(erpWeeklyFilterChanged, 300); }
function erpWeeklyPageSize(v) { WK.size = Number(v) || 50; WK.page = 1; erpWeeklyRender(); }
function erpWeeklyClearFilters() {
  document.getElementById('wkSearchInput').value = ''; document.getElementById('wkCategoryFilter').value = ''; document.getElementById('wkLocationFilter').value = '';
  WK.chip = 'MOVE'; WK.page = 1; wkRenderChips(); erpWeeklyRender();
}

// ═══ TABLE ═════════════════════════════════════════════════
function wkRenderHead() {
  document.getElementById('wkHead').innerHTML = WK_COLS.map(function (c) {
    var on = WK.sortKey === c.k, ar = on ? (WK.sortDir > 0 ? '▲' : '▼') : '';
    return '<th class="' + (c.n ? 'text-end ' : '') + (c.ns ? 'nosort ' : '') + (c.cls || '') + '"' + (c.ns ? '' : ' onclick="erpWeeklySort(\'' + c.k + '\')"') + '>' + c.t + '<span class="ar">' + ar + '</span></th>';
  }).join('');
}
function erpWeeklySort(k) {
  if (WK.sortKey === k) WK.sortDir *= -1; else { WK.sortKey = k; WK.sortDir = (k === 'code' || k === 'desc' || k === 'cat' || k === 'unit' || k === 'sev') ? 1 : -1; }
  wkRenderHead(); erpWeeklyRender();
}
function wkSortVal(r, k) {
  if (k === 'cover') return r.cover === null ? (WK.sortDir > 0 ? 1e12 : -1) : r.cover;
  var v = r[k]; return typeof v === 'string' ? v.toLowerCase() : Number(v || 0);
}
function wkDocChips(r) {
  var out = '';
  WK_TYPES.concat(['OTHER']).forEach(function (t) { if (r.types[t]) out += '<span class="wk-doc ' + t + '" title="' + r.types[t].n + ' transaction(s)">' + t + (r.types[t].n > 1 ? ' ×' + r.types[t].n : '') + '</span>'; });
  return out || '<span class="wk-muted">—</span>';
}
function erpWeeklyRender() {
  var tbody = document.getElementById('wkTableBody'); if (!tbody) return;
  var q = document.getElementById('wkSearchInput').value.toLowerCase().trim(), cat = document.getElementById('wkCategoryFilter').value, loc = document.getElementById('wkLocationFilter').value;
  var chip = WK_CHIPS.filter(function (c) { return c.k === WK.chip; })[0] || WK_CHIPS[0];
  WK.filtered = WK.recs.filter(function (r) {
    if (q && r.code.toLowerCase().indexOf(q) < 0 && r.desc.toLowerCase().indexOf(q) < 0) return false;
    if (cat && r.cat !== cat) return false; if (loc && r.loc !== loc) return false;
    return chip.f(r);
  });
  var k = WK.sortKey, dir = WK.sortDir;
  WK.filtered.sort(function (a, b) { var x = wkSortVal(a, k), y = wkSortVal(b, k); return (x < y ? -1 : x > y ? 1 : a.code < b.code ? -1 : 1) * dir; });

  var total = WK.filtered.length, start = (WK.page - 1) * WK.size, end = Math.min(start + WK.size, total), page = WK.filtered.slice(start, end);
  document.getElementById('wkTableCount').textContent = erpNum(total) + ' items';
  document.getElementById('wkPageTotal').textContent = erpNum(total);
  document.getElementById('wkPageStart').textContent = total ? start + 1 : 0;
  document.getElementById('wkPageEnd').textContent = end;
  document.getElementById('wkPageLabel').textContent = 'Page ' + WK.page + ' / ' + Math.max(1, Math.ceil(total / WK.size));
  document.getElementById('wkBtnPrev').disabled = WK.page <= 1; document.getElementById('wkBtnNext').disabled = end >= total;

  if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty"><i class="bi bi-inbox fs-2 d-block mb-2"></i>No items match this filter for the selected week.</td></tr>';
    document.getElementById('wkFoot').innerHTML = ''; return;
  }
  tbody.innerHTML = page.map(function (r) {
    return '<tr onclick="erpWeeklyOpenItem(\'' + String(r.code).replace(/'/g, "\\'") + '\')">' +
      '<td><code>' + erpEsc(r.code) + '</code></td><td class="desc">' + erpEsc(r.desc || '—') + '</td><td>' + erpEsc(r.cat || '—') + '</td>' +
      '<td class="text-end">' + erpNum(r.opening) + '</td>' +
      '<td class="text-end text-success fw-bold">' + (r.in > 0 ? '+' + erpNum(r.in) : '—') + '</td>' +
      '<td class="text-end text-danger fw-bold">' + (r.out > 0 ? '−' + erpNum(r.out) : '—') + '</td>' +
      '<td class="text-end fw-bold">' + erpNum(r.closing) + '</td><td>' + erpEsc(r.unit) + '</td><td>' + wkDocChips(r) + '</td>' +
      '<td class="text-end">' + (r.valOut > 0 ? wkPeso(r.valOut) : '<span class="wk-muted">—</span>') + '</td>' +
      '<td class="text-end">' + erpNum(r.onhand) + '</td><td class="text-end">' + (r.buffer > 0 ? erpNum(r.buffer) : '<span class="wk-muted">—</span>') + '</td>' +
      '<td class="text-end">' + (r.cover !== null ? (r.cover < 1 ? '<1' : Math.round(r.cover)) : '<span class="wk-muted">—</span>') + '</td>' +
      '<td><span class="wk-pill ' + r.status + '">' + WK_LBL[r.status] + '</span></td></tr>';
  }).join('');
  var sIn = 0, sOut = 0, sVal = 0; WK.filtered.forEach(function (r) { sVal += r.valOut; });
  document.getElementById('wkFoot').innerHTML = '<tr><td colspan="9">Total for ' + erpNum(total) + ' filtered items (value out)</td><td class="text-end">' + wkPeso(sVal) + '</td><td colspan="4"></td></tr>';
}
function erpWeeklyPagePrev() { if (WK.page > 1) { WK.page--; erpWeeklyRender(); } }
function erpWeeklyPageNext() { if (WK.page < Math.ceil(WK.filtered.length / WK.size)) { WK.page++; erpWeeklyRender(); } }

// ═══ ITEM DRAWER ═══════════════════════════════════════════
function erpWeeklyOpenItem(code) {
  var r = WK.recs.filter(function (x) { return x.code === code; })[0]; if (!r) return;
  var dr = document.getElementById('wkDrawer');
  var rows = r.txs.length ? r.txs.map(function (t) {
    return '<tr><td>' + erpEsc(String(t.d || '').replace('T', ' ').slice(0, 16)) + '</td><td><span class="wk-doc ' + t.type + '">' + t.type + '</span></td><td>' + erpEsc(t.ref || '—') + '</td>' +
      '<td class="text-end text-success">' + (t.in ? '+' + erpNum(t.in) : '') + '</td><td class="text-end text-danger">' + (t.out ? '−' + erpNum(t.out) : '') + '</td><td class="text-end"><b>' + erpNum(t.bal) + '</b></td></tr>';
  }).join('') : '<tr><td colspan="6" class="wk-muted" style="padding:16px;text-align:center">No transactions this week</td></tr>';
  dr.innerHTML = '<button class="x" onclick="erpWeeklyCloseDrawer()">&times;</button>' +
    '<h5><code>' + erpEsc(r.code) + '</code></h5><div class="sub">' + erpEsc(r.desc) + '<br>' + erpEsc(r.cat || '—') + ' • ' + erpEsc(r.loc || '—') + ' • <span class="wk-pill ' + r.status + '">' + WK_LBL[r.status] + '</span></div>' +
    '<div class="wk-mini"><div><b>' + erpNum(r.opening) + '</b><span>Opening</span></div><div><b class="text-success">+' + erpNum(r.in) + '</b><span>In</span></div><div><b class="text-danger">−' + erpNum(r.out) + '</b><span>Out</span></div><div><b>' + erpNum(r.closing) + '</b><span>Closing</span></div></div>' +
    '<div class="wk-mini"><div><b>' + erpNum(r.onhand) + '</b><span>On-hand now</span></div><div><b>' + erpNum(r.buffer) + '</b><span>Buffer</span></div><div><b>' + (r.cover !== null ? Math.round(r.cover) + 'd' : '—') + '</b><span>Cover</span></div><div><b>' + wkPeso(r.cost) + '</b><span>Unit cost</span></div></div>' +
    '<table class="wk-tx"><thead><tr><th>Date</th><th>Type</th><th>Ref doc</th><th class="text-end">In</th><th class="text-end">Out</th><th class="text-end">Balance</th></tr></thead><tbody>' + rows + '</tbody></table>';
  dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false'); document.getElementById('wkOverlay').classList.add('open');
}
function erpWeeklyCloseDrawer() {
  document.getElementById('wkDrawer').classList.remove('open'); document.getElementById('wkOverlay').classList.remove('open');
}

// ═══ EXPORTS (CSV, may BOM para buo ang ₱ / − sa Excel) ═══════
function wkMoving() { return WK.filtered.filter(function (r) { return r.tx > 0; }); }
function erpExportWeeklyBasic() {
  var items = wkMoving(); if (!items.length) return erpWeeklyShowToast('No movement data to export');
  wkCSV(['Item Code', 'Description', 'Opening', 'In', 'Out', 'Closing', 'Unit'],
    items.map(function (r) { return [r.code, r.desc, r.opening, r.in, r.out, r.closing, r.unit]; }), 'Weekly_Basic_' + wkISO(WK.weekStart) + '.csv');
}
function erpExportWeeklyDetailed() {
  var items = wkMoving(); if (!items.length) return erpWeeklyShowToast('No movement data to export');
  function q(r, t, s) { var x = r.types[t]; return x ? (s === 'in' ? x.in : x.out) : 0; }
  wkCSV(['Item Code', 'Description', 'Category', 'Location', 'Unit', 'Opening', 'In', 'Out', 'Closing', 'MRR In', 'MRIF Out', 'MRS In', 'ADJ Net', 'Transactions',
    'Unit Cost', 'Value In', 'Value Out', 'On-Hand Now', 'Buffer', 'Ave Daily', 'Cover Days', 'Status', 'ABC', 'Movement Class'],
    items.map(function (r) { return [r.code, r.desc, r.cat, r.loc, r.unit, r.opening, r.in, r.out, r.closing, q(r, 'MRR', 'in'), q(r, 'MRIF', 'out'), q(r, 'MRS', 'in'),
      q(r, 'ADJ', 'in') - q(r, 'ADJ', 'out'), r.tx, r.cost, r.valIn.toFixed(2), r.valOut.toFixed(2), r.onhand, r.buffer, r.aveDay, r.cover === null ? '' : r.cover.toFixed(1), WK_LBL[r.status], r.abc, r.mov]; }),
    'Weekly_Detailed_' + wkISO(WK.weekStart) + '.csv');
}
function erpExportWeeklyTx() {
  var rows = []; WK.filtered.forEach(function (r) { r.txs.forEach(function (t) { rows.push([String(t.d || '').replace('T', ' ').slice(0, 19), r.code, r.desc, t.type, t.ref || '', t.in, t.out, t.bal, r.unit]); }); });
  if (!rows.length) return erpWeeklyShowToast('No transactions to export');
  rows.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
  wkCSV(['Date', 'Item Code', 'Description', 'Type', 'Reference Doc', 'In', 'Out', 'Balance After', 'Unit'], rows, 'Weekly_Transactions_' + wkISO(WK.weekStart) + '.csv');
}
function wkCSV(headers, rows, filename) {
  function esc(v) { if (v === null || v === undefined) return ''; var s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  var csv = '\uFEFF' + [headers].concat(rows).map(function (r) { return r.map(esc).join(','); }).join('\n');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  erpWeeklyShowToast('✅ Exported ' + rows.length + ' rows');
}

// ═══ PRINT (ilalabas lahat ng filtered rows, hindi lang isang page) ═══
function wkBeforePrint() { WK.printBackup = { size: WK.size, page: WK.page }; WK.size = 1000; WK.page = 1; erpWeeklyRender(); Object.keys(WK.charts).forEach(function (k) { if (WK.charts[k]) WK.charts[k].resize(); }); }
function wkAfterPrint() { if (WK.printBackup) { WK.size = WK.printBackup.size; WK.page = WK.printBackup.page; WK.printBackup = null; erpWeeklyRender(); } }

// ═══ REFRESH + TOAST ═══════════════════════════════════════
function erpWeeklyRefresh() {
  if (typeof erpClearCache === 'function') erpClearCache('weekly_movement');
  WK.items = [];   // kunin ulit ang items (on-hand, buffer)
  erpWeeklyShowToast('Refreshing weekly data...'); erpWeeklyLoad(); erpCheckHealth();
}
function erpWeeklyShowToast(msg) {
  var el = document.getElementById('erpToast'); if (!el) return;
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 }).show();
}
console.log('✅ weekly-monitor.js v2 loaded');
