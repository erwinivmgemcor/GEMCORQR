// ============================================================
// PENDING DOCUMENTS — MRR + MRIF + MRS
// - PENDING → normal scanner flow (like clicking a doc from the dropdown)
// - PARTIAL → Bal process flow (Bal.MRIF / new MRR / new MRS)
// ============================================================

var _pendingModal = null;

// ─── Open the list of pending docs (all 3 types) ───
window.openPendingMrifList = async function() {
  var modalEl = document.getElementById('pendingMrifModal');
  if (!modalEl) { showToast('Pending modal not found', 'danger'); return; }
  if (!_pendingModal) _pendingModal = new bootstrap.Modal(modalEl);

  var titleEl = modalEl.querySelector('.modal-title');
  if (titleEl) titleEl.innerHTML = '<i class="bi bi-clock-history me-2"></i>Pending & Partial Documents';

  var container = document.getElementById('pendingMrifListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3">' +
      '<div class="spinner-border spinner-border-sm text-primary"></div>' +
      '<div class="small text-muted mt-1">Loading pending documents...</div></div>';
  }
  _pendingModal.show();

  try {
    var url = API_URL + '?action=getAllPendingDocs&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);

    var docs = (data && data.documents) || [];

    if (!container) return;
    if (docs.length === 0) {
      container.innerHTML = '<div class="list-group-item text-muted text-center py-4">' +
        '<i class="bi bi-check-circle fs-3 d-block mb-2 text-success"></i>' +
        '<div>No pending documents.</div>' +
        '<div class="small mt-1">All MRR, MRIF, and MRS are fully processed.</div>' +
        '</div>';
      return;
    }

    // Sort: MRIF → MRR → MRS; within each, newest first
    var typeOrder = { MRIF: 0, MRR: 1, MRS: 2 };
    docs.sort(function(a, b) {
      var ta = typeOrder[a.docType] || 99;
      var tb = typeOrder[b.docType] || 99;
      if (ta !== tb) return ta - tb;
      return extractDocNumPending(b.docNo) - extractDocNumPending(a.docNo);
    });

    var html = '<div class="list-group-item bg-light d-flex justify-content-between align-items-center">' +
      '<span class="fw-bold">Document</span>' +
      '<span class="fw-bold">Action</span>' +
      '</div>';

    docs.forEach(function(d) {
      var docNo = d.docNo || '';
      var docType = (d.docType || '').toUpperCase();
      var status = (d.status || '').toUpperCase();
      var isBal = !!d.isBal || docNo.toUpperCase().indexOf('BAL.') === 0;

      var typeBadgeClass = docType === 'MRIF' ? 'bg-warning text-dark' :
                           docType === 'MRR' ? 'bg-success' :
                           docType === 'MRS' ? 'bg-danger' : 'bg-secondary';

      var statusBadgeClass = status === 'PARTIAL' ? 'bg-info text-dark' : 'bg-warning text-dark';

      var badge = '<span class="badge ' + typeBadgeClass + ' me-2">' + escapeHtmlPending(docType) + '</span>';
      var balTag = isBal ? ' <span class="badge bg-info text-dark">BAL</span>' : '';
      var statusTag = ' <span class="badge ' + statusBadgeClass + '">' + escapeHtmlPending(status) + '</span>';
      var icon = isBal ? 'bi-layers-fill text-info' : 'bi-file-earmark-text text-warning';

      var requestorInfo = d.requestor
        ? '<div class="small text-muted ms-4"><i class="bi bi-person me-1"></i>' + escapeHtmlPending(d.requestor) + '</div>'
        : '';

      // Action button label depends on status
      var actionLabel = status === 'PARTIAL' ? 'Process Balance' : 'Process';
      var actionIcon = status === 'PARTIAL' ? 'bi-arrow-right-circle' : 'bi-play-circle';

      html += '<div class="list-group-item pending-mrif-item"' +
        ' data-docno="' + escapeHtmlPending(docNo) + '"' +
        ' data-doctype="' + escapeHtmlPending(docType) + '"' +
        ' data-status="' + escapeHtmlPending(status) + '">' +
        '<div class="d-flex justify-content-between align-items-center">' +
          '<div class="flex-grow-1">' +
            '<i class="bi ' + icon + ' me-2"></i>' +
            badge +
            '<strong>' + escapeHtmlPending(docNo) + '</strong>' + balTag + statusTag +
            requestorInfo +
          '</div>' +
          '<button class="btn btn-sm btn-dark btn-process-balance">' +
            '<i class="bi ' + actionIcon + ' me-1"></i>' + actionLabel +
          '</button>' +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('.pending-mrif-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var docNo = this.getAttribute('data-docno');
        var docType = this.getAttribute('data-doctype');
        var status = (this.getAttribute('data-status') || '').toUpperCase();
        if (!docNo || !docType) return;
        if (_pendingModal) _pendingModal.hide();

        if (status === 'PARTIAL') {
          // PARTIAL → Bal process flow
          setTimeout(function() { openPendingProcessModal(docNo, docType); }, 300);
        } else {
          // PENDING (or anything else) → normal scanner flow
          setTimeout(function() { openPendingNormalFlow(docNo, docType); }, 300);
        }
      });
    });

  } catch (err) {
    console.error('[openPendingMrifList] Error:', err);
    if (container) {
      container.innerHTML = '<div class="list-group-item text-danger text-center py-3">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed to load: ' + escapeHtmlPending(err.message) +
        '</div>';
    }
  }
};

