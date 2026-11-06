// ============================================================
// GEMCOR ERP — MRR Edit + Void
// v1.0 — Hiwalay sa warehouse-edit.js (na para sa MRIF/MRS).
// Lahat ng pagbabago sa stock/SOF ay ginagawa ng database
// (RPC: erp_edit_mrr, erp_void_mrr) para all-or-nothing.
// Requires: sql/mrr_edit_void.sql
// ============================================================

// Style ng CANCELLED badge (kapareho ng ibang status badge)
(function() {
  var st = document.createElement('style');
  st.textContent =
    'body .status-cancelled{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;' +
    'font-size:.75rem;font-weight:700;background:#fef2f2;color:#b91c1c;}' +
    'body .status-cancelled::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;}';
  document.head.appendChild(st);
})();

var _mrrEd = { docNo: null, doc: null, items: [], busy: false, catalog: null, catLoading: null };

function _mrrEdToast(msg, type) {
  if (typeof erpShowToast === 'function') erpShowToast(msg, type || 'info');
  else if (typeof erpPrintShowToast === 'function') erpPrintShowToast(msg);
  else alert(msg);
}

function _mrrEdUser() {
  return localStorage.getItem('ivm_userFullname') ||
         localStorage.getItem('ivm_username') || 'WAREHOUSE';
}

function _mrrEdIsWarehouse() {
  return (localStorage.getItem('ivm_userRole') || '') === 'warehouse';
}

async function _mrrEdRpc(name, body) {
  var res = await fetch(erpUrl('rpc/' + name), {
    method: 'POST',
    headers: erpHeaders(),
    body: JSON.stringify(body)
  });
  var text = await res.text();
  var data = null;
  try { data = JSON.parse(text); } catch (e) {}
  if (!res.ok) {
    throw new Error((data && (data.message || data.error)) || ('HTTP ' + res.status + ' ' + text.substring(0, 200)));
  }
  return data;
}

// Gawing malinaw ang error mula sa database
function _mrrEdFriendly(err) {
  var m = String(err || '');
  if (m.indexOf('Insufficient stock') !== -1) {
    var item = (m.match(/item (\S+?)\./) || [])[1] || '';
    var cur = (m.match(/Current: ([\d.]+)/) || [])[1];
    var att = (m.match(/Attempted: (-?[\d.]+)/) || [])[1];
    return 'Kulang na ang stock ng ' + item + ' para ma-baligtad ito.\n' +
           'On-hand ngayon: ' + Number(cur || 0) + '\n' +
           'Kailangang ibawas: ' + Math.abs(Number(att || 0)) + '\n' +
           '(Malamang nagamit na ang natanggap na stock.)';
  }
  return m;
}

function _mrrEdEnsureModal() {
  var el = document.getElementById('mrrEditModal');
  if (el) return el;
  var html =
    '<div class="modal fade" id="mrrEditModal" tabindex="-1" data-bs-backdrop="static">' +
      '<div class="modal-dialog modal-xl modal-dialog-scrollable" style="max-width:1100px;">' +
        '<div class="modal-content">' +
          '<div class="modal-header erp-modal-header">' +
            '<h5 class="modal-title"><i class="bi bi-pencil-square me-2"></i>' +
              '<span id="mrrEdTitle">Edit MRR</span></h5>' +
            '<button type="button" class="btn-close btn-close-white" onclick="mrrEdClose()"></button>' +
          '</div>' +
          '<div class="modal-body" id="mrrEdBody"></div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline-secondary" onclick="mrrEdClose()">Cancel</button>' +
            '<button type="button" class="btn btn-primary" id="mrrEdSaveBtn" onclick="mrrEdSave()">' +
              '<i class="bi bi-check-circle me-1"></i>Save Changes</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  var w = document.createElement('div');
  w.innerHTML = html;
  document.body.appendChild(w.firstChild);
  return document.getElementById('mrrEditModal');
}

function mrrEdClose() {
  var el = document.getElementById('mrrEditModal');
  if (el) bootstrap.Modal.getOrCreateInstance(el).hide();
}

