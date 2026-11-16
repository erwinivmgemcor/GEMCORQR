// ============================================================
// GEMCOR ERP — Monthly Movement by Item  (read-only report)
// Matrix of issued (MRIF) / received (MRR) per item per month, in the layout of the legacy sheet.
// Data: erp_items (read) + erp_v_item_monthly (legacy history Jan–Oct 2026 + live from Nov 2026).
// Writes nothing. Requires erp-history-setup.sql / erp-history-import.sql.
// ============================================================
(function () {
  'use strict';
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var S = { items: [], mv: {}, months: [], rows: [], view: [], page: 1, dataset: 'issued', measure: 'qty', cat: '', q: '', sort: 'total', pageSize: 100, hide: true, loaded: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtQty(v) { return v === 0 ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function fmtVal(v) { return v === 0 ? '–' : (v < 0 ? '-₱' : '₱') + Math.abs(Math.round(v)).toLocaleString('en-US'); }
  function short(v) { var a = Math.abs(v); return (v < 0 ? '-' : '') + '₱' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : Math.round(a)); }
  function fmt(v) { return S.measure === 'value' ? fmtVal(v) : fmtQty(v); }
  function toast(m, t) { if (typeof window.erpShowToast === 'function') window.erpShowToast(m, t || 'success'); }

  function buildMonths() {
    var now = new Date(), y = 2026, m = 1, out = [];
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      var k = y + '-' + (m < 10 ? '0' : '') + m;
      out.push({ key: k, label: MN[m - 1] + (m === 1 ? " '" + String(y).slice(2) : ''), partial: (y === now.getFullYear() && m === now.getMonth() + 1) });
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  // ── Load ────────────────────────────────────────────────
  async function load() {
    $('mmScroll').innerHTML = '<div class="mm-empty"><div class="spinner-border spinner-border-sm me-2"></div>Loading monthly data…</div>';
    try {
      var res = await Promise.all([
        erpFetchAll('erp_items', 'select=item_code,description,category,base_unit,unit_cost,on_hand,ave_monthly_consumption&is_deleted=eq.false&order=item_code.asc'),
        erpFetchAll('erp_v_item_monthly', 'select=item_code,month_start,mrif_qty,mrr_qty&order=item_code.asc,month_start.asc')
      ]);
      S.items = res[0] || []; S.months = buildMonths(); S.mv = {};
      (res[1] || []).forEach(function (r) {
        var o = S.mv[r.item_code] || (S.mv[r.item_code] = {});
        var k = String(r.month_start).slice(0, 7), c = o[k] || (o[k] = { a: 0, b: 0 });
        c.a += Number(r.mrif_qty || 0); c.b += Number(r.mrr_qty || 0);
      });
      S.loaded = true;
      var cats = {}; S.items.forEach(function (i) { if (i.category) cats[i.category] = 1; });
      $('mmCat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
      $('mmCat').value = S.cat;
      recompute();
    } catch (err) {
      console.error('[Monthly Movement]', err);
      $('mmScroll').innerHTML = '<div class="mm-empty"><i class="bi bi-info-circle me-1"></i>Monthly history is not available yet (' + esc(err.message || err) + ').<br>Run <b>erp-history-setup.sql</b> and <b>erp-history-import.sql</b> in Supabase. No other part of the system is affected.</div>';
      $('mmKpis').innerHTML = ''; $('mmChart').innerHTML = ''; $('mmPager').innerHTML = '';
    }
  }

  // ── Compute rows for current controls ───────────────────
  function cellVal(it, c) {
    if (!c) return 0;
    var uc = S.measure === 'value' ? Number(it.unit_cost || 0) : 1;
    var a = c.a * uc, b = c.b * uc;
    return S.dataset === 'issued' ? a : S.dataset === 'received' ? b : (b - a);
  }

  function recompute() {
    var q = S.q.trim().toLowerCase(), months = S.months, rows = [];
    var complete = months.filter(function (m) { return !m.partial; }).map(function (m) { return m.key; });
    S.items.forEach(function (it) {
      if (S.cat && it.category !== S.cat) return;
      if (q && (String(it.item_code).toLowerCase().indexOf(q) < 0 && String(it.description || '').toLowerCase().indexOf(q) < 0)) return;
      var mv = S.mv[it.item_code] || {};
      var vals = months.map(function (m) { return cellVal(it, mv[m.key]); });
      var any = months.some(function (m) { var c = mv[m.key]; return c && (c.a !== 0 || c.b !== 0); });
      if (S.hide && !any) return;
      var total = 0, active = 0, ctotal = 0;
      months.forEach(function (m, i) { total += vals[i]; if (vals[i] !== 0) active++; if (!m.partial) ctotal += vals[i]; });
      rows.push({ it: it, vals: vals, total: total, avg: complete.length ? ctotal / complete.length : 0, active: active, last: vals[vals.length - 1] || 0 });
    });
    var s = S.sort;
    rows.sort(function (x, y) {
      if (s === 'code') return String(x.it.item_code).localeCompare(String(y.it.item_code));
      if (s === 'desc') return String(x.it.description || '').localeCompare(String(y.it.description || ''));
      var k = s === 'avg' ? 'avg' : s === 'last' ? 'last' : 'total';
      return (y[k] - x[k]) || String(x.it.item_code).localeCompare(String(y.it.item_code));
    });
    S.view = rows; S.page = 1;
    renderKpisChart(); renderTable();
  }

  // ── KPIs + chart (issued vs received of the filtered selection) ──
  function renderKpisChart() {
    var months = S.months, issued = months.map(function () { return 0; }), recv = months.map(function () { return 0; });
    var saveMeasure = S.measure, itemsWith = 0;
    S.view.forEach(function (r) {
      var mv = S.mv[r.it.item_code] || {}, uc = S.measure === 'value' ? Number(r.it.unit_cost || 0) : 1, has = false;
      months.forEach(function (m, i) { var c = mv[m.key]; if (c) { issued[i] += c.a * uc; recv[i] += c.b * uc; if (c.a || c.b) has = true; } });
      if (has) itemsWith++;
    });
    var cm = months.map(function (m, i) { return { label: m.label, a: issued[i], b: recv[i], partial: m.partial }; });
    var full = cm.filter(function (d) { return !d.partial; });
    var sa = full.reduce(function (t, d) { return t + d.a; }, 0), sb = full.reduce(function (t, d) { return t + d.b; }, 0);
    var peak = full.slice().sort(function (x, y) { return y.a - x.a; })[0];
    var f = S.measure === 'value' ? short : function (v) { return Math.round(v).toLocaleString('en-US'); };
    $('mmKpis').innerHTML =
      kpi('Total issued', f(sa), full.length + ' complete months') +
      kpi('Total received', f(sb), sb >= sa ? 'Receipts exceeded issues' : 'Issues exceeded receipts') +
      kpi('Average issued / month', f(full.length ? sa / full.length : 0), 'complete months only') +
      kpi('Peak issuance', peak ? peak.label.replace(/ '\d+/, '') : '–', peak ? f(peak.a) : '') +
      kpi('Items with movement', itemsWith.toLocaleString('en-US'), 'of ' + S.view.length.toLocaleString('en-US') + ' shown');
    $('mmChartTitle').textContent = 'Issued vs received by month';
    $('mmChartSub').textContent = (S.cat || 'All categories') + (S.q ? ' · search: "' + S.q + '"' : '') + ' · ' + (S.measure === 'value' ? 'Value (₱)' : 'Quantity');
    var host = $('mmChart'), w = host.clientWidth || 900;
    host.innerHTML = '<div class="tr-leg mb-1" style="font-size:.74rem;color:#4b5563;display:flex;gap:14px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ef4444;margin-right:4px"></i>Issued (MRIF)</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#10b981;margin-right:4px"></i>Received (MRR)</span></div>' +
      window.erpTrendSvgBars(cm, { w: w, h: 320, big: true, labels: true, barFmt: S.measure === 'value' ? short : window.erpCompactNum, fmt: f, tip: S.measure === 'value' ? fmtVal : fmtQty });
  }
  function kpi(l, v, s) { return '<div class="mm-kpi"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }

  // ── Table ───────────────────────────────────────────────
  function tint(v, max) {
    if (!v || !max) return '';
    var a = Math.min(0.42, Math.abs(v) / max * 0.42 + 0.06), col;
    if (S.dataset === 'issued') col = '239,68,68'; else if (S.dataset === 'received') col = '16,185,129'; else col = v >= 0 ? '16,185,129' : '239,68,68';
    return ' style="background:rgba(' + col + ',' + a.toFixed(2) + ')"';
  }
  function renderTable() {
    var rows = S.view, months = S.months, total = rows.length, ps = S.pageSize, pages = Math.max(1, Math.ceil(total / ps));
    if (S.page > pages) S.page = pages;
    var start = (S.page - 1) * ps, slice = rows.slice(start, start + ps);
    var dsLabel = S.dataset === 'issued' ? 'Issued (MRIF)' : S.dataset === 'received' ? 'Received (MRR)' : 'Net (Received − Issued)';
    $('mmTableTitle').textContent = 'Item detail — ' + dsLabel + ', ' + (S.measure === 'value' ? 'value (₱)' : 'quantity');
    $('mmCount').textContent = total.toLocaleString('en-US') + ' item' + (total === 1 ? '' : 's');
    if (!total) { $('mmScroll').innerHTML = '<div class="mm-empty">No items match the current filters.</div>'; $('mmPager').innerHTML = ''; return; }

    var h = '<table class="mm"><thead><tr><th class="l c1">Item Code</th><th class="l c2">Description</th><th class="l">Category</th><th class="l">Unit</th>' +
      months.map(function (m) { return '<th' + (m.partial ? ' class="cur" title="Current month (in progress), excluded from average"' : '') + '>' + esc(m.label) + (m.partial ? '*' : '') + '</th>'; }).join('') +
      '<th>Total</th><th title="Average per complete month">Avg / Mo</th><th title="Months with movement">Active Mo.</th></tr></thead><tbody>';
    slice.forEach(function (r) {
      var mx = 0; r.vals.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); });
      var nc = S.measure === 'value' && !(Number(r.it.unit_cost) > 0) ? '<span class="mm-nocost" title="No unit cost: value shows as –">No cost</span>' : '';
      h += '<tr data-code="' + esc(r.it.item_code) + '"><td class="c1"><span class="mm-code">' + esc(r.it.item_code) + '</span></td>' +
        '<td class="c2" title="' + esc(r.it.description) + '">' + esc(r.it.description || '') + '</td>' +
        '<td>' + esc(r.it.category || '') + '</td><td>' + esc(r.it.base_unit || '') + nc + '</td>' +
        r.vals.map(function (v) { return '<td class="n' + (v === 0 ? ' z' : '') + '"' + tint(v, mx) + '>' + fmt(v) + '</td>'; }).join('') +
        '<td class="n tot">' + fmt(r.total) + '</td><td class="n">' + (S.measure === 'value' ? fmtVal(r.avg) : (r.avg === 0 ? '–' : r.avg.toLocaleString('en-US', { maximumFractionDigits: 1 }))) + '</td><td class="n">' + r.active + '</td></tr>';
    });
    // footer: totals for ALL filtered rows (not just this page)
    var tot = months.map(function () { return 0; }), gt = 0;
    rows.forEach(function (r) { r.vals.forEach(function (v, i) { tot[i] += v; }); gt += r.total; });
    var completeN = months.filter(function (m) { return !m.partial; }).length, ctot = 0;
    months.forEach(function (m, i) { if (!m.partial) ctot += tot[i]; });
    h += '</tbody><tfoot><tr><td class="c1">TOTAL</td><td class="c2">All ' + total.toLocaleString('en-US') + ' filtered items</td><td></td><td></td>' +
      tot.map(function (v) { return '<td class="n">' + fmt(v) + '</td>'; }).join('') +
      '<td class="n">' + fmt(gt) + '</td><td class="n">' + (S.measure === 'value' ? fmtVal(completeN ? ctot / completeN : 0) : fmtQty(completeN ? Math.round(ctot / completeN * 10) / 10 : 0)) + '</td><td></td></tr></tfoot></table>';
    $('mmScroll').innerHTML = h;
    $('mmScroll').querySelectorAll('tbody tr').forEach(function (tr) { tr.onclick = function () { openItem(tr.getAttribute('data-code')); }; });

    $('mmPager').innerHTML = '<span>Showing ' + (start + 1).toLocaleString('en-US') + '–' + Math.min(start + ps, total).toLocaleString('en-US') + ' of ' + total.toLocaleString('en-US') + '</span>' +
      '<span class="d-flex align-items-center gap-2"><button class="btn btn-sm btn-outline-secondary" id="mmPrev"' + (S.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span>Page ' + S.page + ' of ' + pages + '</span><button class="btn btn-sm btn-outline-secondary" id="mmNext"' + (S.page >= pages ? ' disabled' : '') + '>Next</button></span>';
    $('mmPrev').onclick = function () { S.page--; renderTable(); $('mmScroll').scrollTop = 0; };
    $('mmNext').onclick = function () { S.page++; renderTable(); $('mmScroll').scrollTop = 0; };
  }

  // ── Item modal ──────────────────────────────────────────
  function openItem(code) {
    var it = S.items.filter(function (i) { return i.item_code === code; })[0]; if (!it) return;
    $('mmItemTitle').textContent = it.item_code + ' — ' + (it.description || '');
    bootstrap.Modal.getOrCreateInstance($('mmItemModal')).show();
    setTimeout(function () { window.erpTrendRenderItem('mmItemTrend', it); }, 150);   // wait for the modal to have a width
  }

  // ── Export (CSV, Excel-compatible) ──────────────────────
  function exportCsv() {
    if (!S.view.length) { toast('Nothing to export', 'warning'); return; }
    function q(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var val = S.measure === 'value';
    var head = ['Item Code', 'Description', 'Category', 'Unit'].concat(S.months.map(function (m) { return m.key + (m.partial ? ' (in progress)' : ''); }), ['Total', 'Avg per complete month', 'Active months']);
    var lines = [head.map(q).join(',')];
    S.view.forEach(function (r) {
      lines.push([r.it.item_code, r.it.description, r.it.category, r.it.base_unit].concat(
        r.vals.map(function (v) { return val ? Math.round(v * 100) / 100 : v; }), [Math.round(r.total * 100) / 100, Math.round(r.avg * 100) / 100, r.active]).map(q).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'), d = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob); a.download = 'GEMCOR_Monthly_Movement_' + S.dataset + '_' + (val ? 'value' : 'qty') + '_' + d + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Exported ' + S.view.length.toLocaleString('en-US') + ' rows');
  }

  // ── Controls ────────────────────────────────────────────
  function seg(id, key) {
    $(id).querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { $(id).querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); S[key] = b.getAttribute('data-v'); recompute(); };
    });
  }
  function setSeg(id, v) { $(id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); }); }

  async function health() {
    var badge = $('erpHealthBadge'); if (!badge || typeof erpHealthCheck !== 'function') return;
    try { var r = await erpHealthCheck(); badge.querySelector('.dot').className = 'dot ' + (r.success ? 'dot-ok' : 'dot-error'); $('erpHealthText').textContent = r.success ? 'Connected (' + r.latency + 'ms)' : 'Offline'; }
    catch (e) { badge.querySelector('.dot').className = 'dot dot-error'; $('erpHealthText').textContent = 'Offline'; }
  }

  function init() {
    seg('mmDataset', 'dataset'); seg('mmMeasure', 'measure');
    $('mmCat').onchange = function () { S.cat = this.value; recompute(); };
    var t = null; $('mmSearch').oninput = function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { S.q = v; recompute(); }, 200); };
    $('mmSort').onchange = function () { S.sort = this.value; recompute(); };
    $('mmPageSize').onchange = function () { S.pageSize = Number(this.value); S.page = 1; renderTable(); };
    $('mmHide').onchange = function () { S.hide = this.checked; recompute(); };
    $('mmExport').onclick = exportCsv;
    $('mmReset').onclick = function () {
      S.dataset = 'issued'; S.measure = 'qty'; S.cat = ''; S.q = ''; S.sort = 'total'; S.hide = true; S.pageSize = 100;
      setSeg('mmDataset', 'issued'); setSeg('mmMeasure', 'qty'); $('mmCat').value = ''; $('mmSearch').value = ''; $('mmSort').value = 'total'; $('mmHide').checked = true; $('mmPageSize').value = '100';
      recompute();
    };
    var rt = null; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (S.loaded) renderKpisChart(); }, 200); });
    health(); load();
  }
  window.mmRefresh = function () { load(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
