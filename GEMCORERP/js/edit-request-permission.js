// ============================================================
// GEMCOR ERP — Edit Request Permission (Production)
// v2.0 — Full production edit form + item auto-suggest + robust save
// ✅ Uses edit_requests table
// ✅ Status: PENDING → APPROVED → COMPLETED
// ✅ Item search dropdown on edit form
// ✅ Robust error handling on save
// ============================================================

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
var _prodEditState = {
  docNo: null,
  docType: null,
  editReqId: null,
  originalDoc: null,
  originalItems: [],
  currentItems: [],
  modal: null,
  isSaving: false,
  inventoryCache: null
};

// ═══════════════════════════════════════════════════════════
// CHECK EDIT PERMISSION — Get current state for a document
// ═══════════════════════════════════════════════════════════
async function checkEditPermission(docNo) {
  if (!docNo) return null;
  
  var currentUser = localStorage.getItem('ivm_username') || '';
  if (!currentUser) return null;
  
  try {
    var rows = await erpFetch('edit_requests',
      'select=*' +
      '&doc_no=eq.' + encodeURIComponent(docNo) +
      '&requested_by=eq.' + encodeURIComponent(currentUser) +
      '&order=created_at.desc' +
      '&limit=1');
    
    if (!rows || rows.length === 0) {
      return { status: 'NONE', request: null };
    }
    
    return { 
      status: rows[0].status || 'PENDING', 
      request: rows[0] 
    };
    
  } catch(err) {
    console.warn('[EditPermission] Failed to check:', err.message);
    return { status: 'ERROR', request: null, error: err.message };
  }
}

window.checkEditPermission = checkEditPermission;

// ═══════════════════════════════════════════════════════════
// REQUEST EDIT PERMISSION — Creates edit_requests row
// ═══════════════════════════════════════════════════════════
async function requestEditPermission(docNo, docType) {
  if (!docNo) {
    erpShowToast('No document selected', 'warning');
    return false;
  }
  
  var currentUser = localStorage.getItem('ivm_username') || '';
  var currentFullname = localStorage.getItem('ivm_userFullname') || currentUser;
  
  if (!currentUser) {
    erpShowToast('Please log in again', 'danger');
    return false;
  }
  
  var reason = prompt(
    'Request Edit Permission\n\n' +
    'Document: ' + docNo + '\n' +
    'Type: ' + (docType || 'MRIF') + '\n\n' +
    'Why do you need to edit this document?',
    ''
  );
  
  if (reason === null) return false;
  
  reason = String(reason).trim();
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    return false;
  }
  
  if (!confirm('Submit edit request?\n\nReason: ' + reason)) {
    return false;
  }
  
  try {
    // Check existing PENDING request
    var existing = await erpFetch('edit_requests',
      'select=id,status' +
      '&doc_no=eq.' + encodeURIComponent(docNo) +
      '&requested_by=eq.' + encodeURIComponent(currentUser) +
      '&status=eq.PENDING' +
      '&limit=1');
    
    if (existing && existing.length > 0) {
      erpShowToast('You already have a PENDING edit request for this document', 'warning');
      return false;
    }
    
    var res = await fetch(erpUrl('edit_requests'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: String(docType || 'MRIF').toUpperCase(),
        requested_by: currentUser,
        requested_by_fullname: currentFullname,
        reason: reason,
        status: 'PENDING',
        created_at: new Date().toISOString()
      })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' ' + errText);
    }
    
    var result = await res.json();
    console.log('[EditPermission] ✅ Created:', result);
    
    erpShowToast('✅ Edit request submitted. Warehouse will review shortly.', 'success');
    
    setTimeout(function() {
      if (typeof loadMyRequests === 'function') {
        loadMyRequests();
      } else if (typeof myRequestsLoad === 'function') {
        myRequestsLoad();
      } else {
        window.location.reload();
      }
    }, 1000);
    
    return true;
    
  } catch(err) {
    console.error('[EditPermission] Failed:', err);
    erpShowToast('Failed to submit: ' + err.message, 'danger');
    return false;
  }
}

window.requestEditPermission = requestEditPermission;

