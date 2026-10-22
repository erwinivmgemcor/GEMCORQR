// ============================================================
// GEMCOR ERP — Manual MRR Creation (v2.0)
// ✅ NEW: SOF No. field support
// ============================================================

var _mrrState = {
  preparedBy: '',
  receivingSite: 'GEMCOR CATMON',
  poNo: '',
  sofNo: '',                    // ✅ NEW
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
  console.log('[Manual MRR v2.0] Initializing...');
  
  mrrCheckHealth();
  
  var userFullname = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || '';
  _mrrState.preparedBy = userFullname;
  document.getElementById('mrrPreparedBy').value = userFullname;
  
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('mrrReceivingDate').value = today;
  _mrrState.receivingDate = today;
  
  preloadInventory();
  
  console.log('[Manual MRR v2.0] Ready. Prepared By:', userFullname);
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

function addItemRow() {
  var emptyState = document.getElementById('itemsEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  var template = document.getElementById('itemRowTemplate');
  var clone = template.content.cloneNode(true);
  var row = clone.querySelector('.erp-item-row');
  
  var idx = _mrrState.items.length;
  row.setAttribute('data-item-idx', idx);
  row.querySelector('.item-number').textContent = (idx + 1);
  
  var codeInput = row.querySelector('.item-code-input');
  codeInput.addEventListener('input', function() { onItemCodeInput(this); });
  codeInput.addEventListener('focus', function() { onItemCodeInput(this); });
  codeInput.addEventListener('blur', function() {
    var self = this;
    setTimeout(function() { hideItemDropdown(self); }, 200);
  });
  
  document.getElementById('itemsContainer').appendChild(clone);
  _mrrState.items.push({ code: '', description: '', qty: 1, atlQty: 1, unit: 'PCS', remarks: '' });
  
  setTimeout(function() {
    var newRow = document.querySelector('.erp-item-row[data-item-idx="' + idx + '"]');
    if (newRow) newRow.querySelector('.item-code-input').focus();
  }, 100);
}

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
    document.getElementById('itemsEmptyState').style.display = 'block';
  }
}

function reindexItemRows() {
  var rows = document.querySelectorAll('.erp-item-row');
  var newItems = [];
  rows.forEach(function(row, i) {
    var oldIdx = parseInt(row.getAttribute('data-item-idx'), 10);
    var item = _mrrState.items[oldIdx];
    if (item) {
      row.setAttribute('data-item-idx', i);
      row.querySelector('.item-number').textContent = (i + 1);
      newItems.push(item);
    }
  });
  _mrrState.items = newItems;
}

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
    return it.code.toLowerCase().indexOf(term) !== -1 ||
           it.description.toLowerCase().indexOf(term) !== -1;
  }).slice(0, 15);
  
  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="erp-item-dropdown-item muted">No matches — you can type manually</div>';
    dropdown.classList.remove('d-none');
    return;
  }
  
  var html = '';
  matches.forEach(function(it) {
    html += '<div class="erp-item-dropdown-item" data-code="' + erpEsc(it.code) + '" data-desc="' + erpEsc(it.description) + '" data-unit="' + erpEsc(it.unit) + '">' +
      '<div class="item-code">' + erpEsc(it.code) + ' <span class="item-unit">' + erpEsc(it.unit) + '</span></div>' +
      '<div class="item-desc">' + erpEsc(it.description.substring(0, 80)) + '</div>' +
    '</div>';
  });
  dropdown.innerHTML = html;
  dropdown.classList.remove('d-none');
  
  dropdown.querySelectorAll('.erp-item-dropdown-item').forEach(function(el) {
    if (el.classList.contains('muted')) return;
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      selectItemFromDropdown(row, el);
    });
  });
}

