// ============================================================
// WAREHOUSE CORE FUNCTIONS (with User Login Integration)
// ============================================================

function getCleanSheetId() {
  const key = 'sheetId_' + state.currentModule;
  const val = localStorage.getItem(key);
  return val ? extractSheetId(val) : '';
}

async function syncModuleLinks() {
  if (state.isLoading) return;
  showLoading('Syncing...');
  try {
    const url = API_URL + '?action=getModuleLinks&_t=' + Date.now();
    console.log('[Sync] URL:', url);
    const res = await fetch(url, { redirect: 'follow' });
    console.log('[Sync] HTTP Status:', res.status);
    const text = await res.text();
    console.log('[Sync] Raw response:', text.substring(0, 500));
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      console.error('[Sync] JSON parse failed. Raw response:', text);
      showToast('Sync error: Invalid response from server. Check console.', 'danger');
      throw new Error('Invalid response');
    }
    console.log('[Sync] Parsed:', data);
    if (data && data.success && data.links) {
      const links = data.links;
      const MRIF = links.MRIF || links.mrif || '';
      const MRR = links.MRR || links.mrr || '';
      const MRS = links.MRS || links.mrs || '';
      if (MRIF) { localStorage.setItem('sheetId_MRIF', extractSheetId(MRIF)); var el = document.getElementById('sheetId_MRIF'); if (el) el.value = extractSheetId(MRIF); }
      if (MRR) { localStorage.setItem('sheetId_MRR', extractSheetId(MRR)); var el2 = document.getElementById('sheetId_MRR'); if (el2) el2.value = extractSheetId(MRR); }
      if (MRS) { localStorage.setItem('sheetId_MRS', extractSheetId(MRS)); var el3 = document.getElementById('sheetId_MRS'); if (el3) el3.value = extractSheetId(MRS); }
      showToast('Module IDs synced!', 'success');
      if (state.currentModule) selectModule(state.currentModule);
    } else {
      showToast('Sync failed: ' + (data.error || 'No links found'), 'danger');
    }
  } catch(err) {
    console.error('[Sync] Error:', err);
    if (err.message !== 'Invalid response') {
      showToast('Sync error: ' + err.message, 'danger');
    }
  } finally {
    hideLoading();
  }
}

async function selectModule(mod) {
  if (state.isLoading) return;
  showLoading('Loading ' + mod + '...');
  try {
    state.currentModule = mod;
    document.querySelectorAll('.module-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector('.module-btn[data-module="' + mod + '"]');
    if (btn) btn.classList.add('active');
    var labelEl = document.getElementById('moduleLabel');
    if (labelEl) labelEl.textContent = mod;
    updateLabels();
    changeDocument();
    await fetchPendingDocs();
    var mrifCard = document.getElementById('mrifListCard');
    if (mrifCard) mrifCard.classList.toggle('d-none', mod !== 'MRIF');
    var mrrCard = document.getElementById('mrrListCard');
    if (mrrCard) mrrCard.classList.toggle('d-none', mod !== 'MRR');
    var mrsCard = document.getElementById('mrsListCard');
    if (mrsCard) mrsCard.classList.toggle('d-none', mod !== 'MRS');
  } catch(err) {
    console.error('[selectModule] Error:', err);
  } finally {
    hideLoading();
  }
}

function updateLabels() {
  const isMRR = state.currentModule === 'MRR';
  const isMRS = state.currentModule === 'MRS';
  var el1 = document.getElementById('headerExpected');
  var el2 = document.getElementById('headerInput');
  if (el1) el1.textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Req. Qty');
  if (el2) el2.textContent = isMRR ? 'ATL QTY' : (isMRS ? 'ATL QTY (Actual)' : 'Issued Qty');
}

async function fetchPendingDocs() {
  const sheetId = getCleanSheetId();
  if (!sheetId) {
    showToast('⚠️ No Sheet ID for ' + state.currentModule + '. Please sync or enter it in Settings.', 'warning');
    return [];
  }
  try {
    const url = API_URL + '?action=getPendingDocs&docType=' + state.currentModule + '&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[fetchPendingDocs] URL:', url);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    console.log('[fetchPendingDocs] Raw response:', text.substring(0, 500));
    let data;
    try { data = JSON.parse(text); } catch(e) { data = []; }
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return [];
    }
    const docs = Array.isArray(data) ? data : (data.docs || data.documents || []);
    populateDocSelect(docs);
    return docs;
  } catch(err) {
    console.error('[fetchPendingDocs] Error:', err);
    showToast('Failed to load documents: ' + err.message, 'danger');
    return [];
  }
}

