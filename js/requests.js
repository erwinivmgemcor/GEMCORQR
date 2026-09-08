// ============================================================
// NEW REQUEST FUNCTIONS (with Item Scanner & Remarks)
// ============================================================

function openNewRequest() {
  if (state.isLoading) return;
  resetWizard();
  loadRequestInventory();
  loadRequestorList();
  newRequestModal.show();
}

function resetWizard() {
  document.getElementById('reqDocType').value = '';
  document.getElementById('reqJoNo').value = '';
  document.getElementById('reqRequestor').value = '';
  document.getElementById('reqDepartment').value = '';
  document.getElementById('reqGemSoNo').value = '';
  document.getElementById('reqClientName').value = '';
  document.getElementById('reqProject').value = '';

  document.querySelectorAll('.doc-type-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('btnStep1Next').disabled = true;

  document.getElementById('step2JoNo').value = '';
  document.getElementById('joNoStatus').innerHTML = '';

  document.getElementById('step3Requestor').value = '';
  document.getElementById('step3Department').value = '';
  document.getElementById('btnStep3Next').disabled = true;

  document.getElementById('step5ItemsContainer').innerHTML = '';
  addStep5ItemRow();
  document.getElementById('btnStep5Next').disabled = true;

  closeWizardScanner();

  goToStep(1);
}

// ─── Updated addStep5ItemRow with Remarks column ──────────────
function addStep5ItemRow() {
  var container = document.getElementById('step5ItemsContainer');
  var idx = container.children.length;
  var div = document.createElement('div');
  div.className = 'step5-item-row';
  div.innerHTML =
    '<div class="row g-2 align-items-end">' +
      '<div class="col-6 col-md-3">' +
        '<label class="form-label small">Item</label>' +
        '<div class="input-group">' +
          '<input type="text" class="form-control req-item-search" placeholder="Type to search or scan..." oninput="filterStep5Items(this,' + idx + ')" onfocus="filterStep5Items(this,' + idx + ')">' +
          '<button class="btn btn-outline-secondary scan-wizard-btn" type="button" onclick="openWizardScanner(' + idx + ')" title="Scan QR Code">' +
            '<i class="bi bi-qr-code-scan"></i>' +
          '</button>' +
        '</div>' +
        '<div class="list-group position-absolute z-3 d-none req-dropdown" style="max-height:200px;overflow-y:auto;width:90%;background:#fff;border:1px solid #ced4da;border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,0.18);" id="step5Dropdown' + idx + '"></div>' +
        '<input type="hidden" class="req-item-code" id="step5Code' + idx + '">' +
        '<input type="hidden" class="req-item-desc" id="step5Desc' + idx + '">' +
      '</div>' +
      '<div class="col-2 col-md-1">' +
        '<label class="form-label small">Qty</label>' +
        '<input type="number" class="form-control req-qty" min="1" value="1">' +
      '</div>' +
      '<div class="col-2 col-md-2">' +
        '<label class="form-label small">Unit</label>' +
        '<select class="form-select req-unit">' +
          buildUnitOptions('PIECE') +
        '</select>' +
      '</div>' +
      '<div class="col-3 col-md-3">' +
        '<label class="form-label small">Remarks</label>' +
        '<input type="text" class="form-control req-remarks" placeholder="Optional note..." maxlength="200">' +
      '</div>' +
      '<div class="col-1 col-md-1">' +
        '<button class="btn btn-outline-danger btn-sm w-100" onclick="this.closest(\'.step5-item-row\').remove(); checkStep5Items();">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  container.appendChild(div);
  checkStep5Items();
}

function filterStep5Items(input, idx) {
  var term = input.value.toLowerCase();
  var dropdown = document.getElementById('step5Dropdown' + idx);
  dropdown.innerHTML = '';
  if (!term) { dropdown.classList.add('d-none'); return; }

  var matches = state.requestInventoryList.filter(function(it) {
    var code = (it.code || it.inventoryId || '').toLowerCase();
    var desc = (it.description || '').toLowerCase();
    return code.includes(term) || desc.includes(term);
  }).slice(0, 15);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted">No matches</div>';
  } else {
    matches.forEach(function(it) {
      var code = it.code || it.inventoryId || '';
      var desc = it.description || '';
      var unit = it.unit || 'PIECE';
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid #f0f0f0;';
      el.innerHTML = '<div class="fw-bold small">' + code + '</div><div class="small text-muted">' + desc + ' <span class="badge bg-light text-dark">' + unit + '</span></div>';
      el.onclick = function() {
        input.value = code + ' - ' + desc;
        document.getElementById('step5Code' + idx).value = code;
        document.getElementById('step5Desc' + idx).value = desc;
        var unitSelect = input.closest('.step5-item-row').querySelector('.req-unit');
        if (unitSelect && unitSelect.querySelector('option[value="' + unit + '"]')) {
          unitSelect.value = unit;
        }
        dropdown.classList.add('d-none');
        checkStep5Items();
      };
      dropdown.appendChild(el);
    });
  }
  dropdown.classList.remove('d-none');
}

