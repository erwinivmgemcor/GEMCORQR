// ============================================================
// GEMCOR ERP — New MRS Creation (v2.0)
// ✅ Auto-suggest for manual item entry
// ✅ ONLY Qty Returned (warehouse verifies ATL Qty)
// ✅ Status starts as PENDING (like MRIF)
// ✅ Auto-fill date_prepared
// ============================================================

var _mrsState = {
  joNo: '',
  gemSoNo: '',
  clientName: '',
  project: '',
  requestor: '',
  department: '',
  items: [],
  isSubmitting: false,
  lastSubmittedAt: 0
};

// Auto-suggest cache
var _mrsInventoryCache = null;
var _mrsInventoryPromise = null;
var _mrsSearchTimers = {};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[New MRS v2.0] Initializing...');

  mrsCheckHealth();

  var userFullname = localStorage.getItem('ivm_userFullname') ||
                     localStorage.getItem('ivm_username') || '';
  _mrsState.requestor = userFullname;

  document.getElementById('mrsDate').value = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric'
  });

  loadUserDepartment();

  document.getElementById('mrsJoNo').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupJoNo();
    }
  });

  // Preload inventory for auto-suggest
  setTimeout(function() {
    _mrsLoadInventory().then(function(items) {
      _mrsInventoryCache = items;
      console.log('[MRS v2.0] Inventory cache preloaded:', items.length, 'items');
    }).catch(function(err) {
      console.warn('[MRS v2.0] Preload failed:', err.message);
    });
  }, 500);

  console.log('[New MRS v2.0] Ready. Requestor:', userFullname);
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
      deptField.readOnly = false;
    }
  } catch(err) {
    deptField.placeholder = 'Enter department';
    deptField.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// JO LOOKUP
// ═══════════════════════════════════════════════════════════
async function lookupJoNo() {
  var joNo = document.getElementById('mrsJoNo').value.trim();
  var statusEl = document.getElementById('joStatus');
  var resultEl = document.getElementById('joLookupResult');

  if (!joNo) {
    statusEl.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> Please enter a JO No.</span>';
    return;
  }

  statusEl.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split"></i> Looking up...</span>';
  resultEl.className = 'alert alert-info mb-0 py-2';
  resultEl.innerHTML = '<span class="small">Searching...</span>';

  try {
    var rows = await erpFetch('erp_sof_cache',
      'jo_no=eq.' + encodeURIComponent(joNo) + '&limit=1');

    if (!rows || rows.length === 0) {
      statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> JO No. not found</span>';
      resultEl.className = 'alert alert-warning mb-0 py-2';
      resultEl.innerHTML = '<span class="small"><i class="bi bi-exclamation-triangle me-1"></i>JO No. <strong>' + erpEsc(joNo) + '</strong> not found.</span>';
      return;
    }

    var sof = rows[0];
    _mrsState.joNo = joNo;
    _mrsState.gemSoNo = sof.so_form || sof.so_no || '';
    _mrsState.clientName = sof.client_name || '';
    _mrsState.project = sof.project_name || '';

    document.getElementById('mrsGemSoNo').value = _mrsState.gemSoNo;
    document.getElementById('mrsClientName').value = _mrsState.clientName;
    document.getElementById('mrsProject').value = _mrsState.project;
    document.getElementById('mrsRequestor').value = _mrsState.requestor;

    document.getElementById('step2Card').style.display = 'block';
    document.getElementById('step3Card').style.display = 'block';
    document.getElementById('step4Card').style.display = 'block';

    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> JO No. found!</span>';
    resultEl.className = 'alert alert-success mb-0 py-2';
    resultEl.innerHTML = '<span class="small"><i class="bi bi-check-circle me-1"></i>Found: <strong>' + erpEsc(sof.so_form || '') + '</strong> — ' + erpEsc(sof.client_name || '') + '</span>';

    erpShowToast('JO No. found!', 'success');

    setTimeout(function() {
      var addBtn = document.querySelector('#step3Card .btn-primary');
      if (addBtn) addBtn.focus();
    }, 300);

  } catch(err) {
    console.error('[lookupJoNo]', err);
    statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed</span>';
    resultEl.className = 'alert alert-danger mb-0 py-2';
    resultEl.innerHTML = '<span class="small">' + erpEsc(err.message) + '</span>';
  }
}

// ═══════════════════════════════════════════════════════════
// ITEMS MANAGEMENT
// ═══════════════════════════════════════════════════════════
function addItemRow() {
  _mrsState.items.push({
    itemCode: '',
    description: '',
    qtyReturned: 0,
    unit: 'PIECE',
    remarks: ''
  });
  renderItems();

  var newIdx = _mrsState.items.length - 1;
  setTimeout(function() {
    var input = document.getElementById('mrsItemCode' + newIdx);
    if (input) input.focus();
  }, 150);
}

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

      // ═══ ITEM CODE with auto-suggest ═══
      '<td style="position:relative;">' +
        '<input type="text" ' +
          'class="form-control form-control-sm item-code-input" ' +
          'id="mrsItemCode' + idx + '" ' +
          'data-idx="' + idx + '" ' +
          'value="' + erpEsc(it.itemCode) + '" ' +
          'placeholder="Type to search..." ' +
          'autocomplete="off" ' +
          'oninput="onMrsItemCodeInput(' + idx + ', this.value)" ' +
          'onfocus="onMrsItemCodeInput(' + idx + ', this.value)" ' +
          'onblur="onMrsItemCodeBlur(' + idx + ')">' +
        '<div class="item-search-dropdown d-none" id="mrsDropdown' + idx + '"></div>' +
      '</td>' +

      // ═══ DESCRIPTION (auto-filled) ═══
      '<td>' +
        '<input type="text" class="form-control form-control-sm" ' +
          'id="mrsItemDesc' + idx + '" ' +
          'value="' + erpEsc(it.description) + '" ' +
          'placeholder="Auto-filled" ' +
          'oninput="updateItem(' + idx + ', \'description\', this.value)">' +
      '</td>' +

      // ═══ QTY RETURNED ═══
      '<td>' +
        '<input type="number" class="form-control form-control-sm text-center item-qty-input" ' +
          'value="' + (it.qtyReturned || 0) + '" ' +
          'min="0" step="0.01" ' +
          'oninput="updateItem(' + idx + ', \'qtyReturned\', parseFloat(this.value)||0)">' +
      '</td>' +

      // ═══ UNIT ═══
      '<td>' +
        '<input type="text" class="form-control form-control-sm text-center" ' +
          'id="mrsItemUnit' + idx + '" ' +
          'value="' + erpEsc(it.unit || 'PIECE') + '" ' +
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
  if (_mrsState.items[idx]) {
    _mrsState.items[idx][field] = value;
  }
}

