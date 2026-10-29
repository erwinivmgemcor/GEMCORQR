// ============================================================
// GEMCOR ERP — Process MRIF (Warehouse)
// v3.4 — SOF Priority Deduction + Ledger via SECURITY DEFINER RPC
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
  console.log('[Process MRIF] Initializing v3.6...');

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

    // ── lock: stop two staff from processing the same request ──
    var _lockStatus = String(_process.doc.status || '').toUpperCase();
    if ((_lockStatus === 'PENDING' || _lockStatus === 'PARTIAL') && window.erpDocLock) {
      var _gotLock = await erpDocLock.guard(_process.docNo);
      if (!_gotLock) return;
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
    loadStockInfo(); // internal stock glimpse (does not block the page)
    console.log('[Process] Loaded doc:', _process.docNo, 'items:', _process.items.length);

  } catch(err) {
    console.error('[loadDocument]', err);
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

function renderDocInfo() {
  var doc = _process.doc;
  
  var sofBadge = document.getElementById('sofBadgeHeader');
  if (sofBadge) {
    if (doc.sof_no) {
      sofBadge.textContent = 'SOF: ' + doc.sof_no;
      sofBadge.classList.remove('d-none');
    } else {
      sofBadge.classList.add('d-none');
    }
  }

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
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No items found</td></tr>';
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
      stockCellHtml(it) +
      '<td class="text-center">' + it.requestedQty + '</td>' +
      '<td class="text-center ' + issuedClass + '">' + issuedDisplay + '</td>' +
      '<td class="text-center">' + erpEsc(it.unit) + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm item-remarks" data-idx="' + idx + '" value="' + erpEsc(it.remarks === 'PENDING' || it.remarks === 'SERVED' ? '' : it.remarks) + '" placeholder="Optional" onchange="updateRemarks(' + idx + ', this.value)">' +
       '<button class="btn btn-sm btn-outline-primary w-100 mt-1 py-1" style="font-size: 0.75rem;" onclick="openQtyModal(' + idx + ')">' +
          '<i class="bi bi-pencil-square me-1"></i> Edit' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  updateProgress();
  document.getElementById('itemsCountLabel').textContent = '(' + _process.items.length + ' items)';
  renderStockSummary();
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

function batchMode() {
  var el = document.querySelector('input[name="batchMode"]:checked');
  return el ? el.value : 'requested';
}

function onBatchModeChange() {
  var custom = batchMode() === 'custom';
  document.getElementById('batchCustomWrap').classList.toggle('d-none', !custom);
  if (custom) {
    var input = document.getElementById('batchQtyInput');
    input.focus();
  }
}

function openBatchVerify() {
  var selectedCount = _process.items.filter(function(it) { return it.selected; }).length;
  if (selectedCount === 0) {
    erpShowToast('Select at least one item', 'warning');
    return;
  }
  document.getElementById('batchCount').textContent = selectedCount;
  document.getElementById('batchQtyInput').value = '';
  // Default: requested qty ng bawat item (less hassle sa warehouse)
  document.getElementById('batchModeRequested').checked = true;
  onBatchModeChange();

  var modalEl = document.getElementById('batchModal');
  if (!modalEl.dataset.bound) {
    modalEl.dataset.bound = '1';
    document.querySelectorAll('input[name="batchMode"]').forEach(function(r) {
      r.addEventListener('change', onBatchModeChange);
    });
    // Enter = Apply
    modalEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmBatchVerify(); }
    });
  }
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  setTimeout(function() {
    var btn = document.getElementById('btnBatchApply');
    if (btn && batchMode() === 'requested') btn.focus();
  }, 300);
}

