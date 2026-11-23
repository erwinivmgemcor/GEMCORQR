// ============================================================
// GEMCOR ERP — Fixed Assets (v1.0)
// Items tagged with erp_items.asset_type are FIXED ASSETS: they are excluded from
// Inventory Value / stock reports and shown only here.
// Repairs and Maintenance is a fixed asset only when asset_treatment = 'CAPITAL'.
// Reads erp_items + erp_stock_ledger. Writes ONLY asset_type / asset_treatment (never stock, cost, or transactions).
// ============================================================

// Who may tag items (edit this list to change). Roles come from localStorage 'ivm_userRole'.
var FA_EDIT_ROLES = ['warehouse', 'finance'];
// Who may set an R&M item to CAPITAL (accounting decision). Narrow to ['finance'] if you want accounting only.
var FA_CAPITAL_ROLES = ['warehouse', 'finance'];
// Who may pick items to issue (opens Manual MRIF with the items + qty filled in).
var FA_MRIF_ROLES = ['warehouse'];

var FA_TYPES = [
  { k: 'TOOLS',                 t: 'Tools',                     i: 'bi-tools',                  c: '#2563eb' },
  { k: 'MACHINERIES_EQUIPMENT', t: 'Machineries and Equipment', i: 'bi-gear-wide-connected',    c: '#7c3aed' },
  { k: 'OFFICE_EQUIPMENT',      t: 'Office Equipment',          i: 'bi-pc-display',             c: '#0891b2' },
  { k: 'OFFICE_FURNITURE',      t: 'Office Furniture',          i: 'bi-lamp',                   c: '#059669' },
  { k: 'OFFICE_FIXTURES',       t: 'Office Fixtures',           i: 'bi-columns-gap',            c: '#d97706' },
  { k: 'REPAIRS_MAINTENANCE',   t: 'Repairs and Maintenance',   i: 'bi-wrench-adjustable',      c: '#dc2626' }
];
var FA_BY = {}; FA_TYPES.forEach(function (t) { FA_BY[t.k] = t; });

var FA = { sel: {}, items: [], recv: {}, view: [], type: '', page: 1, pageSize: 100, timer: null, findTimer: null, loadId: 0, role: '' };

