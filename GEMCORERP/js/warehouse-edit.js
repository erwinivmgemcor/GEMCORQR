// ============================================================
// GEMCOR ERP — Warehouse Direct Edit
// v1.2 — FIXED: oninput + force sync before save
// ✅ Locked: Requestor, Department, Doc No.
// ✅ Editable: Header fields + Items
// ✅ Audit trail via reason
// ✅ NEW v1.1: Auto-compute status + PATCH documents to fire trigger
// ✅ NEW v1.1: Rollback on insufficient stock
// ✅ NEW v1.2: oninput event (hindi onchange) para hindi mamiss ang input
// ✅ NEW v1.2: Force sync inputs to state before save
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

  var modalEl = _ensureEditModal();
  _showEditModal(modalEl);
  _setModalLoading(true);

  try {
    var docRes = await erpFetch('documents',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');

    if (!docRes || docRes.length === 0) {
      throw new Error('Document not found');
    }

    var doc = docRes[0];
    _whEditState.documentId = doc.id;
    console.log('[WarehouseEdit] Document ID:', doc.id);

    var status = String(doc.status || '').toUpperCase();
    if (status !== 'PENDING' && status !== 'PARTIAL') {
      _setModalLoading(false);
      _closeEditModal();
      erpShowToast('Cannot edit: document is ' + status + '. Only PENDING or PARTIAL can be edited.', 'warning');
      return;
    }

    var itemsRes = await erpFetch('doc_items',
      'select=*&doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');

    _whEditState.originalDoc = doc;
    _whEditState.originalItems = (itemsRes || []).map(function(it) {
      return {
        id: it.id,
        itemCode: it.item_code,
        description: it.description || '',
        qty: Number(it.requested_qty || 0),
        issuedQty: Number(it.issued_qty || 0),
        unit: it.unit || 'PIECE',
        remarks: it.remarks || '',
        lineNo: it.line_no || 0
      };
    });

    _whEditState.currentItems = JSON.parse(JSON.stringify(_whEditState.originalItems));

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

  // ─── Editable Header ───
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
// ITEMS RENDERING — v1.2: oninput na (hindi onchange)
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
         +      'data-field="itemCode" '
         +      'value="' + _escWh(it.itemCode) + '" '
         +      'oninput="_whUpdateItem(' + idx + ', \'itemCode\', this.value)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'data-field="description" '
         +      'value="' + _escWh(it.description) + '" '
         +      'oninput="_whUpdateItem(' + idx + ', \'description\', this.value)"></td>'
         +    '<td><input type="number" class="form-control form-control-sm text-center" '
         +      'data-field="qty" '
         +      'value="' + it.qty + '" min="0" step="0.01" '
         +      'oninput="_whUpdateItem(' + idx + ', \'qty\', parseFloat(this.value)||0)"></td>'
         +    '<td><input type="number" class="form-control form-control-sm text-center" '
         +      'data-field="issuedQty" '
         +      'value="' + (it.issuedQty || 0) + '" min="0" step="0.01" '
         +      'oninput="_whUpdateItem(' + idx + ', \'issuedQty\', parseFloat(this.value)||0)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm text-center" '
         +      'data-field="unit" '
         +      'value="' + _escWh(it.unit) + '" '
         +      'oninput="_whUpdateItem(' + idx + ', \'unit\', this.value)"></td>'
         +    '<td><input type="text" class="form-control form-control-sm" '
         +      'data-field="remarks" '
         +      'value="' + _escWh(it.remarks) + '" maxlength="200" '
         +      'oninput="_whUpdateItem(' + idx + ', \'remarks\', this.value)"></td>'
         +    '<td class="text-center">'
         +      '<button type="button" class="btn btn-sm btn-outline-danger" onclick="_whRemoveItem(' + idx + ')" title="Remove">'
         +        '<i class="bi bi-trash"></i>'
         +      '</button>'
         +    '</td>'
         +  '</tr>';
  });

  tbody.innerHTML = html;
  _whAcInit(tbody);

  var countEl = document.getElementById('whEditItemCount');
  if (countEl) countEl.textContent = items.length;
}

