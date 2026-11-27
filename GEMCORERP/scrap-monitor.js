// ============================================================
// GEMCOR ERP — Scrap Monitoring (v2.0)
// Follows the paper SCRAP SELLING FORM (SSF): one sale = SSF No., date, buyer,
// lines (scrap description / quantity / weight kg / price / amount), disposed by,
// approved by, payment received by (Finance) and AR No.
// Tables: erp_scrap_sales + erp_scrap_sale_lines (see scrap-monitor.sql).
// Never touches stock / cost / transactions.
// ============================================================

var SC_SALES = 'erp_scrap_sales';
var SC_LINES = 'erp_scrap_sale_lines';
var SC_EDIT_ROLES = ['warehouse'];   // who may create / edit / delete (others: view only)

// Standard classes (same names as the 2026 Excel log). Any other class typed in is kept and shows up too.
var SC_CLASSES = ['BI/GI', 'Stainless Steel', 'Busbar', 'Busbar Drilling', 'Wire Scrap', 'Aluminum',
  'Expanded Metal', 'Scrap Boxes', 'Powerpress & Wiremesh', 'Defective Breakers'];
var SC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

var SC = { sales: [], year: new Date().getFullYear(), month: '', tab: 'summary', metric: 'amount', editId: null, loadId: 0, role: '', lastPrice: {} };

function scEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function scPeso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function scPesoS(n) { return Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
function scKg(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function scUser() { return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || ''; }
function scCanEdit() { return SC_EDIT_ROLES.indexOf(SC.role) !== -1; }
function scIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function scNorm(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
function scId(id) { return document.getElementById(id); }
function scToast(msg) {
  var el = scId('erpToast'); if (!el) return alert(msg);
  scId('erpToastBody').textContent = msg;
  try { bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show(); } catch (e) { alert(msg); }
}
function scFmtDate(iso) {
  if (!iso) return '';
  var p = String(iso).slice(0, 10).split('-'); if (p.length < 3) return iso;
  return SC_MONTHS[Number(p[1]) - 1].slice(0, 3) + ' ' + Number(p[2]) + ', ' + p[0];
}
function scSaleTotals(s) {
  var kg = 0, amt = 0;
  (s.erp_scrap_sale_lines || []).forEach(function (l) { kg += Number(l.weight_kg || 0); amt += Number(l.amount || 0); });
  return { kg: kg, amt: amt };
}

document.addEventListener('DOMContentLoaded', function () {
  SC.role = (localStorage.getItem('ivm_userRole') || '').toLowerCase();
  if (!scCanEdit()) { var b = scId('scNewBtn'); if (b) b.style.display = 'none'; }
  scHealth();
  scLoad();
});

async function scHealth() {
  var badge = scId('erpHealthBadge'); if (!badge) return;
  var text = scId('erpHealthText'), dot = badge.querySelector('.dot');
  try { var r = await erpHealthCheck(); if (r.success) { dot.className = 'dot dot-ok'; text.textContent = 'Connected (' + r.latency + 'ms)'; } else { dot.className = 'dot dot-error'; text.textContent = 'Offline'; } }
  catch (e) { dot.className = 'dot dot-error'; text.textContent = 'Error'; }
}

// ═══════════════════════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════════════════════
async function scLoad() {
  var myId = ++SC.loadId;
  var setup = scId('scSetup');
  scId('scSalesBody').innerHTML = '<tr><td colspan="9" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading…</div></td></tr>';
  try {
    var rows = await erpFetchAll(SC_SALES,
      'select=*,erp_scrap_sale_lines(id,line_no,scrap_class,quantity,weight_kg,price_per_kg,amount)&is_deleted=eq.false&order=sale_date.desc,id.desc');
    if (myId !== SC.loadId) return;
    SC.sales = (rows || []).map(function (s) {
      (s.erp_scrap_sale_lines = s.erp_scrap_sale_lines || []).sort(function (a, b) { return (a.line_no || 0) - (b.line_no || 0); });
      return s;
    });
    setup.style.display = 'none';
    scBuildLookups();
    scRender();
  } catch (e) {
    console.error('[ScrapMonitor]', e);
    var msg = String(e && e.message || e);
    var needSql = /erp_scrap|42P01|PGRST|404|relation/i.test(msg);
    setup.style.display = '';
    setup.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i><b>' + (needSql ? 'Setup needed' : 'Could not load') + '</b> — ' +
      (needSql ? 'Run <code>scrap-monitor.sql</code> (then <code>scrap-monitor-import-2026.sql</code> for the Jan–Nov 2026 data) once in the Supabase SQL Editor, then refresh.' : scEsc(msg));
    scId('scSalesBody').innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">Could not load scrap sales.</td></tr>';
  }
}

function scBuildLookups() {
  // years that have data (+ current year)
  var ys = {}; ys[new Date().getFullYear()] = 1;
  SC.sales.forEach(function (s) { ys[String(s.sale_date).slice(0, 4)] = 1; });
  var years = Object.keys(ys).sort().reverse();
  if (years.indexOf(String(SC.year)) === -1) SC.year = Number(years[0]);
  scId('scYear').innerHTML = years.map(function (y) { return '<option value="' + y + '"' + (Number(y) === SC.year ? ' selected' : '') + '>' + y + '</option>'; }).join('');

  // last price per class (most recent sale with a price)
  SC.lastPrice = {};
  SC.sales.slice().sort(function (a, b) { return String(a.sale_date).localeCompare(String(b.sale_date)); }).forEach(function (s) {
    s.erp_scrap_sale_lines.forEach(function (l) { if (Number(l.price_per_kg) > 0) SC.lastPrice[scNorm(l.scrap_class).toLowerCase()] = Number(l.price_per_kg); });
  });

  // class datalist (standard first, then any extra seen in data)
  scId('scClassList').innerHTML = scAllClasses().map(function (c) { return '<option value="' + scEsc(c) + '">'; }).join('');
  var buyers = {}; SC.sales.forEach(function (s) { if (s.buyer_name) buyers[scNorm(s.buyer_name)] = 1; });
  scId('scBuyerList').innerHTML = Object.keys(buyers).sort().map(function (b) { return '<option value="' + scEsc(b) + '">'; }).join('');
  scId('scClassSel').innerHTML = '<option value="">All Classes</option>' + scAllClasses().map(function (c) { return '<option value="' + scEsc(c) + '">' + scEsc(c) + '</option>'; }).join('');
}

function scAllClasses() {
  var seen = {}, out = [];
  SC_CLASSES.forEach(function (c) { seen[c.toLowerCase()] = 1; out.push(c); });
  SC.sales.forEach(function (s) { s.erp_scrap_sale_lines.forEach(function (l) {
    var c = scNorm(l.scrap_class); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c); }
  }); });
  return out;
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function scYearSales() { return SC.sales.filter(function (s) { return String(s.sale_date).slice(0, 4) === String(SC.year); }); }

function scSetYear() { SC.year = Number(scId('scYear').value); scRender(); }
function scSetTab(t) {
  SC.tab = t;
  ['summary', 'sales'].forEach(function (k) {
    scId('scTab_' + k).classList.toggle('active', k === t);
    scId('scPane_' + k).style.display = (k === t) ? '' : 'none';
  });
}
function scSetMetric(m) {
  SC.metric = m;
  scId('scMetAmt').classList.toggle('active', m === 'amount');
  scId('scMetKg').classList.toggle('active', m === 'weight');
  scRenderMatrix();
}

function scRender() {
  var ys = scYearSales(), kg = 0, amt = 0, pending = 0;
  ys.forEach(function (s) { var t = scSaleTotals(s); kg += t.kg; amt += t.amt; if (!s.ar_no) pending++; });
  scId('scKpiAmt').textContent = scPeso(amt);
  scId('scKpiAmtSub').textContent = 'Scrap sold in ' + SC.year;
  scId('scKpiKg').textContent = scKg(kg) + ' kg';
  scId('scKpiKgSub').textContent = '';
  scId('scKpiSales').textContent = ys.length;
  scId('scKpiSalesSub').textContent = ys.length ? 'Last: ' + scFmtDate(ys[0].sale_date) : ' ';
  scId('scKpiPend').textContent = pending;
  scId('scKpiPendSub').textContent = pending ? 'Sales with no AR No. yet' : 'All sales have an AR No.';
  scId('scKpiPend').parentNode.parentNode.className = 'erp-kpi-card ' + (pending ? 'kpi-red' : 'kpi-green');
  scRenderMatrix();
  scRenderSales();
}

// Monthly summary: months x scrap class (same layout as the "Summary of Scrap" sheet)
function scRenderMatrix() {
  var ys = scYearSales(), isAmt = SC.metric === 'amount';
  var grid = {}, classTot = {}, usedClasses = {};
  for (var m = 1; m <= 12; m++) grid[m] = { kg: 0, amt: 0, by: {} };
  ys.forEach(function (s) {
    var m = Number(String(s.sale_date).slice(5, 7));
    s.erp_scrap_sale_lines.forEach(function (l) {
      var c = scNorm(l.scrap_class), g = grid[m];
      var o = g.by[c] = g.by[c] || { kg: 0, amt: 0 };
      o.kg += Number(l.weight_kg || 0); o.amt += Number(l.amount || 0);
      g.kg += Number(l.weight_kg || 0); g.amt += Number(l.amount || 0);
      var t = classTot[c] = classTot[c] || { kg: 0, amt: 0 };
      t.kg += Number(l.weight_kg || 0); t.amt += Number(l.amount || 0);
      usedClasses[c] = 1;
    });
  });
  var classes = scAllClasses().filter(function (c) { return usedClasses[c]; });
  var val = function (o) { return o ? (isAmt ? o.amt : o.kg) : 0; };
  var fmt = function (n) { return n ? (isAmt ? scPesoS(n) : scKg(n)) : '<span class="sc-dash">–</span>'; };

  var head = '<tr><th>Month</th>' + classes.map(function (c) { return '<th class="num">' + scEsc(c) + '</th>'; }).join('') +
    '<th class="num sc-tot">Total kg</th><th class="num sc-tot">Total Amount</th></tr>';
  var body = '', gk = 0, ga = 0;
  for (var mm = 1; mm <= 12; mm++) {
    var g = grid[mm]; gk += g.kg; ga += g.amt;
    var has = g.kg > 0 || g.amt > 0;
    body += '<tr class="' + (has ? 'sc-clickable' : 'sc-empty-row') + '"' + (has ? ' onclick="scJumpMonth(' + mm + ')" title="View sales for this month"' : '') + '><td><b>' + SC_MONTHS[mm - 1] + '</b></td>' +
      classes.map(function (c) { return '<td class="num">' + fmt(val(g.by[c])) + '</td>'; }).join('') +
      '<td class="num sc-tot">' + (has ? scKg(g.kg) : '<span class="sc-dash">–</span>') + '</td><td class="num sc-tot">' + (has ? scPesoS(g.amt) : '<span class="sc-dash">–</span>') + '</td></tr>';
  }
  var foot = '<tr><td>TOTAL ' + SC.year + '</td>' + classes.map(function (c) { return '<td class="num">' + fmt(val(classTot[c])) + '</td>'; }).join('') +
    '<td class="num">' + scKg(gk) + '</td><td class="num">' + scPesoS(ga) + '</td></tr>';
  if (!ys.length) { scId('scMatrix').innerHTML = '<tbody><tr><td class="erp-empty">Walang scrap sales para sa ' + SC.year + '.</td></tr></tbody>'; return; }
  scId('scMatrix').innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot>';
}

function scJumpMonth(m) { scId('scMonthSel').value = String(m); scSetTab('sales'); scRenderSales(); }

function scRenderSales() {
  var body = scId('scSalesBody');
  var month = scId('scMonthSel').value, cls = scId('scClassSel').value.toLowerCase(), ar = scId('scArSel').value;
  var terms = scId('scSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  var can = scCanEdit();

  var list = scYearSales().filter(function (s) {
    if (month && Number(String(s.sale_date).slice(5, 7)) !== Number(month)) return false;
    if (cls && !s.erp_scrap_sale_lines.some(function (l) { return scNorm(l.scrap_class).toLowerCase() === cls; })) return false;
    if (ar === 'pending' && s.ar_no) return false;
    if (ar === 'paid' && !s.ar_no) return false;
    if (!terms.length) return true;
    var hay = ('ssf ' + (s.ssf_no || '') + ' ar ' + (s.ar_no || '') + ' ' + (s.buyer_name || '') + ' ' + (s.remarks || '') + ' ' +
      s.erp_scrap_sale_lines.map(function (l) { return l.scrap_class; }).join(' ')).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) !== -1; });
  });
  SC.view = list;
  scId('scCount').textContent = list.length + ' sale' + (list.length === 1 ? '' : 's');
  if (!list.length) { body.innerHTML = '<tr><td colspan="9" class="erp-empty">Walang scrap sales na tugma.</td></tr>'; scId('scSalesFoot').innerHTML = ''; return; }

  var tk = 0, ta = 0;
  body.innerHTML = list.map(function (s) {
    var t = scSaleTotals(s); tk += t.kg; ta += t.amt;
    var items = s.erp_scrap_sale_lines.map(function (l) {
      return '<span class="sc-chip">' + scEsc(scNorm(l.scrap_class)) + (Number(l.weight_kg) > 0 ? ' · ' + scKg(l.weight_kg) + ' kg' : '') + '</span>';
    }).join(' ');
    return '<tr>' +
      '<td class="text-nowrap"><b>' + (s.ssf_no != null ? 'SSF-' + scEsc(s.ssf_no) : '—') + '</b></td>' +
      '<td class="text-nowrap">' + scEsc(scFmtDate(s.sale_date)) + '</td>' +
      '<td>' + scEsc(s.buyer_name || '') + '</td>' +
      '<td>' + items + '</td>' +
      '<td class="num">' + scKg(t.kg) + '</td>' +
      '<td class="num">' + scPeso(t.amt) + '</td>' +
      '<td>' + (s.ar_no ? '<span class="sc-ar ok">AR No. ' + scEsc(s.ar_no) + '</span>' : '<span class="sc-ar pend">Pending</span>') + '</td>' +
      '<td class="text-center text-nowrap">' +
        '<button class="btn btn-sm btn-outline-secondary py-0 px-1" title="View / Print form" onclick="scPrint(' + Number(s.id) + ')"><i class="bi bi-printer"></i></button>' +
        (can ? ' <button class="btn btn-sm btn-outline-primary py-0 px-1" title="Edit" onclick="scOpenForm(' + Number(s.id) + ')"><i class="bi bi-pencil"></i></button>' +
               ' <button class="btn btn-sm btn-outline-danger py-0 px-1" title="Delete" onclick="scDelete(' + Number(s.id) + ')"><i class="bi bi-trash"></i></button>' : '') +
      '</td></tr>';
  }).join('');
  scId('scSalesFoot').innerHTML = '<tr><td colspan="4">TOTAL (' + list.length + ')</td><td class="num">' + scKg(tk) + '</td><td class="num">' + scPeso(ta) + '</td><td colspan="2"></td></tr>';
}

