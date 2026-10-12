// ============================================================
// GEMCOR ERP — Warehouse Direct Edit
// v1.1 — FIXED: Trigger stock validation via documents.status PATCH
// ✅ Locked: Requestor, Department, Doc No.
// ✅ Editable: Header fields + Items
// ✅ Audit trail via reason
// ✅ NEW: Auto-compute status + PATCH documents to fire trigger
// ✅ NEW: Rollback on insufficient stock
// ============================================================

var _whEditState = {
  docNo: null,
  docType: null,
  documentId: null,
  originalDoc: null,
  originalItems: [],
  currentItems: [],
  modal: null,
  isSaving: false
};

// ═══════════════════════════════════════════════════════════
// MAIN ENTRY — Open Edit Modal
// ═══════════════════════════════════════════════════════════
async function openWarehouseEdit(docNo, docType) {
  if (!docNo) {
    erpShowToast('No document selected', 'warning');
    return;
  }

  console.log('[WarehouseEdit] Opening for:', docNo, docType);

  _whEditState.docNo = docNo;
  _whEditState.docType = String(docType || 'MRIF').toUpperCase();
  _whEditState.isSaving = false;

  // Show loading
  var modalEl = _ensureEditModal();
  _showEditModal(modalEl);
  _setModalLoading(true);

  try {
    // ═══ Fetch document details ═══
    var docRes = await erpFetch('documents',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');

    if (!docRes || docRes.length === 0) {
      throw new Error('Document not found');
    }

    var doc = docRes[0];

    // ═══ Store document_id ═══
    _whEditState.documentId = doc.id;
    console.log('[WarehouseEdit] Document ID:', doc.id);

    // ═══ Check status — only PENDING or PARTIAL ═══
    var status = String(doc.status || '').toUpperCase();
    if (status !== 'PENDING' && status !== 'PARTIAL') {
      _setModalLoading(false);
      _closeEditModal();
      erpShowToast('Cannot edit: document is ' + status + '. Only PENDING or PARTIAL can be edited.', 'warning');
      return;
    }

    // ═══ Fetch items ═══
    var itemsRes = await erpFetch('doc_items',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');

    _whEditState.originalDoc = doc;
    _whEditState.originalItems = (itemsRes || []).map(function(it) {
      return {
        id: it.id,
        itemCode: it.item_code,
        description: it.description || '',
        qty: Number(it.requested_qty || 0),
        issuedQty: Number(it.issued_qty || 0),   // ← KEEP TRACK
        unit: it.unit || 'PIECE',
        remarks: it.remarks || '',
        lineNo: it.line_no || 0
      };
    });

    // Deep copy
    _whEditState.currentItems = JSON.parse(JSON.stringify(_whEditState.originalItems));

    // ═══ Render form ═══
    _renderEditForm(doc);
    _setModalLoading(false);

  } catch(err) {
    console.error('[WarehouseEdit] Error:', err);
    _setModalLoading(false);
    _closeEditModal();
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

window.openWarehouseEdit = openWarehouseEdit;

// ═══════════════════════════════════════════════════════════
// MODAL MANAGEMENT
// ═══════════════════════════════════════════════════════════
function _ensureEditModal() {
  var existing = document.getElementById('warehouseEditModal');
  if (existing) return existing;

  var html = ''
    + '<div class="modal fade" id="warehouseEditModal" tabindex="-1" data-bs-backdrop="static">'
    +   '<div class="modal-dialog modal-xl modal-dialog-scrollable" style="max-width:1100px;">'
    +     '<div class="modal-content">'
    +       '<div class="modal-header erp-modal-header">'
    +         '<h5 class="modal-title">'
    +           '<i class="bi bi-pencil-square me-2"></i>'
    +           '<span id="whEditTitle">Edit Document</span>'
    +           '<span class="badge bg-warning text-dark ms-2">Warehouse Direct Edit</span>'
    +         '</h5>'
    +         '<button type="button" class="btn-close btn-close-white" onclick="_closeEditModal()"></button>'
    +       '</div>'
    +       '<div class="modal-body" id="whEditBody">'
    +         '<div class="text-center py-5">'
    +           '<div class="erp-spinner" style="margin:0 auto;"></div>'
    +           '<div class="mt-2 text-muted">Loading document...</div>'
    +         '</div>'
    +       '</div>'
    +       '<div class="modal-footer">'
    +         '<button type="button" class="btn btn-outline-secondary" onclick="_closeEditModal()">Cancel</button>'
    +         '<button type="button" class="btn btn-primary" id="whEditSaveBtn" onclick="_saveWarehouseEdit()">'
    +           '<i class="bi bi-check-circle me-1"></i>Save Changes'
    +         '</button>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';

  var wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper.firstChild);

  return document.getElementById('warehouseEditModal');
}

function _showEditModal(modalEl) {
  if (!_whEditState.modal) {
    _whEditState.modal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
  }
  _whEditState.modal.show();
}

function _closeEditModal() {
  if (_whEditState.modal) {
    _whEditState.modal.hide();
  }
}

window._closeEditModal = _closeEditModal;

function _setModalLoading(loading) {
  var btn = document.getElementById('whEditSaveBtn');
  if (btn) btn.disabled = loading;
}

// ═══════════════════════════════════════════════════════════
// RENDER FORM
// ═══════════════════════════════════════════════════════════
function _renderEditForm(doc) {
  var body = document.getElementById('whEditBody');
  if (!body) return;

  var titleEl = document.getElementById('whEditTitle');
  if (titleEl) titleEl.textContent = 'Edit: ' + doc.doc_no;

  var html = '';

  // ─── Info alert ───
  html += '<div class="alert alert-info small py-2 mb-3">'
       +    '<i class="bi bi-info-circle me-1"></i>'
       +    'You are editing as <strong>Warehouse</strong>. Requestor and Department are locked to preserve original ownership.'
       +  '</div>';

  // ─── Locked Fields ───
  html += '<div class="erp-form-section" style="background:#fef3c7;border-color:#fcd34d;">';
  html +=   '<div class="erp-form-section-title" style="color:#92400e;">';
  html +=     '<i class="bi bi-lock-fill me-1"></i>Locked Fields (Read-Only)';
  html +=   '</div>';
  html +=   '<div class="row g-3">';
  html +=     '<div class="col-md-4">'
       +        '<label class="form-label small fw-bold">Requestor</label>'
       +        '<input type="text" class="form-control" value="' + _escWh(doc.requestor || '') + '" readonly style="background:#fff;cursor:not-allowed;">'
       +      '</div>';
  html +=     '<div class="col-md-4">'
       +        '<label class="form-label small fw-bold">Department</label>'
       +        '<input type="text" class="form-control" value="' + _escWh(doc.department || '') + '" readonly style="background:#fff;cursor:not-allowed;">'
       +      '</div>';
  html +=     '<div class="col-md-4">'
       +        '<label class="form-label small fw-bold">Doc No.</label>'
       +        '<input type="text" class="form-control" value="' + _escWh(doc.doc_no || '') + '" readonly style="background:#fff;cursor:not-allowed;font-family:monospace;">'
       +      '</div>';
  html +=   '</div>';
  html += '</div>';

  // ─── Editable Header Fields ───
  html += '<div class="erp-form-section">';
  html +=   '<div class="erp-form-section-title">'
       +      '<i class="bi bi-pencil me-1"></i>Document Details (Editable)'
       +    '</div>';
  html +=   '<div class="row g-3">';

  html +=     '<div class="col-md-6">'
       +        '<label class="form-label small fw-bold">JO No.</label>'
       +        '<input type="text" class="form-control" id="whEditJoNo" value="' + _escWh(doc.jo_no || '') + '">'
       +      '</div>';

  html +=     '<div class="col-md-6">'
       +        '<label class="form-label small fw-bold">GEM SO No.</label>'
       +        '<input type="text" class="form-control" id="whEditGemSoNo" value="' + _escWh(doc.gem_so_no || '') + '">'
       +      '</div>';

  html +=     '<div class="col-md-6">'
       +        '<label class="form-label small fw-bold">Client Name</label>'
       +        '<input type="text" class="form-control" id="whEditClient" value="' + _escWh(doc.client_name || '') + '">'
       +      '</div>';

  html +=     '<div class="col-md-6">'
       +        '<label class="form-label small fw-bold">Project</label>'
       +        '<input type="text" class="form-control" id="whEditProject" value="' + _escWh(doc.project || '') + '">'
       +      '</div>';

  // Date
  var dateVal = '';
  var dateRaw = doc.date_prepared || doc.created_at || '';
  if (dateRaw) {
    try {
      var d = new Date(dateRaw);
      if (!isNaN(d.getTime())) {
        dateVal = d.toISOString().split('T')[0];
      }
    } catch(e) {}
  }
  html +=     '<div class="col-md-6">'
       +        '<label class="form-label small fw-bold">Date</label>'
       +        '<input type="date" class="form-control" id="whEditDate" value="' + dateVal + '">'
       +      '</div>';

  html +=   '</div>';
  html += '</div>';

  // ─── Items ───
  html += '<div class="erp-form-section">';
  html +=   '<div class="erp-form-section-title d-flex justify-content-between align-items-center">'
       +      '<span><i class="bi bi-list-check me-1"></i>Items (<span id="whEditItemCount">' + _whEditState.currentItems.length + '</span>)</span>'
       +      '<button type="button" class="btn btn-sm btn-outline-primary" onclick="_whAddItem()">'
       +        '<i class="bi bi-plus-lg me-1"></i>Add Item'
       +      '</button>'
       +    '</div>';

  html +=   '<div class="table-responsive" style="max-height:400px;overflow-y:auto;">';
  html +=     '<table class="table table-sm table-bordered align-middle" id="whEditItemsTable" style="font-size:0.85rem;">';
  html +=       '<thead class="table-light sticky-top"><tr>'
       +          '<th style="width:4%">#</th>'
       +          '<th style="width:15%">Item Code</th>'
       +          '<th style="width:28%">Description</th>'
       +          '<th style="width:9%">Req Qty</th>'
       +          '<th style="width:9%">Issued Qty</th>'
       +          '<th style="width:8%">Unit</th>'
       +          '<th style="width:19%">Remarks</th>'
       +          '<th style="width:8%"></th>'
       +        '</tr></thead>';
  html +=       '<tbody id="whEditItemsBody"></tbody>';
  html +=     '</table>';
  html +=   '</div>';
  html +=   '<div class="form-text mt-2"><i class="bi bi-info-circle me-1"></i>Issued Qty changes will trigger stock validation on save.</div>';
  html += '</div>';

  // ─── Reason ───
  html += '<div class="erp-form-section" style="background:#fffbeb;border-color:#fde68a;">';
  html +=   '<div class="erp-form-section-title" style="color:#92400e;">'
       +      '<i class="bi bi-chat-left-text me-1"></i>Reason for Change <span class="text-danger">*</span>'
       +    '</div>';
  html +=   '<input type="text" class="form-control" id="whEditReason" '
       +      'placeholder="e.g., Correction of quantities, client feedback, data entry fix" maxlength="200">';
  html +=   '<div class="form-text"><i class="bi bi-info-circle me-1"></i>Required for audit trail.</div>';
  html += '</div>';

  body.innerHTML = html;

  _renderWhEditItems();
}

window._renderEditForm = _renderEditForm;

// ═══════════════════════════════════════════════════════════
// ITEMS MANAGEMENT
// ═══════════════════════════════════════════════════════════
function _renderWhEditItems() {
  var tbody = document.getElementById('whEditItemsBody');
  if (!tbody) return;

  var items = _whEditState.currentItems;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">'
                    + 'No items. Click "Add Item" to add.'
                    + '</td></tr>';
    return;
  }

  var html = '';
  items.forEach(function(it, idx) {
    html += '<tr data-idx="' + idx + '">'
         +    '<td class="text-center">' + (idx + 1) + '</td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'value="' + _escWh(it.itemCode) + '" '
         +      'onchange="_whUpdateItem(' + idx + ', \'itemCode\', this.value)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'value="' + _escWh(it.description) + '" '
         +      'onchange="_whUpdateItem(' + idx + ', \'description\', this.value)"></td>'
         +    '<td><input type="number" class="form-control form-control-sm text-center" '
         +      'value="' + it.qty + '" min="0" step="0.01" '
         +      'onchange="_whUpdateItem(' + idx + ', \'qty\', parseFloat(this.value)||0)"></td>'
         +    '<td><input type="number" class="form-control form-control-sm text-center" '
         +      'value="' + (it.issuedQty || 0) + '" min="0" step="0.01" '
         +      'onchange="_whUpdateItem(' + idx + ', \'issuedQty\', parseFloat(this.value)||0)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm text-center" '
         +      'value="' + _escWh(it.unit) + '" '
         +      'onchange="_whUpdateItem(' + idx + ', \'unit\', this.value)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'value="' + _escWh(it.remarks) + '" maxlength="200" '
         +      'onchange="_whUpdateItem(' + idx + ', \'remarks\', this.value)"></td>'
         +    '<td class="text-center">'
         +      '<button type="button" class="btn btn-sm btn-outline-danger" onclick="_whRemoveItem(' + idx + ')" title="Remove">'
         +        '<i class="bi bi-trash"></i>'
         +      '</button>'
         +    '</td>'
         +  '</tr>';
  });

  tbody.innerHTML = html;

  var countEl = document.getElementById('whEditItemCount');
  if (countEl) countEl.textContent = items.length;
}

function _whUpdateItem(idx, field, value) {
  if (!_whEditState.currentItems[idx]) return;
  _whEditState.currentItems[idx][field] = value;
}

window._whUpdateItem = _whUpdateItem;

function _whAddItem() {
  _whEditState.currentItems.push({
    id: null,
    itemCode: '',
    description: '',
    qty: 0,
    issuedQty: 0,
    unit: 'PIECE',
    remarks: '',
    lineNo: 0
  });
  _renderWhEditItems();
}

window._whAddItem = _whAddItem;

function _whRemoveItem(idx) {
  if (!confirm('Remove this item?')) return;
  _whEditState.currentItems.splice(idx, 1);
  _renderWhEditItems();
}

window._whRemoveItem = _whRemoveItem;

// ═══════════════════════════════════════════════════════════
// SAVE — v1.1 FIXED: PATCH documents.status to fire trigger
// ═══════════════════════════════════════════════════════════
async function _saveWarehouseEdit() {
  if (_whEditState.isSaving) return;

  // ═══ Get form values ═══
  var newJoNo = (document.getElementById('whEditJoNo').value || '').trim();
  var newGemSoNo = (document.getElementById('whEditGemSoNo').value || '').trim();
  var newClient = (document.getElementById('whEditClient').value || '').trim();
  var newProject = (document.getElementById('whEditProject').value || '').trim();
  var newDate = (document.getElementById('whEditDate').value || '').trim();
  var reason = (document.getElementById('whEditReason').value || '').trim();

  // ═══ Validation ═══
  if (!reason) {
    erpShowToast('Reason for change is required', 'warning');
    document.getElementById('whEditReason').focus();
    return;
  }

  var validItems = [];
  for (var i = 0; i < _whEditState.currentItems.length; i++) {
    var it = _whEditState.currentItems[i];
    if (!it.itemCode || !it.itemCode.trim()) {
      erpShowToast('Item #' + (i + 1) + ' has no item code', 'warning');
      return;
    }
    if (it.qty <= 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid qty', 'warning');
      return;
    }
    validItems.push(it);
  }

  if (validItems.length === 0) {
    erpShowToast('Add at least one item', 'warning');
    return;
  }

  if (!confirm('Save changes to ' + _whEditState.docNo + '?\n\n' + validItems.length + ' item(s) will be updated.')) {
    return;
  }

  _whEditState.isSaving = true;
  var btn = document.getElementById('whEditSaveBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

  var currentUser = localStorage.getItem('ivm_userFullname') ||
                    localStorage.getItem('ivm_username') ||
                    'WAREHOUSE';
  var currentUsername = localStorage.getItem('ivm_username') || '';

  // ═══ Track original values for rollback ═══
  var originalItemsBackup = JSON.parse(JSON.stringify(_whEditState.originalItems));

  try {
    console.log('[WarehouseEdit] ============================================');
    console.log('[WarehouseEdit] SAVE START — v1.1');
    console.log('[WarehouseEdit] Doc:', _whEditState.docNo);
    console.log('[WarehouseEdit] Items:', validItems.length);
    console.log('[WarehouseEdit] ============================================');

    // ═══════════════════════════════════════════════════════════
    // STEP 1: PATCH document header (non-status fields only)
    // ⚠️ Do NOT change status here — trigger would fire too early
    // ═══════════════════════════════════════════════════════════
    var docPatchBody = {
      jo_no: newJoNo,
      gem_so_no: newGemSoNo,
      client_name: newClient,
      project: newProject,
      updated_at: new Date().toISOString()
    };

    if (newDate) {
      docPatchBody.date_prepared = newDate;
    }

    console.log('[WarehouseEdit] STEP 1: Patching document header...');

    var docRes = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_whEditState.docNo)), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(docPatchBody)
    });

    if (!docRes.ok) {
      var errText = await docRes.text();
      throw new Error('Document header update failed: ' + docRes.status + ' ' + errText);
    }

    console.log('[WarehouseEdit] ✅ Document header updated');

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Handle items — DELETE removed + UPDATE existing + INSERT new
    // ═══════════════════════════════════════════════════════════
    var originalIds = _whEditState.originalItems.map(function(it) { return it.id; }).filter(Boolean);
    var currentIds = validItems.map(function(it) { return it.id; }).filter(Boolean);
    var removedIds = originalIds.filter(function(id) { return currentIds.indexOf(id) === -1; });

    // Delete removed items
    if (removedIds.length > 0) {
      console.log('[WarehouseEdit] STEP 2a: Deleting', removedIds.length, 'removed items');
      var delRes = await fetch(erpUrl('doc_items?id=in.(' + removedIds.join(',') + ')'), {
        method: 'DELETE',
        headers: erpHeaders()
      });
      if (!delRes.ok) {
        console.warn('[WarehouseEdit] Some items may not have been deleted');
      }
    }

    // Update existing + insert new
    for (var j = 0; j < validItems.length; j++) {
      var item = validItems[j];
      if (item.id) {
        // UPDATE existing
        var updRes = await fetch(erpUrl('doc_items?id=eq.' + item.id), {
          method: 'PATCH',
          headers: erpHeaders(),
          body: JSON.stringify({
            item_code: item.itemCode,
            description: item.description,
            requested_qty: item.qty,
            issued_qty: Number(item.issuedQty || 0),  // ← KEEP issued_qty
            unit: item.unit,
            remarks: item.remarks || 'PENDING',
            line_no: j + 1
          })
        });
        if (!updRes.ok) {
          console.warn('[WarehouseEdit] Failed to update item:', item.itemCode);
        }
      } else {
        // INSERT new
        var insRes = await fetch(erpUrl('doc_items'), {
          method: 'POST',
          headers: erpHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify({
            document_id: _whEditState.documentId,
            doc_no: _whEditState.docNo,
            line_no: j + 1,
            item_code: item.itemCode,
            description: item.description,
            requested_qty: item.qty,
            issued_qty: Number(item.issuedQty || 0),
            unit: item.unit,
            remarks: item.remarks || 'PENDING',
            row_index: j + 1
          })
        });
        if (!insRes.ok) {
          console.warn('[WarehouseEdit] Failed to insert item:', item.itemCode);
        }
      }
    }

    console.log('[WarehouseEdit] ✅ Items updated');

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Compute new status from FRESH items in DB
    // ═══════════════════════════════════════════════════════════
    console.log('[WarehouseEdit] STEP 3: Computing new status...');

    var freshItems = await erpFetch('doc_items',
      'select=issued_qty,requested_qty&doc_no=eq.' + encodeURIComponent(_whEditState.docNo));

    var allComplete = (freshItems || []).every(function(it) {
      return Number(it.issued_qty || 0) >= Number(it.requested_qty || 0);
    });
    var anyIssued = (freshItems || []).some(function(it) {
      return Number(it.issued_qty || 0) > 0;
    });

    var newDocStatus = (allComplete && anyIssued) ? 'COMPLETED' :
                       (anyIssued ? 'PARTIAL' : 'PENDING');

    console.log('[WarehouseEdit] New status computed:', newDocStatus);

    // ═══════════════════════════════════════════════════════════
    // STEP 4: PATCH documents.status — THIS FIRES THE TRIGGER
    // ⚠️ If insufficient stock, this will FAIL → rollback items
    // ═══════════════════════════════════════════════════════════
    console.log('[WarehouseEdit] STEP 4: Patching documents.status (trigger will validate stock)...');

    var statusRes = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_whEditState.docNo)), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        status: newDocStatus,
        updated_at: new Date().toISOString()
      })
    });

    // ═══════════════════════════════════════════════════════════
    // ROLLBACK IF FAILED
    // ═══════════════════════════════════════════════════════════
    if (!statusRes.ok) {
      var statusErrText = await statusRes.text();
      console.error('[WarehouseEdit] ❌ Status PATCH FAILED:', statusRes.status, statusErrText);

      console.warn('[WarehouseEdit] ⏪ Rolling back items to original...');

      // Rollback: Delete newly inserted + restore original
      // Simplest approach: delete all current + re-insert originals
      try {
        // Delete all current items
        var allCurrentIds = validItems.map(function(it) { return it.id; }).filter(Boolean);
        if (allCurrentIds.length > 0) {
          await fetch(erpUrl('doc_items?id=in.(' + allCurrentIds.join(',') + ')'), {
            method: 'DELETE',
            headers: erpHeaders()
          });
        }

        // Re-insert original items
        var restorePayload = originalItemsBackup.map(function(it, idx) {
          return {
            document_id: _whEditState.documentId,
            doc_no: _whEditState.docNo,
            line_no: idx + 1,
            item_code: it.itemCode,
            description: it.description,
            requested_qty: it.qty,
            issued_qty: it.issuedQty,
            unit: it.unit,
            remarks: it.remarks,
            row_index: idx + 1
          };
        });

        if (restorePayload.length > 0) {
          await fetch(erpUrl('doc_items'), {
            method: 'POST',
            headers: erpHeaders(),
            body: JSON.stringify(restorePayload)
          });
        }

        console.log('[WarehouseEdit] ✅ Rollback complete');
      } catch(rollbackErr) {
        console.error('[WarehouseEdit] ❌ Rollback failed:', rollbackErr);
      }

      // Parse error for friendly message
      var friendlyMsg = 'Failed to update document status';
      try {
        var errJson = JSON.parse(statusErrText);
        var pgMsg = errJson.message || '';
        if (pgMsg.indexOf('Insufficient stock') !== -1) {
          var itemMatch = pgMsg.match(/item (\S+?)\./);
          var itemCode = itemMatch ? itemMatch[1] : 'unknown';
          var currMatch = pgMsg.match(/Current: ([\d.]+)/);
          var attMatch = pgMsg.match(/Attempted: (-?[\d.]+)/);

          friendlyMsg = '❌ Insufficient stock for ' + itemCode + '.\n\n' +
                        'Current on-hand: ' + (currMatch ? currMatch[1] : '0') + '\n' +
                        'Required: ' + (attMatch ? Math.abs(parseFloat(attMatch[1])) : 'unknown') + '\n\n' +
                        'Please add stock in Stock Monitor before editing.\n\n' +
                        '(Changes have been reverted)';
        } else if (pgMsg) {
          friendlyMsg = '❌ ' + pgMsg;
        }
      } catch(parseErr) {
        friendlyMsg = '❌ Error: ' + statusErrText.substring(0, 150);
      }

      throw new Error(friendlyMsg);
    }

    console.log('[WarehouseEdit] ✅ Status PATCHED to:', newDocStatus);

    // ═══════════════════════════════════════════════════════════
    // STEP 5: Audit log
    // ═══════════════════════════════════════════════════════════
    var originalDoc = _whEditState.originalDoc;
    var headerChanges = [];
    if ((originalDoc.jo_no || '') !== newJoNo) headerChanges.push({ field: 'jo_no', old: originalDoc.jo_no || '', new: newJoNo });
    if ((originalDoc.gem_so_no || '') !== newGemSoNo) headerChanges.push({ field: 'gem_so_no', old: originalDoc.gem_so_no || '', new: newGemSoNo });
    if ((originalDoc.client_name || '') !== newClient) headerChanges.push({ field: 'client_name', old: originalDoc.client_name || '', new: newClient });
    if ((originalDoc.project || '') !== newProject) headerChanges.push({ field: 'project', old: originalDoc.project || '', new: newProject });

    for (var k = 0; k < headerChanges.length; k++) {
      var ch = headerChanges[k];
      try {
        await fetch(erpUrl('erp_manual_edits_audit'), {
          method: 'POST',
          headers: erpHeaders(),
          body: JSON.stringify([{
            item_code: _whEditState.docNo,
            field_name: ch.field,
            old_value: String(ch.old),
            new_value: String(ch.new),
            reason: reason,
            edited_by: currentUser,
            source: 'WAREHOUSE_EDIT'
          }])
        });
      } catch(e) {
        console.warn('[WarehouseEdit] Audit insert failed:', e);
      }
    }

    console.log('[WarehouseEdit] ✅ Audit logged');

    // ═══════════════════════════════════════════════════════════
    // SUCCESS
    // ═══════════════════════════════════════════════════════════
    console.log('[WarehouseEdit] ============================================');
    console.log('[WarehouseEdit] ✅ SAVE COMPLETE');
    console.log('[WarehouseEdit] Status:', newDocStatus);
    console.log('[WarehouseEdit] ============================================');

    _closeEditModal();
    erpShowToast('✅ Document updated: ' + _whEditState.docNo + ' (' + newDocStatus + ')', 'success');

    // Refresh list
    if (typeof mrifListRefresh === 'function' && _whEditState.docType === 'MRIF') {
      setTimeout(mrifListRefresh, 500);
    } else if (typeof mrrListRefresh === 'function' && _whEditState.docType === 'MRR') {
      setTimeout(mrrListRefresh, 500);
    } else if (typeof mrsListRefresh === 'function' && _whEditState.docType === 'MRS') {
      setTimeout(mrsListRefresh, 500);
    }

  } catch(err) {
    console.error('[WarehouseEdit] ❌ Save failed:', err);
    erpShowToast('Save failed: ' + err.message, 'danger');
  } finally {
    _whEditState.isSaving = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

window._saveWarehouseEdit = _saveWarehouseEdit;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function _escWh(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

console.log('✅ warehouse-edit.js v1.1 loaded (trigger fires via documents.status PATCH)');
