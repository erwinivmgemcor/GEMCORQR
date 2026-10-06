// ============================================================
// GEMCOR ERP — Create PRF (v3)
// Internal: suggested qty · Print: blank qty
// Auto-split batches of 30 · Multi-PRF awareness
// Auto-unique PRF No. (avoids duplicates)
// ============================================================

var MAX_ITEMS_PER_PRF = 30;

var _prf = {
  items: [],
  selectedItems: [],
  reorderList: [],
  pendingPrfItems: {},
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Create PRF v3] Initializing...');

  prfCheckHealth();
  initUserInfo();
  generatePrfNo();
  loadReorderList();
  loadPendingPrfItems();
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
// UNIQUE PRF NO. CHECK
// ═══════════════════════════════════════════════════════════
async function checkPrfNoAvailable(prfNo) {
  try {
    var res = await erpFetch('prf_documents', 
      'prf_no=eq.' + encodeURIComponent(prfNo) + '&select=id&limit=1');
    return (!res || res.length === 0);
  } catch(e) {
    console.warn('[checkPrfNoAvailable]', e.message);
    return true;  // Assume available on error
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
        base_prf_no: r.base_prf_no,
        status: r.status,
        qty: Number(r.qty_for_order || 0),
        created_at: r.created_at
      });
    });
    console.log('[PRF] Pending items:', Object.keys(_prf.pendingPrfItems).length);
  } catch(err) {
    console.warn('[PRF] Pending items load failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// CATEGORY CHANGE
// ═══════════════════════════════════════════════════════════
function onCategoryChange() {
  var category = document.getElementById('prfCategory').value;
  if (!category) {
    document.getElementById('itemsContainer').innerHTML = 
      '<div class="text-center text-muted py-5">' +
      '<i class="bi bi-inbox fs-1 d-block mb-2"></i>' +
      '<div>Select a category above to load items.</div></div>';
    return;
  }

  _prf.items = _prf.reorderList.filter(function(it) {
    return String(it.category || '').toUpperCase() === category;
  });

  console.log('[PRF] Category:', category, 'Items:', _prf.items.length);
  renderItems();
}

// ═══════════════════════════════════════════════════════════
// RENDER ITEMS
// ═══════════════════════════════════════════════════════════
function renderItems() {
  var container = document.getElementById('itemsContainer');
  if (!container) return;

  if (_prf.items.length === 0) {
    container.innerHTML = 
      '<div class="alert alert-info mb-0">' +
      '<i class="bi bi-info-circle me-2"></i>' +
      'No items found for this category.</div>';
    document.getElementById('itemsCountLabel').textContent = '(0 items)';
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

    // Pending PRF warning
    var pendingInfo = _prf.pendingPrfItems[it.item_code] || [];
    var pendingWarning = '';
    if (pendingInfo.length > 0) {
      var pendingText = pendingInfo.map(function(p) {
        return p.prf_no + ' (' + p.status + ' · qty ' + p.qty + ')';
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
    'Suggested qty = (Buffer − On-Hand). Not printed.' +
    batchingInfo + '</div>';
  html += '<div><strong>Selected:</strong> ' + _prf.selectedItems.length + 
    ' items · <strong>Total Qty:</strong> ' + erpNum(totalQty) + '</div>';
  html += '</div>';

  container.innerHTML = html;

  document.getElementById('itemsCountLabel').textContent = '(' + _prf.items.length + ' items)';
  updateSubmitButton();
}

function computeSuggested(it) {
  var buffer = Number(it.buffer_stock || 0);
  var onHand = Number(it.on_hand || 0);
  var diff = buffer - onHand;
  if (diff > 0) return Math.ceil(diff);
  return Number(it.suggested_order_qty || 0);
}

function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
// ═══════════════════════════════════════════════════════════
// UNIT EDITABLE
// ═══════════════════════════════════════════════════════════
var UNIT_OPTIONS_LIST = [
  'PIECE', 'PCS', 'PAIR', 'SET', 'BOX', 'ROLL', 'SHEET',
  'KG', 'LITERS', 'GAL', 'METER', 'MM', 'LENGTH',
  'ASSEMB', 'CAN', 'REAM', 'TANK', 'UNIT'
];

function buildUnitOptions(selected) {
  var html = '';
  UNIT_OPTIONS_LIST.forEach(function(u) {
    var sel = (u === selected) ? ' selected' : '';
    html += '<option value="' + u + '"' + sel + '>' + u + '</option>';
  });
  return html;
}

function updateUnit(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  item.base_unit = value;
  console.log('[PRF] Unit updated:', item.item_code, '→', value);
}
// ═══════════════════════════════════════════════════════════
// SELECTION
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
  renderItems();
}

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
  renderItems();
}

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

function updateRemarks(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  item._remarks = String(value || '').trim();
}

function recomputeSelected() {
  _prf.selectedItems = _prf.items.filter(function(it) {
    return it._selected && (it._qtyOrder || 0) > 0;
  });
}

function updateSubmitButton() {
  var btn = document.getElementById('btnSubmitPrf');
  var summary = document.getElementById('submitSummary');

  recomputeSelected();

  var count = _prf.selectedItems.length;
  var totalQty = _prf.selectedItems.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);

  if (count === 0) {
    btn.disabled = true;
    summary.textContent = 'Select items and enter quantities.';
  } else {
    btn.disabled = false;
    var batchInfo = '';
    if (count > MAX_ITEMS_PER_PRF) {
      var batches = Math.ceil(count / MAX_ITEMS_PER_PRF);
      batchInfo = ' (will create ' + batches + ' PRF batches)';
    }
    summary.textContent = count + ' item(s) selected · Total qty: ' + erpNum(totalQty) + batchInfo;
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT (with auto-unique + batching)
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

  recomputeSelected();
  if (_prf.selectedItems.length === 0) {
    erpShowToast('Select at least one item with qty > 0', 'warning');
    return;
  }

  var items = _prf.selectedItems;
  var batches = [];
  if (items.length > MAX_ITEMS_PER_PRF) {
    for (var i = 0; i < items.length; i += MAX_ITEMS_PER_PRF) {
      batches.push(items.slice(i, i + MAX_ITEMS_PER_PRF));
    }
  } else {
    batches.push(items);
  }

  // ═══ Auto-unique PRF No. check (base) ═══
  var isAvailable = await checkPrfNoAvailable(prfNo);
  if (!isAvailable) {
    var originalPrfNo = prfNo;
    prfNo = await generateUniquePrfNo(prfNo);
    console.log('[PRF] Auto-unique base:', originalPrfNo, '→', prfNo);
    erpShowToast('PRF No. adjusted to ' + prfNo, 'info');
  }

  // ═══ Auto-unique batch PRF Nos ═══
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
  var confirmMsg = 'Create PRF with ' + items.length + ' item(s)?\n\n';
  if (batches.length > 1) {
    confirmMsg += 'Will be split into ' + batches.length + ' batches:\n';
    batches.forEach(function(b, idx) {
      confirmMsg += '  • ' + b._prfNo + ' (' + b.length + ' items)\n';
    });
    confirmMsg += '\n';
  }
  confirmMsg += 'Base PRF No.: ' + prfNo;
  confirmMsg += '\nTotal qty: ' + items.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);

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
      var result = await createSinglePrf(batchPrfNo, prfNo, bIdx2 + 1, batch, category, preparedBy, department, notedBy, approvedBy, notes);
      createdPrfs.push(result);
    }

    document.getElementById('successPrfNo').textContent = createdPrfs.map(function(p) { return p.prf_no; }).join(', ');
    document.getElementById('successItemCount').textContent = items.length;
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

async function createSinglePrf(prfNo, basePrfNo, batchNumber, items, category, preparedBy, department, notedBy, approvedBy, notes) {
  var totalQty = items.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);

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
      average_consumption: Number(it.ave_monthly_consumption || 0),
      buffer_stock: Number(it.buffer_stock || 0),
      stock_on_hand: Number(it.on_hand || 0),
      qty_for_order: Number(it._qtyOrder || 0),
            unit: it.base_unit || 'PIECE',
      status: 'UNSERVED',
      remarks: it._remarks || ''
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

function cancelCreate() {
  if (!confirm('Cancel? Unsaved data will be lost.')) return;
  window.location.href = 'prf-monitor.html';
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ new-prf.js v3 loaded (auto-unique + batching)');
