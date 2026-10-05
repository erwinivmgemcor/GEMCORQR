// ============================================================
// GEMCOR ERP — New MRR Creation
// Direct Supabase insert + Auto-load items from PO
// ============================================================

var _mrrState = {
  poNo: '',
  prfNo: '',
  client: '',
  vendor: '',
  receivingSite: 'GEMCOR CATMON',
  drNo: '',
  receivingDate: '',
  preparedBy: '',
  items: [],
  isSubmitting: false,
  lastSubmittedAt: 0
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[New MRR] Initializing...');
  
  mrrCheckHealth();
  
  // Set preparedBy from login
  var userFullname = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || '';
  _mrrState.preparedBy = userFullname;
  document.getElementById('mrrPreparedBy').value = userFullname;
  
  // Default receiving date = today
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('mrrReceivingDate').value = today;
  _mrrState.receivingDate = today;
  
  // Enter key handler sa PO input
  document.getElementById('mrrPoNo').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookupPoNo();
    }
  });
  
  console.log('[New MRR] Ready. Prepared By:', userFullname);
});

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function mrrCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  
  try {
    var result = await erpHealthCheck();
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(err) {
    dot.className = 'dot dot-error';
    text.textContent = 'Error';
  }
}

// ═══════════════════════════════════════════════════════════
// STEP 1: PO LOOKUP (loads items from erp_prf_po_cache)
// ═══════════════════════════════════════════════════════════
async function lookupPoNo() {
  var poNo = document.getElementById('mrrPoNo').value.trim();
  var statusEl = document.getElementById('poStatus');
  var resultEl = document.getElementById('poLookupResult');
  
  if (!poNo) {
    statusEl.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> Please enter a PO No.</span>';
    return;
  }
  
  statusEl.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split"></i> Looking up...</span>';
  resultEl.className = 'alert alert-info mb-0 py-2';
  resultEl.innerHTML = '<span class="small">Searching...</span>';
  
  try {
    // Query erp_prf_po_cache by PO No.
    // Note: prf_no format is "PRF#26-878", PO number ay nasa ibang column
    // We'll try flexible matching
    var rows = await erpFetch('erp_prf_po_cache',
      'or=(prf_no.ilike.*' + encodeURIComponent(poNo) + '*,client.ilike.*' + encodeURIComponent(poNo) + '*)' +
      '&order=item_no.asc&limit=500');
    
    // If no rows found by that, try by item_no or client
    if (!rows || rows.length === 0) {
      statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> PO No. not found</span>';
      resultEl.className = 'alert alert-warning mb-0 py-2';
      resultEl.innerHTML = '<span class="small"><i class="bi bi-exclamation-triangle me-1"></i>PO No. <strong>' + erpEsc(poNo) + '</strong> not found in PRF PO master.</span>';
      return;
    }
    
    // Group by PO No. (in case may duplicates)
    // Actually prf_no is the identifier here. Let's filter by PO
    var filtered = rows.filter(function(r) {
      var rPoNo = String(r.po_no || '').trim();
      return rPoNo === poNo || rPoNo.indexOf(poNo) !== -1;
    });
    
    if (filtered.length === 0) {
      filtered = rows; // fallback: use all matched rows
    }
    
    var first = filtered[0];
    _mrrState.poNo = poNo;
    _mrrState.prfNo = first.prf_no || '';
    _mrrState.client = first.client || '';
    _mrrState.vendor = first.client || '';
    
    // Auto-fill fields
    document.getElementById('mrrPrfNo').value = _mrrState.prfNo;
    document.getElementById('mrrVendor').value = _mrrState.vendor;
    
    // Load items from PO
    _mrrState.items = filtered.map(function(r, i) {
      return {
        itemCode: r.inventory_id || '',
        description: r.description || '',
        requestedQty: Number(r.qty || 0),
        issuedQty: Number(r.qty || 0),  // default = full received
        unit: r.unit || 'PCS',
        remarks: '',
        itemNo: r.item_no || (i + 1)
      };
    });
    
    // Render items
    renderItems();
    
    // Show all steps
    document.getElementById('step2Card').style.display = 'block';
    document.getElementById('step3Card').style.display = 'block';
    document.getElementById('step4Card').style.display = 'block';
    
    statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> PO No. found!</span>';
    resultEl.className = 'alert alert-success mb-0 py-2';
    resultEl.innerHTML = '<span class="small"><i class="bi bi-check-circle me-1"></i>Found: <strong>' + erpEsc(_mrrState.prfNo) + '</strong> — ' + erpEsc(_mrrState.client) + ' (' + filtered.length + ' items)</span>';
    
    erpShowToast('PO No. found! ' + filtered.length + ' items loaded.', 'success');
    
    // Focus DR No.
    setTimeout(function() {
      document.getElementById('mrrDrNo').focus();
    }, 300);
    
  } catch(err) {
    console.error('[lookupPoNo]', err);
    statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed</span>';
    resultEl.className = 'alert alert-danger mb-0 py-2';
    resultEl.innerHTML = '<span class="small">' + erpEsc(err.message) + '</span>';
  }
}

