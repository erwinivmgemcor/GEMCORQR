// ============================================================
// PENDING DOCUMENTS — Clickable KPI card → Bal.MRIF processor
// ============================================================

var _pendingModal = null;

// ─── Open the list of pending MRIFs ───
window.openPendingMrifList = async function() {
  var modalEl = document.getElementById('pendingMrifModal');
  if (!modalEl) { showToast('Pending modal not found', 'danger'); return; }
  if (!_pendingModal) _pendingModal = new bootstrap.Modal(modalEl);

  var container = document.getElementById('pendingMrifListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3">' +
      '<div class="spinner-border spinner-border-sm text-primary"></div>' +
      '<div class="small text-muted mt-1">Loading pending MRIFs...</div></div>';
  }
  _pendingModal.show();

  try {
    var sheetId = (typeof getCleanSheetId === 'function') ? getCleanSheetId() : '';
    var url = API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' +
              encodeURIComponent(sheetId || '') + '&_t=' + Date.now();
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
        '<div>No pending MRIF documents.</div>' +
        '<div class="small mt-1">All MRIFs are fully served.</div>' +
        '</div>';
      return;
    }

    var html = '<div class="list-group-item bg-light d-flex justify-content-between align-items-center">' +
      '<span class="fw-bold">Document</span>' +
      '<span class="fw-bold">Action</span>' +
      '</div>';

    docs.forEach(function(d) {
      var docNo = d.docNo || d.sheetName || '';
      var isBal = docNo.toUpperCase().indexOf('BAL.') === 0;
      var badge = isBal ? ' <span class="badge bg-info text-dark">BAL</span>' : '';
      var icon = isBal ? 'bi-layers-fill text-info' : 'bi-file-earmark-text text-warning';
      html += '<div class="list-group-item pending-mrif-item d-flex justify-content-between align-items-center"' +
        ' data-docno="' + escapeHtmlPending(docNo) + '">' +
        '<div class="flex-grow-1">' +
          '<i class="bi ' + icon + ' me-2"></i>' +
          '<strong>' + escapeHtmlPending(docNo) + '</strong>' + badge +
        '</div>' +
        '<button class="btn btn-sm btn-dark btn-process-balance">' +
          '<i class="bi bi-arrow-right-circle me-1"></i>Process' +
        '</button>' +
      '</div>';
    });
    container.innerHTML = html;

    // Row click → open the balance processor
    container.querySelectorAll('.pending-mrif-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var docNo = this.getAttribute('data-docno');
        if (!docNo) return;
        if (_pendingModal) _pendingModal.hide();
        setTimeout(function() { openPendingMrifProcessModal(docNo); }, 300);
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

// ─── Open the Bal.MRIF processing modal for a document ───
// Loads ALL items from the source document (not just OPEN rows)
// and lets the user enter "Issued Now" quantities.
// Reuses the existing #processPartialModal UI.
window.openPendingMrifProcessModal = async function(docNo) {
  if (!docNo) return;
  _processPartialDocNo = docNo;

  var modalEl = document.getElementById('processPartialModal');
  if (!modalEl) { showToast('Process modal not found', 'danger'); return; }
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  var titleEl = document.getElementById('processPartialDocTitle');
  if (titleEl) titleEl.textContent = 'Process ' + docNo;

  var body = document.getElementById('processPartialBody');
  if (body) {
    body.innerHTML = '<div class="text-center py-4">' +
      '<div class="spinner-border text-primary"></div>' +
      '<div class="text-muted mt-2">Loading items...</div></div>';
  }
  modal.show();

  try {
    var sheetId = (typeof getCleanSheetId === 'function') ? getCleanSheetId() : '';
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
              '&docType=MRIF&sheetId=' + encodeURIComponent(sheetId || '') +
              '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);
    if (!data.success) throw new Error(data.error || 'Failed to load document');

    var items = data.items || [];

    // Build the process rows — every item with remaining > 0
    _processPartialItems = items.map(function(it) {
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
        originalRowIndex: it.rowIndex || 0
      };
    }).filter(function(it) {
      // Skip items already fully served
      return it.remainingQty > 0;
    });

    if (_processPartialItems.length === 0) {
      if (body) {
        body.innerHTML = '<div class="alert alert-success mb-0">' +
          '<i class="bi bi-check-circle-fill me-2"></i>' +
          'All items in this document are already fully served.</div>';
      }
      return;
    }

    // Render the same UI as openProcessPartialModal
    var html = '<div class="alert alert-info small py-2 mb-3">' +
      '<i class="bi bi-info-circle me-1"></i> ' +
      'Enter the quantity you are <strong>issuing right now</strong> for each item. ' +
      'A <strong>Bal.' + escapeHtmlPending(docNo) + '</strong> sheet will be created for any remaining quantities.' +
      '</div>' +
      '<div class="table-responsive"><table class="table table-sm table-bordered align-middle">' +
      '<thead class="table-light"><tr>' +
        '<th style="width:4%">#</th>' +
        '<th style="width:18%">Item Code</th>' +
        '<th>Description</th>' +
        '<th class="text-center" style="width:7%">Unit</th>' +
        '<th class="text-center" style="width:9%">Remaining</th>' +
        '<th class="text-center" style="width:12%">Issued Now</th>' +
        '<th style="width:18%">Remarks</th>' +
      '</tr></thead><tbody>';

    _processPartialItems.forEach(function(it, idx) {
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
        '<span class="ms-1">Set all items to their full remaining quantity (complete release).</span>' +
      '</div>';

    if (body) body.innerHTML = html;

  } catch (err) {
    console.error('[openPendingMrifProcessModal] Error:', err);
    if (body) {
      body.innerHTML = '<div class="alert alert-danger mb-0">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>' +
        'Failed to load items: ' + escapeHtmlPending(err.message) + '</div>';
    }
  }
};

// ─── Local escape helper (in case history.js not loaded yet) ───
function escapeHtmlPending(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
