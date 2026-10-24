// ============================================================
// GEMCOR ERP — Process MRS (Warehouse Verification)
// v2.3 — ITEMS FIRST + null-safe DOM updates
// ============================================================

var _process = {
  docNo: '',
  docType: 'MRS',
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
  console.log('[Process MRS] Initializing v2.3 (items first + rollback)...');

  var urlParams = new URLSearchParams(window.location.search);
  _process.docNo = urlParams.get('doc') || '';
  _process.docType = 'MRS';

  if (!_process.docNo) {
    var docNoTitle = document.getElementById('docNoTitle');
    if (docNoTitle) {
      docNoTitle.innerHTML = '<i class="bi bi-exclamation-triangle text-danger me-2"></i>No document specified';
    }
    var metaInfo = document.getElementById('docMetaInfo');
    if (metaInfo) metaInfo.textContent = 'Please select a document from All Requests';
    return;
  }

  processCheckHealth();
  loadDocument();

  var manualInput = document.getElementById('manualItemInput');
  if (manualInput) {
    manualInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        manualItemVerify();
      }
    });
  }

  var qtyModalInput = document.getElementById('qtyModalInput');
  if (qtyModalInput) {
    qtyModalInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmQty();
      }
    });
  }
});

async function processCheckHealth() {
  try {
    var result = await erpHealthCheck();
    var badge = document.getElementById('erpHealthBadge');
    if (!badge) return;
    var text = document.getElementById('erpHealthText');
    var dot = badge.querySelector('.dot');
    if (result.success) {
      if (dot) dot.className = 'dot dot-ok';
      if (text) text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      if (dot) dot.className = 'dot dot-error';
      if (text) text.textContent = 'Offline';
    }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// LOAD DOCUMENT
// ═══════════════════════════════════════════════════════════
async function loadDocument() {
  try {
    var docRes = await erpFetch('documents', 'doc_no=eq.' + encodeURIComponent(_process.docNo) + '&limit=1');
    if (!docRes || docRes.length === 0) {
      erpShowToast('Document not found', 'danger');
      return;
    }
    _process.doc = docRes[0];

    // ═══ Check kung MRS talaga ═══
    if (String(_process.doc.doc_type || '').toUpperCase() !== 'MRS') {
      erpShowToast('This document is not an MRS: ' + _process.doc.doc_type, 'danger');
      return;
    }

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

    // ═══ If existing issued_qty > 0, mark as verified ═══
    _process.items.forEach(function(it) {
      if (it.issuedQty > 0) {
        it.verified = true;
      }
    });

    renderDocInfo();
    renderItems();
    console.log('[Process MRS] Loaded doc:', _process.docNo, 'items:', _process.items.length);

  } catch(err) {
    console.error('[loadDocument]', err);
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

function renderDocInfo() {
  var doc = _process.doc;
  if (!doc) return;

  var docNoTitle = document.getElementById('docNoTitle');
  if (docNoTitle) {
    docNoTitle.innerHTML = '<i class="bi bi-arrow-counterclockwise me-2"></i>' + erpEsc(doc.doc_no);
  }

  var metaParts = [];
  if (doc.requestor) metaParts.push('<i class="bi bi-person me-1"></i>' + erpEsc(doc.requestor));
  if (doc.department) metaParts.push('<i class="bi bi-building me-1"></i>' + erpEsc(doc.department));
  if (doc.jo_no) metaParts.push('<i class="bi bi-hash me-1"></i>JO ' + erpEsc(doc.jo_no));
  if (doc.gem_so_no) metaParts.push('<i class="bi bi-file-text me-1"></i>' + erpEsc(doc.gem_so_no));
  if (doc.client_name) metaParts.push('<i class="bi bi-shop me-1"></i>' + erpEsc(doc.client_name));
  if (doc.project) metaParts.push('<i class="bi bi-geo-alt me-1"></i>' + erpEsc(doc.project));

  var metaInfo = document.getElementById('docMetaInfo');
  if (metaInfo) metaInfo.innerHTML = metaParts.join(' &nbsp;·&nbsp; ');

  var status = String(doc.status || 'PENDING').toUpperCase();
  var statusBadge = document.getElementById('docStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = status;
    statusBadge.className = 'badge';
    if (status === 'COMPLETED') statusBadge.className += ' bg-success';
    else if (status === 'PARTIAL') statusBadge.className += ' bg-info text-dark';
    else if (status === 'PENDING') statusBadge.className += ' bg-warning text-dark';
    else statusBadge.className += ' bg-secondary';
  }

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

    var returnedDisplay = it.verified ? it.issuedQty : '—';
    var returnedClass = it.verified ? 'text-success fw-bold' : 'text-muted';

    var remarksVal = (it.remarks === 'PENDING' || it.remarks === 'SERVED' || it.remarks === 'PARTIAL') ? '' : it.remarks;

    html += '<tr ' + rowClass + ' data-idx="' + idx + '">' +
      '<td><input type="checkbox" class="item-select-cb" data-idx="' + idx + '"' + (it.selected ? ' checked' : '') + ' onchange="toggleItemSelect(' + idx + ', this.checked)"></td>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.itemCode) + '</code></td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + it.requestedQty + '</td>' +
      '<td class="text-center ' + returnedClass + '">' + returnedDisplay + '</td>' +
      '<td class="text-center">' + erpEsc(it.unit) + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm item-remarks" data-idx="' + idx + '" value="' + erpEsc(remarksVal) + '" placeholder="Optional" onchange="updateRemarks(' + idx + ', this.value)">' +
        '<button class="btn btn-sm btn-link p-0 mt-1" onclick="openQtyModal(' + idx + ')">Edit Qty</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  updateProgress();
  var countLabel = document.getElementById('itemsCountLabel');
  if (countLabel) countLabel.textContent = '(' + _process.items.length + ' items)';
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
      var btn = document.getElementById('btnToggleScanner');
      if (btn) {
        btn.innerHTML = '<i class="bi bi-x-circle me-1"></i>Stop Camera';
        btn.className = 'btn btn-sm btn-danger';
      }
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
      var btn = document.getElementById('btnToggleScanner');
      if (btn) {
        btn.innerHTML = '<i class="bi bi-camera-video me-1"></i>Start Camera';
        btn.className = 'btn btn-sm btn-outline-secondary';
      }
    }).catch(function() {});
  }
}

function onScanSuccess(decodedText) {
  var code = extractItemCode(decodedText);
  if (!code) {
    updateScanStatus('Not an item QR', 'danger');
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

  _process.items[matchIdx].scanned = true;
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
  if (!input) return;
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

  var codeEl = document.getElementById('qtyModalItemCode');
  var descEl = document.getElementById('qtyModalItemDesc');
  var expEl = document.getElementById('qtyModalExpected');
  var inpEl = document.getElementById('qtyModalInput');
  var remEl = document.getElementById('qtyModalRemarks');

  if (codeEl) codeEl.textContent = item.itemCode;
  if (descEl) descEl.textContent = item.description || '—';
  if (expEl) expEl.value = item.requestedQty + ' ' + item.unit;
  if (inpEl) inpEl.value = item.verified ? item.issuedQty : item.requestedQty;
  if (remEl) {
    var remarksVal = (item.remarks === 'PENDING' || item.remarks === 'SERVED' || item.remarks === 'PARTIAL') ? '' : item.remarks;
    remEl.value = remarksVal;
  }

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('qtyModal'));
  modal.show();

  setTimeout(function() {
    var input = document.getElementById('qtyModalInput');
    if (input) {
      input.focus();
      input.select();
    }
  }, 300);
}

function confirmQty() {
  if (!_process.currentQtyItem) return;
  var item = _process.currentQtyItem.item;
  var inputEl = document.getElementById('qtyModalInput');
  var remEl = document.getElementById('qtyModalRemarks');
  var qty = inputEl ? (parseFloat(inputEl.value) || 0) : 0;
  var remarks = remEl ? (remEl.value || '').trim() : '';

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

  var modalEl = document.getElementById('qtyModal');
  if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
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
  var countEl = document.getElementById('batchCount');
  var inputEl = document.getElementById('batchQtyInput');
  if (countEl) countEl.textContent = selectedCount;
  if (inputEl) inputEl.value = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('batchModal')).show();
  setTimeout(function() {
    if (inputEl) inputEl.focus();
  }, 300);
}

