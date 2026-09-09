// ============================================================
// WAREHOUSE CORE FUNCTIONS (with User Login Integration)
// ============================================================

// ─── Fallback cache functions if cache.js is not loaded ──────
(function() {
  if (typeof getCache === 'undefined') {
    window.getCache = function(key) { return null; };
    window.setCache = function(key, data, ttl) { /* no-op */ };
    window.clearCache = function(key) { /* no-op */ };
    console.warn('⚠️ cache.js not loaded – caching disabled.');
  }
})();

// ─── Force all functions to be globally accessible ──────────────
(function() {
  "use strict";

  // ─── Core Functions ──────────────────────────────────────────────
  window.getCleanSheetId = function() {
    const key = 'sheetId_' + state.currentModule;
    const val = localStorage.getItem(key);
    return val ? extractSheetId(val) : '';
  };

  window.syncModuleLinks = async function() {
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
  };

  window.selectModule = async function(mod) {
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
  };

  window.updateLabels = function() {
    const isMRR = state.currentModule === 'MRR';
    const isMRS = state.currentModule === 'MRS';
    var el1 = document.getElementById('headerExpected');
    var el2 = document.getElementById('headerInput');
    if (el1) el1.textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Req. Qty');
    if (el2) el2.textContent = isMRR ? 'ATL QTY' : (isMRS ? 'ATL QTY (Actual)' : 'Issued Qty');
  };

  // ─── FETCH PENDING DOCS WITH CACHE ─────────────────────────────
  window.fetchPendingDocs = async function(forceRefresh) {
    const sheetId = getCleanSheetId();
    if (!sheetId) {
      showToast('⚠️ No Sheet ID for ' + state.currentModule + '. Please sync or enter it in Settings.', 'warning');
      return [];
    }

    const cacheKey = 'pendingDocs_' + state.currentModule + '_' + sheetId;
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached) {
        populateDocSelect(cached);
        return cached;
      }
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
      setCache(cacheKey, docs, 60000); // 1 minute cache
      populateDocSelect(docs);
      return docs;
    } catch(err) {
      console.error('[fetchPendingDocs] Error:', err);
      showToast('Failed to load documents: ' + err.message, 'danger');
      return [];
    }
  };

  window.populateDocSelect = function(docs) {
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
  };

  window.filterDocs = function() {
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
  };

  window.onDocSelect = async function(docNo) {
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
      checkIfAlreadyProcessed();
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
  };

  window.changeDocument = function() {
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
  };

  window.hideScannerSection = function() {
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.add('d-none');
  };

  window.resetDocumentState = function() {
    state.items = [];
    renderItems();
    clearErrorAlert();
  };

  window.saveDocProgress = function() {
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
  };

  window.clearDocProgress = function(docNo) {
    if (docNo) localStorage.removeItem('ivm_progress_' + docNo);
  };

  window.checkForProgress = function() {
    if (!state.currentDoc) return;
    var saved = localStorage.getItem('ivm_progress_' + state.currentDoc);
    if (saved) {
      var banner = document.getElementById('resumeBanner');
      if (banner) banner.classList.remove('d-none');
    }
  };

  window.resumeProgress = function() {
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
  };

  window.fetchDocItems = async function(docNo, docType) {
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
        selected: false,
        remarks: it.remarks || ''
      }));
      renderItems();
      startScanner();
    } catch(err) {
      console.error('[fetchDocItems] Error:', err);
      throw err;
    }
  };

  window.checkIfAlreadyProcessed = function() {
    if (state.items.length === 0) return;
    var allProcessed = state.items.every(function(item) {
      var remarks = item.remarks || '';
      return remarks === 'SERVED' || remarks === 'COMPLETE' || remarks.indexOf('SERVED') !== -1 || remarks.indexOf('COMPLETE') !== -1;
    });
    
    if (allProcessed) {
      var btn = document.getElementById('submitBtn');
      var txt = document.getElementById('submitBtnText');
      if (btn) { btn.disabled = true; btn.classList.add('opacity-50'); }
      if (txt) txt.textContent = '✅ Already Processed';
      showToast('This document has already been fully processed.', 'info');
    }
  };

  // ─── ITEM RENDERING & BATCH VERIFY ──────────────────────────────
  window.renderItems = function() {
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
  };

  window.getStatusBadge = function(item) {
    if (!item.verified) return '<span class="status-badge status-pending">PENDING</span>';
    if (state.currentModule === 'MRR') {
      return item.issuedQty >= item.qty ? '<span class="status-badge status-served">COMPLETE</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
    }
    return item.issuedQty >= item.qty ? '<span class="status-badge status-served">SERVED</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
  };

  window.filterItems = function() {
    const term = document.getElementById('itemFilter') ? document.getElementById('itemFilter').value.toLowerCase() : '';
    document.querySelectorAll('#itemsTable tr').forEach(tr => {
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(term) ? '' : 'none';
    });
  };

  window.updateSubmitButton = function(verified, total) {
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
  };

  window.toggleSelectAll = function(checked) {
    document.querySelectorAll('#itemsTable .item-select').forEach(cb => cb.checked = checked);
  };

  window.openBatchVerify = function() {
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
  };

  window.confirmBatchVerify = function() {
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
  };

  // ─── Submit ──────────────────────────────────────────────────────
  var isSubmitting = false;

  window.onSubmit = async function() {
    if (state.isLoading || isSubmitting) return;
    
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
    
    const btn = document.getElementById('submitBtn');
    const txt = document.getElementById('submitBtnText');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-50'); }
    if (txt) txt.textContent = 'Submitting...';
    isSubmitting = true;
    
    showLoading('Submitting...');
    try {
      const result = await submitTransaction(verifiedItems);
      console.log('[Submit] Result:', result);
      
      if (result && result.success === true) {
        var allComplete = true;
        var anyProcessed = false;
        state.items.forEach(function(it) {
          if (!it.verified) { allComplete = false; }
          else { anyProcessed = true; if (it.issuedQty < it.qty) allComplete = false; }
        });
        var newStatus = allComplete && anyProcessed ? 'COMPLETED' : (anyProcessed ? 'PARTIAL' : 'PENDING');
        
        try {
          var statusUrl = API_URL + '?action=updateDocStatus&docNo=' + encodeURIComponent(state.currentDoc) + '&status=' + newStatus + '&_t=' + Date.now();
          var statusRes = await fetch(statusUrl, { redirect: 'follow' });
          var statusData = await statusRes.json();
          console.log('[Submit] DOCLINKS update:', statusData);
        } catch(statusErr) {
          console.error('[Submit] DOCLINKS update error:', statusErr);
        }
        
        clearDocProgress(state.currentDoc);
        if (typeof loadWarehouseNotifications === 'function') {
          loadWarehouseNotifications();
        }
        
        if (successModal) successModal.show();
        setTimeout(function() {
          location.reload();
        }, 2000);
      } else {
        showToast('Error: ' + (result.error || 'Submission failed'), 'danger');
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50'); }
        if (txt) txt.textContent = 'Confirm & Submit';
        isSubmitting = false;
      }
    } catch(err) {
      console.error('[Submit] Error:', err);
      showToast('Submit error: ' + err.message, 'danger');
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-50'); }
      if (txt) txt.textContent = 'Confirm & Submit';
      isSubmitting = false;
    } finally {
      if (!isSubmitting) {
        hideLoading();
      }
    }
  };

  window.submitTransaction = async function(verifiedItems) {
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
  };

  // ─── PO ITEMS & MRR CREATION (with auto-suggest for missing codes) ──
  window.renderPoItems = function() {
    var noEl = document.getElementById('poDisplayNo');
    var prfEl = document.getElementById('poDisplayPrf');
    var clientEl = document.getElementById('poDisplayClient');
    if (noEl) noEl.textContent = state.currentPoNo;
    if (prfEl) prfEl.textContent = state.currentPoPrf || '-';
    if (clientEl) clientEl.textContent = state.currentPoSupplier || state.currentPoClient || '-';
    const list = document.getElementById('poItemsList');
    if (!list) return;
    
    // ─── Ensure inventory list is loaded and populate datalist ───
    if (state.requestInventoryList.length === 0) {
      loadRequestInventory().then(function() {
        populateInventoryDatalist();
      });
    } else {
      populateInventoryDatalist();
    }
    
    var hasMissing = false;
    state.poItemsData.forEach(function(item) {
      if (!item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim()) {
        hasMissing = true;
      }
    });
    
    var warning = document.getElementById('poIncompleteWarning');
    if (warning) {
      if (hasMissing) {
        warning.classList.remove('d-none');
        warning.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-2"></i>' +
          '<strong>Some items are incomplete.</strong> Please fill in the missing Item Code and Description below, or uncheck items that you cannot complete.';
      } else {
        warning.classList.add('d-none');
      }
    }
    
    list.innerHTML = state.poItemsData.map((item, idx) => {
      var isMissing = !item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim();
      var missingClass = isMissing ? 'border border-danger' : '';
      var codeVal = item.inventoryId || '';
      var descVal = item.description || '';
      
      return `
<div class="card mb-2 po-item-card ${missingClass}" id="po-card-${idx}">
<div class="card-body py-2 px-3">
<div class="d-flex align-items-center gap-2 flex-wrap">
<div class="form-check m-0">
<input class="form-check-input po-check" type="checkbox" id="po-check-${idx}" ${isMissing ? '' : 'checked'} onchange="togglePoCard(${idx})">
</div>
<div class="flex-grow-1" style="min-width:120px;">
  <div class="row g-1">
    <div class="col-12 col-md-4">
      <label class="form-label mb-0 small">Item Code</label>
      ${isMissing ? 
        `<input type="text" class="form-control form-control-sm po-edit-code" id="po-code-${idx}" value="${codeVal}" placeholder="Enter Item Code" list="inventoryCodeList" oninput="updatePoItem(${idx}, 'inventoryId', this.value)" onchange="autoFillPoDescription(${idx}, this.value)">` :
        `<div class="fw-bold small">${codeVal}</div>`
      }
    </div>
    <div class="col-12 col-md-4">
      <label class="form-label mb-0 small">Description</label>
      ${isMissing ?
        `<input type="text" class="form-control form-control-sm po-edit-desc" id="po-desc-${idx}" value="${descVal}" placeholder="Enter Description" oninput="updatePoItem(${idx}, 'description', this.value)">` :
        `<div class="text-muted small">${descVal}</div>`
      }
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label mb-0 small">PO Qty</label>
      <div class="fw-bold small">${item.qty || 0}</div>
    </div>
    <div class="col-6 col-md-2">
      <label class="form-label mb-0 small">Unit</label>
      <div class="fw-bold small">${item.unit || 'PCS'}</div>
    </div>
  </div>
  <div class="d-flex gap-2 mt-1 flex-wrap">
    <div style="min-width:80px;">
      <label class="form-label mb-0 small">ATL Qty</label>
      <input type="number" class="form-control form-control-sm" id="po-atl-${idx}" value="${item.qty || 0}" min="0" style="width:80px">
    </div>
    <div style="min-width:80px;">
      <label class="form-label mb-0 small">Unit (Override)</label>
      <select class="form-select form-select-sm" id="po-unit-${idx}" style="width:90px;">
        ${buildUnitOptions(item.unit || 'PCS')}
      </select>
    </div>
    <div style="min-width:120px; flex:1;">
      <label class="form-label mb-0 small">Remarks</label>
      <input type="text" class="form-control form-control-sm" id="po-remarks-${idx}" placeholder="Optional note..." maxlength="200">
    </div>
  </div>
</div>
${isMissing ? '<span class="badge bg-danger ms-2">Incomplete</span>' : ''}
</div>
</div>
</div>
`;
    }).join('');
    
    updateCreateMrrButton();
    
    document.querySelectorAll('.po-check').forEach(function(cb) {
      cb.addEventListener('change', updateCreateMrrButton);
    });
  };

  // ─── Populate inventory datalist for PO modal ───────────────────
  function populateInventoryDatalist() {
    var datalist = document.getElementById('inventoryCodeList');
    if (!datalist) return;
    datalist.innerHTML = '';
    var items = state.requestInventoryList || [];
    items.forEach(function(it) {
      var code = it.inventoryId || it.code || '';
      if (code) {
        var option = document.createElement('option');
        option.value = code;
        datalist.appendChild(option);
      }
    });
    console.log('[POPULATE] Inventory datalist populated with ' + items.length + ' codes.');
  }

  // ─── Auto-fill description when a code is selected from datalist ──
  window.autoFillPoDescription = function(idx, code) {
    if (!code) return;
    var match = state.requestInventoryList.find(function(it) {
      return (it.inventoryId === code || it.code === code);
    });
    if (match) {
      var descInput = document.getElementById('po-desc-' + idx);
      if (descInput && !descInput.value) {
        descInput.value = match.description || '';
        updatePoItem(idx, 'description', descInput.value);
      }
      // Also update unit if available and not already set
      var unitSelect = document.getElementById('po-unit-' + idx);
      if (unitSelect && match.unit) {
        for (var opt = 0; opt < unitSelect.options.length; opt++) {
          if (unitSelect.options[opt].value === match.unit) {
            unitSelect.selectedIndex = opt;
            break;
          }
        }
      }
    }
  };

  window.updatePoItem = function(idx, field, value) {
    if (state.poItemsData[idx]) {
      state.poItemsData[idx][field] = value.trim();
      updateCreateMrrButton();
    }
  };

  window.updateCreateMrrButton = function() {
    var btn = document.querySelector('#poItemsModal .btn-success');
    if (!btn) return;
    
    var selected = getSelectedPoItems();
    var hasMissingSelected = selected.some(function(item) {
      return !item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim();
    });
    
    if (hasMissingSelected) {
      btn.disabled = true;
      btn.title = 'Cannot create MRR: Selected items are missing Item Code or Description';
    } else if (selected.length === 0) {
      btn.disabled = true;
      btn.title = 'Please select at least one item';
    } else {
      btn.disabled = false;
      btn.title = '';
    }
  };

  window.getSelectedPoItems = function() {
    var selected = [];
    state.poItemsData.forEach(function(item, idx) {
      var cb = document.getElementById('po-check-' + idx);
      if (cb && cb.checked) {
        var atlQty = parseFloat(document.getElementById('po-atl-' + idx) ? document.getElementById('po-atl-' + idx).value : 0) || 0;
        var unit = document.getElementById('po-unit-' + idx) ? document.getElementById('po-unit-' + idx).value : 'PCS';
        var remarks = document.getElementById('po-remarks-' + idx) ? document.getElementById('po-remarks-' + idx).value : '';
        selected.push({
          inventoryId: item.inventoryId || '',
          description: item.description || '',
          qty: item.qty || 0,
          unit: unit,
          atlQty: atlQty,
          remarks: remarks
        });
      }
    });
    return selected;
  };

  window.togglePoCard = function(idx) {
    const checked = document.getElementById('po-check-' + idx) ? document.getElementById('po-check-' + idx).checked : false;
    const card = document.getElementById('po-card-' + idx);
    if (card) {
      if (checked) card.classList.remove('opacity-50');
      else card.classList.add('opacity-50');
    }
    updateCreateMrrButton();
  };

  window.selectAllPoItems = function(select) {
    state.poItemsData.forEach(function(_, idx) {
      var cb = document.getElementById('po-check-' + idx);
      if (cb) cb.checked = select;
      togglePoCard(idx);
    });
  };

  window.closePoItemsModal = function() {
    if (state.poItemsModal) state.poItemsModal.hide();
  };

  window.createMrrFromPo = async function() {
    var selected = getSelectedPoItems();
    if (selected.length === 0) {
      showToast('Please select at least one item', 'warning');
      return;
    }
    
    var hasMissing = selected.some(function(item) {
      return !item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim();
    });
    if (hasMissing) {
      showToast('Cannot create MRR: Selected items are missing Item Code or Description. Please fill in missing details or uncheck incomplete items.', 'danger');
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
        await fetchPendingDocs(true);
      } else {
        showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
      }
    } catch(err) {
      showToast('Error: ' + err.message, 'danger');
    } finally {
      hideLoading();
    }
  };

  // ─── PO Lookup (auto-suggest enabled) ────────────────────────────
  window.lookupPoItems = function() {
    var poInput = document.getElementById('poNumberInput');
    if (!poInput) return;
    var poNo = poInput.value.trim();
    if (!poNo) {
      showToast('Please enter a PO number', 'warning');
      return;
    }
    
    showLoading('Looking up PO...');
    // Ensure inventory list is loaded before showing modal
    loadRequestInventory().then(function() {
      populateInventoryDatalist();
    }).catch(function() {});
    
    fetch(API_URL + '?action=getPoItems&poNo=' + encodeURIComponent(poNo) + '&_t=' + Date.now(), { redirect: 'follow' })
      .then(function(res) { return res.text(); })
      .then(function(text) {
        var data;
        try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
        if (data.success && data.items && data.items.length > 0) {
          state.currentPoNo = poNo;
          state.currentPoPrf = data.prfNo || '';
          state.currentPoClient = data.client || '';
          state.currentPoSupplier = data.supplier || data.client || '';
          state.poItemsData = data.items;
          renderPoItems();
          if (state.poScanModal) state.poScanModal.hide();
          if (state.poItemsModal) state.poItemsModal.show();
        } else {
          showToast((data && data.error) || 'No items found for PO: ' + poNo, 'warning');
        }
        hideLoading();
      })
      .catch(function(err) {
        showToast('Error: ' + err.message, 'danger');
        hideLoading();
      });
  };

  window.manualPoLookup = function() {
    const poNo = document.getElementById('manualPoInput') ? document.getElementById('manualPoInput').value.trim() : '';
    const mrrPoNo = document.getElementById('mrrManualPoInput') ? document.getElementById('mrrManualPoInput').value.trim() : '';
    const finalPo = poNo || mrrPoNo;
    
    if (!finalPo) { showToast('Please enter a PO number', 'warning'); return; }
    
    if (document.getElementById('manualPoInput')) document.getElementById('manualPoInput').value = '';
    if (document.getElementById('mrrManualPoInput')) document.getElementById('mrrManualPoInput').value = '';
    
    showLoading('Looking up PO...');
    // Ensure inventory list is loaded before showing modal
    loadRequestInventory().then(function() {
      populateInventoryDatalist();
    }).catch(function() {});
    
    fetch(API_URL + '?action=getPoItems&poNo=' + encodeURIComponent(finalPo) + '&_t=' + Date.now(), { redirect: 'follow' })
      .then(function(res) { return res.text(); })
      .then(function(text) {
        var data;
        try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
        if (data.success && data.items && data.items.length > 0) {
          state.currentPoNo = finalPo;
          state.currentPoPrf = data.prfNo || '';
          state.currentPoClient = data.client || '';
          state.currentPoSupplier = data.supplier || data.client || '';
          state.poItemsData = data.items;
          renderPoItems();
          if (state.poScanModal) state.poScanModal.hide();
          if (state.poItemsModal) state.poItemsModal.show();
          playSuccessBeep();
        } else {
          showToast((data && data.error) || 'No items found for PO: ' + finalPo, 'warning');
        }
        hideLoading();
      })
      .catch(function(err) {
        showToast('Error: ' + err.message, 'danger');
        hideLoading();
      });
  };

  window.closePoScanModal = function() {
    if (state.poScanModal) state.poScanModal.hide();
  };

  // ─── QTY MODAL ────────────────────────────────────────────────────
  let currentModalItem = null;

  window.openQtyModal = function(item) {
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
  };

  window.onQtyInput = function() {
    clearErrorAlert();
    var el = document.getElementById('modalInputQty');
    if (el) el.classList.remove('is-invalid');
  };

  window.confirmQty = function() {
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
  };

  window.showMismatchAlert = function(code) {
    const alert = document.getElementById('mismatchAlert');
    const text = document.getElementById('mismatchText');
    if (!alert || !text) return;
    text.textContent = 'Item "' + code + '" not found in this document.';
    alert.classList.remove('d-none');
    clearTimeout(state.errorTimer);
    state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
  };

  window.showExceedError = function(msg) {
    const alert = document.getElementById('exceedErrorAlert');
    const text = document.getElementById('exceedText');
    if (!alert || !text) return;
    text.textContent = 'Error: ' + msg;
    alert.classList.remove('d-none');
    clearTimeout(state.errorTimer);
    state.errorTimer = setTimeout(() => clearErrorAlert(), 4000);
  };

  window.clearErrorAlert = function() {
    const a1 = document.getElementById('mismatchAlert');
    const a2 = document.getElementById('exceedErrorAlert');
    if (a1) a1.classList.add('d-none');
    if (a2) a2.classList.add('d-none');
  };

  // ─── CACHED LOADERS ──────────────────────────────────────────────
  window.loadRequestInventory = async function(forceRefresh) {
    const cacheKey = 'inventoryList';
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached) {
        state.requestInventoryList = cached;
        return cached;
      }
    }
    try {
      const url = API_URL + '?action=getInventoryList&_t=' + Date.now();
      const res = await fetch(url, { redirect: 'follow' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { data = {}; }
      const inv = data.inventory || data.items || [];
      state.requestInventoryList = inv;
      setCache(cacheKey, inv, 300000); // 5 minutes
      return inv;
    } catch(err) {
      state.requestInventoryList = [];
      return [];
    }
  };

  window.loadRequestorList = async function(forceRefresh) {
    const cacheKey = 'requestorList';
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached) {
        state.requestorList = cached;
        populateRequestorSelect(cached);
        return cached;
      }
    }
    try {
      const url = API_URL + '?action=getRequestorList&_t=' + Date.now();
      const res = await fetch(url, { redirect: 'follow' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { data = {}; }
      const list = data.requestors || [];
      state.requestorList = list;
      setCache(cacheKey, list, 600000); // 10 minutes
      populateRequestorSelect(list);
      return list;
    } catch(err) {
      return [];
    }
  };

  function populateRequestorSelect(list) {
    const sel = document.getElementById('reqRequestor');
    const sel3 = document.getElementById('step3Requestor');
    if (sel) {
      sel.innerHTML = '<option value="">-- Select Requestor --</option>';
      list.forEach(r => {
        var opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = r.name;
        opt.dataset.department = r.department || '';
        sel.appendChild(opt);
      });
    }
    if (sel3) {
      sel3.innerHTML = '<option value="">-- Select Requestor --</option>';
      list.forEach(r => {
        var opt = document.createElement('option');
        opt.value = r.name;
        opt.textContent = r.name;
        opt.dataset.department = r.department || '';
        sel3.appendChild(opt);
      });
    }
  }

  window.loadVendorList = async function(forceRefresh) {
    const cacheKey = 'vendorList';
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached) {
        state.vendorList = cached;
        populateDatalist('vendorDatalist', cached);
        return cached;
      }
    }
    try {
      var url = API_URL + '?action=getVendorList&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.vendors) {
        state.vendorList = data.vendors;
        setCache(cacheKey, data.vendors, 600000);
        populateDatalist('vendorDatalist', data.vendors);
        return data.vendors;
      }
      return [];
    } catch(e) { return []; }
  };

  window.loadIvmTeamList = async function(forceRefresh) {
    const cacheKey = 'ivmTeamList';
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached) {
        state.ivmTeamList = cached;
        populateDatalist('ivmTeamDatalist', cached);
        return cached;
      }
    }
    try {
      var url = API_URL + '?action=getIvmTeamList&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.members) {
        state.ivmTeamList = data.members;
        setCache(cacheKey, data.members, 600000);
        populateDatalist('ivmTeamDatalist', data.members);
        return data.members;
      }
      return [];
    } catch(e) { return []; }
  };

  // ─── DATALIST POPULATE ────────────────────────────────────────────
  window.populateDatalist = function(datalistId, items) {
    var datalist = document.getElementById(datalistId);
    if (!datalist) return;
    datalist.innerHTML = '';
    items.forEach(function(item) {
      var option = document.createElement('option');
      option.value = item;
      datalist.appendChild(option);
    });
  };

  // ─── MANUAL MRR FUNCTIONS (IMPROVED DROPDOWN) ──────────────────
  var manualMrrModal = null;
  var manualMrrItems = [];
  var _manualMrrLoading = false;

  window.openManualMrrModal = function() {
    if (!manualMrrModal) {
      manualMrrModal = new bootstrap.Modal(document.getElementById('manualMrrModal'));
    }
    // Reset fields
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

    // ─── Ensure all lists are loaded ──────────────────────────────
    if (_manualMrrLoading) {
      showToast('Loading data...', 'info');
      return;
    }
    _manualMrrLoading = true;

    // Show loading indicators in dropdowns
    var dropdowns = document.querySelectorAll('.manual-mrr-dropdown');
    dropdowns.forEach(function(d) {
      d.innerHTML = '<div class="list-group-item text-muted">Loading items...</div>';
      d.classList.remove('d-none');
    });

    // Load inventory, vendors, IVM team with forced refresh if cache is stale
    Promise.all([
      loadRequestInventory(false).then(function() {
        // After inventory loaded, update dropdowns
        document.querySelectorAll('.manual-mrr-dropdown').forEach(function(d) {
          d.classList.add('d-none');
        });
      }),
      loadVendorList(false).then(function() {
        populateDatalist('vendorDatalist', state.vendorList || []);
      }),
      loadIvmTeamList(false).then(function() {
        populateDatalist('ivmTeamDatalist', state.ivmTeamList || []);
      })
    ]).then(function() {
      _manualMrrLoading = false;
      console.log('[Manual MRR] All lists loaded');
    }).catch(function(err) {
      console.warn('[Manual MRR] Some lists failed:', err);
      _manualMrrLoading = false;
    });
  };

  window.addManualMrrItem = function() {
    manualMrrItems.push({
      inventoryId: '',
      description: '',
      qty: 1,
      atlQty: 0,
      unit: 'PIECE',
      remarks: ''
    });
    renderManualMrrItems();
    updateManualMrrSubmitButton();
    setTimeout(function() {
      var inputs = document.querySelectorAll('.manual-mrr-search');
      if (inputs.length > 0) {
        inputs[inputs.length - 1].focus();
      }
    }, 100);
  };

  window.removeManualMrrItem = function(index) {
    manualMrrItems.splice(index, 1);
    renderManualMrrItems();
    updateManualMrrSubmitButton();
  };

  window.updateManualMrrItem = function(index, field, value) {
    if (manualMrrItems[index]) {
      manualMrrItems[index][field] = value;
    }
    updateManualMrrSubmitButton();
  };

  window.renderManualMrrItems = function() {
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
          '<div style="position:relative;width:100%;">' +
            '<input type="text" class="form-control form-control-sm manual-mrr-search" ' +
              'placeholder="Type to search..." ' +
              'value="' + (it.inventoryId ? it.inventoryId + ' - ' + it.description : '') + '" ' +
              'oninput="filterManualMrrItems(this, ' + i + ')" ' +
              'onfocus="filterManualMrrItems(this, ' + i + ')" ' +
              'onclick="this.select();filterManualMrrItems(this, ' + i + ')" ' +
              'autocomplete="off" ' +
              'style="width:100%;min-width:150px;">' +
            '<div class="list-group position-absolute z-3 d-none manual-mrr-dropdown" ' +
              'style="max-height:300px;overflow-y:auto;width:100%;min-width:250px;background:#fff;border:1px solid #ced4da;border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,0.18);position:absolute;top:100%;left:0;z-index:9999;margin-top:2px;padding:4px 0;" ' +
              'id="manualMrrDropdown' + i + '"></div>' +
            '<input type="hidden" class="manual-mrr-code" id="manualMrrCode' + i + '" value="' + (it.inventoryId || '') + '">' +
            '<input type="hidden" class="manual-mrr-desc" id="manualMrrDesc' + i + '" value="' + (it.description || '') + '">' +
          '</div>' +
        '</td>' +
        '<td><input type="text" class="form-control form-control-sm manual-mrr-desc-text" ' +
          'id="manualMrrDescText' + i + '" ' +
          'value="' + (it.description || '') + '" ' +
          'onchange="updateManualMrrItem(' + i + ', \'description\', this.value)" ' +
          'placeholder="Description" style="min-width:120px;"></td>' +
        '<td><input type="number" class="form-control form-control-sm text-center" ' +
          'value="' + (it.qty || 0) + '" ' +
          'onchange="updateManualMrrItem(' + i + ', \'qty\', parseFloat(this.value)||0)" ' +
          'min="0" step="0.01" style="width:70px;"></td>' +
        '<td><input type="number" class="form-control form-control-sm text-center" ' +
          'value="' + (it.atlQty || 0) + '" ' +
          'onchange="updateManualMrrItem(' + i + ', \'atlQty\', parseFloat(this.value)||0)" ' +
          'min="0" step="0.01" style="width:70px;"></td>' +
        '<td><select class="form-select form-select-sm manual-mrr-unit" ' +
          'onchange="updateManualMrrItem(' + i + ', \'unit\', this.value)" style="width:85px;">' +
          buildUnitOptions(it.unit || 'PIECE') +
        '</select></td>' +
        '<td><input type="text" class="form-control form-control-sm" ' +
          'value="' + (it.remarks || '') + '" ' +
          'onchange="updateManualMrrItem(' + i + ', \'remarks\', this.value)" ' +
          'placeholder="Remarks" maxlength="200" style="min-width:100px;"></td>' +
        '<td class="align-middle text-center">' +
          '<button class="btn btn-sm btn-outline-danger" onclick="removeManualMrrItem(' + i + ')" title="Remove">' +
            '<i class="bi bi-trash"></i>' +
          '</button>' +
        '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  };

  // ─── Custom dropdown filter for Manual MRR (improved) ──────────
  window.filterManualMrrItems = function(input, idx) {
    var term = input.value.toLowerCase();
    var dropdown = document.getElementById('manualMrrDropdown' + idx);
    dropdown.innerHTML = '';

    if (!term) {
      dropdown.classList.add('d-none');
      return;
    }

    // If inventory list is still loading, show loading message
    if (state.requestInventoryList.length === 0) {
      dropdown.innerHTML = '<div class="list-group-item text-muted" style="padding:8px 12px;">Loading inventory...</div>';
      dropdown.classList.remove('d-none');
      return;
    }

    var matches = state.requestInventoryList.filter(function(it) {
      var code = (it.code || it.inventoryId || '').toLowerCase();
      var desc = (it.description || '').toLowerCase();
      return code.includes(term) || desc.includes(term);
    }).slice(0, 20);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="list-group-item text-muted" style="padding:8px 12px;">No matches found</div>';
    } else {
      matches.forEach(function(it) {
        var code = it.code || it.inventoryId || '';
        var desc = it.description || '';
        var unit = it.unit || 'PIECE';
        var el = document.createElement('div');
        el.className = 'list-group-item list-group-item-action';
        el.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:0.9rem;border-bottom:1px solid #f0f0f0;transition:background 0.15s;';
        el.innerHTML = '<div class="fw-bold" style="color:#1e3a5f;">' + code + '</div><div class="text-muted small">' + desc + ' <span class="badge bg-light text-dark">' + unit + '</span></div>';
        el.onmouseover = function() { this.style.background = '#e8f0fe'; };
        el.onmouseout = function() { this.style.background = ''; };
        el.onclick = function() {
          selectManualMrrItem(idx, code, desc, unit);
          dropdown.classList.add('d-none');
        };
        dropdown.appendChild(el);
      });
    }
    dropdown.classList.remove('d-none');
  };

  window.selectManualMrrItem = function(idx, code, desc, unit) {
    manualMrrItems[idx].inventoryId = code;
    manualMrrItems[idx].description = desc;
    manualMrrItems[idx].unit = unit || 'PIECE';

    var row = document.querySelector('#manualMrrItemsBody tr:nth-child(' + (idx + 1) + ')');
    if (row) {
      var searchInput = row.querySelector('.manual-mrr-search');
      if (searchInput) searchInput.value = code + ' - ' + desc;
      var descInput = row.querySelector('.manual-mrr-desc-text');
      if (descInput) descInput.value = desc;
      var unitSelect = row.querySelector('.manual-mrr-unit');
      if (unitSelect) {
        for (var opt = 0; opt < unitSelect.options.length; opt++) {
          if (unitSelect.options[opt].value === unit) {
            unitSelect.selectedIndex = opt;
            break;
          }
        }
      }
      var codeHidden = document.getElementById('manualMrrCode' + idx);
      var descHidden = document.getElementById('manualMrrDesc' + idx);
      if (codeHidden) codeHidden.value = code;
      if (descHidden) descHidden.value = desc;
    }

    updateManualMrrSubmitButton();
    playSuccessBeep();
    // Close dropdown
    var dropdown = document.getElementById('manualMrrDropdown' + idx);
    if (dropdown) dropdown.classList.add('d-none');
  };

  window.updateManualMrrSubmitButton = function() {
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
  };

  window.submitManualMrr = async function() {
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
          unit: it.unit || 'PIECE',
          remarks: it.remarks || ''
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
        await fetchPendingDocs(true);
        await updateWarehouseKPIs();
      } else {
        showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
      }
    } catch(err) {
      showToast('Error: ' + err.message, 'danger');
    } finally {
      hideLoading();
    }
  };

  // ─── QUICK ACTIONS ────────────────────────────────────────────────
  window.quickProcessPending = async function() {
    if (state.isLoading) return;
    
    var statusEl = document.getElementById('quickActionStatus');
    if (statusEl) statusEl.textContent = '⏳ Looking for next pending...';
    
    try {
      await selectModule('MRIF');
      var docs = await fetchPendingDocs(true);
      
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
  };

  window.quickNewMrr = function() {
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
  };

  window.quickNewMrif = function() {
    openManualMrifModal();
  };

  // ─── PARTIAL ITEMS FUNCTIONS ────────────────────────────────────
  window.fetchPartialItems = async function() {
    try {
      var url = API_URL + '?action=getPartialItems&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var data = await res.json();
      console.log('[Partial Items] Response:', data);
      if (data.success) {
        return data.items || [];
      } else {
        console.warn('[Partial Items] Error:', data.error);
        return [];
      }
    } catch(err) {
      console.error('[Partial Items] Error:', err);
      return [];
    }
  };

  window.openPartialItemsModal = async function() {
    var modalEl = document.getElementById('partialItemsModal');
    if (!modalEl) {
      showToast('Partial Items modal not found', 'danger');
      return;
    }
    var modal = new bootstrap.Modal(modalEl);
    var container = document.getElementById('partialItemsList');
    if (container) {
      container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="text-muted mt-2">Loading partial items...</div></div>';
    }
    modal.show();

    try {
      var items = await fetchPartialItems();
      if (container) {
        if (items.length === 0) {
          container.innerHTML = '<div class="list-group-item text-muted text-center py-4">No partial items found. All items are fully served or pending.</div>';
        } else {
          var html = '';
          items.forEach(function(it, idx) {
            var statusBadge = it.remarks || 'PARTIAL';
            var badgeColor = 'warning';
            if (statusBadge.indexOf('SERVED') !== -1) badgeColor = 'success';
            else if (statusBadge.indexOf('PENDING') !== -1) badgeColor = 'secondary';
            html += '<div class="list-group-item">' +
              '<div class="d-flex justify-content-between align-items-start">' +
                '<div>' +
                  '<div class="fw-bold">' + it.docNo + '</div>' +
                  '<div><code>' + it.itemCode + '</code> – ' + it.description + '</div>' +
                  '<div class="small text-muted">Requested: ' + it.requestedQty + ' | Issued: ' + it.issuedQty + ' | Unit: ' + it.unit + '</div>' +
                '</div>' +
                '<span class="badge bg-' + badgeColor + '">' + statusBadge + '</span>' +
              '</div>' +
            '</div>';
          });
          container.innerHTML = html;
          // Add click handler to open the document for each item
          container.querySelectorAll('.list-group-item').forEach(function(el) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function() {
              var docNo = this.querySelector('.fw-bold').textContent;
              if (docNo) {
                modal.hide();
                selectModule('MRIF').then(function() {
                  onDocSelect(docNo);
                }).catch(function(err) {
                  showToast('Error loading document: ' + err.message, 'danger');
                });
              }
            });
          });
        }
      }
    } catch(err) {
      if (container) container.innerHTML = '<div class="list-group-item text-danger text-center py-4">Failed to load partial items: ' + err.message + '</div>';
    }
  };

  // ─── UPDATE PARTIAL COUNT ────────────────────────────────────────
  window.updatePartialCount = async function() {
    try {
      var items = await fetchPartialItems();
      var count = items.length;
      var el = document.getElementById('kpiPartial');
      if (el) el.textContent = count;
    } catch(err) {
      console.warn('[Partial Count] Error:', err);
    }
  };

  console.log('✅ warehouse.js loaded (with preload improvements, partial items, and PO auto-suggest)');

})(); // end IIFE