// ═══════════════════════════════════════════════════════════
// RENDER EDIT BUTTON — Returns HTML based on state
// ═══════════════════════════════════════════════════════════
function renderEditButton(docNo, docType, docStatus, editPerm) {
  var statusUpper = String(docStatus || '').toUpperCase();
  var safeDoc = String(docNo).replace(/'/g, "\\'");
  var safeType = String(docType || 'MRIF').replace(/'/g, "\\'");
  
  // Document-level lock
  if (statusUpper === 'COMPLETED') {
    return '<span class="btn btn-sm btn-outline-success disabled" title="Document is fully processed">' +
      '<i class="bi bi-lock-fill me-1"></i>Locked (Completed)' +
    '</span>';
  }
  
  if (statusUpper === 'PARTIAL') {
    return '<span class="btn btn-sm btn-outline-secondary disabled" title="Partially-issued documents cannot be edited">' +
      '<i class="bi bi-lock-fill me-1"></i>Locked (Partial)' +
    '</span>';
  }
  
  var editStatus = (editPerm && editPerm.status) ? String(editPerm.status).toUpperCase() : 'NONE';
  
  if (editStatus === 'PENDING') {
    return '<span class="btn btn-sm btn-outline-warning disabled" title="Waiting for warehouse approval">' +
      '<i class="bi bi-hourglass-split me-1"></i>Edit Pending Approval' +
    '</span>';
  }
  
  if (editStatus === 'APPROVED') {
    return '<button class="btn btn-sm btn-success fw-bold" onclick="openProductionEdit(\'' + safeDoc + '\', \'' + safeType + '\')">' +
      '<i class="bi bi-pencil-square me-1"></i>Edit Now' +
    '</button>';
  }
  
  if (editStatus === 'REJECTED') {
    var rejectReason = editPerm.request && editPerm.request.reject_reason 
      ? String(editPerm.request.reject_reason).replace(/"/g, '&quot;') 
      : '';
    var titleAttr = rejectReason ? ' title="Rejected: ' + rejectReason + '"' : '';
    return '<button class="btn btn-sm btn-outline-danger" ' +
      'onclick="requestEditPermission(\'' + safeDoc + '\', \'' + safeType + '\')"' + titleAttr + '>' +
      '<i class="bi bi-x-circle me-1"></i>Rejected — Request Again' +
    '</button>';
  }
  
  return '<button class="btn btn-sm btn-outline-warning" ' +
    'onclick="requestEditPermission(\'' + safeDoc + '\', \'' + safeType + '\')">' +
    '<i class="bi bi-pencil me-1"></i>Request Edit' +
  '</button>';
}

window.renderEditButton = renderEditButton;

// ═══════════════════════════════════════════════════════════
// OPEN PRODUCTION EDIT — Full modal
// ═══════════════════════════════════════════════════════════
async function openProductionEdit(docNo, docType) {
  if (!docNo) {
    erpShowToast('No document selected', 'warning');
    return;
  }
  
  console.log('[Production Edit] Opening:', docNo, docType);
  
  _prodEditState.docNo = docNo;
  _prodEditState.docType = String(docType || 'MRIF').toUpperCase();
  _prodEditState.isSaving = false;
  
  // Show loading
  var modalEl = _ensureProdEditModal();
  _showProdEditModal(modalEl);
  _setProdModalLoading(true);
  
  try {
    // ═══ Fetch document ═══
    var docRes = await erpFetch('documents',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    
    if (!docRes || docRes.length === 0) {
      throw new Error('Document not found');
    }
    
    var doc = docRes[0];
    
    // ═══ Check status ═══
    var status = String(doc.status || '').toUpperCase();
    if (status !== 'PENDING' && status !== 'PARTIAL') {
      _setProdModalLoading(false);
      _closeProdEditModal();
      erpShowToast('Cannot edit: document is ' + status, 'warning');
      return;
    }
    
    // ═══ Verify edit permission ═══
    var currentUser = localStorage.getItem('ivm_username') || '';
    var permRes = await erpFetch('edit_requests',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) +
      '&requested_by=eq.' + encodeURIComponent(currentUser) +
      '&status=eq.APPROVED' +
      '&order=created_at.desc&limit=1');
    
    if (!permRes || permRes.length === 0) {
      _setProdModalLoading(false);
      _closeProdEditModal();
      erpShowToast('No approved edit permission for this document', 'warning');
      return;
    }
    
    _prodEditState.editReqId = permRes[0].id;
    
    // ═══ Fetch items ═══
    var itemsRes = await erpFetch('doc_items',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');
    
    _prodEditState.originalDoc = doc;
    _prodEditState.originalItems = (itemsRes || []).map(function(it) {
      return {
        id: it.id,
        itemCode: it.item_code,
        description: it.description || '',
        qty: Number(it.requested_qty || 0),
        unit: it.unit || 'PIECE',
        remarks: it.remarks || '',
        lineNo: it.line_no || 0
      };
    });
    
    _prodEditState.currentItems = JSON.parse(JSON.stringify(_prodEditState.originalItems));
    
    // ═══ Render form ═══
    _renderProdEditForm(doc);
    _setProdModalLoading(false);
    
    // ═══ Preload inventory for search ═══
    _loadProdEditInventory();
    
  } catch(err) {
    console.error('[Production Edit] Error:', err);
    _setProdModalLoading(false);
    _closeProdEditModal();
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

window.openProductionEdit = openProductionEdit;

// ═══════════════════════════════════════════════════════════
// MODAL MANAGEMENT
// ═══════════════════════════════════════════════════════════
function _ensureProdEditModal() {
  var existing = document.getElementById('productionEditModal');
  if (existing) return existing;
  
  var html = ''
    + '<div class="modal fade" id="productionEditModal" tabindex="-1" data-bs-backdrop="static">'
    +   '<div class="modal-dialog modal-xl modal-dialog-scrollable" style="max-width:1100px;">'
    +     '<div class="modal-content">'
    +       '<div class="modal-header" style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#fff;">'
    +         '<h5 class="modal-title">'
    +           '<i class="bi bi-pencil-square me-2"></i>'
    +           '<span id="prodEditTitle">Edit Document</span>'
    +           '<span class="badge bg-light text-dark ms-2">Production Edit</span>'
    +         '</h5>'
    +         '<button type="button" class="btn-close btn-close-white" onclick="_closeProdEditModal()"></button>'
    +       '</div>'
    +       '<div class="modal-body" id="prodEditBody">'
    +         '<div class="text-center py-5">'
    +           '<div class="erp-spinner" style="margin:0 auto;"></div>'
    +           '<div class="mt-2 text-muted">Loading document...</div>'
    +         '</div>'
    +       '</div>'
    +       '<div class="modal-footer">'
    +         '<button type="button" class="btn btn-outline-secondary" onclick="_closeProdEditModal()">Cancel</button>'
    +         '<button type="button" class="btn btn-success" id="prodEditSaveBtn" onclick="_saveProductionEdit()">'
    +           '<i class="bi bi-check-circle me-1"></i>Save Changes'
    +         '</button>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  
  var wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper.firstChild);
  
  return document.getElementById('productionEditModal');
}

function _showProdEditModal(modalEl) {
  if (!_prodEditState.modal) {
    _prodEditState.modal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
  }
  _prodEditState.modal.show();
}

function _closeProdEditModal() {
  if (_prodEditState.modal) {
    _prodEditState.modal.hide();
  }
}

window._closeProdEditModal = _closeProdEditModal;

function _setProdModalLoading(loading) {
  var btn = document.getElementById('prodEditSaveBtn');
  if (btn) btn.disabled = loading;
}

// ═══════════════════════════════════════════════════════════
// RENDER FORM
// ═══════════════════════════════════════════════════════════
function _renderProdEditForm(doc) {
  var body = document.getElementById('prodEditBody');
  if (!body) return;
  
  var titleEl = document.getElementById('prodEditTitle');
  if (titleEl) titleEl.textContent = 'Edit: ' + doc.doc_no;
  
  var html = '';
  
  // ═══ Info alert ═══
  html += '<div class="alert alert-info small py-2 mb-3">'
       +    '<i class="bi bi-info-circle me-1"></i>'
       +    'You can edit <strong>items only</strong>. Document header fields are locked to preserve original request data.'
       +  '</div>';
  
  // ═══ Locked Fields ═══
  html += '<div class="erp-form-section" style="background:#fef3c7;border-color:#fcd34d;">';
  html +=   '<div class="erp-form-section-title" style="color:#92400e;">';
  html +=     '<i class="bi bi-lock-fill me-1"></i>Locked Fields (Read-Only)';
  html +=   '</div>';
  html +=   '<div class="row g-3">';
  
  html +=     '<div class="col-md-4">'
       +        '<label class="form-label small fw-bold">Requestor</label>'
       +        '<input type="text" class="form-control" value="' + _escProd(doc.requestor || '') + '" readonly style="background:#fff;cursor:not-allowed;">'
       +      '</div>';
  
  html +=     '<div class="col-md-4">'
       +        '<label class="form-label small fw-bold">Department</label>'
       +        '<input type="text" class="form-control" value="' + _escProd(doc.department || '') + '" readonly style="background:#fff;cursor:not-allowed;">'
       +      '</div>';
  
  html +=     '<div class="col-md-4">'
       +        '<label class="form-label small fw-bold">Doc No.</label>'
       +        '<input type="text" class="form-control" value="' + _escProd(doc.doc_no || '') + '" readonly style="background:#fff;cursor:not-allowed;font-family:monospace;">'
       +      '</div>';
  
  if (doc.jo_no) {
    html +=   '<div class="col-md-4">'
         +      '<label class="form-label small fw-bold">JO No.</label>'
         +      '<input type="text" class="form-control" value="' + _escProd(doc.jo_no) + '" readonly style="background:#fff;cursor:not-allowed;">'
         +    '</div>';
  }
  if (doc.gem_so_no) {
    html +=   '<div class="col-md-4">'
         +      '<label class="form-label small fw-bold">GEM SO No.</label>'
         +      '<input type="text" class="form-control" value="' + _escProd(doc.gem_so_no) + '" readonly style="background:#fff;cursor:not-allowed;">'
         +    '</div>';
  }
  
  html +=   '</div>';
  html += '</div>';
  
  // ═══ Items ═══
  html += '<div class="erp-form-section">';
  html +=   '<div class="erp-form-section-title d-flex justify-content-between align-items-center">'
       +      '<span><i class="bi bi-list-check me-1"></i>Items (<span id="prodEditItemCount">' + _prodEditState.currentItems.length + '</span>)</span>'
       +      '<button type="button" class="btn btn-sm btn-outline-primary" onclick="_prodAddItem()">'
       +        '<i class="bi bi-plus-lg me-1"></i>Add Item'
       +      '</button>'
       +    '</div>';
  
  html +=   '<div class="table-responsive" style="max-height:400px;overflow-y:auto;">';
  html +=     '<table class="table table-sm table-bordered align-middle" id="prodEditItemsTable" style="font-size:0.85rem;">';
  html +=       '<thead class="table-light sticky-top"><tr>'
       +          '<th style="width:4%">#</th>'
       +          '<th style="width:15%">Item Code</th>'
       +          '<th style="width:30%">Description</th>'
       +          '<th style="width:10%">Qty</th>'
       +          '<th style="width:10%">Unit</th>'
       +          '<th style="width:23%">Remarks</th>'
       +          '<th style="width:8%"></th>'
       +        '</tr></thead>';
  html +=       '<tbody id="prodEditItemsBody"></tbody>';
  html +=     '</table>';
  html +=   '</div>';
  html += '</div>';
  
  // ═══ Reason ═══
  html += '<div class="erp-form-section" style="background:#fffbeb;border-color:#fde68a;">';
  html +=   '<div class="erp-form-section-title" style="color:#92400e;">'
       +      '<i class="bi bi-chat-left-text me-1"></i>Reason for Change <span class="text-danger">*</span>'
       +    '</div>';
  html +=   '<input type="text" class="form-control" id="prodEditReason" '
       +      'placeholder="e.g., Corrected quantities per physical count" maxlength="200">';
  html +=   '<div class="form-text"><i class="bi bi-info-circle me-1"></i>Required for audit trail.</div>';
  html += '</div>';
  
  body.innerHTML = html;
  
  // Render items
  _renderProdEditItems();
}

// ═══════════════════════════════════════════════════════════
// RENDER ITEMS — With auto-suggest dropdown
// ═══════════════════════════════════════════════════════════
function _renderProdEditItems() {
  var tbody = document.getElementById('prodEditItemsBody');
  if (!tbody) return;
  
  var items = _prodEditState.currentItems;
  
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">'
                    + 'No items. Click "Add Item" to add.'
                    + '</td></tr>';
    return;
  }
  
  var html = '';
  items.forEach(function(it, idx) {
    html += '<tr>'
         +    '<td class="text-center">' + (idx + 1) + '</td>'
         +    '<td style="position:relative;">'
         +      '<input type="text" class="form-control form-control-sm prod-edit-item-search" '
         +        'id="prodEditCode' + idx + '" '
         +        'data-idx="' + idx + '" '
         +        'value="' + _escProd(it.itemCode) + '" '
         +        'placeholder="Type to search..." '
         +        'autocomplete="off" '
         +        'oninput="_prodFilterItems(this, ' + idx + ')" '
         +        'onfocus="_prodFilterItems(this, ' + idx + ')">'
         +      '<div class="list-group prod-edit-item-dropdown d-none" id="prodEditDropdown' + idx + '" '
         +        'style="position:fixed;z-index:99999;max-height:260px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.18);"></div>'
         +    '</td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'id="prodEditDesc' + idx + '" '
         +      'value="' + _escProd(it.description) + '" '
         +      'onchange="_prodUpdateItem(' + idx + ', \'description\', this.value)"></td>'
         +    '<td><input type="number" class="form-control form-control-sm text-center" '
         +      'value="' + it.qty + '" min="0" step="0.01" '
         +      'onchange="_prodUpdateItem(' + idx + ', \'qty\', parseFloat(this.value)||0)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm text-center" '
         +      'id="prodEditUnit' + idx + '" '
         +      'value="' + _escProd(it.unit) + '" '
         +      'onchange="_prodUpdateItem(' + idx + ', \'unit\', this.value)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'value="' + _escProd(it.remarks) + '" maxlength="200" '
         +      'onchange="_prodUpdateItem(' + idx + ', \'remarks\', this.value)"></td>'
         +    '<td class="text-center">'
         +      '<button type="button" class="btn btn-sm btn-outline-danger" onclick="_prodRemoveItem(' + idx + ')" title="Remove">'
         +        '<i class="bi bi-trash"></i>'
         +      '</button>'
         +    '</td>'
         +  '</tr>';
  });
  
  tbody.innerHTML = html;
  
  var countEl = document.getElementById('prodEditItemCount');
  if (countEl) countEl.textContent = items.length;
}

function _prodUpdateItem(idx, field, value) {
  if (!_prodEditState.currentItems[idx]) return;
  _prodEditState.currentItems[idx][field] = value;
}

window._prodUpdateItem = _prodUpdateItem;

function _prodAddItem() {
  _prodEditState.currentItems.push({
    id: null,
    itemCode: '',
    description: '',
    qty: 1,
    unit: 'PIECE',
    remarks: '',
    lineNo: 0
  });
  _renderProdEditItems();
  
  // Focus new input
  setTimeout(function() {
    var inputs = document.querySelectorAll('.prod-edit-item-search');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
}

window._prodAddItem = _prodAddItem;

function _prodRemoveItem(idx) {
  if (!confirm('Remove this item?')) return;
  _prodEditState.currentItems.splice(idx, 1);
  _renderProdEditItems();
}

window._prodRemoveItem = _prodRemoveItem;

// ═══════════════════════════════════════════════════════════
// ITEM SEARCH — Auto-suggest dropdown
// ═══════════════════════════════════════════════════════════
function _prodFilterItems(input, idx) {
  var dropdown = document.getElementById('prodEditDropdown' + idx);
  if (!dropdown) return;
  
  var term = String(input.value || '').toLowerCase().trim();
  
  if (!term) {
    dropdown.classList.add('d-none');
    return;
  }
  
  if (!_prodEditState.inventoryCache) {
    dropdown.innerHTML = '<div class="list-group-item text-muted small" style="padding:8px 12px;">'
                       + '<i class="bi bi-hourglass-split me-1"></i>Loading inventory...'
                       + '</div>';
    _prodPositionDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    
    _loadProdEditInventory().then(function() {
      _prodFilterItems(input, idx);
    });
    return;
  }
  
  var matches = _prodEditState.inventoryCache.filter(function(it) {
    var code = String(it.code || '').toLowerCase();
    var desc = String(it.description || '').toLowerCase();
    return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
  }).slice(0, 20);
  
  dropdown.innerHTML = '';
  
  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted small" style="padding:8px 12px;">'
                       + 'No matches'
                       + '</div>';
  } else {
    matches.forEach(function(it) {
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.88rem;border-bottom:1px solid #f0f0f0;background:#fff;';
      el.innerHTML = '<div class="fw-bold" style="color:#1e3a5f;">' + _escProd(it.code) + '</div>'
                   + '<div class="text-muted small">' + _escProd(it.description) + ' '
                   +   '<span class="badge bg-light text-dark">' + _escProd(it.unit || 'PIECE') + '</span>'
                   + '</div>';
      
      el.onmousedown = function(e) {
        e.preventDefault();
        _prodSelectItem(idx, it.code, it.description, it.unit);
        dropdown.classList.add('d-none');
      };
      dropdown.appendChild(el);
    });
  }
  
  _prodPositionDropdown(dropdown, input);
  dropdown.classList.remove('d-none');
}

window._prodFilterItems = _prodFilterItems;

function _prodSelectItem(idx, code, description, unit) {
  if (_prodEditState.currentItems[idx]) {
    _prodEditState.currentItems[idx].itemCode = code;
    _prodEditState.currentItems[idx].description = description || '';
    _prodEditState.currentItems[idx].unit = unit || 'PIECE';
  }
  
  var codeInput = document.getElementById('prodEditCode' + idx);
  if (codeInput) codeInput.value = code;
  
  var descInput = document.getElementById('prodEditDesc' + idx);
  if (descInput) descInput.value = description || '';
  
  var unitInput = document.getElementById('prodEditUnit' + idx);
  if (unitInput) unitInput.value = unit || 'PIECE';
  
  setTimeout(function() {
    var row = codeInput ? codeInput.closest('tr') : null;
    if (row) {
      var qtyInput = row.querySelector('input[type="number"]');
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }
  }, 100);
}

window._prodSelectItem = _prodSelectItem;

function _prodPositionDropdown(dropdown, input) {
  var rect = input.getBoundingClientRect();
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;
  var dropdownMinHeight = 200;
  
  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = Math.max(rect.width, 320) + 'px';
  dropdown.style.zIndex = '99999';
  
  if (spaceBelow < dropdownMinHeight && spaceAbove > spaceBelow) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
    dropdown.style.maxHeight = Math.min(spaceAbove - 20, 260) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.maxHeight = Math.min(spaceBelow - 20, 260) + 'px';
  }
}

async function _loadProdEditInventory() {
  if (_prodEditState.inventoryCache) return _prodEditState.inventoryCache;
  
  try {
    // Use shared helper if available
    if (typeof erpGetInventoryListForDropdown === 'function') {
      var list = await erpGetInventoryListForDropdown();
      _prodEditState.inventoryCache = list;
      console.log('[Production Edit] Inventory loaded (shared):', list.length);
      return list;
    }
    
    // Fallback
    console.log('[Production Edit] Loading inventory (fallback)...');
    var allItems = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;
    var pageNum = 0;
    
    while (hasMore && pageNum < 20) {
      pageNum++;
      
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
      
      if (rows.length < pageSize) break;
    }
    
    _prodEditState.inventoryCache = allItems.map(function(r) {
      return {
        code: r.item_code,
        description: r.description || '',
        unit: r.base_unit || 'PIECE'
      };
    });
    
    console.log('[Production Edit] Inventory loaded (fallback):', _prodEditState.inventoryCache.length);
    return _prodEditState.inventoryCache;
    
  } catch(err) {
    console.warn('[Production Edit] Load inventory failed:', err);
    _prodEditState.inventoryCache = [];
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// SAVE — Robust with error handling + line_no reassignment
// ═══════════════════════════════════════════════════════════
async function _saveProductionEdit() {
  if (_prodEditState.isSaving) return;
  
  var reason = (document.getElementById('prodEditReason').value || '').trim();
  
  if (!reason) {
    erpShowToast('Reason for change is required', 'warning');
    document.getElementById('prodEditReason').focus();
    return;
  }
  
  // ═══ Validate items ═══
  var validItems = [];
  for (var i = 0; i < _prodEditState.currentItems.length; i++) {
    var it = _prodEditState.currentItems[i];
    if (!it.itemCode || !it.itemCode.trim()) {
      erpShowToast('Item #' + (i + 1) + ' has no item code', 'warning');
      return;
    }
    if (it.qty <= 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid qty (must be > 0)', 'warning');
      return;
    }
    validItems.push(it);
  }
  
  if (validItems.length === 0) {
    erpShowToast('Add at least one item', 'warning');
    return;
  }
  
  if (!confirm('Save changes to ' + _prodEditState.docNo + '?\n\n' + validItems.length + ' item(s) will be saved.')) {
    return;
  }
  
  _prodEditState.isSaving = true;
  var btn = document.getElementById('prodEditSaveBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
  
  var currentUser = localStorage.getItem('ivm_userFullname') ||
                    localStorage.getItem('ivm_username') || 'PRODUCTION';
  
  try {
    console.log('[Production Edit] Starting save...');
    console.log('[Production Edit] Original:', _prodEditState.originalItems.length, 'items');
    console.log('[Production Edit] Current:', validItems.length, 'items');
    
    // ═══ Identify operations ═══
    var originalIds = _prodEditState.originalItems.map(function(it) { return it.id; }).filter(Boolean);
    var currentIds = validItems.map(function(it) { return it.id; }).filter(Boolean);
    var removedIds = originalIds.filter(function(id) { return currentIds.indexOf(id) === -1; });
    var newItemsCount = validItems.filter(function(it) { return !it.id; }).length;
    
    console.log('[Production Edit] Remove:', removedIds.length, '| Update:', currentIds.length, '| Insert:', newItemsCount);
    
    // ═══ STEP 1: Delete removed items ═══
    if (removedIds.length > 0) {
      console.log('[Production Edit] Deleting IDs:', removedIds);
      
      var delRes = await fetch(erpUrl('doc_items?id=in.(' + removedIds.join(',') + ')'), {
        method: 'DELETE',
        headers: erpHeaders()
      });
      
      if (!delRes.ok) {
        var delErr = await delRes.text();
        console.error('[Production Edit] Delete failed:', delRes.status, delErr);
        throw new Error('Failed to delete removed items: ' + delRes.status);
      }
      
      console.log('[Production Edit] ✅ Deleted ' + removedIds.length + ' items');
    }
    
    // ═══ STEP 2: Update existing + Insert new ═══
    var successCount = 0;
    var failedCount = 0;
    var errors = [];
    
    for (var j = 0; j < validItems.length; j++) {
      var item = validItems[j];
      var lineNo = j + 1;
      
      try {
        if (item.id) {
          // ═══ UPDATE ═══
          console.log('[Production Edit] Updating #' + lineNo + ':', item.itemCode);
          
          var updRes = await fetch(erpUrl('doc_items?id=eq.' + item.id), {
            method: 'PATCH',
            headers: erpHeaders({ 'Prefer': 'return=representation' }),
            body: JSON.stringify({
              item_code: item.itemCode,
              description: item.description || '',
              requested_qty: item.qty,
              unit: item.unit || 'PIECE',
              remarks: item.remarks || '',
              line_no: lineNo
            })
          });
          
          if (!updRes.ok) {
            var updErr = await updRes.text();
            console.error('[Production Edit] Update failed:', updRes.status, updErr);
            failedCount++;
            errors.push('Update ' + item.itemCode + ': HTTP ' + updRes.status);
            continue;
          }
          
          successCount++;
          console.log('[Production Edit] ✅ Updated:', item.itemCode);
          
        } else {
          // ═══ INSERT ═══
          console.log('[Production Edit] Inserting #' + lineNo + ':', item.itemCode);
          
          var payload = {
            doc_no: _prodEditState.docNo,
            line_no: lineNo,
            item_code: item.itemCode,
            description: item.description || '',
            requested_qty: item.qty,
            issued_qty: 0,
            unit: item.unit || 'PIECE',
            remarks: item.remarks || 'PENDING',
            row_index: lineNo
          };
          
          console.log('[Production Edit] Payload:', payload);
          
          var insRes = await fetch(erpUrl('doc_items'), {
            method: 'POST',
            headers: erpHeaders({ 'Prefer': 'return=representation' }),
            body: JSON.stringify(payload)
          });
          
          if (!insRes.ok) {
            var insErr = await insRes.text();
            console.error('[Production Edit] Insert failed:', insRes.status, insErr);
            failedCount++;
            errors.push('Insert ' + item.itemCode + ': HTTP ' + insRes.status + ' ' + insErr.substring(0, 100));
            continue;
          }
          
          var insData = await insRes.json();
          console.log('[Production Edit] ✅ Inserted:', insData);
          successCount++;
        }
      } catch(itemErr) {
        console.error('[Production Edit] Item error:', itemErr);
        failedCount++;
        errors.push(item.itemCode + ': ' + itemErr.message);
      }
    }
    
    console.log('[Production Edit] Results: ' + successCount + ' saved, ' + failedCount + ' failed');
    
    if (failedCount > 0) {
      var errorMsg = failedCount + ' item(s) failed:\n\n' + errors.slice(0, 3).join('\n');
      if (errors.length > 3) errorMsg += '\n... and ' + (errors.length - 3) + ' more';
      throw new Error(errorMsg);
    }
    
    // ═══ STEP 3: Update doc item_count ═══
    try {
      await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_prodEditState.docNo)), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          item_count: validItems.length,
          updated_at: new Date().toISOString()
        })
      });
      console.log('[Production Edit] ✅ Document item_count updated to ' + validItems.length);
    } catch(e) {
      console.warn('[Production Edit] Could not update item_count:', e);
    }
    
    // ═══ STEP 4: Audit log ═══
    try {
      await fetch(erpUrl('erp_manual_edits_audit'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify([{
          item_code: _prodEditState.docNo,
          field_name: 'items',
          old_value: _prodEditState.originalItems.length + ' items',
          new_value: validItems.length + ' items',
          reason: reason,
          edited_by: currentUser,
          source: 'PRODUCTION_EDIT'
        }])
      });
      console.log('[Production Edit] ✅ Audit logged');
    } catch(e) {
      console.warn('[Production Edit] Audit failed:', e);
    }
    
    // ═══ STEP 5: Mark edit request COMPLETED ═══
    if (_prodEditState.editReqId) {
      try {
        await fetch(erpUrl('edit_requests?id=eq.' + _prodEditState.editReqId), {
          method: 'PATCH',
          headers: erpHeaders(),
          body: JSON.stringify({
            status: 'COMPLETED',
            completed_at: new Date().toISOString()
          })
        });
        console.log('[Production Edit] ✅ Edit request marked COMPLETED');
      } catch(e) {
        console.warn('[Production Edit] Could not mark completed:', e);
      }
    }
    
    // ═══ STEP 6: Success ═══
    _closeProdEditModal();
    erpShowToast('✅ Document updated! ' + successCount + ' item(s) saved.', 'success');
    
    // Refresh My Requests
    setTimeout(function() {
      if (typeof myRequestsLoad === 'function') {
        myRequestsLoad();
      } else if (typeof loadMyRequests === 'function') {
        loadMyRequests();
      } else {
        window.location.reload();
      }
    }, 1000);
    
  } catch(err) {
    console.error('[Production Edit] Save failed:', err);
    erpShowToast('Save failed: ' + err.message, 'danger');
  } finally {
    _prodEditState.isSaving = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

window._saveProductionEdit = _saveProductionEdit;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function _escProd(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════
// GLOBAL CLICK — Close dropdowns when clicking outside
// ═══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  if (!e.target.closest('.prod-edit-item-search') && !e.target.closest('.prod-edit-item-dropdown')) {
    document.querySelectorAll('.prod-edit-item-dropdown').forEach(function(el) {
      el.classList.add('d-none');
    });
  }
});

// Reposition dropdowns on scroll
window.addEventListener('scroll', function() {
  document.querySelectorAll('.prod-edit-item-dropdown:not(.d-none)').forEach(function(el) {
    var idx = el.id.replace('prodEditDropdown', '');
    var input = document.getElementById('prodEditCode' + idx);
    if (input) _prodPositionDropdown(el, input);
  });
}, { passive: true });

console.log('✅ edit-request-permission.js v2.0 loaded (with auto-suggest + robust save)');