function populateDocSelect(docs) {
  const sel = document.getElementById('docSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select Document --</option>';
  state.docList = docs;
  docs.forEach(d => {
    const val = typeof d === 'string' ? d : (d.docNo || d.name || d);
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = cleanDocNo(val);
    sel.appendChild(opt);
  });
}

function filterDocs() {
  const term = document.getElementById('docSearch') ? document.getElementById('docSearch').value.toLowerCase() : '';
  const sel = document.getElementById('docSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select Document --</option>';
  if (!state.docList) return;
  state.docList.forEach(d => {
    const val = typeof d === 'string' ? d : (d.docNo || d.name || d);
    if (cleanDocNo(val).toLowerCase().includes(term)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = cleanDocNo(val);
      sel.appendChild(opt);
    }
  });
}

async function onDocSelect(docNo) {
  if (state.isLoading) return;
  if (!docNo) { hideScannerSection(); return; }
  showLoading('Loading document...');
  try {
    clearErrorAlert();
    resetDocumentState();
    state.currentDoc = docNo;
    var picker = document.getElementById('docPickerSection');
    if (picker) picker.classList.add('d-none');
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.remove('d-none');
    var title = document.getElementById('docTitle');
    if (title) title.textContent = cleanDocNo(docNo);
    await fetchDocItems(docNo, state.currentModule);
    checkForProgress();
  } catch(err) {
    console.error('[onDocSelect] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
    var picker = document.getElementById('docPickerSection');
    if (picker) picker.classList.remove('d-none');
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.add('d-none');
  } finally {
    hideLoading();
  }
}

function changeDocument() {
  if (state.currentDoc) {
    saveDocProgress();
    clearDocProgress(state.currentDoc);
  }
  state.currentDoc = null;
  resetDocumentState();
  stopScanner();
  var picker = document.getElementById('docPickerSection');
  if (picker) picker.classList.remove('d-none');
  var active = document.getElementById('activeTransactionSection');
  if (active) active.classList.add('d-none');
  var sel = document.getElementById('docSelect');
  if (sel) sel.value = '';
  var banner = document.getElementById('resumeBanner');
  if (banner) banner.classList.add('d-none');
}

function hideScannerSection() {
  var active = document.getElementById('activeTransactionSection');
  if (active) active.classList.add('d-none');
}

function resetDocumentState() {
  state.items = [];
  renderItems();
  clearErrorAlert();
}

function saveDocProgress() {
  if (state.currentDoc && state.items.length > 0) {
    var verified = state.items.filter(i => i.verified).length;
    if (verified > 0) {
      localStorage.setItem('ivm_progress_' + state.currentDoc, JSON.stringify({
        module: state.currentModule,
        items: state.items,
        savedAt: new Date().toISOString()
      }));
    }
  }
}

function clearDocProgress(docNo) {
  if (docNo) localStorage.removeItem('ivm_progress_' + docNo);
}

function checkForProgress() {
  if (!state.currentDoc) return;
  var saved = localStorage.getItem('ivm_progress_' + state.currentDoc);
  if (saved) {
    var banner = document.getElementById('resumeBanner');
    if (banner) banner.classList.remove('d-none');
  }
}

function resumeProgress() {
  if (!state.currentDoc) return;
  var saved = localStorage.getItem('ivm_progress_' + state.currentDoc);
  if (saved) {
    try {
      var data = JSON.parse(saved);
      if (data.module === state.currentModule && data.items) {
        state.items = data.items;
        renderItems();
        showToast('Progress restored', 'success');
      }
    } catch(e) {}
  }
  var banner = document.getElementById('resumeBanner');
  if (banner) banner.classList.add('d-none');
}

async function fetchDocItems(docNo, docType) {
  const sheetId = getCleanSheetId();
  if (!sheetId) {
    showToast('⚠️ No Sheet ID configured for ' + docType + '. Please go to Settings and sync or enter the Sheet ID.', 'warning');
    throw new Error('No Sheet ID');
  }
  try {
    const url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=' + docType + '&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[fetchDocItems] URL:', url);
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    console.log('[fetchDocItems] Raw response:', text.substring(0, 500));
    let data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[fetchDocItems] JSON parse error:', e);
      showToast('Invalid response from server', 'danger');
      throw new Error('Invalid response');
    }
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      throw new Error(data.error);
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      throw new Error(data.error || 'Failed to load document');
    }
    const items = Array.isArray(data) ? data : (data.items || []);
    if (items.length === 0) {
      showToast('Warning: No items found in this document', 'warning');
    }
    state.items = items.map((it, idx) => ({
      inventoryId: it.inventoryId || it.code || it.itemCode || '',
      description: it.description || it.desc || '',
      qty: Number(it.qty || it.requestedQty || it.expectedQty || 0),
      issuedQty: Number(it.issuedQty || it.actualQty || 0),
      unit: it.unit || 'PIECE',
      rowIndex: it.rowIndex || (idx + 13),
      verified: false,
      selected: false
    }));
    renderItems();
    startScanner();
  } catch(err) {
    console.error('[fetchDocItems] Error:', err);
    throw err;
  }
}

// ─── ITEM RENDERING & BATCH VERIFY ──────────────────────────────
function renderItems() {
  const tbody = document.getElementById('itemsTable');
  if (!tbody) return;
  tbody.innerHTML = '';
  let verified = 0;
  state.items.forEach((item, idx) => {
    if (item.verified) verified++;
    const tr = document.createElement('tr');
    tr.className = 'item-row' + (item.verified ? ' verified' : '');
    tr.setAttribute('data-index', idx);
    tr.style.cursor = 'pointer';
    tr.innerHTML =
      '<td><input type="checkbox" class="item-select" data-index="' + idx + '" ' + (item.selected ? 'checked' : '') + ' onclick="event.stopPropagation();"></td>' +
      '<td><div class="fw-bold small">' + item.inventoryId + '</div><div class="text-muted small">' + item.description + '</div></td>' +
      '<td class="text-center">' + item.qty + '</td>' +
      '<td class="text-center fw-bold">' + (item.verified ? item.issuedQty : '-') + '</td>' +
      '<td class="text-center">' + (item.unit || 'PIECE') + '</td>' +
      '<td>' + getStatusBadge(item) + '</td>';
    
    tr.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }
      const index = parseInt(this.getAttribute('data-index'), 10);
      const item = state.items[index];
      if (item) {
        openQtyModal(item);
      }
    });
    
    tbody.appendChild(tr);
  });
  
  var countEl = document.getElementById('verifyCount');
  if (countEl) countEl.textContent = verified + '/' + state.items.length + ' Verified';
  updateSubmitButton(verified, state.items.length);
}

