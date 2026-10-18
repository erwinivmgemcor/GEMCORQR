// ============================================================
// GEMCOR ERP — Process MRIF (Warehouse)
// v2.2 — ITEMS FIRST, document last + rollback
// ✅ Fixes: stock validation on document update
// ✅ Rollback if document fails
// ✅ Enhanced error messages
// ============================================================

var _process = {
  docNo: '',
  docType: 'MRIF',
  doc: null,
  items: [],
  scanner: null,
  scannerActive: false,
  currentQtyItem: null,
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Process MRIF] Initializing v2.2 (items first + rollback)...');

  var urlParams = new URLSearchParams(window.location.search);
  _process.docNo = urlParams.get('doc') || '';
  _process.docType = urlParams.get('type') || 'MRIF';

  if (!_process.docNo) {
    document.getElementById('docNoTitle').innerHTML = '<i class="bi bi-exclamation-triangle text-danger me-2"></i>No document specified';
    document.getElementById('docMetaInfo').textContent = 'Please select a document from All Requests';
    return;
  }

  processCheckHealth();
  loadDocument();

  document.getElementById('manualItemInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      manualItemVerify();
    }
  });

  document.getElementById('qtyModalInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmQty();
    }
  });
});

async function processCheckHealth() {
  try {
    var result = await erpHealthCheck();
    var badge = document.getElementById('erpHealthBadge');
    if (!badge) return;
    var text = document.getElementById('erpHealthText');
    var dot = badge.querySelector('.dot');
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// LOAD DOCUMENT + ITEMS
// ═══════════════════════════════════════════════════════════
async function loadDocument() {
  try {
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(_process.docNo) + '&limit=1');
    if (!docRes || docRes.length === 0) {
      erpShowToast('Document not found', 'danger');
      return;
    }
    _process.doc = docRes[0];

    var itemsRes = await erpFetch('doc_items', 'doc_no=eq.' + encodeURIComponent(_process.docNo) + '&order=line_no.asc');

    _process.items = (itemsRes || []).map(function(it) {
      return {
        id: it.id,
        lineNo: it.line_no,
        itemCode: it.item_code,
        description: it.description,
        requestedQty: Number(it.requested_qty || 0),
        issuedQty: Number(it.issued_qty || 0),
        unit: it.unit || 'PIECE',
        remarks: it.remarks || 'PENDING',
        verified: false,
        selected: false,
        scanned: false,
        // ═══ Store original values for rollback ═══
        originalQty: Number(it.issued_qty || 0),
        originalRemarks: it.remarks || 'PENDING'
      };
    });

    _process.items.forEach(function(it) {
      if (it.issuedQty > 0) {
        it.verified = true;
      }
    });

    renderDocInfo();
    renderItems();
    console.log('[Process] Loaded doc:', _process.docNo, 'items:', _process.items.length);

  } catch(err) {
    console.error('[loadDocument]', err);
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

function renderDocInfo() {
  var doc = _process.doc;

  document.getElementById('docNoTitle').innerHTML =
    '<i class="bi bi-file-earmark-text me-2"></i>' + erpEsc(doc.doc_no);

  var metaParts = [];
  if (doc.requestor) metaParts.push('<i class="bi bi-person me-1"></i>' + erpEsc(doc.requestor));
  if (doc.department) metaParts.push('<i class="bi bi-building me-1"></i>' + erpEsc(doc.department));
  if (doc.jo_no) metaParts.push('<i class="bi bi-hash me-1"></i>JO ' + erpEsc(doc.jo_no));
  if (doc.gem_so_no) metaParts.push('<i class="bi bi-file-text me-1"></i>' + erpEsc(doc.gem_so_no));
  if (doc.client_name) metaParts.push('<i class="bi bi-shop me-1"></i>' + erpEsc(doc.client_name));
  if (doc.project) metaParts.push('<i class="bi bi-geo-alt me-1"></i>' + erpEsc(doc.project));

  document.getElementById('docMetaInfo').innerHTML = metaParts.join(' &nbsp;·&nbsp; ');

  var status = String(doc.status || 'PENDING').toUpperCase();
  var statusBadge = document.getElementById('docStatusBadge');
  statusBadge.textContent = status;
  statusBadge.className = 'badge';
  if (status === 'COMPLETED') statusBadge.className += ' bg-success';
  else if (status === 'PARTIAL') statusBadge.className += ' bg-info text-dark';
  else if (status === 'PENDING') statusBadge.className += ' bg-warning text-dark';
  else statusBadge.className += ' bg-secondary';

  document.title = 'Process ' + doc.doc_no + ' — GEMCOR ERP';
}

function renderItems() {
  var tbody = document.getElementById('itemsBody');
  if (!tbody) return;

  if (_process.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No items found</td></tr>';
    return;
  }

  var html = '';
  _process.items.forEach(function(it, idx) {
    var rowClass = '';
    if (it.verified && it.issuedQty > 0) rowClass = 'style="background:#ecfdf5;"';
    else if (it.scanned) rowClass = 'style="background:#fffbeb;"';

    var issuedDisplay = it.verified ? it.issuedQty : '—';
    var issuedClass = it.verified ? 'text-success fw-bold' : 'text-muted';

    html += '<tr ' + rowClass + ' data-idx="' + idx + '">' +
      '<td><input type="checkbox" class="item-select-cb" data-idx="' + idx + '"' + (it.selected ? ' checked' : '') + ' onchange="toggleItemSelect(' + idx + ', this.checked)"></td>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.itemCode) + '</code></td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + it.requestedQty + '</td>' +
      '<td class="text-center ' + issuedClass + '">' + issuedDisplay + '</td>' +
      '<td class="text-center">' + erpEsc(it.unit) + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm item-remarks" data-idx="' + idx + '" value="' + erpEsc(it.remarks === 'PENDING' || it.remarks === 'SERVED' ? '' : it.remarks) + '" placeholder="Optional" onchange="updateRemarks(' + idx + ', this.value)">' +
       <button class="btn btn-sm btn-outline-primary w-100 mt-1 py-1" style="font-size: 0.75rem;" onclick="openQtyModal(' + idx + ')">
  <i class="bi bi-pencil-square me-1"></i> Edit
</button>
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  updateProgress();
  document.getElementById('itemsCountLabel').textContent = '(' + _process.items.length + ' items)';
}

function toggleItemSelect(idx, checked) {
  if (_process.items[idx]) _process.items[idx].selected = checked;
}

function updateRemarks(idx, value) {
  if (_process.items[idx]) _process.items[idx].remarks = value;
}

// ═══════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════
function toggleScanner() {
  if (_process.scannerActive) stopScanner();
  else startScanner();
}

function startScanner() {
  if (_process.scanner) return;
  var reader = document.getElementById('reader');
  if (!reader) return;

  _process.scanner = new Html5Qrcode('reader');
  Html5Qrcode.getCameras().then(function(cameras) {
    if (cameras.length === 0) {
      erpShowToast('No camera found', 'warning');
      return;
    }
    var camId = cameras.find(function(c) {
      return c.label.toLowerCase().indexOf('back') !== -1;
    })?.id || cameras[0].id;

    _process.scanner.start(camId, {
      fps: 10,
      qrbox: { width: 250, height: 250 }
    }, onScanSuccess, function() {}).then(function() {
      _process.scannerActive = true;
      document.getElementById('btnToggleScanner').innerHTML = '<i class="bi bi-x-circle me-1"></i>Stop Camera';
      document.getElementById('btnToggleScanner').className = 'btn btn-sm btn-danger';
    }).catch(function(err) {
      erpShowToast('Camera error: ' + err, 'danger');
    });
  }).catch(function(err) {
    erpShowToast('Camera access denied', 'danger');
  });
}

function stopScanner() {
  if (_process.scanner) {
    _process.scanner.stop().then(function() {
      _process.scanner.clear();
      _process.scanner = null;
      _process.scannerActive = false;
      document.getElementById('btnToggleScanner').innerHTML = '<i class="bi bi-camera-video me-1"></i>Start Camera';
      document.getElementById('btnToggleScanner').className = 'btn btn-sm btn-outline-secondary';
    }).catch(function() {});
  }
}

function onScanSuccess(decodedText) {
  console.log('[Scan]', decodedText);
  var code = extractItemCode(decodedText);
  if (!code) {
    updateScanStatus('Not an item QR: ' + decodedText, 'danger');
    return;
  }
  processScannedItem(code);
}

function extractItemCode(text) {
  if (!text) return '';
  var raw = String(text).trim().replace(/^["'\s]+|["'\s]+$/g, '');
  var urlMatch = raw.match(/[?&](?:code|item|id|inventory)=([^&\s]+)/i);
  if (urlMatch) return decodeURIComponent(urlMatch[1]).trim();
  if (/[?&]doc=/i.test(raw)) return '';
  return raw;
}

function processScannedItem(code) {
  var codeUpper = code.toUpperCase();
  var matchIdx = -1;
  for (var i = 0; i < _process.items.length; i++) {
    if (_process.items[i].itemCode.toUpperCase() === codeUpper) {
      matchIdx = i;
      break;
    }
  }

  if (matchIdx === -1) {
    updateScanStatus('Item not in this request: ' + code, 'danger');
    playErrorBeep();
    return;
  }

  var item = _process.items[matchIdx];
  item.scanned = true;

  updateScanStatus('Scanned: ' + code, 'success');
  playSuccessBeep();
  openQtyModal(matchIdx);
}

function updateScanStatus(msg, type) {
  var el = document.getElementById('scanStatus');
  if (!el) return;
  el.className = 'alert alert-' + type + ' py-2 small mb-0';
  el.innerHTML = '<i class="bi bi-info-circle me-1"></i><span>' + erpEsc(msg) + '</span>';
}

function manualItemVerify() {
  var input = document.getElementById('manualItemInput');
  var code = (input.value || '').trim();
  if (!code) return;
  input.value = '';
  processScannedItem(code);
}

// ═══════════════════════════════════════════════════════════
// QTY MODAL
// ═══════════════════════════════════════════════════════════
function openQtyModal(idx) {
  var item = _process.items[idx];
  if (!item) return;

  _process.currentQtyItem = { idx: idx, item: item };

  document.getElementById('qtyModalItemCode').textContent = item.itemCode;
  document.getElementById('qtyModalItemDesc').textContent = item.description || '—';
  document.getElementById('qtyModalExpected').value = item.requestedQty + ' ' + item.unit;
  document.getElementById('qtyModalInput').value = item.verified ? item.issuedQty : item.requestedQty;
  document.getElementById('qtyModalRemarks').value = item.remarks === 'PENDING' || item.remarks === 'SERVED' ? '' : item.remarks;

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('qtyModal'));
  modal.show();

  setTimeout(function() {
    var input = document.getElementById('qtyModalInput');
    input.focus();
    input.select();
  }, 300);
}

function confirmQty() {
  if (!_process.currentQtyItem) return;
  var item = _process.currentQtyItem.item;
  var idx = _process.currentQtyItem.idx;

  var qty = parseFloat(document.getElementById('qtyModalInput').value) || 0;
  var remarks = (document.getElementById('qtyModalRemarks').value || '').trim();

  if (qty < 0) {
    erpShowToast('Quantity must be ≥ 0', 'warning');
    return;
  }
  if (qty > item.requestedQty) {
    erpShowToast('Qty cannot exceed requested (' + item.requestedQty + ')', 'warning');
    return;
  }

  item.issuedQty = qty;
  item.remarks = remarks;
  item.verified = true;
  item.scanned = false;

  bootstrap.Modal.getInstance(document.getElementById('qtyModal')).hide();
  renderItems();
  erpShowToast('✓ ' + item.itemCode + ' verified', 'success');
}

// ═══════════════════════════════════════════════════════════
// BATCH VERIFY
// ═══════════════════════════════════════════════════════════
function selectAllItems() {
  _process.items.forEach(function(it) { it.selected = true; });
  renderItems();
}

function deselectAllItems() {
  _process.items.forEach(function(it) { it.selected = false; });
  renderItems();
}

function toggleSelectAllCheckbox(checked) {
  _process.items.forEach(function(it) { it.selected = checked; });
  renderItems();
}

function openBatchVerify() {
  var selectedCount = _process.items.filter(function(it) { return it.selected; }).length;
  if (selectedCount === 0) {
    erpShowToast('Select at least one item', 'warning');
    return;
  }
  document.getElementById('batchCount').textContent = selectedCount;
  document.getElementById('batchQtyInput').value = '';
  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('batchModal'));
  modal.show();
  setTimeout(function() {
    var input = document.getElementById('batchQtyInput');
    input.focus();
  }, 300);
}

function confirmBatchVerify() {
  var qty = parseFloat(document.getElementById('batchQtyInput').value) || 0;
  if (qty < 0) {
    erpShowToast('Invalid quantity', 'warning');
    return;
  }

  var applied = 0;
  _process.items.forEach(function(it) {
    if (it.selected) {
      it.issuedQty = Math.min(qty, it.requestedQty);
      it.verified = true;
      it.selected = false;
      applied++;
    }
  });

  bootstrap.Modal.getInstance(document.getElementById('batchModal')).hide();
  renderItems();
  erpShowToast('✓ ' + applied + ' item(s) verified', 'success');
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgress() {
  var total = _process.items.length;
  var verified = _process.items.filter(function(it) { return it.verified; }).length;

  document.getElementById('progressLabel').textContent = verified + ' / ' + total + ' verified';

  var btn = document.getElementById('btnSubmitProcess');
  if (verified === 0) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Verify items first';
  } else if (verified === total) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Submit Complete (' + verified + ')';
    btn.className = 'btn btn-success btn-lg';
  } else {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Submit Partial (' + verified + '/' + total + ')';
    btn.className = 'btn btn-warning btn-lg';
  }
}

// ═══════════════════════════════════════════════════════════
// SUBMIT — v2.2: ITEMS FIRST, document last + rollback
// ═══════════════════════════════════════════════════════════
async function submitProcess() {
  if (_process.isSubmitting) return;

  var verifiedItems = _process.items.filter(function(it) { return it.verified; });
  if (verifiedItems.length === 0) {
    erpShowToast('No items verified', 'warning');
    return;
  }

  if (!confirm('Submit ' + verifiedItems.length + ' item(s)?')) return;

  _process.isSubmitting = true;
  var btn = document.getElementById('btnSubmitProcess');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

  try {
    var allComplete = true;
    var anyIssued = false;
    var preparedItems = [];

    for (var i = 0; i < verifiedItems.length; i++) {
      var item = verifiedItems[i];
      if (item.issuedQty < item.requestedQty) allComplete = false;
      if (item.issuedQty > 0) anyIssued = true;

      var newRemarks = item.remarks || '';
      var status = item.issuedQty >= item.requestedQty ? 'SERVED' : (item.issuedQty > 0 ? 'PARTIAL' : 'PENDING');
      if (newRemarks && newRemarks !== 'PENDING' && newRemarks !== 'SERVED' && newRemarks !== 'PARTIAL') {
        newRemarks = newRemarks + ' | ' + status;
      } else {
        newRemarks = status;
      }

      preparedItems.push({
        id: item.id,
        itemCode: item.itemCode,
        issuedQty: item.issuedQty,
        remarks: newRemarks,
        originalQty: item.originalQty,
        originalRemarks: item.originalRemarks
      });
    }

    var newStatus = (allComplete && anyIssued) ? 'COMPLETED' : (anyIssued ? 'PARTIAL' : 'PENDING');
    var currentUser = localStorage.getItem('ivm_userFullname') || 
                      localStorage.getItem('ivm_username') || 
                      'WAREHOUSE';

    console.log('[submitProcess] STEP 1: Updating items FIRST...');

    var itemsUpdated = 0;
    var itemErrors = [];

    for (var j = 0; j < preparedItems.length; j++) {
      var pi = preparedItems[j];
      
      try {
        var itemRes = await fetch(erpUrl('doc_items?id=eq.' + pi.id), {
          method: 'PATCH',
          headers: erpHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify({
            issued_qty: pi.issuedQty,
            remarks: pi.remarks
          })
        });

        if (!itemRes.ok) {
          var itemErrText = await itemRes.text();
          console.error('[submitProcess] Item update failed:', pi.itemCode, itemErrText);
          itemErrors.push(pi.itemCode);
        } else {
          itemsUpdated++;
          console.log('[submitProcess] ✓ Updated item:', pi.itemCode, 'qty:', pi.issuedQty);
        }
      } catch(e) {
        console.error('[submitProcess] Item error:', pi.itemCode, e);
        itemErrors.push(pi.itemCode);
      }
    }

    if (itemErrors.length > 0) {
      throw new Error('Failed to update items: ' + itemErrors.join(', '));
    }

    console.log('[submitProcess] STEP 2: Updating document (trigger will validate stock)...');

    var docRes = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_process.docNo)), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        status: newStatus,
        processed_by: currentUser,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!docRes.ok) {
      var errText = await docRes.text();
      console.error('[submitProcess] ❌ Document update FAILED:', docRes.status, errText);
      
      console.warn('[submitProcess] ⏪ Rolling back', itemsUpdated, 'item updates...');
      
      for (var k = 0; k < preparedItems.length; k++) {
        var pi2 = preparedItems[k];
        try {
          await fetch(erpUrl('doc_items?id=eq.' + pi2.id), {
            method: 'PATCH',
            headers: erpHeaders(),
            body: JSON.stringify({
              issued_qty: pi2.originalQty,
              remarks: pi2.originalRemarks
            })
          });
        } catch(e) {
          console.warn('[submitProcess] Rollback failed for:', pi2.itemCode);
        }
      }
      
      var userFriendlyMsg = 'Failed to update document status';
      
      try {
        var errJson = JSON.parse(errText);
        var pgMessage = errJson.message || '';
        var pgCode = errJson.code || '';
        
        if (pgMessage.indexOf('Insufficient stock') !== -1) {
          var itemMatch = pgMessage.match(/item (\S+?)\./);
          var itemCode = itemMatch ? itemMatch[1] : 'unknown';
          var currentMatch = pgMessage.match(/Current: ([\d.]+)/);
          var attemptedMatch = pgMessage.match(/Attempted: (-?[\d.]+)/);
          
          userFriendlyMsg = '❌ Insufficient stock for ' + itemCode + '.\n\n' +
                            'Current on-hand: ' + (currentMatch ? currentMatch[1] : '0') + '\n' +
                            'Required: ' + (attemptedMatch ? Math.abs(parseFloat(attemptedMatch[1])) : 'unknown') + '\n\n' +
                            'Please add stock in Stock Monitor before processing.\n\n' +
                            '(Items have been reverted automatically)';
        }
        else if (pgMessage) {
          userFriendlyMsg = '❌ ' + pgMessage;
        }
      } catch(parseErr) {
        userFriendlyMsg = '❌ Error: ' + errText.substring(0, 150);
      }
      
      throw new Error(userFriendlyMsg);
    }

    console.log('[submitProcess] ✅ SUBMIT COMPLETE');
    
    var docSofNo = _process.doc ? _process.doc.sof_no : null;
    if (docSofNo) {
      for (var sIdx = 0; sIdx < verifiedItems.length; sIdx++) {
        var sofItem = verifiedItems[sIdx];
        if (!sofItem.issuedQty || sofItem.issuedQty <= 0) continue;
        
        try {
          await fetch(erpUrl('rpc/erp_sof_update_used_qty'), {
            method: 'POST',
            headers: erpHeaders(),
            body: JSON.stringify({
              p_sof_no: docSofNo,
              p_item_code: sofItem.itemCode,
              p_qty_used: sofItem.issuedQty,
              p_reference_doc: _process.docNo,
              p_reference_type: 'MRIF',
              p_reason: 'Issued from ' + _process.docNo,
              p_performed_by: currentUser,
              p_performed_by_fullname: currentUser
            })
          });
        } catch(sofErr) {
          console.error('[submitProcess] SOF update exception:', sofItem.itemCode, sofErr);
        }
      }
    }

    document.getElementById('successDocNo').textContent = _process.docNo;
    document.getElementById('successStatus').textContent = newStatus;

    var modal = new bootstrap.Modal(document.getElementById('successModal'));
    modal.show();

  } catch(err) {
    console.error('[submitProcess] ❌ SUBMIT FAILED:', err);
    erpShowToast('Submit failed: ' + err.message, 'danger');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  } finally {
    _process.isSubmitting = false;
  }
}
function cancelProcess() {
  if (!confirm('Cancel and return to queue?')) return;
  window.location.href = 'all-requests.html';
}

// ═══════════════════════════════════════════════════════════
// BEEP SOUNDS
// ═══════════════════════════════════════════════════════════
var _audioCtx = null;

function _getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _audioCtx;
}

function playSuccessBeep() {
  try {
    var ctx = _getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function playErrorBeep() {
  try {
    var ctx = _getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4000 }).show();
}

console.log('✅ process-mrif.js v2.2 loaded (ITEMS FIRST + ROLLBACK)');
