// ============================================================
// GEMCOR ERP — Monthly Trend (MRIF / MRR by month)
//  • erpTrendRenderItem(hostId, item)  → single-material trend (Stock Monitor item details)
//  • erpTrendRenderTotals(hostId)      → monthly issued vs received (Management Dashboard)
//  • erpTrendSvgBars(rows, opts)       → shared chart renderer (also used by Monthly Movement page)
// READ-ONLY: reads views erp_v_item_monthly / erp_v_monthly_totals / erp_inventory_snapshots.
// Never writes, and never changes existing data (prices, on-hand, Ave/Mo).
// Requires erp-history-setup.sql (and erp-history-import.sql) in Supabase.
// Self-contained (inline SVG, no extra library).
// ============================================================
(function () {
  'use strict';
  var START = { y: 2026, m: 1 };                 // simula ng history
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var C_OUT = '#ef4444', C_IN = '#10b981';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function num(n, d) { n = Number(n || 0); return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d == null ? 2 : d }); }
  function peso(n) { n = Number(n || 0); return '₱' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e4 ? Math.round(n / 1e3).toLocaleString() + 'K' : Math.round(n).toLocaleString()); }
  function pesoFull(n) { return '₱' + Math.round(Number(n || 0)).toLocaleString(); }

  function monthKeys() {
    var now = new Date(), out = [], y = START.y, m = START.m;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      out.push({ key: y + '-' + (m < 10 ? '0' : '') + m, y: y, m: m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  function keyOf(s) { return String(s || '').slice(0, 7); }
  function isCurrent(k) { var d = new Date(); return k === d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1); }

  function injectCss() {
    if (document.getElementById('erpTrendCss')) return;
    var st = document.createElement('style'); st.id = 'erpTrendCss';
    st.textContent =
      '.tr-box{border:1px solid #e5e7eb;border-radius:10px;background:#fff;padding:12px 14px}' +
      '.tr-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}' +
      '.tr-h h6{margin:0;font-weight:700;font-size:.9rem;color:#1e3a5f}' +
      '.tr-leg{font-size:.75rem;color:#475569;display:flex;gap:12px;align-items:center}' +
      '.tr-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}' +
      '.tr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin:8px 0 4px}' +
      '.tr-stat{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:5px 10px}' +
      '.tr-stat .l{font-size:.62rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#6b7280}' +
      '.tr-stat .v{font-size:.95rem;font-weight:700;color:#1e3a5f}' +
      '.tr-stat .s{font-size:.68rem;color:#64748b}' +
      '.tr-note{font-size:.7rem;color:#6b7280;margin-top:4px}' +
      '.tr-warn{font-size:.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px}' +
      '.tr-svg{display:block;max-width:100%}' +
      '.tr-tbl{width:100%;font-size:.75rem;border-collapse:collapse;margin-top:6px}' +
      '.tr-tbl th,.tr-tbl td{padding:3px 8px;border-bottom:1px solid #f1f5f9;text-align:right}' +
      '.tr-tbl th:first-child,.tr-tbl td:first-child{text-align:left}' +
      '.tr-tbl th{color:#64748b;font-size:.68rem;text-transform:uppercase}' +
      '.tr-wrap{overflow-x:auto}';
    document.head.appendChild(st);
  }

  // Grouped bars (inline SVG) drawn at the real container width so text stays crisp and the chart stays compact.
  // rows: [{label, a, b, partial}]   opts: {w, h, fmt, tip, labelA, labelB}
  function svgBars(rows, opts) {
    var W = Math.max(320, Math.round(opts.w || 640)), H = opts.h || 190, L = 48, R = 8, T = 8, B = 24, iw = W - L - R, ih = H - T - B;
    var fmt = opts.fmt, tip = opts.tip || fmt, la = opts.labelA || 'Issued', lb = opts.labelB || 'Received';
    var max = 0; rows.forEach(function (r) { max = Math.max(max, r.a, r.b); });
    if (!(max > 0)) max = 1;
    var step = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    max = [1, 2, 2.5, 5, 10].map(function (k) { return k * step; }).filter(function (v) { return v >= max; })[0] || max;
    var g = '', i;
    for (i = 0; i <= 4; i++) {
      var y = T + ih - (ih * i / 4), v = max * i / 4;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#e5e7eb" stroke-width="1"/>' +
           '<text x="' + (L - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="#6b7280">' + esc(fmt(v)) + '</text>';
    }
    var gw = iw / rows.length, bw = Math.max(4, Math.min(16, gw * 0.32));
    rows.forEach(function (r, k) {
      var cx = L + gw * k + gw / 2, ha = ih * r.a / max, hb = ih * r.b / max;
      g += '<g' + (r.partial ? ' opacity="0.65"' : '') + '>' +
        '<rect x="' + (cx - bw - 1) + '" y="' + (T + ih - ha) + '" width="' + bw + '" height="' + Math.max(ha, r.a > 0 ? 1 : 0) + '" rx="1.5" fill="' + C_OUT + '"><title>' + esc(r.label + ' · ' + la + ': ' + tip(r.a)) + '</title></rect>' +
        '<rect x="' + (cx + 1) + '" y="' + (T + ih - hb) + '" width="' + bw + '" height="' + Math.max(hb, r.b > 0 ? 1 : 0) + '" rx="1.5" fill="' + C_IN + '"><title>' + esc(r.label + ' · ' + lb + ': ' + tip(r.b)) + '</title></rect></g>' +
        '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#4b5563">' + esc(r.label) + (r.partial ? '*' : '') + '</text>';
    });
    return '<svg class="tr-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly issued and received">' + g + '</svg>';
  }
  window.erpTrendSvgBars = svgBars;
  function hostWidth(host, fallback) { var w = host && host.clientWidth; return w > 120 ? w - 32 : (fallback || 640); }
  var LEG = '<span class="tr-leg"><span><i style="background:' + C_OUT + '"></i>Issued (MRIF)</span><span><i style="background:' + C_IN + '"></i>Received (MRR)</span></span>';

  function getJson(path) {
    return fetch(erpUrl(path), { headers: erpHeaders() }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function setupNote(err) {
    return '<div class="tr-warn"><i class="bi bi-info-circle me-1"></i>Monthly history is not available yet (' + esc(err && err.message || err) + '). ' +
      'Run <b>erp-history-setup.sql</b> and <b>erp-history-import.sql</b> in Supabase. No other part of the system is affected.</div>';
  }

  // ── Per-item trend ─────────────────────────────────────
  window.erpTrendRenderItem = function (hostId, item) {
    var host = document.getElementById(hostId); if (!host) return;
    injectCss();
    host.innerHTML = '<div class="tr-box"><div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Loading monthly trend…</div></div>';
    var code = item.item_code;
    getJson('erp_v_item_monthly?select=month_start,mrif_qty,mrr_qty,source&item_code=eq.' + encodeURIComponent(code) + '&order=month_start.asc')
      .then(function (rows) {
        var map = {}; rows.forEach(function (r) { map[keyOf(r.month_start)] = r; });
        var months = monthKeys(), data = months.map(function (mo) {
          var r = map[mo.key] || {};
          return { label: MN[mo.m - 1] + (mo.m === 1 || mo === months[0] ? " '" + String(mo.y).slice(2) : ''), key: mo.key, a: Number(r.mrif_qty || 0), b: Number(r.mrr_qty || 0), partial: isCurrent(mo.key), live: r.source === 'live' };
        });
        var full = data.filter(function (d) { return !d.partial; });
        var sumA = full.reduce(function (s, d) { return s + d.a; }, 0), sumB = full.reduce(function (s, d) { return s + d.b; }, 0);
        var active = full.filter(function (d) { return d.a > 0; }).length;
        var avgAll = full.length ? sumA / full.length : 0, avgAct = active ? sumA / active : 0;
        var unit = item.base_unit ? ' ' + esc(item.base_unit) : '';
        var head = '<div class="tr-h"><h6><i class="bi bi-graph-up me-1"></i>Monthly Movement — MRIF &amp; MRR</h6>' + LEG + '</div>';
        if (!rows.length) { host.innerHTML = '<div class="tr-box">' + head + '<div class="text-muted small">No MRIF or MRR recorded for this item since January 2026.</div></div>'; return; }
        function draw() {
          host.innerHTML = '<div class="tr-box">' + head +
            svgBars(data, { w: hostWidth(host, 640), h: 170, fmt: function (v) { return num(v, v < 10 ? 1 : 0); }, tip: function (v) { return num(v) + (item.base_unit ? ' ' + item.base_unit : ''); } }) +
            '<div class="tr-stats">' +
            '<div class="tr-stat"><div class="l">Total issued</div><div class="v">' + num(sumA) + unit + '</div><div class="s">' + full.length + ' complete months</div></div>' +
            '<div class="tr-stat"><div class="l">Total received</div><div class="v">' + num(sumB) + unit + '</div><div class="s">MRR</div></div>' +
            '<div class="tr-stat"><div class="l">Average issued / month</div><div class="v">' + num(avgAll) + '</div><div class="s">all complete months</div></div>' +
            '<div class="tr-stat"><div class="l">Average / active month</div><div class="v">' + num(avgAct) + '</div><div class="s">' + active + ' months with issuance</div></div>' +
            '<div class="tr-stat"><div class="l">System Ave/Mo</div><div class="v">' + num(item.ave_monthly_consumption || 0) + '</div><div class="s">unchanged, for comparison</div></div></div>' +
            '<details><summary class="small fw-semibold" style="cursor:pointer">Monthly figures</summary><div class="tr-wrap"><table class="tr-tbl"><thead><tr><th>Month</th><th>Issued</th><th>Received</th><th>Source</th></tr></thead><tbody>' +
            data.slice().reverse().map(function (d) {
              return '<tr><td>' + esc(d.key) + (d.partial ? ' <span class="text-muted">(in progress)</span>' : '') + '</td><td>' + num(d.a) + '</td><td>' + num(d.b) + '</td><td>' + (d.live ? 'System' : 'Legacy sheet') + '</td></tr>';
            }).join('') + '</tbody></table></div></details>' +
            '<div class="tr-note">Jan–Oct 2026: imported from the legacy Google Sheet. From Nov 2026: live from the system. * Current month (in progress), excluded from averages.</div></div>';
        }
        draw(); _reflow[hostId] = draw;
      })
      .catch(function (err) { console.warn('[Trend] item', err); host.innerHTML = '<div class="tr-box">' + setupNote(err) + '</div>'; });
  };

  // ── Company-wide monthly totals (Management Dashboard) ──
  var _reflow = {};
  var _rt = null;
  window.addEventListener('resize', function () { clearTimeout(_rt); _rt = setTimeout(function () { Object.keys(_reflow).forEach(function (k) { if (document.getElementById(k)) { try { _reflow[k](); } catch (e) {} } }); }, 200); });
  var _tot = { rows: null, snaps: [], cat: '', mode: 'value', hostId: null };

  function renderTotals() {
    var host = document.getElementById(_tot.hostId); if (!host) return;
    var rows = _tot.rows || [], cats = {};
    rows.forEach(function (r) { cats[r.category] = 1; });
    var sel = rows.filter(function (r) { return !_tot.cat || r.category === _tot.cat; });
    var by = {}; sel.forEach(function (r) {
      var k = keyOf(r.month_start), o = by[k] || (by[k] = { av: 0, bv: 0, aq: 0, bq: 0, nc: 0 });
      o.av += Number(r.mrif_value || 0); o.bv += Number(r.mrr_value || 0); o.aq += Number(r.mrif_qty || 0); o.bq += Number(r.mrr_qty || 0); o.nc += Number(r.no_cost_rows || 0);
    });
    var val = _tot.mode === 'value', months = monthKeys();
    var data = months.map(function (mo) {
      var o = by[mo.key] || { av: 0, bv: 0, aq: 0, bq: 0, nc: 0 };
      return { label: MN[mo.m - 1] + (mo.m === 1 || mo === months[0] ? " '" + String(mo.y).slice(2) : ''), key: mo.key, a: val ? o.av : o.aq, b: val ? o.bv : o.bq, partial: isCurrent(mo.key), nc: o.nc };
    });
    var full = data.filter(function (d) { return !d.partial; });
    var sa = full.reduce(function (s, d) { return s + d.a; }, 0), sb = full.reduce(function (s, d) { return s + d.b; }, 0);
    var avgA = full.length ? sa / full.length : 0;
    var fmt = val ? peso : function (v) { return num(v, 0); }, tip = val ? pesoFull : function (v) { return num(v); };
    var noCost = data.reduce(function (s, d) { return s + d.nc; }, 0);

    var h = '<div class="tr-box"><div class="tr-h"><h6><i class="bi bi-bar-chart-line me-1"></i>Monthly Issued vs Received (MRIF / MRR)</h6>' +
      '<div class="d-flex gap-2 align-items-center flex-wrap">' +
      '<select class="form-select form-select-sm" style="width:auto" id="trCat"><option value="">All categories</option>' +
      Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '"' + (c === _tot.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select class="form-select form-select-sm" style="width:auto" id="trMode"><option value="value"' + (val ? ' selected' : '') + '>Value (₱)</option><option value="qty"' + (!val ? ' selected' : '') + '>Quantity</option></select>' +
      LEG + '</div></div>' +
      svgBars(data, { w: hostWidth(host, 900), h: 190, fmt: fmt, tip: tip }) +
      '<div class="tr-stats">' +
      '<div class="tr-stat"><div class="l">Average issued / month</div><div class="v">' + (val ? peso(avgA) : num(avgA, 0)) + '</div><div class="s">' + full.length + ' complete months</div></div>' +
      '<div class="tr-stat"><div class="l">Total issued</div><div class="v">' + (val ? peso(sa) : num(sa, 0)) + '</div><div class="s">complete months only</div></div>' +
      '<div class="tr-stat"><div class="l">Total received</div><div class="v">' + (val ? peso(sb) : num(sb, 0)) + '</div><div class="s">' + (sb >= sa ? 'Receipts exceeded issues' : 'Issues exceeded receipts') + '</div></div>';
    if (_tot.snaps.length) {
      var s = _tot.snaps[_tot.snaps.length - 1];
      h += '<div class="tr-stat"><div class="l">Month-end inventory</div><div class="v">' + peso(s.total_value) + '</div><div class="s">' + esc(keyOf(s.snapshot_month)) + ' · ' + _tot.snaps.length + ' snapshot(s)</div></div>';
    }
    h += '</div>';
    if (val && noCost > 0) h += '<div class="tr-note">Value = quantity × current unit cost. ' + noCost + ' item-months have no unit cost and are excluded from value (they appear in the Quantity view).</div>';
    h += '<div class="tr-note">Jan–Oct 2026: imported from the legacy Google Sheet. From Nov 2026: live from the system. * Current month (in progress), excluded from averages. <a href="monthly-movement.html">Open item-level Monthly Movement</a></div></div>';
    host.innerHTML = h; _reflow[_tot.hostId] = renderTotals;
    var c = document.getElementById('trCat'), m = document.getElementById('trMode');
    if (c) c.onchange = function () { _tot.cat = c.value; renderTotals(); };
    if (m) m.onchange = function () { _tot.mode = m.value; renderTotals(); };
  }

  window.erpTrendRenderTotals = function (hostId) {
    var host = document.getElementById(hostId); if (!host) return;
    injectCss(); _tot.hostId = hostId;
    host.innerHTML = '<div class="tr-box"><div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Loading monthly trend…</div></div>';
    Promise.all([
      getJson('erp_v_monthly_totals?select=month_start,category,mrif_qty,mrr_qty,mrif_value,mrr_value,no_cost_rows&order=month_start.asc&limit=5000'),
      getJson('erp_inventory_snapshots?select=snapshot_month,total_value&order=snapshot_month.asc').catch(function () { return []; })
    ]).then(function (res) { _tot.rows = res[0]; _tot.snaps = res[1] || []; renderTotals(); })
      .catch(function (err) { console.warn('[Trend] totals', err); host.innerHTML = '<div class="tr-box">' + setupNote(err) + '</div>'; });
  };

  function boot() { if (document.getElementById('erpTrendRoot')) window.erpTrendRenderTotals('erpTrendRoot'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
