// ============================================================
// WAREHOUSE CORE FUNCTIONS
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
      if (MRIF) { localStorage.setItem('sheetId_MRIF', extractSheetId(MRIF)); document.getElementById('sheetId_MRIF').value = extractSheetId(MRIF); }
      if (MRR) { localStorage.setItem('sheetId_MRR', extractSheetId(MRR)); document.getElementById('sheetId_MRR').value = extractSheetId(MRR); }
      if (MRS) { localStorage.setItem('sheetId_MRS', extractSheetId(MRS)); document.getElementById('sheetId_MRS').value = extractSheetId(MRS); }
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
    document.getElementById('moduleLabel').textContent = mod;
    updateLabels();
    changeDocument();
    await fetchPendingDocs();
    var mrifCard = document.getElementById('mrifListCard');
    if (mrifCard) mrifCard.classList.toggle('d-none', mod !== 'MRIF');
    var mrrCard = document.getElementById('mrrListCard');
    if (mrrCard) mrrCard.classList.toggle('d-none', mod !== 'MRR');
    var mrsCard = document.getElementById('mrsListCard');
    if (mrsCard) mrsCard.classList.toggle('d-none', mod !== 'MRS');
  } finally {
    hideLoading();
  }
}

function updateLabels() {
  const isMRR = state.currentModule === 'MRR';
  const isMRS = state.currentModule === 'MRS';
  document.getElementById('headerExpected').textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Req. Qty');
  document.getElementById('headerInput').textContent = isMRR ? 'ATL QTY' : (isMRS ? 'ATL QTY (Actual)' : 'Issued Qty');
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
  const term = document.getElementById('docSearch').value.toLowerCase();
  const sel = document.getElementById('docSelect');
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
    document.getElementById('docPickerSection').classList.add('d-none');
    document.getElementById('activeTransactionSection').classList.remove('d-none');
    document.getElementById('docTitle').textContent = cleanDocNo(docNo);
    await fetchDocItems(docNo, state.currentModule);
    checkForProgress();
  } catch(err) {
    console.error('[onDocSelect] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
    document.getElementById('docPickerSection').classList.remove('d-none');
    document.getElementById('activeTransactionSection').classList.add('d-none');
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
  document.getElementById('docPickerSection').classList.remove('d-none');
  document.getElementById('activeTransactionSection').classList.add('d-none');
  document.getElementById('docSelect').value = '';
  document.getElementById('resumeBanner').classList.add('d-none');
}

function hideScannerSection() {
  document.getElementById('activeTransactionSection').classList.add('d-none');
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
    document.getElementById('resumeBanner').classList.remove('d-none');
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
  document.getElementById('resumeBanner').classList.add('d-none');
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
  tbody.innerHTML = '';
  let verified = 0;
  state.items.forEach((item, idx) => {
    if (item.verified) verified++;
    const tr = document.createElement('tr');
    tr.className = 'item-row' + (item.verified ? ' verified' : '');
    tr.innerHTML =
      '<td><input type="checkbox" class="item-select" data-index="' + idx + '" ' + (item.selected ? 'checked' : '') + '></td>' +
      '<td><div class="fw-bold small">' + item.inventoryId + '</div><div class="text-muted small">' + item.description + '</div></td>' +
      '<td class="text-center">' + item.qty + '</td>' +
      '<td class="text-center fw-bold">' + (item.verified ? item.issuedQty : '-') + '</td>' +
      '<td class="text-center">' + (item.unit || 'PIECE') + '</td>' +
      '<td>' + getStatusBadge(item) + '</td>';
    tbody.appendChild(tr);
  });
  document.getElementById('verifyCount').textContent = verified + '/' + state.items.length + ' Verified';
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
  const term = document.getElementById('itemFilter').value.toLowerCase();
  document.querySelectorAll('#itemsTable tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(term) ? '' : 'none';
  });
}

