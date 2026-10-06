// ============================================================
// GEMCOR ERP — Create PRF (Purchase Requisition Form)
// From Reorder List → Select items by category → Submit
// ============================================================

var _prf = {
  items: [],              // Reorder items for selected category
  selectedItems: [],      // Items with qty > 0
  reorderList: [],        // Full reorder list from view
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Create PRF] Initializing...');

  prfCheckHealth();
  initUserInfo();
  generatePrfNo();
  loadReorderList();
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
  // Default: PRF#MM-DD (e.g., PRF#10-6)
  var now = new Date();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  var prfNo = 'PRF#' + month + '-' + day;
  document.getElementById('prfNo').value = prfNo;
}

// ═══════════════════════════════════════════════════════════
// LOAD REORDER LIST
// ═══════════════════════════════════════════════════════════
async function loadReorderList() {
  try {
    // Get reorder list from view (items below buffer)
    var rows = await erpFetch('erp_v_reorder_list', 'select=*');
    _prf.reorderList = rows || [];
    console.log('[PRF] Loaded reorder list:', _prf.reorderList.length, 'items');
  } catch(err) {
    console.error('[PRF] Load reorder list failed:', err);
    erpShowToast('Failed to load reorder list: ' + err.message, 'danger');
  }
}

function onCategoryChange() {
  var category = document.getElementById('prfCategory').value;
  if (!category) {
    document.getElementById('itemsContainer').innerHTML = 
      '<div class="text-center text-muted py-5" id="itemsEmptyState">' +
      '<i class="bi bi-inbox fs-1 d-block mb-2"></i>' +
      '<div>Select a category above to load items from the Reorder List.</div>' +
      '</div>';
    return;
  }

  // Filter reorder list by category
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
      'No items found in the Reorder List for this category.' +
      '</div>';
    document.getElementById('itemsCountLabel').textContent = '(0 items)';
    updateSubmitButton();
    return;
  }

  var html = '<div class="table-responsive">';
  html += '<table class="erp-table" style="font-size:0.85rem;">';
  html += '<thead><tr>' +
    '<th style="width:3%"><input type="checkbox" id="selectAllChk" onchange="toggleSelectAll(this.checked)"></th>' +
    '<th style="width:5%">#</th>' +
    '<th style="width:12%">Item Code</th>' +
    '<th style="width:22%">Description</th>' +
    '<th style="width:8%" class="text-center">Location</th>' +
    '<th style="width:7%" class="text-center">Stock On Hand</th>' +
    '<th style="width:7%" class="text-center">Buffer</th>' +
    '<th style="width:7%" class="text-center">Ave/Mo</th>' +
    '<th style="width:8%" class="text-center">Qty For Order</th>' +
    '<th style="width:6%" class="text-center">Unit</th>' +
    '<th style="width:15%">Remarks</th>' +
  '</tr></thead><tbody>';

  _prf.items.forEach(function(it, idx) {
    var suggested = Number(it.suggested_order_qty || 0) || Math.max(0, Number(it.buffer_stock || 0) - Number(it.on_hand || 0));
    var isSelected = it._selected === true;
    var qtyOrder = it._qtyOrder !== undefined ? it._qtyOrder : 0;
    var remarks = it._remarks || '';

    var urgencyBadge = '';
    if (it.urgency === 'CRITICAL') urgencyBadge = ' <span class="badge bg-danger">CRIT</span>';
    else if (it.urgency === 'URGENT') urgencyBadge = ' <span class="badge bg-warning text-dark">URG</span>';

    html += '<tr data-idx="' + idx + '"' + (isSelected ? ' style="background:#ecfdf5;"' : '') + '>' +
      '<td><input type="checkbox" class="item-select-chk" data-idx="' + idx + '"' + (isSelected ? ' checked' : '') + ' onchange="toggleItemSelect(' + idx + ', this.checked)"></td>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code>' + urgencyBadge + '</td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-center">' + erpNum(it.on_hand || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.buffer_stock || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.ave_monthly_consumption || 0) + '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm qty-order-input" ' +
        'data-idx="' + idx + '" value="' + qtyOrder + '" min="0" step="0.01" ' +
        'placeholder="' + suggested + '" onchange="updateQty(' + idx + ', this.value)">' +
      '</td>' +
      '<td class="text-center">' + erpEsc(it.base_unit || '—') + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm remarks-input" ' +
        'data-idx="' + idx + '" value="' + erpEsc(remarks) + '" placeholder="Optional" ' +
        'onchange="updateRemarks(' + idx + ', this.value)">' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';

  // Summary
  var totalQty = _prf.selectedItems.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);
  html += '<div class="mt-3 d-flex justify-content-between align-items-center">';
  html += '<div class="small text-muted"><i class="bi bi-info-circle me-1"></i>Suggested qty is based on (Buffer - On-Hand).</div>';
  html += '<div><strong>Selected:</strong> ' + _prf.selectedItems.length + ' items · <strong>Total Qty:</strong> ' + erpNum(totalQty) + '</div>';
  html += '</div>';

  container.innerHTML = html;

  document.getElementById('itemsCountLabel').textContent = '(' + _prf.items.length + ' items)';
  updateSubmitButton();
}

