// ============================================================
// GEMCOR ERP — Manual MRS Creation (v2.0)
// ============================================================

var _mrsState = {
  requestor: '',
  department: '',
  joNo: '',
  gemSoNo: '',
  clientName: '',
  project: '',
  items: [],
  isSubmitting: false,
  lastSubmittedAt: 0
};

var _mrsInventoryCache = null;
var _mrsSearchTimers = {};

document.addEventListener('DOMContentLoaded', function() {
  console.log('[Manual MRS v2.0] Initializing...');

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
  if (_mrsInventoryCache) return;
  try {
    console.log('[Manual MRS v2.0] Loading inventory...');
    if (typeof erpGetInventoryListForDropdown === 'function') {
      _mrsInventoryCache = await erpGetInventoryListForDropdown();
    } else {
      var allItems = [];
      var pageSize = 1000;
      var offset = 0;
      var hasMore = true;
      while (hasMore) {
        var query = 'select=item_code,description,base_unit,category,location' +
                    '&is_active=eq.true&order=item_code.asc' +
                    '&limit=' + pageSize + '&offset=' + offset;
        var rows = await erpFetch('erp_items', query);
        if (!rows || rows.length === 0) break;
        allItems = allItems.concat(rows);
        offset += rows.length;
        if (rows.length < pageSize) hasMore = false;
      }
      _mrsInventoryCache = allItems.map(function(r) {
        return { code: r.item_code, description: r.description || '', unit: r.base_unit || 'PIECE', category: r.category || '' };
      });
    }
    console.log('[Manual MRS v2.0] ✅ Inventory loaded:', _mrsInventoryCache.length);
  } catch(err) {
    console.warn('[Manual MRS v2.0] Failed:', err.message);
    _mrsInventoryCache = [];
  }
}

// ✅ ADD ITEM FUNCTION
window.mrsManualAddItem = function() {
  _mrsState.items.push({ itemCode: '', description: '', qtyReturned: 0, unit: 'PIECE', remarks: '' });
  renderItems();
  setTimeout(function() {
    var input = document.getElementById('mrsItemCode' + (_mrsState.items.length - 1));
    if (input) input.focus();
  }, 150);
};

// ✅ RENDER ITEMS FUNCTION
function renderItems() {
  var tbody = document.getElementById('itemsBody');
  if (!tbody) return;

  if (_mrsState.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' +
      '<i class="bi bi-inbox fs-3 d-block mb-2 opacity-50"></i>' +
      'Click "Add Item" to start.</td></tr>';
    return;
  }

  var html = '';
  _mrsState.items.forEach(function(it, idx) {
    html += '<tr data-idx="' + idx + '">' +
      '<td class="text-center">' + (idx + 1) + '</td>' +
      '<td>' +
        '<div class="item-search-wrap">' +
          '<input type="text" class="form-control form-control-sm item-code-input" ' +
            'id="mrsItemCode' + idx + '" ' +
            'value="' + erpEsc(it.itemCode) + '" ' +
            'placeholder="Type to search..." ' +
            'autocomplete="off" ' +
            'oninput="onMrsItemCodeInput(' + idx + ', this.value)" ' +
            'onfocus="onMrsItemCodeInput(' + idx + ', this.value)" ' +
            'onblur="onMrsItemCodeBlur(' + idx + ')">' +
          '<div class="item-search-dropdown d-none" id="mrsDropdown' + idx + '"></div>' +
        '</div>' +
      '</td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
        'id="mrsItemDesc' + idx + '" ' +
        'value="' + erpEsc(it.description) + '" placeholder="Auto-filled" ' +
        'oninput="updateItem(' + idx + ', \'description\', this.value)"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center item-qty-input" ' +
        'value="' + (it.qtyReturned || 0) + '" min="0" step="0.01" ' +
        'oninput="updateItem(' + idx + ', \'qtyReturned\', parseFloat(this.value)||0)"></td>' +
      '<td><input type="text" class="form-control form-control-sm text-center" ' +
        'id="mrsItemUnit' + idx + '" ' +
        'value="' + erpEsc(it.unit || 'PIECE') + '" ' +
        'oninput="updateItem(' + idx + ', \'unit\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
        'value="' + erpEsc(it.remarks) + '" placeholder="Optional" ' +
        'oninput="updateItem(' + idx + ', \'remarks\', this.value)"></td>' +
      '<td class="text-center"><button class="btn btn-sm btn-outline-danger" ' +
        'onclick="mrsManualRemoveItemAt(' + idx + ')" title="Remove"><i class="bi bi-trash"></i></button></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

window.mrsManualRemoveItemAt = function(idx) {
  if (!confirm('Remove this item?')) return;
  _mrsState.items.splice(idx, 1);
  renderItems();
};

function updateItem(idx, field, value) {
  if (_mrsState.items[idx]) _mrsState.items[idx][field] = value;
}

function onMrsItemCodeInput(idx, value) {
  var input = document.getElementById('mrsItemCode' + idx);
  var dropdown = document.getElementById('mrsDropdown' + idx);
  if (!input || !dropdown) return;

  var term = String(value || '').toLowerCase().trim();
  if (_mrsSearchTimers[idx]) clearTimeout(_mrsSearchTimers[idx]);

  if (!term || term.length < 2) { dropdown.classList.add('d-none'); return; }

  dropdown.innerHTML = '<div class="item-search-item muted"><i class="bi bi-hourglass-split me-2"></i>Searching...</div>';
  dropdown.classList.remove('d-none');

  _mrsSearchTimers[idx] = setTimeout(function() { _mrsSearchItems(idx, term); }, 200);
}

function _mrsSearchItems(idx, term) {
  var input = document.getElementById('mrsItemCode' + idx);
  var dropdown = document.getElementById('mrsDropdown' + idx);
  if (!input || !dropdown) return;

  var items = _mrsInventoryCache || [];
  var matches = items.filter(function(it) {
    return String(it.code).toLowerCase().indexOf(term) !== -1 || String(it.description).toLowerCase().indexOf(term) !== -1;
  }).slice(0, 30);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="item-search-item muted"><i class="bi bi-x-circle me-2"></i>No matches</div>';
    return;
  }

  var html = '';
  matches.forEach(function(it) {
    var safeCode = String(it.code).replace(/'/g, "\\'");
    var safeDesc = String(it.description).replace(/'/g, "\\'");
    var safeUnit = String(it.unit).replace(/'/g, "\\'");
    html += '<div class="item-search-item" onmousedown="event.preventDefault();selectMrsItem(' + idx + ', \'' + safeCode + '\', \'' + safeDesc + '\', \'' + safeUnit + '\')">' +
      '<div class="item-code">' + erpEsc(it.code) + '</div>' +
      '<div class="item-desc">' + erpEsc(String(it.description).substring(0, 100)) + '</div>' +
    '</div>';
  });
  dropdown.innerHTML = html;
  dropdown.classList.remove('d-none');
}

function selectMrsItem(idx, code, description, unit) {
  if (_mrsState.items[idx]) {
    _mrsState.items[idx].itemCode = code;
    _mrsState.items[idx].description = description;
    _mrsState.items[idx].unit = unit;
  }
  var codeInput = document.getElementById('mrsItemCode' + idx);
  var descInput = document.getElementById('mrsItemDesc' + idx);
  var unitInput = document.getElementById('mrsItemUnit' + idx);
  if (codeInput) codeInput.value = code;
  if (descInput) descInput.value = description;
  if (unitInput) unitInput.value = unit;

  var dropdown = document.getElementById('mrsDropdown' + idx);
  if (dropdown) dropdown.classList.add('d-none');

  setTimeout(function() {
    var qtyInput = document.querySelector('tr[data-idx="' + idx + '"] .item-qty-input');
    if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
  }, 100);
}
window.selectMrsItem = selectMrsItem;

function onMrsItemCodeBlur(idx) {
  setTimeout(function() {
    var dropdown = document.getElementById('mrsDropdown' + idx);
    if (dropdown) dropdown.classList.add('d-none');
  }, 200);
}

async function submitMrs() {
  if (_mrsState.isSubmitting) return;
  var now = Date.now();
  if (_mrsState.lastSubmittedAt && (now - _mrsState.lastSubmittedAt) < 10000) { erpShowToast('Please wait...', 'warning'); return; }

  var department = document.getElementById('mrsDepartment').value.trim();
  if (!department) { erpShowToast('Department is required', 'warning'); return; }

  var joNo = document.getElementById('mrsJoNo').value.trim();
  var gemSoNo = document.getElementById('mrsGemSoNo').value.trim();
  var clientName = document.getElementById('mrsClientName').value.trim();
  var project = document.getElementById('mrsProject').value.trim();

  var validItems = [];
  var rows = document.querySelectorAll('#itemsBody tr');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var codeEl = row.querySelector('.item-code-input');
    if (!codeEl) continue;
    var code = codeEl.value.trim();
    var descEl = row.querySelector('#mrsItemDesc' + i);
    var qtyEl = row.querySelector('.item-qty-input');
    var unitEl = row.querySelector('#mrsItemUnit' + i);
    var desc = descEl ? descEl.value.trim() : '';
    var qtyReturned = qtyEl ? (parseFloat(qtyEl.value) || 0) : 0;
    var unit = unitEl ? unitEl.value : 'PIECE';
    if (!code) continue;
    if (qtyReturned <= 0) { erpShowToast('Item #' + (i + 1) + ' has invalid quantity', 'warning'); return; }
    
    validItems.push({ 
      item_code: code, 
      description: desc, 
      qty: qtyReturned, 
      unit: unit, 
      remarks: 'PENDING' 
    });
  }

  if (validItems.length === 0) { erpShowToast('Please add at least one item', 'warning'); return; }
  if (!confirm('Submit MRS with ' + validItems.length + ' item(s)?\n\nStatus will be PENDING — warehouse will verify.')) return;

  _mrsState.isSubmitting = true;
  _mrsState.lastSubmittedAt = now;
  var btn = document.getElementById('btnSubmitMrs');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

  try {
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST', headers: erpHeaders(), body: JSON.stringify({ p_prefix: 'MRS' })
    });
    if (!rpcRes.ok) throw new Error('RPC Doc Num failed');
    var nextNum = await rpcRes.json();
    var padded = String(nextNum).padStart(4, '0');
    var docNo = 'MRS' + padded;

    var currentUser = localStorage.getItem('ivm_userFullname') || 'PRODUCTION';
    var docPayload = {
      requestor: _mrsState.requestor, department: department, jo_no: joNo,
      gem_so_no: gemSoNo, client_name: clientName, project: project,
      date_prepared: new Date().toISOString().split('T')[0], prepared_by: _mrsState.requestor
    };

    var processRes = await fetch(erpUrl('rpc/erp_submit_mrs'), {
      method: 'POST', headers: erpHeaders(),
      body: JSON.stringify({ p_doc_no: docNo, p_doc_payload: docPayload, p_items: validItems, p_processed_by: currentUser })
    });
    if (!processRes.ok) { var e = await processRes.text(); throw new Error('RPC Error: ' + processRes.status + ' ' + e); }
    var data = await processRes.json();
    if (!data || !data.success) throw new Error(data.error || 'Unknown error');

    erpShowToast('✅ MRS created: ' + docNo + ' (PENDING)', 'success');
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
  renderItems();
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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

console.log('✅ new-mrs-manual.js v2.0 loaded');
