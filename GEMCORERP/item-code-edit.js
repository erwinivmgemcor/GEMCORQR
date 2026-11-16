// ============================================================
// GEMCOR ERP — Change ITEM CODE (Stock Monitor) — ADMIN ONLY
// Para ayusin ang mga item na mali ang code. Sa loob ng "Edit Item" modal
// lalabas ang button na "Change Code" (Admin lang). May PREVIEW muna bago i-apply.
// Backend: rpc/erp_rename_item_code (run erp-rename-item-code.sql once).
// ============================================================
var _ic = { oldCode: '', modal: null, busy: false, canRename: false };

function icEsc(s) {
  return (typeof erpEsc === 'function') ? erpEsc(s)
    : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
function icIsAdmin() {
  try { return localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; }
}
function icUser() {
  return localStorage.getItem('ivm_username') || localStorage.getItem('ivm_userFullname') || '';
}
function icNormalize(v) { return String(v || '').trim().toUpperCase(); }

// ─── Edit Item modal: ipakita ang button (admin) o paalala (hindi admin) ───
function icDecorateEditModal() {
  var note = document.getElementById('editItemCodeNote');
  var slot = document.getElementById('editItemCodeAdminSlot');
  if (!note || !slot) return;
  if (icIsAdmin()) {
    note.textContent = 'Admin: puwede mong palitan ang code kung mali.';
    slot.innerHTML = '<button type="button" class="btn btn-sm btn-outline-danger mt-2" id="icOpenBtn">' +
      '<i class="bi bi-pencil-square me-1"></i>Change Item Code</button>';
    document.getElementById('icOpenBtn').addEventListener('click', icOpenFromEdit);
  } else {
    note.textContent = 'Admin lang ang puwedeng magpalit ng item code.';
    slot.innerHTML = '';
  }
}

// ─── Rename modal ───
function icEnsureModal() {
  if (document.getElementById('icModal')) return;
  var m = document.createElement('div');
  m.className = 'modal fade'; m.id = 'icModal'; m.tabIndex = -1;
  m.setAttribute('data-bs-backdrop', 'static');
  m.innerHTML =
    '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title"><i class="bi bi-pencil-square me-2"></i>Change Item Code</h5>' +
        '<button type="button" class="btn-close" id="icCloseX"></button></div>' +
      '<div class="modal-body">' +
        '<div class="alert alert-warning small py-2">' +
          '<i class="bi bi-exclamation-triangle me-1"></i>Susunod sa bagong code ang <b>stock history, dokumento (MRS/MRIF/MRR), PRF at SOF allocations</b> ng item. ' +
          'Hindi ito madaling i-undo. Kung ang tamang code ay existing na, gamitin ang <b>Duplicate Items — Find &amp; Merge</b>.</div>' +
        '<div class="mb-3"><label class="form-label fw-bold">Current code</label>' +
          '<input type="text" class="form-control" id="icOld" readonly></div>' +
        '<div class="mb-3"><label class="form-label fw-bold">New code <span class="text-danger">*</span></label>' +
          '<input type="text" class="form-control" id="icNew" maxlength="100" autocomplete="off" placeholder="hal. GEM-EZC630H3500">' +
          '<div class="form-text">Awtomatikong gagawing CAPITAL ang letra.</div></div>' +
        '<div class="mb-3"><label class="form-label fw-bold">Reason <span class="text-danger">*</span></label>' +
          '<input type="text" class="form-control" id="icReason" maxlength="200" value="Maling item code"></div>' +
        '<div id="icPreview"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" id="icCancel">Cancel</button>' +
        '<button type="button" class="btn btn-outline-primary" id="icPreviewBtn"><i class="bi bi-eye me-1"></i>Preview</button>' +
        '<button type="button" class="btn btn-danger d-none" id="icConfirmBtn"><i class="bi bi-check2-circle me-1"></i>Confirm Change</button>' +
      '</div>' +
    '</div></div>';
  document.body.appendChild(m);

  document.getElementById('icNew').addEventListener('input', function () {
    var p = this.selectionStart;
    this.value = this.value.toUpperCase();
    try { this.setSelectionRange(p, p); } catch (e) {}
    icResetPreview();   // kapag binago ang code, kailangan ulit i-preview
  });
  document.getElementById('icPreviewBtn').addEventListener('click', function () { icCall(true); });
  document.getElementById('icConfirmBtn').addEventListener('click', icConfirm);
  document.getElementById('icCancel').addEventListener('click', icCancel);
  document.getElementById('icCloseX').addEventListener('click', icCancel);
}

function icResetPreview() {
  _ic.canRename = false;
  var box = document.getElementById('icPreview'); if (box) box.innerHTML = '';
  var cb = document.getElementById('icConfirmBtn'); if (cb) cb.classList.add('d-none');
}

function icOpenFromEdit() {
  if (!icIsAdmin()) { erpShowToast('Admin lang ang puwedeng magpalit ng item code', 'warning'); return; }
  var code = (document.getElementById('editItemCode') || {}).value || '';
  if (!code) { erpShowToast('Walang item na naka-load', 'warning'); return; }
  _ic.oldCode = code;
  icEnsureModal();

  var editEl = document.getElementById('erpEditItemModal');
  var editInst = editEl ? bootstrap.Modal.getInstance(editEl) : null;
  function showRename() {
    document.getElementById('icOld').value = _ic.oldCode;
    document.getElementById('icNew').value = '';
    document.getElementById('icReason').value = 'Maling item code';
    icResetPreview();
    _ic.modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('icModal'));
    _ic.modal.show();
    setTimeout(function () { var n = document.getElementById('icNew'); if (n) n.focus(); }, 400);
  }
  if (editInst && editEl.classList.contains('show')) {
    editEl.addEventListener('hidden.bs.modal', showRename, { once: true });
    editInst.hide();
  } else { showRename(); }
}

