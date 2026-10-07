// ============================================================
// GEMCOR ERP — Create PRF (v2.1)
// Two Modes: "From Reorder List" + "Manual Entry"
// Auto-suggest item + suggested qty
// ✅ FIXED: Dropdown positioning (fixed, wide, auto-flip)
// ============================================================

var MAX_ITEMS_PER_PRF = 30;

var _prf = {
  mode: 'reorder',           // 'reorder' | 'manual'
  items: [],                 // reorder items (from reorder list)
  selectedItems: [],         // selected reorder items
  manualItems: [],           // manually added items
  reorderList: [],
  pendingPrfItems: {},
  inventoryList: [],         // for search (from inventory table)
  inventoryLoaded: false,
  erpItemsMap: {},           // item_code → { buffer_stock, on_hand, ... }
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Create PRF v2.1] Initializing...');

  prfCheckHealth();
  initUserInfo();
  generatePrfNo();
  loadReorderList();
  loadPendingPrfItems();
  preloadInventoryForSearch();
  preloadErpItemsMap();

  // Category change handler
  var catEl = document.getElementById('prfCategory');
  if (catEl) {
    catEl.addEventListener('change', onCategoryChange);
  }
});

async function prfCheckHealth() {
  try {
    var result = await erpHealthCheck();
    var badge = document.getElementById('erpHealthBadge');
    if (!badge) return;
    var text = document.getElementById('erpHealthText');
    var dot = badge.querySelector('.dot');
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(e) {}
}

function initUserInfo() {
  var fullname = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
  var department = localStorage.getItem('ivm_userDepartment') || '';
  document.getElementById('prfPreparedBy').value = fullname;
  document.getElementById('prfDepartment').value = department;
}

function generatePrfNo() {
  var now = new Date();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  document.getElementById('prfNo').value = 'PRF#' + month + '-' + day;
}

// ═══════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════
function prfSwitchMode(mode) {
  _prf.mode = mode;

  document.querySelectorAll('.prf-mode-tab').forEach(function(el) {
    el.classList.toggle('active', el.dataset.mode === mode);
  });

  var reorderContent = document.getElementById('modeReorder');
  var manualContent = document.getElementById('modeManual');

  if (reorderContent) reorderContent.classList.toggle('active', mode === 'reorder');
  if (manualContent) manualContent.classList.toggle('active', mode === 'manual');

  // Update category hint
  var hint = document.getElementById('categoryHint');
  if (hint) {
    hint.textContent = mode === 'reorder'
      ? 'Required — pinipili kung anong category ng PRF.'
      : 'Required — parehong category ang gagamitin sa submission.';
  }

  updateSubmitButton();
}

window.prfSwitchMode = prfSwitchMode;

// ═══════════════════════════════════════════════════════════
// UNIQUE PRF NO CHECK
// ═══════════════════════════════════════════════════════════
async function checkPrfNoAvailable(prfNo) {
  try {
    var res = await erpFetch('prf_documents',
      'prf_no=eq.' + encodeURIComponent(prfNo) + '&select=id&limit=1');
    return (!res || res.length === 0);
  } catch(e) {
    console.warn('[checkPrfNoAvailable]', e.message);
    return true;
  }
}

async function generateUniquePrfNo(basePrfNo) {
  var candidate = basePrfNo;
  var suffix = 1;

  while (!(await checkPrfNoAvailable(candidate))) {
    suffix++;
    candidate = basePrfNo + '-' + suffix;
    if (suffix > 100) throw new Error('Cannot generate unique PRF No.');
  }

  return candidate;
}

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function loadReorderList() {
  try {
    var rows = await erpFetch('erp_v_reorder_list', 'select=*');
    _prf.reorderList = rows || [];
    console.log('[PRF] Reorder list:', _prf.reorderList.length, 'items');
  } catch(err) {
    console.error('[PRF] Load failed:', err);
    erpShowToast('Failed to load reorder list: ' + err.message, 'danger');
  }
}

async function loadPendingPrfItems() {
  try {
    var rows = await erpFetch('erp_v_prf_pending_items', 'select=*');
    _prf.pendingPrfItems = {};
    (rows || []).forEach(function(r) {
      var code = String(r.item_code || '').trim();
      if (!code) return;
      if (!_prf.pendingPrfItems[code]) _prf.pendingPrfItems[code] = [];
      _prf.pendingPrfItems[code].push({
        prf_no: r.prf_no,
        status: r.status,
        qty: Number(r.qty_for_order || 0)
      });
    });
    console.log('[PRF] Pending items:', Object.keys(_prf.pendingPrfItems).length);
  } catch(err) {
    console.warn('[PRF] Pending items load failed:', err.message);
  }
}

async function preloadInventoryForSearch() {
  if (_prf.inventoryLoaded) return;
  try {
    var rows = await erpFetch('inventory',
      'select=item_code,description,unit,item_class&order=item_code.asc&limit=10000');
    _prf.inventoryList = (rows || []).map(function(r) {
      return {
        code: r.item_code,
        description: r.description || '',
        unit: r.unit || 'PCS',
        itemClass: r.item_class || ''
      };
    });
    _prf.inventoryLoaded = true;
    console.log('[PRF] Inventory loaded:', _prf.inventoryList.length);
  } catch(err) {
    console.warn('[PRF] Inventory load failed:', err.message);
  }
}

async function preloadErpItemsMap() {
  try {
    // Fetch key fields para sa suggested qty calculation
    var rows = await erpFetch('erp_items',
      'select=item_code,buffer_stock,on_hand,ave_monthly_consumption,base_unit,location,category&limit=10000');

    _prf.erpItemsMap = {};
    (rows || []).forEach(function(r) {
      _prf.erpItemsMap[String(r.item_code || '').trim()] = {
        buffer_stock: Number(r.buffer_stock || 0),
        on_hand: Number(r.on_hand || 0),
        ave_monthly_consumption: Number(r.ave_monthly_consumption || 0),
        base_unit: r.base_unit || 'PCS',
        location: r.location || '',
        category: r.category || ''
      };
    });
    console.log('[PRF] ERP items map loaded:', Object.keys(_prf.erpItemsMap).length);
  } catch(err) {
    console.warn('[PRF] ERP items preload failed:', err.message);
    _prf.erpItemsMap = {};
  }
}

function getSuggestedQty(itemCode) {
  var item = _prf.erpItemsMap[String(itemCode || '').trim()];
  if (!item) return 0;
  var diff = item.buffer_stock - item.on_hand;
  if (diff > 0) return Math.ceil(diff);
  return 0;
}

// ═══════════════════════════════════════════════════════════
// CATEGORY CHANGE (for Reorder mode)
// ═══════════════════════════════════════════════════════════
function onCategoryChange() {
  if (_prf.mode !== 'reorder') return;

  var category = document.getElementById('prfCategory').value;
  var container = document.getElementById('reorderItemsContainer');

  if (!category) {
    container.innerHTML = '<div class="text-center text-muted py-4">' +
      '<i class="bi bi-inbox fs-1 d-block mb-2"></i>' +
      '<div>Select a category above to load items.</div></div>';
    _prf.items = [];
    updateSubmitButton();
    return;
  }

  _prf.items = _prf.reorderList.filter(function(it) {
    return String(it.category || '').toUpperCase() === category;
  });

  console.log('[PRF] Category:', category, 'Items:', _prf.items.length);
  renderReorderItems();
}

// ═══════════════════════════════════════════════════════════
// RENDER REORDER ITEMS (existing logic)
// ═══════════════════════════════════════════════════════════
function renderReorderItems() {
  var container = document.getElementById('reorderItemsContainer');
  if (!container) return;

  if (_prf.items.length === 0) {
    container.innerHTML =
      '<div class="alert alert-info mb-0">' +
      '<i class="bi bi-info-circle me-2"></i>' +
      'No items found for this category in the reorder list. ' +
      'You can switch to <strong>Manual Entry</strong> to add items manually.</div>';
    updateSubmitButton();
    return;
  }

  var html = '<div class="table-responsive">';
  html += '<table class="erp-table" style="font-size:0.82rem;">';
  html += '<thead><tr>' +
    '<th style="width:3%"><input type="checkbox" id="selectAllChk" onchange="toggleSelectAll(this.checked)"></th>' +
    '<th style="width:4%">#</th>' +
    '<th style="width:10%">Item Code</th>' +
    '<th style="width:20%">Description</th>' +
    '<th style="width:7%" class="text-center">Location</th>' +
    '<th style="width:6%" class="text-center">On-Hand</th>' +
    '<th style="width:6%" class="text-center">Buffer</th>' +
    '<th style="width:6%" class="text-center">Ave/Mo</th>' +
    '<th style="width:7%" class="text-center">Suggested</th>' +
    '<th style="width:8%" class="text-center">Qty For Order</th>' +
    '<th style="width:5%" class="text-center">Unit</th>' +
    '<th style="width:14%">Remarks</th>' +
  '</tr></thead><tbody>';

  _prf.items.forEach(function(it, idx) {
    var suggested = computeSuggested(it);
    var isSelected = it._selected === true;
    var qtyOrder = it._qtyOrder !== undefined ? it._qtyOrder : 0;
    var remarks = it._remarks || '';

    var pendingInfo = _prf.pendingPrfItems[it.item_code] || [];
    var pendingWarning = '';
    if (pendingInfo.length > 0) {
      var pendingText = pendingInfo.map(function(p) {
        return p.prf_no + ' (' + p.status + ')';
      }).join(', ');
      pendingWarning = ' <span class="badge bg-warning text-dark" title="Already in: ' + 
        erpEsc(pendingText) + '">⚠ PENDING</span>';
    }

    var urgencyBadge = '';
    if (it.urgency === 'CRITICAL') urgencyBadge = ' <span class="badge bg-danger">CRIT</span>';
    else if (it.urgency === 'URGENT') urgencyBadge = ' <span class="badge bg-warning text-dark">URG</span>';

    html += '<tr data-idx="' + idx + '"' + (isSelected ? ' style="background:#ecfdf5;"' : '') + '>' +
      '<td><input type="checkbox" class="item-select-chk" data-idx="' + idx + '"' + (isSelected ? ' checked' : '') + ' onchange="toggleItemSelect(' + idx + ', this.checked)"></td>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code>' + urgencyBadge + pendingWarning + '</td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-center">' + erpNum(it.on_hand || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.buffer_stock || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.ave_monthly_consumption || 0) + '</td>' +
      '<td class="text-center" style="color:#6b7280;font-style:italic;">' + erpNum(suggested) + '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm qty-order-input" ' +
        'data-idx="' + idx + '" value="' + qtyOrder + '" min="0" step="1" ' +
        'placeholder="' + Math.ceil(suggested) + '" onchange="updateQty(' + idx + ', this.value)">' +
      '</td>' +
      '<td class="text-center">' +
        '<select class="form-select form-select-sm unit-select" data-idx="' + idx + '" onchange="updateUnit(' + idx + ', this.value)" style="font-size:0.75rem;padding:2px 4px;">' +
          buildUnitOptions(it.base_unit || 'PIECE') +
        '</select>' +
      '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm remarks-input" ' +
        'data-idx="' + idx + '" value="' + erpEsc(remarks) + '" placeholder="Optional" ' +
        'onchange="updateRemarks(' + idx + ', this.value)">' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';

  recomputeSelected();
  var totalQty = _prf.selectedItems.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);

  var batchingInfo = '';
  if (_prf.selectedItems.length > MAX_ITEMS_PER_PRF) {
    var batches = Math.ceil(_prf.selectedItems.length / MAX_ITEMS_PER_PRF);
    batchingInfo = '<span class="text-warning ms-3">' +
      '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
      'Will split into <strong>' + batches + '</strong> PRFs' +
      '</span>';
  }

  html += '<div class="mt-3 d-flex justify-content-between align-items-center flex-wrap gap-2">';
  html += '<div class="small text-muted">' +
    '<i class="bi bi-info-circle me-1"></i>' +
    'Suggested qty = (Buffer − On-Hand)' +
    batchingInfo + '</div>';
  html += '<div><strong>Selected:</strong> ' + _prf.selectedItems.length +
    ' items · <strong>Total Qty:</strong> ' + erpNum(totalQty) + '</div>';
  html += '</div>';

  container.innerHTML = html;

  updateItemsCount();
  updateSubmitButton();
}

function computeSuggested(it) {
  var buffer = Number(it.buffer_stock || 0);
  var onHand = Number(it.on_hand || 0);
  var diff = buffer - onHand;
  if (diff > 0) return Math.ceil(diff);
  return Number(it.suggested_order_qty || 0);
}

// ═══════════════════════════════════════════════════════════
// SELECTION (Reorder mode)
// ═══════════════════════════════════════════════════════════
function toggleItemSelect(idx, checked) {
  var item = _prf.items[idx];
  if (!item) return;
  item._selected = checked;
  if (checked && (!item._qtyOrder || item._qtyOrder === 0)) {
    item._qtyOrder = computeSuggested(item);
  } else if (!checked) {
    item._qtyOrder = 0;
  }
  recomputeSelected();
  renderReorderItems();
}

window.toggleItemSelect = toggleItemSelect;

function toggleSelectAll(checked) {
  _prf.items.forEach(function(it) {
    it._selected = checked;
    if (checked) {
      it._qtyOrder = computeSuggested(it);
    } else {
      it._qtyOrder = 0;
    }
  });
  recomputeSelected();
  renderReorderItems();
}

window.toggleSelectAll = toggleSelectAll;

function updateQty(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  var qty = parseFloat(value) || 0;
  if (qty < 0) qty = 0;
  item._qtyOrder = qty;
  if (qty > 0) item._selected = true;
  recomputeSelected();
  updateSubmitButton();
}

window.updateQty = updateQty;

function updateUnit(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  item.base_unit = value;
}

window.updateUnit = updateUnit;

function updateRemarks(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  item._remarks = String(value || '').trim();
}

window.updateRemarks = updateRemarks;

function recomputeSelected() {
  _prf.selectedItems = _prf.items.filter(function(it) {
    return it._selected && (it._qtyOrder || 0) > 0;
  });
}

// ═══════════════════════════════════════════════════════════
// MANUAL ITEMS
// ═══════════════════════════════════════════════════════════
function addManualItem() {
  _prf.manualItems.push({
    inventoryId: '',
    description: '',
    qty: 0,
    unit: 'PIECE',
    remarks: ''
  });
  renderManualItems();
  updateSubmitButton();

  // Focus new input
  setTimeout(function() {
    var inputs = document.querySelectorAll('.manual-item-search-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
}

window.addManualItem = addManualItem;

function renderManualItems() {
  var container = document.getElementById('manualItemsContainer');
  var emptyState = document.getElementById('manualEmptyState');
  if (!container) return;

  if (_prf.manualItems.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.innerHTML = '';
    if (emptyState) container.appendChild(emptyState);
    updateManualCount();
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  var html = '';
  _prf.manualItems.forEach(function(it, idx) {
    var suggestedQty = getSuggestedQty(it.inventoryId);

    html += '<div class="manual-item-row" data-idx="' + idx + '">' +
      '<div class="row g-2 align-items-end">' +
        // Item Code (with search)
        '<div class="col-md-4">' +
          '<label class="form-label small fw-bold mb-1">Item Code <span class="text-danger">*</span></label>' +
          '<div class="item-search-wrapper">' +
            '<input type="text" class="form-control form-control-sm manual-item-search-input" ' +
              'data-idx="' + idx + '" ' +
              'value="' + erpEsc(it.inventoryId) + '" ' +
              'placeholder="Search item code or description..." ' +
              'autocomplete="off" ' +
              'oninput="onManualItemSearch(' + idx + ', this.value)" ' +
              'onfocus="onManualItemSearch(' + idx + ', this.value)">' +
            '<div class="item-search-dropdown d-none" id="manualDropdown' + idx + '"></div>' +
          '</div>' +
        '</div>' +
        // Description
        '<div class="col-md-3">' +
          '<label class="form-label small fw-bold mb-1">Description</label>' +
          '<input type="text" class="form-control form-control-sm" ' +
            'id="manualDesc' + idx + '" ' +
            'value="' + erpEsc(it.description) + '" ' +
            'readonly>' +
        '</div>' +
        // Qty
        '<div class="col-md-1">' +
          '<label class="form-label small fw-bold mb-1">Qty <span class="text-danger">*</span></label>' +
          '<input type="number" class="form-control form-control-sm text-center" ' +
            'id="manualQty' + idx + '" ' +
            'value="' + (it.qty || '') + '" ' +
            'min="1" step="1" ' +
            'oninput="onManualQtyChange(' + idx + ', this.value)">' +
          (suggestedQty > 0 ? '<div class="suggested-qty-hint">Suggested: <strong>' + suggestedQty + '</strong></div>' : '') +
        '</div>' +
        // Unit
        '<div class="col-md-1">' +
          '<label class="form-label small fw-bold mb-1">Unit</label>' +
          '<select class="form-select form-select-sm" id="manualUnit' + idx + '" onchange="onManualUnitChange(' + idx + ', this.value)">' +
            buildUnitOptions(it.unit || 'PIECE') +
          '</select>' +
        '</div>' +
        // Remarks
        '<div class="col-md-2">' +
          '<label class="form-label small fw-bold mb-1">Remarks</label>' +
          '<input type="text" class="form-control form-control-sm" ' +
            'id="manualRemarks' + idx + '" ' +
            'value="' + erpEsc(it.remarks || '') + '" ' +
            'placeholder="Optional" ' +
            'oninput="onManualRemarksChange(' + idx + ', this.value)">' +
        '</div>' +
        // Remove button
        '<div class="col-md-1">' +
          '<button type="button" class="btn btn-sm btn-outline-danger w-100" ' +
            'onclick="removeManualItem(' + idx + ')" title="Remove">' +
            '<i class="bi bi-trash"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;
  updateManualCount();
}

window.renderManualItems = renderManualItems;

// ═══════════════════════════════════════════════════════════
// MANUAL ITEM SEARCH (with FIXED dropdown positioning)
// ═══════════════════════════════════════════════════════════
function onManualItemSearch(idx, value) {
  var input = document.querySelector('.manual-item-search-input[data-idx="' + idx + '"]');
  var dropdown = document.getElementById('manualDropdown' + idx);
  if (!dropdown || !input) return;

  var term = String(value || '').toLowerCase().trim();

  if (!term) {
    dropdown.classList.add('d-none');
    return;
  }

  if (!_prf.inventoryLoaded) {
    dropdown.innerHTML = '<div class="item-search-item muted">Loading inventory...</div>';
    _positionDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    return;
  }

  var matches = _prf.inventoryList.filter(function(it) {
    var code = String(it.code || '').toLowerCase();
    var desc = String(it.description || '').toLowerCase();
    return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
  }).slice(0, 30);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="item-search-item muted">No matches found. You can type manually.</div>';
    _positionDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    return;
  }

  var html = '';
  matches.forEach(function(it) {
    var erpItem = _prf.erpItemsMap[it.code] || {};
    var suggested = getSuggestedQty(it.code);

    html += '<div class="item-search-item" onclick="selectManualItem(' + idx + ', \'' +
      erpJsEsc(it.code) + '\', \'' + erpJsEsc(it.description) + '\', \'' + erpJsEsc(it.unit) + '\')">' +
      '<div class="item-code">' + erpEsc(it.code) + '</div>' +
      '<div class="item-desc">' + erpEsc(it.description.substring(0, 100)) + '</div>' +
      '<div class="item-meta">' +
        '<span class="badge bg-light text-dark">' + erpEsc(it.unit || 'PCS') + '</span>' +
        (erpItem.on_hand !== undefined ? '<span>On-Hand: <strong>' + erpNum(erpItem.on_hand) + '</strong></span>' : '') +
        (erpItem.buffer_stock !== undefined ? '<span>Buffer: ' + erpNum(erpItem.buffer_stock) + '</span>' : '') +
        (suggested > 0 ? '<span class="text-warning">Suggested: <strong>' + suggested + '</strong></span>' : '') +
      '</div>' +
    '</div>';
  });

  dropdown.innerHTML = html;
  _positionDropdown(dropdown, input);
  dropdown.classList.remove('d-none');
}

window.onManualItemSearch = onManualItemSearch;

// ═══════════════════════════════════════════════════════════
// Position dropdown dynamically (para hindi ma-clip)
// ═══════════════════════════════════════════════════════════
function _positionDropdown(dropdown, input) {
  var rect = input.getBoundingClientRect();
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;
  var dropdownMinHeight = 320;

  // Set width — minimum 420px, maximum viewport width
  var width = Math.max(rect.width, 420);
  var maxWidth = window.innerWidth - rect.left - 20;
  if (width > maxWidth) width = maxWidth;

  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = width + 'px';
  dropdown.style.zIndex = '99999';

  // Position above or below?
  if (spaceBelow < dropdownMinHeight && spaceAbove > spaceBelow) {
    // Show ABOVE
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceAbove - 20, 320) + 'px';
  } else {
    // Show BELOW
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceBelow - 20, 320) + 'px';
  }
}

function selectManualItem(idx, code, description, unit) {
  var item = _prf.manualItems[idx];
  if (!item) return;

  item.inventoryId = code;
  item.description = description;
  item.unit = unit || 'PIECE';

  // Auto-fill suggested qty kung walang laman
  if (!item.qty || item.qty === 0) {
    item.qty = getSuggestedQty(code) || 1;
  }

  renderManualItems();
  updateSubmitButton();
}

window.selectManualItem = selectManualItem;

function onManualQtyChange(idx, value) {
  var item = _prf.manualItems[idx];
  if (!item) return;
  item.qty = parseFloat(value) || 0;
  updateSubmitButton();
}

window.onManualQtyChange = onManualQtyChange;

function onManualUnitChange(idx, value) {
  var item = _prf.manualItems[idx];
  if (!item) return;
  item.unit = value;
}

window.onManualUnitChange = onManualUnitChange;

function onManualRemarksChange(idx, value) {
  var item = _prf.manualItems[idx];
  if (!item) return;
  item.remarks = String(value || '').trim();
}

window.onManualRemarksChange = onManualRemarksChange;

function removeManualItem(idx) {
  if (!confirm('Remove this item?')) return;
  _prf.manualItems.splice(idx, 1);
  renderManualItems();
  updateSubmitButton();
}

window.removeManualItem = removeManualItem;

function updateManualCount() {
  var el = document.getElementById('manualItemsCount');
  if (el) el.textContent = _prf.manualItems.length + ' manual item(s)';
}

// ═══════════════════════════════════════════════════════════
// SUBMIT BUTTON STATE
// ═══════════════════════════════════════════════════════════
function updateSubmitButton() {
  var btn = document.getElementById('btnSubmitPrf');
  var summary = document.getElementById('submitSummary');
  if (!btn) return;

  var reorderCount = 0;
  var manualCount = 0;

  // Reorder items count
  if (_prf.mode === 'reorder') {
    recomputeSelected();
    reorderCount = _prf.selectedItems.length;
  } else {
    recomputeSelected();
    reorderCount = _prf.selectedItems.length;
  }

  // Manual items count
  manualCount = _prf.manualItems.filter(function(it) {
    return it.inventoryId && it.inventoryId.trim() && it.qty > 0;
  }).length;

  var totalValid = reorderCount + manualCount;

  // Category check
  var category = document.getElementById('prfCategory').value;
  if (!category) {
    btn.disabled = true;
    summary.textContent = 'Please select a category first.';
    return;
  }

  if (totalValid === 0) {
    btn.disabled = true;
    summary.textContent = 'Select items from reorder list OR add manual items.';
    return;
  }

  btn.disabled = false;

  var summaryParts = [];
  if (reorderCount > 0) summaryParts.push(reorderCount + ' reorder item(s)');
  if (manualCount > 0) summaryParts.push(manualCount + ' manual item(s)');
  summary.textContent = summaryParts.join(' + ') + ' ready to submit.';
}

function updateItemsCount() {
  var el = document.getElementById('itemsCountLabel');
  if (!el) return;
  var reorderCount = _prf.selectedItems.length;
  var manualCount = _prf.manualItems.length;
  var total = reorderCount + manualCount;
  el.textContent = '(' + total + ' items)';
}

// ═══════════════════════════════════════════════════════════
// SUBMIT PRF (UNIFIED)
// ═══════════════════════════════════════════════════════════
async function submitPrf() {
  if (_prf.isSubmitting) return;

  var prfNo = document.getElementById('prfNo').value.trim();
  var category = document.getElementById('prfCategory').value;
  var preparedBy = document.getElementById('prfPreparedBy').value.trim();
  var department = document.getElementById('prfDepartment').value.trim();
  var notedBy = document.getElementById('prfNotedBy').value.trim();
  var approvedBy = document.getElementById('prfApprovedBy').value.trim();
  var notes = document.getElementById('prfNotes').value.trim();

  if (!prfNo) { erpShowToast('PRF No. required', 'warning'); return; }
  if (!category) { erpShowToast('Category required', 'warning'); return; }

  // ─── Combine items from both modes ───
  var allItems = [];

  // 1. Reorder items
  recomputeSelected();
  _prf.selectedItems.forEach(function(it) {
    allItems.push({
      item_code: it.item_code,
      description: it.description || '',
      category: it.category || category,
      location: it.location || '',
      average_consumption: Number(it.ave_monthly_consumption || 0),
      buffer_stock: Number(it.buffer_stock || 0),
      stock_on_hand: Number(it.on_hand || 0),
      qty_for_order: Number(it._qtyOrder || 0),
      unit: it.base_unit || 'PIECE',
      remarks: it._remarks || '',
      source: 'reorder'
    });
  });

  // 2. Manual items
  _prf.manualItems.forEach(function(it) {
    if (!it.inventoryId || !it.inventoryId.trim()) return;
    if (!it.qty || it.qty <= 0) return;

    var erpItem = _prf.erpItemsMap[it.inventoryId] || {};
    allItems.push({
      item_code: it.inventoryId,
      description: it.description || '',
      category: category,
      location: erpItem.location || '',
      average_consumption: Number(erpItem.ave_monthly_consumption || 0),
      buffer_stock: Number(erpItem.buffer_stock || 0),
      stock_on_hand: Number(erpItem.on_hand || 0),
      qty_for_order: Number(it.qty),
      unit: it.unit || 'PIECE',
      remarks: it.remarks || '',
      source: 'manual'
    });
  });

  if (allItems.length === 0) {
    erpShowToast('Select at least one item with qty > 0', 'warning');
    return;
  }

  // Batching
  var batches = [];
  if (allItems.length > MAX_ITEMS_PER_PRF) {
    for (var i = 0; i < allItems.length; i += MAX_ITEMS_PER_PRF) {
      batches.push(allItems.slice(i, i + MAX_ITEMS_PER_PRF));
    }
  } else {
    batches.push(allItems);
  }

  // Auto-unique base PRF No.
  var isAvailable = await checkPrfNoAvailable(prfNo);
  if (!isAvailable) {
    var originalPrfNo = prfNo;
    prfNo = await generateUniquePrfNo(prfNo);
    console.log('[PRF] Auto-unique:', originalPrfNo, '→', prfNo);
    erpShowToast('PRF No. adjusted to ' + prfNo, 'info');
  }

  // Auto-unique batch PRF Nos
  for (var bIdx = 0; bIdx < batches.length; bIdx++) {
    var batchBase = prfNo + (bIdx === 0 ? '' : '.' + (bIdx + 1));
    var batchAvailable = await checkPrfNoAvailable(batchBase);
    if (!batchAvailable) {
      var counter = 2;
      var testNo;
      do {
        testNo = batchBase + '-' + counter;
        counter++;
      } while (!(await checkPrfNoAvailable(testNo)) && counter < 20);
      batches[bIdx]._prfNo = testNo;
    } else {
      batches[bIdx]._prfNo = batchBase;
    }
  }

  // Confirm
  var confirmMsg = 'Create PRF with ' + allItems.length + ' item(s)?\n\n';
  if (batches.length > 1) {
    confirmMsg += 'Will be split into ' + batches.length + ' batches:\n';
    batches.forEach(function(b) {
      confirmMsg += '  • ' + b._prfNo + ' (' + b.length + ' items)\n';
    });
    confirmMsg += '\n';
  }
  confirmMsg += 'Base PRF No.: ' + prfNo;
  confirmMsg += '\nTotal qty: ' + allItems.reduce(function(s, it) { return s + (it.qty_for_order || 0); }, 0);

  if (!confirm(confirmMsg)) return;

  _prf.isSubmitting = true;
  var btn = document.getElementById('btnSubmitPrf');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    var createdPrfs = [];

    for (var bIdx2 = 0; bIdx2 < batches.length; bIdx2++) {
      var batch = batches[bIdx2];
      var batchPrfNo = batch._prfNo;
      var result = await createSinglePrf(
        batchPrfNo, prfNo, bIdx2 + 1, batch,
        category, preparedBy, department, notedBy, approvedBy, notes
      );
      createdPrfs.push(result);
    }

    document.getElementById('successPrfNo').textContent = createdPrfs.map(function(p) { return p.prf_no; }).join(', ');
    document.getElementById('successItemCount').textContent = allItems.length;
    document.getElementById('successCategory').textContent = category;

    new bootstrap.Modal(document.getElementById('successModal')).show();

  } catch(err) {
    console.error('[submitPrf]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  } finally {
    _prf.isSubmitting = false;
  }
}

window.submitPrf = submitPrf;

async function createSinglePrf(prfNo, basePrfNo, batchNumber, items, category, preparedBy, department, notedBy, approvedBy, notes) {
  var totalQty = items.reduce(function(s, it) { return s + (it.qty_for_order || 0); }, 0);

  var docRes = await fetch(erpUrl('prf_documents'), {
    method: 'POST',
    headers: erpHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      prf_no: prfNo,
      base_prf_no: basePrfNo,
      batch_number: batchNumber,
      category: category,
      requestor: preparedBy,
      department: department,
      notes: notes,
      purpose: 'STOCK',
      total_items: items.length,
      total_qty: totalQty,
      prepared_by: preparedBy,
      noted_by: notedBy,
      approved_by: approvedBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });

  if (!docRes.ok) {
    var errText = await docRes.text();
    throw new Error('Insert PRF failed: ' + docRes.status + ' ' + errText.substring(0, 200));
  }

  var docArr = await docRes.json();
  var doc = docArr[0];
  if (!doc || !doc.id) throw new Error('No PRF ID');

  var itemPayloads = items.map(function(it, idx) {
    return {
      prf_id: doc.id,
      prf_no: prfNo,
      line_no: idx + 1,
      item_code: it.item_code,
      description: it.description || '',
      category: it.category || category,
      location: it.location || '',
      average_consumption: Number(it.average_consumption || 0),
      buffer_stock: Number(it.buffer_stock || 0),
      stock_on_hand: Number(it.stock_on_hand || 0),
      qty_for_order: Number(it.qty_for_order || 0),
      unit: it.unit || 'PIECE',
      status: 'UNSERVED',
      remarks: it.remarks || ''
    };
  });

  var itemsRes = await fetch(erpUrl('prf_items'), {
    method: 'POST',
    headers: erpHeaders(),
    body: JSON.stringify(itemPayloads)
  });

  if (!itemsRes.ok) {
    var itemsErrText = await itemsRes.text();
    throw new Error('Insert items failed: ' + itemsRes.status + ' ' + itemsErrText.substring(0, 200));
  }

  return { prf_no: prfNo, items: items.length };
}

function closeSuccessAndReset() {
  var modal = bootstrap.Modal.getInstance(document.getElementById('successModal'));
  if (modal) modal.hide();
  setTimeout(function() {
    window.location.href = 'prf-monitor.html';
  }, 300);
}

window.closeSuccessAndReset = closeSuccessAndReset;

function cancelCreate() {
  if (!confirm('Cancel? Unsaved data will be lost.')) return;
  window.location.href = 'prf-monitor.html';
}

window.cancelCreate = cancelCreate;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function buildUnitOptions(selected) {
  var units = ['PIECE', 'PCS', 'PAIR', 'SET', 'BOX', 'ROLL', 'SHEET',
    'KG', 'LITERS', 'GAL', 'METER', 'MM', 'LENGTH',
    'ASSEMB', 'CAN', 'REAM', 'TANK', 'UNIT'];
  var html = '';
  units.forEach(function(u) {
    var sel = (u === selected) ? ' selected' : '';
    html += '<option value="' + u + '"' + sel + '>' + u + '</option>';
  });
  return html;
}

function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpJsEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// ═══════════════════════════════════════════════════════════
// GLOBAL EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

// Close dropdown on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.item-search-wrapper') && !e.target.closest('.item-search-dropdown')) {
    document.querySelectorAll('.item-search-dropdown').forEach(function(el) {
      el.classList.add('d-none');
    });
  }
});

// Reposition dropdowns on scroll
window.addEventListener('scroll', function() {
  document.querySelectorAll('.item-search-dropdown:not(.d-none)').forEach(function(el) {
    var idx = el.id.replace('manualDropdown', '');
    var input = document.querySelector('.manual-item-search-input[data-idx="' + idx + '"]');
    if (input) _positionDropdown(el, input);
  });
}, { passive: true });

// Hide dropdowns on resize
window.addEventListener('resize', function() {
  document.querySelectorAll('.item-search-dropdown:not(.d-none)').forEach(function(el) {
    el.classList.add('d-none');
  });
});

console.log('✅ new-prf.js v2.1 loaded (two modes + auto-suggest + fixed dropdown)');