function scClearFilters() {
  scId('scMonthSel').value = ''; scId('scClassSel').value = ''; scId('scArSel').value = ''; scId('scSearch').value = ''; scRenderSales();
}

// ═══════════════════════════════════════════════════════════
// FORM (modal) — same fields as the paper Scrap Selling Form
// ═══════════════════════════════════════════════════════════
function scNextSsf() {
  var mx = 0; SC.sales.forEach(function (s) { if (Number(s.ssf_no) > mx) mx = Number(s.ssf_no); }); return mx + 1;
}

function scOpenForm(id) {
  if (!scCanEdit()) return scToast('View-only ang account mo.');
  var s = id ? SC.sales.filter(function (x) { return Number(x.id) === Number(id); })[0] : null;
  SC.editId = s ? s.id : null;
  scId('scModalTitle').innerHTML = s ? '<i class="bi bi-pencil-square me-2"></i>Edit Scrap Selling Form' : '<i class="bi bi-file-earmark-plus me-2"></i>New Scrap Selling Form';
  scId('fSsf').value = s ? (s.ssf_no == null ? '' : s.ssf_no) : scNextSsf();
  scId('fDate').value = s ? String(s.sale_date).slice(0, 10) : scIso(new Date());
  scId('fBuyer').value = s ? (s.buyer_name || '') : '';
  scId('fDisposed').value = s ? (s.disposed_by || '') : scUser();
  scId('fApproved').value = s ? (s.approved_by || '') : '';
  scId('fReceived').value = s ? (s.received_by || '') : '';
  scId('fAr').value = s ? (s.ar_no || '') : '';
  scId('fRemarks').value = s ? (s.remarks || '') : '';
  scId('scLines').innerHTML = '';
  if (s && s.erp_scrap_sale_lines.length) s.erp_scrap_sale_lines.forEach(function (l) { scAddLine(l); });
  else { scAddLine(); }
  scCalcTotals();
  bootstrap.Modal.getOrCreateInstance(scId('scModal')).show();
}

