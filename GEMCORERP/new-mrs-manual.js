// ============================================================
// GEMCOR ERP — Manual MRS Creation
// No JO lookup — manual entry, auto COMPLETED
// ============================================================

var _mrsState = {
  requestor: '',
  department: '',
  joNo: '',
  gemSoNo: '',
  clientName: '',
  project: '',
  items: [],
  inventoryList: [],
  inventoryLoaded: false,
  isSubmitting: false,
  lastSubmittedAt: 0
};

document.addEventListener('DOMContentLoaded', function() {
  console.log('[Manual MRS] Initializing...');
  
  mrsCheckHealth();
  
  var userFullname = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || '';
  _mrsState.requestor = userFullname;
  document.getElementById('mrsRequestor').value = userFullname;
  
  document.getElementById('mrsDate').value = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric'
  });
  
  loadUserDepartment();
  preloadInventory();
  
  console.log('[Manual MRS] Ready. Requestor:', userFullname);
});

async function mrsCheckHealth() {
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

async function loadUserDepartment() {
  var username = localStorage.getItem('ivm_username') || '';
  if (!username) return;
  var deptField = document.getElementById('mrsDepartment');
  deptField.placeholder = 'Loading...';
  deptField.disabled = true;
  try {
    var rows = await erpFetch('users', 
      'username=eq.' + encodeURIComponent(username) + '&select=department&limit=1');
    if (rows && rows[0] && rows[0].department) {
      var dept = rows[0].department.trim();
      _mrsState.department = dept;
      deptField.value = dept;
      deptField.readOnly = true;
      deptField.disabled = false;
      deptField.classList.add('locked-input');
      var label = deptField.previousElementSibling;
      if (label) {
        label.innerHTML = 'Department <span class="badge bg-success ms-1"><i class="bi bi-lock-fill me-1"></i>Locked</span>';
      }
    } else {
      deptField.placeholder = 'Enter department';
      deptField.disabled = false;
    }
  } catch(err) {
    deptField.placeholder = 'Enter department';
    deptField.disabled = false;
  }
}

async function preloadInventory() {
  if (_mrsState.inventoryLoaded) return;
  try {
    var rows = await erpFetch('inventory', 
      'select=item_code,description,unit&order=item_code.asc&limit=10000');
    _mrsState.inventoryList = (rows || []).map(function(r) {
      return { code: r.item_code, description: r.description || '', unit: r.unit || 'PIECE' };
    });
    _mrsState.inventoryLoaded = true;
    console.log('[Inventory] Loaded ' + _mrsState.inventoryList.length + ' items');
  } catch(err) {
    console.warn('[Inventory] Failed:', err.message);
  }
}

function addItemRow() {
  var emptyState = document.getElementById('itemsEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  var template = document.getElementById('itemRowTemplate');
  var clone = template.content.cloneNode(true);
  var row = clone.querySelector('.erp-item-row');
  
  var idx = _mrsState.items.length;
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
  _mrsState.items.push({ code: '', description: '', qty: 1, atlQty: 1, unit: 'PIECE', remarks: '' });
  
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
  _mrsState.items[idx] = null;
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
    var item = _mrsState.items[oldIdx];
    if (item) {
      row.setAttribute('data-item-idx', i);
      row.querySelector('.item-number').textContent = (i + 1);
      newItems.push(item);
    }
  });
  _mrsState.items = newItems;
}

function onItemCodeInput(input) {
  var row = input.closest('.erp-item-row');
  var dropdown = row.querySelector('.item-dropdown');
  var term = input.value.toLowerCase().trim();
  if (!term) { dropdown.classList.add('d-none'); return; }
  
  if (!_mrsState.inventoryLoaded) {
    dropdown.innerHTML = '<div class="erp-item-dropdown-item muted">Loading inventory...</div>';
    dropdown.classList.remove('d-none');
    return;
  }
  
  var matches = _mrsState.inventoryList.filter(function(it) {
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
  if (_mrsState.items[idx]) {
    _mrsState.items[idx].code = code;
    _mrsState.items[idx].description = desc;
    _mrsState.items[idx].unit = unit;
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

async function submitMrs() {
  if (_mrsState.isSubmitting) return;
  
  var now = Date.now();
  if (_mrsState.lastSubmittedAt && (now - _mrsState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait before submitting again', 'warning');
    return;
  }
  
  var department = document.getElementById('mrsDepartment').value.trim();
  if (!department) {
    erpShowToast('Department is required', 'warning');
    return;
  }
  
  var joNo = document.getElementById('mrsJoNo').value.trim();
  var gemSoNo = document.getElementById('mrsGemSoNo').value.trim();
  var clientName = document.getElementById('mrsClientName').value.trim();
  var project = document.getElementById('mrsProject').value.trim();
  
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
    
    if (!code) {
      erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning');
      return;
    }
    if (qty <= 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid quantity', 'warning');
      return;
    }
    validItems.push({ code: code, description: desc, qty: qty, atlQty: atlQty, unit: unit, remarks: remarks });
  }
  
  if (validItems.length === 0) {
    erpShowToast('Please add at least one item', 'warning');
    return;
  }
  
  if (!confirm('Create manual MRS with ' + validItems.length + ' item(s)?')) return;
  
  _mrsState.isSubmitting = true;
  _mrsState.lastSubmittedAt = now;
  
  var btn = document.getElementById('btnSubmitMrs');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
  
  try {
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: 'MRS' })
    });
    
    if (!rpcRes.ok) throw new Error('RPC failed');
    var nextNum = await rpcRes.json();
    var padded = String(nextNum).padStart(4, '0');
    var docNo = 'MRS' + padded;
    
    var docRes = await fetch(erpUrl('documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: 'MRS',
       status: 'PENDING',
        is_bal: false,
        requestor: _mrsState.requestor,
        department: department,
        jo_no: joNo,
        gem_so_no: gemSoNo,
        client_name: clientName,
        project: project,
        processed_by: _mrsState.requestor,
        processed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    
    if (!docRes.ok) throw new Error('Insert doc failed');
    var docArr = await docRes.json();
    var doc = docArr[0];
    
    var itemPayloads = validItems.map(function(it, idx) {
      return {
        document_id: doc.id,
        doc_no: docNo,
        line_no: idx + 1,
        item_code: it.code,
        description: it.description,
        requested_qty: it.qty,
        issued_qty: it.atlQty,
        unit: it.unit,
        remarks: it.remarks || 'SERVED',
        row_index: idx + 1
      };
    });
    
    var itemsRes = await fetch(erpUrl('doc_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(itemPayloads)
    });
    
    if (!itemsRes.ok) throw new Error('Insert items failed');
    
    erpShowToast('✅ Manual MRS created: ' + docNo, 'success');
    showSuccessModal(docNo);
    
  } catch(err) {
    console.error('[submitMrs]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _mrsState.isSubmitting = false;
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
  document.getElementById('mrsJoNo').value = '';
  document.getElementById('mrsGemSoNo').value = '';
  document.getElementById('mrsClientName').value = '';
  document.getElementById('mrsProject').value = '';
  _mrsState.items = [];
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

console.log('✅ new-mrs-manual.js loaded');