function removeItem(idx) {
  if (!confirm('Remove this item?')) return;
  _mrsState.items.splice(idx, 1);
  renderItems();
}

// ═══════════════════════════════════════════════════════════
// AUTO-SUGGEST
// ═══════════════════════════════════════════════════════════
function onMrsItemCodeInput(idx, value) {
  var input = document.getElementById('mrsItemCode' + idx);
  var dropdown = document.getElementById('mrsDropdown' + idx);
  if (!input || !dropdown) return;

  var term = String(value || '').toLowerCase().trim();

  if (_mrsSearchTimers[idx]) clearTimeout(_mrsSearchTimers[idx]);

  if (!term || term.length < 2) {
    dropdown.classList.add('d-none');
    return;
  }

  dropdown.innerHTML = '<div class="item-search-item muted">' +
    '<i class="bi bi-hourglass-split me-2"></i>Searching...</div>';
  _positionMrsDropdown(dropdown, input);
  dropdown.classList.remove('d-none');

  _mrsSearchTimers[idx] = setTimeout(async function() {
    await _mrsSearchItems(idx, term);
  }, 200);
}

async function _mrsSearchItems(idx, term) {
  var input = document.getElementById('mrsItemCode' + idx);
  var dropdown = document.getElementById('mrsDropdown' + idx);
  if (!input || !dropdown) return;

  try {
    if (!_mrsInventoryCache) {
      if (_mrsInventoryPromise) {
        await _mrsInventoryPromise;
      } else {
        _mrsInventoryPromise = _mrsLoadInventory();
        _mrsInventoryCache = await _mrsInventoryPromise;
        _mrsInventoryPromise = null;
      }
    }

    var items = _mrsInventoryCache || [];

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
      var unit = String(it.unit || 'PIECE');
      var category = String(it.category || '');
      var safeCode = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safeDesc = desc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safeUnit = unit.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      html += '<div class="item-search-item" ' +
        'onmousedown="event.preventDefault();selectMrsItem(' + idx + ', \'' +
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
    _positionMrsDropdown(dropdown, input);
    dropdown.classList.remove('d-none');

  } catch(err) {
    console.error('[_mrsSearchItems]', err);
    dropdown.innerHTML = '<div class="item-search-item muted" style="color:#dc2626;">' +
      '<i class="bi bi-exclamation-triangle me-2"></i>Search error</div>';
  }
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

window.selectMrsItem = selectMrsItem;

function onMrsItemCodeBlur(idx) {
  setTimeout(function() {
    var dropdown = document.getElementById('mrsDropdown' + idx);
    if (dropdown) dropdown.classList.add('d-none');
  }, 200);
}

function _positionMrsDropdown(dropdown, input) {
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

async function _mrsLoadInventory() {
  console.log('[MRS v2.0] Loading inventory for autocomplete...');
  try {
    if (typeof erpGetInventoryListForDropdown === 'function') {
      var list = await erpGetInventoryListForDropdown();
      console.log('[MRS v2.0] Inventory loaded (shared):', list.length, 'items');
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

    console.log('[MRS v2.0] Inventory loaded (fallback):', mapped.length, 'items');
    return mapped;
  } catch(err) {
    console.warn('[MRS v2.0] Inventory load failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT MRS — Status: PENDING (Warehouse will verify)
// ═══════════════════════════════════════════════════════════
async function submitMrs() {
  if (_mrsState.isSubmitting) return;

  var now = Date.now();
  if (_mrsState.lastSubmittedAt && (now - _mrsState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait before submitting again', 'warning');
    return;
  }

  if (!_mrsState.joNo) {
    erpShowToast('Please lookup a JO No. first', 'warning');
    return;
  }

  var department = document.getElementById('mrsDepartment').value.trim();
  if (!department) {
    erpShowToast('Department is required', 'warning');
    return;
  }
  _mrsState.department = department;

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

    if (qtyReturned <= 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid quantity', 'warning');
      return;
    }

    validItems.push({
      item_code: code,
      description: desc,
      qty: qtyReturned,
      atl_qty: qtyReturned, // ✅ Sa MRS, ang Requested at Actual ay pareho (warehouse mag-a-verify later kung babaguhin)
      unit: unit,
      remarks: 'PENDING'
    });
  }

  if (validItems.length === 0) {
    erpShowToast('Please add at least one item', 'warning');
    return;
  }

  if (!confirm('Submit MRS with ' + validItems.length + ' item(s)?\n\nStatus will be PENDING — warehouse will verify actual returned qty.')) return;

  _mrsState.isSubmitting = true;
  _mrsState.lastSubmittedAt = now;

  var btn = document.getElementById('btnSubmitMrs');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    // 1. Kunin ang susunod na Doc No
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: 'MRS' })
    });

    if (!rpcRes.ok) throw new Error('RPC Doc Num failed');
    var nextNum = await rpcRes.json();
    var padded = String(nextNum).padStart(4, '0');
    var docNo = 'MRS' + padded;

    var currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'PRODUCTION';

    var docPayload = {
      requestor: _mrsState.requestor,
      department: department,
      jo_no: _mrsState.joNo,
      gem_so_no: _mrsState.gemSoNo,
      client_name: _mrsState.clientName,
      project: _mrsState.project,
      date_prepared: new Date().toISOString().split('T')[0],
      prepared_by: _mrsState.requestor
    };

    // 2. Tawagin ang RPC para i-save lahat
    var processRes = await fetch(erpUrl('rpc/erp_submit_mrs'), {
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

    erpShowToast('✅ MRS created: ' + docNo + ' (PENDING — pending warehouse verification)', 'success');
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
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
  document.getElementById('successQrImg').src = qrUrl;

  var modalEl = document.getElementById('successModal');
  new bootstrap.Modal(modalEl).show();
  modalEl.addEventListener('hidden.bs.modal', function onHide() {
    modalEl.removeEventListener('hidden.bs.modal', onHide);
    resetFormSilent();
  }, { once: true });
}

function resetFormSilent() {
  _mrsState.joNo = '';
  _mrsState.gemSoNo = '';
  _mrsState.clientName = '';
  _mrsState.project = '';
  _mrsState.items = [];

  document.getElementById('mrsJoNo').value = '';
  document.getElementById('mrsGemSoNo').value = '';
  document.getElementById('mrsClientName').value = '';
  document.getElementById('mrsProject').value = '';
  document.getElementById('mrsRequestor').value = '';
  document.getElementById('joStatus').innerHTML = '';
  document.getElementById('joLookupResult').className = 'alert alert-secondary mb-0 py-2';
  document.getElementById('joLookupResult').innerHTML = '<span class="text-muted small">Enter a JO No. above to auto-fill details</span>';

  document.getElementById('step2Card').style.display = 'none';
  document.getElementById('step3Card').style.display = 'none';
  document.getElementById('step4Card').style.display = 'none';

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

// ═══════════════════════════════════════════════════════════
// GLOBAL: Hide dropdowns
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
    var idx = dropdown.id.replace('mrsDropdown', '');
    var input = document.getElementById('mrsItemCode' + idx);
    if (input) _positionMrsDropdown(dropdown, input);
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
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4000 });
  toast.show();
}

console.log('✅ new-mrs.js v2.0 loaded (PENDING status + auto-suggest)');
