// ============================================================
// GEMCOR ERP — Warehouse KPI (admin)
// Source: documents (MRIF/MRS) + erp_get_doc_open_log (optional, for handling time)
//   Turnaround = created_at -> processed_at
//   Handling   = last time the staff opened Process page -> processed_at (needs warehouse-kpi.sql)
// ============================================================
var _wk = { docs: [], open: [], opens: {}, haveLog: false, from: null, to: null };

function wkEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function wkEl(id) { return document.getElementById(id); }
function wkDay(d) { var x = new Date(d); x.setHours(0,0,0,0); return x; }
function wkIso(d) { return d.toISOString(); }
function wkInput(d) { var p = function(n) { return String(n).padStart(2,'0'); }; return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()); }

function wkDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  var m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  var h = m / 60;
  if (h < 48) return (Math.round(h * 10) / 10) + 'h';
  return (Math.round(h / 24 * 10) / 10) + 'd';
}
function wkAvg(a) { return a.length ? a.reduce(function(s, x) { return s + x; }, 0) / a.length : null; }

function wkOnRange() {
  var custom = wkEl('wkRange').value === 'custom';
  wkEl('wkFrom').style.display = custom ? '' : 'none';
  wkEl('wkTo').style.display = custom ? '' : 'none';
  if (custom && !wkEl('wkFrom').value) {
    wkEl('wkFrom').value = wkInput(new Date(Date.now() - 30 * 86400000));
    wkEl('wkTo').value = wkInput(new Date());
  }
  wkLoad();
}

