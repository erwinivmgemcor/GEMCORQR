// ============================================================
// PENDING DOCUMENTS — MRR + MRIF + MRS
// - PENDING → normal scanner flow
// - PARTIAL MRR → opens Manual MRR form (editable DR)
// - PARTIAL MRIF / MRS → Bal process modal
// - Prep Status coloring: Red=NEW, Green=PREPARED, Yellow=PICKED_UP
// ============================================================

var _pendingModal = null;
var _pendingPrepMap = {};

function _prepClass(status) {
  var s = String(status || 'NEW').toUpperCase();
  if (s === 'PREPARED') return 'prep-prepared';
  if (s === 'PICKED_UP') return 'prep-pickedup';
  return 'prep-new';
}

function _prepLabel(status) {
  var s = String(status || 'NEW').toUpperCase();
  if (s === 'PREPARED') return 'PREPARED';
  if (s === 'PICKED_UP') return 'PICKED UP';
  return 'NOT PREPARED';
}

function _prepIcon(status) {
  var s = String(status || 'NEW').toUpperCase();
  if (s === 'PREPARED') return 'bi-check-circle-fill';
  if (s === 'PICKED_UP') return 'bi-box-arrow-up-right';
  return 'bi-exclamation-circle-fill';
}

// Action button per prep status (warehouse only)
function _prepActionButton(docNo, prepStatus) {
  var s = String(prepStatus || 'NEW').toUpperCase();
  var safeDoc = String(docNo).replace(/'/g, "\\'");
  if (s === 'NEW') {
    return '<button class="btn btn-sm btn-success btn-prep-action" ' +
      'onclick="event.stopPropagation();markPrepStatus(\'' + safeDoc + '\', \'PREPARED\')" ' +
      'title="Mark this MRIF as prepared / ready for pickup">' +
      '<i class="bi bi-check-circle me-1"></i>Mark Prepared' +
    '</button>';
  }
  if (s === 'PREPARED') {
    return '<button class="btn btn-sm btn-warning btn-prep-action" ' +
      'onclick="event.stopPropagation();markPrepStatus(\'' + safeDoc + '\', \'PICKED_UP\')" ' +
      'title="Mark this MRIF as picked up by production">' +
      '<i class="bi bi-box-arrow-up-right me-1"></i>Mark Picked Up' +
    '</button>';
  }
  // PICKED_UP — no further action
  return '<span class="text-muted small"><i class="bi bi-check2-all me-1"></i>Done</span>';
}

window.openPendingMrifList = async function() {
  var modalEl = document.getElementById('pendingMrifModal');
  if (!modalEl) { showToast('Pending modal not found', 'danger'); return; }
  if (!_pendingModal) _pendingModal = new bootstrap.Modal(modalEl);

  var titleEl = modalEl.querySelector('.modal-title');
  if (titleEl) titleEl.innerHTML = '<i class="bi bi-clock-history me-2"></i>Pending &amp; Partial Documents';

  var container = document.getElementById('pendingMrifListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3">' +
      '<div class="spinner-border spinner-border-sm text-primary"></div>' +
      '<div class="small text-muted mt-1">Loading pending documents...</div></div>';
  }
  _pendingModal.show();

  // Fetch documents AND prep statuses in parallel
  try {
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;

    var docsUrl = API_URL + '?action=getAllPendingDocs&_t=' + Date.now();
    var prepUrl = API_URL + '?action=getPrepStatuses&_t=' + Date.now();

    var results = await Promise.all([
      fetchFn(docsUrl, { redirect: 'follow' }, { timeout: 20000, retries: 1 }),
      fetchFn(prepUrl, { redirect: 'follow' }, { timeout: 20000, retries: 1 })
    ]);

    var docsText = await results[0].text();
    var prepText = await results[1].text();

    var docsData = JSON.parse(docsText);
    var prepData = JSON.parse(prepText);

    _pendingPrepMap = (prepData && prepData.success && prepData.statuses) ? prepData.statuses : {};

    var docs = (docsData && docsData.documents) || [];

    if (!container) return;
    if (docs.length === 0) {
      container.innerHTML = '<div class="list-group-item text-muted text-center py-4">' +
        '<i class="bi bi-check-circle fs-3 d-block mb-2 text-success"></i>' +
        '<div>No pending documents.</div>' +
        '<div class="small mt-1">All MRR, MRIF, and MRS are fully processed.</div>' +
        '</div>';
      return;
    }

    var typeOrder = { MRIF: 0, MRR: 1, MRS: 2 };
    docs.sort(function(a, b) {
      var ta = typeOrder[a.docType] || 99;
      var tb = typeOrder[b.docType] || 99;
      if (ta !== tb) return ta - tb;
      return extractDocNumPending(b.docNo) - extractDocNumPending(a.docNo);
    });

    var isWarehouse = (localStorage.getItem('ivm_userRole') === 'warehouse');

    var html = '<div class="list-group-item bg-light d-flex justify-content-between align-items-center">' +
      '<span class="fw-bold">Document</span>' +
      '<span class="fw-bold">' + (isWarehouse ? 'Prep Action' : 'Status') + '</span>' +
      '</div>';

    docs.forEach(function(d) {
      var docNo = d.docNo || '';
      var docType = (d.docType || '').toUpperCase();
      var status = (d.status || '').toUpperCase();
      var isBal = !!d.isBal || docNo.toUpperCase().indexOf('BAL.') === 0;

      var prepEntry = _pendingPrepMap[docNo] || { prepStatus: 'NEW' };
      var prepStatus = prepEntry.prepStatus || 'NEW';
      var prepClass = _prepClass(prepStatus);
      var prepLabel = _prepLabel(prepStatus);
      var prepIcon = _prepIcon(prepStatus);

      var typeBadgeClass = docType === 'MRIF' ? 'bg-warning text-dark' :
                           docType === 'MRR' ? 'bg-success' :
                           docType === 'MRS' ? 'bg-danger' : 'bg-secondary';
      var statusBadgeClass = status === 'PARTIAL' ? 'bg-info text-dark' : 'bg-secondary';

      var badge = '<span class="badge ' + typeBadgeClass + ' me-2">' + escapeHtmlPending(docType) + '</span>';
      var balTag = isBal ? ' <span class="badge bg-info text-dark">BAL</span>' : '';
      var statusTag = ' <span class="badge ' + statusBadgeClass + '">' + escapeHtmlPending(status) + '</span>';
      var prepTag = ' <span class="prep-badge"><i class="bi ' + prepIcon + ' me-1"></i>' + prepLabel + '</span>';

      var requestorInfo = d.requestor
        ? '<div class="small text-muted ms-4"><i class="bi bi-person me-1"></i>' + escapeHtmlPending(d.requestor) + '</div>'
        : '';

      // For warehouse users, show the prep action button
      var rightSide;
      if (isWarehouse) {
        rightSide = _prepActionButton(docNo, prepStatus);
      } else {
        rightSide = '<span class="prep-badge"><i class="bi ' + prepIcon + ' me-1"></i>' + prepLabel + '</span>';
      }

      html += '<div class="list-group-item pending-mrif-item ' + prepClass + '"' +
        ' data-docno="' + escapeHtmlPending(docNo) + '"' +
        ' data-doctype="' + escapeHtmlPending(docType) + '"' +
        ' data-status="' + escapeHtmlPending(status) + '">' +
        '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div class="flex-grow-1" style="min-width:0;">' +
            '<i class="bi bi-file-earmark-text me-2"></i>' +
            badge +
            '<strong>' + escapeHtmlPending(docNo) + '</strong>' + balTag + statusTag + prepTag +
            requestorInfo +
          '</div>' +
          '<div class="flex-shrink-0">' + rightSide + '</div>' +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;

    // Row click → process document (not the buttons)
    container.querySelectorAll('.pending-mrif-item').forEach(function(el) {
      el.addEventListener('click', function(ev) {
        // If click was on the prep action button or its children, ignore
        if (ev.target.closest('.btn-prep-action')) return;
        var docNo = this.getAttribute('data-docno');
        var docType = this.getAttribute('data-doctype');
        var status = (this.getAttribute('data-status') || '').toUpperCase();
        if (!docNo || !docType) return;
        if (_pendingModal) _pendingModal.hide();

        if (status === 'PARTIAL') {
          if (docType === 'MRR' && typeof window.prefillManualMrrFromDoc === 'function') {
            setTimeout(function() { window.prefillManualMrrFromDoc(docNo); }, 300);
          } else {
            setTimeout(function() { openPendingProcessModal(docNo, docType); }, 300);
          }
        } else {
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

// ─── Set prep status from the app ───
window.markPrepStatus = async function(docNo, newStatus) {
  if (!docNo || !newStatus) return;
  var confirmMsg = newStatus === 'PREPARED'
    ? 'Mark ' + docNo + ' as PREPARED?\n\nThis means the items are physically ready and awaiting pickup by production.'
    : 'Mark ' + docNo + ' as PICKED UP?\n\nThis means production has taken the items.';
  if (!confirm(confirmMsg)) return;

  var user = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';
  try {
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'setPrepStatus',
        docNo: docNo,
        prepStatus: newStatus,
        updatedBy: user
      }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }, { timeout: 30000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data.success) {
      showToast('Updated to ' + newStatus.replace('_', ' '), 'success');
      openPendingMrifList(); // refresh
    } else {
      showToast(data.error || 'Failed to update', 'danger');
    }
  } catch(e) {
    showToast('Error: ' + e.message, 'danger');
  }
};

// ─── Normal flow — same as clicking a doc from the dropdown ───
window.openPendingNormalFlow = async function(docNo, docType) {
  if (!docNo || !docType) return;
  var sectionMap = { 'MRIF': 'releasing', 'MRR': 'receiving', 'MRS': 'returns' };
  var section = sectionMap[docType] || 'releasing';

  if (typeof navigateTo === 'function') navigateTo(section);
  else if (typeof selectModule === 'function') await selectModule(docType);

  await new Promise(function(resolve) { setTimeout(resolve, 400); });
  state.currentModule = docType;
  if (typeof updateLabels === 'function') updateLabels();

  var sheetId = getTargetSheetIdPending(docType);
  if (!sheetId) {
    showToast('⚠️ No Sheet ID for ' + docType + '. Attempting to sync...', 'warning');
    if (typeof syncModuleLinks === 'function') {
      await syncModuleLinks();
      sheetId = getTargetSheetIdPending(docType);
      if (!sheetId) { showToast('Still missing Sheet ID.', 'danger'); return; }
    }
  }

  try {
    if (typeof onDocSelect === 'function') {
      await onDocSelect(docNo);
      showToast('Loaded ' + ((typeof cleanDocNo === 'function') ? cleanDocNo(docNo) : docNo), 'success');
    } else showToast('onDocSelect not available', 'danger');
  } catch (err) {
    console.error('[openPendingNormalFlow] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  }
};

// ─── PARTIAL MRIF / MRS flow ───
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
    var label = docType === 'MRS' ? 'Create New MRS' : 'Create Balance MRIF';
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
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 20000, retries: 1 });
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
        requestedQty: requested, issuedQty: issued,
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
        '<i class="bi bi-check-circle-fill me-2"></i>All items already fully processed.</div>';
      return;
    }

    var colHeader = docType === 'MRS' ? 'Returned Now' : 'Issued Now';
    var infoMsg = docType === 'MRIF'
      ? 'A <strong>Bal.' + escapeHtmlPending(docNo) + '</strong> sheet will be created for any remaining quantities.'
      : 'A <strong>new ' + escapeHtmlPending(docType) + ' document</strong> will be created for the quantities you enter.';

    var html = '<div class="alert alert-info small py-2 mb-3">' +
      '<i class="bi bi-info-circle me-1"></i> ' +
      'Enter the quantity you are processing <strong>right now</strong> for each item. ' + infoMsg +
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
        '<td class="text-center"><input type="number" class="form-control form-control-sm text-center process-qty-input" data-idx="' + idx + '" value="0" min="0" max="' + remaining + '" step="1" style="width:90px;margin:0 auto;" oninput="onProcessQtyInput(this)"></td>' +
        '<td><input type="text" class="form-control form-control-sm process-remarks-input" data-idx="' + idx + '" placeholder="Optional" maxlength="200"></td>' +
      '</tr>';
    });

    html += '</tbody></table></div>' +
      '<div class="mt-2 small text-muted">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary me-2" onclick="fillAllRemaining()">' +
          '<i class="bi bi-magic me-1"></i>Fill Full Remaining</button>' +
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
        inventoryId: it.itemCode || '', description: it.description || '',
        qty: remaining, issueNow: issueNow,
        unit: it.unit || 'PCS', remarks: remarks || '',
        originalRowIndex: it.originalRowIndex || 0
      });
    });
    if (!itemsPayload.some(function(it) { return it.issueNow > 0; })) {
      if (!confirm('No quantity entered. Continue anyway?')) return;
    }
    var currentUser = '';
    if (typeof state !== 'undefined') currentUser = state.currentUserFullname || state.currentUser || '';
    if (!currentUser) currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
    if (!currentUser) currentUser = 'WAREHOUSE';

    var idemKey = 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

    try {
      var payload = {
        action: 'processBalance',
        _idemKey: idemKey,
        docType: docType,
        originalDocNo: window._processPartialDocNo,
        items: itemsPayload,
        processedBy: currentUser
      };
      var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
      var res = await fetchFn(API_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }
      }, { timeout: 45000, retries: 1 });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
      if (data && data.success) {
        var processModalEl = document.getElementById('processPartialModal');
        if (processModalEl) {
          var pm = bootstrap.Modal.getInstance(processModalEl);
          if (pm) pm.hide();
        }
        showToast((docType === 'MRIF' ? 'Balance MRIF created: ' : 'New ' + docType + ' created: ') + data.balDocNo + ' (' + (data.status || 'COMPLETED') + ')', 'success');
        if (typeof updatePartialCount === 'function') updatePartialCount();
        if (typeof fetchPendingDocs === 'function') fetchPendingDocs(true);
        if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
      } else showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    } catch(err) { showToast('Error: ' + err.message, 'danger'); }
  }, 'Creating...');
};

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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
