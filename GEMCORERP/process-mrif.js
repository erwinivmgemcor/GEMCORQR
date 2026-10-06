// ============================================================
// GEMCOR ERP — Process MRIF (Warehouse)
// Scan + verify + submit with direct Supabase update
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
  console.log('[Process MRIF] Initializing...');

  // Get doc no from URL
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

  // Enter key on manual input
  document.getElementById('manualItemInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      manualItemVerify();
    }
  });

  // Qty modal enter key
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
    // Load doc
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(_process.docNo) + '&limit=1');
    if (!docRes || docRes.length === 0) {
      erpShowToast('Document not found', 'danger');
      return;
    }
    _process.doc = docRes[0];

    // Load items
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
        scanned: false
      };
    });

    // Auto-mark items that already have issued_qty > 0
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
        '<button class="btn btn-sm btn-link p-0 mt-1" onclick="openQtyModal(' + idx + ')">Edit Qty</button>' +
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
  if (_process.scannerActive) {
    stopScanner();
  } else {
    startScanner();
  }
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

  // Extract item code from QR
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

  // Find matching item
  var matchIdx = -1;
  for (var i = 0; i < _process.items.length; i++) {
    var item = _process.items[i];
    if (item.itemCode.toUpperCase() === codeUpper) {
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

  // Open qty modal for this item
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
// SUBMIT
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
    // Update each item in doc_items
    var allComplete = true;
    var anyIssued = false;

    for (var i = 0; i < verifiedItems.length; i++) {
      var item = verifiedItems[i];
      if (item.issuedQty < item.requestedQty) allComplete = false;
      if (item.issuedQty > 0) anyIssued = true;

      // Determine remarks
      var newRemarks = item.remarks || '';
      var status = item.issuedQty >= item.requestedQty ? 'SERVED' : (item.issuedQty > 0 ? 'PARTIAL' : 'PENDING');
      if (newRemarks && newRemarks !== 'PENDING' && newRemarks !== 'SERVED' && newRemarks !== 'PARTIAL') {
        newRemarks = newRemarks + ' | ' + status;
      } else {
        newRemarks = status;
      }

      // PATCH doc_items
      var res = await fetch(erpUrl('doc_items?id=eq.' + item.id), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          issued_qty: item.issuedQty,
          remarks: newRemarks
        })
      });

      if (!res.ok) {
        console.warn('Failed to update item', item.itemCode);
      }
    }

    // Update document status
    var newStatus = (allComplete && anyIssued) ? 'COMPLETED' : (anyIssued ? 'PARTIAL' : 'PENDING');

    var currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';

    var docRes = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_process.docNo)), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: newStatus,
        processed_by: currentUser,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!docRes.ok) {
      throw new Error('Failed to update document status');
    }

    // Success
    document.getElementById('successDocNo').textContent = _process.docNo;
    document.getElementById('successStatus').textContent = newStatus;

    var modal = new bootstrap.Modal(document.getElementById('successModal'));
    modal.show();

  } catch(err) {
    console.error('[submitProcess]', err);
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
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

console.log('✅ process-mrif.js loaded');