function getStatusBadge(item) {
  if (!item.verified) return '<span class="status-badge status-pending">PENDING</span>';
  if (state.currentModule === 'MRR') {
    return item.issuedQty >= item.qty ? '<span class="status-badge status-served">COMPLETE</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
  }
  return item.issuedQty >= item.qty ? '<span class="status-badge status-served">SERVED</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
}

function filterItems() {
  const term = document.getElementById('itemFilter') ? document.getElementById('itemFilter').value.toLowerCase() : '';
  document.querySelectorAll('#itemsTable tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(term) ? '' : 'none';
  });
}

function updateSubmitButton(verified, total) {
  const btn = document.getElementById('submitBtn');
  const txt = document.getElementById('submitBtnText');
  if (!btn || !txt) return;
  if (total === 0) { btn.disabled = true; txt.textContent = 'No Items'; return; }
  btn.disabled = false;
  if (verified === total) {
    btn.className = 'btn btn-success w-100 mt-3 py-3';
    txt.textContent = 'Confirm & Submit';
  } else {
    btn.className = 'btn btn-warning w-100 mt-3 py-3';
    txt.textContent = 'Submit Partial (' + verified + '/' + total + ')';
  }
}

function toggleSelectAll(checked) {
  document.querySelectorAll('#itemsTable .item-select').forEach(cb => cb.checked = checked);
}

function openBatchVerify() {
  const selected = document.querySelectorAll('#itemsTable .item-select:checked');
  if (selected.length === 0) {
    showToast('Please select at least one item', 'warning');
    return;
  }
  var countEl = document.getElementById('batchCount');
  var unitEl = document.getElementById('batchUnit');
  var qtyEl = document.getElementById('batchQtyInput');
  if (countEl) countEl.textContent = selected.length;
  const firstRow = selected[0].closest('tr');
  const unitCell = firstRow ? firstRow.querySelector('td:nth-child(5)') : null;
  const unit = unitCell ? unitCell.textContent.trim() : 'PIECE';
  if (unitEl) unitEl.textContent = unit;
  if (qtyEl) {
    qtyEl.value = '';
    qtyEl.dataset.unit = unit;
  }
  if (batchVerifyModal) batchVerifyModal.show();
}

function confirmBatchVerify() {
  const qtyInput = document.getElementById('batchQtyInput');
  if (!qtyInput) return;
  const qtyVal = parseInt(qtyInput.value, 10);
  if (isNaN(qtyVal) || qtyVal < 0) {
    showToast('Please enter a valid quantity', 'warning');
    return;
  }
  const unit = qtyInput.dataset.unit || 'PIECE';
  const selectedRows = document.querySelectorAll('#itemsTable .item-select:checked');
  selectedRows.forEach(cb => {
    const idx = parseInt(cb.dataset.index, 10);
    const item = state.items[idx];
    if (!item) return;
    const isMRR = state.currentModule === 'MRR';
    if (!isMRR && qtyVal > item.qty) {
      showToast('Warning: Some items have qty capped at requested amount', 'warning');
    }
    const finalQty = isMRR ? qtyVal : Math.min(qtyVal, item.qty);
    item.issuedQty = finalQty;
    item.unit = unit;
    item.verified = true;
  });
  if (batchVerifyModal) batchVerifyModal.hide();
  renderItems();
  showToast('Batch verify completed', 'success');
}