function confirmBatchVerify() {
  var inputEl = document.getElementById('batchQtyInput');
  var qty = inputEl ? (parseFloat(inputEl.value) || 0) : 0;
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
  var modalEl = document.getElementById('batchModal');
  if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
  renderItems();
  erpShowToast('✓ ' + applied + ' item(s) verified', 'success');
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgress() {
  var total = _process.items.length;
  var verified = _process.items.filter(function(it) { return it.verified; }).length;

  var progressLabel = document.getElementById('progressLabel');
  if (progressLabel) progressLabel.textContent = verified + ' / ' + total + ' verified';

  var btn = document.getElementById('btnSubmitProcess');
  if (!btn) return;

  var s = processGetSummary();
  if (verified === 0) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Verify items first';
  } else if (s.isMatch) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Submit Returns (' + verified + ')';
    btn.className = 'btn btn-success btn-lg';
  } else {
    // Hindi tugma ang actual returned sa requested: i-confirm na final ito
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-square me-1"></i>Confirm & Submit Actual Returned (' + verified + '/' + total + ')';
    btn.className = 'btn btn-warning btn-lg';
  }
}

// Tugma lang kung lahat verified at ang actual returned == requested.
function processGetSummary() {
  var total = _process.items.length;
  var unverified = 0, diff = 0;
  _process.items.forEach(function(it) {
    if (!it.verified) unverified++;
    else if (Number(it.issuedQty) !== Number(it.requestedQty)) diff++;
  });
  return { total: total, unverified: unverified, diff: diff, isMatch: total > 0 && unverified === 0 && diff === 0 };
}

