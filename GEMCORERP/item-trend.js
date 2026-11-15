// ============================================================
// GEMCOR ERP — Monthly Trend (MRIF / MRR kada buwan)
//  • erpTrendRenderItem(hostId, item)  → trend ng isang material (Stock Monitor, item details)
//  • erpTrendRenderTotals(hostId)      → buwanang issued vs received (Management Dashboard)
// READ-ONLY: nagbabasa lang sa views erp_v_item_monthly / erp_v_monthly_totals / erp_inventory_snapshots.
// Walang sinusulat at walang binabago sa kasalukuyang data (presyo, on-hand, Ave/Mo).
// Kailangan ang erp-history-setup.sql (at erp-history-import.sql) sa Supabase. Kung wala pa, may mahinahong paalala lang.
// Self-contained (inline SVG, walang dagdag na library).
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
      '.tr-box{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:14px 16px}' +
      '.tr-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}' +
      '.tr-h h6{margin:0;font-weight:700;color:#1e3a5f}' +
      '.tr-leg{font-size:.75rem;color:#475569;display:flex;gap:12px;align-items:center}' +
      '.tr-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}' +
      '.tr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}' +
      '.tr-stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px}' +
      '.tr-stat .l{font-size:.66rem;font-weight:700;text-transform:uppercase;color:#64748b}' +
      '.tr-stat .v{font-size:1.05rem;font-weight:800;color:#1e3a5f}' +
      '.tr-stat .s{font-size:.68rem;color:#64748b}' +
      '.tr-note{font-size:.74rem;color:#64748b;margin-top:6px}' +
      '.tr-warn{font-size:.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 10px}' +
      '.tr-svg{width:100%;height:auto;display:block}' +
      '.tr-tbl{width:100%;font-size:.78rem;border-collapse:collapse;margin-top:6px}' +
      '.tr-tbl th,.tr-tbl td{padding:3px 8px;border-bottom:1px solid #f1f5f9;text-align:right}' +
      '.tr-tbl th:first-child,.tr-tbl td:first-child{text-align:left}' +
      '.tr-tbl th{color:#64748b;font-size:.68rem;text-transform:uppercase}' +
      '.tr-wrap{overflow-x:auto}';
    document.head.appendChild(st);
  }

  // Grouped bars (inline SVG). rows: [{label, a, b, partial}]
  function svgBars(rows, fmt, tipFmt) {
    var W = 720, H = 210, L = 46, R = 10, T = 10, B = 28, iw = W - L - R, ih = H - T - B;
    var max = 0; rows.forEach(function (r) { max = Math.max(max, r.a, r.b); });
    if (!(max > 0)) max = 1;
    var step = Math.pow(10, Math.floor(Math.log(max) / Math.LN10)), nice = [1, 2, 2.5, 5, 10].map(function (k) { return k * step; }).filter(function (v) { return v >= max; })[0] || max;
    max = nice;
    var g = '', i;
    for (i = 0; i <= 4; i++) {
      var y = T + ih - (ih * i / 4), v = max * i / 4;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#e2e8f0" stroke-width="1"/>' +
           '<text x="' + (L - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="#64748b">' + esc(fmt(v)) + '</text>';
    }
    var gw = iw / rows.length, bw = Math.min(22, gw * 0.36);
    rows.forEach(function (r, k) {
      var cx = L + gw * k + gw / 2, ha = ih * r.a / max, hb = ih * r.b / max;
      g += '<g' + (r.partial ? ' opacity="0.7"' : '') + '>' +
        '<rect x="' + (cx - bw - 1) + '" y="' + (T + ih - ha) + '" width="' + bw + '" height="' + Math.max(ha, r.a > 0 ? 1 : 0) + '" rx="2" fill="' + C_OUT + '"><title>' + esc(r.label + ' — Issued: ' + tipFmt(r.a)) + '</title></rect>' +
        '<rect x="' + (cx + 1) + '" y="' + (T + ih - hb) + '" width="' + bw + '" height="' + Math.max(hb, r.b > 0 ? 1 : 0) + '" rx="2" fill="' + C_IN + '"><title>' + esc(r.label + ' — Received: ' + tipFmt(r.b)) + '</title></rect></g>' +
        '<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#475569">' + esc(r.label) + (r.partial ? '*' : '') + '</text>';
    });
    return '<svg class="tr-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly issued and received">' + g + '</svg>';
  }
  var LEG = '<span class="tr-leg"><span><i style="background:' + C_OUT + '"></i>Issued (MRIF)</span><span><i style="background:' + C_IN + '"></i>Received (MRR)</span></span>';

  function getJson(path) {
    return fetch(erpUrl(path), { headers: erpHeaders() }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function setupNote(err) {
    return '<div class="tr-warn"><i class="bi bi-info-circle me-1"></i>Hindi pa available ang monthly history (' + esc(err && err.message || err) + '). ' +
      'I-run ang <b>erp-history-setup.sql</b> at <b>erp-history-import.sql</b> sa Supabase. Walang epekto ito sa ibang bahagi ng system.</div>';
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
        var full = data.filter(function (d) { return !d.partial; });                // kumpletong buwan lang sa average
        var sumA = full.reduce(function (s, d) { return s + d.a; }, 0), sumB = full.reduce(function (s, d) { return s + d.b; }, 0);
        var active = full.filter(function (d) { return d.a > 0; }).length;
        var avgAll = full.length ? sumA / full.length : 0, avgAct = active ? sumA / active : 0;
        var last = data[data.length - 1];
        var unit = item.base_unit ? ' ' + esc(item.base_unit) : '';
        var html = '<div class="tr-box"><div class="tr-h"><h6><i class="bi bi-graph-up me-1"></i>Monthly Trend — MRIF &amp; MRR</h6>' + LEG + '</div>';
        if (!rows.length) {
          html += '<div class="text-muted small">Walang MRIF o MRR na naitala para sa item na ito mula Jan 2026.</div></div>';
          host.innerHTML = html; return;
        }
        html += svgBars(data, function (v) { return num(v, v < 10 ? 1 : 0); }, function (v) { return num(v) + (item.base_unit ? ' ' + item.base_unit : ''); });
        html += '<div class="tr-stats">' +
          '<div class="tr-stat"><div class="l">Total issued</div><div class="v">' + num(sumA) + unit + '</div><div class="s">' + full.length + ' buong buwan</div></div>' +
          '<div class="tr-stat"><div class="l">Total received</div><div class="v">' + num(sumB) + unit + '</div><div class="s">MRR</div></div>' +
          '<div class="tr-stat"><div class="l">Avg issued / month</div><div class="v">' + num(avgAll) + '</div><div class="s">lahat ng buwan, pati zero</div></div>' +
          '<div class="tr-stat"><div class="l">Avg / active month</div><div class="v">' + num(avgAct) + '</div><div class="s">' + active + ' buwan na may issue</div></div>' +
          '<div class="tr-stat"><div class="l">Ave/Mo sa system</div><div class="v">' + num(item.ave_monthly_consumption || 0) + '</div><div class="s">hindi binago (para sa paghahambing)</div></div></div>';
        html += '<details><summary class="small fw-semibold" style="cursor:pointer">Buwan-buwan na numero</summary><div class="tr-wrap"><table class="tr-tbl"><thead><tr><th>Month</th><th>Issued</th><th>Received</th><th>Source</th></tr></thead><tbody>' +
          data.slice().reverse().map(function (d) {
            return '<tr><td>' + esc(d.key) + (d.partial ? ' <span class="text-muted">(ongoing)</span>' : '') + '</td><td>' + num(d.a) + '</td><td>' + num(d.b) + '</td><td>' + (d.live ? 'system' : 'history') + '</td></tr>';
          }).join('') + '</tbody></table></div></details>';
        html += '<div class="tr-note">Jan–Oct 2026: galing sa dating Google Sheet. Mula Nov 2026: live mula sa system, nag-a-update sa bawat bagong MRIF/MRR. * = kasalukuyang buwan (hindi pa tapos, hindi kasama sa average).</div></div>';
        host.innerHTML = html;
      })
      .catch(function (err) { console.warn('[Trend] item', err); host.innerHTML = '<div class="tr-box">' + setupNote(err) + '</div>'; });
  };

  // ── Company-wide monthly totals (Management Dashboard) ──
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
      svgBars(data, fmt, tip) +
      '<div class="tr-stats">' +
      '<div class="tr-stat"><div class="l">Avg issued / month</div><div class="v">' + (val ? peso(avgA) : num(avgA, 0)) + '</div><div class="s">' + full.length + ' buong buwan</div></div>' +
      '<div class="tr-stat"><div class="l">Total issued</div><div class="v">' + (val ? peso(sa) : num(sa, 0)) + '</div><div class="s">buong buwan lang</div></div>' +
      '<div class="tr-stat"><div class="l">Total received</div><div class="v">' + (val ? peso(sb) : num(sb, 0)) + '</div><div class="s">' + (sb >= sa ? 'mas marami ang pumasok' : 'mas marami ang lumabas') + '</div></div>';
    if (_tot.snaps.length) {
      var s = _tot.snaps[_tot.snaps.length - 1];
      h += '<div class="tr-stat"><div class="l">Month-end inventory</div><div class="v">' + peso(s.total_value) + '</div><div class="s">' + esc(keyOf(s.snapshot_month)) + ' · ' + _tot.snaps.length + ' snapshot(s)</div></div>';
    }
    h += '</div>';
    if (val && noCost > 0) h += '<div class="tr-note">Ang halaga ay quantity × kasalukuyang unit cost. May ' + noCost + ' item-buwan na walang unit cost kaya hindi nabilang sa halaga (nasa Quantity view sila).</div>';
    h += '<div class="tr-note">Jan–Oct 2026: galing sa dating Google Sheet. Mula Nov 2026: live mula sa system. * = kasalukuyang buwan (hindi pa tapos, hindi kasama sa average).</div></div>';
    host.innerHTML = h;
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