function faEsc(s) { return (window.erpEsc ? erpEsc(s) : String(s == null ? '' : s)); }
function faPeso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function faNum(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function faUser() { return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE'; }
function faCan(list) { return list.indexOf(FA.role) !== -1; }
function faToast(msg) {
  var el = document.getElementById('erpToast'); if (!el) return alert(msg);
  document.getElementById('erpToastBody').textContent = msg;
  try { bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show(); } catch (e) { alert(msg); }
}
// R&M counts as an asset only when CAPITAL. Everything else tagged counts.
function faIsActive(it) { return it.is_active !== false; }
function faIsCounted(it) { return it.asset_type !== 'REPAIRS_MAINTENANCE' || it.asset_treatment === 'CAPITAL'; }

document.addEventListener('DOMContentLoaded', function () {
  FA.role = (localStorage.getItem('ivm_userRole') || '').toLowerCase();
  var sel = document.getElementById('faTypeSel');
  sel.innerHTML = '<option value="">All Types</option>' + FA_TYPES.map(function (t) { return '<option value="' + t.k + '">' + t.t + '</option>'; }).join('');
  var tt = document.getElementById('faTagType');
  tt.innerHTML = FA_TYPES.map(function (t) { return '<option value="' + t.k + '">' + t.t + '</option>'; }).join('');
  if (!faCan(FA_MRIF_ROLES)) { document.querySelectorAll('.fa-sel-col').forEach(function (e) { e.style.display = 'none'; }); }
  if (!faCan(FA_EDIT_ROLES)) { document.querySelectorAll('.fa-edit-col').forEach(function (e) { e.style.display = 'none'; }); }
  else document.getElementById('faTagBtn').style.display = '';
  faTagTypeChanged();
  faHealth();
  faLoad();
});

async function faHealth() {
  var badge = document.getElementById('erpHealthBadge'); if (!badge) return;
  var text = document.getElementById('erpHealthText'), dot = badge.querySelector('.dot');
  try { var r = await erpHealthCheck(); if (r.success) { dot.className = 'dot dot-ok'; text.textContent = 'Connected (' + r.latency + 'ms)'; } else { dot.className = 'dot dot-error'; text.textContent = 'Offline'; } }
  catch (e) { dot.className = 'dot dot-error'; text.textContent = 'Error'; }
}

// ═══════════════════════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════════════════════
async function faLoad() {
  var myId = ++FA.loadId;
  var body = document.getElementById('faBody');
  body.innerHTML = '<tr><td colspan="12" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading…</div></td></tr>';
  try {
    var items = await erpFetchAll('erp_items',
      'select=item_code,description,category,location,base_unit,unit_cost,on_hand,asset_type,asset_treatment,is_active' +
      '&asset_type=not.is.null&is_deleted=eq.false&order=item_code.asc');
    if (myId !== FA.loadId) return;
    FA.items = items || [];

    // MRR receipts (live ledger) for the tagged items only — chunked to keep URLs short.
    FA.recv = {};
    var codes = FA.items.map(function (i) { return i.item_code; });
    for (var s = 0; s < codes.length; s += 60) {
      var chunk = codes.slice(s, s + 60).map(function (c) { return '"' + String(c).replace(/"/g, '') + '"'; }).join(',');
      try {
        var rows = await erpFetchAll('erp_stock_ledger',
          'select=item_code,qty_in,transaction_type,reference_doc,transaction_date&qty_in=gt.0&item_code=in.(' + encodeURIComponent(chunk) + ')&order=transaction_date.asc');
        (rows || []).forEach(function (tx) {
          var tag = (String(tx.transaction_type || '') + ' ' + String(tx.reference_doc || '')).toUpperCase();
          if (tag.indexOf('MRR') === -1 || tag.indexOf('MRIF') !== -1) return;
          (FA.recv[tx.item_code] = FA.recv[tx.item_code] || []).push({ q: Number(tx.qty_in || 0), d: String(tx.transaction_date || '').slice(0, 10), ref: tx.reference_doc || '' });
        });
      } catch (e) { console.warn('[FixedAssets] ledger chunk failed', e); }
    }
    document.getElementById('faSummary').className = 'fa-summary';
    faApply();
  } catch (e) {
    console.error('[FixedAssets]', e);
    var msg = String(e && e.message || e);
    var setup = /asset_type|column|42703|400/i.test(msg);
    document.getElementById('faSummary').className = 'fa-summary warn';
    document.getElementById('faSummary').innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i><div><b>' + (setup ? 'Setup needed' : 'Could not load') + '</b>' +
      '<span class="sub">' + (setup ? 'Run <code>fixed-assets.sql</code> once in the Supabase SQL Editor (it adds the asset_type column), then refresh.' : faEsc(msg)) + '</span></div>';
    body.innerHTML = '<tr><td colspan="12" class="erp-empty text-danger">Could not load fixed assets.</td></tr>';
  }
}

// ═══════════════════════════════════════════════════════════
// PERIOD + AGGREGATES
// ═══════════════════════════════════════════════════════════
function faRange() {
  var p = document.getElementById('faPeriod').value, now = new Date();
  var iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), label: 'This month' };
  if (p === '30d')   return { from: iso(new Date(now.getTime() - 30 * 86400000)), label: 'Last 30 days' };
  if (p === 'year')  return { from: now.getFullYear() + '-01-01', label: 'This year' };
  return { from: '', label: 'All time' };
}
function faAgg(it, from) {
  var list = FA.recv[it.item_code] || [], q = 0, last = '', refs = [];
  list.forEach(function (r) { if (from && r.d < from) return; q += r.q; if (r.d > last) last = r.d; if (r.ref && refs.indexOf(r.ref) === -1) refs.push(r.ref); });
  var cost = Number(it.unit_cost || 0);
  return { qty: q, val: q * cost, last: last, refs: refs, onhandVal: Number(it.on_hand || 0) * cost };
}

function faApply() {
  var rg = faRange();
  document.getElementById('faPeriodSub').textContent = 'Acquisitions by MRR date · ' + rg.label;
  var terms = document.getElementById('faSearch').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  var recvOnly = document.getElementById('faRecvOnly').checked;
  var showInactive = document.getElementById('faShowInactive').checked;

  // Per-item aggregates for the period
  FA.items.forEach(function (it) { it._a = faAgg(it, rg.from); });

  faRenderTop(rg);

  FA.view = FA.items.filter(function (it) {
    if (FA.type && it.asset_type !== FA.type) return false;
    if (!showInactive && !faIsActive(it)) return false;
    if (recvOnly && !(it._a.qty > 0)) return false;
    if (!terms.length) return true;
    var hay = (it.item_code + ' ' + (it.description || '')).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) !== -1; });
  }).sort(function (a, b) { return (b._a.val - a._a.val) || String(a.item_code).localeCompare(String(b.item_code), undefined, { numeric: true }); });

  FA.page = 1;
  faRenderTable();
}

