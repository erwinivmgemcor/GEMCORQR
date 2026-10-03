// ============================================================
// GEMCOR ERP — New MRIF Wizard Logic
// ============================================================

var _newMrifState = {
  docType: '',
  joNo: '',
  gemSoNo: '',
  clientName: '',
  project: '',
  requestor: '',
  department: '',
  items: [],
  currentStep: 1,
  isSubmitting: false
};

var _newMrifInventory = [];
var _newMrifSearchTimer = null;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[New MRIF] Initializing...');
  newMrifCheckHealth();
  newMrifLoadUserInfo();
  newMrifLoadInventory();
});

async function newMrifCheckHealth() {
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

function newMrifLoadUserInfo() {
  var fullname = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
  var dept = localStorage.getItem('ivm_userDepartment') || '';
  
  if (!fullname) {
    // Try to get from erp_users
    var username = localStorage.getItem('ivm_username');
    if (username) {
      (async function() {
        try {
          var rows = await erpFetch('erp_users', 'username=eq.' + encodeURIComponent(username) + '&limit=1');
          if (rows && rows[0]) {
            fullname = rows[0].fullname || username;
            dept = rows[0].department || '';
          }
        } catch(e) { console.warn(e); }
      })();
    }
  }
  
  _newMrifState.requestor = fullname;
  _newMrifState.department = dept;
  
  document.getElementById('erpRequestorDisplay').textContent = fullname || '(not set)';
  document.getElementById('erpDepartmentDisplay').textContent = dept || '(not set)';
}

async function newMrifLoadInventory() {
  try {
    var rows = await erpFetch('erp_items',
      'select=item_code,description,unit&is_active=eq.true&order=item_code.asc&limit=10000');
    _newMrifInventory = rows || [];
    console.log('[New MRIF] Inventory loaded:', _newMrifInventory.length);
  } catch(err) {
    console.error('[newMrifLoadInventory]', err);
  }
}

// ═══════════════════════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════════════════════
function newMrifGoToStep(step) {
  // Validate current step before advancing
  if (step === 2 && !_newMrifState.docType) {
    newMrifShowToast('Please select document type');
    return;
  }
  
  _newMrifState.currentStep = step;
  
  // Update step indicators
  document.querySelectorAll('.erp-wizard-step').forEach(function(el) {
    var s = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('completed');
  });
  
  // Show active panel
  document.querySelectorAll('.erp-wizard-panel').forEach(function(el) {
    el.classList.remove('active');
  });
  var panel = document.getElementById('erpStep' + step);
  if (panel) panel.classList.add('active');
  
  // Pre-populate review step
  if (step === 5) newMrifPopulateReview();
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function newMrifSelectType(type) {
  _newMrifState.docType = type;
  document.querySelectorAll('.erp-doc-type-card').forEach(function(c) {
    c.classList.remove('selected');
  });
  var card = document.getElementById('typeCard' + type);
  if (card) card.classList.add('selected');
  var btn = document.getElementById('btnStep1Next');
  if (btn) btn.disabled = false;
}

// ═══════════════════════════════════════════════════════════
// JO LOOKUP
// ═══════════════════════════════════════════════════════════
function newMrifOnJoInput() {
  var val = document.getElementById('erpJoNo').value.trim();
  var status = document.getElementById('erpJoStatus');
  if (val.length > 0) {
    status.innerHTML = '<span class="text-muted"><i class="bi bi-info-circle"></i> Click "Lookup & Next"</span>';
  } else {
    status.innerHTML = '';
  }
}

async function newMrifDoLookupJo() {
  var joNo = document.getElementById('erpJoNo').value.trim();
  if (!joNo) {
    document.getElementById('erpJoStatus').innerHTML = '<span class="text-danger">JO No. is required</span>';
    return;
  }
  
  _newMrifState.joNo = joNo;
  
  var statusEl = document.getElementById('erpJoStatus');
  statusEl.innerHTML = '<span class="text-primary"><i class="bi bi-hourglass-split"></i> Looking up...</span>';
  
  try {
    var result = await erpGetSofByJo(joNo);
    if (result.success && result.sof) {
      var s = result.sof;
      _newMrifState.gemSoNo = s.sof_no || '';
      _newMrifState.clientName = s.client_name || '';
      _newMrifState.project = s.project_name || '';
      
      document.getElementById('erpGemSoNo').value = _newMrifState.gemSoNo;
      document.getElementById('erpClientName').value = _newMrifState.clientName;
      document.getElementById('erpProject').value = _newMrifState.project;
      
      statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle"></i> JO found! Info auto-filled.</span>';
      setTimeout(function() { newMrifGoToStep(3); }, 600);
    } else {
      // Not found — allow manual continue
      _newMrifState.gemSoNo = '';
      _newMrifState.clientName = '';
      _newMrifState.project = '';
      document.getElementById('erpGemSoNo').value = '';
      document.getElementById('erpClientName').value = '';
      document.getElementById('erpProject').value = '';
      
      statusEl.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> JO not found. You can still proceed.</span>';
      setTimeout(function() { newMrifGoToStep(3); }, 800);
    }
  } catch(err) {
    statusEl.innerHTML = '<span class="text-danger">Lookup failed: ' + err.message + '</span>';
  }
}

// ═══════════════════════════════════════════════════════════
// ITEMS MANAGEMENT
// ═══════════════════════════════════════════════════════════
function newMrifAddItem() {
  _newMrifState.items.push({
    inventoryId: '',
    description: '',
    qty: 1,
    unit: 'PIECE',
    remarks: ''
  });
  newMrifRenderItems();
  setTimeout(function() {
    var inputs = document.querySelectorAll('.erp-item-search-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
}

function newMrifRemoveItem(idx) {
  _newMrifState.items.splice(idx, 1);
  newMrifRenderItems();
}

function newMrifUpdateItem(idx, field, value) {
  if (_newMrifState.items[idx]) _newMrifState.items[idx][field] = value;
}

function newMrifRenderItems() {
  var container = document.getElementById('erpItemsContainer');
  if (!container) return;
  
  if (_newMrifState.items.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:32px;background:#f9fafb;border-radius:8px;color:#6b7280;">' +
      '<i class="bi bi-inbox" style="font-size:2rem;display:block;margin-bottom:8px;"></i>' +
      'No items yet. Click "Add Another Item" to start.</div>';
    return;
  }
  
  var html = '';
  _newMrifState.items.forEach(function(it, i) {
    html += '<div class="erp-item-row" data-idx="' + i + '">' +
      '<div class="erp-item-row-header">Item #' + (i + 1) + '</div>' +
      '<div class="erp-item-row-grid">' +
        '<div class="erp-item-field erp-item-code-field">' +
          '<label>Item Code</label>' +
          '<div style="position:relative;">' +
            '<input type="text" class="erp-input erp-item-search-input" ' +
              'placeholder="Type to search..." ' +
              'value="' + erpEsc(it.inventoryId ? (it.inventoryId + (it.description ? ' - ' + it.description : '')) : '') + '" ' +
              'oninput="newMrifFilterItems(this, ' + i + ')" ' +
              'onfocus="newMrifFilterItems(this, ' + i + ')" ' +
              'autocomplete="off" data-idx="' + i + '">' +
            '<div class="erp-item-dropdown d-none" id="erpItemDropdown' + i + '"></div>' +
          '</div>' +
        '</div>' +
        '<div class="erp-item-field">' +
          '<label>Description</label>' +
          '<input type="text" class="erp-input" value="' + erpEsc(it.description || '') + '" ' +
            'oninput="newMrifUpdateItem(' + i + ', \'description\', this.value)">' +
        '</div>' +
        '<div class="erp-item-field erp-item-qty-field">' +
          '<label>Qty</label>' +
          '<input type="number" class="erp-input" value="' + (it.qty || 1) + '" min="1" step="1" ' +
            'oninput="newMrifUpdateItem(' + i + ', \'qty\', parseFloat(this.value)||0)">' +
        '</div>' +
        '<div class="erp-item-field erp-item-unit-field">' +
          '<label>Unit</label>' +
          '<select class="erp-input" onchange="newMrifUpdateItem(' + i + ', \'unit\', this.value)">' +
            _newMrifUnitOptions(it.unit) +
          '</select>' +
        '</div>' +
        '<div class="erp-item-field erp-item-remarks-field">' +
          '<label>Remarks</label>' +
          '<input type="text" class="erp-input" value="' + erpEsc(it.remarks || '') + '" ' +
            'placeholder="Optional" oninput="newMrifUpdateItem(' + i + ', \'remarks\', this.value)">' +
        '</div>' +
        '<div class="erp-item-field erp-item-action-field">' +
          '<button type="button" class="erp-btn-remove-item" onclick="newMrifRemoveItem(' + i + ')" title="Remove">' +
            '<i class="bi bi-trash"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

function _newMrifUnitOptions(selected) {
  var units = (typeof UNIT_OPTIONS !== 'undefined' && UNIT_OPTIONS) ? UNIT_OPTIONS : 
              ['PIECE','ASSEMB','BOX','CAN','GAL','KG','LENGTH','LITERS','METER','MM','PAIR','REAM','ROLL','SET','SHEET','TANK','UNIT'];
  var html = '';
  units.forEach(function(u) {
    html += '<option value="' + u + '"' + (u === selected ? ' selected' : '') + '>' + u + '</option>';
  });
  return html;
}

function newMrifFilterItems(input, idx) {
  var term = String(input.value || '').toLowerCase().trim();
  var dropdown = document.getElementById('erpItemDropdown' + idx);
  if (!dropdown) return;
  
  if (!term) { dropdown.classList.add('d-none'); return; }
  
  var matches = _newMrifInventory.filter(function(it) {
    var c = String(it.item_code || '').toLowerCase();
    var d = String(it.description || '').toLowerCase();
    return c.indexOf(term) !== -1 || d.indexOf(term) !== -1;
  }).slice(0, 20);
  
  dropdown.innerHTML = '';
  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="erp-item-dropdown-item muted">No matches — you can type manually</div>';
  } else {
    matches.forEach(function(it) {
      var el = document.createElement('div');
      el.className = 'erp-item-dropdown-item';
      el.innerHTML = '<div class="item-code">' + erpEsc(it.item_code) + '</div>' +
                     '<div class="item-desc">' + erpEsc(it.description) + ' <span class="item-unit">' + erpEsc(it.unit) + '</span></div>';
      el.onmousedown = function(e) {
        e.preventDefault();
        newMrifSelectItem(idx, it.item_code, it.description, it.unit);
        dropdown.classList.add('d-none');
      };
      dropdown.appendChild(el);
    });
  }
  
  // Position dropdown
  var rect = input.getBoundingClientRect();
  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = Math.max(rect.width, 350) + 'px';
  var spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 260 && rect.top > spaceBelow) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 2) + 'px';
  }
  dropdown.style.maxHeight = '260px';
  dropdown.classList.remove('d-none');
}

function newMrifSelectItem(idx, code, desc, unit) {
  if (!_newMrifState.items[idx]) return;
  _newMrifState.items[idx].inventoryId = code;
  _newMrifState.items[idx].description = desc;
  _newMrifState.items[idx].unit = unit || 'PIECE';
  newMrifRenderItems();
}

// Close dropdown on outside click
document.addEventListener('click', function(e) {
  if (!e.target.classList.contains('erp-item-search-input')) {
    document.querySelectorAll('.erp-item-dropdown').forEach(function(d) {
      d.classList.add('d-none');
    });
  }
});

// ═══════════════════════════════════════════════════════════
// REVIEW
// ═══════════════════════════════════════════════════════════
function newMrifPopulateReview() {
  document.getElementById('reviewType').textContent = _newMrifState.docType;
  document.getElementById('reviewJoNo').textContent = _newMrifState.joNo || '—';
  document.getElementById('reviewRequestor').textContent = _newMrifState.requestor || '—';
  document.getElementById('reviewDepartment').textContent = _newMrifState.department || '—';
  document.getElementById('reviewGemSo').textContent = _newMrifState.gemSoNo || '—';
  document.getElementById('reviewClient').textContent = _newMrifState.clientName || '—';
  document.getElementById('reviewProject').textContent = _newMrifState.project || '—';
  
  var tbody = document.getElementById('reviewItemsBody');
  var validItems = _newMrifState.items.filter(function(it) {
    return it.inventoryId && it.qty > 0;
  });
  
  if (validItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No valid items</td></tr>';
  } else {
    tbody.innerHTML = '';
    validItems.forEach(function(it, i) {
      tbody.innerHTML += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><code>' + erpEsc(it.inventoryId) + '</code></td>' +
        '<td>' + erpEsc(it.description) + '</td>' +
        '<td>' + it.qty + '</td>' +
        '<td>' + erpEsc(it.unit) + '</td>' +
        '</tr>';
    });
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT
// ═══════════════════════════════════════════════════════════
async function newMrifSubmit() {
  if (_newMrifState.isSubmitting) return;
  
  var validItems = _newMrifState.items.filter(function(it) {
    return it.inventoryId && it.inventoryId.trim() && it.qty > 0;
  });
  
  if (validItems.length === 0) {
    newMrifShowToast('Please add at least one valid item');
    return;
  }
  
  if (!_newMrifState.requestor) {
    newMrifShowToast('Requestor not set. Please re-login.');
    return;
  }
  
  _newMrifState.isSubmitting = true;
  var btn = document.getElementById('btnSubmitMRIF');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="erp-spinner-sm"></div> Saving...';
  
  try {
    // Generate doc number
    var docNo = await newMrifGenerateDocNo(_newMrifState.docType);
    
    // Insert document
    var docPayload = {
      doc_no: docNo,
      doc_type: _newMrifState.docType,
      status: 'PENDING',
      requestor: _newMrifState.requestor,
      department: _newMrifState.department,
      jo_no: _newMrifState.joNo,
      gem_so_no: _newMrifState.gemSoNo,
      client_name: _newMrifState.clientName,
      project: _newMrifState.project,
      date_prepared: new Date().toISOString().split('T')[0],
      item_count: validItems.length,
      item_summary: validItems.map(function(it) { return it.inventoryId + ' x' + it.qty; }).join(', ')
    };
    
    await erpFetch('erp_documents', '', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: [docPayload]
    });
    
    // Insert items
    var itemsPayload = validItems.map(function(it, i) {
      return {
        doc_no: docNo,
        line_no: i + 1,
        item_code: it.inventoryId,
        description: it.description,
        unit: it.unit,
        requested_qty: it.qty,
        issued_qty: 0,
        remarks: it.remarks || 'PENDING'
      };
    });
    
    await erpFetch('erp_doc_items', '', {
      method: 'POST',
      body: itemsPayload
    });
    
    newMrifShowToast('✅ ' + docNo + ' created successfully!');
    
    // Redirect to list after 1.5s
    setTimeout(function() {
      window.location.href = 'mrif-list.html';
    }, 1500);
    
  } catch(err) {
    console.error('[newMrifSubmit]', err);
    newMrifShowToast('Failed: ' + err.message);
    _newMrifState.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function newMrifGenerateDocNo(docType) {
  // Use Supabase atomic counter
  try {
    var res = await fetch(erpUrl('rpc/fn_get_next_docno'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: docType })
    });
    if (!res.ok) throw new Error('Counter failed');
    var num = await res.json();
    var digits = (docType === 'MRS') ? 4 : 7;
    return docType + String(num).padStart(digits, '0');
  } catch(err) {
    console.warn('[newMrifGenerateDocNo]', err);
    // Fallback: generate from timestamp
    var ts = Date.now().toString().slice(-7);
    return docType + ts;
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function newMrifShowToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

console.log('✅ new-mrif.js loaded');