function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════════════════
// ITEM SELECTION
// ═══════════════════════════════════════════════════════════
function toggleItemSelect(idx, checked) {
  var item = _prf.items[idx];
  if (!item) return;
  item._selected = checked;

  if (checked) {
    // Auto-fill suggested qty if empty
    if (!item._qtyOrder) {
      item._qtyOrder = Math.max(0, Number(item.buffer_stock || 0) - Number(item.on_hand || 0));
      if (item._qtyOrder <= 0 && item.suggested_order_qty) {
        item._qtyOrder = Number(item.suggested_order_qty);
      }
      item._qtyOrder = Math.ceil(item._qtyOrder);
    }
  } else {
    item._qtyOrder = 0;
  }

  recomputeSelected();
  renderItems();
}

function toggleSelectAll(checked) {
  _prf.items.forEach(function(it, idx) {
    it._selected = checked;
    if (checked) {
      it._qtyOrder = Math.max(0, Number(it.buffer_stock || 0) - Number(it.on_hand || 0));
      if (it._qtyOrder <= 0 && it.suggested_order_qty) {
        it._qtyOrder = Number(it.suggested_order_qty);
      }
      it._qtyOrder = Math.ceil(it._qtyOrder);
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
    summary.textContent = count + ' item(s) selected · Total qty: ' + erpNum(totalQty);
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT PRF
// ═══════════════════════════════════════════════════════════
async function submitPrf() {
  if (_prf.isSubmitting) return;

  var prfNo = document.getElementById('prfNo').value.trim();
  if (!prfNo) {
    erpShowToast('PRF No. is required', 'warning');
    return;
  }

  var category = document.getElementById('prfCategory').value;
  if (!category) {
    erpShowToast('Category is required', 'warning');
    return;
  }

  recomputeSelected();
  if (_prf.selectedItems.length === 0) {
    erpShowToast('Please select at least one item with qty > 0', 'warning');
    return;
  }

  var preparedBy = document.getElementById('prfPreparedBy').value.trim();
  var department = document.getElementById('prfDepartment').value.trim();
  var notedBy = document.getElementById('prfNotedBy').value.trim();
  var approvedBy = document.getElementById('prfApprovedBy').value.trim();
  var notes = document.getElementById('prfNotes').value.trim();

  var totalItems = _prf.selectedItems.length;
  var totalQty = _prf.selectedItems.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);

  if (!confirm('Create PRF ' + prfNo + ' with ' + totalItems + ' item(s)?')) return;

  _prf.isSubmitting = true;
  var btn = document.getElementById('btnSubmitPrf');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    // 1. Insert prf_documents
    var docRes = await fetch(erpUrl('prf_documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        prf_no: prfNo,
        category: category,
        requestor: preparedBy,
        department: department,
        notes: notes,
        total_items: totalItems,
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
      throw new Error('Insert PRF failed: ' + docRes.status + ' ' + errText);
    }

    var docArr = await docRes.json();
    var doc = docArr[0];
    if (!doc || !doc.id) throw new Error('No PRF ID returned');

    // 2. Insert prf_items
    var itemPayloads = _prf.selectedItems.map(function(it, idx) {
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
      throw new Error('Insert items failed: ' + itemsRes.status + ' ' + itemsErrText);
    }

    // Success
    document.getElementById('successPrfNo').textContent = prfNo;
    document.getElementById('successItemCount').textContent = totalItems;
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

console.log('✅ new-prf.js loaded');