// ═══════════════════════════════════════════════════════════
// ITEMS RENDERING
// ═══════════════════════════════════════════════════════════
function renderItems() {
  var tbody = document.getElementById('itemsBody');
  if (!tbody) return;
  
  if (_mrrState.items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No items</td></tr>';
    return;
  }
  
  var html = '';
  _mrrState.items.forEach(function(it, idx) {
    html += '<tr data-idx="' + idx + '">' +
      '<td class="text-center">' + (idx + 1) + '</td>' +
      '<td><input type="text" class="form-control form-control-sm item-code-input" value="' + erpEsc(it.itemCode) + '" onchange="updateItem(' + idx + ', \'itemCode\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm item-desc-input" value="' + erpEsc(it.description) + '" onchange="updateItem(' + idx + ', \'description\', this.value)"></td>' +
      '<td class="text-center">' + it.requestedQty + '</td>' +
      '<td><input type="number" class="form-control form-control-sm text-center item-qty-input" value="' + it.issuedQty + '" min="0" step="0.01" onchange="updateItem(' + idx + ', \'issuedQty\', parseFloat(this.value)||0)"></td>' +
      '<td><input type="text" class="form-control form-control-sm text-center item-unit-input" value="' + erpEsc(it.unit) + '" onchange="updateItem(' + idx + ', \'unit\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm item-remarks-input" value="' + erpEsc(it.remarks) + '" placeholder="Optional" onchange="updateItem(' + idx + ', \'remarks\', this.value)"></td>' +
      '<td class="text-center"><button class="btn btn-sm btn-outline-danger" onclick="removeItem(' + idx + ')" title="Remove"><i class="bi bi-trash"></i></button></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

function updateItem(idx, field, value) {
  if (_mrrState.items[idx]) {
    _mrrState.items[idx][field] = value;
  }
}

function removeItem(idx) {
  if (!confirm('Remove this item?')) return;
  _mrrState.items.splice(idx, 1);
  renderItems();
}

function addItemRow() {
  _mrrState.items.push({
    itemCode: '',
    description: '',
    requestedQty: 0,
    issuedQty: 0,
    unit: 'PCS',
    remarks: '',
    itemNo: _mrrState.items.length + 1
  });
  renderItems();
}

// ═══════════════════════════════════════════════════════════
// SUBMIT MRR
// ═══════════════════════════════════════════════════════════
async function submitMrr() {
  if (_mrrState.isSubmitting) return;
  
  // Double-submit protection
  var now = Date.now();
  if (_mrrState.lastSubmittedAt && (now - _mrrState.lastSubmittedAt) < 10000) {
    erpShowToast('Please wait a moment before submitting again', 'warning');
    return;
  }
  
  // Validation
  if (!_mrrState.poNo) {
    erpShowToast('Please lookup a PO No. first', 'warning');
    return;
  }
  
  var drNo = document.getElementById('mrrDrNo').value.trim();
  if (!drNo) {
    erpShowToast('DR No. / S.I. No. is required', 'warning');
    document.getElementById('mrrDrNo').focus();
    return;
  }
  _mrrState.drNo = drNo;
  
  var receivingDate = document.getElementById('mrrReceivingDate').value;
  if (!receivingDate) {
    erpShowToast('Receiving Date is required', 'warning');
    return;
  }
  _mrrState.receivingDate = receivingDate;
  
  var receivingSite = document.getElementById('mrrReceivingSite').value.trim();
  if (!receivingSite) {
    erpShowToast('Receiving Site is required', 'warning');
    return;
  }
  _mrrState.receivingSite = receivingSite;
  
  var vendor = document.getElementById('mrrVendor').value.trim();
  _mrrState.vendor = vendor;
  
  // Validate items
  if (_mrrState.items.length === 0) {
    erpShowToast('No items to submit', 'warning');
    return;
  }
  
  var validItems = [];
  for (var i = 0; i < _mrrState.items.length; i++) {
    var it = _mrrState.items[i];
    if (!it.itemCode || !it.itemCode.trim()) {
      erpShowToast('Item #' + (i + 1) + ' is missing an item code', 'warning');
      return;
    }
    if (it.issuedQty < 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid qty', 'warning');
      return;
    }
    validItems.push(it);
  }
  
  if (!confirm('Create MRR with ' + validItems.length + ' item(s)?')) return;
  
  _mrrState.isSubmitting = true;
  _mrrState.lastSubmittedAt = now;
  
  var btn = document.getElementById('btnSubmitMrr');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
  
  try {
    // Step 1: Get next doc number via RPC
    console.log('[Submit MRR] Calling RPC...');
    var rpcRes = await fetch(erpUrl('rpc/get_next_doc_number'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_prefix: 'MRR' })
    });
    
    if (!rpcRes.ok) throw new Error('RPC failed: ' + rpcRes.status);
    
    var nextNum = await rpcRes.json();
    if (!nextNum || typeof nextNum !== 'number') {
      throw new Error('Invalid RPC response');
    }
    
    // Format: MRR + 7-digit padding (no dept suffix for MRR)
    var padded = String(nextNum).padStart(7, '0');
    var docNo = 'MRR' + padded;
    
    console.log('[Submit MRR] Doc No:', docNo);
    
    // Step 2: Insert document
    var docRes = await fetch(erpUrl('documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        doc_no: docNo,
        doc_type: 'MRR',
        status: 'PENDING',
        is_bal: false,
        requestor: _mrrState.preparedBy,
        department: '',
        po_no: _mrrState.poNo,
        prf_no: _mrrState.prfNo,
        vendor: _mrrState.vendor,
        client_name: _mrrState.client,
        dr_no: _mrrState.drNo,
        receiving_site: _mrrState.receivingSite,
        receiving_date: _mrrState.receivingDate,
        prepared_by: _mrrState.preparedBy,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    
    if (!docRes.ok) {
      var errText = await docRes.text();
      throw new Error('Insert doc failed: ' + docRes.status + ' ' + errText);
    }
    
    var docArr = await docRes.json();
    var doc = docArr[0];
    if (!doc || !doc.id) throw new Error('No document ID returned');
    
    // Step 3: Insert items
    var itemPayloads = validItems.map(function(it, idx) {
      return {
        document_id: doc.id,
        doc_no: docNo,
        line_no: idx + 1,
        item_code: it.itemCode,
        description: it.description,
        requested_qty: it.requestedQty || it.issuedQty,
        issued_qty: it.issuedQty,  // For MRR, this is received qty
        unit: it.unit,
        remarks: it.remarks || (it.issuedQty >= it.requestedQty ? 'COMPLETE' : 'PARTIAL'),
        row_index: idx + 1
      };
    });
    
    var itemsRes = await fetch(erpUrl('doc_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(itemPayloads)
    });
    
    if (!itemsRes.ok) {
      var itemsErrText = await itemsRes.text();
      throw new Error('Insert items failed: ' + itemsRes.status + ' ' + itemsErrText);
    }
    
    // Step 4: Determine overall status and update
    var allComplete = validItems.every(function(it) {
      return it.issuedQty >= it.requestedQty;
    });
    var anyReceived = validItems.some(function(it) {
      return it.issuedQty > 0;
    });
    
    var overallStatus = (allComplete && anyReceived) ? 'COMPLETED' : 
                        (anyReceived ? 'PARTIAL' : 'PENDING');
    
    // Update status (the trigger might have already done this, but ensure)
    if (overallStatus !== 'PENDING') {
      await fetch(erpUrl('documents?doc_no=eq.' + encodeURIComponent(docNo)), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          status: overallStatus,
          processed_by: _mrrState.preparedBy,
          processed_at: new Date().toISOString()
        })
      });
    }
    
    erpShowToast('✅ MRR created: ' + docNo, 'success');
    showSuccessModal(docNo);
    
  } catch(err) {
    console.error('[submitMrr]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _mrrState.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ═══════════════════════════════════════════════════════════
// SUCCESS MODAL
// ═══════════════════════════════════════════════════════════
function showSuccessModal(docNo) {
  document.getElementById('successDocNo').textContent = docNo;
  
  var base = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  var qrData = base + '../?doc=' + encodeURIComponent(docNo) + '&view=print';
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
  document.getElementById('successQrImg').src = qrUrl;
  
  var modalEl = document.getElementById('successModal');
  var modal = new bootstrap.Modal(modalEl);
  modal.show();
  
  // Auto-reset on close
  modalEl.addEventListener('hidden.bs.modal', function onHide() {
    modalEl.removeEventListener('hidden.bs.modal', onHide);
    resetFormSilent();
  }, { once: true });
}

// ═══════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════
function resetFormSilent() {
  _mrrState.poNo = '';
  _mrrState.prfNo = '';
  _mrrState.client = '';
  _mrrState.vendor = '';
  _mrrState.drNo = '';
  _mrrState.items = [];
  
  document.getElementById('mrrPoNo').value = '';
  document.getElementById('mrrPrfNo').value = '';
  document.getElementById('mrrVendor').value = '';
  document.getElementById('mrrDrNo').value = '';
  // Keep receivingDate and preparedBy
  document.getElementById('poStatus').innerHTML = '';
  document.getElementById('poLookupResult').className = 'alert alert-secondary mb-0 py-2';
  document.getElementById('poLookupResult').innerHTML = '<span class="text-muted small">Enter a PO No. above to auto-load items</span>';
  
  document.getElementById('step2Card').style.display = 'none';
  document.getElementById('step3Card').style.display = 'none';
  document.getElementById('step4Card').style.display = 'none';
  
  document.getElementById('itemsBody').innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">Enter a PO No. above to auto-load items</td></tr>';
  
  console.log('[Reset MRR] Form cleared.');
}

function resetForm() {
  if (!confirm('Reset the form? All unsaved data will be lost.')) return;
  resetFormSilent();
  erpShowToast('Form reset', 'info');
}

function closeSuccessAndReset() {
  var modalEl = document.getElementById('successModal');
  var modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 });
  toast.show();
}

console.log('✅ new-mrr.js loaded');
