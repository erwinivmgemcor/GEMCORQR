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

var _mrrEd = { docNo: null, doc: null, items: [], busy: false };

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
      return {
        id: it.id, lineNo: it.line_no, itemCode: it.item_code,
        description: it.description || '', unit: it.unit || '',
        reqQty: Number(it.requested_qty || 0), recvQty: Number(it.issued_qty || 0)
      };
    });
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
    '<i class="bi bi-info-circle me-1"></i>Kapag binago ang <strong>Received</strong>, ang <em>pagkakaiba lang</em> ' +
    'ang idadagdag o ibabawas sa stock ledger at sa SOF allocation. Hindi ito papayagan kung magiging negative ang on-hand ' +
    'o mas mababa sa nagamit na ng SOF.</div>';

  h += '<div class="row g-3 mb-3">' +
    '<div class="col-md-4"><label class="form-label small fw-bold">MRR No.</label>' +
      '<input class="form-control form-control-sm" value="' + erpEsc(d.doc_no) + '" disabled></div>' +
    fld('mrrEdPo', 'PO No.', d.po_no) +
    fld('mrrEdVendor', 'Vendor', d.vendor) +
    fld('mrrEdDr', 'DR No. / S.I. No.', d.dr_no) +
    fld('mrrEdPrf', 'PRF No.', d.prf_no) +
    fld('mrrEdSite', 'Receiving Site', d.receiving_site) +
    fld('mrrEdDate', 'Receiving Date', rd, 'date') +
    '<div class="col-md-4"><label class="form-label small fw-bold">SOF No. (naka-lock)</label>' +
      '<input class="form-control form-control-sm" value="' + erpEsc(d.sof_no || '—') + '" disabled></div>' +
    '</div>';

  h += '<div class="table-responsive"><table class="table table-sm table-bordered align-middle">' +
    '<thead><tr><th>#</th><th>Item Code</th><th>Description</th><th>Unit</th>' +
    '<th style="width:110px;">Expected</th><th style="width:110px;">Received</th><th style="width:110px;">Change</th>' +
    '</tr></thead><tbody>';
  _mrrEd.items.forEach(function(it, i) {
    h += '<tr>' +
      '<td>' + it.lineNo + '</td>' +
      '<td><code>' + erpEsc(it.itemCode) + '</code></td>' +
      '<td>' + erpEsc(it.description) + '</td>' +
      '<td>' + erpEsc(it.unit) + '</td>' +
      '<td><input type="number" min="0.0001" step="any" class="form-control form-control-sm" ' +
        'id="mrrEdReq' + i + '" value="' + it.reqQty + '" oninput="_mrrEdDelta(' + i + ')"></td>' +
      '<td><input type="number" min="0" step="any" class="form-control form-control-sm" ' +
        'id="mrrEdRecv' + i + '" value="' + it.recvQty + '" oninput="_mrrEdDelta(' + i + ')"></td>' +
      '<td class="text-center" id="mrrEdDelta' + i + '">—</td>' +
      '</tr>';
  });
  h += '</tbody></table></div>';

  h += '<div class="mt-3"><label class="form-label small fw-bold">Reason for change <span class="text-danger">*</span></label>' +
    '<textarea class="form-control" id="mrrEdReason" rows="2" placeholder="Hal. maling bilang sa DR, na-encode nang mali..."></textarea></div>';

  document.getElementById('mrrEdBody').innerHTML = h;
}

function _mrrEdDelta(i) {
  var it = _mrrEd.items[i];
  var v = Number(document.getElementById('mrrEdRecv' + i).value);
  var cell = document.getElementById('mrrEdDelta' + i);
  if (isNaN(v)) { cell.textContent = '—'; return; }
  var delta = Math.round((v - it.recvQty) * 10000) / 10000;
  if (delta === 0) { cell.innerHTML = '<span class="text-muted">—</span>'; return; }
  cell.innerHTML = delta > 0
    ? '<span class="text-success fw-bold">+' + delta + '</span>'
    : '<span class="text-danger fw-bold">' + delta + '</span>';
}

async function mrrEdSave() {
  if (_mrrEd.busy) return;
  var d = _mrrEd.doc;
  var reason = (document.getElementById('mrrEdReason').value || '').trim();
  if (!reason) { _mrrEdToast('Reason for change is required', 'warning'); document.getElementById('mrrEdReason').focus(); return; }

  var items = [];
  for (var i = 0; i < _mrrEd.items.length; i++) {
    var it = _mrrEd.items[i];
    var recv = Number(document.getElementById('mrrEdRecv' + i).value);
    var req = Number(document.getElementById('mrrEdReq' + i).value);
    if (isNaN(recv) || recv < 0) { _mrrEdToast('Line ' + it.lineNo + ': invalid Received qty', 'warning'); return; }
    if (isNaN(req) || req <= 0) { _mrrEdToast('Line ' + it.lineNo + ': Expected qty must be greater than 0', 'warning'); return; }
    if (recv !== it.recvQty || req !== it.reqQty) {
      items.push({ id: it.id, received_qty: recv, requested_qty: req });
    }
  }

  var header = {
    po_no: document.getElementById('mrrEdPo').value.trim(),
    vendor: document.getElementById('mrrEdVendor').value.trim(),
    dr_no: document.getElementById('mrrEdDr').value.trim(),
    prf_no: document.getElementById('mrrEdPrf').value.trim(),
    receiving_site: document.getElementById('mrrEdSite').value.trim(),
    receiving_date: document.getElementById('mrrEdDate').value
  };

  var stockLines = items.filter(function(x) {
    var o = _mrrEd.items.filter(function(y) { return y.id === x.id; })[0];
    return o && x.received_qty !== o.recvQty;
  }).length;
  var msg = 'I-save ang pagbabago sa ' + _mrrEd.docNo + '?';
  if (stockLines > 0) msg += '\n\n' + stockLines + ' line(s) ang magbabago ng stock at SOF allocation.';
  if (!confirm(msg)) return;

  _mrrEd.busy = true;
  var btn = document.getElementById('mrrEdSaveBtn');
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

  try {
    var res = await _mrrEdRpc('erp_edit_mrr', {
      p_doc_no: _mrrEd.docNo, p_header: header, p_items: items,
      p_reason: reason, p_user: _mrrEdUser()
    });
    if (!res || !res.success) throw new Error(_mrrEdFriendly(res && res.error));
    mrrEdClose();
    _mrrEdToast('✅ ' + _mrrEd.docNo + ' updated (' + res.status + ')', 'success');
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

console.log('✅ mrr-edit.js v1.0 loaded');