async function onSubmit() {
  if (state.isLoading) return;
  const verifiedItems = state.items.filter(i => i.verified);
  const total = state.items.length;
  const verified = verifiedItems.length;
  if (verified === 0) {
    showToast('No items verified. Scan or enter items first.', 'warning');
    return;
  }
  if (verified < total) {
    if (!confirm('You have ' + (total - verified) + ' unverified item(s). Submit partial transaction now?\nOnly scanned/entered items will be sent.')) {
      return;
    }
  }
  showLoading('Submitting...');
  try {
    const result = await submitTransaction(verifiedItems);
    console.log('[Submit] Result:', result);
    if (result && result.success === true) {
      try {
        var allComplete = true;
        var anyProcessed = false;
        state.items.forEach(function(it) {
          if (!it.verified) { allComplete = false; }
          else { anyProcessed = true; if (it.issuedQty < it.qty) allComplete = false; }
        });
        var newStatus = allComplete && anyProcessed ? 'COMPLETED' : (anyProcessed ? 'PARTIAL' : 'PENDING');
        var statusUrl = API_URL + '?action=updateDocStatus&docNo=' + encodeURIComponent(state.currentDoc) + '&status=' + newStatus + '&_t=' + Date.now();
        console.log('[Submit] Updating DOCLINKS status:', newStatus);
        var statusRes = await fetch(statusUrl, { redirect: 'follow' });
        var statusData = await statusRes.json();
        console.log('[Submit] DOCLINKS update:', statusData);
        if (statusData && statusData.success) {
          showToast('Request status updated to ' + newStatus, 'success');
        } else {
          showToast('Warning: Could not update status. Error: ' + (statusData.error || 'Unknown'), 'warning');
        }
      } catch(statusErr) {
        console.error('[Submit] DOCLINKS update error:', statusErr);
        showToast('Warning: Status update failed', 'danger');
      }
      clearDocProgress(state.currentDoc);
      if (successModal) successModal.show();
      setTimeout(() => location.reload(), 2000);
    } else {
      showToast('Error: ' + (result.error || 'Submission failed'), 'danger');
    }
  } catch(err) {
    console.error('[Submit] Error:', err);
    showToast('Submit error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

async function submitTransaction(verifiedItems) {
  const itemsStr = verifiedItems.map(i => 
    encodeURIComponent(i.inventoryId) + ',' + i.issuedQty + ',' + i.rowIndex + ',' + encodeURIComponent(i.unit || 'PIECE')
  ).join(';');
  const url = API_URL + '?action=submitTransaction' +
    '&docNo=' + encodeURIComponent(state.currentDoc) +
    '&docType=' + encodeURIComponent(state.currentModule) +
    '&sheetId=' + encodeURIComponent(getCleanSheetId()) +
    '&items=' + itemsStr +
    '&processedBy=' + encodeURIComponent(state.currentUser || state.warehouseName || 'WAREHOUSE') +
    '&_t=' + Date.now();
  console.log('[Submit] URL length:', url.length);
  console.log('[Submit] URL:', url);
  const res = await fetch(url, { redirect: 'follow' });
  console.log('[Submit] HTTP Status:', res.status);
  const text = await res.text();
  console.log('[Submit] Raw response:', text);
  const result = JSON.parse(text);
  console.log('[Submit] Parsed:', result);
  return result;
}

// ─── PO ITEMS & MRR CREATION ─────────────────────────────────────
function renderPoItems() {
  var noEl = document.getElementById('poDisplayNo');
  var prfEl = document.getElementById('poDisplayPrf');
  var clientEl = document.getElementById('poDisplayClient');
  if (noEl) noEl.textContent = state.currentPoNo;
  if (prfEl) prfEl.textContent = state.currentPoPrf || '-';
  if (clientEl) clientEl.textContent = state.currentPoSupplier || state.currentPoClient || '-';
  const list = document.getElementById('poItemsList');
  if (!list) return;
  list.innerHTML = state.poItemsData.map((item, idx) => `
<div class="card mb-2 po-item-card" id="po-card-${idx}">
<div class="card-body py-2 px-3">
<div class="d-flex align-items-center gap-2">
<div class="form-check m-0">
<input class="form-check-input po-check" type="checkbox" id="po-check-${idx}" checked onchange="togglePoCard(${idx})">
</div>
<div class="flex-grow-1" style="min-width:0">
<div class="fw-bold small text-truncate">${item.inventoryId || item.itemCode || ''}</div>
<div class="text-muted small text-truncate">${item.description || ''}</div>
<div class="d-flex gap-2 mt-1">
<small class="text-muted">PO Qty: <strong>${item.qty || 0}</strong></small>
<small class="text-muted">Unit: <strong>${item.unit || 'PCS'}</strong></small>
</div>
</div>
<div style="min-width:90px">
<label class="form-label mb-0 small">ATL Qty</label>
<input type="number" class="form-control form-control-sm" id="po-atl-${idx}" value="${item.qty || 0}" min="0" style="width:80px">
</div>
<div style="min-width:100px">
<label class="form-label mb-0 small">Unit</label>
<select class="form-select form-select-sm" id="po-unit-${idx}">
  ${buildUnitOptions(item.unit || 'PCS')}
</select>
</div>
</div>
</div>
</div>
`).join('');
}

function togglePoCard(idx) {
  const checked = document.getElementById('po-check-' + idx) ? document.getElementById('po-check-' + idx).checked : false;
  const card = document.getElementById('po-card-' + idx);
  if (card) {
    if (checked) card.classList.remove('opacity-50');
    else card.classList.add('opacity-50');
  }
}

function selectAllPoItems(select) {
  state.poItemsData.forEach((_, idx) => {
    var cb = document.getElementById('po-check-' + idx);
    if (cb) cb.checked = select;
    togglePoCard(idx);
  });
}

function closePoItemsModal() {
  if (state.poItemsModal) state.poItemsModal.hide();
}

async function createMrrFromPo() {
  const selected = [];
  state.poItemsData.forEach((item, idx) => {
    if (document.getElementById('po-check-' + idx) && document.getElementById('po-check-' + idx).checked) {
      const atlQty = parseFloat(document.getElementById('po-atl-' + idx) ? document.getElementById('po-atl-' + idx).value : 0) || 0;
      const unit = document.getElementById('po-unit-' + idx) ? document.getElementById('po-unit-' + idx).value : 'PCS';
      selected.push({
        inventoryId: item.inventoryId || item.itemCode || '',
        description: item.description || '',
        qty: item.qty || 0,
        unit: unit,
        atlQty: atlQty
      });
    }
  });
  if (selected.length === 0) {
    showToast('Please select at least one item', 'warning');
    return;
  }
  const drNo = document.getElementById('mrrDrNo') ? document.getElementById('mrrDrNo').value.trim() : '';
  const receivingDate = document.getElementById('mrrReceivingDate') ? document.getElementById('mrrReceivingDate').value : '';
  showLoading('Creating MRR...');
  try {
    const payload = {
      action: 'createMrrRequest',
      poNo: state.currentPoNo,
      prfNo: state.currentPoPrf,
      client: state.currentPoClient,
      supplier: state.currentPoSupplier,
      drNo: drNo,
      receivingDate: receivingDate,
      items: selected
    };
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
    if (data && data.success) {
      closePoItemsModal();
      showToast('MRR created: ' + data.docNo, 'success');
      await fetchPendingDocs();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    showToast('Error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

async function lookupPoFromScan(poNo) {
  try {
    const url = API_URL + '?action=getPoItems&poNo=' + encodeURIComponent(poNo) + '&_t=' + Date.now();
    console.log('[lookupPoFromScan] URL:', url);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' - ' + res.statusText);
    }
    const text = await res.text();
    console.log('[lookupPoFromScan] Raw response:', text.substring(0, 500));
    let data;
    try { data = JSON.parse(text); } catch(e) {
      console.error('[lookupPoFromScan] JSON parse error:', e);
      return null;
    }
    return (data && data.success) ? data : null;
  } catch(err) {
    console.error('[lookupPoFromScan] Error:', err);
    throw err;
  }
}

async function manualPoLookup() {
  const poNo = document.getElementById('manualPoInput') ? document.getElementById('manualPoInput').value.trim() : '';
  const mrrPoNo = document.getElementById('mrrManualPoInput') ? document.getElementById('mrrManualPoInput').value.trim() : '';
  const finalPo = poNo || mrrPoNo;
  
  if (!finalPo) { showToast('Please enter a PO number', 'warning'); return; }
  
  if (document.getElementById('manualPoInput')) document.getElementById('manualPoInput').value = '';
  if (document.getElementById('mrrManualPoInput')) document.getElementById('mrrManualPoInput').value = '';
  
  showLoading('Looking up PO...');
  try {
    const poResult = await lookupPoFromScan(finalPo);
    console.log('[manualPoLookup] Result:', poResult);
    
    if (poResult && poResult.success) {
      playSuccessBeep();
      state.currentPoNo = finalPo;
      state.currentPoPrf = poResult.prfNo || '';
      state.currentPoClient = poResult.client || '';
      state.currentPoSupplier = poResult.supplier || poResult.client || '';
      state.poItemsData = poResult.items;
      renderPoItems();
      if (state.poItemsModal) state.poItemsModal.show();
    } else {
      const errorMsg = (poResult && poResult.error) ? poResult.error : 'No items found for PO: ' + finalPo;
      showToast('⚠️ ' + errorMsg, 'warning');
    }
  } catch(err) {
    console.error('[manualPoLookup] Error:', err);
    showToast('Error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ─── QTY MODAL ────────────────────────────────────────────────────
let currentModalItem = null;

function openQtyModal(item) {
  currentModalItem = item;
  const isMRR = state.currentModule === 'MRR';
  const isMRS = state.currentModule === 'MRS';
  var codeEl = document.getElementById('modalItemCode');
  var descEl = document.getElementById('modalItemDesc');
  var labelEl = document.getElementById('modalExpectedLabel');
  var qtyEl = document.getElementById('modalExpectedQty');
  var inputLabelEl = document.getElementById('modalInputLabel');
  var inputQtyEl = document.getElementById('modalInputQty');
  var unitSelect = document.getElementById('modalUnit');
  var hintEl = document.getElementById('modalHint');
  if (codeEl) codeEl.textContent = item.inventoryId;
  if (descEl) descEl.textContent = item.description;
  if (labelEl) labelEl.textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Requested Qty');
  if (qtyEl) qtyEl.value = item.qty;
  if (inputLabelEl) inputLabelEl.textContent = isMRR ? 'ATL QTY (Received)' : (isMRS ? 'ATL QTY (Actual Returned)' : 'Enter Issued Qty');
  if (inputQtyEl) inputQtyEl.value = item.qty;
  if (unitSelect) unitSelect.innerHTML = buildUnitOptions(item.unit || 'PIECE');
  if (hintEl) hintEl.textContent = isMRR ? 'MRR Mode: You may receive any quantity.' : (isMRS ? 'MRS Mode: Returned qty cannot exceed expected.' : 'MRIF Mode: Issued qty cannot exceed requested.');
  if (inputQtyEl) inputQtyEl.classList.remove('is-invalid');
  if (qtyModal) qtyModal.show();
}

function onQtyInput() {
  clearErrorAlert();
  var el = document.getElementById('modalInputQty');
  if (el) el.classList.remove('is-invalid');
}

function confirmQty() {
  if (state.isLoading) return;
  if (!currentModalItem) return;
  const input = document.getElementById('modalInputQty');
  if (!input) return;
  const qtyVal = parseInt(input.value, 10);
  if (isNaN(qtyVal) || qtyVal < 0) {
    input.classList.add('is-invalid');
    playErrorBuzz();
    return;
  }
  const isMRR = state.currentModule === 'MRR';
  if (!isMRR && qtyVal > currentModalItem.qty) {
    const max = currentModalItem.qty;
    const msg = state.currentModule === 'MRS'
      ? 'Returned Qty cannot exceed Expected Qty (Max: ' + max + ')'
      : 'Issued Qty cannot exceed Requested Qty (Max: ' + max + ')';
    showExceedError(msg);
    input.value = max;
    input.classList.add('is-invalid');
    playErrorBuzz();
    return;
  }
  var unitSelect = document.getElementById('modalUnit');
  var selectedUnit = unitSelect ? unitSelect.value : 'PIECE';

  currentModalItem.issuedQty = qtyVal;
  currentModalItem.unit = selectedUnit;
  currentModalItem.verified = true;
  saveDocProgress();
  renderItems();
  if (qtyModal) qtyModal.hide();
  playSuccessBeep();
}

function showMismatchAlert(code) {
  const alert = document.getElementById('mismatchAlert');
  const text = document.getElementById('mismatchText');
  if (!alert || !text) return;
  text.textContent = 'Item "' + code + '" not found in this document.';
  alert.classList.remove('d-none');
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
}

function showExceedError(msg) {
  const alert = document.getElementById('exceedErrorAlert');
  const text = document.getElementById('exceedText');
  if (!alert || !text) return;
  text.textContent = 'Error: ' + msg;
  alert.classList.remove('d-none');
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
}

function clearErrorAlert() {
  const a1 = document.getElementById('mismatchAlert');
  const a2 = document.getElementById('exceedErrorAlert');
  if (a1) a1.classList.add('d-none');
  if (a2) a2.classList.add('d-none');
}

// ─── REQUESTOR & SOF HELPERS ─────────────────────────────────────
async function loadRequestInventory() {
  try {
    const url = API_URL + '?action=getInventoryList&_t=' + Date.now();
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }
    const inv = data.inventory || data.items || [];
    state.requestInventoryList = inv;
    // Populate item code datalist
    populateDatalist('itemCodeDatalist', inv.map(function(it) { return it.code; }));
  } catch(err) {
    state.requestInventoryList = [];
  }
}

async function loadRequestorList() {
  try {
    const url = API_URL + '?action=getRequestorList&_t=' + Date.now();
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }

    const sel = document.getElementById('reqRequestor');
    const sel3 = document.getElementById('step3Requestor');
    if (sel) sel.innerHTML = '<option value="">-- Select Requestor --</option>';
    if (sel3) sel3.innerHTML = '<option value="">-- Select Requestor --</option>';

    if (data.success && data.requestors) {
      state.requestorList = data.requestors;
      data.requestors.forEach(r => {
        var opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = r.name;
        opt.dataset.department = r.department;
        if (sel) sel.appendChild(opt);

        var opt3 = document.createElement('option');
        opt3.value = r.name;
        opt3.textContent = r.name;
        opt3.dataset.department = r.department;
        if (sel3) sel3.appendChild(opt3);
      });
    }
  } catch(err) {
    console.error('Failed to load requestor list:', err);
  }
}

function onRequestorChange() {
  const sel = document.getElementById('reqRequestor');
  if (!sel) return;
  const selected = sel.options[sel.selectedIndex];
  const dept = selected ? selected.dataset.department : '';
  var deptEl = document.getElementById('reqDepartment');
  if (deptEl) deptEl.value = dept || '';
}

async function lookupSofData() {
  const joNo = document.getElementById('reqJoNo') ? document.getElementById('reqJoNo').value.trim() : '';
  if (!joNo) return;
  showLoading('Looking up JO No....');
  try {
    const url = API_URL + '?action=getSofData&joNo=' + encodeURIComponent(joNo) + '&_t=' + Date.now();
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }
    if (data.success) {
      var gemEl = document.getElementById('reqGemSoNo');
      var clientEl = document.getElementById('reqClientName');
      var projEl = document.getElementById('reqProject');
      if (gemEl) gemEl.value = data.gemSoNo || '';
      if (clientEl) clientEl.value = data.clientName || '';
      if (projEl) projEl.value = data.project || '';
      showToast('JO No. found! Auto-filled SO data.', 'success');
    } else {
      var gemEl2 = document.getElementById('reqGemSoNo');
      var clientEl2 = document.getElementById('reqClientName');
      var projEl2 = document.getElementById('reqProject');
      if (gemEl2) gemEl2.value = '';
      if (clientEl2) clientEl2.value = '';
      if (projEl2) projEl2.value = '';
      showToast('JO No. not found in SOF Monitoring. You can still submit.', 'warning');
    }
  } catch(err) {
    showToast('SOF lookup failed: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ─── DATALIST HELPERS ─────────────────────────────────────────────
function populateDatalist(datalistId, items) {
  var datalist = document.getElementById(datalistId);
  if (!datalist) return;
  datalist.innerHTML = '';
  items.forEach(function(item) {
    var option = document.createElement('option');
    option.value = item;
    datalist.appendChild(option);
  });
}

async function loadVendorList() {
  try {
    var url = API_URL + '?action=getVendorList&_t=' + Date.now();
    var res = await fetch(url);
    var data = await res.json();
    if (data.success && data.vendors) {
      state.vendorList = data.vendors;
      populateDatalist('vendorDatalist', state.vendorList);
    }
  } catch(e) { console.error('Failed to load vendor list', e); }
}

async function loadIvmTeamList() {
  try {
    var url = API_URL + '?action=getIvmTeamList&_t=' + Date.now();
    var res = await fetch(url);
    var data = await res.json();
    if (data.success && data.members) {
      state.ivmTeamList = data.members;
      populateDatalist('ivmTeamDatalist', state.ivmTeamList);
    }
  } catch(e) { console.error('Failed to load IVM team list', e); }
}

// ─── MANUAL MRR FUNCTIONS (with datalist support) ──────────────
var manualMrrModal = null;
var manualMrrItems = [];

function openManualMrrModal() {
  if (!manualMrrModal) {
    manualMrrModal = new bootstrap.Modal(document.getElementById('manualMrrModal'));
  }
  var poEl = document.getElementById('manualMrrPoNo');
  var drEl = document.getElementById('manualMrrDrNo');
  var vendorEl = document.getElementById('manualMrrVendor');
  var siteEl = document.getElementById('manualMrrSite');
  var prepEl = document.getElementById('manualMrrPreparedBy');
  if (poEl) poEl.value = '';
  if (drEl) drEl.value = '';
  if (vendorEl) vendorEl.value = '';
  if (siteEl) siteEl.value = 'GEMCOR CATMON';
  if (prepEl) prepEl.value = '';
  manualMrrItems = [];
  renderManualMrrItems();
  updateManualMrrSubmitButton();
  manualMrrModal.show();
  // Load lists for datalist
  loadRequestInventory();   // loads inventory codes and populates itemCodeDatalist
  loadVendorList();
  loadIvmTeamList();
}

function addManualMrrItem() {
  manualMrrItems.push({
    inventoryId: '',
    description: '',
    qty: 1,
    atlQty: 0,
    unit: 'PIECE'
  });
  renderManualMrrItems();
  updateManualMrrSubmitButton();
  setTimeout(function() {
    var inputs = document.querySelectorAll('.manual-mrr-code');
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
    }
  }, 100);
}

function removeManualMrrItem(index) {
  manualMrrItems.splice(index, 1);
  renderManualMrrItems();
  updateManualMrrSubmitButton();
}

function updateManualMrrItem(index, field, value) {
  if (manualMrrItems[index]) {
    manualMrrItems[index][field] = value;
  }
  updateManualMrrSubmitButton();
}

function renderManualMrrItems() {
  var tbody = document.getElementById('manualMrrItemsBody');
  var emptyState = document.getElementById('manualMrrEmptyState');
  if (!tbody) return;

  if (manualMrrItems.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  var html = '';
  for (var i = 0; i < manualMrrItems.length; i++) {
    var it = manualMrrItems[i];
    html += '<tr>' +
      '<td class="align-middle text-center">' + (i + 1) + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm manual-mrr-code" ' +
          'list="itemCodeDatalist" ' +
          'value="' + (it.inventoryId || '') + '" ' +
          'onchange="onManualMrrCodeChange(' + i + ', this.value)" ' +
          'placeholder="Item code" autocomplete="off">' +
      '</td>' +
      '<td><input type="text" class="form-control form-control-sm manual-mrr-desc" ' +
        'id="manualMrrDesc' + i + '" ' +
        'value="' + (it.description || '') + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'description\', this.value)" ' +
        'placeholder="Description"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.qty || 0) + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'qty\', parseFloat(this.value)||0)" ' +
        'min="0" step="0.01"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.atlQty || 0) + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'atlQty\', parseFloat(this.value)||0)" ' +
        'min="0" step="0.01"></td>' +
      '<td><select class="form-select form-select-sm manual-mrr-unit" ' +
        'onchange="updateManualMrrItem(' + i + ', \'unit\', this.value)">' +
        buildUnitOptions(it.unit || 'PIECE') +
      '</select></td>' +
      '<td class="align-middle text-center">' +
        '<button class="btn btn-sm btn-outline-danger" onclick="removeManualMrrItem(' + i + ')" title="Remove">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

function onManualMrrCodeChange(index, code) {
  var item = state.requestInventoryList.find(function(it) { return it.code === code || it.inventoryId === code; });
  if (item) {
    manualMrrItems[index].inventoryId = item.code || item.inventoryId;
    manualMrrItems[index].description = item.description || '';
    // Update the description field
    var descField = document.getElementById('manualMrrDesc' + index);
    if (descField) descField.value = item.description || '';
    // Set unit if available
    if (item.unit) {
      manualMrrItems[index].unit = item.unit;
      var row = descField ? descField.closest('tr') : null;
      if (row) {
        var unitSelect = row.querySelector('.manual-mrr-unit');
        if (unitSelect) {
          for (var opt = 0; opt < unitSelect.options.length; opt++) {
            if (unitSelect.options[opt].value === item.unit) {
              unitSelect.selectedIndex = opt;
              break;
            }
          }
        }
      }
    }
    updateManualMrrSubmitButton();
  }
}

function updateManualMrrSubmitButton() {
  var btn = document.getElementById('btnSubmitManualMrr');
  if (!btn) return;

  var drNo = document.getElementById('manualMrrDrNo') ? document.getElementById('manualMrrDrNo').value.trim() : '';
  var vendor = document.getElementById('manualMrrVendor') ? document.getElementById('manualMrrVendor').value.trim() : '';
  var site = document.getElementById('manualMrrSite') ? document.getElementById('manualMrrSite').value.trim() : '';

  var hasValidItems = false;
  for (var i = 0; i < manualMrrItems.length; i++) {
    var it = manualMrrItems[i];
    if (it.inventoryId && it.inventoryId.trim() && it.description && it.description.trim() && it.qty > 0) {
      hasValidItems = true;
      break;
    }
  }

  btn.disabled = !(drNo && vendor && site && hasValidItems);
}

async function submitManualMrr() {
  var poNo = document.getElementById('manualMrrPoNo') ? document.getElementById('manualMrrPoNo').value.trim() : '';
  var drNo = document.getElementById('manualMrrDrNo') ? document.getElementById('manualMrrDrNo').value.trim() : '';
  var vendor = document.getElementById('manualMrrVendor') ? document.getElementById('manualMrrVendor').value.trim() : '';
  var site = document.getElementById('manualMrrSite') ? document.getElementById('manualMrrSite').value.trim() : '';
  var receivingDate = document.getElementById('manualMrrDate') ? document.getElementById('manualMrrDate').value : '';
  var preparedBy = document.getElementById('manualMrrPreparedBy') ? document.getElementById('manualMrrPreparedBy').value.trim() : '';

  var items = [];
  for (var i = 0; i < manualMrrItems.length; i++) {
    var it = manualMrrItems[i];
    if (it.inventoryId && it.inventoryId.trim() && it.description && it.description.trim() && it.qty > 0) {
      items.push({
        inventoryId: it.inventoryId.trim(),
        description: it.description.trim(),
        qty: it.qty,
        atlQty: it.atlQty || 0,
        unit: it.unit || 'PIECE'
      });
    }
  }

  if (items.length === 0) {
    showToast('Please add at least one valid item', 'warning');
    return;
  }

  showLoading('Creating Manual MRR...');
  try {
    var payload = {
      action: 'createMrrRequest',
      poNo: poNo || 'N/A',
      prfNo: '',
      client: vendor,
      supplier: vendor,
      drNo: drNo,
      receivingDate: receivingDate,
      receivingSite: site,
      preparedBy: preparedBy,
      items: items,
      isManual: true
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
      if (manualMrrModal) manualMrrModal.hide();
      showToast('Manual MRR created: ' + data.docNo, 'success');
      await fetchPendingDocs();
      await updateWarehouseKPIs();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    showToast('Error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ─── QUICK ACTIONS ────────────────────────────────────────────────
async function quickProcessPending() {
  if (state.isLoading) return;
  
  var statusEl = document.getElementById('quickActionStatus');
  if (statusEl) statusEl.textContent = '⏳ Looking for next pending...';
  
  try {
    await selectModule('MRIF');
    var docs = await fetchPendingDocs();
    
    if (!docs || docs.length === 0) {
      if (statusEl) statusEl.textContent = '✅ No pending MRIF documents found.';
      showToast('No pending MRIF documents', 'info');
      return;
    }
    
    var docNo = typeof docs[0] === 'string' ? docs[0] : (docs[0].docNo || docs[0].name);
    if (!docNo) {
      if (statusEl) statusEl.textContent = '❌ Could not determine document name.';
      return;
    }
    
    await onDocSelect(docNo);
    if (statusEl) statusEl.textContent = '📄 Loaded: ' + cleanDocNo(docNo);
    showToast('Loading ' + cleanDocNo(docNo) + '...', 'success');
    
  } catch(err) {
    console.error('[quickProcessPending] Error:', err);
    if (statusEl) statusEl.textContent = '❌ Error: ' + err.message;
    showToast('Error: ' + err.message, 'danger');
  }
}

function quickNewMrr() {
  selectModule('MRR').then(() => {
    var poInput = document.getElementById('manualPoInput');
    if (poInput) {
      poInput.focus();
      showToast('Enter PO number to create MRR', 'info');
    } else {
      openQuickScan();
    }
  }).catch(err => {
    showToast('Error switching to MRR: ' + err.message, 'danger');
  });
}

function quickNewMrif() {
  openManualMrifModal();
}