// ─── Final review includes remarks ────────────────────────────
function populateFinalReview() {
  // ... existing code ...
  // In the items loop, include remarks:
  var remarks = row.querySelector('.req-remarks').value || '';
  // Then in the table row: '<td>' + remarks + '</td>'
}

// ─── Submit includes remarks ──────────────────────────────────
async function submitNewRequest() {
  // ... existing code ...
  // When building items, include remarks:
  var remarks = row.querySelector('.req-remarks').value || '';
  items.push({ inventoryId: code, description: desc, qty: qty, unit: unit, remarks: remarks });
  // ... rest of function
}

// ─── MANUAL MRIF (with remarks and dropdown) ──────────────────
var manualMrifModal = null;
var manualMrifItems = [];

function openManualMrifModal() {
  if (!manualMrifModal) {
    manualMrifModal = new bootstrap.Modal(document.getElementById('manualMrifModal'));
  }
  // Reset fields
  document.getElementById('manualMrifRequestor').value = '';
  document.getElementById('manualMrifDepartment').value = '';
  document.getElementById('manualMrifJoNo').value = '';
  document.getElementById('manualMrifGemSoNo').value = '';
  document.getElementById('manualMrifClient').value = '';
  document.getElementById('manualMrifProject').value = '';
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('manualMrifDate').value = today;
  
  // Preload inventory if not loaded
  if (state.requestInventoryList.length === 0) {
    loadRequestInventory().then(function() {
      // After load, render
    });
  }
  manualMrifItems = [];
  renderManualMrifItems();
  updateManualMrifSubmitButton();
  manualMrifModal.show();
}

function addManualMrifItem() {
  manualMrifItems.push({
    inventoryId: '',
    description: '',
    qty: 1,
    atlQty: 0,
    unit: 'PIECE',
    remarks: ''
  });
  renderManualMrifItems();
  updateManualMrifSubmitButton();
  setTimeout(function() {
    var searches = document.querySelectorAll('.manual-mrif-search');
    if (searches.length > 0) {
      searches[searches.length - 1].focus();
    }
  }, 100);
}

function removeManualMrifItem(index) {
  manualMrifItems.splice(index, 1);
  renderManualMrifItems();
  updateManualMrifSubmitButton();
}

function updateManualMrifItem(index, field, value) {
  if (manualMrifItems[index]) {
    manualMrifItems[index][field] = value;
  }
  updateManualMrifSubmitButton();
}