function faRenderTop(rg) {
  var tot = 0, cnt = 0, exp = 0, by = {};
  FA_TYPES.forEach(function (t) { by[t.k] = { n: 0, val: 0, oh: 0, cap: 0, exp: 0, nCap: 0, nExp: 0 }; });
  var actItems = FA.items.filter(faIsActive);
  actItems.forEach(function (it) {
    var b = by[it.asset_type]; if (!b) return;
    b.n++; b.val += it._a.val; b.oh += it._a.onhandVal;
    if (it.asset_type === 'REPAIRS_MAINTENANCE') {
      if (it.asset_treatment === 'CAPITAL') { b.cap += it._a.val; b.nCap++; } else { b.exp += it._a.val; b.nExp++; }
    }
    if (faIsCounted(it)) { tot += it._a.val; cnt++; } else exp += it._a.val;
  });
  document.getElementById('faKpiTotal').textContent = faPeso(tot);
  document.getElementById('faKpiTotalSub').textContent = 'Acquired via MRR · ' + rg.label;
  document.getElementById('faKpiItems').textContent = actItems.length.toLocaleString();
  document.getElementById('faKpiItemsSub').textContent = cnt.toLocaleString() + ' counted as assets';
  document.getElementById('faKpiExp').textContent = faPeso(exp);

  var counted = actItems.filter(faIsCounted).length;
  document.getElementById('faSummary').innerHTML = actItems.length
    ? '<i class="bi bi-building-gear"></i><div><b>' + faPeso(tot) + '</b> in fixed assets acquired (' + rg.label.toLowerCase() + ') across <b>' + counted + '</b> items. ' +
      'These are kept out of the warehouse Inventory Value.<span class="sub">' + (exp > 0 ? faPeso(exp) + ' of minor Repairs and Maintenance is expensed, not counted as an asset.' : 'Repairs and Maintenance is counted only when tagged Capital.') + '</span></div>'
    : '<i class="bi bi-info-circle"></i><div><b>No items tagged yet.</b><span class="sub">Use “Tag Items” to mark which items are fixed assets and what type they are.</span></div>';

  document.getElementById('faTypes').innerHTML = FA_TYPES.map(function (t) {
    var b = by[t.k], rm = t.k === 'REPAIRS_MAINTENANCE';
    var shown = rm ? b.cap : b.val;
    return '<div class="fa-type' + (FA.type === t.k ? ' on' : '') + '" style="--c:' + t.c + '" onclick="faPickType(\'' + t.k + '\')">' +
      '<div class="h"><i class="bi ' + t.i + '"></i>' + t.t + '</div>' +
      '<div class="v">' + faPeso(shown) + '</div>' +
      '<div class="s"><b>' + b.n + '</b> item' + (b.n === 1 ? '' : 's') + ' · on-hand value ' + faPeso(b.oh) + '</div>' +
      (rm ? '<div class="split"><span class="cap"><b>Capital</b><br>' + faPeso(b.cap) + ' · ' + b.nCap + '</span><span class="exp"><b>Expense</b><br>' + faPeso(b.exp) + ' · ' + b.nExp + '</span></div>' : '') +
      '</div>';
  }).join('');
}

function faPickType(k) { FA.type = (FA.type === k ? '' : k); document.getElementById('faTypeSel').value = FA.type; faApply(); }
function faSetTypeFromSelect() { FA.type = document.getElementById('faTypeSel').value; faApply(); }
function faOnSearch() { clearTimeout(FA.timer); FA.timer = setTimeout(faApply, 150); }
function faClear() { document.getElementById('faSearch').value = ''; document.getElementById('faRecvOnly').checked = false; document.getElementById('faShowInactive').checked = false; FA.type = ''; document.getElementById('faTypeSel').value = ''; faApply(); }