function confirmBatchVerify() {
  var mode = batchMode();
  var customQty = 0;

  if (mode === 'custom') {
    var raw = document.getElementById('batchQtyInput').value;
    customQty = parseFloat(raw);
    if (raw === '' || isNaN(customQty) || customQty < 0) {
      erpShowToast('Maglagay ng valid na quantity', 'warning');
      return;
    }
  }

  var applied = 0;
  _process.items.forEach(function(it) {
    if (it.selected) {
      it.issuedQty = (mode === 'requested')
        ? Number(it.requestedQty)
        : Math.min(customQty, Number(it.requestedQty));
      it.verified = true;
      it.selected = false;
      applied++;
    }
  });

  bootstrap.Modal.getInstance(document.getElementById('batchModal')).hide();
  renderItems();
  erpShowToast('✓ ' + applied + ' item(s) verified' + (mode === 'requested' ? ' (requested qty)' : ''), 'success');
}

// ═══════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════
function updateProgress() {
  var total = _process.items.length;
  var verified = _process.items.filter(function(it) { return it.verified; }).length;

  document.getElementById('progressLabel').textContent = verified + ' / ' + total + ' verified';

  var btn = document.getElementById('btnSubmitProcess');
  if (!btn) return;

  var s = processGetSummary();
  if (verified === 0) {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Verify items first';
  } else if (s.isComplete) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Submit Complete (' + verified + ')';
    btn.className = 'btn btn-success btn-lg';
  } else {
    // PARTIAL: may hindi pa na-verify, o mas kaunti ang issued kaysa requested
    var parts = [];
    if (s.unverified > 0) parts.push(s.unverified + ' not verified');
    if (s.short > 0) parts.push(s.short + ' short');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-exclamation-circle me-1"></i>Submit Partial (' + parts.join(', ') + ')';
    btn.className = 'btn btn-warning btn-lg';
  }
}

// Complete lang kung LAHAT verified AT lahat ay buo ang issued (issued >= requested).
function processGetSummary() {
  var total = _process.items.length;
  var unverified = 0, short = 0;
  _process.items.forEach(function(it) {
    if (!it.verified) unverified++;
    else if (Number(it.issuedQty) < Number(it.requestedQty)) short++;
  });
  return {
    total: total,
    unverified: unverified,
    short: short,
    isComplete: total > 0 && unverified === 0 && short === 0
  };
}

