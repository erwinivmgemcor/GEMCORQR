// ============================================================
// GEMCOR ERP — Manual MRR Creation (v2.1)
// ✅ FIXED: Null-safe getters (no crash kung walang field sa HTML)
// ✅ FIXED: Date fallback (current date kung blank)
// ✅ FIXED: Double-submit protection
// ✅ FIXED: Direct RPC call (walang manual JS insert na nagdodoble)
// ============================================================

var _mrrState = {
  preparedBy: '',
  receivingSite: 'GEMCOR CATMON',
  poNo: '',
  sofNo: '',
  prfNo: '',
  vendor: '',
  drNo: '',
  receivingDate: '',
  items: [],
  inventoryList: [],
  inventoryLoaded: false,
  isSubmitting: false,
  lastSubmittedAt: 0
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Manual MRR v2.1] Initializing...');
  
  mrrCheckHealth();
  
  var userFullname = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || '';
  _mrrState.preparedBy = userFullname;
  
  var prepByEl = document.getElementById('mrrPreparedBy');
  if (prepByEl) prepByEl.value = userFullname;
  
  var today = new Date().toISOString().split('T')[0];
  var dateEl = document.getElementById('mrrReceivingDate');
  if (dateEl) dateEl.value = today;
  _mrrState.receivingDate = today;
  
  preloadInventory();
  
  console.log('[Manual MRR v2.1] Ready. Prepared By:', userFullname);
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

async function preloadInventory() {
  if (_mrrState.inventoryLoaded) return;
  try {
    console.log('[Inventory] Loading items via shared helper...');
    _mrrState.inventoryList = await erpGetInventoryListForDropdown();
    _mrrState.inventoryLoaded = true;
    console.log('[Inventory] ✅ Loaded ' + _mrrState.inventoryList.length + ' items');
  } catch(err) {
    console.warn('[Inventory] Failed:', err.message);
    _mrrState.inventoryList = [];
  }
}