function scAddLine(l) {
  l = l || {};
  var tr = document.createElement('tr');
  var manual = l.id && Number(l.amount) > 0 && Math.abs(Number(l.weight_kg || 0) * Number(l.price_per_kg || 0) - Number(l.amount)) > 0.5;
  tr.setAttribute('data-manual', manual ? '1' : '');
  tr.innerHTML =
    '<td><input type="text" class="form-control form-control-sm l-cls" list="scClassList" placeholder="Scrap description" value="' + scEsc(l.scrap_class || '') + '" onchange="scLineClassChanged(this)"></td>' +
    '<td><input type="number" class="form-control form-control-sm l-qty" min="0" step="any" value="' + (l.quantity == null ? '' : l.quantity) + '"></td>' +
    '<td><input type="number" class="form-control form-control-sm l-w" min="0" step="any" value="' + (l.weight_kg ? l.weight_kg : '') + '" oninput="scLineCalc(this)"></td>' +
    '<td><input type="number" class="form-control form-control-sm l-p" min="0" step="any" value="' + (l.price_per_kg ? l.price_per_kg : '') + '" oninput="scLineCalc(this)"></td>' +
    '<td><input type="number" class="form-control form-control-sm l-a" min="0" step="any" value="' + (l.amount ? l.amount : '') + '" oninput="scLineAmountTyped(this)"></td>' +
    '<td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" title="Remove row" onclick="scRemoveLine(this)"><i class="bi bi-x-lg"></i></button></td>';
  scId('scLines').appendChild(tr);
}
function scRemoveLine(btn) {
  var tb = scId('scLines'); btn.closest('tr').remove();
  if (!tb.children.length) scAddLine();
  scCalcTotals();
}
function scLineClassChanged(inp) {
  var tr = inp.closest('tr'), p = tr.querySelector('.l-p');
  var lp = SC.lastPrice[scNorm(inp.value).toLowerCase()];
  if (lp && !p.value) { p.value = lp; scLineCalc(p); }       // prefill last price used for this class
}
function scLineCalc(inp) {
  var tr = inp.closest('tr');
  if (!tr.getAttribute('data-manual')) {
    var w = parseFloat(tr.querySelector('.l-w').value) || 0, p = parseFloat(tr.querySelector('.l-p').value) || 0;
    tr.querySelector('.l-a').value = (w * p) ? Math.round(w * p * 100) / 100 : '';
  }
  scCalcTotals();
}
function scLineAmountTyped(inp) { inp.closest('tr').setAttribute('data-manual', '1'); scCalcTotals(); }   // lump-sum / override
function scCalcTotals() {
  var kg = 0, amt = 0;
  scId('scLines').querySelectorAll('tr').forEach(function (tr) {
    kg += parseFloat(tr.querySelector('.l-w').value) || 0; amt += parseFloat(tr.querySelector('.l-a').value) || 0;
  });
  scId('fTotKg').textContent = scKg(kg); scId('fTotAmt').textContent = scPeso(amt);
}