// ═══════════════════════════════════════════════════════════
// SUBMIT (SOF Priority Deduction + Ledger RPC)
// ═══════════════════════════════════════════════════════════
async function submitProcess() {
  if (_process.isSubmitting) return;
  // lock: make sure this request is still mine before touching stock
  if (window.erpDocLock && !(await erpDocLock.verify(_process.docNo))) return;

  var verifiedItems = _process.items.filter(function(it) { return it.verified; });
  if (verifiedItems.length === 0) {
    erpShowToast('No items verified', 'warning');
    return;
  }

  // ✅ VALIDATION: Check kung sapat ang stock bago mag-submit
  var sofNo = _process.doc.sof_no || _process.doc.gem_so_no || '';
  
  if (!sofNo) {
    // Kung walang SOF, i-check ang physical on_hand
    // Codes lang ng items na ipo-process ang kukunin (ang dating 'lahat ng items' ay naputol sa 1000 rows)
    var codeList = verifiedItems.map(function(v) { return '"' + String(v.itemCode).replace(/"/g, '') + '"'; });
    var allItems = await erpFetchAll('erp_items',
      'select=item_code,on_hand&item_code=in.(' + encodeURIComponent(codeList.join(',')) + ')&order=item_code.asc');
    var stockMap = {};
    (allItems || []).forEach(function(it) { stockMap[it.item_code] = Number(it.on_hand || 0); });

    // Naka-reserve para sa mga SOF (allocated - used). Hindi ito pwedeng gamitin ng MRIF na walang SOF.
    var reservedMap = {};
    try {
      var allocRows = await erpFetchAll('erp_sof_allocation_items',
        'select=id,item_code,allocated_qty,used_qty&item_code=in.(' + encodeURIComponent(codeList.join(',')) + ')&order=id.asc');
      (allocRows || []).forEach(function(r) {
        var rem = Number(r.allocated_qty || 0) - Number(r.used_qty || 0);
        if (rem > 0) reservedMap[r.item_code] = (reservedMap[r.item_code] || 0) + rem;
      });
    } catch (resErr) {
      console.warn('[submitProcess] Could not load SOF reservations:', resErr.message);
      erpShowToast('Hindi ma-check ang SOF reservations. Subukan ulit.', 'danger');
      return;
    }

    for (var i = 0; i < verifiedItems.length; i++) {
      var item = verifiedItems[i];
      var currentStock = stockMap[item.itemCode] || 0;
      var reserved = reservedMap[item.itemCode] || 0;
      var available = currentStock - reserved;
      var issueQty = Number(item.issuedQty);

      if (currentStock < issueQty) {
        erpShowToast('❌ Insufficient stock for ' + item.itemCode + '. Current: ' + currentStock + ', Attempted: ' + issueQty, 'danger');
        return; // Pigilan ang submission
      }
      if (available < issueQty) {
        erpShowToast('❌ ' + item.itemCode + ': ' + currentStock + ' on-hand pero ' + reserved +
          ' ay naka-reserve sa SOF. Available lang: ' + available + ', hinihingi: ' + issueQty +
          '. Gumamit ng MRIF na may SOF para sa reserved stock.', 'danger');
        return;
      }
    }
  }

  var sum = processGetSummary();
  var confirmMsg = sum.isComplete
    ? 'Submit COMPLETE: ' + verifiedItems.length + ' item(s)?'
    : 'Submit PARTIAL?\n\n' +
      '• Issued items: ' + verifiedItems.length + '\n' +
      (sum.unverified ? '• Hindi pa na-verify: ' + sum.unverified + '\n' : '') +
      (sum.short ? '• Kulang ang issued vs requested: ' + sum.short + '\n' : '') +
      '\nAng natitirang qty ay mapupunta sa Balance document.';
  if (!confirm(confirmMsg)) return;

  _process.isSubmitting = true;
  var btn = document.getElementById('btnSubmitProcess');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || 'WAREHOUSE';
    var sofNo = _process.doc.sof_no || _process.doc.gem_so_no || '';
    
    // 1. I-process muna ang MRIF
    var itemsPayload = verifiedItems.map(function(it) {
      return {
        id: it.id,
        issued_qty: it.issuedQty,
        remarks: it.remarks || ''
      };
    });

    console.log('[submitProcess] Calling RPC erp_process_mrif...');
    
    var res = await fetch(erpUrl('rpc/erp_process_mrif'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_doc_no: _process.docNo,
        p_items: itemsPayload,
        p_processed_by: currentUser,
        p_skip_stock_deduction: false
      })
    });

    if (!res.ok) {
      var errText = await res.text();
      var errMsg = errText;
      try {
        var ej = JSON.parse(errText);
        errMsg = [ej.message, ej.details, ej.hint].filter(Boolean).join(' | ') || errText;
      } catch (pe) {}
      console.error('[erp_process_mrif] HTTP ' + res.status + ' payload:', itemsPayload, 'response:', errText);
      throw new Error(errMsg || ('RPC Error: HTTP ' + res.status));
    }

    var data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.error) || 'Failed to process');
    }

    // ═══════════════════════════════════════════════════════════
    // WALA nang STEP 2 dito. Ang erp_process_mrif na mismo ang:
    //   - nagbabawas ng physical on_hand (ledger -> trigger), at
    //   - nag-a-update ng SOF used_qty.
    // Ang dating "SOF priority deduction" + erp_insert_stock_ledger sa client ay
    // nagdodoble: 10 -> 5 -> 0 sa on_hand at used_qty 5 -> 10 sa isang 5-qty MRIF.
    // ═══════════════════════════════════════════════════════════

    if (window.erpDocLock) erpDocLock.release(_process.docNo);   // done → free the lock

    document.getElementById('successDocNo').textContent = _process.docNo;
    document.getElementById('successStatus').textContent = data.status;

    if (data.bal_doc) {
      var successStatusEl = document.getElementById('successStatus');
      successStatusEl.innerHTML += '<br><br><span class="text-warning fw-bold"><i class="bi bi-info-circle me-1"></i>Note: A Balance document was created: <u>' + data.bal_doc + '</u></span>';
    }

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
  var go = function() { window.location.href = 'all-requests.html'; };
  if (window.erpDocLock) { erpDocLock.release(_process.docNo).then(go, go); setTimeout(go, 1500); } else go();
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

