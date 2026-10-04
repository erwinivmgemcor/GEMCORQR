// ============================================================
// GEMCOR ERP — New MRIF Creation
// Direct Supabase insert — No GAS, No Google Sheets
// ============================================================

var _mrifState = {
  joNo: '',
  gemSoNo: '',
  clientName: '',
  project: '',
  requestor: '',
  department: '',
  items: [],
  inventoryList: [],
  inventoryLoaded: false,
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[New MRIF] Initializing...');
  
  // Health check
  mrifCheckHealth();
  
  // Set requestor from login
  var userFullname = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || '';
  _mrifState.requestor = userFullname;
  
  // Set date
  document.getElementById('mrifDate').value = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric'
  });
  
  // Enter key handler sa JO input
  document.getElementById('mrifJoNo').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupJoNo();
    }
  });
  
  // Preload inventory in background
  preloadInventory();
  
  console.log('[New MRIF] Ready. Requestor:', userFullname);
});

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function mrifCheckHealth() {
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
// STEP 1: JO LOOKUP
// ═══════════════════════════════════════════════════════════
async function lookupJoNo() {
  var joNo = document.getElementById('mrifJoNo').value.trim();
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
    // Query erp_sof_cache for JO lookup
    var rows = await erpFetch('erp_sof_cache', 
      'jo_no=eq.' + encodeURIComponent(joNo) + '&limit=1');
    
    if (!rows || rows.length === 0) {
      statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> JO No. not found in SOF Monitoring</span>';
      resultEl.className = 'alert alert-warning mb-0 py-2';
      resultEl.innerHTML = '<span class="small"><i class="bi bi-exclamation-triangle me-1"></i>JO No. <strong>' + erpEsc(joNo) + '</strong> not found. Please verify the JO number.</span>';
      return;
    }
    
    var sof = rows[0];
    _mrifState.joNo = joNo;
    _mrifState.gemSoNo = sof.so_form || sof.so_no || '';
    _mrifState.clientName = sof.client_name || '';
    _mrifState.project = sof.project_name || '';
    
    // Auto-fill fields
    document.getElementById('mrifGemSoNo').value = _mrifState.gemSoNo;
    document.getElementById('mrifClientName').value = _mrifState.clientName;
    document.getElementById('mrifProject').value = _mrifState.project;
    document.getElementById('mrifRequestor').value = _mrifState.requestor;
    
    // Show step 2
    document.getElementById('step2Card').style.display = 'block';
    
    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> JO No. found!</span>';
    resultEl.className = 'alert alert-success mb-0 py-2';
    resultEl.innerHTML = '<span class="small"><i class="bi bi-check-circle me-1"></i>Found: <strong>' + erpEsc(sof.so_form || '') + '</strong> — ' + erpEsc(sof.client_name || '') + '</span>';
    
    erpShowToast('JO No. found!', 'success');
    
    // Focus department field
    setTimeout(function() {
      document.getElementById('mrifDepartment').focus();
    }, 300);
    
  } catch(err) {
    console.error('[lookupJoNo]', err);
    statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed</span>';
    resultEl.className = 'alert alert-danger mb-0 py-2';
    resultEl.innerHTML = '<span class="small">' + erpEsc(err.message) + '</span>';
  }
}

// ═══════════════════════════════════════════════════════════
// STEP 3: ITEMS MANAGEMENT
// ═══════════════════════════════════════════════════════════
async function preloadInventory() {
  if (_mrifState.inventoryLoaded) return;
  
  try {
    console.log('[Inventory] Preloading...');
    var rows = await erpFetch('inventory', 
      'select=item_code,description,unit&order=item_code.asc&limit=10000');
    
    _mrifState.inventoryList = (rows || []).map(function(r) {
      return {
        code: r.item_code,
        description: r.description || '',
        unit: r.unit || 'PIECE'
      };
    });
    _mrifState.inventoryLoaded = true;
    console.log('[Inventory] Loaded ' + _mrifState.inventoryList.length + ' items');
  } catch(err) {
    console.warn('[Inventory] Preload failed:', err.message);
  }
}