function renderManualMrifItems() {
  var tbody = document.getElementById('manualMrifItemsBody');
  var emptyState = document.getElementById('manualMrifEmptyState');
  if (!tbody) return;

  if (manualMrifItems.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  var html = '';
  for (var i = 0; i < manualMrifItems.length; i++) {
    var it = manualMrifItems[i];
    html += '<tr>' +
      '<td class="align-middle text-center">' + (i + 1) + '</td>' +
      '<td>' +
        '<div style="position:relative;width:100%;">' +
          '<input type="text" class="form-control form-control-sm manual-mrif-search" ' +
            'placeholder="Type to search..." ' +
            'value="' + (it.inventoryId ? it.inventoryId + ' - ' + it.description : '') + '" ' +
            'oninput="filterManualMrifItems(this, ' + i + ')" ' +
            'onfocus="filterManualMrifItems(this, ' + i + ')" ' +
            'onclick="this.select();filterManualMrifItems(this, ' + i + ')" ' +
            'autocomplete="off" ' +
            'style="width:100%;min-width:120px;">' +
          '<div class="list-group position-absolute z-3 d-none manual-mrif-dropdown" ' +
            'style="max-height:300px;overflow-y:auto;width:100%;min-width:250px;background:#fff;border:1px solid #ced4da;border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,0.18);position:absolute;top:100%;left:0;z-index:9999;margin-top:2px;padding:4px 0;" ' +
            'id="manualMrifDropdown' + i + '"></div>' +
          '<input type="hidden" class="manual-mrif-code" id="manualMrifCode' + i + '" value="' + (it.inventoryId || '') + '">' +
          '<input type="hidden" class="manual-mrif-desc" id="manualMrifDesc' + i + '" value="' + (it.description || '') + '">' +
        '</div>' +
      '</td>' +
      '<td><input type="text" class="form-control form-control-sm manual-mrif-desc-text" ' +
        'id="manualMrifDescText' + i + '" ' +
        'value="' + (it.description || '') + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'description\', this.value)" ' +
        'placeholder="Description" style="min-width:100px;"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.qty || 1) + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'qty\', parseFloat(this.value)||0)" ' +
        'min="1" step="1" style="width:70px;"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.atlQty || 0) + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'atlQty\', parseFloat(this.value)||0)" ' +
        'min="0" step="1" style="width:70px;"></td>' +
      '<td><select class="form-select form-select-sm manual-mrif-unit" ' +
        'onchange="updateManualMrifItem(' + i + ', \'unit\', this.value)" style="width:85px;">' +
        buildUnitOptions(it.unit || 'PIECE') +
      '</select></td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
        'value="' + (it.remarks || '') + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'remarks\', this.value)" ' +
        'placeholder="Remarks" maxlength="200" style="min-width:100px;"></td>' +
      '<td class="align-middle text-center">' +
        '<button class="btn btn-sm btn-outline-danger" onclick="removeManualMrifItem(' + i + ')" title="Remove">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

// ─── Filter for manual MRIF dropdown ──────────────────────────
function filterManualMrifItems(input, idx) {
  var term = input.value.toLowerCase();
  var dropdown = document.getElementById('manualMrifDropdown' + idx);
  dropdown.innerHTML = '';

  if (!term) {
    dropdown.classList.add('d-none');
    return;
  }

  if (state.requestInventoryList.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted" style="padding:8px 12px;">Loading inventory...</div>';
    dropdown.classList.remove('d-none');
    return;
  }

  var matches = state.requestInventoryList.filter(function(it) {
    var code = (it.code || it.inventoryId || '').toLowerCase();
    var desc = (it.description || '').toLowerCase();
    return code.includes(term) || desc.includes(term);
  }).slice(0, 20);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted" style="padding:8px 12px;">No matches found</div>';
  } else {
    matches.forEach(function(it) {
      var code = it.code || it.inventoryId || '';
      var desc = it.description || '';
      var unit = it.unit || 'PIECE';
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:0.9rem;border-bottom:1px solid #f0f0f0;transition:background 0.15s;';
      el.innerHTML = '<div class="fw-bold" style="color:#1e3a5f;">' + code + '</div><div class="text-muted small">' + desc + ' <span class="badge bg-light text-dark">' + unit + '</span></div>';
      el.onmouseover = function() { this.style.background = '#e8f0fe'; };
      el.onmouseout = function() { this.style.background = ''; };
      el.onclick = function() {
        selectManualMrifItem(idx, code, desc, unit);
        dropdown.classList.add('d-none');
      };
      dropdown.appendChild(el);
    });
  }
  dropdown.classList.remove('d-none');
}

function selectManualMrifItem(idx, code, desc, unit) {
  manualMrifItems[idx].inventoryId = code;
  manualMrifItems[idx].description = desc;
  manualMrifItems[idx].unit = unit || 'PIECE';

  var row = document.querySelector('#manualMrifItemsBody tr:nth-child(' + (idx + 1) + ')');
  if (row) {
    var searchInput = row.querySelector('.manual-mrif-search');
    if (searchInput) searchInput.value = code + ' - ' + desc;
    var descInput = row.querySelector('.manual-mrif-desc-text');
    if (descInput) descInput.value = desc;
    var unitSelect = row.querySelector('.manual-mrif-unit');
    if (unitSelect) {
      for (var opt = 0; opt < unitSelect.options.length; opt++) {
        if (unitSelect.options[opt].value === unit) {
          unitSelect.selectedIndex = opt;
          break;
        }
      }
    }
    var codeHidden = document.getElementById('manualMrifCode' + idx);
    var descHidden = document.getElementById('manualMrifDesc' + idx);
    if (codeHidden) codeHidden.value = code;
    if (descHidden) descHidden.value = desc;
  }

  updateManualMrifSubmitButton();
  playSuccessBeep();
  var dropdown = document.getElementById('manualMrifDropdown' + idx);
  if (dropdown) dropdown.classList.add('d-none');
}

function updateManualMrifSubmitButton() {
  var btn = document.getElementById('btnSubmitManualMrif');
  if (!btn) return;

  var requestor = document.getElementById('manualMrifRequestor').value.trim();

  var hasValidItems = false;
  for (var i = 0; i < manualMrifItems.length; i++) {
    var it = manualMrifItems[i];
    if (it.inventoryId && it.inventoryId.trim() && it.description && it.description.trim() && it.qty > 0) {
      hasValidItems = true;
      break;
    }
  }

  btn.disabled = !(requestor && hasValidItems);
}

async function submitManualMrif() {
  var requestor = document.getElementById('manualMrifRequestor').value.trim();
  var department = document.getElementById('manualMrifDepartment').value.trim();
  var joNo = document.getElementById('manualMrifJoNo').value.trim();
  var gemSoNo = document.getElementById('manualMrifGemSoNo').value.trim();
  var clientName = document.getElementById('manualMrifClient').value.trim();
  var project = document.getElementById('manualMrifProject').value.trim();

  var items = [];
  var rows = document.querySelectorAll('#manualMrifItemsBody tr');
  for (var i = 0; i < rows.length; i++) {
    var codeInput = rows[i].querySelector('.manual-mrif-code');
    var descInput = rows[i].querySelector('.manual-mrif-desc');
    var qtyInput = rows[i].querySelector('td:nth-child(4) input');
    var atlInput = rows[i].querySelector('td:nth-child(5) input');
    var unitSelect = rows[i].querySelector('.manual-mrif-unit');
    var remarksInput = rows[i].querySelector('td:nth-child(7) input');
    var code = codeInput ? codeInput.value.trim() : '';
    var desc = descInput ? descInput.value.trim() : '';
    var qty = qtyInput ? parseInt(qtyInput.value, 10) : 0;
    var atl = atlInput ? parseInt(atlInput.value, 10) : 0;
    var unit = unitSelect ? unitSelect.value : 'PIECE';
    var remarks = remarksInput ? remarksInput.value : '';
    if (code && desc && qty > 0) {
      items.push({
        inventoryId: code,
        description: desc,
        qty: qty,
        atlQty: atl,
        unit: unit,
        remarks: remarks
      });
    }
  }

  if (items.length === 0) {
    showToast('Please add at least one valid item', 'warning');
    return;
  }

  if (!requestor) {
    showToast('Please enter a requestor name', 'warning');
    return;
  }

  showLoading('Creating Manual MRIF...');

  var timeoutId = setTimeout(function() {
    console.warn('[Manual MRIF] Loading timeout – forcing hide.');
    hideLoading();
  }, 10000);

  try {
    var payload = {
      action: 'createRequest',
      docType: 'MRIF',
      requestor: requestor,
      department: department || '',
      joNo: joNo || '',
      gemSoNo: gemSoNo || '',
      clientName: clientName || '',
      project: project || '',
      items: items,
      timestamp: new Date().toISOString(),
      isManual: true
    };

    console.log('[Manual MRIF] Payload:', payload);

    var res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    });

    console.log('[Manual MRIF] Response status:', res.status);

    var text = await res.text();
    console.log('[Manual MRIF] Raw response:', text);

    var data;
    try { data = JSON.parse(text); } catch(e) {
      throw new Error('Invalid JSON response from server');
    }

    if (data && data.success) {
      if (manualMrifModal) manualMrifModal.hide();
      showToast('Manual MRIF created: ' + data.docNo, 'success');
      await fetchPendingDocs();
      await loadWarehouseNotifications();
      await updateWarehouseKPIs();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    console.error('[Manual MRIF] Error:', err);
    showToast('Error: ' + err.message, 'danger');
  } finally {
    clearTimeout(timeoutId);
    hideLoading();
  }
}
