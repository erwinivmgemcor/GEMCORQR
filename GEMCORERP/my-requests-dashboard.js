// ============================================================
// GEMCOR ERP — My Requests Dashboard (analytics + progress tracking)
// v1.0 — reads _myRequests.allDocs (set by my-requests.js) and
//        doc_items (requested_qty / issued_qty) for item progress.
// ============================================================

var MRD_OVERDUE_DAYS = 3;      // an open request older than this is flagged late
var MRD_WEEKS = 8;             // weeks shown in the trend chart
var MRD_PROGRESS_TTL = 60000;  // ms before item progress is fetched again
var MRD_CHUNK = 50;            // docs per doc_items query (keeps the URL short)

var _mrd = { progress: {}, progressAt: 0, loading: false };

// ── helpers ──────────────────────────────────────────────────
function mrdStatus(d) { return String((d && d.status) || 'PENDING').toUpperCase(); }
function mrdIsOpen(d) { var s = mrdStatus(d); return s === 'PENDING' || s === 'PARTIAL'; }

function mrdDaysSince(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function mrdAgeLabel(days) {
  if (days <= 0) return 'Today';
  return days + (days === 1 ? ' day' : ' days');
}

function mrdFmtDuration(days) {
  if (days < 1) { var h = Math.max(1, Math.round(days * 24)); return { n: h, unit: h === 1 ? 'hr' : 'hrs' }; }
  var v = Math.round(days * 10) / 10;
  return { n: v, unit: v === 1 ? 'day' : 'days' };
}

function mrdMedian(arr) {
  if (!arr.length) return null;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mrdWeekStart(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  var dow = (d.getDay() + 6) % 7;       // Monday = 0
  d.setDate(d.getDate() - dow);
  return d;
}

function mrdE(s) { return typeof erpEsc === 'function' ? erpEsc(s) : String(s == null ? '' : s); }

// ── item progress (doc_items) ────────────────────────────────
// Per document: how many lines are fully served, and an overall % that gives
// partial credit. Lines are counted, not quantities, so units never get mixed.
async function mrdLoadProgress() {
  var docs = (_myRequests.allDocs || []);
  if (!docs.length || _mrd.loading) return false;
  if (Date.now() - _mrd.progressAt < MRD_PROGRESS_TTL) return false;
  _mrd.loading = true;
  try {
    var nos = docs.map(function (d) { return d.doc_no; }).filter(Boolean);
    var chunks = [];
    for (var i = 0; i < nos.length; i += MRD_CHUNK) chunks.push(nos.slice(i, i + MRD_CHUNK));

    var results = await Promise.all(chunks.map(function (c) {
      return erpFetch('doc_items',
        'select=doc_no,requested_qty,issued_qty&doc_no=in.(' + encodeURIComponent(c.join(',')) + ')&limit=5000');
    }));

    var fresh = {};
    results.forEach(function (rows) {
      (rows || []).forEach(function (r) {
        var p = fresh[r.doc_no] || (fresh[r.doc_no] = { lines: 0, done: 0, sum: 0 });
        var req = Number(r.requested_qty) || 0;
        var iss = Number(r.issued_qty) || 0;
        p.lines++;
        var ratio = req > 0 ? Math.min(iss / req, 1) : (iss > 0 ? 1 : 0);
        p.sum += ratio;
        if (req > 0 ? iss >= req : iss > 0) p.done++;
      });
    });
    Object.keys(fresh).forEach(function (k) { fresh[k].pct = Math.round(fresh[k].sum / fresh[k].lines * 100); });
    _mrd.progress = fresh;
    _mrd.progressAt = Date.now();
    return true;
  } catch (err) {
    console.warn('[MRD] Item progress unavailable:', err.message);
    return false;
  } finally {
    _mrd.loading = false;
  }
}

// null = unknown. PENDING/COMPLETED can be inferred from status alone.
function mrdProgressPct(d) {
  var p = _mrd.progress[d.doc_no];
  if (p && p.lines > 0) return p.pct;
  var s = mrdStatus(d);
  if (s === 'COMPLETED') return 100;
  if (s === 'PENDING') return 0;
  return null;
}

function mrdBarHtml(pct, withNum) {
  if (pct == null) return '<span class="mrd-prog-na">—</span>';
  var cls = pct >= 100 ? 'is-done' : (pct <= 0 ? 'is-zero' : '');
  return '<div class="mrd-bar ' + cls + '" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
    '<span style="width:' + Math.max(pct, pct > 0 ? 4 : 0) + '%"></span></div>' +
    (withNum ? '<span class="mrd-prog-num">' + pct + '% served</span>' : '');
}

// Used by the table in my-requests.js
function mrdProgressCell(d) {
  return '<div class="mrd-prog-cell">' + mrdBarHtml(mrdProgressPct(d), true) + '</div>';
}

function mrdAgeSub(d) {
  if (!mrdIsOpen(d)) return '';
  var days = mrdDaysSince(d.created_at);
  var late = days > MRD_OVERDUE_DAYS;
  return '<span class="mrd-date-sub' + (late ? ' late' : '') + '">' +
    (late ? '⚠ ' : '') + 'open ' + mrdAgeLabel(days) + '</span>';
}

function mrdFillCells() {
  document.querySelectorAll('[data-prog-doc]').forEach(function (td) {
    var no = td.getAttribute('data-prog-doc');
    var d = (_myRequests.allDocs || []).filter(function (x) { return x.doc_no === no; })[0];
    if (d) td.innerHTML = mrdProgressCell(d);
  });
}

// ── metrics ──────────────────────────────────────────────────
function mrdMetrics() {
  var docs = _myRequests.allDocs || [];
  var now = new Date();
  var m = {
    total: docs.length, pending: 0, partial: 0, completed: 0,
    open: [], overdue: 0, procDays: [],
    thisMonth: 0, lastMonth: 0,
    lines: 0, linesDone: 0, hasProgress: false, weeks: []
  };

  var firstWeek = mrdWeekStart(now);
  firstWeek.setDate(firstWeek.getDate() - 7 * (MRD_WEEKS - 1));
  for (var w = 0; w < MRD_WEEKS; w++) {
    var ws = new Date(firstWeek); ws.setDate(ws.getDate() + 7 * w);
    m.weeks.push({ start: ws, mrif: 0, mrs: 0 });
  }

  docs.forEach(function (d) {
    var s = mrdStatus(d);
    if (s === 'PENDING') m.pending++;
    else if (s === 'PARTIAL') m.partial++;
    else if (s === 'COMPLETED') m.completed++;

    var created = d.created_at ? new Date(d.created_at) : null;
    var validCreated = created && !isNaN(created.getTime());

    if (mrdIsOpen(d)) {
      var age = mrdDaysSince(d.created_at);
      m.open.push({ doc: d, age: age, status: s });
      if (age > MRD_OVERDUE_DAYS) m.overdue++;
    }

    if (validCreated && d.processed_at) {
      var diff = (new Date(d.processed_at) - created) / 86400000;
      if (!isNaN(diff) && diff >= 0) m.procDays.push(diff);
    }

    if (validCreated) {
      if (created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()) m.thisMonth++;
      var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      if (created.getFullYear() === lm.getFullYear() && created.getMonth() === lm.getMonth()) m.lastMonth++;

      var wk = mrdWeekStart(created).getTime();
      m.weeks.forEach(function (b) {
        if (b.start.getTime() === wk) {
          if (String(d.doc_type).toUpperCase() === 'MRS') b.mrs++; else b.mrif++;
        }
      });
    }

    var p = _mrd.progress[d.doc_no];
    if (p && p.lines > 0) { m.lines += p.lines; m.linesDone += p.done; m.hasProgress = true; }
  });

  m.open.sort(function (a, b) { return b.age - a.age; });
  return m;
}

// ── renderers ────────────────────────────────────────────────
function mrdRing(pct) {
  var r = 26, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  var color = pct >= 80 ? '#10b981' : (pct >= 50 ? '#3b82f6' : '#f59e0b');
  return '<svg class="mrd-ring" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">' +
    '<circle cx="34" cy="34" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="8"/>' +
    '<circle cx="34" cy="34" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round" ' +
    'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 34 34)"/>' +
    '<text x="34" y="38.5" text-anchor="middle" font-size="13" font-weight="800" fill="#0f172a">' + pct + '%</text></svg>';
}

function mrdInsightTiles(m) {
  var html = '';

  // 1 — item fill rate
  if (m.hasProgress && m.lines > 0) {
    var fill = Math.round(m.linesDone / m.lines * 100);
    html += '<div class="mrd-card"><div class="mrd-tile">' + mrdRing(fill) +
      '<div><div class="mrd-tile-label">Item fill rate</div>' +
      '<div class="mrd-tile-sub">' + m.linesDone + ' of ' + m.lines + ' item lines fully served</div></div></div></div>';
  } else {
    html += '<div class="mrd-card"><div class="mrd-tile"><div><div class="mrd-tile-label">Item fill rate</div>' +
      '<div class="mrd-tile-value">' + (m.total ? '…' : '—') + '</div>' +
      '<div class="mrd-tile-sub">' + (m.total ? 'Calculating from your items' : 'Appears after your first request') + '</div></div></div></div>';
  }

  // 2 — median processing time
  var med = mrdMedian(m.procDays);
  if (med == null) {
    html += '<div class="mrd-card"><div class="mrd-tile"><div><div class="mrd-tile-label">Median processing time</div>' +
      '<div class="mrd-tile-value">—</div><div class="mrd-tile-sub">No processed requests yet</div></div></div></div>';
  } else {
    var f = mrdFmtDuration(med);
    html += '<div class="mrd-card" title="Time from submitting a request until the warehouse processed it"><div class="mrd-tile"><div>' +
      '<div class="mrd-tile-label">Median processing time</div>' +
      '<div class="mrd-tile-value">' + f.n + '<small>' + f.unit + '</small></div>' +
      '<div class="mrd-tile-sub">Submit → warehouse processed · ' + m.procDays.length + ' request' + (m.procDays.length === 1 ? '' : 's') + '</div></div></div></div>';
  }

  // 3 — late
  var lateCls = m.overdue > 0 ? 'is-bad' : (m.open.length ? '' : 'is-good');
  html += '<div class="mrd-card"><div class="mrd-tile ' + lateCls + '"><div>' +
    '<div class="mrd-tile-label">Open over ' + MRD_OVERDUE_DAYS + ' days</div>' +
    '<div class="mrd-tile-value">' + m.overdue + '</div>' +
    '<div class="mrd-tile-sub">of ' + m.open.length + ' open request' + (m.open.length === 1 ? '' : 's') + '</div></div></div></div>';

  // 4 — this month
  var delta = m.thisMonth - m.lastMonth, dTxt;
  if (m.lastMonth === 0 && m.thisMonth === 0) dTxt = '<span class="mrd-delta-flat">No requests yet</span>';
  else if (delta > 0) dTxt = '<span class="mrd-delta-up">▲ ' + delta + '</span> vs last month (' + m.lastMonth + ')';
  else if (delta < 0) dTxt = '<span class="mrd-delta-down">▼ ' + Math.abs(delta) + '</span> vs last month (' + m.lastMonth + ')';
  else dTxt = '<span class="mrd-delta-flat">Same</span> as last month (' + m.lastMonth + ')';
  html += '<div class="mrd-card"><div class="mrd-tile"><div><div class="mrd-tile-label">Requests this month</div>' +
    '<div class="mrd-tile-value">' + m.thisMonth + '</div><div class="mrd-tile-sub">' + dTxt + '</div></div></div></div>';

  return html;
}

function mrdTrendChart(m) {
  var W = 640, H = 230, padL = 30, padR = 10, padT = 18, padB = 34;
  var max = 0;
  m.weeks.forEach(function (b) { max = Math.max(max, b.mrif + b.mrs); });
  if (max === 0) {
    return '<div class="mrd-empty"><i class="bi bi-bar-chart"></i>No requests in the last ' + MRD_WEEKS + ' weeks</div>';
  }
  var top = Math.max(4, Math.ceil(max / 4) * 4);
  var innerW = W - padL - padR, innerH = H - padT - padB;
  var slot = innerW / m.weeks.length, bw = Math.min(34, slot * 0.58);
  var svg = '<svg class="mrd-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Requests per week">';

  for (var g = 0; g <= 4; g++) {
    var y = padT + innerH - (innerH * g / 4);
    svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"' + (g ? ' stroke-dasharray="3 4"' : '') + '/>' +
      '<text x="' + (padL - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + Math.round(top * g / 4) + '</text>';
  }

  m.weeks.forEach(function (b, i) {
    var x = padL + slot * i + (slot - bw) / 2;
    var hMrif = innerH * b.mrif / top, hMrs = innerH * b.mrs / top;
    var yBase = padT + innerH;
    var label = b.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    var tip = label + ' week: ' + b.mrif + ' MRIF, ' + b.mrs + ' MRS';
    svg += '<g><title>' + tip + '</title>';
    if (b.mrif) svg += '<rect x="' + x + '" y="' + (yBase - hMrif) + '" width="' + bw + '" height="' + hMrif + '" rx="4" fill="#4f46e5"/>';
    if (b.mrs)  svg += '<rect x="' + x + '" y="' + (yBase - hMrif - hMrs) + '" width="' + bw + '" height="' + hMrs + '" rx="4" fill="#a78bfa"/>';
    if (b.mrif + b.mrs) svg += '<text x="' + (x + bw / 2) + '" y="' + (yBase - hMrif - hMrs - 5) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="#334155">' + (b.mrif + b.mrs) + '</text>';
    svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="10" fill="' + (i === m.weeks.length - 1 ? '#1e3a5f' : '#94a3b8') + '"' + (i === m.weeks.length - 1 ? ' font-weight="700"' : '') + '>' + label + '</text></g>';
  });
  return svg + '</svg>';
}

function mrdDonut(m) {
  var parts = [
    { k: 'Pending', n: m.pending, c: '#f59e0b' },
    { k: 'Partial', n: m.partial, c: '#3b82f6' },
    { k: 'Completed', n: m.completed, c: '#10b981' }
  ];
  var sum = parts.reduce(function (a, p) { return a + p.n; }, 0);
  var r = 52, C = 2 * Math.PI * r, acc = 0;
  var svg = '<svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Requests by status">' +
    '<circle cx="75" cy="75" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="20"/>';
  if (sum > 0) {
    parts.forEach(function (p) {
      if (!p.n) return;
      var len = C * p.n / sum;
      svg += '<circle cx="75" cy="75" r="' + r + '" fill="none" stroke="' + p.c + '" stroke-width="20" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 75 75)"><title>' + p.k + ': ' + p.n + '</title></circle>';
      acc += len;
    });
  }
  svg += '<text x="75" y="73" text-anchor="middle" font-size="26" font-weight="800" fill="#0f172a">' + m.total + '</text>' +
    '<text x="75" y="91" text-anchor="middle" font-size="10" fill="#64748b">TOTAL</text></svg>';

  var legend = '<div class="mrd-donut-legend">';
  parts.forEach(function (p) {
    var pct = sum ? Math.round(p.n / sum * 100) : 0;
    legend += '<div><span class="mrd-sw" style="background:' + p.c + '"></span>' + p.k + '<b>' + p.n + '</b><span class="pct">' + pct + '%</span></div>';
  });
  legend += '</div>';
  return '<div class="mrd-donut-wrap">' + svg + legend + '</div>';
}

function mrdAttention(m) {
  if (!m.open.length) {
    return '<div class="mrd-empty"><i class="bi bi-check2-circle"></i>' +
      (m.total ? 'All caught up — no open requests.' : 'Nothing to track yet. Create a request to get started.') + '</div>';
  }
  var html = '<div class="mrd-attn">';
  m.open.slice(0, 5).forEach(function (o) {
    var d = o.doc, type = String(d.doc_type || '').toUpperCase();
    var ageCls = o.age > MRD_OVERDUE_DAYS ? 'late' : (o.age >= 2 ? 'warn' : '');
    var meta = [d.jo_no ? 'JO ' + d.jo_no : '', d.project || d.client_name || ''].filter(Boolean).join(' · ') || (d.item_count || 0) + ' items';
    var safeDoc = String(d.doc_no || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    html += '<div class="mrd-attn-row">' +
      '<div class="mrd-attn-doc">' + mrdE(d.doc_no) + '</div>' +
      '<div><span class="mrd-type ' + type.toLowerCase() + '">' + mrdE(type) + '</span></div>' +
      '<div class="mrd-attn-meta" title="' + mrdE(meta) + '">' + mrdE(meta) + '</div>' +
      '<div class="mrd-bar-wrap">' + mrdBarHtml(mrdProgressPct(d), true) + '</div>' +
      '<div style="text-align:right"><span class="mrd-age ' + ageCls + '">' + mrdAgeLabel(o.age) + '</span></div>' +
      '<div><button class="mrd-view" title="View details" onclick="viewRequestDetails(\'' + safeDoc + '\', \'' + type + '\')">' +
        '<i class="bi bi-eye"></i></button></div>' +
      '</div>';
  });
  if (m.open.length > 5) html += '<div class="mrd-attn-meta" style="padding:6px 12px">+ ' + (m.open.length - 5) + ' more open request' + (m.open.length - 5 === 1 ? '' : 's') + ' in the table below</div>';
  return html + '</div>';
}

function mrdHero(m) {
  var el = document.getElementById('mrdHeroSummary');
  var g = document.getElementById('mrdGreeting');
  var dt = document.getElementById('mrdHeroDate');
  var hr = new Date().getHours();
  if (g) g.textContent = hr < 12 ? 'Good morning' : (hr < 18 ? 'Good afternoon' : 'Good evening');
  if (dt) dt.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (!el) return;
  var txt, cls = '';
  if (!m.total) { txt = 'No requests yet — create your first MRIF or MRS'; }
  else if (!m.open.length) { txt = 'All ' + m.total + ' requests are completed'; }
  else if (m.overdue) { txt = m.open.length + ' open · ' + m.overdue + ' waiting more than ' + MRD_OVERDUE_DAYS + ' days'; cls = 'is-late'; }
  else { txt = m.open.length + ' open request' + (m.open.length === 1 ? '' : 's') + ' · none overdue'; cls = 'is-open'; }
  el.className = 'mrd-hero-summary ' + cls;
  el.innerHTML = '<span class="mrd-dot"></span>' + mrdE(txt);
}

function mrdRender() {
  var host = document.getElementById('mrdDashboard');
  if (!host) return;
  var m = mrdMetrics();
  mrdHero(m);

  host.innerHTML =
    '<div class="mrd-section-title">Insights <small>based on your requests</small></div>' +
    '<div class="mrd-insights">' + mrdInsightTiles(m) + '</div>' +
    '<div class="mrd-grid-2">' +
      '<div class="mrd-card"><div class="mrd-card-head"><div><div class="mrd-card-title">Requests per week</div>' +
        '<div class="mrd-card-sub">Last ' + MRD_WEEKS + ' weeks</div></div>' +
        '<div class="mrd-legend"><span><i style="background:#4f46e5"></i>MRIF</span><span><i style="background:#a78bfa"></i>MRS</span></div></div>' +
        mrdTrendChart(m) + '</div>' +
      '<div class="mrd-card"><div class="mrd-card-head"><div><div class="mrd-card-title">Status breakdown</div>' +
        '<div class="mrd-card-sub">All your requests</div></div></div>' + mrdDonut(m) + '</div>' +
    '</div>' +
    '<div class="mrd-section-title">Needs attention <small>oldest open requests first</small></div>' +
    '<div class="mrd-card">' + mrdAttention(m) + '</div>';
}

// ── hooks used by my-requests.js ─────────────────────────────
async function mrdOnLoaded() {
  mrdRender();                         // instant, without item progress
  var changed = await mrdLoadProgress();
  if (changed) { mrdRender(); }
  mrdFillCells();
}

function mrdFilterStatus(status) {
  var sel = document.getElementById('myStatusFilter');
  var type = document.getElementById('myTypeFilter');
  if (sel) sel.value = status || '';
  if (type) type.value = '';
  _myRequests.currentPage = 1;
  if (typeof myRequestsRender === 'function') myRequestsRender().then(mrdFillCells);
  var card = document.querySelector('.erp-table-card');
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Stepper for the details modal
function mrdStepperHtml(doc) {
  var s = mrdStatus(doc);
  var fmt = function (iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
  var processed = s === 'PARTIAL' || s === 'COMPLETED' || !!doc.processed_at;
  var steps = [
    { label: 'Submitted', date: fmt(doc.created_at), state: 'done', icon: 'bi-send-check' },
    { label: s === 'PARTIAL' ? 'Partially served' : 'Warehouse processing', date: processed ? fmt(doc.processed_at) : '',
      state: s === 'COMPLETED' ? 'done' : (processed ? 'now' : 'now'), icon: 'bi-box-seam' },
    { label: 'Completed', date: s === 'COMPLETED' ? fmt(doc.processed_at || doc.updated_at) : '',
      state: s === 'COMPLETED' ? 'done' : 'todo', icon: 'bi-check2-all' }
  ];
  if (s === 'PENDING') steps[1].state = 'now';
  var html = '<div class="mrd-steps">';
  steps.forEach(function (st) {
    html += '<div class="mrd-step ' + (st.state === 'todo' ? '' : st.state) + '">' +
      '<div class="mrd-step-dot"><i class="bi ' + (st.state === 'done' ? 'bi-check-lg' : st.icon) + '"></i></div>' +
      mrdE(st.label) + (st.date ? '<small>' + mrdE(st.date) + '</small>' : '') + '</div>';
  });
  return html + '</div>';
}

function mrdItemPct(it) {
  var req = Number(it.requested_qty) || 0, iss = Number(it.issued_qty) || 0;
  return req > 0 ? Math.min(100, Math.round(iss / req * 100)) : (iss > 0 ? 100 : 0);
}

window.mrdRender = mrdRender;
window.mrdOnLoaded = mrdOnLoaded;
window.mrdFilterStatus = mrdFilterStatus;
window.mrdProgressCell = mrdProgressCell;
window.mrdAgeSub = mrdAgeSub;
window.mrdFillCells = mrdFillCells;
window.mrdStepperHtml = mrdStepperHtml;
window.mrdItemPct = mrdItemPct;
window.mrdBarHtml = mrdBarHtml;