// ═══════════════════════════════════════════════════════════
// EDIT
// ═══════════════════════════════════════════════════════════
async function openMrrEdit(docNo) {
  if (!_mrrEdIsWarehouse()) { _mrrEdToast('Warehouse lang ang puwedeng mag-edit ng MRR', 'warning'); return; }
  _mrrEd.docNo = docNo;
  _mrrEd.busy = false;

  var el = _mrrEdEnsureModal();
  document.getElementById('mrrEdTitle').textContent = 'Edit ' + docNo;
  document.getElementById('mrrEdBody').innerHTML =
    '<div class="text-center py-5"><div class="erp-spinner" style="margin:0 auto;"></div>' +
    '<div class="mt-2 text-muted">Loading...</div></div>';
  bootstrap.Modal.getOrCreateInstance(el).show();

  try {
    var docs = await erpFetch('documents',
      'select=*&doc_type=eq.MRR&doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    if (!docs || !docs.length) throw new Error('MRR not found');
    var doc = docs[0];
    var st = String(doc.status || '').toUpperCase();
    if (st === 'CANCELLED') throw new Error(docNo + ' ay CANCELLED na at hindi na puwedeng i-edit.');
    if (doc.is_transmitted) throw new Error(docNo + ' ay na-transmit na (' + (doc.transmittal_no || '') + ').');

    var items = await erpFetch('doc_items',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');

    _mrrEd.doc = doc;
    _mrrEd.items = (items || []).map(function(it) {
      var row = {
        id: it.id, lineNo: it.line_no, itemCode: it.item_code || '',
        description: it.description || '', unit: it.unit || '',
        reqQty: Number(it.requested_qty || 0), recvQty: Number(it.issued_qty || 0),
        isNew: false, deleted: false
      };
      row.orig = { itemCode: row.itemCode, description: row.description, unit: row.unit, reqQty: row.reqQty, recvQty: row.recvQty };
      return row;
    });
    _mrrEdLoadCatalog();   // i-preload ang item suggestions + units
    if (window.ErpUom) { try { await ErpUom.load(); } catch (e) {} }
    _mrrEdRender();
  } catch (err) {
    mrrEdClose();
    _mrrEdToast(err.message, 'danger');
  }
}

function _mrrEdRender() {
  var d = _mrrEd.doc;
  var fld = function(id, label, val, type) {
    return '<div class="col-md-4"><label class="form-label small fw-bold">' + label + '</label>' +
      '<input type="' + (type || 'text') + '" class="form-control form-control-sm" id="' + id + '" value="' +
      erpEsc(val || '') + '"></div>';
  };
  var rd = String(d.receiving_date || '').substring(0, 10);

  var h = '<div class="alert alert-warning py-2 small mb-3">' +
    '<i class="bi bi-info-circle me-1"></i>Lahat ay puwedeng baguhin: <strong>Item Code, Description, Unit, Expected, Received</strong>, ' +
    'at puwede ring <strong>magdagdag</strong> o <strong>magbura</strong> ng line. ' +
    'Ang pagbabago sa <em>natanggap</em> ay ia-adjust sa stock ledger at SOF allocation (pagkakaiba lang). ' +
    'Hindi ito papayagan kung magiging negative ang on-hand o mas mababa sa nagamit na ng SOF.<br>' +
    'Kapag binago ang <strong>SOF No.</strong>, ililipat ang allocation ng natanggap na qty mula sa lumang SOF papunta sa bago.</div>';

  h += '<div class="row g-3 mb-3">' +
    '<div class="col-md-4"><label class="form-label small fw-bold">MRR No.</label>' +
      '<input class="form-control form-control-sm" value="' + erpEsc(d.doc_no) + '" disabled></div>' +
    fld('mrrEdPo', 'PO No.', d.po_no) +
    fld('mrrEdVendor', 'Vendor', d.vendor) +
    fld('mrrEdDr', 'DR No. / S.I. No.', d.dr_no) +
    fld('mrrEdPrf', 'PRF No.', d.prf_no) +
    fld('mrrEdSite', 'Receiving Site', d.receiving_site) +
    fld('mrrEdDate', 'Receiving Date', rd, 'date') +
    fld('mrrEdSof', 'SOF No.', d.sof_no) +
    '<div class="col-12" id="mrrEdHint"></div>' +
    '</div>';

  h += '<div class="table-responsive"><table class="table table-sm table-bordered align-middle mb-2" style="min-width:980px;">' +
    '<thead><tr><th style="width:44px;">#</th><th style="width:190px;">Item Code</th><th>Description</th>' +
    '<th style="width:110px;">Unit</th>' +
    '<th style="width:100px;">Expected</th><th style="width:100px;">Received</th><th style="width:110px;">Change</th>' +
    '<th style="width:48px;"></th></tr></thead><tbody id="mrrEdRows"></tbody></table></div>' +
    '<button type="button" class="btn btn-sm btn-outline-primary" onclick="mrrEdAddRow()">' +
    '<i class="bi bi-plus-circle me-1"></i>Add Item</button>';

  h += '<div class="mt-3"><label class="form-label small fw-bold">Reason for change <span class="text-danger">*</span></label>' +
    '<textarea class="form-control" id="mrrEdReason" rows="2" placeholder="Hal. maling bilang sa DR, na-encode nang mali, nadagdag na item..."></textarea></div>';

  document.getElementById('mrrEdBody').innerHTML = h;
  _mrrEdRenderRows();

  // Auto-format (SOF → 12897, PRF → PRF#26-878) at hint kapag may binago
  var bindFmt = function(id, fn) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', _mrrEdHint);
    el.addEventListener('blur', function() {
      var v = fn(el.value);
      if (v !== el.value) el.value = v;
      _mrrEdHint();
    });
  };
  bindFmt('mrrEdSof', _mrrEdFmtSof);
  bindFmt('mrrEdPrf', _mrrEdFmtPrf);
}

// ─── Mga row ng item ───
function _mrrEdRenderRows() {
  var tb = document.getElementById('mrrEdRows');
  if (!tb) return;
  var h = '';
  var n = 0;
  _mrrEd.items.forEach(function(it, i) {
    var dis = it.deleted ? ' disabled' : '';
    if (!it.deleted) n++;
    h += '<tr id="mrrEdRow' + i + '" class="' + (it.deleted ? 'table-danger' : (it.isNew ? 'table-success' : '')) + '">' +
      '<td class="text-muted small">' + (it.isNew ? '<span class="badge bg-success">NEW</span>' : (it.deleted ? '<s>' + it.lineNo + '</s>' : it.lineNo)) + '</td>' +
      '<td><input type="text" class="form-control form-control-sm mrrEdCode" id="mrrEdCode' + i + '" autocomplete="off" ' +
        'style="font-family:monospace;font-size:.78rem;" value="' + erpEsc(it.itemCode) + '"' + dis + ' ' +
        'oninput="_mrrEdCodeInput(' + i + ')" onfocus="_mrrEdCodeInput(' + i + ')" onblur="_mrrEdCodeBlur()" placeholder="Item code / description"></td>' +
      '<td><input type="text" class="form-control form-control-sm" id="mrrEdDesc' + i + '" value="' + erpEsc(it.description) + '"' + dis + '></td>' +
      '<td><select class="form-select form-select-sm" id="mrrEdUnit' + i + '"' + dis + ' onchange="ErpUom.pick(this)">' +
        (it.unit ? '' : '<option value="" selected>— unit —</option>') +
        (window.ErpUom ? ErpUom.optionsHtml(it.unit) : '<option value="' + erpEsc(it.unit) + '" selected>' + erpEsc(it.unit) + '</option>') +
      '</select></td>' +
      '<td><input type="number" min="0.0001" step="any" class="form-control form-control-sm" id="mrrEdReq' + i + '" value="' + it.reqQty + '"' + dis + '></td>' +
      '<td><input type="number" min="0" step="any" class="form-control form-control-sm" id="mrrEdRecv' + i + '" value="' + it.recvQty + '"' + dis +
        ' oninput="_mrrEdDelta(' + i + ')"></td>' +
      '<td class="text-center small" id="mrrEdDelta' + i + '">—</td>' +
      '<td class="text-center">' +
        (it.deleted
          ? '<button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1" title="Ibalik ang line" onclick="mrrEdRemoveRow(' + i + ')"><i class="bi bi-arrow-counterclockwise"></i></button>'
          : '<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" title="' + (it.isNew ? 'Alisin' : 'Burahin ang line') + '" onclick="mrrEdRemoveRow(' + i + ')"><i class="bi bi-trash"></i></button>') +
      '</td></tr>';
  });
  if (!_mrrEd.items.length) h = '<tr><td colspan="8" class="text-center text-muted py-3">Walang line.</td></tr>';
  tb.innerHTML = h;
  _mrrEd.items.forEach(function(it, i) {
    var sel = document.getElementById('mrrEdUnit' + i);
    if (sel && window.ErpUom && it.unit) ErpUom.setValue(sel, it.unit);
    _mrrEdDelta(i);
  });
}

// Kunin sa state ang laman ng mga input (bago mag-add/delete/render ulit)
function _mrrEdSync() {
  _mrrEd.items.forEach(function(it, i) {
    var g = function(id) { return document.getElementById(id); };
    if (!g('mrrEdCode' + i) || it.deleted) return;
    it.itemCode = g('mrrEdCode' + i).value.trim();
    it.description = g('mrrEdDesc' + i).value;
    var u = g('mrrEdUnit' + i).value;
    it.unit = (u === '__other__') ? it.unit : u;
    it.reqQty = g('mrrEdReq' + i).value;
    it.recvQty = g('mrrEdRecv' + i).value;
  });
}

function mrrEdAddRow() {
  _mrrEdSync();
  _mrrEd.items.push({ id: null, lineNo: '', itemCode: '', description: '', unit: '', reqQty: '', recvQty: '',
                      isNew: true, deleted: false, orig: null });
  _mrrEdRenderRows();
  var last = _mrrEd.items.length - 1;
  var el = document.getElementById('mrrEdCode' + last);
  if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
}

function mrrEdRemoveRow(i) {
  _mrrEdSync();
  var it = _mrrEd.items[i];
  if (!it) return;
  if (it.isNew) { _mrrEd.items.splice(i, 1); }
  else { it.deleted = !it.deleted; }
  _mrrEdRenderRows();
}

// ─── Item auto-suggest (code o description) ───
function _mrrEdLoadCatalog() {
  if (_mrrEd.catalog) return Promise.resolve(_mrrEd.catalog);
  if (_mrrEd.catLoading) return _mrrEd.catLoading;
  if (typeof erpGetInventoryListForDropdown !== 'function') return Promise.resolve([]);
  _mrrEd.catLoading = erpGetInventoryListForDropdown().then(function(list) {
    _mrrEd.catalog = (list || []).map(function(r) {
      return { code: String(r.code || ''), description: String(r.description || ''), unit: String(r.unit || r.base_unit || ''),
               _k: (String(r.code || '') + ' ' + String(r.description || '')).toLowerCase() };
    });
    _mrrEd.catLoading = null;
    return _mrrEd.catalog;
  }).catch(function(err) {
    console.warn('[MRR Edit] inventory load failed', err && err.message);
    _mrrEd.catLoading = null;
    return [];
  });
  return _mrrEd.catLoading;
}

var _mrrAc = { box: null, idx: -1, matches: [] };

function _mrrEdAcBox() {
  if (_mrrAc.box && document.body.contains(_mrrAc.box)) return _mrrAc.box;
  var b = document.createElement('div');
  b.style.cssText = 'position:fixed;z-index:3000;background:#fff;border:1px solid #cbd5e1;border-radius:8px;' +
    'box-shadow:0 10px 30px rgba(15,23,42,.25);max-height:260px;overflow:auto;display:none;font-size:.8rem;';
  b.addEventListener('mousedown', function(e) {
    var row = e.target.closest('[data-i]');
    if (row) { e.preventDefault(); _mrrEdAcPick(parseInt(row.getAttribute('data-i'), 10)); }
  });
  document.body.appendChild(b);
  _mrrAc.box = b;
  return b;
}

function _mrrEdCodeInput(i) {
  var inp = document.getElementById('mrrEdCode' + i);
  if (!inp) return;
  _mrrAc.row = i;
  var q = inp.value.trim().toLowerCase();
  var b = _mrrEdAcBox();
  if (!q || !_mrrEd.catalog) { b.style.display = 'none'; if (!_mrrEd.catalog) _mrrEdLoadCatalog(); return; }
  var tokens = q.split(/\s+/), out = [];
  for (var k = 0; k < _mrrEd.catalog.length; k++) {
    var it = _mrrEd.catalog[k], ok = true;
    for (var t = 0; t < tokens.length; t++) { if (it._k.indexOf(tokens[t]) === -1) { ok = false; break; } }
    if (!ok) continue;
    var c = it.code.toLowerCase();
    out.push({ it: it, rank: c === q ? 0 : (c.indexOf(q) === 0 ? 1 : (c.indexOf(q) > -1 ? 2 : 3)) });
  }
  out.sort(function(a, b2) { return a.rank - b2.rank || a.it.code.localeCompare(b2.it.code); });
  _mrrAc.matches = out.slice(0, 30).map(function(o) { return o.it; });
  if (!_mrrAc.matches.length) {
    b.innerHTML = '<div class="p-2 text-muted">Walang nakitang item sa inventory</div>';
  } else {
    b.innerHTML = _mrrAc.matches.map(function(it, n) {
      return '<div data-i="' + n + '" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid #eef2f7;" ' +
        'onmouseover="this.style.background=\'#eaf1ff\'" onmouseout="this.style.background=\'\'">' +
        '<code style="font-size:.74rem;">' + erpEsc(it.code) + '</code> <span class="text-muted">' + erpEsc(it.unit) + '</span><br>' +
        '<span>' + erpEsc(it.description) + '</span></div>';
    }).join('');
  }
  var r = inp.getBoundingClientRect();
  b.style.left = r.left + 'px';
  b.style.top = (r.bottom + 2) + 'px';
  b.style.width = Math.max(r.width, 380) + 'px';
  b.style.display = 'block';
}

function _mrrEdAcPick(n) {
  var it = _mrrAc.matches[n], i = _mrrAc.row;
  if (!it || i == null) return;
  document.getElementById('mrrEdCode' + i).value = it.code;
  document.getElementById('mrrEdDesc' + i).value = it.description;
  var sel = document.getElementById('mrrEdUnit' + i);
  if (sel && window.ErpUom && it.unit) ErpUom.setValue(sel, it.unit);
  _mrrEdAcBox().style.display = 'none';
  _mrrEdDelta(i);
  var rq = document.getElementById('mrrEdReq' + i);
  if (rq) rq.focus();
}

function _mrrEdCodeBlur() {
  setTimeout(function() { if (_mrrAc.box) _mrrAc.box.style.display = 'none'; }, 150);
}

// ─── SOF / PRF normalization (gamit ang erp-docno-format.js kung naka-load) ───
function _mrrEdFmtSof(v) { return typeof window.erpFmtSof === 'function' ? window.erpFmtSof(v) : String(v || '').trim(); }
function _mrrEdFmtPrf(v) { return typeof window.erpFmtPrfList === 'function' ? window.erpFmtPrfList(v) : String(v || '').trim(); }

// Ibalik ang ORIGINAL kung pareho lang ang normalized form (para hindi magmukhang "binago" ang SOF/PRF
// na iba lang ang pagkaka-type, hal. "SOF#18333" vs "18333" — iiwas sa maling paglipat ng allocation).
function _mrrEdResolve(inputId, fmt, original) {
  var typed = fmt(document.getElementById(inputId).value);
  var orig = String(original || '');
  return typed === fmt(orig) ? orig : typed;
}

function _mrrEdHint() {
  var el = document.getElementById('mrrEdHint');
  if (!el || !_mrrEd.doc) return;
  var d = _mrrEd.doc, html = '';
  var sofNew = _mrrEdResolve('mrrEdSof', _mrrEdFmtSof, d.sof_no);
  var prfNew = _mrrEdResolve('mrrEdPrf', _mrrEdFmtPrf, d.prf_no);
  if (sofNew !== String(d.sof_no || '')) {
    html += '<div class="alert alert-info py-2 small mb-1"><i class="bi bi-arrow-left-right me-1"></i>' +
      '<strong>SOF:</strong> ' + erpEsc(d.sof_no || '—') + ' → <strong>' + erpEsc(sofNew || '—') + '</strong>. ' +
      'Ililipat ang allocation ng natanggap na qty ng bawat line. ' +
      'Hindi ito papayagan kung nagamit na ng MRIF ang allocation ng lumang SOF.</div>';
  }
  if (prfNew !== String(d.prf_no || '')) {
    html += '<div class="alert alert-info py-2 small mb-1"><i class="bi bi-arrow-repeat me-1"></i>' +
      '<strong>PRF:</strong> ' + erpEsc(d.prf_no || '—') + ' → <strong>' + erpEsc(prfNew || '—') + '</strong>. ' +
      'Awtomatikong ire-recompute ang status ng <em>lumang</em> at <em>bagong</em> PRF sa PRF Monitor ' +
      '(maliban sa mga line na manual ang status 🔒).</div>';
  }
  el.innerHTML = html;
}

function _mrrEdDelta(i) {
  var it = _mrrEd.items[i];
  var cell = document.getElementById('mrrEdDelta' + i);
  if (!it || !cell) return;
  var fmt = function(d) {
    return d > 0 ? '<span class="text-success fw-bold">+' + d + '</span>'
                 : '<span class="text-danger fw-bold">' + d + '</span>';
  };
  if (it.deleted) { cell.innerHTML = it.orig && it.orig.recvQty ? fmt(-it.orig.recvQty) + ' <small>(burado)</small>' : '<span class="text-danger small">burado</span>'; return; }
  var rEl = document.getElementById('mrrEdRecv' + i);
  var v = Number(rEl ? rEl.value : it.recvQty);
  if (isNaN(v)) { cell.textContent = '—'; return; }
  if (it.isNew) { cell.innerHTML = v > 0 ? fmt(v) + ' <small>(bago)</small>' : '<span class="text-success small">bago</span>'; return; }
  var cEl = document.getElementById('mrrEdCode' + i);
  var code = cEl ? cEl.value.trim() : it.itemCode;
  if (code && code.toUpperCase() !== String(it.orig.itemCode).toUpperCase()) {
    cell.innerHTML = '<span class="text-primary small fw-bold">item ↔</span>';
    return;
  }
  var delta = Math.round((v - it.orig.recvQty) * 10000) / 10000;
  cell.innerHTML = delta === 0 ? '<span class="text-muted">—</span>' : fmt(delta);
}

async function mrrEdSave() {
  if (_mrrEd.busy) return;
  var d = _mrrEd.doc;
  var reason = (document.getElementById('mrrEdReason').value || '').trim();
  if (!reason) { _mrrEdToast('Reason for change is required', 'warning'); document.getElementById('mrrEdReason').focus(); return; }

  _mrrEdSync();
  var catalogCodes = null;
  if (_mrrEd.catalog && _mrrEd.catalog.length) {
    catalogCodes = {};
    _mrrEd.catalog.forEach(function(c) { catalogCodes[c.code.toUpperCase()] = true; });
  }

  var items = [], newItems = [], deletedIds = [];
  var changedItemLines = 0, stockLines = 0, active = 0;
  for (var i = 0; i < _mrrEd.items.length; i++) {
    var it = _mrrEd.items[i];
    var label = it.isNew ? ('Bagong line ' + (i + 1)) : ('Line ' + it.lineNo);
    if (it.deleted) {
      deletedIds.push(it.id);
      if (it.orig.recvQty > 0) stockLines++;
      continue;
    }
    active++;
    var code = String(it.itemCode || '').trim();
    var recv = Number(it.recvQty), req = Number(it.reqQty);
    if (!code) { _mrrEdToast(label + ': kailangan ang Item Code', 'warning'); return; }
    // Suriin sa inventory ang BAGO o PINALITANG code lang (ang lumang line na hindi ginalaw ay hindi na sinusuri)
    var codeIsNewOrChanged = it.isNew || code.toUpperCase() !== String(it.orig.itemCode).toUpperCase();
    if (codeIsNewOrChanged && catalogCodes && !catalogCodes[code.toUpperCase()]) { _mrrEdToast(label + ': "' + code + '" ay wala sa inventory. Pumili sa listahan.', 'warning'); return; }
    if (it.recvQty === '' || isNaN(recv) || recv < 0) { _mrrEdToast(label + ': invalid Received qty', 'warning'); return; }
    if (it.reqQty === '' || isNaN(req) || req <= 0) { _mrrEdToast(label + ': Expected qty must be greater than 0', 'warning'); return; }

    if (!it.unit && catalogCodes) {   // walang napiling unit → kunin sa inventory
      var hit = _mrrEd.catalog.filter(function(c) { return c.code.toUpperCase() === code.toUpperCase(); })[0];
      if (hit) it.unit = hit.unit;
    }
    if (it.isNew && !it.unit) { _mrrEdToast(label + ': piliin ang Unit', 'warning'); return; }
    if (it.isNew) {
      newItems.push({ item_code: code, description: it.description, unit: it.unit, requested_qty: req, received_qty: recv });
      if (recv > 0) stockLines++;
    } else {
      var o = it.orig;
      var codeChanged = code.toUpperCase() !== String(o.itemCode).toUpperCase();
      var meta = String(it.description) !== String(o.description) || String(it.unit) !== String(o.unit);
      if (codeChanged) { changedItemLines++; if (o.recvQty > 0 || recv > 0) stockLines++; }
      else if (recv !== o.recvQty) stockLines++;
      if (codeChanged || meta || recv !== o.recvQty || req !== o.reqQty) {
        items.push({ id: it.id, item_code: code, description: it.description, unit: it.unit, received_qty: recv, requested_qty: req });
      }
    }
  }
  if (active === 0) { _mrrEdToast('Hindi puwedeng walang item ang MRR. Gamitin ang Void para i-cancel ang buong MRR.', 'warning'); return; }

  var header = {
    po_no: document.getElementById('mrrEdPo').value.trim(),
    vendor: document.getElementById('mrrEdVendor').value.trim(),
    dr_no: document.getElementById('mrrEdDr').value.trim(),
    prf_no: _mrrEdResolve('mrrEdPrf', _mrrEdFmtPrf, d.prf_no),
    sof_no: _mrrEdResolve('mrrEdSof', _mrrEdFmtSof, d.sof_no),
    receiving_site: document.getElementById('mrrEdSite').value.trim(),
    receiving_date: document.getElementById('mrrEdDate').value
  };

  var msg = 'I-save ang pagbabago sa ' + _mrrEd.docNo + '?';
  if (newItems.length) msg += '\n\n+ ' + newItems.length + ' bagong line';
  if (deletedIds.length) msg += '\n- ' + deletedIds.length + ' line na buburahin';
  if (changedItemLines) msg += '\n↔ ' + changedItemLines + ' line na pinalitan ang item';
  if (stockLines > 0) msg += '\n\n' + stockLines + ' line(s) ang magbabago ng stock at SOF allocation.';
  if (header.sof_no !== String(d.sof_no || '')) {
    msg += '\n\nSOF: ' + (d.sof_no || '—') + ' → ' + (header.sof_no || '—') +
           '\nIlilipat ang SOF allocation ng natanggap na qty.';
  }
  if (header.prf_no !== String(d.prf_no || '')) {
    msg += '\n\nPRF: ' + (d.prf_no || '—') + ' → ' + (header.prf_no || '—') +
           '\n(Awtomatikong ire-recompute ang PRF status ng luma at bago.)';
  }
  if (!confirm(msg)) return;

  _mrrEd.busy = true;
  var btn = document.getElementById('mrrEdSaveBtn');
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

  try {
    var structural = newItems.length || deletedIds.length || changedItemLines ||
      items.some(function(x) { var o = _mrrEd.items.filter(function(y) { return y.id === x.id; })[0];
        return o && (String(x.description) !== String(o.orig.description) || String(x.unit) !== String(o.orig.unit)); });
    var res;
    try {
      res = await _mrrEdRpc('erp_edit_mrr_v2', {
        p_doc_no: _mrrEd.docNo, p_header: header, p_items: items,
        p_new_items: newItems, p_deleted_ids: deletedIds,
        p_reason: reason, p_user: _mrrEdUser()
      });
    } catch (e1) {
      // Wala pa ang v2 sa database → gamitin ang lumang function kung qty/header lang ang binago
      if (/erp_edit_mrr_v2|Could not find the function|PGRST202/i.test(String(e1.message))) {
        if (structural) throw new Error('Hindi pa naka-install ang bagong function sa database.\nI-run muna ang erp-mrr-edit-v2.sql sa Supabase, tapos subukan ulit.');
        res = await _mrrEdRpc('erp_edit_mrr', {
          p_doc_no: _mrrEd.docNo, p_header: header,
          p_items: items.map(function(x) { return { id: x.id, received_qty: x.received_qty, requested_qty: x.requested_qty }; }),
          p_reason: reason, p_user: _mrrEdUser()
        });
      } else { throw e1; }
    }
    if (!res || !res.success) throw new Error(_mrrEdFriendly(res && res.error));
    mrrEdClose();
    _mrrEdToast('✅ ' + _mrrEd.docNo + ' updated (' + res.status + ')' +
      (res.line_changes ? ' · ' + res.line_changes + ' line change(s)' : '') +
      (res.sof_lines_moved ? ' · SOF allocation: ' + res.sof_lines_moved + ' line(s) inilipat' : ''), 'success');
    if (typeof mrrListRefresh === 'function') setTimeout(mrrListRefresh, 400);
  } catch (err) {
    _mrrEdToast(err.message, 'danger');
    alert(err.message);
  } finally {
    _mrrEd.busy = false;
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ═══════════════════════════════════════════════════════════
// VOID / CANCEL
// ═══════════════════════════════════════════════════════════
async function mrrVoid(docNo) {
  if (!_mrrEdIsWarehouse()) { _mrrEdToast('Warehouse lang ang puwedeng mag-void ng MRR', 'warning'); return; }
  if (_mrrEd.busy) return;

  var reason = prompt(
    'VOID ' + docNo + '\n\n' +
    'Hindi buburahin ang record. Magiging CANCELLED ito, ibabawas ang natanggap na stock sa ledger, ' +
    'at babawasan ang SOF allocation.\n\nReason (required):');
  if (reason === null) return;
  reason = reason.trim();
  if (!reason) { _mrrEdToast('Reason is required', 'warning'); return; }
  if (!confirm('Sigurado ka bang i-void ang ' + docNo + '?\n\nReason: ' + reason)) return;

  _mrrEd.busy = true;
  try {
    var res = await _mrrEdRpc('erp_void_mrr', { p_doc_no: docNo, p_reason: reason, p_user: _mrrEdUser() });
    if (!res || !res.success) throw new Error(_mrrEdFriendly(res && res.error));
    _mrrEdToast('✅ ' + docNo + ' voided (' + res.lines_reversed + ' line(s) ibinalik sa ledger)', 'success');
    if (typeof mrrListRefresh === 'function') setTimeout(mrrListRefresh, 400);
  } catch (err) {
    _mrrEdToast(err.message, 'danger');
    alert(err.message);
  } finally {
    _mrrEd.busy = false;
  }
}

window.openMrrEdit = openMrrEdit;
window.mrrVoid = mrrVoid;
window.mrrEdSave = mrrEdSave;
window.mrrEdClose = mrrEdClose;
window._mrrEdDelta = _mrrEdDelta;
window.mrrEdAddRow = mrrEdAddRow;
window.mrrEdRemoveRow = mrrEdRemoveRow;
window._mrrEdCodeInput = _mrrEdCodeInput;
window._mrrEdCodeBlur = _mrrEdCodeBlur;
window._mrrEdHint = _mrrEdHint;

console.log('✅ mrr-edit.js v1.2 loaded (add/delete/edit lines + item suggest)');