function scReadLines() {
  var out = [];
  scId('scLines').querySelectorAll('tr').forEach(function (tr) {
    var c = scNorm(tr.querySelector('.l-cls').value);
    var w = parseFloat(tr.querySelector('.l-w').value) || 0, p = parseFloat(tr.querySelector('.l-p').value) || 0;
    var a = parseFloat(tr.querySelector('.l-a').value), q = tr.querySelector('.l-qty').value;
    if (isNaN(a)) a = Math.round(w * p * 100) / 100;
    if (!c && !w && !a) return;                       // skip blank rows
    // keep one spelling/casing per class
    var known = scAllClasses().filter(function (k) { return k.toLowerCase() === c.toLowerCase(); })[0];
    out.push({ scrap_class: known || c, quantity: q === '' ? null : parseFloat(q), weight_kg: w, price_per_kg: p, amount: a });
  });
  return out;
}

async function scSave() {
  if (!scCanEdit()) return scToast('View-only ang account mo.');
  var date = scId('fDate').value, ssf = scId('fSsf').value.trim();
  var lines = scReadLines();
  if (!date) return scToast('Ilagay ang date.');
  if (!lines.length) return scToast('Maglagay ng kahit isang scrap line.');
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].scrap_class) return scToast('May line na walang scrap description.');
    if (!(lines[i].weight_kg > 0) && !(lines[i].amount > 0)) return scToast('May line na walang weight o amount: ' + lines[i].scrap_class);
  }
  // heads-up on a repeated SSF No. (the old Excel log had one) — does not block saving
  if (ssf && SC.sales.some(function (s) { return String(s.ssf_no) === ssf && Number(s.id) !== Number(SC.editId); })) {
    if (!confirm('Ginamit na ang SSF No. ' + ssf + ' sa ibang sale. Ituloy pa rin?')) return;
  }
  var head = {
    ssf_no: ssf === '' ? null : parseInt(ssf, 10), sale_date: date,
    buyer_name: scNorm(scId('fBuyer').value) || null, disposed_by: scNorm(scId('fDisposed').value) || null,
    approved_by: scNorm(scId('fApproved').value) || null, received_by: scNorm(scId('fReceived').value) || null,
    ar_no: scNorm(scId('fAr').value).replace(/^AR\s*(No\.?)?\s*/i, '') || null, remarks: scNorm(scId('fRemarks').value) || null
  };
  var btn = scId('scSaveBtn'); btn.disabled = true;
  try {
    var saleId;
    if (SC.editId) {
      head.updated_at = new Date().toISOString();
      await erpFetch(SC_SALES, 'id=eq.' + encodeURIComponent(SC.editId), { method: 'PATCH', body: head });
      saleId = SC.editId;
      await erpFetch(SC_LINES, 'sale_id=eq.' + encodeURIComponent(saleId), { method: 'DELETE' });
    } else {
      head.created_by = scUser() || null;
      var res = await erpFetch(SC_SALES, '', { method: 'POST', body: head });
      saleId = res && res[0] && res[0].id;
      if (!saleId) throw new Error('No id returned');
    }
    var payload = lines.map(function (l, idx) { l.sale_id = saleId; l.line_no = idx + 1; return l; });
    try { await erpFetch(SC_LINES, '', { method: 'POST', body: payload }); }
    catch (e) {
      if (!SC.editId) { try { await erpFetch(SC_SALES, 'id=eq.' + encodeURIComponent(saleId), { method: 'DELETE' }); } catch (x) {} }
      throw e;
    }
    bootstrap.Modal.getOrCreateInstance(scId('scModal')).hide();
    scToast('✅ ' + (SC.editId ? 'Scrap sale updated' : 'Scrap sale saved'));
    await scLoad();
  } catch (e) {
    console.error('[ScrapMonitor] save', e);
    scToast('Failed: ' + (e && e.message || e));
    if (SC.editId) scLoad();
  } finally { btn.disabled = false; }
}