function _whUpdateItem(idx, field, value) {
  if (!_whEditState.currentItems[idx]) return;
  _whEditState.currentItems[idx][field] = value;
  console.log('[WarehouseEdit] Updated item[' + idx + '].' + field + ' =', value);
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
// FORCE SYNC — v1.2: Basahin muli ang lahat ng inputs bago mag-save
// ═══════════════════════════════════════════════════════════
function _whSyncInputsToState() {
  console.log('[WarehouseEdit] Force syncing inputs to state...');

  var rows = document.querySelectorAll('#whEditItemsBody tr');
  rows.forEach(function(row, idx) {
    if (!_whEditState.currentItems[idx]) return;

    var getVal = function(field) {
      var el = row.querySelector('input[data-field="' + field + '"]');
      return el ? el.value : '';
    };

    var getNum = function(field) {
      var el = row.querySelector('input[data-field="' + field + '"]');
      return el ? (parseFloat(el.value) || 0) : 0;
    };

    _whEditState.currentItems[idx].itemCode = getVal('itemCode');
    _whEditState.currentItems[idx].description = getVal('description');
    _whEditState.currentItems[idx].qty = getNum('qty');
    _whEditState.currentItems[idx].issuedQty = getNum('issuedQty');
    _whEditState.currentItems[idx].unit = getVal('unit');
    _whEditState.currentItems[idx].remarks = getVal('remarks');
  });

  console.log('[WarehouseEdit] Synced', rows.length, 'rows');
  console.log('[WarehouseEdit] currentItems after sync:', JSON.stringify(_whEditState.currentItems));
}

window._whSyncInputsToState = _whSyncInputsToState;

// ═══════════════════════════════════════════════════════════
// SAVE — v1.2: Force sync before validation
// ═══════════════════════════════════════════════════════════
async function _saveWarehouseEdit() {
  if (_whEditState.isSaving) return;

  // ═══ v1.2: Force sync inputs to state BAGO mag-validate ═══
  _whSyncInputsToState();

  // ═══ Get form values ═══
  var newJoNo = (document.getElementById('whEditJoNo').value || '').trim();
  var newGemSoNo = (document.getElementById('whEditGemSoNo').value || '').trim();
  var newClient = (document.getElementById('whEditClient').value || '').trim();
  var newProject = (document.getElementById('whEditProject').value || '').trim();
  var newDate = (document.getElementById('whEditDate').value || '').trim();
  var reason = (document.getElementById('whEditReason').value || '').trim();

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

  var originalItemsBackup = JSON.parse(JSON.stringify(_whEditState.originalItems));

  try {
    console.log('[WarehouseEdit] ============================================');
    console.log('[WarehouseEdit] SAVE START — v1.2');
    console.log('[WarehouseEdit] Doc:', _whEditState.docNo);
    console.log('[WarehouseEdit] Items:', validItems.length);
    console.log('[WarehouseEdit] ============================================');

    // STEP 1: PATCH document header
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

    // STEP 2: Handle items
    var originalIds = _whEditState.originalItems.map(function(it) { return it.id; }).filter(Boolean);
    var currentIds = validItems.map(function(it) { return it.id; }).filter(Boolean);
    var removedIds = originalIds.filter(function(id) { return currentIds.indexOf(id) === -1; });

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

    for (var j = 0; j < validItems.length; j++) {
      var item = validItems[j];
      if (item.id) {
        var updRes = await fetch(erpUrl('doc_items?id=eq.' + item.id), {
          method: 'PATCH',
          headers: erpHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify({
            item_code: item.itemCode,
            description: item.description,
            requested_qty: item.qty,
            issued_qty: Number(item.issuedQty || 0),
            unit: item.unit,
            remarks: item.remarks || 'PENDING',
            line_no: j + 1
          })
        });
        if (!updRes.ok) {
          console.warn('[WarehouseEdit] Failed to update item:', item.itemCode);
        } else {
          console.log('[WarehouseEdit] ✅ Updated item:', item.itemCode, 'issued_qty:', item.issuedQty);
        }
      } else {
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

    // STEP 3: Compute new status
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

    // STEP 4: PATCH documents.status
    console.log('[WarehouseEdit] STEP 4: Patching documents.status (trigger will validate stock)...');

    var statusRes = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_whEditState.docNo)), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        status: newDocStatus,
        updated_at: new Date().toISOString()
      })
    });

    if (!statusRes.ok) {
      var statusErrText = await statusRes.text();
      console.error('[WarehouseEdit] ❌ Status PATCH FAILED:', statusRes.status, statusErrText);

      console.warn('[WarehouseEdit] ⏪ Rolling back items to original...');

      try {
        var allCurrentIds = validItems.map(function(it) { return it.id; }).filter(Boolean);
        if (allCurrentIds.length > 0) {
          await fetch(erpUrl('doc_items?id=in.(' + allCurrentIds.join(',') + ')'), {
            method: 'DELETE',
            headers: erpHeaders()
          });
        }

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

    // STEP 5: Audit log
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

    console.log('[WarehouseEdit] ============================================');
    console.log('[WarehouseEdit] ✅ SAVE COMPLETE');
    console.log('[WarehouseEdit] Status:', newDocStatus);
    console.log('[WarehouseEdit] ============================================');

    _closeEditModal();
    erpShowToast('✅ Document updated: ' + _whEditState.docNo + ' (' + newDocStatus + ')', 'success');

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

// ═══════════════════════════════════════════════════════════
// ITEM AUTO-SUGGEST — v1.3
// Habang nagta-type sa Item Code, lalabas ang mga tugmang item.
// Pag pinili: auto-fill ang Item Code, Description at Unit.
// Gumagana sa MRIF, MRR at MRS edit (iisang modal).
// ═══════════════════════════════════════════════════════════
var _whAc = { list: null, loading: null, box: null, input: null, matches: [], active: -1, hideTimer: null };

function _whAcLoad() {
  if (_whAc.list) return Promise.resolve(_whAc.list);
  if (_whAc.loading) return _whAc.loading;
  if (typeof erpGetInventoryListForDropdown !== 'function') return Promise.resolve([]);
  _whAc.loading = erpGetInventoryListForDropdown().then(function(list) {
    _whAc.list = (list || []).map(function(r) {
      r._k = (String(r.code || '') + ' ' + String(r.description || '')).toLowerCase();
      return r;
    });
    _whAc.loading = null;
    return _whAc.list;
  }).catch(function(err) {
    console.warn('[WarehouseEdit] Inventory load failed:', err && err.message);
    _whAc.loading = null;
    return [];
  });
  return _whAc.loading;
}

function _whAcSearch(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q || !_whAc.list) return [];
  var tokens = q.split(/\s+/);
  var out = [];
  for (var i = 0; i < _whAc.list.length; i++) {
    var it = _whAc.list[i];
    var ok = true;
    for (var t = 0; t < tokens.length; t++) {
      if (it._k.indexOf(tokens[t]) === -1) { ok = false; break; }
    }
    if (!ok) continue;
    var code = String(it.code || '').toLowerCase();
    var rank = code === q ? 0 : (code.indexOf(q) === 0 ? 1 : (code.indexOf(q) > -1 ? 2 : 3));
    out.push({ it: it, rank: rank });
  }
  out.sort(function(a, b) { return a.rank - b.rank || String(a.it.code).localeCompare(String(b.it.code)); });
  return out.slice(0, 30).map(function(o) { return o.it; });
}

function _whAcBox() {
  if (_whAc.box && document.body.contains(_whAc.box)) return _whAc.box;
  var b = document.createElement('div');
  b.id = 'whAcBox';
  b.style.cssText = 'position:fixed;display:none;z-index:2147483000;background:#fff;border:1px solid #cbd5e1;' +
    'border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.18);overflow-y:auto;font-size:.82rem;';
  b.addEventListener('mousedown', function(e) {
    e.preventDefault(); // huwag mawala ang focus ng input
    var row = e.target.closest('[data-ac]');
    if (row) _whAcPick(parseInt(row.getAttribute('data-ac'), 10));
  });
  document.body.appendChild(b);
  _whAc.box = b;
  return b;
}

function _whAcPosition() {
  var inp = _whAc.input, b = _whAc.box;
  if (!inp || !b || b.style.display === 'none') return;
  var r = inp.getBoundingClientRect();
  var width = Math.min(Math.max(r.width, 520), window.innerWidth - 20);
  var left = Math.max(10, Math.min(r.left, window.innerWidth - width - 10));
  var below = window.innerHeight - r.bottom, above = r.top;
  b.style.left = left + 'px';
  b.style.width = width + 'px';
  if (below < 240 && above > below) {
    b.style.top = 'auto';
    b.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    b.style.maxHeight = Math.min(above - 16, 300) + 'px';
  } else {
    b.style.bottom = 'auto';
    b.style.top = (r.bottom + 4) + 'px';
    b.style.maxHeight = Math.min(below - 16, 300) + 'px';
  }
}

function _whAcRender() {
  var b = _whAcBox();
  if (!_whAc.matches.length) {
    b.innerHTML = '<div style="padding:10px 12px;color:#64748b;">Walang tugmang item sa inventory</div>';
  } else {
    b.innerHTML = _whAc.matches.map(function(it, i) {
      return '<div data-ac="' + i + '" style="padding:7px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;' +
        (i === _whAc.active ? 'background:#e0ecff;' : '') + '">' +
        '<div><strong>' + _escWh(it.code) + '</strong> <span style="color:#64748b;">· ' + _escWh(it.unit || 'PIECE') + '</span></div>' +
        '<div style="color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _escWh(it.description) + '</div></div>';
    }).join('');
  }
  b.style.display = 'block';
  _whAcPosition();
  var act = b.querySelector('[data-ac="' + _whAc.active + '"]');
  if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
}

function _whAcHide() {
  if (_whAc.box) _whAc.box.style.display = 'none';
  _whAc.matches = [];
  _whAc.active = -1;
}

async function _whAcShow(input) {
  _whAc.input = input;
  await _whAcLoad();
  if (_whAc.input !== input || document.activeElement !== input) return;
  _whAc.matches = _whAcSearch(input.value);
  _whAc.active = _whAc.matches.length ? 0 : -1;
  if (!String(input.value || '').trim()) { _whAcHide(); return; }
  _whAcRender();
}

function _whAcPick(i) {
  var it = _whAc.matches[i], input = _whAc.input;
  if (!it || !input) return;
  var row = input.closest('tr');
  var idx = row ? parseInt(row.getAttribute('data-idx'), 10) : -1;
  var setField = function(field, val) {
    var el = row.querySelector('input[data-field="' + field + '"]');
    if (el) el.value = val;
    if (idx > -1) _whUpdateItem(idx, field, val);
  };
  if (row) {
    setField('itemCode', it.code);
    setField('description', it.description || '');
    setField('unit', it.unit || 'PIECE');
  }
  _whAcHide();
  var qty = row && row.querySelector('input[data-field="qty"]');
  if (qty) { qty.focus(); qty.select(); }
}

function _whAcInit(tbody) {
  if (!tbody || tbody._whAc) return;
  tbody._whAc = true;
  _whAcLoad(); // i-preload para mabilis ang unang suggest

  tbody.addEventListener('input', function(e) {
    if (e.target.getAttribute('data-field') === 'itemCode') _whAcShow(e.target);
  });
  tbody.addEventListener('focusin', function(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-field') === 'itemCode' && t.value.trim()) _whAcShow(t);
  });
  tbody.addEventListener('focusout', function(e) {
    var t = e.target;
    if (!t.getAttribute || t.getAttribute('data-field') !== 'itemCode') return;
    // Kapag eksaktong code ang tinype at blangko ang description, auto-fill pa rin
    var code = t.value.trim().toLowerCase();
    var row = t.closest('tr');
    var idx = row ? parseInt(row.getAttribute('data-idx'), 10) : -1;
    if (code && _whAc.list && row && _whEditState.currentItems[idx]) {
      var hit = _whAc.list.filter(function(r) { return String(r.code).toLowerCase() === code; })[0];
      var descEl = row.querySelector('input[data-field="description"]');
      if (hit && descEl && !descEl.value.trim()) {
        descEl.value = hit.description || '';
        _whUpdateItem(idx, 'description', descEl.value);
        var unitEl = row.querySelector('input[data-field="unit"]');
        if (unitEl) { unitEl.value = hit.unit || 'PIECE'; _whUpdateItem(idx, 'unit', unitEl.value); }
      }
    }
    clearTimeout(_whAc.hideTimer);
    _whAc.hideTimer = setTimeout(_whAcHide, 150);
  });
  tbody.addEventListener('keydown', function(e) {
    var t = e.target;
    if (!t.getAttribute || t.getAttribute('data-field') !== 'itemCode') return;
    var open = _whAc.box && _whAc.box.style.display === 'block' && _whAc.matches.length;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      _whAc.active = (_whAc.active + 1) % _whAc.matches.length; _whAcRender();
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      _whAc.active = (_whAc.active - 1 + _whAc.matches.length) % _whAc.matches.length; _whAcRender();
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      _whAcPick(_whAc.active);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      _whAcHide();
    }
  });
}

window.addEventListener('scroll', _whAcPosition, true);
window.addEventListener('resize', _whAcPosition);

console.log('✅ warehouse-edit.js v1.3 loaded (oninput + force sync + item auto-suggest)');
