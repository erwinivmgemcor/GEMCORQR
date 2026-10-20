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

  var step2 = document.getElementById('step2Card');
  var step3 = document.getElementById('step3Card');
  var step4 = document.getElementById('step4Card');
  if (step2) step2.style.display = 'none';
  if (step3) step3.style.display = 'none';
  if (step4) step4.style.display = 'none';

 var addItemBtn = document.querySelector('#step3Card .btn-primary');
if (addItemBtn) addItemBtn.style.display = 'inline-block';
  
  // I-update ang alert message sa loob ng step 3
  var itemsTable = document.querySelector('#step3Card .table-responsive');
  if (itemsTable) {
    itemsTable.innerHTML = '<div class="text-center py-5 text-muted">' +
      '<i class="bi bi-inbox fs-1 d-block mb-3 opacity-50"></i>' +
      '<h5>No PO Loaded</h5>' +
      '<p class="small mb-0">Please enter a valid PO No. above and click "Lookup" to auto-load items.<br>' +
      'If this is a manual/legacy receipt without a PO, please use the <a href="new-mrr-manual.html" class="fw-bold text-primary">Manual MRR Entry</a>.</p>' +
      '</div>';
  }

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
// PO LOOKUP — with fallback to erp_prf_po_cache
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
    // ═══ STEP 1: Try prf_items first ═══
    console.log('[MRR Lookup] Querying prf_items for po_no=' + poNo);
    var rows = await erpFetch('prf_items',
      'po_no=eq.' + encodeURIComponent(poNo) + '&order=line_no.asc&limit=500');

    var source = 'prf_items';

    // ═══ STEP 2: Fallback to erp_prf_po_cache ═══
    if (!rows || rows.length === 0) {
      console.log('[MRR Lookup] Not in prf_items, trying erp_prf_po_cache...');
      try {
        var cacheRows = await erpFetch('erp_prf_po_cache',
          'po_no=eq.' + encodeURIComponent(poNo) + '&order=item_no.asc&limit=500');

        if (cacheRows && cacheRows.length > 0) {
          console.log('[MRR Lookup] Found ' + cacheRows.length + ' items in po_cache');
          rows = cacheRows.map(function(r) {
            return {
              prf_no: r.prf_no || '',
              item_code: r.inventory_id || '',
              description: r.description || '',
              qty_for_order: Number(r.qty || 0),
              unit: r.unit || 'PCS',
              line_no: r.item_no || 0,
              po_supplier: r.supplier || '',
              _source: 'po_cache'
            };
          });
          source = 'po_cache';
        }
      } catch(cacheErr) {
        console.warn('[MRR Lookup] po_cache query failed:', cacheErr.message);
      }
    }

    // ═══ STEP 3: Not found in either ═══
    if (!rows || rows.length === 0) {
      statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> PO No. not found</span>';
      resultEl.className = 'alert alert-warning mb-0 py-2';
      resultEl.innerHTML = '<span class="small"><i class="bi bi-exclamation-triangle me-1"></i>' +
        'PO No. <strong>' + erpEsc(poNo) + '</strong> not found in PRF records or PO cache. ' +
        'You can still add items manually below.</span>';
      return;
    }

    console.log('[MRR Lookup] Found ' + rows.length + ' items (source: ' + source + ')');

    var first = rows[0];
    _mrrState.poNo = poNo;
    _mrrState.prfNo = first.prf_no || '';
    _mrrState.client = first.po_supplier || '';
    _mrrState.vendor = first.po_supplier || '';

    document.getElementById('mrrPrfNo').value = _mrrState.prfNo;
    document.getElementById('mrrVendor').value = _mrrState.vendor;

    // ═══ Build items ═══
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

    // ✅ IPAKITA ANG FORM KAPAG MAY NAKITANG PO
    var step2 = document.getElementById('step2Card');
    var step3 = document.getElementById('step3Card');
    var step4 = document.getElementById('step4Card');
    if (step2) step2.style.display = 'block';
    if (step3) step3.style.display = 'block';
    if (step4) step4.style.display = 'block';

    // I-restore yung table view para sa items
    var itemsTable = document.querySelector('#step3Card .table-responsive');
    if (itemsTable) {
      itemsTable.innerHTML = '<table class="erp-table" id="itemsTable">' +
        '<thead><tr>' +
          '<th style="width:5%">#</th>' +
          '<th style="width:20%">Item Code</th>' +
          '<th style="width:25%">Description</th>' +
          '<th style="width:9%" class="text-center">Req Qty</th>' +
          '<th style="width:9%" class="text-center">ATL Qty</th>' +
          '<th style="width:8%" class="text-center">Unit</th>' +
          '<th style="width:14%">Remarks</th>' +
          '<th style="width:6%"></th>' +
        '</tr></thead>' +
        '<tbody id="itemsBody"></tbody>' +
      '</table>';
      renderItems();
    }

    var sourceLabel = source === 'po_cache' ? ' <em>(from PO cache)</em>' : '';
    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> PO No. found!</span>';
    resultEl.className = 'alert alert-success mb-0 py-2';
    resultEl.innerHTML = '<span class="small"><i class="bi bi-check-circle me-1"></i>' +
      'Found: <strong>' + erpEsc(_mrrState.prfNo || poNo) + '</strong>' + sourceLabel + ' — ' +
      erpEsc(_mrrState.client || 'No client') + ' (' + rows.length + ' items)</span>';

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
  if (!_mrrState.poNo) {
    erpShowToast('Please lookup a valid PO No. first. For manual entry, use the Manual MRR page.', 'warning');
    return;
  }
  
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
      'Click "+ Add Item" to start, or enter PO No. above to auto-load items.</td></tr>';
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

  var now = Date.now();
  if (_mrrState.lastSubmittedAt && (now - _mrrState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait a moment before submitting again', 'warning');
    return;
  }

  var drNo = document.getElementById('mrrDrNo').value.trim();
  if (!drNo) { erpShowToast('DR No. / S.I. No. is required', 'warning'); return; }
  _mrrState.drNo = drNo;

  var receivingDate = document.getElementById('mrrReceivingDate').value;
  if (!receivingDate) { erpShowToast('Receiving Date is required', 'warning'); return; }
  _mrrState.receivingDate = receivingDate;

  var receivingSite = document.getElementById('mrrReceivingSite').value.trim();
  if (!receivingSite) { erpShowToast('Receiving Site is required', 'warning'); return; }

  var vendor = document.getElementById('mrrVendor').value.trim();
  var prfNo = document.getElementById('mrrPrfNo').value.trim();
  var sofNo = document.getElementById('mrrSofNoDisplay').value.trim() || document.getElementById('mrrSofNo').value.trim();
  
  _mrrState.vendor = vendor;
  _mrrState.prfNo = prfNo;
  _mrrState.sofNo = sofNo;

  if (_mrrState.items.length === 0) { erpShowToast('No items to submit', 'warning'); return; }

  var validItems = [];
  for (var i = 0; i < _mrrState.items.length; i++) {
    var it = _mrrState.items[i];
    if (!it.itemCode || !it.itemCode.trim()) { erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning'); return; }
    if (it.issuedQty < 0) { erpShowToast('Item #' + (i + 1) + ' has invalid qty', 'warning'); return; }
    
    validItems.push({
      item_code: it.itemCode,
      description: it.description,
      qty: it.requestedQty,
      atl_qty: it.issuedQty,
      unit: it.unit,
      remarks: it.remarks || (it.issuedQty >= it.requestedQty ? 'COMPLETE' : 'PARTIAL')
    });
  }

  if (!confirm('Create MRR with ' + validItems.length + ' item(s)?')) return;

  _mrrState.isSubmitting = true;
  _mrrState.lastSubmittedAt = now;

  var btn = document.getElementById('btnSubmitMrr');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    // 1. Kunin ang susunod na Doc No
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
    
    // Compute overall status
    var isComplete = validItems.every(function(it) { return it.atl_qty >= it.qty; });
    var isPartial = validItems.some(function(it) { return it.atl_qty > 0; });
    var finalStatus = isComplete ? 'COMPLETED' : (isPartial ? 'PARTIAL' : 'PENDING');

    var docPayload = {
      doc_no: docNo,
      doc_type: 'MRR',
      status: finalStatus,
      requestor: _mrrState.preparedBy,
      department: '',
      po_no: _mrrState.poNo || '',
      sof_no: _mrrState.sofNo || '',
      prf_no: _mrrState.prfNo,
      vendor: _mrrState.vendor,
      client_name: _mrrState.client || '',
      dr_no: _mrrState.drNo,
      receiving_site: _mrrState.receivingSite,
      receiving_date: _mrrState.receivingDate,
      date_prepared: new Date().toISOString().split('T')[0],
      prepared_by: _mrrState.preparedBy,
      item_count: validItems.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 2. Insert Document
    var docRes = await fetch(erpUrl('documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(docPayload)
    });

    if (!docRes.ok) {
      var errText = await docRes.text();
      throw new Error('Insert Document failed: ' + docRes.status + ' ' + errText);
    }

    var docArr = await docRes.json();
    var doc = docArr[0];
    if (!doc || !doc.id) throw new Error('No document ID returned');

    // 3. Insert Doc Items
    var itemPayloads = validItems.map(function(it, idx) {
      return {
        document_id: doc.id,
        doc_no: docNo,
        line_no: idx + 1,
        item_code: it.item_code,
        description: it.description,
        requested_qty: it.qty,
        issued_qty: it.atl_qty,
        unit: it.unit,
        remarks: it.remarks,
        row_index: idx + 1
      };
    });

       if (!itemsRes.ok) {
      var itemsErrText = await itemsRes.text();
      throw new Error('Insert Items failed: ' + itemsRes.status + ' ' + itemsErrText);
    }

    // ═══════════════════════════════════════════════════════════
    // ✅ TATAWAGIN NATIN ANG BAGONG RPC PARA SA SOF ALLOCATION
    // ═══════════════════════════════════════════════════════════
    if (_mrrState.sofNo && _mrrState.sofNo.trim()) {
      try {
        var sofRes = await fetch(erpUrl('rpc/erp_process_mrr_sof'), {
          method: 'POST',
          headers: erpHeaders(),
          body: JSON.stringify({ p_doc_no: docNo })
        });
        if (sofRes.ok) {
          console.log('[MRR] ✅ SOF Allocation successful');
        } else {
          console.warn('[MRR] SOF allocation failed:', await sofRes.text());
        }
      } catch(sofErr) {
        console.warn('[MRR] SOF allocation RPC error:', sofErr);
      }
    }

    // Success!
    erpShowToast('✅ MRR created: ' + docNo + ' (' + finalStatus + ')', 'success');
    
    // I-refresh ang data sa background
    if (typeof fetchPendingDocs === 'function') fetchPendingDocs(true);
    if (typeof loadWarehouseNotifications === 'function') loadWarehouseNotifications(true);
    if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();

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
function showSuccessModal(docNo, sofInfo) {
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

console.log('✅ new-mrr.js v5.0 loaded (Direct Insert + Clean)');