async function scDelete(id) {
  if (!scCanEdit()) return;
  var s = SC.sales.filter(function (x) { return Number(x.id) === Number(id); })[0]; if (!s) return;
  var t = scSaleTotals(s);
  if (!confirm('I-delete ang SSF-' + (s.ssf_no == null ? '?' : s.ssf_no) + ' (' + scFmtDate(s.sale_date) + ', ' + scKg(t.kg) + ' kg, ' + scPeso(t.amt) + ')?')) return;
  try {
    await erpFetch(SC_SALES, 'id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { is_deleted: true, updated_at: new Date().toISOString() } });   // soft delete
    scToast('Sale deleted');
    await scLoad();
  } catch (e) { scToast('Failed: ' + (e && e.message || e)); }
}

// ═══════════════════════════════════════════════════════════
// PRINT — same layout as the paper Scrap Selling Form
// ═══════════════════════════════════════════════════════════
function scPrint(id) {
  var s = SC.sales.filter(function (x) { return Number(x.id) === Number(id); })[0]; if (!s) return;
  var t = scSaleTotals(s), us = function (v) { return v ? scEsc(v) : '__________________________'; };
  var rows = s.erp_scrap_sale_lines.map(function (l) {
    return '<tr><td>' + scEsc(scNorm(l.scrap_class)) + '</td><td class="n">' + (l.quantity == null ? '' : scKg(l.quantity)) + '</td><td class="n">' + (Number(l.weight_kg) ? scKg(l.weight_kg) : '') +
      '</td><td class="n">' + (Number(l.price_per_kg) ? scPeso(l.price_per_kg) : '') + '</td><td class="n">' + scPeso(l.amount) + '</td></tr>';
  }).join('');
  for (var i = s.erp_scrap_sale_lines.length; i < 5; i++) rows += '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SSF-' + scEsc(s.ssf_no) + '</title><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;margin:30px 40px;max-width:760px}' +
    'h2{text-align:center;margin:0 0 18px;letter-spacing:.05em}.r{text-align:right;margin-bottom:10px}p{margin:8px 0}' +
    'table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #000;padding:6px 8px}th{background:#eee}td.n{text-align:right}' +
    'tr.tot td{font-weight:bold}.sig{margin-top:26px}.box{margin-top:30px;border-top:2px solid #000;padding-top:8px}' +
    '@media print{body{margin:10mm}}</style></head><body>' +
    '<h2>SCRAP SELLING FORM</h2>' +
    '<div class="r"><b>SSF No.</b> ' + (s.ssf_no == null ? '____' : scEsc(s.ssf_no)) + '</div>' +
    '<p>Date: <b>' + scEsc(scFmtDate(s.sale_date)) + '</b></p>' +
    '<p>Buyer Name: <b>' + (s.buyer_name ? scEsc(s.buyer_name) : '__________________________') + '</b></p>' +
    '<table><thead><tr><th>Scrap Description</th><th>Quantity</th><th>Weight (kg)</th><th>Price</th><th>Amount</th></tr></thead><tbody>' + rows +
    '<tr class="tot"><td>Total</td><td></td><td class="n">' + scKg(t.kg) + '</td><td></td><td class="n">' + scPeso(t.amt) + '</td></tr></tbody></table>' +
    '<div class="sig"><p>Disposed By: ' + us(s.disposed_by) + '</p><p>Date: ' + scEsc(scFmtDate(s.sale_date)) + '</p><p>Approved By: ' + us(s.approved_by) + '</p></div>' +
    '<div class="box"><b>PAYMENT RECEIVED BY (FINANCE)</b><p>Name: ' + us(s.received_by) + '</p><p>Signature/Date: ___________________</p><p>AR No. ' + (s.ar_no ? scEsc(s.ar_no) : '__________________________') + '</p></div>' +
    '<script>window.onload=function(){setTimeout(function(){window.print();},300)}<\/script></body></html>';
  var w = window.open('', '_blank');
  if (!w) return scToast('I-allow ang pop-ups para ma-print ang form.');
  w.document.open(); w.document.write(html); w.document.close();
}

// ═══════════════════════════════════════════════════════════
// EXPORT (CSV) — one row per scrap line, like the monthly sheets
// ═══════════════════════════════════════════════════════════
function scExport() {
  var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var rows = [['Date', 'SSF No.', 'Buyer', 'Scrap Description', 'Quantity', 'Weight (kg)', 'Price', 'Amount', 'AR No.', 'Disposed By', 'Approved By', 'Received By (Finance)']];
  (SC.view || scYearSales()).slice().sort(function (a, b) { return String(a.sale_date).localeCompare(String(b.sale_date)); }).forEach(function (s) {
    s.erp_scrap_sale_lines.forEach(function (l) {
      rows.push([String(s.sale_date).slice(0, 10), s.ssf_no == null ? '' : 'SSF-' + s.ssf_no, s.buyer_name || '', scNorm(l.scrap_class), l.quantity == null ? '' : l.quantity,
        l.weight_kg, l.price_per_kg, l.amount, s.ar_no || '', s.disposed_by || '', s.approved_by || '', s.received_by || '']);
    });
  });
  var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'scrap-sales-' + SC.year + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
