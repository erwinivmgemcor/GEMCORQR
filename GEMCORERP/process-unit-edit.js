// ============================================================
// GEMCOR ERP — Fix item UNIT while processing an MRIF / MRS
// Adds a "Unit" dropdown to the Verify/Edit-quantity popup.
// Saves straight to doc_items + writes an audit record.
// ============================================================
(function () {
  var FALLBACK = ['PIECE', 'SET', 'PAIR', 'METER', 'ROLL', 'BOX', 'PACK', 'KG', 'LITER', 'LOT', 'BOTTLE', 'CAN', 'PAIL', 'SHEET', 'BAG', 'CARTON', 'FEET', 'UNIT'];
  var unitCache = null, masterCache = {};

  async function loadUnits() {
    if (unitCache) return unitCache;
    var seen = {}, list = [];
    try {
      var rows = await erpFetch('erp_items', 'select=base_unit&base_unit=not.is.null&limit=5000') || [];
      rows.forEach(function (r) { var u = String(r.base_unit || '').trim().toUpperCase(); if (u && !seen[u]) { seen[u] = 1; list.push(u); } });
    } catch (e) { /* use fallback */ }
    FALLBACK.forEach(function (u) { if (!seen[u]) { seen[u] = 1; list.push(u); } });
    unitCache = list.sort();
    return unitCache;
  }

  async function masterUnit(code) {
    if (masterCache[code] !== undefined) return masterCache[code];
    var u = '';
    try {
      var r = await erpFetch('erp_items', 'select=base_unit&item_code=eq.' + encodeURIComponent(code) + '&limit=1');
      u = (r && r[0] && r[0].base_unit) ? String(r[0].base_unit).trim().toUpperCase() : '';
    } catch (e) {}
    masterCache[code] = u;
    return u;
  }

  function ensureField() {
    if (document.getElementById('qtyModalUnit')) return true;
    var exp = document.getElementById('qtyModalExpected');
    if (!exp) return false;
    var host = exp.closest('.mb-3') || exp.parentElement;
    var wrap = document.createElement('div');
    wrap.className = 'mb-3';
    wrap.innerHTML =
      '<label class="form-label fw-bold">Unit <span class="text-muted small fw-normal">(fix if production entered the wrong unit)</span></label>' +
      '<select class="form-select" id="qtyModalUnit"></select>' +
      '<div class="form-text" id="qtyModalUnitHint"></div>';
    host.insertAdjacentElement('afterend', wrap);
    return true;
  }

  async function fillUnit(idx) {
    var item = _process.items[idx];
    if (!item || !ensureField()) return;
    var sel = document.getElementById('qtyModalUnit'), hint = document.getElementById('qtyModalUnitHint');
    var cur = String(item.unit || 'PIECE').trim().toUpperCase();
    var units = (await loadUnits()).slice();
    var master = await masterUnit(item.itemCode);
    if (units.indexOf(cur) === -1) units.unshift(cur);
    if (master && units.indexOf(master) === -1) units.unshift(master);
    sel.innerHTML = units.map(function (u) { return '<option value="' + u + '">' + u + '</option>'; }).join('');
    sel.value = cur;
    hint.innerHTML = '';
    if (master && master !== cur) {
      hint.innerHTML = '<span class="text-danger fw-bold">⚠ Inventory unit for this item is ' + master + '.</span> ' +
        '<a href="javascript:void(0)" id="qtyModalUseMaster">Use ' + master + '</a>';
      var a = document.getElementById('qtyModalUseMaster');
      if (a) a.onclick = function () { sel.value = master; };
    } else if (master) {
      hint.textContent = 'Matches the inventory unit (' + master + ').';
    }
  }

  async function saveUnit(item, newUnit) {
    if (!item.id) { erpShowToast('Cannot save unit: line id missing', 'warning'); return false; }
    var oldUnit = item.unit;
    try {
      var res = await fetch(erpUrl('doc_items?id=eq.' + encodeURIComponent(item.id)), {
        method: 'PATCH',
        headers: erpHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify({ unit: newUnit })
      });
      var out = res.ok ? await res.json() : null;
      if (!res.ok || !out || !out.length) throw new Error(res.ok ? 'not permitted' : ('HTTP ' + res.status));
    } catch (e) {
      erpShowToast('Could not save unit: ' + e.message, 'danger');
      return false;
    }
    item.unit = newUnit;
    try {
      var user = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';
      await fetch(erpUrl('erp_manual_edits_audit'), {
        method: 'POST', headers: erpHeaders(),
        body: JSON.stringify([{
          item_code: _process.docNo, field_name: 'unit (' + item.itemCode + ')',
          old_value: String(oldUnit || ''), new_value: newUnit,
          reason: 'Unit corrected during processing', edited_by: user, source: 'PROCESS_UNIT_EDIT'
        }])
      });
    } catch (e) { console.warn('[UnitEdit] audit failed', e); }
    erpShowToast('Unit updated: ' + item.itemCode + ' → ' + newUnit, 'success');
    return true;
  }

  function wrap() {
    if (typeof window.openQtyModal !== 'function' || typeof window.confirmQty !== 'function') return;
    var _open = window.openQtyModal, _confirm = window.confirmQty;
    window.openQtyModal = function (idx) { _open(idx); fillUnit(idx); };
    window.confirmQty = async function () {
      var cur = _process.currentQtyItem;
      var sel = document.getElementById('qtyModalUnit');
      if (cur && sel && sel.value) {
        var nu = sel.value.toUpperCase();
        if (nu !== String(cur.item.unit || '').toUpperCase()) { if (!(await saveUnit(cur.item, nu))) return; }
      }
      _confirm();
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrap); else wrap();
})();