function wkRangeDates() {
  var v = wkEl('wkRange').value, now = new Date(), from, to = new Date(now.getTime() + 60000);
  if (v === 'today') from = wkDay(now);
  else if (v === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (v === 'custom') {
    from = wkEl('wkFrom').value ? new Date(wkEl('wkFrom').value + 'T00:00:00') : wkDay(now);
    to = wkEl('wkTo').value ? new Date(wkEl('wkTo').value + 'T23:59:59') : to;
  } else from = wkDay(new Date(now.getTime() - (parseInt(v, 10) - 1) * 86400000));
  return { from: from, to: to };
}

async function wkLoad() {
  var msg = wkEl('wkMsg');
  msg.textContent = 'Loading…';
  try {
    var r = wkRangeDates();
    _wk.from = r.from; _wk.to = r.to;
    wkEl('wkRangeLabel').textContent = r.from.toLocaleDateString() + ' – ' + r.to.toLocaleDateString();
    var f = encodeURIComponent(wkIso(r.from)), t = encodeURIComponent(wkIso(r.to));
    var cols = 'select=doc_no,doc_type,status,requestor,department,created_at,processed_by,processed_at';
    var base = cols + '&doc_type=in.(MRIF,MRS)';

    var res = await Promise.all([
      erpFetchAll('documents', base + '&or=(and(created_at.gte.' + f + ',created_at.lte.' + t + '),and(processed_at.gte.' + f + ',processed_at.lte.' + t + '))&order=created_at.desc'),
      erpFetchAll('documents', base + '&status=in.(PENDING,PARTIAL)&order=created_at.asc'),
      wkLoadOpenLog(f, t)
    ]);
    _wk.docs = res[0] || [];
    _wk.open = (res[1] || []).filter(function(d) { return !(d.doc_type === 'MRS' && d.processed_at); });
    wkRender();
    msg.textContent = '';
  } catch (e) {
    console.error('[wkLoad]', e);
    msg.textContent = 'Failed to load: ' + e.message;
  }
}

// Optional: needs warehouse-kpi.sql. Without it, handling time shows "—".
async function wkLoadOpenLog(f, t) {
  _wk.opens = {}; _wk.haveLog = false;
  try {
    var res = await fetch(erpUrl('rpc/erp_get_doc_open_log'), {
      method: 'POST', headers: erpHeaders(),
      body: JSON.stringify({ p_from: decodeURIComponent(f), p_to: decodeURIComponent(t) })
    });
    if (!res.ok) return;
    var rows = await res.json();
    _wk.haveLog = true;
    (rows || []).forEach(function(o) {
      (_wk.opens[o.doc_no] = _wk.opens[o.doc_no] || []).push({ by: String(o.opened_by || '').toLowerCase(), by_name: String(o.opened_by_name || '').toLowerCase(), at: new Date(o.opened_at).getTime() });
    });
  } catch (e) { console.warn('[wk] open log unavailable', e); }
}

function wkHandling(d) {
  var list = _wk.opens[d.doc_no];
  if (!list || !d.processed_at) return null;
  var p = new Date(d.processed_at).getTime(), who = String(d.processed_by || '').toLowerCase();
  var best = null;
  list.forEach(function(o) {
    if (o.at <= p && (o.by === who || o.by_name === who) && (best === null || o.at > best)) best = o.at;
  });
  return best === null ? null : p - best;
}

function wkRender() {
  var type = wkEl('wkType').value;
  var slaMs = (parseFloat(wkEl('wkSla').value) || 24) * 3600000;
  var from = _wk.from.getTime(), to = _wk.to.getTime();
  var days = Math.max(1, Math.ceil((to - from) / 86400000));
  var ok = function(d) { return !type || d.doc_type === type; };

  var docs = _wk.docs.filter(ok);
  var received = docs.filter(function(d) { var c = new Date(d.created_at).getTime(); return c >= from && c <= to; });
  var done = docs.filter(function(d) {
    if (!d.processed_at || !d.processed_by) return false;
    var p = new Date(d.processed_at).getTime(); return p >= from && p <= to;
  });
  done.forEach(function(d) {
    d._tat = new Date(d.processed_at).getTime() - new Date(d.created_at).getTime();
    d._hand = wkHandling(d);
  });
  var open = _wk.open.filter(ok);

  // ── KPI cards
  var tats = done.map(function(d) { return d._tat; }).filter(function(x) { return x >= 0; });
  var hands = done.map(function(d) { return d._hand; }).filter(function(x) { return x != null && x >= 0; });
  var within = tats.filter(function(x) { return x <= slaMs; }).length;
  wkEl('kReceived').textContent = received.length;
  wkEl('kReceivedSub').textContent = received.filter(function(d) { return d.doc_type === 'MRIF'; }).length + ' MRIF · ' + received.filter(function(d) { return d.doc_type === 'MRS'; }).length + ' MRS';
  wkEl('kCompleted').textContent = done.length;
  wkEl('kCompletedSub').textContent = tats.length ? Math.round(within / tats.length * 100) + '% within ' + (slaMs / 3600000) + 'h target' : ' ';
  wkEl('kAvgTat').textContent = wkDur(wkAvg(tats));
  wkEl('kHandle').textContent = wkDur(wkAvg(hands));
  wkEl('kHandleSub').textContent = _wk.haveLog ? 'open Process → submit' : 'run warehouse-kpi.sql to enable';
  wkEl('kBacklog').textContent = open.length;
  var oldest = open.length ? Date.now() - new Date(open[0].created_at).getTime() : null;
  wkEl('kBacklogSub').textContent = open.length ? 'oldest: ' + wkDur(oldest) : 'walang naghihintay';

  // ── Staff table
  var staff = {};
  done.forEach(function(d) {
    var k = String(d.processed_by).trim();
    var s = staff[k] = staff[k] || { name: k, n: 0, tat: [], hand: [] };
    s.n++; if (d._tat >= 0) s.tat.push(d._tat); if (d._hand != null && d._hand >= 0) s.hand.push(d._hand);
  });
  var srows = Object.keys(staff).map(function(k) { return staff[k]; }).sort(function(a, b) { return b.n - a.n; });
  var tb = wkEl('tblStaff').querySelector('tbody');
  tb.innerHTML = srows.length ? srows.map(function(s, i) {
    var w = s.tat.filter(function(x) { return x <= slaMs; }).length, pct = s.tat.length ? Math.round(w / s.tat.length * 100) : 0;
    var cls = pct >= 80 ? 'g' : pct >= 50 ? 'a' : 'r';
    return '<tr><td class="wk-rank">' + (i + 1) + '</td><td class="fw-semibold">' + wkEsc(s.name) + '</td>' +
      '<td class="text-end fw-bold">' + s.n + '</td><td class="text-end">' + (Math.round(s.n / days * 10) / 10) + '</td>' +
      '<td class="text-end">' + wkDur(wkAvg(s.tat)) + '</td><td class="text-end">' + wkDur(s.tat.length ? Math.min.apply(null, s.tat) : null) + '</td>' +
      '<td class="text-end">' + wkDur(s.tat.length ? Math.max.apply(null, s.tat) : null) + '</td>' +
      '<td><div class="d-flex align-items-center gap-2"><div class="wk-bar ' + cls + '" style="flex:1"><span style="width:' + pct + '%"></span></div><span class="small fw-bold">' + pct + '%</span></div></td>' +
      '<td class="text-end">' + wkDur(wkAvg(s.hand)) + '</td></tr>';
  }).join('') : '<tr><td colspan="9" class="text-center text-muted py-3">Walang na-complete sa period na ito.</td></tr>';

  // ── Requestors (by created in range)
  var rq = {};
  received.forEach(function(d) {
    var k = String(d.requestor || '—').trim() || '—';
    var r = rq[k] = rq[k] || { name: k, dept: {}, MRIF: 0, MRS: 0 };
    r[d.doc_type]++; if (d.department) r.dept[d.department] = (r.dept[d.department] || 0) + 1;
  });
  var rrows = Object.keys(rq).map(function(k) { return rq[k]; }).sort(function(a, b) { return (b.MRIF + b.MRS) - (a.MRIF + a.MRS); });
  var rmax = rrows.length ? rrows[0].MRIF + rrows[0].MRS : 1;
  wkEl('tblReq').querySelector('tbody').innerHTML = rrows.length ? rrows.map(function(r, i) {
    var dept = Object.keys(r.dept).sort(function(a, b) { return r.dept[b] - r.dept[a]; })[0] || '—';
    var tot = r.MRIF + r.MRS;
    return '<tr><td class="wk-rank">' + (i + 1) + '</td><td>' + wkEsc(r.name) + '</td><td>' + wkEsc(dept) + '</td><td class="text-end">' + r.MRIF + '</td><td class="text-end">' + r.MRS + '</td><td class="text-end fw-bold">' + tot + '</td><td><div class="wk-bar"><span style="width:' + Math.round(tot / rmax * 100) + '%"></span></div></td></tr>';
  }).join('') : '<tr><td colspan="7" class="text-center text-muted py-3">Walang request.</td></tr>';

  // ── Departments
  var dp = {};
  received.forEach(function(d) { var k = d.department || '—'; (dp[k] = dp[k] || { name: k, n: 0, done: 0, tat: [] }).n++; });
  done.forEach(function(d) { var k = d.department || '—'; var o = dp[k] = dp[k] || { name: k, n: 0, done: 0, tat: [] }; o.done++; if (d._tat >= 0) o.tat.push(d._tat); });
  var drows = Object.keys(dp).map(function(k) { return dp[k]; }).sort(function(a, b) { return b.n - a.n; });
  var dmax = drows.length ? Math.max(1, drows[0].n) : 1;
  wkEl('tblDept').querySelector('tbody').innerHTML = drows.length ? drows.map(function(r, i) {
    return '<tr><td class="wk-rank">' + (i + 1) + '</td><td>' + wkEsc(r.name) + '</td><td class="text-end fw-bold">' + r.n + '</td><td class="text-end">' + r.done + '</td><td class="text-end">' + wkDur(wkAvg(r.tat)) + '</td><td><div class="wk-bar"><span style="width:' + Math.round(r.n / dmax * 100) + '%"></span></div></td></tr>';
  }).join('') : '<tr><td colspan="6" class="text-center text-muted py-3">Walang data.</td></tr>';

  // ── Aging
  var buckets = [['< 4h', 0, 4], ['4–24h', 4, 24], ['1–3 days', 24, 72], ['3–7 days', 72, 168], ['> 7 days', 168, 1e9]], now = Date.now();
  var colors = ['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444'];
  wkEl('wkAging').innerHTML = buckets.map(function(b, i) {
    var n = open.filter(function(d) { var h = (now - new Date(d.created_at).getTime()) / 3600000; return h >= b[1] && h < b[2]; }).length;
    return '<div style="min-width:120px;border:1px solid #e2e8f0;border-left:6px solid ' + colors[i] + ';border-radius:10px;padding:8px 14px;background:#fff">' +
      '<div class="wk-note fw-bold">' + b[0] + '</div><div style="font-size:1.6rem;font-weight:800;line-height:1.1">' + n + '</div></div>';
  }).join('');
}

window.wkLoad = wkLoad; window.wkOnRange = wkOnRange; window.wkRender = wkRender;
document.addEventListener('DOMContentLoaded', function() { setTimeout(wkLoad, 0); });
