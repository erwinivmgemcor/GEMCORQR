// ============================================================
// GEMCOR ERP — New MRR Creation (v5.0 - Direct Insert & Clean)
// ============================================================

var _mrrState = {
  poNo: '',
  sofNo: '',
  prfNo: '',
  client: '',
  vendor: '',
  receivingSite: 'GEMCOR CATMON',
  drNo: '',
  receivingDate: '',
  preparedBy: '',
  items: [],
  prfLines: [],
  isSubmitting: false,
  lastSubmittedAt: 0
};

// Auto-suggest cache
var _mrrInventoryCache = null;
var _mrrInventoryPromise = null;
var _mrrSearchTimers = {};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[New MRR v5.0] Initializing...');

  if (typeof resetFormSilent === 'function') {
    resetFormSilent();
  }

  mrrCheckHealth();

  var userFullname = localStorage.getItem('ivm_userFullname') ||
                     localStorage.getItem('ivm_username') || '';
  _mrrState.preparedBy = userFullname;
  document.getElementById('mrrPreparedBy').value = userFullname;

  var today = new Date().toISOString().split('T')[0];
  document.getElementById('mrrReceivingDate').value = today;
  _mrrState.receivingDate = today;

  renderItems();

  document.getElementById('mrrPoNo').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupPoNo();
    }
  });

  // ═══ SOF No. SYNC — step 1 ↔ step 2 fields ═══
  var sofStep1 = document.getElementById('mrrSofNo');
  var sofStep2 = document.getElementById('mrrSofNoDisplay');
  if (sofStep1 && sofStep2) {
    sofStep1.addEventListener('input', function() { sofStep2.value = this.value; });
    sofStep2.addEventListener('input', function() { sofStep1.value = this.value; });
  }

  // Preload inventory cache in background
  setTimeout(function() {
    _mrrLoadInventory().then(function(items) {
      _mrrInventoryCache = items;
      console.log('[MRR v5.0] Inventory cache preloaded:', items.length, 'items');
    }).catch(function(err) {
      console.warn('[MRR v5.0] Preload failed:', err.message);
    });
  }, 500);

  console.log('[New MRR v5.0] Ready. Prepared By:', userFullname);
});

async function mrrCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var result = await erpHealthCheck();
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(err) {
    dot.className = 'dot dot-error';
    text.textContent = 'Error';
  }
}

// ═══════════════════════════════════════════════════════════
// PO LOOKUP — fills PRF No., SOF No., Supplier and items
// Sources: prf_items (PO linked to PRF) → erp_prf_po_cache (PO master sheet)
//          + earlier MRRs of the same PO (partial deliveries: SOF/supplier reused,
//            items default to what is still NOT received)
// Not found? Nothing is blocked: fill the details in by hand.
// ═══════════════════════════════════════════════════════════
function _mrrUnique(arr) {
  var seen = {}, out = [];
  arr.forEach(function(x) {
    x = String(x || '').trim();
    if (x && !seen[x]) { seen[x] = true; out.push(x); }
  });
  return out;
}

function _mrrSofFrom(rows) {
  var re = /SOF\s*#?\s*([A-Za-z0-9\-]+)/i;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var fields = [r.sof_no, r.remarks, r.client, r.brand_note, r.requestor];
    for (var k = 0; k < fields.length; k++) {
      var f = fields[k];
      if (!f) continue;
      if (k === 0) return String(f).trim();           // a real sof_no column, if it exists
      var m = re.exec(String(f));
      if (m) return 'SOF#' + m[1];
    }
  }
  return '';
}

// Earlier MRRs for this PO → received qty per item + SOF/supplier/PRF to reuse
async function _mrrPriorReceipts(poNo) {
  var out = { docs: [], received: {}, sof: '', vendor: '', prf: '' };
  try {
    var docs = await erpFetch('documents',
      'doc_type=eq.MRR&po_no=eq.' + encodeURIComponent(poNo) +
      '&status=in.(COMPLETED,PARTIAL)&select=doc_no,sof_no,vendor,prf_no,created_at&order=created_at.desc&limit=200');
    out.docs = docs || [];
    if (out.docs.length === 0) return out;
    for (var i = 0; i < out.docs.length; i++) {
      var d = out.docs[i];
      if (!out.sof && d.sof_no) out.sof = d.sof_no;
      if (!out.vendor && d.vendor) out.vendor = d.vendor;
      if (!out.prf && d.prf_no) out.prf = d.prf_no;
    }
    var nos = out.docs.map(function(d) { return encodeURIComponent(d.doc_no); }).join(',');
    var lines = await erpFetch('doc_items', 'doc_no=in.(' + nos + ')&select=item_code,issued_qty&limit=5000');
    (lines || []).forEach(function(l) {
      out.received[l.item_code] = (out.received[l.item_code] || 0) + Number(l.issued_qty || 0);
    });
  } catch(e) {
    console.warn('[MRR prior receipts]', e.message);
  }
  return out;
}