function selectItemFromDropdown(row, el) {
  var idx = parseInt(row.getAttribute('data-item-idx'), 10);
  var code = el.getAttribute('data-code');
  var desc = el.getAttribute('data-desc');
  var unit = el.getAttribute('data-unit');
  
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

function hideItemDropdown(input) {
  var row = input.closest('.erp-item-row');
  if (row) {
    var dropdown = row.querySelector('.item-dropdown');
    if (dropdown) dropdown.classList.add('d-none');
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT
// ═══════════════════════════════════════════════════════════
async function submitMrr() {
  if (_mrrState.isSubmitting) return;

  var now = Date.now();
  if (_mrrState.lastSubmittedAt && (now - _mrrState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait before submitting again', 'warning');
    return;
  }

  var receivingSite = document.getElementById('mrrReceivingSite').value.trim();
  if (!receivingSite) { erpShowToast('Receiving Site is required', 'warning'); return; }
  
  var vendor = document.getElementById('mrrVendor').value.trim();
  if (!vendor) { erpShowToast('Vendor is required', 'warning'); return; }
  
  var drNo = document.getElementById('mrrDrNo').value.trim();
  if (!drNo) { erpShowToast('DR No. is required', 'warning'); return; }
  
  var receivingDate = document.getElementById('mrrReceivingDate').value;
  if (!receivingDate) { erpShowToast('Receiving Date is required', 'warning'); return; }

  var poNo = document.getElementById('mrrPoNo').value.trim();
  var sofNo = document.getElementById('mrrSofNo').value.trim();
  var prfNo = document.getElementById('mrrPrfNo').value.trim();
  
  var validItems = [];
  var rows = document.querySelectorAll('.erp-item-row');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var code = row.querySelector('.item-code-input').value.trim();
    var desc = row.querySelector('.item-desc-input').value.trim();
    var qty = parseFloat(row.querySelector('.item-qty-input').value) || 0;
    var atlQty = parseFloat(row.querySelector('.item-atl-input').value) || 0;
    var unit = row.querySelector('.item-unit-input').value;
    var remarks = row.querySelector('.item-remarks-input').value.trim();
    
       // ✅ SMART VALIDATION: Payagan ang 0 qty basta may ATL (Actual Qty)
    if (!code) { 
      erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning'); 
      return; 
    }
    if (qty <= 0 && atlQty <= 0) { 
      erpShowToast('Item #' + (i + 1) + ' has no quantity. Please enter Req Qty or ATL Qty.', 'warning'); 
      return; 
    }
    
    // Kung 0 ang Req Qty pero may ATL, gawing ATL ang requested qty para pumasok sa logic
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
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
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

    var docPayload = {
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
    };

    var processRes = await fetch(erpUrl('rpc/erp_submit_mrr'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_doc_no: docNo,
        p_doc_payload: docPayload,
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
    // ═══════════════════════════════════════════════════════
    // ═══ AUTO-ALLOCATE SA SOF KUNG MAY SOF NO. ═══
    // ═══════════════════════════════════════════════════════
    var finalSofNo = _mrrState.sofNo || document.getElementById('mrrSofNo')?.value;
    
    if (finalSofNo && finalSofNo.trim()) {
      try {
        console.log('[Manual MRR] Auto-allocating to SOF:', finalSofNo);
        
        var sofItems = validItems.map(function(it) {
          return {
            item_code: it.item_code,
            description: it.description,
            unit: it.unit,
            qty: it.qty
          };
        });

        await fetch(erpUrl('rpc/erp_sof_auto_allocate'), {
          method: 'POST',
          headers: erpHeaders(),
          body: JSON.stringify({
            p_sof_no: finalSofNo.trim(),
            p_client: vendor || '',
            p_project: '',
            p_jo_no: prfNo || '',
            p_items: sofItems
          })
        });
        
        console.log('[Manual MRR] ✅ SOF Auto-Allocate success');
      } catch(sofErr) {
        console.error('[Manual MRR] SOF Auto-Allocate failed:', sofErr);
      }
    }
    // ═══════════════════════════════════════════════════════
    erpShowToast('✅ Manual MRR created: ' + docNo + ' (' + data.status + ')', 'success');
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

function showSuccessModal(docNo) {
  document.getElementById('successDocNo').textContent = docNo;
  var base = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  var qrData = base + '../?doc=' + encodeURIComponent(docNo) + '&view=print';
  document.getElementById('successQrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
  
  var modalEl = document.getElementById('successModal');
  new bootstrap.Modal(modalEl).show();
  modalEl.addEventListener('hidden.bs.modal', function onHide() {
    modalEl.removeEventListener('hidden.bs.modal', onHide);
    resetFormSilent();
  }, { once: true });
}

function resetFormSilent() {
  document.getElementById('mrrPoNo').value = '';
  document.getElementById('mrrSofNo').value = '';      // ✅ NEW
  document.getElementById('mrrPrfNo').value = '';
  document.getElementById('mrrVendor').value = '';
  document.getElementById('mrrDrNo').value = '';
  _mrrState.sofNo = '';                                 // ✅ NEW
  _mrrState.items = [];
  
  var container = document.getElementById('itemsContainer');
  container.querySelectorAll('.erp-item-row').forEach(function(r) { r.remove(); });
  document.getElementById('itemsEmptyState').style.display = 'block';
}

function resetForm() {
  if (!confirm('Reset the form?')) return;
  resetFormSilent();
  erpShowToast('Form reset', 'info');
}

function closeSuccessAndReset() {
  var modal = bootstrap.Modal.getInstance(document.getElementById('successModal'));
  if (modal) modal.hide();
}

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

console.log('✅ new-mrr-manual.js v2.0 loaded (SOF No. support)');