console.log('✅ process-mrif.js v3.6 loaded (single RPC + reserved-stock check)');


// ═══════════════════════════════════════════════════════════
// STOCK GLIMPSE (internal, warehouse only)
// Shows on-hand / reserved / available per line so nobody processes an MRIF
// for material that is already gone. Read-only: it never blocks Verify or Submit.
//   No SOF on the MRIF : available = on-hand − all SOF-reserved
//   MRIF has a SOF     : available = what this SOF still has reserved
//                        + free stock (on-hand − all reserved), capped at on-hand
// ═══════════════════════════════════════════════════════════
_process.stock = {};
_process.stockLoadedAt = null;
_process.stockError = null;
var _stockTimer = null;

async function loadStockInfo() {
  try {
    var codes = [];
    _process.items.forEach(function(it) { if (it.itemCode && codes.indexOf(it.itemCode) === -1) codes.push(it.itemCode); });
    if (!codes.length) return;
    var inList = encodeURIComponent(codes.map(function(c) { return '"' + String(c).replace(/"/g, '') + '"'; }).join(','));

    var results = await Promise.all([
      erpFetchAll('erp_items', 'select=item_code,on_hand,location&item_code=in.(' + inList + ')&order=item_code.asc'),
      erpFetchAll('erp_sof_allocation_items', 'select=id,item_code,sof_no,allocated_qty,used_qty&item_code=in.(' + inList + ')&order=id.asc')
        .catch(function(e) { console.warn('[stock] SOF reservations unavailable:', e.message); return null; })
    ]);
    var items = results[0] || [], alloc = results[1];
    var thisSof = String((_process.doc && (_process.doc.sof_no || _process.doc.gem_so_no)) || '').trim();

    var map = {};
    items.forEach(function(r) {
      map[r.item_code] = { onHand: Number(r.on_hand || 0), location: r.location || '', reservedAll: 0, sofRemaining: 0, reservationKnown: alloc !== null };
    });
    (alloc || []).forEach(function(r) {
      var m = map[r.item_code]; if (!m) return;
      var rem = Number(r.allocated_qty || 0) - Number(r.used_qty || 0);
      if (rem <= 0) return;
      m.reservedAll += rem;
      if (thisSof && String(r.sof_no || '').trim() === thisSof) m.sofRemaining += rem;
    });
    _process.stock = map;
    _process.stockLoadedAt = new Date();
    _process.stockError = null;
  } catch (e) {
    console.warn('[stock] failed:', e.message);
    _process.stockError = e.message;
  }
  renderItems();

  // keep it fresh while the page stays open (someone else may issue the same item)
  if (!_stockTimer) {
    _stockTimer = setInterval(function() { if (!document.hidden) loadStockInfo(); }, 60000);
  }
}

function stockNeed(it) {
  var status = String((_process.doc && _process.doc.status) || '').toUpperCase();
  if (status === 'COMPLETED') return 0;
  return Math.max(Number(it.requestedQty || 0) - Number(it.originalQty || 0), 0);
}

function stockUsable(s) {
  var thisSof = String((_process.doc && (_process.doc.sof_no || _process.doc.gem_so_no)) || '').trim();
  var free = Math.max(s.onHand - s.reservedAll, 0);
  if (thisSof) return Math.max(Math.min(s.onHand, s.sofRemaining + free), 0);
  return free;
}

function stockFmt(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

function stockLevel(it) {
  var s = _process.stock[it.itemCode];
  if (!s) return null;
  var need = stockNeed(it), usable = stockUsable(s);
  if (need <= 0) return 'na';
  if (usable >= need) return 'ok';
  if (usable > 0) return 'short';
  return 'none';
}

function stockCellHtml(it) {
  if (_process.stockError && !_process.stockLoadedAt) return '<td class="text-center text-muted small" title="' + erpEsc(_process.stockError) + '">n/a</td>';
  var s = _process.stock[it.itemCode];
  if (!s) return '<td class="text-center text-muted small">' + (_process.stockLoadedAt ? 'not found' : '…') + '</td>';
  var lvl = stockLevel(it), need = stockNeed(it), usable = stockUsable(s);
  var thisSof = String((_process.doc && (_process.doc.sof_no || _process.doc.gem_so_no)) || '').trim();
  var badge;
  if (lvl === 'ok')         badge = '<span class="badge bg-success">' + stockFmt(usable) + ' avail</span>';
  else if (lvl === 'short') badge = '<span class="badge bg-warning text-dark">only ' + stockFmt(usable) + '</span>';
  else if (lvl === 'none')  badge = '<span class="badge bg-danger">NO STOCK</span>';
  else                      badge = '<span class="badge bg-secondary">' + stockFmt(usable) + '</span>';
  var tip = 'On-hand ' + stockFmt(s.onHand) + ' · reserved sa SOF ' + stockFmt(s.reservedAll) +
            (thisSof ? ' (sa SOF ' + thisSof + ': ' + stockFmt(s.sofRemaining) + ')' : '') +
            (need > 0 ? ' · kailangan ' + stockFmt(need) : '') +
            (s.reservationKnown ? '' : ' · (hindi ma-load ang SOF reservations)');
  var sub = 'on-hand ' + stockFmt(s.onHand) + (s.reservedAll > 0 ? ' · rsv ' + stockFmt(s.reservedAll) : '');
  return '<td class="text-center" title="' + erpEsc(tip) + '">' + badge +
         '<div class="text-muted" style="font-size:0.68rem;line-height:1.2;margin-top:2px;">' + erpEsc(sub) + '</div>' +
         (s.location ? '<div class="text-muted" style="font-size:0.68rem;line-height:1.2;"><i class="bi bi-geo-alt-fill"></i> ' + erpEsc(s.location) + '</div>' : '') +
         '</td>';
}

function renderStockSummary() {
  var el = document.getElementById('stockSummary');
  if (!el) return;
  if (_process.stockError && !_process.stockLoadedAt) { el.innerHTML = '<span class="text-muted">stock check unavailable</span>'; return; }
  if (!_process.stockLoadedAt) { el.innerHTML = '<span class="text-muted">checking stock…</span>'; return; }
  var short = 0, none = 0;
  _process.items.forEach(function(it) {
    var l = stockLevel(it);
    if (l === 'short') short++; else if (l === 'none') none++;
  });
  var t = _process.stockLoadedAt, hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
  var msg = (short + none) === 0
    ? '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>Stock OK</span>'
    : '<span class="text-danger fw-bold"><i class="bi bi-exclamation-triangle-fill me-1"></i>' +
        (none ? none + ' no stock' : '') + (none && short ? ' · ' : '') + (short ? short + ' short' : '') + '</span>';
  el.innerHTML = msg + ' <span class="text-muted">· as of ' + hh + '</span> ' +
    '<a href="javascript:void(0)" onclick="loadStockInfo()" title="Refresh stock" class="text-decoration-none"><i class="bi bi-arrow-clockwise"></i></a>';
}