async function lookupPoNo() {
  var poNo = document.getElementById('mrrPoNo').value.trim();
  var statusEl = document.getElementById('poStatus');
  var resultEl = document.getElementById('poLookupResult');

  if (!poNo) {
    statusEl.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> Please enter a PO No.</span>';
    return;
  }

  statusEl.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split"></i> Looking up...</span>';
  resultEl.className = 'alert alert-info mb-0 py-2';
  resultEl.innerHTML = '<span class="small">Searching...</span>';

  try {
    var enc = encodeURIComponent(poNo);
    var rows = await erpFetch('prf_items', 'po_no=eq.' + enc + '&order=prf_no.asc,line_no.asc&limit=500');
    var source = 'prf_items';

    var cacheRows = [];
    try {
      cacheRows = await erpFetch('erp_prf_po_cache', 'po_no=eq.' + enc + '&order=item_no.asc&limit=500') || [];
    } catch(cacheErr) {
      console.warn('[MRR Lookup] po_cache query failed:', cacheErr.message);
    }

    if ((!rows || rows.length === 0) && cacheRows.length > 0) {
      rows = cacheRows.map(function(r) {
        return {
          prf_no: r.prf_no || '',
          item_code: r.inventory_id || '',
          description: r.description || '',
          qty_for_order: Number(r.qty || 0),
          unit: r.unit || 'PCS',
          line_no: r.item_no || 0,
          po_supplier: r.supplier || ''
        };
      });
      source = 'PO master sheet';
    }

    var prior = await _mrrPriorReceipts(poNo);

    if ((!rows || rows.length === 0) && prior.docs.length === 0) {
      statusEl.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> PO No. not found</span>';
      resultEl.className = 'alert alert-warning mb-0 py-2';
      resultEl.innerHTML = '<span class="small"><i class="bi bi-exclamation-triangle me-1"></i>' +
        'PO No. <strong>' + erpEsc(poNo) + '</strong> is not in the PRF records or the PO master. ' +
        'No problem — fill in the PRF No. (if any), supplier and items below. The MRR will still be saved.</span>';
      return;
    }

    rows = rows || [];
    var prfNos = _mrrUnique(rows.map(function(r) { return r.prf_no; }));
    var prfText = prfNos.length ? prfNos.join(', ') : prior.prf;
    var supplier = _mrrUnique(rows.map(function(r) { return r.po_supplier; }))[0] || prior.vendor || '';
    var sof = prior.sof || _mrrSofFrom(cacheRows);

    _mrrState.poNo = poNo;
    _mrrState.prfNo = prfText;
    _mrrState.client = supplier;
    _mrrState.vendor = supplier;

    if (prfText) document.getElementById('mrrPrfNo').value = prfText;
    if (supplier) document.getElementById('mrrVendor').value = supplier;
    if (sof) {
      document.getElementById('mrrSofNo').value = sof;
      document.getElementById('mrrSofNoDisplay').value = sof;
    }

    // items: PO qty vs. what earlier MRRs already received (oldest line first)
    var pool = {};
    Object.keys(prior.received).forEach(function(k) { pool[k] = prior.received[k]; });
    var items = [], fullyReceived = 0, partlyReceived = 0;
    rows.forEach(function(r, i) {
      var qty = Number(r.qty_for_order || 0);
      var take = Math.min(pool[r.item_code] || 0, qty);
      pool[r.item_code] = (pool[r.item_code] || 0) - take;
      var remaining = qty - take;
      if (qty > 0 && remaining <= 0) { fullyReceived++; return; }
      if (take > 0) partlyReceived++;
      items.push({
        itemCode: r.item_code || '',
        description: r.description || '',
        requestedQty: qty,
        issuedQty: remaining,
        unit: r.unit || 'PCS',
        remarks: '',
        itemNo: r.line_no || (i + 1)
      });
    });
    _mrrState.items = items;
    renderItems();

    var note = '';
    if (prior.docs.length) {
      note += '<br><span class="text-muted">Earlier MRR(s) for this PO: ' + erpEsc(prior.docs.map(function(d) { return d.doc_no; }).join(', ')) +
        (fullyReceived ? ' — ' + fullyReceived + ' line(s) already fully received (not listed)' : '') +
        (partlyReceived ? ' — ' + partlyReceived + ' line(s) partly received (ATL Qty = still to receive)' : '') + '</span>';
    }
    var warnSof = sof ? '' : '<br><span class="text-muted">SOF No. not found for this PO — type it in if there is one.</span>';

    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> PO No. found</span>';
    resultEl.className = 'alert alert-success mb-0 py-2';
    resultEl.innerHTML = '<span class="small"><i class="bi bi-check-circle me-1"></i>' +
      'Found in <em>' + erpEsc(source) + '</em>: PRF <strong>' + erpEsc(prfText || '—') + '</strong>' +
      ' · SOF <strong>' + erpEsc(sof || '—') + '</strong>' +
      ' · Supplier <strong>' + erpEsc(supplier || '—') + '</strong>' +
      ' · ' + items.length + ' item(s) loaded' + note + warnSof + '</span>';

    erpShowToast('PO No. found. ' + items.length + ' item(s) loaded.', 'success');
    checkPrfInfo();

    setTimeout(function() {
      var dr = document.getElementById('mrrDrNo');
      if (dr) dr.focus();
    }, 300);

  } catch(err) {
    console.error('[lookupPoNo]', err);
    statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed</span>';
    resultEl.className = 'alert alert-danger mb-0 py-2';
    resultEl.innerHTML = '<span class="small">' + erpEsc(err.message) +
      ' — you can still fill in the details below by hand.</span>';
  }
}