// ═══════════════════════════════════════════════════════════
// ITEM ROW MANAGEMENT
// ═══════════════════════════════════════════════════════════
function addItemRow() {
  var emptyState = document.getElementById('itemsEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  var template = document.getElementById('itemRowTemplate');
  if (!template) return;

  var clone = template.content.cloneNode(true);
  var row = clone.querySelector('.erp-item-row');
  
  var idx = _mrrState.items.length;
  row.setAttribute('data-item-idx', idx);
  row.querySelector('.item-number').textContent = (idx + 1);
  
  var codeInput = row.querySelector('.item-code-input');
  if (codeInput) {
    codeInput.addEventListener('input', function() { onItemCodeInput(this); });
    codeInput.addEventListener('focus', function() { onItemCodeInput(this); });
    codeInput.addEventListener('blur', function() {
      var self = this;
      setTimeout(function() { hideItemDropdown(self); }, 200);
    });
  }
  
  document.getElementById('itemsContainer').appendChild(clone);
  _mrrState.items.push({ code: '', description: '', qty: 1, atlQty: 1, unit: 'PCS', remarks: '' });
  
  setTimeout(function() {
    var newRow = document.querySelector('.erp-item-row[data-item-idx="' + idx + '"]');
    if (newRow && newRow.querySelector('.item-code-input')) {
      newRow.querySelector('.item-code-input').focus();
    }
  }, 100);
}

window.addItemRow = addItemRow;

function removeItemRow(btn) {
  var row = btn.closest('.erp-item-row');
  if (!row) return;
  if (!confirm('Remove this item?')) return;
  
  var idx = parseInt(row.getAttribute('data-item-idx'), 10);
  _mrrState.items[idx] = null;
  row.remove();
  reindexItemRows();
  
  var remaining = document.querySelectorAll('.erp-item-row').length;
  if (remaining === 0) {
    var empty = document.getElementById('itemsEmptyState');
    if (empty) empty.style.display = 'block';
  }
}

window.removeItemRow = removeItemRow;

function reindexItemRows() {
  var rows = document.querySelectorAll('.erp-item-row');
  var newItems = [];
  rows.forEach(function(row, i) {
    var oldIdx = parseInt(row.getAttribute('data-item-idx'), 10);
    var item = _mrrState.items[oldIdx];
    if (item) {
      row.setAttribute('data-item-idx', i);
      var numEl = row.querySelector('.item-number');
      if (numEl) numEl.textContent = (i + 1);
      newItems.push(item);
    }
  });
  _mrrState.items = newItems;
}

// ═══════════════════════════════════════════════════════════
// AUTO-SUGGEST DROPDOWN
// ═══════════════════════════════════════════════════════════
function onItemCodeInput(input) {
  var row = input.closest('.erp-item-row');
  var dropdown = row.querySelector('.item-dropdown');
  var term = input.value.toLowerCase().trim();
  
  if (!term) { dropdown.classList.add('d-none'); return; }
  
  if (!_mrrState.inventoryLoaded) {
    dropdown.innerHTML = '<div class="erp-item-dropdown-item muted">Loading inventory...</div>';
    dropdown.classList.remove('d-none');
    return;
  }
  
  var matches = _mrrState.inventoryList.filter(function(it) {
    return (it.code && it.code.toLowerCase().indexOf(term) !== -1) ||
           (it.description && it.description.toLowerCase().indexOf(term) !== -1);
  }).slice(0, 15);
  
  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="erp-item-dropdown-item muted">No matches — you can type manually</div>';
    dropdown.classList.remove('d-none');
    return;
  }
  
  var html = '';
  matches.forEach(function(it) {
    var safeCode = String(it.code || '').replace(/'/g, "\\'");
    html += '<div class="erp-item-dropdown-item" data-code="' + erpEsc(it.code) + '" onclick="selectItemFromDropdown(' + row.getAttribute('data-item-idx') + ', \'' + safeCode + '\', \'' + erpEsc(it.description) + '\', \'' + erpEsc(it.unit) + '\')">' +
      '<div class="item-code">' + erpEsc(it.code) + ' <span class="item-unit">' + erpEsc(it.unit) + '</span></div>' +
      '<div class="item-desc">' + erpEsc(it.description.substring(0, 80)) + '</div>' +
    '</div>';
  });
  dropdown.innerHTML = html;
  dropdown.classList.remove('d-none');
}

function selectItemFromDropdown(idx, code, desc, unit) {
  var row = document.querySelector('.erp-item-row[data-item-idx="' + idx + '"]');
  if (!row) return;
  
  row.querySelector('.item-code-input').value = code;
  row.querySelector('.item-desc-input').value = desc;
  row.querySelector('.item-unit-input').value = unit;
  row.querySelector('.item-dropdown').classList.add('d-none');
  
  if (_mrrState.items[idx]) {
    _mrrState.items[idx].code = code;
    _mrrState.items[idx].description = desc;
    _mrrState.items[idx].unit = unit;
  }
  
  setTimeout(function() {
    row.querySelector('.item-qty-input').focus();
    row.querySelector('.item-qty-input').select();
  }, 100);
}

window.selectItemFromDropdown = selectItemFromDropdown;

function hideItemDropdown(input) {
  var row = input.closest('.erp-item-row');
  if (row) {
    var dropdown = row.querySelector('.item-dropdown');
    if (dropdown) dropdown.classList.add('d-none');
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT MRR (Strict RPC-only flow)
// ═══════════════════════════════════════════════════════════
async function submitMrr() {
  if (_mrrState.isSubmitting) return;

  var now = Date.now();
  if (_mrrState.lastSubmittedAt && (now - _mrrState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait before submitting again', 'warning');
    return;
  }

  // ✅ NULL-SAFE GETTERS (Hindi mag-crash kahit walang field sa HTML)
  var getElVal = function(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  var receivingSite = getElVal('mrrReceivingSite') || 'GEMCOR CATMON';
  var vendor = getElVal('mrrVendor');
  var drNo = getElVal('mrrDrNo');
  
  // Date fallback kung walang laman ang date input
  var receivingDate = getElVal('mrrReceivingDate') || new Date().toISOString().split('T')[0]; 
  
  var poNo = getElVal('mrrPoNo');
  var sofNo = getElVal('mrrSofNo');
  var prfNo = getElVal('mrrPrfNo');

  if (!vendor) { erpShowToast('Vendor is required', 'warning'); return; }
  if (!drNo) { erpShowToast('DR No. is required', 'warning'); return; }

  var validItems = [];
  var rows = document.querySelectorAll('.erp-item-row');
  
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    
    var codeInput = row.querySelector('.item-code-input');
    var descInput = row.querySelector('.item-desc-input');
    var qtyInput = row.querySelector('.item-qty-input');
    var atlInput = row.querySelector('.item-atl-input');
    var unitInput = row.querySelector('.item-unit-input');
    var remarksInput = row.querySelector('.item-remarks-input');

    var code = codeInput ? codeInput.value.trim() : '';
    var desc = descInput ? descInput.value.trim() : '';
    var qty = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;
    var atlQty = atlInput ? (parseFloat(atlInput.value) || 0) : 0;
    var unit = unitInput ? unitInput.value : 'PIECE';
    var remarks = remarksInput ? remarksInput.value.trim() : '';
    
    if (!code) { 
      erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning'); 
      return; 
    }
    if (qty <= 0 && atlQty <= 0) { 
      erpShowToast('Item #' + (i + 1) + ' has no quantity.', 'warning'); 
      return; 
    }
    
    var finalQty = qty > 0 ? qty : atlQty;
    
    validItems.push({
      item_code: code,
      description: desc,
      qty: finalQty,
      atl_qty: atlQty,
      unit: unit,
      remarks: remarks || (atlQty >= finalQty ? 'COMPLETE' : 'PARTIAL')
    });
  }

  if (validItems.length === 0) { erpShowToast('Please add at least one item', 'warning'); return; }
  if (!confirm('Create manual MRR with ' + validItems.length + ' item(s)?')) return;

  _mrrState.isSubmitting = true;
  _mrrState.lastSubmittedAt = now;

  var btn = document.getElementById('btnSubmitMrr');
  var originalHtml = btn ? btn.innerHTML : 'Submit';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
  }

  try {
    // 1. Get Doc No
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

    // 2. Ipaubaya lahat sa RPC (Insert Doc, Insert Items, Update Stock)
    var processRes = await fetch(erpUrl('rpc/erp_submit_mrr'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_doc_no: docNo,
        p_doc_payload: {
          requestor: _mrrState.preparedBy,
          department: '',
          po_no: poNo,
          sof_no: sofNo,
          prf_no: prfNo,
          vendor: vendor,
          client_name: vendor,
          dr_no: drNo,
          receiving_site: receivingSite,
          receiving_date: receivingDate,
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

    erpShowToast('✅ Manual MRR created: ' + docNo + ' (' + data.status + ')', 'success');
    showSuccessModal(docNo);

  } catch(err) {
    console.error('[submitMrr]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _mrrState.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

window.submitMrr = submitMrr;

function showSuccessModal(docNo) {
  var docNoEl = document.getElementById('successDocNo');
  if (docNoEl) docNoEl.textContent = docNo;

  var base = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  var qrData = base + '../?doc=' + encodeURIComponent(docNo) + '&view=print';
  
  var qrImg = document.getElementById('successQrImg');
  if (qrImg) {
    qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
  }
  
  var modalEl = document.getElementById('successModal');
  if (modalEl) {
    new bootstrap.Modal(modalEl).show();
    modalEl.addEventListener('hidden.bs.modal', function onHide() {
      modalEl.removeEventListener('hidden.bs.modal', onHide);
      resetFormSilent();
    }, { once: true });
  }
}

function resetFormSilent() {
  var getEl = function(id) { return document.getElementById(id); };
  
  if (getEl('mrrPoNo')) getEl('mrrPoNo').value = '';
  if (getEl('mrrSofNo')) getEl('mrrSofNo').value = '';
  if (getEl('mrrPrfNo')) getEl('mrrPrfNo').value = '';
  if (getEl('mrrVendor')) getEl('mrrVendor').value = '';
  if (getEl('mrrDrNo')) getEl('mrrDrNo').value = '';
  
  _mrrState.sofNo = '';
  _mrrState.items = [];
  
  var container = document.getElementById('itemsContainer');
  if (container) {
    container.querySelectorAll('.erp-item-row').forEach(function(r) { r.remove(); });
  }
  
  var empty = document.getElementById('itemsEmptyState');
  if (empty) empty.style.display = 'block';
}

function resetForm() {
  if (!confirm('Reset the form?')) return;
  resetFormSilent();
  erpShowToast('Form reset', 'info');
}

window.resetForm = resetForm;

function closeSuccessAndReset() {
  var modalEl = document.getElementById('successModal');
  if (!modalEl) return;
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
}

window.closeSuccessAndReset = closeSuccessAndReset;

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
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

console.log('✅ new-mrr-manual.js v2.1 loaded (Null-safe + RPC direct)');