// ═══════════════════════════════════════════════════════════
// SUBMIT — v2.3
// ═══════════════════════════════════════════════════════════
async function submitProcess() {
  if (_process.isSubmitting) return;

  var verifiedItems = _process.items.filter(function(it) { return it.verified; });
  if (verifiedItems.length === 0) {
    erpShowToast('No items verified', 'warning');
    return;
  }

  var sum = processGetSummary();
  var msg = 'Submit ' + verifiedItems.length + ' item(s)?\n\nIdadagdag sa stock ang ACTUAL returned quantities.';
  if (!sum.isMatch) {
    msg = 'CONFIRM ACTUAL RETURNED\n\n' +
      (sum.diff ? '• ' + sum.diff + ' item(s) ay hindi tugma ang actual returned sa requested\n' : '') +
      (sum.unverified ? '• ' + sum.unverified + ' item(s) hindi na-verify (ituturing na 0 returned)\n' : '') +
      '\nFinal na ito: mawawala na ang MRS sa All Requests at hindi na ma-e-edit ang returned qty.\n' +
      'Idadagdag sa stock ang ACTUAL returned lang. Ituloy?';
  }
  if (!confirm(msg)) return;

  _process.isSubmitting = true;
  var btn = document.getElementById('btnSubmitProcess');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || 'WAREHOUSE';
    
    var itemsPayload = verifiedItems.map(function(it) {
      return {
        id: it.id,
        issued_qty: it.issuedQty, // ✅ Actual returned qty na na-verify
        remarks: it.remarks || ''
      };
    });

    var res = await fetch(erpUrl('rpc/erp_process_mrs_verification'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_doc_no: _process.docNo,
        p_items: itemsPayload,
        p_processed_by: currentUser
      })
    });

    if (!res.ok) {
      var errText = await res.text();
      throw new Error('RPC Error: ' + res.status + ' ' + errText);
    }

    var data = await res.json();
    if (!data || !data.success) {
      throw new Error(data.error || 'Failed to process');
    }

    // Ang MRS ay one-shot: kahit hindi tugma ang actual returned, tapos na ito.
    // Siguraduhing COMPLETED + may processed_at para mawala sa All Requests (PENDING/PARTIAL queue).
    var finalStatus = data.status;
    if (String(data.status || '').toUpperCase() !== 'COMPLETED') {
      try {
        var patch = await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(_process.docNo)), {
          method: 'PATCH',
          headers: erpHeaders(),
          body: JSON.stringify({ status: 'COMPLETED', processed_at: new Date().toISOString(), processed_by: currentUser })
        });
        if (patch.ok) finalStatus = 'COMPLETED (actual returned confirmed)';
        else console.warn('[submitProcess] finalize PATCH HTTP ' + patch.status);
      } catch (pe) {
        console.warn('[submitProcess] finalize PATCH failed:', pe.message);
      }
    }

    document.getElementById('successDocNo').textContent = _process.docNo;
    document.getElementById('successStatus').textContent = finalStatus;

    erpShowToast('✅ MRS Processed: ' + finalStatus, 'success');
    
    var modal = new bootstrap.Modal(document.getElementById('successModal'));
    modal.show();

  } catch(err) {
    console.error('[submitProcess] ❌ ERROR:', err);
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

console.log('✅ process-mrs.js v2.3 loaded (null-safe + items first + rollback)');