function updateSubmitButton(verified, total) {
  const btn = document.getElementById('submitBtn');
  const txt = document.getElementById('submitBtnText');
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

function openBatchVerify() {
  const selected = document.querySelectorAll('#itemsTable .item-select:checked');
  if (selected.length === 0) {
    showToast('Please select at least one item', 'warning');
    return;
  }
  document.getElementById('batchCount').textContent = selected.length;
  const firstRow = selected[0].closest('tr');
  const unitCell = firstRow.querySelector('td:nth-child(5)');
  const unit = unitCell ? unitCell.textContent.trim() : 'PIECE';
  document.getElementById('batchUnit').textContent = unit;
  document.getElementById('batchQtyInput').value = '';
  document.getElementById('batchQtyInput').dataset.unit = unit;
  batchVerifyModal.show();
}

function confirmBatchVerify() {
  const qtyInput = document.getElementById('batchQtyInput');
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
  batchVerifyModal.hide();
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
      successModal.show();
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
    '&processedBy=' + encodeURIComponent(state.warehouseName || 'WAREHOUSE') +
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
  document.getElementById('poDisplayNo').textContent = state.currentPoNo;
  document.getElementById('poDisplayPrf').textContent = state.currentPoPrf || '-';
  document.getElementById('poDisplayClient').textContent = state.currentPoSupplier || state.currentPoClient || '-';
  const list = document.getElementById('poItemsList');
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
  const checked = document.getElementById('po-check-' + idx).checked;
  const card = document.getElementById('po-card-' + idx);
  if (checked) {
    card.classList.remove('opacity-50');
  } else {
    card.classList.add('opacity-50');
  }
}
function selectAllPoItems(select) {
  state.poItemsData.forEach((_, idx) => {
    document.getElementById('po-check-' + idx).checked = select;
    togglePoCard(idx);
  });
}
function closePoItemsModal() {
  if (state.poItemsModal) state.poItemsModal.hide();
}
async function createMrrFromPo() {
  const selected = [];
  state.poItemsData.forEach((item, idx) => {
    if (document.getElementById('po-check-' + idx).checked) {
      const atlQty = parseFloat(document.getElementById('po-atl-' + idx).value) || 0;
      const unit = document.getElementById('po-unit-' + idx).value || 'PCS';
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
  const drNo = document.getElementById('mrrDrNo').value.trim();
  const receivingDate = document.getElementById('mrrReceivingDate').value;
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
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return null; }
    return (data && data.success) ? data : null;
  } catch(err) {
    return null;
  }
}
async function manualPoLookup() {
  const poNo = document.getElementById('manualPoInput').value.trim();
  if (!poNo) { showToast('Please enter a PO number', 'warning'); return; }
  document.getElementById('manualPoInput').value = '';
  showLoading('Looking up PO...');
  try {
    const poResult = await lookupPoFromScan(poNo);
    if (poResult && poResult.success) {
      playSuccessBeep();
      state.currentPoNo = poNo;
      state.currentPoPrf = poResult.prfNo || '';
      state.currentPoClient = poResult.client || '';
      state.currentPoSupplier = poResult.supplier || poResult.client || '';
      state.poItemsData = poResult.items;
      renderPoItems();
      state.poItemsModal.show();
    } else {
      showToast((poResult && poResult.error) || 'No items found for PO: ' + poNo, 'warning');
    }
  } catch(err) {
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
  document.getElementById('modalItemCode').textContent = item.inventoryId;
  document.getElementById('modalItemDesc').textContent = item.description;
  document.getElementById('modalExpectedLabel').textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Requested Qty');
  document.getElementById('modalExpectedQty').value = item.qty;
  document.getElementById('modalInputLabel').textContent = isMRR ? 'ATL QTY (Received)' : (isMRS ? 'ATL QTY (Actual Returned)' : 'Enter Issued Qty');
  document.getElementById('modalInputQty').value = item.qty;

  var unitSelect = document.getElementById('modalUnit');
  unitSelect.innerHTML = buildUnitOptions(item.unit || 'PIECE');

  document.getElementById('modalHint').textContent = isMRR ? 'MRR Mode: You may receive any quantity.' : (isMRS ? 'MRS Mode: Returned qty cannot exceed expected.' : 'MRIF Mode: Issued qty cannot exceed requested.');
  document.getElementById('modalInputQty').classList.remove('is-invalid');
  qtyModal.show();
}
function onQtyInput() {
  clearErrorAlert();
  document.getElementById('modalInputQty').classList.remove('is-invalid');
}
function confirmQty() {
  if (state.isLoading) return;
  if (!currentModalItem) return;
  const input = document.getElementById('modalInputQty');
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
  var selectedUnit = unitSelect.value || 'PIECE';

  currentModalItem.issuedQty = qtyVal;
  currentModalItem.unit = selectedUnit;
  currentModalItem.verified = true;
  saveDocProgress();
  renderItems();
  qtyModal.hide();
  playSuccessBeep();
}

function showMismatchAlert(code) {
  const alert = document.getElementById('mismatchAlert');
  document.getElementById('mismatchText').textContent = 'Item "' + code + '" not found in this document.';
  alert.classList.remove('d-none');
  clearTimeout(state.errorTimer);
  state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
}
function showExceedError(msg) {
  const alert = document.getElementById('exceedErrorAlert');
  document.getElementById('exceedText').textContent = 'Error: ' + msg;
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
    sel.innerHTML = '<option value="">-- Select Requestor --</option>';

    const sel3 = document.getElementById('step3Requestor');
    sel3.innerHTML = '<option value="">-- Select Requestor --</option>';

    if (data.success && data.requestors) {
      state.requestorList = data.requestors;
      data.requestors.forEach(r => {
        var opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = r.name;
        opt.dataset.department = r.department;
        sel.appendChild(opt);

        var opt3 = document.createElement('option');
        opt3.value = r.name;
        opt3.textContent = r.name;
        opt3.dataset.department = r.department;
        sel3.appendChild(opt3);
      });
    }
  } catch(err) {
    console.error('Failed to load requestor list:', err);
  }
}

function onRequestorChange() {
  const sel = document.getElementById('reqRequestor');
  const selected = sel.options[sel.selectedIndex];
  const dept = selected ? selected.dataset.department : '';
  document.getElementById('reqDepartment').value = dept || '';
}

async function lookupSofData() {
  const joNo = document.getElementById('reqJoNo').value.trim();
  if (!joNo) return;
  showLoading('Looking up JO No....');
  try {
    const url = API_URL + '?action=getSofData&joNo=' + encodeURIComponent(joNo) + '&_t=' + Date.now();
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }
    if (data.success) {
      document.getElementById('reqGemSoNo').value = data.gemSoNo || '';
      document.getElementById('reqClientName').value = data.clientName || '';
      document.getElementById('reqProject').value = data.project || '';
      showToast('JO No. found! Auto-filled SO data.', 'success');
    } else {
      document.getElementById('reqGemSoNo').value = '';
      document.getElementById('reqClientName').value = '';
      document.getElementById('reqProject').value = '';
      showToast('JO No. not found in SOF Monitoring. You can still submit.', 'warning');
    }
  } catch(err) {
    showToast('SOF lookup failed: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ─── MANUAL MRR FUNCTIONS ────────────────────────────────────────
var manualMrrModal = null;
var manualMrrItems = [];

function openManualMrrModal() {
  if (!manualMrrModal) {
    manualMrrModal = new bootstrap.Modal(document.getElementById('manualMrrModal'));
  }
  document.getElementById('manualMrrPoNo').value = '';
  document.getElementById('manualMrrDrNo').value = '';
  document.getElementById('manualMrrVendor').value = '';
  document.getElementById('manualMrrSite').value = 'GEMCOR CATMON';
  document.getElementById('manualMrrPreparedBy').value = '';
  manualMrrItems = [];
  renderManualMrrItems();
  updateManualMrrSubmitButton();
  manualMrrModal.show();
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
      '<td><input type="text" class="form-control form-control-sm manual-mrr-code" ' +
        'value="' + (it.inventoryId || '') + '" ' +
        'onchange="updateManualMrrItem(' + i + ', \'inventoryId\', this.value)" ' +
        'placeholder="Item code"></td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
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

function updateManualMrrSubmitButton() {
  var btn = document.getElementById('btnSubmitManualMrr');
  if (!btn) return;

  var drNo = document.getElementById('manualMrrDrNo').value.trim();
  var vendor = document.getElementById('manualMrrVendor').value.trim();
  var site = document.getElementById('manualMrrSite').value.trim();

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
  var poNo = document.getElementById('manualMrrPoNo').value.trim();
  var drNo = document.getElementById('manualMrrDrNo').value.trim();
  var vendor = document.getElementById('manualMrrVendor').value.trim();
  var site = document.getElementById('manualMrrSite').value.trim();
  var receivingDate = document.getElementById('manualMrrDate').value;
  var preparedBy = document.getElementById('manualMrrPreparedBy').value.trim();

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