// ─── Normal flow — same as clicking a doc from the dropdown ───
window.openPendingNormalFlow = async function(docNo, docType) {
  if (!docNo || !docType) return;

  var sectionMap = { 'MRIF': 'releasing', 'MRR': 'receiving', 'MRS': 'returns' };
  var section = sectionMap[docType] || 'releasing';

  // Navigate to the correct module section
  if (typeof navigateTo === 'function') {
    navigateTo(section);
  } else if (typeof selectModule === 'function') {
    await selectModule(docType);
  }

  // Wait for navigation to settle
  await new Promise(function(resolve) { setTimeout(resolve, 400); });

  // Force the module context
  state.currentModule = docType;
  if (typeof updateLabels === 'function') updateLabels();

  // Ensure sheet ID exists
  var sheetId = getTargetSheetIdPending(docType);
  if (!sheetId) {
    showToast('⚠️ No Sheet ID for ' + docType + '. Attempting to sync...', 'warning');
    if (typeof syncModuleLinks === 'function') {
      await syncModuleLinks();
      sheetId = getTargetSheetIdPending(docType);
      if (!sheetId) {
        showToast('Still missing Sheet ID. Please set it manually in Settings.', 'danger');
        return;
      }
    }
  }

  try {
    if (typeof onDocSelect === 'function') {
      await onDocSelect(docNo);
      var displayName = (typeof cleanDocNo === 'function') ? cleanDocNo(docNo) : docNo;
      showToast('Loaded ' + displayName, 'success');
    } else {
      showToast('onDocSelect not available', 'danger');
    }
  } catch (err) {
    console.error('[openPendingNormalFlow] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  }
};

// ─── PARTIAL flow — opens the Bal processing modal ───
window.openPendingProcessModal = async function(docNo, docType) {
  if (!docNo || !docType) return;

  var modalEl = document.getElementById('processPartialModal');
  if (!modalEl) { showToast('Process modal not found', 'danger'); return; }
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  var titleEl = document.getElementById('processPartialDocTitle');
  if (titleEl) titleEl.innerHTML = '<i class="bi bi-arrow-right-circle me-2"></i>' +
    'Process ' + escapeHtmlPending(docNo) + ' (' + escapeHtmlPending(docType) + ')';

  var submitBtn = document.getElementById('btnSubmitProcessBalance');
  if (submitBtn) {
    var label = docType === 'MRR' ? 'Create New MRR' :
                docType === 'MRS' ? 'Create New MRS' : 'Create Balance MRIF';
    submitBtn.innerHTML = '<i class="bi bi-check-circle me-1"></i>' + label;
  }

  var body = document.getElementById('processPartialBody');
  if (body) {
    body.innerHTML = '<div class="text-center py-4">' +
      '<div class="spinner-border text-primary"></div>' +
      '<div class="text-muted mt-2">Loading items...</div></div>';
  }
  modal.show();

  try {
    var sheetId = getTargetSheetIdPending(docType);
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
              '&docType=' + encodeURIComponent(docType) +
              '&sheetId=' + encodeURIComponent(sheetId) +
              '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);
    if (!data.success) throw new Error(data.error || 'Failed to load document');

    var items = data.items || [];
    var processed = items.map(function(it) {
      var requested = Number(it.qty || it.expectedQty || it.requestedQty || 0);
      var issued = Number(it.issuedQty || it.actualQty || it.atlQty || 0);
      var remaining = requested - issued;
      return {
        itemCode: it.inventoryId || it.itemCode || '',
        description: it.description || '',
        requestedQty: requested,
        issuedQty: issued,
        remainingQty: remaining > 0 ? remaining : 0,
        unit: it.unit || 'PCS',
        originalRowIndex: it.rowIndex || 0,
        remarks: it.remarks || ''
      };
    }).filter(function(it) { return it.remainingQty > 0; });

    window._processPartialItems = processed;
    window._processPartialDocNo = docNo;
    window._processDocType = docType;

    if (processed.length === 0) {
      if (body) body.innerHTML = '<div class="alert alert-success mb-0">' +
        '<i class="bi bi-check-circle-fill me-2"></i>' +
        'All items in this document are already fully processed.</div>';
      return;
    }

    var colHeader = docType === 'MRR' ? 'Received Now' :
                    docType === 'MRS' ? 'Returned Now' : 'Issued Now';

    var infoMsg = docType === 'MRIF'
      ? 'A <strong>Bal.' + escapeHtmlPending(docNo) + '</strong> sheet will be created for any remaining quantities.'
      : 'A <strong>new ' + escapeHtmlPending(docType) + ' document</strong> will be created for the quantities you enter.';

    var html = '<div class="alert alert-info small py-2 mb-3">' +
      '<i class="bi bi-info-circle me-1"></i> ' +
      'Enter the quantity you are processing <strong>right now</strong> for each item. ' +
      infoMsg +
      '</div>' +
      '<div class="table-responsive"><table class="table table-sm table-bordered align-middle">' +
      '<thead class="table-light"><tr>' +
        '<th style="width:4%">#</th>' +
        '<th style="width:18%">Item Code</th>' +
        '<th>Description</th>' +
        '<th class="text-center" style="width:7%">Unit</th>' +
        '<th class="text-center" style="width:9%">Remaining</th>' +
        '<th class="text-center" style="width:12%">' + colHeader + '</th>' +
        '<th style="width:18%">Remarks</th>' +
      '</tr></thead><tbody>';

    processed.forEach(function(it, idx) {
      var remaining = Number(it.remainingQty || 0);
      html += '<tr>' +
        '<td class="text-center">' + (idx + 1) + '</td>' +
        '<td><code>' + escapeHtmlPending(it.itemCode) + '</code></td>' +
        '<td>' + escapeHtmlPending(it.description) + '</td>' +
        '<td class="text-center">' + escapeHtmlPending(it.unit) + '</td>' +
        '<td class="text-center fw-bold text-danger process-remaining-cell" data-idx="' + idx + '">' + remaining + '</td>' +
        '<td class="text-center">' +
          '<input type="number" class="form-control form-control-sm text-center process-qty-input" ' +
          'data-idx="' + idx + '" value="0" min="0" max="' + remaining + '" step="1" ' +
          'style="width:90px;margin:0 auto;" oninput="onProcessQtyInput(this)">' +
        '</td>' +
        '<td>' +
          '<input type="text" class="form-control form-control-sm process-remarks-input" ' +
          'data-idx="' + idx + '" placeholder="Optional" maxlength="200">' +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>' +
      '<div class="mt-2 small text-muted">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary me-2" onclick="fillAllRemaining()">' +
          '<i class="bi bi-magic me-1"></i>Fill Full Remaining' +
        '</button>' +
        '<span class="ms-1">Set all items to their full remaining quantity.</span>' +
      '</div>';

    if (body) body.innerHTML = html;

  } catch (err) {
    console.error('[openPendingProcessModal] Error:', err);
    if (body) {
      body.innerHTML = '<div class="alert alert-danger mb-0">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>' +
        'Failed to load items: ' + escapeHtmlPending(err.message) + '</div>';
    }
  }
};

// ─── Submit the Bal process ───
window.submitProcessBalance = function() {
  if (!window._processPartialDocNo || !window._processPartialItems || !window._processPartialItems.length) {
    showToast('No items to process', 'warning');
    return;
  }
  var btn = document.getElementById('btnSubmitProcessBalance');
  return withButtonLoading(btn, async function() {
    var docType = window._processDocType || 'MRIF';
    var itemsPayload = [];
    window._processPartialItems.forEach(function(it, idx) {
      var qtyInput = document.querySelector('.process-qty-input[data-idx="' + idx + '"]');
      var remarksInput = document.querySelector('.process-remarks-input[data-idx="' + idx + '"]');
      var remaining = Number(it.remainingQty || 0);
      var issueNow = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;
      var remarks = remarksInput ? (remarksInput.value || '').trim() : '';
      if (issueNow > remaining) issueNow = remaining;
      itemsPayload.push({
        inventoryId: it.itemCode || '',
        description: it.description || '',
        qty: remaining,
        issueNow: issueNow,
        unit: it.unit || 'PCS',
        remarks: remarks || '',
        originalRowIndex: it.originalRowIndex || 0
      });
    });
    var anyIssued = itemsPayload.some(function(it) { return it.issueNow > 0; });
    if (!anyIssued) {
      if (!confirm('You have not entered any quantity.\n\nContinue anyway? A new document will be created as PENDING.')) return;
    }

    // Get current user
    var currentUser = '';
    if (typeof state !== 'undefined') {
      currentUser = state.currentUserFullname || state.currentUser || '';
    }
    if (!currentUser) {
      currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
    }
    if (!currentUser) currentUser = 'WAREHOUSE';

    try {
      var payload = {
        action: 'processBalance',
        docType: docType,
        originalDocNo: window._processPartialDocNo,
        items: itemsPayload,
        processedBy: currentUser
      };
      var res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow'
      });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
      if (data && data.success) {
        var processModalEl = document.getElementById('processPartialModal');
        if (processModalEl) {
          var pm = bootstrap.Modal.getInstance(processModalEl);
          if (pm) pm.hide();
        }
        var msgPrefix = docType === 'MRIF' ? 'Balance MRIF created: ' : 'New ' + docType + ' created: ';
        showToast(msgPrefix + data.balDocNo + ' (' + (data.status || 'COMPLETED') + ')', 'success');
        if (typeof updatePartialCount === 'function') updatePartialCount();
        if (typeof fetchPendingDocs === 'function') fetchPendingDocs(true);
        if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
      } else {
        showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
      }
    } catch(err) {
      showToast('Error: ' + err.message, 'danger');
    }
  }, 'Creating...');
};

// ─── Helpers ───
function getTargetSheetIdPending(docType) {
  var key = 'sheetId_' + docType;
  var val = localStorage.getItem(key);
  return val ? (typeof extractSheetId === 'function' ? extractSheetId(val) : val) : '';
}

function extractDocNumPending(docNo) {
  if (!docNo) return 0;
  var m = String(docNo).match(/(\d{4,})/);
  return m ? parseInt(m[1], 10) : 0;
}

function escapeHtmlPending(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