function addItemRow() {
  // Ensure step 3 is visible
  document.getElementById('step3Card').style.display = 'block';
  document.getElementById('step4Card').style.display = 'block';
  
  // Hide empty state
  var emptyState = document.getElementById('itemsEmptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  // Clone template
  var template = document.getElementById('itemRowTemplate');
  var clone = template.content.cloneNode(true);
  var row = clone.querySelector('.erp-item-row');
  
  // Generate unique index
  var idx = _mrifState.items.length;
  row.setAttribute('data-item-idx', idx);
  row.querySelector('.item-number').textContent = (idx + 1);
  
  // Attach item code input handler
  var codeInput = row.querySelector('.item-code-input');
  codeInput.addEventListener('input', function() {
    onItemCodeInput(this);
  });
  codeInput.addEventListener('focus', function() {
    onItemCodeInput(this);
  });
  codeInput.addEventListener('blur', function() {
    // Delay to allow click on dropdown
    var self = this;
    setTimeout(function() {
      hideItemDropdown(self);
    }, 200);
  });
  
  document.getElementById('itemsContainer').appendChild(clone);
  
  // Add to state
  _mrifState.items.push({
    code: '',
    description: '',
    qty: 1,
    unit: 'PIECE',
    remarks: ''
  });
  
  // Focus new row
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
  
  // Remove from state
  _mrifState.items[idx] = null;
  
  // Remove from DOM
  row.remove();
  
  // Re-index remaining rows
  reindexItemRows();
  
  // Show empty state if no more
  var remaining = document.querySelectorAll('.erp-item-row').length;
  if (remaining === 0) {
    document.getElementById('itemsEmptyState').style.display = 'block';
    document.getElementById('step4Card').style.display = 'none';
  }
}

function reindexItemRows() {
  var rows = document.querySelectorAll('.erp-item-row');
  var newItems = [];
  rows.forEach(function(row, i) {
    var oldIdx = parseInt(row.getAttribute('data-item-idx'), 10);
    var item = _mrifState.items[oldIdx];
    if (item) {
      row.setAttribute('data-item-idx', i);
      row.querySelector('.item-number').textContent = (i + 1);
      newItems.push(item);
    }
  });
  _mrifState.items = newItems;
}

function onItemCodeInput(input) {
  var row = input.closest('.erp-item-row');
  var idx = parseInt(row.getAttribute('data-item-idx'), 10);
  var dropdown = row.querySelector('.item-dropdown');
  var term = input.value.toLowerCase().trim();
  
  if (!term) {
    dropdown.classList.add('d-none');
    return;
  }
  
  if (!_mrifState.inventoryLoaded) {
    dropdown.innerHTML = '<div class="erp-item-dropdown-item muted">Loading inventory...</div>';
    dropdown.classList.remove('d-none');
    return;
  }
  
  // Search inventory
  var matches = _mrifState.inventoryList.filter(function(it) {
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
  
  // Attach click handlers
  dropdown.querySelectorAll('.erp-item-dropdown-item').forEach(function(el) {
    if (el.classList.contains('muted')) return;
    el.addEventListener('mousedown', function(e) {
      e.preventDefault(); // Prevent blur
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
  
  // Update state
  if (_mrifState.items[idx]) {
    _mrifState.items[idx].code = code;
    _mrifState.items[idx].description = desc;
    _mrifState.items[idx].unit = unit;
  }
  
  // Focus qty
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
// SUBMIT MRIF
// ═══════════════════════════════════════════════════════════
async function submitMrif() {
  if (_mrifState.isSubmitting) return;
  
  // ═══ Validation ═══
  if (!_mrifState.joNo) {
    erpShowToast('Please lookup a JO No. first', 'warning');
    return;
  }
  
  var department = document.getElementById('mrifDepartment').value.trim();
  if (!department) {
    erpShowToast('Please enter a Department', 'warning');
    document.getElementById('mrifDepartment').focus();
    return;
  }
  _mrifState.department = department;
  
  // Validate items
  var validItems = [];
  var rows = document.querySelectorAll('.erp-item-row');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var code = row.querySelector('.item-code-input').value.trim();
    var desc = row.querySelector('.item-desc-input').value.trim();
    var qty = parseFloat(row.querySelector('.item-qty-input').value) || 0;
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
    
    validItems.push({
      code: code,
      description: desc,
      qty: qty,
      unit: unit,
      remarks: remarks
    });
  }
  
  if (validItems.length === 0) {
    erpShowToast('Please add at least one item', 'warning');
    return;
  }
  
  // Confirm
  if (!confirm('Create MRIF with ' + validItems.length + ' item(s)?')) return;
  
  _mrifState.isSubmitting = true;
  var btn = document.getElementById('btnSubmitMrif');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
  
  try {
    // ═══ Step 1: Get next doc number via RPC ═══
    console.log('[Submit] Calling RPC get_next_doc_number...');
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: 'MRIF' })
    });
    
    if (!rpcRes.ok) {
      throw new Error('RPC failed: ' + rpcRes.status);
    }
    
    var nextNum = await rpcRes.json();
    if (!nextNum || typeof nextNum !== 'number') {
      throw new Error('Invalid RPC response: ' + JSON.stringify(nextNum));
    }
    
    // Format doc no: MRIF + 7-digit padding + suffix from department
    var padded = String(nextNum).padStart(7, '0');
    var deptSuffix = department.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    var docNo = 'MRIF' + padded + (deptSuffix ? '-' + deptSuffix : '');
    
    console.log('[Submit] Doc No:', docNo);
    
    // ═══ Step 2: Insert document ═══
    console.log('[Submit] Inserting document...');
    var docRes = await fetch(erpUrl('documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: 'MRIF',
        status: 'PENDING',
        is_bal: false,
        requestor: _mrifState.requestor,
        department: department,
        jo_no: _mrifState.joNo,
        gem_so_no: _mrifState.gemSoNo,
        client_name: _mrifState.clientName,
        project: _mrifState.project,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    
    if (!docRes.ok) {
      var errText = await docRes.text();
      throw new Error('Insert doc failed: ' + docRes.status + ' ' + errText);
    }
    
    var docArr = await docRes.json();
    var doc = docArr[0];
    if (!doc || !doc.id) {
      throw new Error('No document ID returned');
    }
    
    console.log('[Submit] Document ID:', doc.id);
    
    // ═══ Step 3: Insert items ═══
    console.log('[Submit] Inserting ' + validItems.length + ' items...');
    var itemPayloads = validItems.map(function(it, idx) {
      return {
        document_id: doc.id,
        doc_no: docNo,
        line_no: idx + 1,
        item_code: it.code,
        description: it.description,
        requested_qty: it.qty,
        issued_qty: 0,
        unit: it.unit,
        remarks: it.remarks || 'PENDING',
        row_index: idx + 1
      };
    });
    
    var itemsRes = await fetch(erpUrl('doc_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(itemPayloads)
    });
    
    if (!itemsRes.ok) {
      var itemsErrText = await itemsRes.text();
      throw new Error('Insert items failed: ' + itemsRes.status + ' ' + itemsErrText);
    }
    
    console.log('[Submit] Items inserted successfully');
    
    // ═══ Step 4: Success ═══
    erpShowToast('✅ MRIF created: ' + docNo, 'success');
    showSuccessModal(docNo);
    
  } catch(err) {
    console.error('[submitMrif] Error:', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _mrifState.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ═══════════════════════════════════════════════════════════
// SUCCESS MODAL
// ═══════════════════════════════════════════════════════════
function showSuccessModal(docNo) {
  document.getElementById('successDocNo').textContent = docNo;
  
  // Generate QR pointing to the print view
  var base = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  var qrData = base + '../?doc=' + encodeURIComponent(docNo) + '&view=print';
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
  document.getElementById('successQrImg').src = qrUrl;
  
  var modalEl = document.getElementById('successModal');
  var modal = new bootstrap.Modal(modalEl);
  modal.show();
}

function closeSuccessAndReset() {
  var modalEl = document.getElementById('successModal');
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
  
  setTimeout(function() {
    resetForm();
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// RESET FORM
// ═══════════════════════════════════════════════════════════
function resetForm() {
  if (!confirm('Reset the form? All unsaved data will be lost.')) return;
  
  _mrifState.joNo = '';
  _mrifState.gemSoNo = '';
  _mrifState.clientName = '';
  _mrifState.project = '';
  _mrifState.department = '';
  _mrifState.items = [];
  
  document.getElementById('mrifJoNo').value = '';
  document.getElementById('mrifGemSoNo').value = '';
  document.getElementById('mrifClientName').value = '';
  document.getElementById('mrifProject').value = '';
  document.getElementById('mrifRequestor').value = '';
  document.getElementById('mrifDepartment').value = '';
  document.getElementById('joStatus').innerHTML = '';
  document.getElementById('joLookupResult').className = 'alert alert-secondary mb-0 py-2';
  document.getElementById('joLookupResult').innerHTML = '<span class="text-muted small">Enter a JO No. above to auto-fill details</span>';
  
  // Hide step cards
  document.getElementById('step2Card').style.display = 'none';
  document.getElementById('step3Card').style.display = 'none';
  document.getElementById('step4Card').style.display = 'none';
  
  // Clear items
  var container = document.getElementById('itemsContainer');
  container.querySelectorAll('.erp-item-row').forEach(function(r) { r.remove(); });
  document.getElementById('itemsEmptyState').style.display = 'block';
  
  erpShowToast('Form reset', 'info');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 });
  toast.show();
}

console.log('✅ new-mrif.js loaded');