// ═══════════════════════════════════════════════════════════
// PRF DETECTION — shows what this MRR will update in PRF Monitor
// ═══════════════════════════════════════════════════════════
function _mrrPrfList(raw) {
  return _mrrUnique(String(raw || '').split(/[,;]+/));
}

async function checkPrfInfo() {
  var el = document.getElementById('mrrPrfInfo');
  if (!el) return;
  var list = _mrrPrfList(document.getElementById('mrrPrfNo').value);
  _mrrState.prfLines = [];
  if (list.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split"></i> Checking PRF...</span>';
  try {
    var q = 'prf_no=in.(' + list.map(encodeURIComponent).join(',') + ')&select=*&order=prf_no.asc,line_no.asc&limit=2000';
    var lines = await erpFetch('prf_items', q) || [];
    _mrrState.prfLines = lines;

    var html = '';
    list.forEach(function(p) {
      var mine = lines.filter(function(l) { return l.prf_no === p; });
      if (mine.length === 0) {
        html += '<div class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i><strong>' + erpEsc(p) +
          '</strong> not found in PRF records — the MRR will be saved, but no PRF will be updated.</div>';
        return;
      }
      var c = { UNSERVED: 0, STAGGERED: 0, SERVED: 0, CANCELED: 0 };
      mine.forEach(function(l) { var s = String(l.status || 'UNSERVED').toUpperCase(); if (c[s] !== undefined) c[s]++; });
      html += '<div class="text-success"><i class="bi bi-check-circle me-1"></i><strong>' + erpEsc(p) + '</strong>: ' + mine.length +
        ' line(s) — ' + c.UNSERVED + ' unserved, ' + c.STAGGERED + ' staggered, ' + c.SERVED + ' served' +
        (c.CANCELED ? ', ' + c.CANCELED + ' canceled' : '') +
        '. Saving this MRR updates their status automatically.</div>';
    });
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<span class="text-muted">Could not check the PRF (' + erpEsc(e.message) + ').</span>';
  }
}

// Fill the items table with the still-open lines of the typed PRF(s)
async function loadItemsFromPrf() {
  var list = _mrrPrfList(document.getElementById('mrrPrfNo').value);
  if (list.length === 0) { erpShowToast('Type a PRF No. first', 'warning'); return; }
  await checkPrfInfo();

  var open = (_mrrState.prfLines || []).filter(function(l) {
    var s = String(l.status || 'UNSERVED').toUpperCase();
    return s === 'UNSERVED' || s === 'STAGGERED';
  });
  if (open.length === 0) { erpShowToast('No open (unserved / staggered) lines on this PRF', 'warning'); return; }

  // remaining qty per line, if the database view exists; otherwise the full PRF qty
  var remaining = {};
  try {
    var ov = await erpFetch('erp_v_prf_open_lines',
      'prf_no=in.(' + list.map(encodeURIComponent).join(',') + ')&select=prf_item_id,open_qty&limit=2000');
    (ov || []).forEach(function(r) { remaining[r.prf_item_id] = Number(r.open_qty || 0); });
  } catch(e) { remaining = null; }

  if (_mrrState.items.length > 0 && !confirm('Replace the items already in the table with the PRF lines?')) return;

  _mrrState.items = open.map(function(l, i) {
    var qty = Number(l.qty_for_order || 0);
    var rem = remaining ? (remaining[l.id] !== undefined ? remaining[l.id] : qty) : qty;
    return {
      itemCode: l.item_code || '',
      description: l.description || '',
      requestedQty: qty,
      issuedQty: rem,
      unit: l.unit || 'PCS',
      remarks: '',
      itemNo: l.line_no || (i + 1)
    };
  });
  renderItems();

  var vend = document.getElementById('mrrVendor');
  if (vend && !vend.value.trim()) {
    var sup = _mrrUnique(open.map(function(l) { return l.po_supplier; }))[0];
    if (sup) vend.value = sup;
  }
  var po = document.getElementById('mrrPoNo');
  if (po && !po.value.trim()) {
    var pos = _mrrUnique(open.map(function(l) { return l.po_no; }));
    if (pos.length === 1) po.value = pos[0];
  }
  erpShowToast(open.length + ' PRF line(s) loaded. Set the ATL Qty actually received.', 'success');
}
window.checkPrfInfo = checkPrfInfo;
window.loadItemsFromPrf = loadItemsFromPrf;

// ═══════════════════════════════════════════════════════════
// ITEMS MANAGEMENT
// ═══════════════════════════════════════════════════════════
function addItemRow() {
  _mrrState.items.push({
    itemCode: '',
    description: '',
    requestedQty: 0,
    issuedQty: 0,
    unit: 'PCS',
    remarks: '',
    itemNo: _mrrState.items.length + 1
  });
  renderItems();

  var newIdx = _mrrState.items.length - 1;
  setTimeout(function() {
    var input = document.getElementById('mrrItemCode' + newIdx);
    if (input) input.focus();
  }, 150);
}

function renderItems() {
  var tbody = document.getElementById('itemsBody');
  if (!tbody) return;

  if (_mrrState.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">' +
      '<i class="bi bi-inbox fs-3 d-block mb-2 opacity-50"></i>' +
      'Click "+ Add Item", or enter a PO No. / PRF No. above to load items.</td></tr>';
    return;
  }

  var html = '';
  _mrrState.items.forEach(function(it, idx) {
    html += '<tr data-idx="' + idx + '">' +
      '<td class="text-center">' + (idx + 1) + '</td>' +
      '<td style="position:relative;">' +
        '<input type="text" ' +
          'class="form-control form-control-sm item-code-input" ' +
          'id="mrrItemCode' + idx + '" ' +
          'data-idx="' + idx + '" ' +
          'value="' + erpEsc(it.itemCode) + '" ' +
          'placeholder="Type to search..." ' +
          'autocomplete="off" ' +
          'oninput="onMrrItemCodeInput(' + idx + ', this.value)" ' +
          'onfocus="onMrrItemCodeInput(' + idx + ', this.value)" ' +
          'onblur="onMrrItemCodeBlur(' + idx + ')">' +
        '<div class="item-search-dropdown d-none" id="mrrDropdown' + idx + '"></div>' +
      '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm" ' +
          'id="mrrItemDesc' + idx + '" ' +
          'value="' + erpEsc(it.description) + '" ' +
          'placeholder="Auto-filled" ' +
          'oninput="updateItem(' + idx + ', \'description\', this.value)">' +
      '</td>' +
      '<td>' +
        '<input type="number" class="form-control form-control-sm text-center" ' +
          'value="' + (it.requestedQty || 0) + '" ' +
          'min="0" step="0.01" ' +
          'oninput="updateItem(' + idx + ', \'requestedQty\', parseFloat(this.value)||0)">' +
      '</td>' +
      '<td>' +
        '<input type="number" class="form-control form-control-sm text-center item-qty-input" ' +
          'value="' + (it.issuedQty || 0) + '" ' +
          'min="0" step="0.01" ' +
          'oninput="updateItem(' + idx + ', \'issuedQty\', parseFloat(this.value)||0)">' +
      '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm text-center" ' +
          'id="mrrItemUnit' + idx + '" ' +
          'value="' + erpEsc(it.unit || 'PCS') + '" ' +
          'oninput="updateItem(' + idx + ', \'unit\', this.value)">' +
      '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm" ' +
          'value="' + erpEsc(it.remarks) + '" ' +
          'placeholder="Optional" ' +
          'oninput="updateItem(' + idx + ', \'remarks\', this.value)">' +
      '</td>' +
      '<td class="text-center">' +
        '<button class="btn btn-sm btn-outline-danger" onclick="removeItem(' + idx + ')" title="Remove">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

function updateItem(idx, field, value) {
  if (_mrrState.items[idx]) {
    _mrrState.items[idx][field] = value;
  }
}

function removeItem(idx) {
  if (!confirm('Remove this item?')) return;
  _mrrState.items.splice(idx, 1);
  renderItems();
}

// ═══════════════════════════════════════════════════════════
// AUTO-SUGGEST
// ═══════════════════════════════════════════════════════════
function onMrrItemCodeInput(idx, value) {
  var input = document.getElementById('mrrItemCode' + idx);
  var dropdown = document.getElementById('mrrDropdown' + idx);
  if (!input || !dropdown) return;

  var term = String(value || '').toLowerCase().trim();

  if (_mrrSearchTimers[idx]) clearTimeout(_mrrSearchTimers[idx]);

  if (!term || term.length < 2) {
    dropdown.classList.add('d-none');
    return;
  }

  dropdown.innerHTML = '<div class="item-search-item muted">' +
    '<i class="bi bi-hourglass-split me-2"></i>Searching...</div>';
  _positionMrrDropdown(dropdown, input);
  dropdown.classList.remove('d-none');

  _mrrSearchTimers[idx] = setTimeout(async function() {
    await _mrrSearchItems(idx, term);
  }, 200);
}

async function _mrrSearchItems(idx, term) {
  var input = document.getElementById('mrrItemCode' + idx);
  var dropdown = document.getElementById('mrrDropdown' + idx);
  if (!input || !dropdown) return;

  try {
    if (!_mrrInventoryCache) {
      if (_mrrInventoryPromise) {
        await _mrrInventoryPromise;
      } else {
        _mrrInventoryPromise = _mrrLoadInventory();
        _mrrInventoryCache = await _mrrInventoryPromise;
        _mrrInventoryPromise = null;
      }
    }

    var items = _mrrInventoryCache || [];

    var matches = items.filter(function(it) {
      var code = String(it.code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
    }).slice(0, 30);

    matches.sort(function(a, b) {
      var aCode = String(a.code || '').toLowerCase();
      var bCode = String(b.code || '').toLowerCase();
      var aExact = aCode === term ? 0 : 1;
      var bExact = bCode === term ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      var aStart = aCode.indexOf(term) === 0 ? 0 : 1;
      var bStart = bCode.indexOf(term) === 0 ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return aCode.localeCompare(bCode);
    });

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="item-search-item muted">' +
        '<i class="bi bi-x-circle me-2"></i>No matches found</div>';
      return;
    }

    var html = '';
    matches.forEach(function(it) {
      var code = String(it.code || '');
      var desc = String(it.description || '');
      var unit = String(it.unit || 'PCS');
      var category = String(it.category || '');
      var safeCode = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safeDesc = desc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safeUnit = unit.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      html += '<div class="item-search-item" ' +
        'onmousedown="event.preventDefault();selectMrrItem(' + idx + ', \'' +
          safeCode + '\', \'' + safeDesc + '\', \'' + safeUnit + '\')">' +
        '<div class="item-code">' + erpEsc(code) + '</div>' +
        '<div class="item-desc">' + erpEsc(desc.substring(0, 100)) + (desc.length > 100 ? '…' : '') + '</div>' +
        '<div class="item-meta">' +
          '<span class="badge bg-light text-dark">' + erpEsc(unit) + '</span>' +
          (category ? '<span class="badge bg-secondary">' + erpEsc(category) + '</span>' : '') +
        '</div>' +
      '</div>';
    });
    dropdown.innerHTML = html;
    _positionMrrDropdown(dropdown, input);
    dropdown.classList.remove('d-none');

  } catch(err) {
    console.error('[_mrrSearchItems]', err);
    dropdown.innerHTML = '<div class="item-search-item muted" style="color:#dc2626;">' +
      '<i class="bi bi-exclamation-triangle me-2"></i>Search error</div>';
  }
}

function selectMrrItem(idx, code, description, unit) {
  if (_mrrState.items[idx]) {
    _mrrState.items[idx].itemCode = code;
    _mrrState.items[idx].description = description;
    _mrrState.items[idx].unit = unit;
  }

  var codeInput = document.getElementById('mrrItemCode' + idx);
  var descInput = document.getElementById('mrrItemDesc' + idx);
  var unitInput = document.getElementById('mrrItemUnit' + idx);

  if (codeInput) codeInput.value = code;
  if (descInput) descInput.value = description;
  if (unitInput) unitInput.value = unit;

  var dropdown = document.getElementById('mrrDropdown' + idx);
  if (dropdown) dropdown.classList.add('d-none');

  var row = document.querySelector('tr[data-idx="' + idx + '"]');
  if (row) {
    row.classList.add('selected-item-row');
    setTimeout(function() { row.classList.remove('selected-item-row'); }, 1500);
  }

  setTimeout(function() {
    var qtyInput = row ? row.querySelector('.item-qty-input') : null;
    if (qtyInput) {
      qtyInput.focus();
      qtyInput.select();
    }
  }, 100);
}

window.selectMrrItem = selectMrrItem;

function onMrrItemCodeBlur(idx) {
  setTimeout(function() {
    var dropdown = document.getElementById('mrrDropdown' + idx);
    if (dropdown) dropdown.classList.add('d-none');
  }, 200);
}

function _positionMrrDropdown(dropdown, input) {
  var rect = input.getBoundingClientRect();
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;

  var width = Math.max(rect.width, 400);
  var maxWidth = window.innerWidth - rect.left - 20;
  if (width > maxWidth) width = maxWidth;

  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = width + 'px';
  dropdown.style.zIndex = '99999';

  if (spaceBelow < 320 && spaceAbove > spaceBelow) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceAbove - 20, 320) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceBelow - 20, 320) + 'px';
  }
}

async function _mrrLoadInventory() {
  console.log('[MRR v5.0] Loading inventory for autocomplete...');
  try {
    if (typeof erpGetInventoryListForDropdown === 'function') {
      var list = await erpGetInventoryListForDropdown();
      console.log('[MRR v5.0] Inventory loaded (shared):', list.length, 'items');
      return list;
    }

    var allItems = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;

    while (hasMore) {
      var query = 'select=item_code,description,base_unit,category,location' +
                  '&is_active=eq.true' +
                  '&is_deleted=eq.false' +
                  '&is_deprecated_2026=eq.false' +
                  '&order=item_code.asc' +
                  '&limit=' + pageSize +
                  '&offset=' + offset;

      var rows = await erpFetch('erp_items', query);
      if (!rows || rows.length === 0) break;

      allItems = allItems.concat(rows);
      offset += rows.length;
      if (rows.length < pageSize) hasMore = false;
    }

    var mapped = allItems.map(function(r) {
      return {
        code: r.item_code,
        description: r.description || '',
        unit: r.base_unit || 'PIECE',
        category: r.category || '',
        location: r.location || ''
      };
    });

    console.log('[MRR v5.0] Inventory loaded (fallback):', mapped.length, 'items');
    return mapped;
  } catch(err) {
    console.warn('[MRR v5.0] Inventory load failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT MRR (Direct Supabase Insert)
// ═══════════════════════════════════════════════════════════
async function submitMrr() {
  if (_mrrState.isSubmitting) return;

  // 1. Validation
  var drNo = document.getElementById('mrrDrNo').value.trim();
  if (!drNo) { erpShowToast('DR No. / S.I. No. is required', 'warning'); return; }
  _mrrState.drNo = drNo;

  var receivingDate = document.getElementById('mrrReceivingDate').value;
  if (!receivingDate) { erpShowToast('Receiving Date is required', 'warning'); return; }
  _mrrState.receivingDate = receivingDate;

  var receivingSite = document.getElementById('mrrReceivingSite').value.trim();
  if (!receivingSite) { erpShowToast('Receiving Site is required', 'warning'); return; }

  _mrrState.vendor = document.getElementById('mrrVendor').value.trim();
  _mrrState.poNo = document.getElementById('mrrPoNo').value.trim();   // typed by hand or from lookup
  _mrrState.receivingSite = receivingSite;
  _mrrState.prfNo = document.getElementById('mrrPrfNo').value.trim();
  _mrrState.sofNo = document.getElementById('mrrSofNoDisplay').value.trim() || document.getElementById('mrrSofNo').value.trim();

  if (_mrrState.items.length === 0) { erpShowToast('No items to submit', 'warning'); return; }

  var validItems = [];
  for (var i = 0; i < _mrrState.items.length; i++) {
    var it = _mrrState.items[i];
    if (!it.itemCode || !it.itemCode.trim()) { erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning'); return; }
    
    if (!(Number(it.requestedQty) > 0) && !(Number(it.issuedQty) > 0)) { erpShowToast('Item #' + (i + 1) + ' has no quantity', 'warning'); return; }
    if (!_mrrState.vendor) { erpShowToast('Vendor / Client is required', 'warning'); return; }
    validItems.push({
      item_code: it.itemCode,
      description: it.description,
      qty: Number(it.requestedQty) > 0 ? Number(it.requestedQty) : Number(it.issuedQty),
      atl_qty: Number(it.issuedQty) || 0,
      unit: it.unit,
      remarks: it.remarks || ((Number(it.issuedQty) || 0) >= (Number(it.requestedQty) > 0 ? Number(it.requestedQty) : Number(it.issuedQty)) ? 'COMPLETE' : 'PARTIAL')
    });
  }

  if (!confirm('Create MRR with ' + validItems.length + ' item(s)?')) return;

  _mrrState.isSubmitting = true;
  var btn = document.getElementById('btnSubmitMrr');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    // 2. Kunin lang ang Doc No
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: 'MRR' })
    });

    if (!rpcRes.ok) throw new Error('RPC Doc Num failed');
    var nextNum = await rpcRes.json();
    var padded = String(nextNum).padStart(7, '0');
    var docNo = 'MRR' + padded;

    var currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';

    // 3. Tawagin ang RPC (Ito na ang bahala sa lahat ng Insert at Stock Update)
    var processRes = await fetch(erpUrl('rpc/erp_submit_mrr'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_doc_no: docNo,
        p_doc_payload: {
          requestor: _mrrState.preparedBy,
          department: '',
          po_no: _mrrState.poNo || '',
          sof_no: _mrrState.sofNo || '',
          prf_no: _mrrState.prfNo,
          vendor: _mrrState.vendor,
          client_name: _mrrState.vendor || _mrrState.client || '',
          dr_no: _mrrState.drNo,
          receiving_site: _mrrState.receivingSite,
          receiving_date: _mrrState.receivingDate,
          date_prepared: new Date().toISOString().split('T')[0],
          prepared_by: _mrrState.preparedBy
        },
        p_items: validItems,
        p_processed_by: currentUser
      })
    });

    if (!processRes.ok) {
      var errText = await processRes.text();
      throw new Error('RPC Error: ' + processRes.status + ' ' + errText);
    }
    
    var data = await processRes.json();
    if (!data || !data.success) throw new Error(data.error || 'Unknown error');

    erpShowToast('✅ MRR created: ' + docNo, 'success');
    var prfSummaryHtml = await _mrrPrfSummary(_mrrState.prfNo, _mrrState.poNo);
    showSuccessModal(docNo, prfSummaryHtml);

  } catch(err) {
    console.error('[submitMrr]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _mrrState.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}
// ═══════════════════════════════════════════════════════════
// SUCCESS MODAL
// ═══════════════════════════════════════════════════════════
// What PRF Monitor shows for the PRF(s) this MRR touched (read right after saving)
async function _mrrPrfSummary(prfText, poNo) {
  try {
    var list = _mrrPrfList(prfText);
    var q = list.length
      ? 'prf_no=in.(' + list.map(encodeURIComponent).join(',') + ')'
      : (poNo ? 'po_no=eq.' + encodeURIComponent(poNo) : '');
    if (!q) return '';
    var lines = await erpFetch('prf_items', q + '&select=prf_no,status&limit=2000') || [];
    if (lines.length === 0) return '<div class="text-muted"><i class="bi bi-info-circle me-1"></i>No PRF line is linked to this MRR.</div>';
    var by = {};
    lines.forEach(function(l) {
      var s = String(l.status || 'UNSERVED').toUpperCase();
      by[l.prf_no] = by[l.prf_no] || { UNSERVED: 0, STAGGERED: 0, SERVED: 0, CANCELED: 0 };
      if (by[l.prf_no][s] !== undefined) by[l.prf_no][s]++;
    });
    return '<div class="fw-bold mb-1"><i class="bi bi-file-earmark-text me-1"></i>PRF status now</div>' +
      Object.keys(by).map(function(p) {
        var c = by[p];
        return '<div><strong>' + erpEsc(p) + '</strong> — ' + c.SERVED + ' served · ' + c.STAGGERED + ' staggered · ' + c.UNSERVED + ' unserved' +
          (c.CANCELED ? ' · ' + c.CANCELED + ' canceled' : '') + '</div>';
      }).join('');
  } catch(e) { return ''; }
}

function showSuccessModal(docNo, prfInfoHtml) {
  document.getElementById('successDocNo').textContent = docNo;
  var infoEl = document.getElementById('successPrfInfo');
  if (infoEl) infoEl.innerHTML = prfInfoHtml || '';
  
  var base = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  var qrData = base + '../?doc=' + encodeURIComponent(docNo) + '&view=print';
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
  document.getElementById('successQrImg').src = qrUrl;

  var modalEl = document.getElementById('successModal');
  var modal = new bootstrap.Modal(modalEl);
  modal.show();

  modalEl.addEventListener('hidden.bs.modal', function onHide() {
    modalEl.removeEventListener('hidden.bs.modal', onHide);
    resetFormSilent();
  }, { once: true });
}

// ═══════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════
function resetFormSilent() {
  _mrrState.poNo = '';
  _mrrState.sofNo = '';
  _mrrState.prfNo = '';
  _mrrState.client = '';
  _mrrState.vendor = '';
  _mrrState.drNo = '';
  _mrrState.items = [];

  document.getElementById('mrrPoNo').value = '';
  document.getElementById('mrrPrfNo').value = '';
  document.getElementById('mrrVendor').value = '';
  document.getElementById('mrrDrNo').value = '';

  var sof1 = document.getElementById('mrrSofNo');
  var sof2 = document.getElementById('mrrSofNoDisplay');
  if (sof1) sof1.value = '';
  if (sof2) sof2.value = '';

  _mrrState.prfLines = [];
  var pi = document.getElementById('mrrPrfInfo'); if (pi) pi.innerHTML = '';
  document.getElementById('poStatus').innerHTML = '';
  document.getElementById('poLookupResult').className = 'alert alert-secondary mb-0 py-2';
  document.getElementById('poLookupResult').innerHTML = '<span class="text-muted small">Enter a PO No. and click Lookup, or skip it and fill in the details yourself.</span>';

  renderItems();

  console.log('[Reset MRR] Form cleared.');
}

function resetForm() {
  if (!confirm('Reset the form? All unsaved data will be lost.')) return;
  resetFormSilent();
  erpShowToast('Form reset', 'info');
}

function closeSuccessAndReset() {
  var modalEl = document.getElementById('successModal');
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
}

// ═══════════════════════════════════════════════════════════
// GLOBAL: Hide dropdowns on outside click + scroll
// ═══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  if (!e.target.closest('.item-search-dropdown') &&
      !e.target.classList.contains('item-code-input')) {
    document.querySelectorAll('.item-search-dropdown').forEach(function(el) {
      el.classList.add('d-none');
    });
  }
});

window.addEventListener('scroll', function() {
  document.querySelectorAll('.item-search-dropdown:not(.d-none)').forEach(function(dropdown) {
    var idx = dropdown.id.replace('mrrDropdown', '');
    var input = document.getElementById('mrrItemCode' + idx);
    if (input) _positionMrrDropdown(dropdown, input);
  });
}, { passive: true });

window.addEventListener('resize', function() {
  document.querySelectorAll('.item-search-dropdown:not(.d-none)').forEach(function(el) {
    el.classList.add('d-none');
  });
});

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 });
  toast.show();
}

console.log('✅ new-mrr.js v5.0 loaded (Direct Insert + Clean)');