function faBadge(it) {
  var t = FA_BY[it.asset_type]; if (!t) return '';
  var tre = it.asset_type === 'REPAIRS_MAINTENANCE'
    ? (it.asset_treatment === 'CAPITAL' ? '<span class="fa-tre cap">CAPITAL</span>' : '<span class="fa-tre exp">EXPENSE</span>') : '';
  return '<span class="fa-badge" style="--c:' + t.c + '">' + t.t + '</span>' + tre;
}

function faRenderTable() {
  var body = document.getElementById('faBody'), canEdit = faCan(FA_EDIT_ROLES);
  document.getElementById('faCount').textContent = FA.view.length.toLocaleString() + ' of ' + (document.getElementById('faShowInactive').checked ? FA.items.length : FA.items.filter(faIsActive).length).toLocaleString() + ' items';
  document.getElementById('faSubtitle').textContent = 'Highest acquired value first';
  if (!FA.view.length) { body.innerHTML = '<tr><td colspan="12" class="erp-empty text-muted">No fixed asset items match.</td></tr>'; return; }
  var slice = FA.view.slice(0, FA.page * FA.pageSize);
  body.innerHTML = slice.map(function (it, i) {
    var a = it._a;
    return '<tr' + (faIsActive(it) ? '' : ' class="fa-off"') + '>' + faSelCells(it) + '<td>' + (i + 1) + '</td>' +
      '<td><span class="fa-code">' + faEsc(it.item_code) + '</span></td>' +
      '<td>' + faEsc(it.description) + (it.is_active === false ? ' <span class="badge bg-secondary">inactive</span>' : '') + '</td>' +
      '<td>' + faBadge(it) + '</td>' +
      '<td class="text-end">' + faPeso(it.unit_cost) + '</td>' +
      '<td class="text-end">' + faNum(a.qty) + ' <small class="text-muted">' + faEsc(it.base_unit || '') + '</small></td>' +
      '<td class="text-end fw-bold">' + faPeso(a.val) + '</td>' +
      '<td class="text-end">' + faNum(it.on_hand) + '</td>' +
      '<td title="' + faEsc(a.refs.join(', ')) + '">' + (a.last || '—') + '</td>' +
      (canEdit ? '<td class="text-center text-nowrap"><button class="btn btn-sm btn-outline-secondary" title="Change or remove tag" onclick="faEditTag(\'' + faEsc(String(it.item_code).replace(/'/g, '')) + '\')"><i class="bi bi-pencil"></i></button> ' +
        (faIsActive(it)
          ? '<button class="btn btn-sm btn-outline-danger" title="Deactivate item" onclick="faSetActive(\'' + faEsc(String(it.item_code).replace(/'/g, '')) + '\',false)"><i class="bi bi-archive"></i></button>'
          : '<button class="btn btn-sm btn-outline-success" title="Reactivate item" onclick="faSetActive(\'' + faEsc(String(it.item_code).replace(/'/g, '')) + '\',true)"><i class="bi bi-arrow-counterclockwise"></i></button>') + '</td>' : '') +
      '</tr>';
  }).join('') + (FA.view.length > slice.length ? '<tr><td colspan="12" class="fa-pager"><button class="erp-btn-outline-dark" onclick="FA.page++;faRenderTable()">Show more</button></td></tr>' : '');
}

// ═══════════════════════════════════════════════════════════
// TAGGING (writes asset_type / asset_treatment only)
// ═══════════════════════════════════════════════════════════
var FA_MODAL = null, FA_EDITING = null;
function faOpenTagger() {
  FA_EDITING = null;
  document.getElementById('faFind').value = ''; document.getElementById('faFindRes').innerHTML = '<div class="p-3 text-muted small">Type at least 2 letters of the code or description.</div>';
  document.getElementById('faBulkMsg').textContent = ''; document.getElementById('faTagType').disabled = false;
  faTab('one');
  FA_MODAL = bootstrap.Modal.getOrCreateInstance(document.getElementById('faModal')); FA_MODAL.show();
}
function faTab(w) {
  document.getElementById('faTabOne').classList.toggle('active', w === 'one'); document.getElementById('faTabBulk').classList.toggle('active', w === 'bulk');
  document.getElementById('faPaneOne').style.display = w === 'one' ? '' : 'none'; document.getElementById('faPaneBulk').style.display = w === 'bulk' ? '' : 'none';
}
function faTagTypeChanged() {
  var rm = document.getElementById('faTagType').value === 'REPAIRS_MAINTENANCE';
  document.getElementById('faTreatWrap').style.display = rm ? '' : 'none';
  var cap = document.querySelector('#faTagTreat option[value="CAPITAL"]'); if (cap) cap.disabled = !faCan(FA_CAPITAL_ROLES);
}
function faFindDebounced() { clearTimeout(FA.findTimer); FA.findTimer = setTimeout(faFind, 250); }
async function faFind() {
  var q = document.getElementById('faFind').value.trim().replace(/[*,()%]/g, ' ').trim(), box = document.getElementById('faFindRes');
  if (q.length < 2) { box.innerHTML = '<div class="p-3 text-muted small">Type at least 2 letters of the code or description.</div>'; return; }
  box.innerHTML = '<div class="p-3"><div class="erp-spinner" style="margin:0"></div></div>';
  try {
    var enc = encodeURIComponent(q);
    var rows = await erpFetch('erp_items', 'select=item_code,description,category,base_unit,asset_type&is_deleted=eq.false&or=(item_code.ilike.*' + enc + '*,description.ilike.*' + enc + '*)&order=item_code.asc&limit=30');
    if (!rows || !rows.length) { box.innerHTML = '<div class="p-3 text-muted small">No items found.</div>'; return; }
    box.innerHTML = rows.map(function (r) {
      var code = String(r.item_code).replace(/'/g, '');
      return '<div class="row-it"><span class="fa-code">' + faEsc(r.item_code) + '</span><div class="d">' + faEsc(r.description) + '<small>' + faEsc(r.category || '') + '</small></div>' +
        (r.asset_type ? '<span class="fa-badge" style="--c:' + (FA_BY[r.asset_type] || {}).c + '">' + faEsc((FA_BY[r.asset_type] || {}).t || r.asset_type) + '</span>' : '') +
        '<button class="btn btn-sm btn-primary" onclick="faTagOne(\'' + faEsc(code) + '\')">' + (r.asset_type ? 'Re-tag' : 'Tag') + '</button></div>';
    }).join('');
  } catch (e) { box.innerHTML = '<div class="p-3 text-danger small">Search failed: ' + faEsc(e.message) + '</div>'; }
}

function faCurrentTag() {
  var type = document.getElementById('faTagType').value;
  var treat = type === 'REPAIRS_MAINTENANCE' ? document.getElementById('faTagTreat').value : null;
  if (treat === 'CAPITAL' && !faCan(FA_CAPITAL_ROLES)) { faToast('Only authorized users can set Capital.'); return null; }
  return { asset_type: type, asset_treatment: treat };
}
async function faPatch(filter, tag) {
  var res = await fetch(erpUrl('erp_items?' + filter), {
    method: 'PATCH', headers: erpHeaders(),
    body: JSON.stringify({ asset_type: tag.asset_type, asset_treatment: tag.asset_treatment, updated_at: new Date().toISOString(), updated_by: faUser() })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return await res.json();
}
async function faTagOne(code) {
  var tag = faCurrentTag(); if (!tag) return;
  try { await faPatch('item_code=eq.' + encodeURIComponent(code), tag); faToast(code + ' tagged as ' + FA_BY[tag.asset_type].t); faFind(); await faLoad(); }
  catch (e) { faToast('Failed: ' + e.message); }
}
async function faBulkApply() {
  var tag = faCurrentTag(); if (!tag) return;
  var codes = document.getElementById('faBulkCodes').value.split(/[\s,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  codes = codes.filter(function (c, i) { return codes.indexOf(c) === i; });
  var msg = document.getElementById('faBulkMsg');
  if (!codes.length) { msg.textContent = 'Paste at least one item code.'; return; }
  var done = 0, found = {};
  try {
    for (var s = 0; s < codes.length; s += 60) {
      var chunk = codes.slice(s, s + 60).map(function (c) { return '"' + c.replace(/"/g, '') + '"'; }).join(',');
      var rows = await faPatch('item_code=in.(' + encodeURIComponent(chunk) + ')&is_deleted=eq.false', tag);
      rows.forEach(function (r) { found[r.item_code] = 1; done++; });
    }
    var missing = codes.filter(function (c) { return !found[c]; });
    msg.className = 'small mt-2 ' + (missing.length ? 'text-warning' : 'text-success');
    msg.textContent = done + ' item(s) tagged as ' + FA_BY[tag.asset_type].t + (missing.length ? '. Not found: ' + missing.slice(0, 15).join(', ') + (missing.length > 15 ? '…' : '') : '.');
    await faLoad();
  } catch (e) { msg.className = 'small mt-2 text-danger'; msg.textContent = 'Failed: ' + e.message; }
}

// ═══════════════════════════════════════════════════════════
// SELECT ITEMS + QTY  →  Manual MRIF (issuance)
// Only passes code / description / unit / qty to the MRIF form via sessionStorage.
// Nothing is issued here — the MRIF is still created and processed the normal way.
// ═══════════════════════════════════════════════════════════
function faSelCells(it) {
  if (!faCan(FA_MRIF_ROLES)) return '<td class="fa-sel-col" style="display:none"></td><td class="fa-sel-col" style="display:none"></td>';
  var code = String(it.item_code), key = faEsc(code.replace(/'/g, '').replace(/"/g, ''));
  var oh = Number(it.on_hand || 0), ok = faIsActive(it) && oh > 0, on = FA.sel[code] != null;
  return '<td class="text-center fa-sel-col"><input type="checkbox" class="form-check-input" ' + (ok ? '' : 'disabled title="' + (oh > 0 ? 'Inactive' : 'No stock on hand') + '"') +
    (on ? ' checked' : '') + ' data-code="' + key + '" onchange="faSelToggle(this)"></td>' +
    '<td class="text-end fa-sel-col"><input type="number" class="form-control form-control-sm fa-qty" min="0.01" max="' + oh + '" step="any" ' +
    'value="' + (on ? FA.sel[code] : '') + '" placeholder="' + (ok ? 'max ' + faNum(oh) : '') + '" ' + (on ? '' : 'disabled') + ' data-code="' + key + '" oninput="faSelQty(this)"></td>';
}
function faItemByCode(code) { return FA.items.filter(function (x) { return String(x.item_code).replace(/['"]/g, '') === code; })[0]; }
function faSelToggle(cb) {
  var code = cb.getAttribute('data-code'), it = faItemByCode(code); if (!it) return;
  var q = cb.closest('tr').querySelector('.fa-qty');
  if (cb.checked) { FA.sel[it.item_code] = 1; q.disabled = false; q.value = 1; q.focus(); q.select(); }
  else { delete FA.sel[it.item_code]; q.disabled = true; q.value = ''; }
  faSelBar();
}
function faSelQty(inp) {
  var it = faItemByCode(inp.getAttribute('data-code')); if (!it) return;
  var v = parseFloat(inp.value), max = Number(it.on_hand || 0);
  inp.classList.toggle('is-invalid', !(v > 0) || v > max);
  FA.sel[it.item_code] = isNaN(v) ? 0 : v;
  faSelBar();
}
function faSelBar() {
  var n = Object.keys(FA.sel).length;
  document.getElementById('faSelCount').textContent = n;
  document.getElementById('faSelBar').style.display = n ? '' : 'none';
}
function faSelClear() { FA.sel = {}; faRenderTable(); faSelBar(); }
function faGoMrif() {
  var out = [], bad = [];
  Object.keys(FA.sel).forEach(function (code) {
    var it = FA.items.filter(function (x) { return x.item_code === code; })[0]; if (!it) return;
    var q = Number(FA.sel[code]), max = Number(it.on_hand || 0);
    if (!(q > 0)) { bad.push(code + ': enter a quantity'); return; }
    if (q > max) { bad.push(code + ': only ' + faNum(max) + ' on hand'); return; }
    out.push({ code: it.item_code, description: it.description || '', qty: q, unit: it.base_unit || 'PIECE', remarks: 'Fixed asset' });
  });
  if (bad.length) { faToast('Fix quantity — ' + bad[0] + (bad.length > 1 ? ' (+' + (bad.length - 1) + ' more)' : '')); return; }
  if (!out.length) { faToast('Select at least one item.'); return; }
  try { sessionStorage.setItem('erp_mrif_prefill', JSON.stringify({ source: 'Fixed Assets', items: out, ts: Date.now() })); }
  catch (e) { faToast('Could not pass the items: ' + e.message); return; }
  location.href = 'new-mrif-manual.html';
}

// Deactivate / reactivate (is_active only — nothing is deleted; fully reversible)
async function faSetActive(code, active) {
  var it = FA.items.filter(function (x) { return x.item_code === code; })[0]; if (!it) return;
  var msg = active
    ? 'Reactivate ' + code + ' — ' + (it.description || '') + '?\n\nIt will count in Fixed Assets again.'
    : 'Deactivate ' + code + ' — ' + (it.description || '') + '?\n\n' +
      (Number(it.on_hand || 0) > 0 ? '⚠ It still has ' + faNum(it.on_hand) + ' ' + (it.base_unit || '') + ' on hand.\n\n' : '') +
      'It will be removed from the Fixed Assets totals and hidden from this list. You can bring it back with "Show deactivated items" → Reactivate.';
  if (!confirm(msg)) return;
  try {
    var res = await fetch(erpUrl('erp_items?item_code=eq.' + encodeURIComponent(code)), {
      method: 'PATCH', headers: erpHeaders(),
      body: JSON.stringify({ is_active: !!active, updated_at: new Date().toISOString(), updated_by: faUser() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    faToast(code + (active ? ' reactivated' : ' deactivated'));
    await faLoad();
  } catch (e) { faToast('Failed: ' + e.message); }
}

// Edit / remove the tag of an item already in the list
function faEditTag(code) {
  var it = FA.items.filter(function (x) { return x.item_code === code; })[0]; if (!it) return;
  var types = FA_TYPES.map(function (t, i) { return (i + 1) + ' = ' + t.t; }).join('\n');
  var cur = FA_TYPES.map(function (t) { return t.k; }).indexOf(it.asset_type) + 1;
  var ans = prompt(code + ' — ' + (it.description || '') + '\n\nType the number of the new asset type, or 0 to REMOVE the fixed-asset tag (item goes back to normal inventory):\n\n' + types + '\n0 = Remove tag', cur);
  if (ans === null) return;
  ans = parseInt(ans, 10);
  if (isNaN(ans) || ans < 0 || ans > FA_TYPES.length) { faToast('Invalid choice.'); return; }
  var tag = { asset_type: null, asset_treatment: null };
  if (ans > 0) {
    tag.asset_type = FA_TYPES[ans - 1].k;
    if (tag.asset_type === 'REPAIRS_MAINTENANCE') {
      var capOk = faCan(FA_CAPITAL_ROLES);
      var isCap = capOk && confirm('Repairs and Maintenance:\n\nOK = CAPITAL (major repair / adds to useful life — counted as a fixed asset)\nCancel = EXPENSE (minor repair — not counted)');
      tag.asset_treatment = isCap ? 'CAPITAL' : 'EXPENSE';
    }
  }
  faPatch('item_code=eq.' + encodeURIComponent(code), tag)
    .then(function () { faToast(ans === 0 ? code + ' removed from fixed assets' : code + ' updated'); return faLoad(); })
    .catch(function (e) { faToast('Failed: ' + e.message); });
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function faExport() {
  var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var rows = [['Item Code', 'Description', 'Asset Type', 'Treatment', 'Counted as Asset', 'Unit', 'Unit Cost', 'Received Qty', 'Acquired Value', 'On-Hand', 'Last MRR']];
  FA.view.forEach(function (it) {
    rows.push([it.item_code, it.description, (FA_BY[it.asset_type] || {}).t || it.asset_type, it.asset_treatment || '', faIsCounted(it) ? 'Yes' : 'No',
      it.base_unit, it.unit_cost, it._a.qty, it._a.val.toFixed(2), it.on_hand, it._a.last]);
  });
  var blob = new Blob(['\ufeff' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fixed-assets-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
