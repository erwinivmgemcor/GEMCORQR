// ============================================================
// GEMCOR ERP — New MRR Creation (v3)
// ✅ Auto-suggest for manual item entry
// ✅ Works with or without PO#
// ✅ Complete item data from erp_items
// ✅ Automatic status patch (COMPLETED/PARTIAL) after insert
// ============================================================

var _mrrState = {
  poNo: '',
  prfNo: '',
  client: '',
  vendor: '',
  receivingSite: 'GEMCOR CATMON',
  drNo: '',
  receivingDate: '',
  preparedBy: '',
  items: [],
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
  console.log('[New MRR v3] Initializing...');

  mrrCheckHealth();

  var userFullname = localStorage.getItem('ivm_userFullname') ||
                     localStorage.getItem('ivm_username') || '';
  _mrrState.preparedBy = userFullname;
  document.getElementById('mrrPreparedBy').value = userFullname;

  var today = new Date().toISOString().split('T')[0];
  document.getElementById('mrrReceivingDate').value = today;
  _mrrState.receivingDate = today;

  document.getElementById('mrrPoNo').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupPoNo();
    }
  });

  // Preload inventory cache in background
  setTimeout(function() {
    _mrrLoadInventory().then(function(items) {
      _mrrInventoryCache = items;
      console.log('[MRR v3] Inventory cache preloaded:', items.length, 'items');
    }).catch(function(err) {
      console.warn('[MRR v3] Preload failed:', err.message);
    });
  }, 500);

  console.log('[New MRR v3] Ready. Prepared By:', userFullname);
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
// PO LOOKUP (Optional)
// ═══════════════════════════════════════════════════════════
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
    console.log('[MRR Lookup] Querying prf_items for po_no=' + poNo);
    var rows = await erpFetch('prf_items',
      'po_no=eq.' + encodeURIComponent(poNo) + '&order=line_no.asc&limit=500');

    if (!rows || rows.length === 0) {
      statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> PO No. not found</span>';
      resultEl.className = 'alert alert-warning mb-0 py-2';
      resultEl.innerHTML = '<span class="small"><i class="bi bi-exclamation-triangle me-1"></i>' +
        'PO No. <strong>' + erpEsc(poNo) + '</strong> not found in PRF records. ' +
        'You can still add items manually below.</span>';
      return;
    }

    console.log('[MRR Lookup] Found ' + rows.length + ' items in prf_items');

    var first = rows[0];
    _mrrState.poNo = poNo;
    _mrrState.prfNo = first.prf_no || '';
    _mrrState.client = first.po_supplier || '';
    _mrrState.vendor = first.po_supplier || '';

    document.getElementById('mrrPrfNo').value = _mrrState.prfNo;
    document.getElementById('mrrVendor').value = _mrrState.vendor;

    // ═══ Build items from prf_items (COMPLETE data) ═══
    _mrrState.items = rows.map(function(r, i) {
      return {
        itemCode: r.item_code || '',
        description: r.description || '',
        requestedQty: Number(r.qty_for_order || 0),
        issuedQty: Number(r.qty_for_order || 0),
        unit: r.unit || 'PCS',
        remarks: '',
        itemNo: r.line_no || (i + 1)
      };
    });

    renderItems();

    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> PO No. found!</span>';
    resultEl.className = 'alert alert-success mb-0 py-2';
    resultEl.innerHTML = '<span class="small"><i class="bi bi-check-circle me-1"></i>' +
      'Found: <strong>' + erpEsc(_mrrState.prfNo) + '</strong> — ' +
      erpEsc(_mrrState.client) + ' (' + rows.length + ' items)</span>';

    erpShowToast('PO No. found! ' + rows.length + ' items loaded.', 'success');

    setTimeout(function() {
      document.getElementById('mrrDrNo').focus();
    }, 300);

  } catch(err) {
    console.error('[lookupPoNo]', err);
    statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed</span>';
    resultEl.className = 'alert alert-danger mb-0 py-2';
    resultEl.innerHTML = '<span class="small">' + erpEsc(err.message) + '</span>';
  }
}

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

  // Focus the new row's item code input
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
      'Click "+ Add Item" to start, or enter PO No. above to auto-load items.</td></tr>';
    return;
  }

  var html = '';
  _mrrState.items.forEach(function(it, idx) {
    html += '<tr data-idx="' + idx + '">' +
      '<td class="text-center">' + (idx + 1) + '</td>' +

      // ═══ ITEM CODE with auto-suggest ═══
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

      // ═══ DESCRIPTION (auto-filled) ═══
      '<td>' +
        '<input type="text" class="form-control form-control-sm" ' +
          'id="mrrItemDesc' + idx + '" ' +
          'value="' + erpEsc(it.description) + '" ' +
          'placeholder="Auto-filled" ' +
          'oninput="updateItem(' + idx + ', \'description\', this.value)">' +
      '</td>' +

      // ═══ REQUESTED QTY ═══
      '<td>' +
        '<input type="number" class="form-control form-control-sm text-center" ' +
          'value="' + (it.requestedQty || 0) + '" ' +
          'min="0" step="0.01" ' +
          'oninput="updateItem(' + idx + ', \'requestedQty\', parseFloat(this.value)||0)">' +
      '</td>' +

      // ═══ ATL QTY (Received) ═══
      '<td>' +
        '<input type="number" class="form-control form-control-sm text-center item-qty-input" ' +
          'value="' + (it.issuedQty || 0) + '" ' +
          'min="0" step="0.01" ' +
          'oninput="updateItem(' + idx + ', \'issuedQty\', parseFloat(this.value)||0)">' +
      '</td>' +

      // ═══ UNIT ═══
      '<td>' +
        '<input type="text" class="form-control form-control-sm text-center" ' +
          'id="mrrItemUnit' + idx + '" ' +
          'value="' + erpEsc(it.unit || 'PCS') + '" ' +
          'oninput="updateItem(' + idx + ', \'unit\', this.value)">' +
      '</td>' +

      // ═══ REMARKS ═══
      '<td>' +
        '<input type="text" class="form-control form-control-sm" ' +
          'value="' + erpEsc(it.remarks) + '" ' +
          'placeholder="Optional" ' +
          'oninput="updateItem(' + idx + ', \'remarks\', this.value)">' +
      '</td>' +

      // ═══ REMOVE BUTTON ═══
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
// AUTO-SUGGEST — Item Code Input Handler
// ═══════════════════════════════════════════════════════════
function onMrrItemCodeInput(idx, value) {
  var input = document.getElementById('mrrItemCode' + idx);
  var dropdown = document.getElementById('mrrDropdown' + idx);
  if (!input || !dropdown) return;

  var term = String(value || '').toLowerCase().trim();

  // Clear previous timer
  if (_mrrSearchTimers[idx]) clearTimeout(_mrrSearchTimers[idx]);

  if (!term || term.length < 2) {
    dropdown.classList.add('d-none');
    return;
  }

  // Show loading state
  dropdown.innerHTML = '<div class="item-search-item muted">' +
    '<i class="bi bi-hourglass-split me-2"></i>Searching...</div>';
  _positionMrrDropdown(dropdown, input);
  dropdown.classList.remove('d-none');

  // Debounce search — 200ms
  _mrrSearchTimers[idx] = setTimeout(async function() {
    await _mrrSearchItems(idx, term);
  }, 200);
}

async function _mrrSearchItems(idx, term) {
  var input = document.getElementById('mrrItemCode' + idx);
  var dropdown = document.getElementById('mrrDropdown' + idx);
  if (!input || !dropdown) return;

  try {
    // Load inventory cache if not yet loaded
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

    // Filter matches
    var matches = items.filter(function(it) {
      var code = String(it.code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
    }).slice(0, 30);

    // Sort: exact > starts-with > contains
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

    // Build dropdown
    var html = '';
    matches.forEach(function(it) {
      var code = String(it.code || '');
      var desc = String(it.description || '');
      var unit = String(it.unit || 'PCS');
      var category = String(it.category || '');

      // Escape for JS inline
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
  // Update state
  if (_mrrState.items[idx]) {
    _mrrState.items[idx].itemCode = code;
    _mrrState.items[idx].description = description;
    _mrrState.items[idx].unit = unit;
  }

  // Update UI inputs
  var codeInput = document.getElementById('mrrItemCode' + idx);
  var descInput = document.getElementById('mrrItemDesc' + idx);
  var unitInput = document.getElementById('mrrItemUnit' + idx);

  if (codeInput) codeInput.value = code;
  if (descInput) descInput.value = description;
  if (unitInput) unitInput.value = unit;

  // Hide dropdown
  var dropdown = document.getElementById('mrrDropdown' + idx);
  if (dropdown) dropdown.classList.add('d-none');

  // Highlight the row
  var row = document.querySelector('tr[data-idx="' + idx + '"]');
  if (row) {
    row.classList.add('selected-item-row');
    setTimeout(function() { row.classList.remove('selected-item-row'); }, 1500);
  }

  // Focus ATL Qty
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
  // Delay para ma-click ang dropdown item
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

// ═══════════════════════════════════════════════════════════
// LOAD INVENTORY CACHE (for autocomplete)
// ═══════════════════════════════════════════════════════════
async function _mrrLoadInventory() {
  console.log('[MRR v3] Loading inventory for autocomplete...');
  try {
    // Use shared helper if available
    if (typeof erpGetInventoryListForDropdown === 'function') {
      var list = await erpGetInventoryListForDropdown();
      console.log('[MRR v3] Inventory loaded (shared):', list.length, 'items');
      return list;
    }

    // Fallback: paginated fetch
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

    console.log('[MRR v3] Inventory loaded (fallback):', mapped.length, 'items');
    return mapped;
  } catch(err) {
    console.warn('[MRR v3] Inventory load failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT MRR
// ═══════════════════════════════════════════════════════════
async function submitMrr() {
  if (_mrrState.isSubmitting) return;

  var now = Date.now();
  if (_mrrState.lastSubmittedAt && (now - _mrrState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait a moment before submitting again', 'warning');
    return;
  }

  var drNo = document.getElementById('mrrDrNo').value.trim();
  if (!drNo) {
    erpShowToast('DR No. / S.I. No. is required', 'warning');
    document.getElementById('mrrDrNo').focus();
    return;
  }
  _mrrState.drNo = drNo;

  var receivingDate = document.getElementById('mrrReceivingDate').value;
  if (!receivingDate) {
    erpShowToast('Receiving Date is required', 'warning');
    return;
  }
  _mrrState.receivingDate = receivingDate;

  var receivingSite = document.getElementById('mrrReceivingSite').value.trim();
  if (!receivingSite) {
    erpShowToast('Receiving Site is required', 'warning');
    return;
  }
  _mrrState.receivingSite = receivingSite;

  var vendor = document.getElementById('mrrVendor').value.trim();
  _mrrState.vendor = vendor;

  var prfNo = document.getElementById('mrrPrfNo').value.trim();
  _mrrState.prfNo = prfNo;

  if (_mrrState.items.length === 0) {
    erpShowToast('No items to submit', 'warning');
    return;
  }

  var validItems = [];
  for (var i = 0; i < _mrrState.items.length; i++) {
    var it = _mrrState.items[i];
    if (!it.itemCode || !it.itemCode.trim()) {
      erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning');
      return;
    }
    if (it.issuedQty < 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid qty', 'warning');
      return;
    }
    validItems.push(it);
  }

  if (!confirm('Create MRR with ' + validItems.length + ' item(s)?')) return;

  _mrrState.isSubmitting = true;
  _mrrState.lastSubmittedAt = now;

  var btn = document.getElementById('btnSubmitMrr');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    // ─── Step 1: RPC for doc number ───
    console.log('[Submit MRR] Calling RPC...');
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: 'MRR' })
    });

    if (!rpcRes.ok) throw new Error('RPC failed: ' + rpcRes.status);
    var nextNum = await rpcRes.json();
    if (!nextNum || typeof nextNum !== 'number') {
      throw new Error('Invalid RPC response');
    }

    var padded = String(nextNum).padStart(7, '0');
    var docNo = 'MRR' + padded;
    console.log('[Submit MRR] Doc No:', docNo);

    // ─── Step 2: Determine overall status ───
    var allComplete = validItems.every(function(it) {
      return it.issuedQty >= it.requestedQty && it.requestedQty > 0;
    });
    var anyReceived = validItems.some(function(it) {
      return it.issuedQty > 0;
    });

    var overallStatus = (allComplete && anyReceived) ? 'COMPLETED' :
                        (anyReceived ? 'PARTIAL' : 'PENDING');

    console.log('[Submit MRR] Final status will be:', overallStatus);

    // ─── Step 3: Insert document ───
        var docRes = await fetch(erpUrl('documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: 'MRR',
        status: 'PENDING',
        is_bal: false,
        requestor: _mrrState.preparedBy,
        department: '',
        po_no: _mrrState.poNo || '',
        prf_no: _mrrState.prfNo,
        vendor: _mrrState.vendor,
        client_name: _mrrState.client || '',
        dr_no: _mrrState.drNo,
        receiving_site: _mrrState.receivingSite,
        receiving_date: _mrrState.receivingDate,
        date_prepared: new Date().toISOString().split('T')[0],  // ✅ ITO!
        prepared_by: _mrrState.preparedBy,
        item_count: validItems.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!docRes.ok) {
      var errText = await docRes.text();
      throw new Error('Insert doc failed: ' + docRes.status + ' ' + errText);
    }

    var docArr = await docRes.json();
    var doc = docArr[0];
    if (!doc || !doc.id) throw new Error('No document ID returned');

    console.log('[Submit MRR] Document inserted:', docNo);

    // ─── Step 4: Insert doc_items ───
    var itemPayloads = validItems.map(function(it, idx) {
      var itemStatus = it.issuedQty >= it.requestedQty ? 'COMPLETE' :
                       (it.issuedQty > 0 ? 'PARTIAL' : 'PENDING');
      return {
        document_id: doc.id,
        doc_no: docNo,
        line_no: idx + 1,
        item_code: it.itemCode,
        description: it.description,
        requested_qty: it.requestedQty || it.issuedQty,
        issued_qty: it.issuedQty,
        unit: it.unit,
        remarks: it.remarks || itemStatus,
        row_index: idx + 1
      };
    });

    var itemsRes = await fetch(erpUrl('doc_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(itemPayloads)
    });

    if (!itemsRes.ok) {
      var itemsErrText = await itemsRes.text();
      throw new Error('Insert items failed: ' + itemsRes.status + ' ' + itemsErrText);
    }

    console.log('[Submit MRR] Items inserted:', validItems.length);

    // ─── Step 5: PATCH documents to final status ───
    if (overallStatus !== 'PENDING') {
      console.log('[Submit MRR] Patching status to:', overallStatus);

      var patchRes = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(docNo)), {
        method: 'PATCH',
        headers: erpHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify({
          status: overallStatus,
          processed_by: _mrrState.preparedBy,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
      });

      if (!patchRes.ok) {
        var patchErrText = await patchRes.text();
        console.error('[Submit MRR] PATCH failed:', patchErrText);
        erpShowToast('⚠️ MRR created but status update may have failed', 'warning');
      } else {
        console.log('[Submit MRR] Status patched to:', overallStatus);
      }
    }

    // ─── Success ───
    erpShowToast('✅ MRR created: ' + docNo + ' (' + overallStatus + ')', 'success');
    showSuccessModal(docNo);

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
function showSuccessModal(docNo) {
  document.getElementById('successDocNo').textContent = docNo;

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
  _mrrState.prfNo = '';
  _mrrState.client = '';
  _mrrState.vendor = '';
  _mrrState.drNo = '';
  _mrrState.items = [];

  document.getElementById('mrrPoNo').value = '';
  document.getElementById('mrrPrfNo').value = '';
  document.getElementById('mrrVendor').value = '';
  document.getElementById('mrrDrNo').value = '';
  document.getElementById('poStatus').innerHTML = '';
  document.getElementById('poLookupResult').className = 'alert alert-secondary mb-0 py-2';
  document.getElementById('poLookupResult').innerHTML = '<span class="text-muted small">Enter a PO No. above to auto-load items, or skip to add items manually.</span>';

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

console.log('✅ new-mrr.js v3 loaded (with auto-suggest)');