function icCancel() {
  if (_ic.busy) return;
  var el = document.getElementById('icModal');
  el.addEventListener('hidden.bs.modal', function () {
    // balik sa Edit Item modal
    if (typeof erpOpenEditItemModal === 'function') erpOpenEditItemModal({ item_code: _ic.oldCode });
  }, { once: true });
  _ic.modal.hide();
}

// ─── RPC (preview = dry run) ───
async function icCall(dryRun) {
  if (_ic.busy) return;
  var newCode = icNormalize(document.getElementById('icNew').value);
  var reason = (document.getElementById('icReason').value || '').trim();
  var box = document.getElementById('icPreview');

  if (!newCode) { erpShowToast('Ilagay ang bagong code', 'warning'); return; }
  if (newCode === _ic.oldCode) { erpShowToast('Pareho lang sa kasalukuyang code', 'warning'); return; }
  if (/[\s]/.test(newCode) && !confirm('May space ang bagong code ("' + newCode + '"). Sigurado ka bang tama ito?')) return;
  if (!dryRun && !reason) { erpShowToast('Kailangan ang reason', 'warning'); return; }

  _ic.busy = true;
  var pb = document.getElementById('icPreviewBtn'), cb = document.getElementById('icConfirmBtn');
  pb.disabled = true; cb.disabled = true;
  if (dryRun) box.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sinusuri (walang magagalaw)...';

  try {
    var res = await fetch(erpUrl('rpc/erp_rename_item_code'), {
      method: 'POST', headers: erpHeaders(),
      body: JSON.stringify({ p_old: _ic.oldCode, p_new: newCode, p_username: icUser(), p_reason: reason, p_dry_run: dryRun })
    });
    if (res.status === 404) throw new Error('Wala pa ang database function. I-run muna ang erp-rename-item-code.sql sa Supabase.');
    if (!res.ok) { var t = await res.text(); var msg = ''; try { msg = JSON.parse(t).message; } catch (e) {} throw new Error(msg || ('HTTP ' + res.status)); }
    var r = await res.json();

    if (!r || !r.success) {
      icResetPreview();
      box.innerHTML = '<div class="alert alert-danger mb-0">' + icEsc((r && r.error) || 'Failed') + '</div>';
      return;
    }

    if (dryRun) {
      var tbl = Object.keys(r.tables || {}).map(function (k) {
        return '<li><code>' + icEsc(k) + '</code>: ' + Number(r.tables[k]).toLocaleString() + ' row(s)</li>';
      }).join('');
      var warn = (r.warnings || []).map(function (w) { return '<li>' + icEsc(w) + '</li>'; }).join('');
      box.innerHTML =
        '<div class="border rounded p-2 bg-light small"><div class="fw-bold mb-1">Preview — ito ang mangyayari:</div>' +
        '<div><code>' + icEsc(r.old) + '</code> → <code>' + icEsc(r.new) + '</code></div>' +
        '<div class="text-muted mt-1">Mga record na babaguhin ang code:</div><ul class="mb-1">' + tbl + '</ul>' +
        (warn ? '<div class="text-warning fw-bold">Paalala:</div><ul class="mb-1">' + warn + '</ul>' : '') + '</div>';
      _ic.canRename = true;
      cb.classList.remove('d-none');
      return;
    }

    // tapos na
    erpShowToast('✅ Na-update ang code: ' + r.old + ' → ' + r.new, 'success');
    try { if (typeof erpClearCache === 'function') erpClearCache(); } catch (e) {}
    _ic.modal.hide();
    if (typeof erpLoadItems === 'function') erpLoadItems();
    if (typeof erpLoadSummary === 'function') erpLoadSummary();
  } catch (e) {
    console.error('[ItemCodeEdit]', e);
    icResetPreview();
    box.innerHTML = '<div class="alert alert-danger mb-0">' + icEsc(e.message) + '</div>';
  } finally {
    _ic.busy = false; pb.disabled = false; cb.disabled = false;
  }
}

function icConfirm() {
  if (!_ic.canRename) { erpShowToast('I-preview muna', 'warning'); return; }
  var newCode = icNormalize(document.getElementById('icNew').value);
  if (!confirm('Palitan ang item code:\n\n' + _ic.oldCode + '  →  ' + newCode + '\n\nSusunod ang lahat ng history at dokumento. Ituloy?')) return;
  icCall(false);
}

document.addEventListener('DOMContentLoaded', function () {
  var editEl = document.getElementById('erpEditItemModal');
  if (editEl) editEl.addEventListener('show.bs.modal', icDecorateEditModal);
});
