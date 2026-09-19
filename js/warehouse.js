// ============================================================
// WAREHOUSE CORE FUNCTIONS
// (Partial Items + Balance MRIF + Prefill Manual MRR
//  + Reprocess Guard via DOCLINKS + Idempotency on writes
//  + Prep Status color coding on document dropdown
//  + Clear/Edit PO Items + Restore PO Items)
// ============================================================

(function() {
  if (typeof getCache === 'undefined') {
    window.getCache = function() { return null; };
    window.setCache = function() {};
    window.clearCache = function() {};
  }
})();

(function() {
  "use strict";

  function _getCurrentUserName() {
    return state.currentUserFullname || state.currentUser || '';
  }

  var _originalPoItems = null;

  window._saveOriginalPoItems = function() {
    try {
      _originalPoItems = JSON.parse(JSON.stringify(state.poItemsData || []));
    } catch(e) { _originalPoItems = []; }
  };

  // ═══════════════════════════════════════════════════════════
  // PREP STATUS CACHE (60s) + helpers
  // ═══════════════════════════════════════════════════════════
  window._prepStatusCache = null;
  window._prepStatusFetchedAt = 0;
  window._prepStatusFetching = null;

  window.fetchPrepStatusesCached = async function(forceRefresh) {
    var now = Date.now();
    if (!forceRefresh && window._prepStatusCache && (now - window._prepStatusFetchedAt) < 60000) {
      return window._prepStatusCache;
    }
    if (window._prepStatusFetching) return window._prepStatusFetching;

    window._prepStatusFetching = (async function() {
      try {
        var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
        var url = API_URL + '?action=getPrepStatuses&_t=' + Date.now();
        var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 15000, retries: 1 });
        var text = await res.text();
        var data = JSON.parse(text);
        window._prepStatusCache = (data && data.success && data.statuses) ? data.statuses : {};
        window._prepStatusFetchedAt = Date.now();
        return window._prepStatusCache;
      } catch(e) {
        console.warn('[fetchPrepStatusesCached] failed:', e);
        if (!window._prepStatusCache) window._prepStatusCache = {};
        return window._prepStatusCache;
      } finally {
        window._prepStatusFetching = null;
      }
    })();
    return window._prepStatusFetching;
  };

  function _prepStatusOf(docNo) {
    var map = window._prepStatusCache || {};
    var entry = map[docNo];
    var s = entry ? String(entry.prepStatus || 'NEW').toUpperCase() : 'NEW';
    if (s !== 'PREPARED' && s !== 'PICKED_UP') s = 'NEW';
    return s;
  }
  function _prepEmojiOf(s) {
    if (s === 'PREPARED') return '🟢';
    if (s === 'PICKED_UP') return '🟡';
    return '🔴';
  }
  function _prepBgOf(s) {
    if (s === 'PREPARED') return '#f4fbf7';
    if (s === 'PICKED_UP') return '#fffaf0';
    return '#fff5f5';
  }
  function _prepFgOf(s) {
    if (s === 'PREPARED') return '#145c32';
    if (s === 'PICKED_UP') return '#8a6100';
    return '#a71d2a';
  }
  function _prepBorderOf(s) {
    if (s === 'PREPARED') return '#198754';
    if (s === 'PICKED_UP') return '#ffc107';
    return '#dc3545';
  }
  window._prepStatusOf = _prepStatusOf;
  window._prepEmojiOf = _prepEmojiOf;
  window._prepBgOf = _prepBgOf;
  window._prepFgOf = _prepFgOf;
  window._prepBorderOf = _prepBorderOf;

  // ─── Manual refresh button handler ───
  window.refreshPrepColorsNow = async function(btn) {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    }
    try {
      await fetchPrepStatusesCached(true);
      if (state.docList && state.docList.length) {
        await populateDocSelect(state.docList);
      }
      var sel = document.getElementById('docSelect');
      if (sel && sel.value) {
        var prep = _prepStatusOf(sel.value);
        sel.style.background = _prepBgOf(prep);
        sel.style.color = _prepFgOf(prep);
        sel.style.borderLeft = '4px solid ' + _prepBorderOf(prep);
      }
      if (typeof showToast === 'function') showToast('Prep colors refreshed', 'success');
    } catch(e) {
      if (typeof showToast === 'function') showToast('Failed: ' + e.message, 'danger');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-palette"></i>';
      }
    }
  };

  // ─── Core ──────────────────────────────────────────────
  window.getCleanSheetId = function() {
    var key = 'sheetId_' + state.currentModule;
    var val = localStorage.getItem(key);
    return val ? extractSheetId(val) : '';
  };

  window.syncModuleLinks = async function() {
    if (state.isLoading) return;
    showBlockingLoading('Syncing...');
    try {
      var url = API_URL + '?action=getModuleLinks&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) {
        showToast('Sync error: Invalid response', 'danger');
        return;
      }
      if (data && data.success && data.links) {
        var links = data.links;
        var MRIF = links.MRIF || links.mrif || '';
        var MRR = links.MRR || links.mrr || '';
        var MRS = links.MRS || links.mrs || '';
        if (MRIF) { localStorage.setItem('sheetId_MRIF', extractSheetId(MRIF)); var el = document.getElementById('sheetId_MRIF'); if (el) el.value = extractSheetId(MRIF); }
        if (MRR) { localStorage.setItem('sheetId_MRR', extractSheetId(MRR)); var el2 = document.getElementById('sheetId_MRR'); if (el2) el2.value = extractSheetId(MRR); }
        if (MRS) { localStorage.setItem('sheetId_MRS', extractSheetId(MRS)); var el3 = document.getElementById('sheetId_MRS'); if (el3) el3.value = extractSheetId(MRS); }
        showToast('Module IDs synced!', 'success');
        if (state.currentModule) selectModule(state.currentModule);
      } else {
        showToast('Sync failed: ' + (data.error || 'No links found'), 'danger');
      }
    } catch(err) {
      showToast('Sync error: ' + err.message, 'danger');
    } finally {
      hideLoading();
    }
  };

  window.selectModule = async function(mod) {
    state.currentModule = mod;
    document.querySelectorAll('.module-btn').forEach(function(b) { b.classList.remove('active'); });
    var btn = document.querySelector('.module-btn[data-module="' + mod + '"]');
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
  };

  window.updateLabels = function() {
    var isMRR = state.currentModule === 'MRR';
    var isMRS = state.currentModule === 'MRS';
    var el1 = document.getElementById('headerExpected');
    var el2 = document.getElementById('headerInput');
    if (el1) el1.textContent = isMRR ? 'REC. QTY' : (isMRS ? 'QTY RETURNED' : 'Req. Qty');
    if (el2) el2.textContent = isMRR ? 'ATL QTY' : (isMRS ? 'ATL QTY (Actual)' : 'Issued Qty');
  };

  async function _fetchPendingDocsFromServer(sheetId) {
    var url = API_URL + '?action=getPendingDocs&docType=' + state.currentModule +
              '&sheetId=' + sheetId + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { data = []; }
    return Array.isArray(data) ? data : (data.docs || data.documents || []);
  }

  window.fetchPendingDocs = async function(forceRefresh) {
    var sheetId = getCleanSheetId();
    if (!sheetId) return [];
    var cacheKey = 'pendingDocs_' + state.currentModule + '_' + sheetId;
    if (!forceRefresh) {
      var cached = getCache(cacheKey);
      if (cached) {
        fetchPrepStatusesCached(false).then(function() { populateDocSelect(cached); });
        _fetchPendingDocsFromServer(sheetId).then(function(docs) {
          setCache(cacheKey, docs, 5 * 60 * 1000);
          var sel = document.getElementById('docSelect');
          if (sel && document.activeElement !== sel) {
            fetchPrepStatusesCached(false).then(function() { populateDocSelect(docs); });
          }
        }).catch(function() {});
        return cached;
      }
    }
    try {
      var docs = await _fetchPendingDocsFromServer(sheetId);
      setCache(cacheKey, docs, 5 * 60 * 1000);
      await fetchPrepStatusesCached(forceRefresh);
      await populateDocSelect(docs);
      return docs;
    } catch(err) {
      showToast('Failed to load documents: ' + err.message, 'danger');
      return [];
    }
  };

  window.populateDocSelect = async function(docs) {
    var sel = document.getElementById('docSelect');
    if (!sel) return;
    state.docList = docs;

    // Fetch prep statuses first (async, cached 60s)
    try { await fetchPrepStatusesCached(); } catch(e) {}

    // Sort: newest first (by trailing number), Bal docs next to parent
    docs.sort(function(a, b) {
      var na = (typeof a === 'string' ? a : (a.docNo || a.name || '')).toUpperCase();
      var nb = (typeof b === 'string' ? b : (b.docNo || b.name || '')).toUpperCase();
      var numA = 0, numB = 0;
      var ma = na.match(/(\d{4,})/); if (ma) numA = parseInt(ma[1], 10);
      var mb = nb.match(/(\d{4,})/); if (mb) numB = parseInt(mb[1], 10);
      if (numA !== numB) return numB - numA;
      var isBalA = na.indexOf('BAL.') === 0 ? 1 : 0;
      var isBalB = nb.indexOf('BAL.') === 0 ? 1 : 0;
      if (isBalA !== isBalB) return isBalA - isBalB;
      return nb.localeCompare(na);
    });

    var html = '<option value="">-- Select Document --</option>';
    docs.forEach(function(d) {
      var val = typeof d === 'string' ? d : (d.docNo || d.name || d);
      var display = cleanDocNo(val);
      var prep = _prepStatusOf(val);
      var emoji = _prepEmojiOf(prep);
      var bg = _prepBgOf(prep);
      var fg = _prepFgOf(prep);

      html += '<option value="' + val + '"' +
        ' style="background-color:' + bg + '; color:' + fg + '; font-weight:600;"' +
        ' data-prep="' + prep + '"' +
        '>' + emoji + ' ' + display + '</option>';
    });
    sel.innerHTML = html;
  };

  window.filterDocs = function() {
    var term = document.getElementById('docSearch') ? document.getElementById('docSearch').value.toLowerCase() : '';
    var sel = document.getElementById('docSelect');
    if (!sel) return;
    var html = '<option value="">-- Select Document --</option>';
    if (!state.docList) { sel.innerHTML = html; return; }
    state.docList.forEach(function(d) {
      var val = typeof d === 'string' ? d : (d.docNo || d.name || d);
      if (cleanDocNo(val).toLowerCase().indexOf(term) !== -1) {
        var prep = _prepStatusOf(val);
        var emoji = _prepEmojiOf(prep);
        var bg = _prepBgOf(prep);
        var fg = _prepFgOf(prep);
        html += '<option value="' + val + '"' +
          ' style="background-color:' + bg + '; color:' + fg + '; font-weight:600;"' +
          ' data-prep="' + prep + '"' +
          '>' + emoji + ' ' + cleanDocNo(val) + '</option>';
      }
    });
    sel.innerHTML = html;
  };

  window.debouncedFilterDocs = debounce(filterDocs, 150);
  window.debouncedFilterItems = debounce(function() {
    var term = document.getElementById('itemFilter') ? document.getElementById('itemFilter').value.toLowerCase() : '';
    document.querySelectorAll('#itemsTable tr').forEach(function(tr) {
      var text = tr.textContent.toLowerCase();
      tr.style.display = text.indexOf(term) !== -1 ? '' : 'none';
    });
  }, 120);

  window.onDocSelect = async function(docNo) {
    if (!docNo) { hideScannerSection(); return; }
    clearErrorAlert();
    resetDocumentState();
    state.currentDoc = docNo;
    var picker = document.getElementById('docPickerSection');
    if (picker) picker.classList.add('d-none');
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.remove('d-none');
    var title = document.getElementById('docTitle');
    if (title) title.textContent = cleanDocNo(docNo);

    // Color the select to match the currently selected doc's prep status
    var sel = document.getElementById('docSelect');
    if (sel) {
      var prep = _prepStatusOf(docNo);
      sel.style.background = _prepBgOf(prep);
      sel.style.color = _prepFgOf(prep);
      sel.style.fontWeight = '600';
      sel.style.borderLeft = '4px solid ' + _prepBorderOf(prep);
    }

    showLoading('Loading document...');
    try {
      await fetchDocItems(docNo, state.currentModule);
      checkForProgress();
      await checkIfAlreadyProcessed();
    } catch(err) {
      showToast('Failed to load document: ' + err.message, 'danger');
    } finally {
      hideLoading();
    }
  };

  window.changeDocument = function() {
    if (state.currentDoc) { saveDocProgress(); clearDocProgress(state.currentDoc); }
    state.currentDoc = null;
    resetDocumentState();
    stopScanner();

    var oldBanner = document.getElementById('alreadyProcessedBanner');
    if (oldBanner && oldBanner.parentNode) oldBanner.parentNode.removeChild(oldBanner);

    var scannerContainer = document.querySelector('#activeTransactionSection .scanner-container');
    if (scannerContainer) scannerContainer.style.display = '';
    var manualInput = document.getElementById('manualInput');
    if (manualInput) {
      var group = manualInput.closest('.input-group');
      if (group) group.style.display = '';
    }

    var picker = document.getElementById('docPickerSection');
    if (picker) picker.classList.remove('d-none');
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.add('d-none');
    var sel = document.getElementById('docSelect');
    if (sel) {
      sel.value = '';
      sel.style.background = '';
      sel.style.color = '';
      sel.style.fontWeight = '';
      sel.style.borderLeft = '';
    }
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
      var verified = state.items.filter(function(i) { return i.verified; }).length;
      if (verified > 0) {
        localStorage.setItem('ivm_progress_' + state.currentDoc, JSON.stringify({
          module: state.currentModule, items: state.items, savedAt: new Date().toISOString()
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
    var sheetId = getCleanSheetId();
    if (!sheetId) throw new Error('No Sheet ID');
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
              '&docType=' + docType + '&sheetId=' + sheetId + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
    if (data.error) throw new Error(data.error);
    if (!data.success) throw new Error(data.error || 'Failed to load document');
    var items = Array.isArray(data) ? data : (data.items || []);
    state.items = items.map(function(it, idx) {
      return {
        inventoryId: it.inventoryId || it.code || it.itemCode || '',
        description: it.description || it.desc || '',
        qty: Number(it.qty || it.requestedQty || it.expectedQty || 0),
        issuedQty: Number(it.issuedQty || it.actualQty || 0),
        unit: it.unit || 'PIECE',
        rowIndex: it.rowIndex || (idx + 13),
        verified: false,
        selected: false,
        remarks: it.remarks || ''
      };
    });
    renderItems();
    startScanner();
  };

  // ─── Reprocess guard ───
  window.checkIfAlreadyProcessed = async function() {
    if (state.items.length === 0) return;

    try {
      var docStatus = null;
      if (state.currentDoc) {
        var statusUrl = API_URL + '?action=getDocStatus&docNo=' + encodeURIComponent(state.currentDoc) + '&_t=' + Date.now();
        var res = await fetch(statusUrl, { redirect: 'follow' });
        var text = await res.text();
        var data;
        try { data = JSON.parse(text); } catch(e) {}
        if (data && data.success) docStatus = data.status;
      }
      if (docStatus === 'COMPLETED') {
        _blockReprocessing('This document has already been fully processed (status: COMPLETED).');
        return;
      }
    } catch(e) {
      console.warn('[checkIfAlreadyProcessed] Status check failed, falling back to remarks:', e);
    }

    var allDone = state.items.every(function(item) {
      var r = String(item.remarks || '').toUpperCase();
      return r.indexOf('SERVED') !== -1 ||
             r.indexOf('COMPLETE') !== -1 ||
             r.indexOf('BALANCED') !== -1;
    });

    if (allDone) {
      _blockReprocessing('This document has already been fully processed. All items are SERVED/COMPLETE/BALANCED.');
    } else {
      var oldBanner = document.getElementById('alreadyProcessedBanner');
      if (oldBanner && oldBanner.parentNode) oldBanner.parentNode.removeChild(oldBanner);
      var btn = document.getElementById('submitBtn');
      var txt = document.getElementById('submitBtnText');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
        btn.style.pointerEvents = '';
      }
      if (txt) txt.textContent = 'Confirm & Submit';
      var scannerContainer = document.querySelector('#activeTransactionSection .scanner-container');
      if (scannerContainer) scannerContainer.style.display = '';
      var manualInput = document.getElementById('manualInput');
      if (manualInput) {
        var group = manualInput.closest('.input-group');
        if (group) group.style.display = '';
      }
      try { startScanner(); } catch(e) {}
    }
  };

  function _blockReprocessing(msg) {
    var btn = document.getElementById('submitBtn');
    var txt = document.getElementById('submitBtnText');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('opacity-50');
      btn.style.pointerEvents = 'none';
    }
    if (txt) txt.textContent = '✅ Already Processed';

    try { stopScanner(); } catch(e) {}

    var scannerContainer = document.querySelector('#activeTransactionSection .scanner-container');
    if (scannerContainer) scannerContainer.style.display = 'none';
    var manualInput = document.getElementById('manualInput');
    if (manualInput) {
      var group = manualInput.closest('.input-group');
      if (group) group.style.display = 'none';
    }

    document.querySelectorAll('#activeTransactionSection button').forEach(function(b) {
      var onclick = b.getAttribute('onclick') || '';
      if (onclick.indexOf('openBatchVerify') !== -1 || onclick.indexOf('toggleSelectAll') !== -1) {
        b.disabled = true;
        b.classList.add('opacity-50');
      }
    });

    var existing = document.getElementById('alreadyProcessedBanner');
    if (!existing) {
      var banner = document.createElement('div');
      banner.id = 'alreadyProcessedBanner';
      banner.className = 'alert alert-success mt-3 d-flex align-items-center gap-2';
      banner.innerHTML =
        '<i class="bi bi-check-circle-fill" style="font-size:1.5rem;"></i>' +
        '<div><strong>' + msg + '</strong><br>' +
        '<small class="text-muted">Reprocessing is blocked to prevent duplicate transactions.</small></div>';
      var section = document.getElementById('activeTransactionSection');
      if (section) section.appendChild(banner);
    }

    showToast(msg, 'info');
  }

  window.renderItems = function() {
    var tbody = document.getElementById('itemsTable');
    if (!tbody) return;
    var html = '';
    var verified = 0;
    state.items.forEach(function(item, idx) {
      if (item.verified) verified++;
      html += '<tr class="item-row' + (item.verified ? ' verified' : '') + '" data-index="' + idx + '" style="cursor:pointer;">' +
        '<td><input type="checkbox" class="item-select" data-index="' + idx + '" ' + (item.selected ? 'checked' : '') + ' onclick="event.stopPropagation();"></td>' +
        '<td><div class="fw-bold small">' + item.inventoryId + '</div><div class="text-muted small">' + item.description + '</div></td>' +
        '<td class="text-center">' + item.qty + '</td>' +
        '<td class="text-center fw-bold">' + (item.verified ? item.issuedQty : '-') + '</td>' +
        '<td class="text-center">' + (item.unit || 'PIECE') + '</td>' +
        '<td>' + getStatusBadge(item) + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
    tbody.querySelectorAll('tr').forEach(function(tr) {
      tr.addEventListener('click', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        var index = parseInt(this.getAttribute('data-index'), 10);
        var item = state.items[index];
        if (item) openQtyModal(item);
      });
    });
    var countEl = document.getElementById('verifyCount');
    if (countEl) countEl.textContent = verified + '/' + state.items.length + ' Verified';
    var countElBottom = document.getElementById('verifyCountBottom');
    if (countElBottom) countElBottom.textContent = verified + '/' + state.items.length + ' Verified';
    updateSubmitButton(verified, state.items.length);
  };

  window.getStatusBadge = function(item) {
    if (!item.verified) return '<span class="status-badge status-pending">PENDING</span>';
    if (state.currentModule === 'MRR') {
      return item.issuedQty >= item.qty ? '<span class="status-badge status-served">COMPLETE</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
    }
    return item.issuedQty >= item.qty ? '<span class="status-badge status-served">SERVED</span>' : '<span class="status-badge status-partial">PARTIAL</span>';
  };

  window.filterItems = function() { window.debouncedFilterItems(); };

  window.updateSubmitButton = function(verified, total) {
    var btn = document.getElementById('submitBtn');
    var txt = document.getElementById('submitBtnText');
    if (!btn || !txt) return;
    if (document.getElementById('alreadyProcessedBanner')) return;
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
    document.querySelectorAll('#itemsTable .item-select').forEach(function(cb) { cb.checked = checked; });
  };

  window.openBatchVerify = function() {
    var selected = document.querySelectorAll('#itemsTable .item-select:checked');
    if (selected.length === 0) { showToast('Please select at least one item', 'warning'); return; }
    var countEl = document.getElementById('batchCount');
    var unitEl = document.getElementById('batchUnit');
    var qtyEl = document.getElementById('batchQtyInput');
    if (countEl) countEl.textContent = selected.length;
    var firstRow = selected[0].closest('tr');
    var unitCell = firstRow ? firstRow.querySelector('td:nth-child(5)') : null;
    var unit = unitCell ? unitCell.textContent.trim() : 'PIECE';
    if (unitEl) unitEl.textContent = unit;
    if (qtyEl) { qtyEl.value = ''; qtyEl.dataset.unit = unit; }
    if (batchVerifyModal) batchVerifyModal.show();
  };

  window.confirmBatchVerify = function() {
    var qtyInput = document.getElementById('batchQtyInput');
    if (!qtyInput) return;
    var qtyVal = parseInt(qtyInput.value, 10);
    if (isNaN(qtyVal) || qtyVal < 0) { showToast('Enter a valid quantity', 'warning'); return; }
    var unit = qtyInput.dataset.unit || 'PIECE';
    var selectedRows = document.querySelectorAll('#itemsTable .item-select:checked');
    selectedRows.forEach(function(cb) {
      var idx = parseInt(cb.dataset.index, 10);
      var item = state.items[idx];
      if (!item) return;
      var isMRR = state.currentModule === 'MRR';
      var finalQty = isMRR ? qtyVal : Math.min(qtyVal, item.qty);
      item.issuedQty = finalQty;
      item.unit = unit;
      item.verified = true;
    });
    if (batchVerifyModal) batchVerifyModal.hide();
    renderItems();
    showToast('Batch verify completed', 'success');
  };

  var isSubmitting = false;

  window.onSubmit = function() {
    var btn = document.getElementById('submitBtn');
    return withButtonLoading(btn, async function() {
      if (isSubmitting) return;

      var allDone = state.items.length > 0 && state.items.every(function(item) {
        var r = String(item.remarks || '').toUpperCase();
        return r.indexOf('SERVED') !== -1 || r.indexOf('COMPLETE') !== -1 || r.indexOf('BALANCED') !== -1;
      });
      if (allDone) {
        showToast('This document has already been fully processed.', 'warning');
        return;
      }

      var verifiedItems = state.items.filter(function(i) {
        if (!i.verified) return false;
        var r = String(i.remarks || '').toUpperCase();
        if (r.indexOf('SERVED') !== -1 || r.indexOf('COMPLETE') !== -1 || r.indexOf('BALANCED') !== -1) return false;
        return true;
      });

      var total = state.items.length;
      var verified = verifiedItems.length;

      if (verified === 0) {
        if (state.items.some(function(i) { return i.verified; })) {
          showToast('All verified items are already SERVED/COMPLETE/BALANCED.', 'info');
        } else {
          showToast('No items verified.', 'warning');
        }
        return;
      }

      if (verified < total) {
        if (!confirm('You have ' + (total - verified) + ' unverified item(s). Submit partial transaction now?\nOnly newly-verified items will be sent.')) return;
      }

      isSubmitting = true;
      try {
        var result = await submitTransaction(verifiedItems);
        if (result && result.success) {
          var allComplete = true;
          var anyProcessed = false;
          state.items.forEach(function(it) {
            if (!it.verified) { allComplete = false; }
            else {
              anyProcessed = true;
              if (it.issuedQty < it.qty) allComplete = false;
            }
          });
          var newStatus = allComplete && anyProcessed ? 'COMPLETED' : (anyProcessed ? 'PARTIAL' : 'PENDING');
          var statusUrl = API_URL + '?action=updateDocStatus&docNo=' + encodeURIComponent(state.currentDoc) + '&status=' + newStatus + '&_t=' + Date.now();
          fetch(statusUrl, { redirect: 'follow' }).catch(function() {});
          clearDocProgress(state.currentDoc);
          if (successModal) successModal.show();
          setTimeout(function() {
            if (successModal) successModal.hide();
            changeDocument();
            isSubmitting = false;
            if (typeof fetchPendingDocs === 'function') fetchPendingDocs(true);
            if (typeof loadWarehouseNotifications === 'function') loadWarehouseNotifications();
            if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
            if (typeof updatePartialCount === 'function') updatePartialCount();
          }, 1500);
        } else {
          var errMsg = (result && result.error) ? result.error : 'Submission failed';
          showToast(errMsg, 'danger');
          isSubmitting = false;
        }
      } catch(err) {
        showToast('Submit error: ' + err.message, 'danger');
        isSubmitting = false;
      }
    }, 'Submitting...');
  };

  window.submitTransaction = async function(verifiedItems) {
    var idemKey = 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

    var itemsStr = verifiedItems.map(function(i) {
      return encodeURIComponent(i.inventoryId) + ',' + i.issuedQty + ',' + i.rowIndex + ',' + encodeURIComponent(i.unit || 'PIECE');
    }).join(';');

    var url = API_URL + '?action=submitTransaction' +
      '&docNo=' + encodeURIComponent(state.currentDoc) +
      '&docType=' + encodeURIComponent(state.currentModule) +
      '&sheetId=' + encodeURIComponent(getCleanSheetId()) +
      '&items=' + itemsStr +
      '&processedBy=' + encodeURIComponent(state.currentUser || state.warehouseName || 'WAREHOUSE') +
      '&idemKey=' + encodeURIComponent(idemKey) +
      '&_t=' + Date.now();

    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 45000, retries: 1 });
    var text = await res.text();
    return JSON.parse(text);
  };

  // ═══════════════════════════════════════════════════════════
  // PO ITEMS
  // ═══════════════════════════════════════════════════════════
  window.renderPoItems = function() {
    var noEl = document.getElementById('poDisplayNo');
    var prfEl = document.getElementById('poDisplayPrf');
    var clientEl = document.getElementById('poDisplayClient');
    if (noEl) noEl.textContent = state.currentPoNo;
    if (prfEl) prfEl.textContent = state.currentPoPrf || '-';
    if (clientEl) clientEl.textContent = state.currentPoSupplier || state.currentPoClient || '-';
    var list = document.getElementById('poItemsList');
    if (!list) return;

    if (state.requestInventoryList.length === 0) {
      loadRequestInventory().then(populateInventoryDatalist);
    } else {
      populateInventoryDatalist();
    }

    var hasMissing = false;
    state.poItemsData.forEach(function(item) {
      if (!item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim()) hasMissing = true;
    });

    var warning = document.getElementById('poIncompleteWarning');
    if (warning) {
      if (hasMissing) {
        warning.classList.remove('d-none');
        warning.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-2"></i>' +
          '<strong>Some items are incomplete.</strong> Please fill in the missing Item Code and Description below, or click <strong>Clear</strong> to reset an item and enter the correct one.';
      } else {
        warning.classList.add('d-none');
      }
    }

    list.innerHTML = state.poItemsData.map(function(item, idx) {
      var isManual = !!item._manual;
      var isMissing = !item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim();
      var isNew = !!item._new;

      var borderClass = '';
      if (isMissing) borderClass = 'border border-danger';
      else if (isManual) borderClass = 'border border-info';

      var newClass = isNew ? ' po-item-new' : '';

      var codeVal = item.inventoryId || '';
      var descVal = item.description || '';
      var isChecked = isManual ? true : !isMissing;

      return '<div class="card mb-2 po-item-card ' + borderClass + newClass + '" id="po-card-' + idx + '">' +
        '<div class="card-body py-2 px-3">' +
        '<div class="d-flex align-items-start gap-2">' +
        '<div class="form-check m-0 mt-3">' +
        '<input class="form-check-input po-check" type="checkbox" id="po-check-' + idx + '" ' + (isChecked ? 'checked' : '') + ' onchange="togglePoCard(' + idx + ')">' +
        '</div>' +
        '<div class="flex-grow-1" style="min-width:0;">' +
        '<div class="row g-2">' +
        '<div class="col-12 col-md-5">' +
        '<label class="form-label mb-0 small text-muted">Item Code</label>' +
        '<input type="text" class="form-control form-control-sm po-edit-code" id="po-code-' + idx + '" value="' + codeVal + '" placeholder="Type or pick item code..." list="inventoryCodeList" autocomplete="off" oninput="updatePoItem(' + idx + ', \'inventoryId\', this.value); autoFillPoDescription(' + idx + ', this.value, false);" onchange="autoFillPoDescription(' + idx + ', this.value, true);">' +
        '</div>' +
        '<div class="col-12 col-md-5">' +
        '<label class="form-label mb-0 small text-muted">Description</label>' +
        '<input type="text" class="form-control form-control-sm po-edit-desc" id="po-desc-' + idx + '" value="' + descVal + '" placeholder="Auto-fills from item code" oninput="updatePoItem(' + idx + ', \'description\', this.value);">' +
        '</div>' +
        '<div class="col-6 col-md-1">' +
        '<label class="form-label mb-0 small text-muted">PO Qty</label>' +
        (isManual ?
          '<input type="number" class="form-control form-control-sm" id="po-qty-' + idx + '" value="' + (item.qty || 1) + '" min="0" oninput="updatePoItem(' + idx + ', \'qty\', this.value)">' :
          '<div class="fw-bold small pt-1">' + (item.qty || 0) + '</div>') +
        '</div>' +
        '<div class="col-6 col-md-1">' +
        '<label class="form-label mb-0 small text-muted">Unit</label>' +
        '<div class="fw-bold small pt-1">' + (item.unit || 'PCS') + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="row g-2 mt-1">' +
        '<div class="col-6 col-md-2">' +
        '<label class="form-label mb-0 small text-muted">ATL Qty</label>' +
        '<input type="number" class="form-control form-control-sm" id="po-atl-' + idx + '" value="' + (item.atlQty != null ? item.atlQty : (item.qty || 0)) + '" min="0">' +
        '</div>' +
        '<div class="col-6 col-md-2">' +
        '<label class="form-label mb-0 small text-muted">Unit (Override)</label>' +
        '<select class="form-select form-select-sm" id="po-unit-' + idx + '">' + buildUnitOptions(item.unit || 'PCS') + '</select>' +
        '</div>' +
        '<div class="col-12 col-md-6">' +
        '<label class="form-label mb-0 small text-muted">Remarks</label>' +
        '<input type="text" class="form-control form-control-sm" id="po-remarks-' + idx + '" placeholder="Optional note..." maxlength="200">' +
        '</div>' +
        '<div class="col-12 col-md-2 d-flex align-items-end">' +
        '<button type="button" class="btn btn-sm btn-outline-danger w-100" onclick="clearPoItem(' + idx + ')" title="Clear this item">' +
        '<i class="bi bi-eraser-fill me-1"></i>Clear' +
        '</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="d-flex flex-column gap-1 ms-2 align-items-end">' +
        (isManual ? '<span class="badge bg-info">Manual</span>' : '') +
        (isMissing ? '<span class="badge bg-danger">Incomplete</span>' : '') +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }).join('');

    updateCreateMrrButton();
    document.querySelectorAll('.po-check').forEach(function(cb) {
      cb.addEventListener('change', updateCreateMrrButton);
    });
  };

  window.clearPoItem = function(idx) {
    if (!state.poItemsData[idx]) return;
    state.poItemsData[idx].inventoryId = '';
    state.poItemsData[idx].description = '';
    state.poItemsData[idx]._manual = true;
    renderPoItems();
    updateCreateMrrButton();
    setTimeout(function() {
      var modalBody = document.querySelector('#poItemsModal .modal-body');
      var card = document.getElementById('po-card-' + idx);
      if (card && modalBody) modalBody.scrollTop = card.offsetTop - 20;
      var el = document.getElementById('po-code-' + idx);
      if (el) el.focus();
    }, 80);
    showToast('Item cleared. Type or pick the correct item code.', 'info');
  };

  window.addPoManualItem = function() {
    try {
      if (!state.poItemsData) state.poItemsData = [];
      state.poItemsData.push({
        inventoryId: '', description: '', qty: 1, atlQty: 0, unit: 'PCS', remarks: '',
        _manual: true, _new: true
      });
      renderPoItems();
      updateCreateMrrButton();
      var newIdx = state.poItemsData.length - 1;
      setTimeout(function() {
        var modalBody = document.querySelector('#poItemsModal .modal-body');
        var card = document.getElementById('po-card-' + newIdx);
        if (card && modalBody) modalBody.scrollTo({ top: card.offsetTop - 20, behavior: 'smooth' });
        else if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var el = document.getElementById('po-code-' + newIdx);
        if (el) el.focus();
        setTimeout(function() {
          if (state.poItemsData[newIdx]) {
            state.poItemsData[newIdx]._new = false;
            var card2 = document.getElementById('po-card-' + newIdx);
            if (card2) card2.classList.remove('po-item-new');
          }
        }, 3000);
      }, 100);
      showToast('New row added. Enter the item code.', 'success');
    } catch(err) {
      console.error('[addPoManualItem] Error:', err);
      showToast('Could not add item: ' + err.message, 'danger');
    }
  };

  window.restorePoItems = function() {
    if (!_originalPoItems || _originalPoItems.length === 0) {
      showToast('No original PO items to restore.', 'warning');
      return;
    }
    state.poItemsData = JSON.parse(JSON.stringify(_originalPoItems));
    renderPoItems();
    showToast('PO items restored to original.', 'success');
  };

  function populateInventoryDatalist() {
    var datalist = document.getElementById('inventoryCodeList');
    if (!datalist) return;
    var html = '';
    (state.requestInventoryList || []).forEach(function(it) {
      var code = it.inventoryId || it.code || '';
      if (code) html += '<option value="' + code + '"></option>';
    });
    datalist.innerHTML = html;
  }

  window.autoFillPoDescription = function(idx, code, force) {
    if (!code) return;
    code = String(code).trim();
    if (!code) return;
    var match = state.requestInventoryList.find(function(it) {
      var c = it.code || it.inventoryId || '';
      return c.toLowerCase() === code.toLowerCase();
    });
    if (!match) return;
    var descInput = document.getElementById('po-desc-' + idx);
    if (descInput) {
      if (force || !descInput.value.trim()) {
        descInput.value = match.description || '';
        updatePoItem(idx, 'description', descInput.value);
      }
    }
    var unitSelect = document.getElementById('po-unit-' + idx);
    if (unitSelect && match.unit) {
      for (var opt = 0; opt < unitSelect.options.length; opt++) {
        if (unitSelect.options[opt].value === match.unit) { unitSelect.selectedIndex = opt; break; }
      }
    }
  };

  window.updatePoItem = function(idx, field, value) {
    if (!state.poItemsData[idx]) return;
    if (field === 'qty') state.poItemsData[idx][field] = parseFloat(value) || 0;
    else state.poItemsData[idx][field] = (value || '').trim();
    updateCreateMrrButton();
  };

  window.updateCreateMrrButton = function() {
    var btn = document.querySelector('#poItemsModal .btn-success');
    if (!btn) return;
    var selected = getSelectedPoItems();
    var hasMissingSelected = selected.some(function(item) {
      return !item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim();
    });
    if (hasMissingSelected) { btn.disabled = true; btn.title = 'Fill missing fields or uncheck the item'; }
    else if (selected.length === 0) { btn.disabled = true; btn.title = 'Select at least one item'; }
    else { btn.disabled = false; btn.title = ''; }
  };

  window.getSelectedPoItems = function() {
    var selected = [];
    state.poItemsData.forEach(function(item, idx) {
      var cb = document.getElementById('po-check-' + idx);
      if (!cb || !cb.checked) return;
      var codeEl = document.getElementById('po-code-' + idx);
      var descEl = document.getElementById('po-desc-' + idx);
      var atlEl = document.getElementById('po-atl-' + idx);
      var unitEl = document.getElementById('po-unit-' + idx);
      var remarksEl = document.getElementById('po-remarks-' + idx);
      var qtyEl = document.getElementById('po-qty-' + idx);
      var code = codeEl ? (codeEl.value || '').trim() : (item.inventoryId || '').trim();
      var desc = descEl ? (descEl.value || '').trim() : (item.description || '').trim();
      var qty = qtyEl ? (parseFloat(qtyEl.value) || 0) : (item.qty || 0);
      selected.push({
        inventoryId: code,
        description: desc,
        qty: qty,
        unit: unitEl ? unitEl.value : (item.unit || 'PCS'),
        atlQty: atlEl ? (parseFloat(atlEl.value) || 0) : 0,
        remarks: remarksEl ? remarksEl.value : ''
      });
    });
    return selected;
  };

  window.togglePoCard = function(idx) {
    var cb = document.getElementById('po-check-' + idx);
    var card = document.getElementById('po-card-' + idx);
    if (card && cb) {
      if (cb.checked) card.classList.remove('opacity-50');
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

  window.closePoItemsModal = function() { if (state.poItemsModal) state.poItemsModal.hide(); };

  window.createMrrFromPo = function() {
    var btn = document.querySelector('#poItemsModal .btn-success');
    return withButtonLoading(btn, async function() {
      var selected = getSelectedPoItems();
      if (selected.length === 0) { showToast('Please select at least one item', 'warning'); return; }
      var hasMissing = selected.some(function(item) {
        return !item.inventoryId || !item.inventoryId.trim() || !item.description || !item.description.trim();
      });
      if (hasMissing) { showToast('Fill missing details first', 'danger'); return; }

      var drNo = document.getElementById('mrrDrNo') ? document.getElementById('mrrDrNo').value.trim() : '';
      var receivingDate = document.getElementById('mrrReceivingDate') ? document.getElementById('mrrReceivingDate').value : '';
      var preparedBy = _getCurrentUserName() || 'WAREHOUSE';

      var idemKey = 'cmrr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

      try {
        var payload = {
          action: 'createMrrRequest',
          _idemKey: idemKey,
          poNo: state.currentPoNo, prfNo: state.currentPoPrf,
          client: state.currentPoClient, supplier: state.currentPoSupplier,
          drNo: drNo, receivingDate: receivingDate, preparedBy: preparedBy,
          items: selected
        };
        var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
        var res = await fetchFn(API_URL, {
          method: 'POST', body: JSON.stringify(payload),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        }, { timeout: 45000, retries: 1 });
        var text = await res.text();
        var data;
        try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
        if (data && data.success) {
          closePoItemsModal();
          showToast('MRR created: ' + data.docNo + ' — Prepared by ' + preparedBy, 'success');
          fetchPendingDocs(true);
        } else {
          showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
        }
      } catch(err) { showToast('Error: ' + err.message, 'danger'); }
    }, 'Creating MRR...');
  };

  window.lookupPoItems = function() {
    var poInput = document.getElementById('poNumberInput');
    if (!poInput) return;
    var poNo = poInput.value.trim();
    if (!poNo) { showToast('Please enter a PO number', 'warning'); return; }
    loadRequestInventory().then(populateInventoryDatalist).catch(function() {});
    showLoading('Looking up PO...');
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
          window._saveOriginalPoItems();
          renderPoItems();
          if (state.poScanModal) state.poScanModal.hide();
          if (state.poItemsModal) state.poItemsModal.show();
        } else {
          showToast((data && data.error) || 'No items found for PO: ' + poNo, 'warning');
        }
      })
      .catch(function(err) { showToast('Error: ' + err.message, 'danger'); })
      .finally(function() { hideLoading(); });
  };

  window.manualPoLookup = function() {
    var poNo = document.getElementById('manualPoInput') ? document.getElementById('manualPoInput').value.trim() : '';
    var mrrPoNo = document.getElementById('mrrManualPoInput') ? document.getElementById('mrrManualPoInput').value.trim() : '';
    var finalPo = poNo || mrrPoNo;
    if (!finalPo) { showToast('Please enter a PO number', 'warning'); return; }
    if (document.getElementById('manualPoInput')) document.getElementById('manualPoInput').value = '';
    if (document.getElementById('mrrManualPoInput')) document.getElementById('mrrManualPoInput').value = '';
    loadRequestInventory().then(populateInventoryDatalist).catch(function() {});
    showLoading('Looking up PO...');
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
          window._saveOriginalPoItems();
          renderPoItems();
          if (state.poScanModal) state.poScanModal.hide();
          if (state.poItemsModal) state.poItemsModal.show();
          playSuccessBeep();
        } else {
          showToast((data && data.error) || 'No items found for PO: ' + finalPo, 'warning');
        }
      })
      .catch(function(err) { showToast('Error: ' + err.message, 'danger'); })
      .finally(function() { hideLoading(); });
  };

  window.closePoScanModal = function() { if (state.poScanModal) state.poScanModal.hide(); };

  // ─── QTY MODAL ───
  var currentModalItem = null;

  window.openQtyModal = function(item) {
    currentModalItem = item;
    var isMRR = state.currentModule === 'MRR';
    var isMRS = state.currentModule === 'MRS';
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
    if (!currentModalItem) return;
    var input = document.getElementById('modalInputQty');
    if (!input) return;
    var qtyVal = parseInt(input.value, 10);
    if (isNaN(qtyVal) || qtyVal < 0) { input.classList.add('is-invalid'); playErrorBuzz(); return; }
    var isMRR = state.currentModule === 'MRR';
    if (!isMRR && qtyVal > currentModalItem.qty) {
      var max = currentModalItem.qty;
      var msg = state.currentModule === 'MRS' ? 'Returned Qty cannot exceed Expected Qty (Max: ' + max + ')' : 'Issued Qty cannot exceed Requested Qty (Max: ' + max + ')';
      showExceedError(msg);
      input.value = max;
      input.classList.add('is-invalid');
      playErrorBuzz();
      return;
    }
    var unitSelect = document.getElementById('modalUnit');
    currentModalItem.issuedQty = qtyVal;
    currentModalItem.unit = unitSelect ? unitSelect.value : 'PIECE';
    currentModalItem.verified = true;
    saveDocProgress();
    renderItems();
    if (qtyModal) qtyModal.hide();
    playSuccessBeep();
  };

  window.showMismatchAlert = function(code) {
    var alert = document.getElementById('mismatchAlert');
    var text = document.getElementById('mismatchText');
    if (!alert || !text) return;
    text.textContent = 'Item "' + code + '" not found.';
    alert.classList.remove('d-none');
    clearTimeout(state.errorTimer);
    state.errorTimer = setTimeout(clearErrorAlert, 4000);
  };

  window.showExceedError = function(msg) {
    var alert = document.getElementById('exceedErrorAlert');
    var text = document.getElementById('exceedText');
    if (!alert || !text) return;
    text.textContent = 'Error: ' + msg;
    alert.classList.remove('d-none');
    clearTimeout(state.errorTimer);
    state.errorTimer = setTimeout(clearErrorAlert, 4000);
  };

  window.clearErrorAlert = function() {
    var a1 = document.getElementById('mismatchAlert');
    var a2 = document.getElementById('exceedErrorAlert');
    if (a1) a1.classList.add('d-none');
    if (a2) a2.classList.add('d-none');
  };

  function _positionSuggestDropdown(dropdown, input) {
    var inputRect = input.getBoundingClientRect();
    var spaceBelow = window.innerHeight - inputRect.bottom;
    var spaceAbove = inputRect.top;
    var dropdownMinHeight = 200;
    dropdown.style.position = 'fixed';
    dropdown.style.left = inputRect.left + 'px';
    dropdown.style.width = Math.max(inputRect.width, 280) + 'px';
    dropdown.style.zIndex = '99999';
    if (spaceBelow < dropdownMinHeight && spaceAbove > spaceBelow) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = (window.innerHeight - inputRect.top + 2) + 'px';
      dropdown.style.maxHeight = Math.min(spaceAbove - 20, 340) + 'px';
    } else {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = (inputRect.bottom + 2) + 'px';
      dropdown.style.maxHeight = Math.min(spaceBelow - 20, 340) + 'px';
    }
  }
  window._positionSuggestDropdown = _positionSuggestDropdown;

  window.loadRequestInventory = async function(forceRefresh) {
    var cacheKey = 'inventoryList';
    if (!forceRefresh) {
      var cached = getCache(cacheKey);
      if (cached) { state.requestInventoryList = cached; return cached; }
    }
    try {
      var url = API_URL + '?action=getInventoryList&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { data = {}; }
      var inv = data.inventory || data.items || [];
      var skipPatterns = ['total', 'inventory codes', 'inventory id', 'item id', 'grand total', 'subtotal', 'sub-total'];
      inv = inv.filter(function(it) {
        var code = String(it.code || it.inventoryId || '').trim();
        var desc = String(it.description || '').trim();
        if (!code) return false;
        var codeLower = code.toLowerCase();
        var descLower = desc.toLowerCase();
        for (var i = 0; i < skipPatterns.length; i++) {
          if (codeLower === skipPatterns[i] || codeLower.indexOf(skipPatterns[i]) === 0) return false;
          if (descLower === skipPatterns[i] || descLower.indexOf(skipPatterns[i]) === 0) return false;
        }
        return true;
      });
      state.requestInventoryList = inv;
      setCache(cacheKey, inv, 5 * 60 * 1000);
      return inv;
    } catch(err) { state.requestInventoryList = []; return []; }
  };

  window.loadRequestorList = async function(forceRefresh) {
    var cacheKey = 'requestorList';
    if (!forceRefresh) {
      var cached = getCache(cacheKey);
      if (cached) { state.requestorList = cached; populateRequestorSelect(cached); return cached; }
    }
    try {
      var url = API_URL + '?action=getRequestorList&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { data = {}; }
      var list = data.requestors || [];
      state.requestorList = list;
      setCache(cacheKey, list, 10 * 60 * 1000);
      populateRequestorSelect(list);
      return list;
    } catch(err) { return []; }
  };

  function populateRequestorSelect(list) {
    var sel = document.getElementById('reqRequestor');
    var sel3 = document.getElementById('step3Requestor');
    [sel, sel3].forEach(function(s) {
      if (!s) return;
      var html = '<option value="">-- Select Requestor --</option>';
      list.forEach(function(r) {
        html += '<option value="' + r.name + '" data-department="' + (r.department || '') + '">' + r.name + '</option>';
      });
      s.innerHTML = html;
    });
  }

  window.loadVendorList = async function(forceRefresh) {
    var cacheKey = 'vendorList';
    if (!forceRefresh) {
      var cached = getCache(cacheKey);
      if (cached) { state.vendorList = cached; populateDatalist('vendorDatalist', cached); return cached; }
    }
    try {
      var url = API_URL + '?action=getVendorList&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.vendors) {
        state.vendorList = data.vendors;
        setCache(cacheKey, data.vendors, 10 * 60 * 1000);
        populateDatalist('vendorDatalist', data.vendors);
        return data.vendors;
      }
      return [];
    } catch(e) { return []; }
  };

  window.loadIvmTeamList = async function(forceRefresh) {
    var cacheKey = 'ivmTeamList';
    if (!forceRefresh) {
      var cached = getCache(cacheKey);
      if (cached) { state.ivmTeamList = cached; populateDatalist('ivmTeamDatalist', cached); return cached; }
    }
    try {
      var url = API_URL + '?action=getIvmTeamList&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.members) {
        state.ivmTeamList = data.members;
        setCache(cacheKey, data.members, 10 * 60 * 1000);
        populateDatalist('ivmTeamDatalist', data.members);
        return data.members;
      }
      return [];
    } catch(e) { return []; }
  };

  window.populateDatalist = function(datalistId, items) {
    var datalist = document.getElementById(datalistId);
    if (!datalist) return;
    var html = '';
    items.forEach(function(item) { html += '<option value="' + item + '"></option>'; });
    datalist.innerHTML = html;
  };

  // ─── MANUAL MRR ───
  var manualMrrModal = null;
  var manualMrrItems = [];

  window.openManualMrrModal = function() {
    if (!manualMrrModal) manualMrrModal = new bootstrap.Modal(document.getElementById('manualMrrModal'));

    window._prefillMrrMode = false;
    window._prefillMrrDocNo = null;
    var titleEl = document.querySelector('#manualMrrModal .modal-title');
    if (titleEl) titleEl.innerHTML = '<i class="bi bi-plus-circle me-2"></i>Create Manual MRR';
    var btn = document.getElementById('btnSubmitManualMrr');
    if (btn) btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Create MRR';

    var poEl = document.getElementById('manualMrrPoNo');
    var drEl = document.getElementById('manualMrrDrNo');
    var vendorEl = document.getElementById('manualMrrVendor');
    var siteEl = document.getElementById('manualMrrSite');
    var prepEl = document.getElementById('manualMrrPreparedBy');
    if (poEl) poEl.value = '';
    if (drEl) drEl.value = '';
    if (vendorEl) vendorEl.value = '';
    if (siteEl) siteEl.value = 'GEMCOR CATMON';
    if (prepEl) prepEl.value = _getCurrentUserName();
    var dateEl = document.getElementById('manualMrrDate');
    if (dateEl && !dateEl.value) dateEl.valueAsDate = new Date();
    manualMrrItems = [];
    renderManualMrrItems();
    updateManualMrrSubmitButton();
    manualMrrModal.show();
    if (state.requestInventoryList.length === 0) loadRequestInventory().catch(function() {});
    loadVendorList(false).catch(function() {});
    loadIvmTeamList(false).catch(function() {});
  };

  window.prefillManualMrrFromDoc = async function(docNo) {
    if (!docNo) return;
    if (state.isLoading) return;

    showLoading('Loading ' + docNo + '...');
    try {
      var key = 'sheetId_MRR';
      var sheetIdVal = localStorage.getItem(key);
      var sheetIdClean = sheetIdVal ? extractSheetId(sheetIdVal) : '';

      var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
                '&docType=MRR&sheetId=' + encodeURIComponent(sheetIdClean) +
                '&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
      if (!data.success) throw new Error(data.error || 'Failed to load document');

      var info = data.info || {};
      var items = data.items || [];

      var poNo = info['PO No.'] || info.poNo || '';
      var vendor = info['Vendor/Client'] || info.vendor || '';
      var receivingSite = info['Receiving Site'] || info.receivingSite || 'GEMCOR CATMON';

      var remainingItems = items.map(function(it) {
        var requested = Number(it.qty || it.recQty || it.expectedQty || 0);
        var received = Number(it.atlQty || it.actualQty || it.issuedQty || 0);
        var remaining = requested - received;
        if (remaining <= 0) return null;
        return {
          inventoryId: it.inventoryId || it.itemCode || '',
          description: it.description || '',
          qty: remaining,
          atlQty: 0,
          unit: it.unit || 'PCS',
          remarks: ''
        };
      }).filter(Boolean);

      if (remainingItems.length === 0) {
        showToast('This MRR has no remaining items to process.', 'info');
        return;
      }

      if (!manualMrrModal) manualMrrModal = new bootstrap.Modal(document.getElementById('manualMrrModal'));

      window._prefillMrrMode = true;
      window._prefillMrrDocNo = docNo;

      var titleEl = document.querySelector('#manualMrrModal .modal-title');
      if (titleEl) titleEl.innerHTML = '<i class="bi bi-arrow-right-circle me-2"></i>Process ' + docNo + ' (MRR)';
      var btn = document.getElementById('btnSubmitManualMrr');
      if (btn) btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Create New MRR';

      var poEl = document.getElementById('manualMrrPoNo');
      var drEl = document.getElementById('manualMrrDrNo');
      var vendorEl = document.getElementById('manualMrrVendor');
      var siteEl = document.getElementById('manualMrrSite');
      var prepEl = document.getElementById('manualMrrPreparedBy');
      var dateEl = document.getElementById('manualMrrDate');

      if (poEl) poEl.value = poNo;
      if (drEl) drEl.value = '';
      if (vendorEl) vendorEl.value = vendor;
      if (siteEl) siteEl.value = receivingSite;
      if (prepEl) prepEl.value = _getCurrentUserName();
      if (dateEl) dateEl.valueAsDate = new Date();

      manualMrrItems = remainingItems;
      renderManualMrrItems();
      updateManualMrrSubmitButton();

      manualMrrModal.show();

    } catch(err) {
      console.error('[prefillManualMrrFromDoc] Error:', err);
      showToast('Failed to load document: ' + err.message, 'danger');
    } finally {
      hideLoading();
    }
  };

  document.addEventListener('hidden.bs.modal', function(e) {
    if (e.target && e.target.id === 'manualMrrModal') {
      window._prefillMrrMode = false;
      window._prefillMrrDocNo = null;
      var titleEl = document.querySelector('#manualMrrModal .modal-title');
      if (titleEl) titleEl.innerHTML = '<i class="bi bi-plus-circle me-2"></i>Create Manual MRR';
      var btn = document.getElementById('btnSubmitManualMrr');
      if (btn) btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Create MRR';
    }
  });

  window.addManualMrrItem = function() {
    manualMrrItems.push({ inventoryId: '', description: '', qty: 1, atlQty: 0, unit: 'PIECE', remarks: '' });
    renderManualMrrItems();
    updateManualMrrSubmitButton();
    setTimeout(function() {
      var inputs = document.querySelectorAll('.manual-mrr-search');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 100);
  };

  window.removeManualMrrItem = function(index) {
    manualMrrItems.splice(index, 1);
    renderManualMrrItems();
    updateManualMrrSubmitButton();
  };

  window.updateManualMrrItem = function(index, field, value) {
    if (manualMrrItems[index]) manualMrrItems[index][field] = value;
    updateManualMrrSubmitButton();
  };

  window.renderManualMrrItems = function() {
    var tbody = document.getElementById('manualMrrItemsBody');
    var emptyState = document.getElementById('manualMrrEmptyState');
    if (!tbody) return;
    if (manualMrrItems.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      updateManualMrrSubmitButton();
      return;
    }
    if (emptyState) emptyState.style.display = 'none';
    var html = '';
    for (var i = 0; i < manualMrrItems.length; i++) {
      var it = manualMrrItems[i];
      html += '<tr>' +
        '<td class="align-middle text-center">' + (i + 1) + '</td>' +
        '<td><div style="position:relative;width:100%;">' +
          '<input type="text" class="form-control form-control-sm manual-mrr-search" placeholder="Type to search..." value="' + (it.inventoryId ? it.inventoryId + ' - ' + it.description : '') + '" oninput="filterManualMrrItems(this, ' + i + ')" onfocus="filterManualMrrItems(this, ' + i + ')" onblur="updateManualMrrSubmitButton()" autocomplete="off" style="width:100%;min-width:150px;">' +
          '<div class="list-group d-none manual-mrr-dropdown" style="background:#fff;border:1px solid #ced4da;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:4px 0;overflow-y:auto;" id="manualMrrDropdown' + i + '"></div>' +
          '<input type="hidden" class="manual-mrr-code" id="manualMrrCode' + i + '" value="' + (it.inventoryId || '') + '">' +
          '<input type="hidden" class="manual-mrr-desc" id="manualMrrDesc' + i + '" value="' + (it.description || '') + '">' +
        '</div></td>' +
        '<td><input type="text" class="form-control form-control-sm manual-mrr-desc-text" id="manualMrrDescText' + i + '" value="' + (it.description || '') + '" oninput="updateManualMrrItem(' + i + ', \'description\', this.value); updateManualMrrSubmitButton();" placeholder="Description" style="min-width:120px;"></td>' +
        '<td><input type="number" class="form-control form-control-sm text-center" value="' + (it.qty || 0) + '" oninput="updateManualMrrItem(' + i + ', \'qty\', parseFloat(this.value)||0); updateManualMrrSubmitButton();" min="0" step="0.01" style="width:70px;"></td>' +
        '<td><input type="number" class="form-control form-control-sm text-center" value="' + (it.atlQty || 0) + '" oninput="updateManualMrrItem(' + i + ', \'atlQty\', parseFloat(this.value)||0); updateManualMrrSubmitButton();" min="0" step="0.01" style="width:70px;"></td>' +
        '<td><select class="form-select form-select-sm manual-mrr-unit" onchange="updateManualMrrItem(' + i + ', \'unit\', this.value)">' + buildUnitOptions(it.unit || 'PIECE') + '</select></td>' +
        '<td><input type="text" class="form-control form-control-sm" value="' + (it.remarks || '') + '" oninput="updateManualMrrItem(' + i + ', \'remarks\', this.value)" placeholder="Remarks" maxlength="200" style="min-width:100px;"></td>' +
        '<td class="align-middle text-center"><button class="btn btn-sm btn-outline-danger" onclick="removeManualMrrItem(' + i + ')" title="Remove"><i class="bi bi-trash"></i></button></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    updateManualMrrSubmitButton();
  };

  window.filterManualMrrItems = function(input, idx) {
    var term = input.value.toLowerCase();
    var dropdown = document.getElementById('manualMrrDropdown' + idx);
    if (!dropdown) return;
    dropdown.innerHTML = '';
    var hiddenCode = document.getElementById('manualMrrCode' + idx);
    var hiddenDesc = document.getElementById('manualMrrDesc' + idx);
    if (hiddenCode && hiddenDesc) {
      var typed = input.value.trim();
      if (typed && typed.indexOf(' - ') === -1) {
        var exact = state.requestInventoryList.find(function(it) {
          var c = it.code || it.inventoryId || '';
          return c.toLowerCase() === typed.toLowerCase();
        });
        if (exact) { hiddenCode.value = exact.code || exact.inventoryId || typed; hiddenDesc.value = exact.description || ''; }
        else if (typed) { hiddenCode.value = typed; if (!hiddenDesc.value) hiddenDesc.value = typed; }
      }
    }
    updateManualMrrSubmitButton();
    if (!term) { dropdown.classList.add('d-none'); return; }
    if (state.requestInventoryList.length === 0) {
      dropdown.innerHTML = '<div class="list-group-item text-muted" style="padding:8px 12px;">Loading inventory...</div>';
      _positionSuggestDropdown(dropdown, input);
      dropdown.classList.remove('d-none');
      return;
    }
    var matches = state.requestInventoryList.filter(function(it) {
      var code = (it.code || it.inventoryId || '').toLowerCase();
      var desc = (it.description || '').toLowerCase();
      return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
    }).slice(0, 20);
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="list-group-item text-muted" style="padding:8px 12px;">No matches — you can type the code manually.</div>';
    } else {
      matches.forEach(function(it) {
        var code = it.code || it.inventoryId || '';
        var desc = it.description || '';
        var unit = it.unit || 'PIECE';
        var el = document.createElement('div');
        el.className = 'list-group-item list-group-item-action';
        el.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.9rem;border-bottom:1px solid #f0f0f0;';
        el.innerHTML = '<div class="fw-bold" style="color:#1e3a5f;">' + code + '</div><div class="text-muted small">' + desc + ' <span class="badge bg-light text-dark">' + unit + '</span></div>';
        el.onmousedown = function(e) { e.preventDefault(); selectManualMrrItem(idx, code, desc, unit); dropdown.classList.add('d-none'); };
        dropdown.appendChild(el);
      });
    }
    _positionSuggestDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
  };

  window.selectManualMrrItem = function(idx, code, desc, unit) {
    if (manualMrrItems[idx]) {
      manualMrrItems[idx].inventoryId = code;
      manualMrrItems[idx].description = desc;
      manualMrrItems[idx].unit = unit || 'PIECE';
    }
    var row = document.querySelector('#manualMrrItemsBody tr:nth-child(' + (idx + 1) + ')');
    if (row) {
      var searchInput = row.querySelector('.manual-mrr-search');
      if (searchInput) searchInput.value = code + ' - ' + desc;
      var descInput = row.querySelector('.manual-mrr-desc-text');
      if (descInput) descInput.value = desc;
      var unitSelect = row.querySelector('.manual-mrr-unit');
      if (unitSelect) {
        for (var opt = 0; opt < unitSelect.options.length; opt++) {
          if (unitSelect.options[opt].value === unit) { unitSelect.selectedIndex = opt; break; }
        }
      }
      var codeHidden = document.getElementById('manualMrrCode' + idx);
      var descHidden = document.getElementById('manualMrrDesc' + idx);
      if (codeHidden) codeHidden.value = code;
      if (descHidden) descHidden.value = desc;
    }
    updateManualMrrSubmitButton();
    playSuccessBeep();
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
    var rows = document.querySelectorAll('#manualMrrItemsBody tr');
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var codeHidden = row.querySelector('.manual-mrr-code');
      var descHidden = row.querySelector('.manual-mrr-desc');
      var qtyInput = row.querySelector('td:nth-child(4) input');
      var code = codeHidden ? codeHidden.value.trim() : '';
      var desc = descHidden ? descHidden.value.trim() : '';
      var qty = qtyInput ? parseFloat(qtyInput.value) || 0 : 0;
      if (code && desc && qty > 0) { hasValidItems = true; break; }
    }
    btn.disabled = !(drNo && vendor && site && hasValidItems);
  };

  window.submitManualMrr = function() {
    var btn = document.getElementById('btnSubmitManualMrr');
    return withButtonLoading(btn, async function() {
      var poNo = document.getElementById('manualMrrPoNo') ? document.getElementById('manualMrrPoNo').value.trim() : '';
      var drNo = document.getElementById('manualMrrDrNo') ? document.getElementById('manualMrrDrNo').value.trim() : '';
      var vendor = document.getElementById('manualMrrVendor') ? document.getElementById('manualMrrVendor').value.trim() : '';
      var site = document.getElementById('manualMrrSite') ? document.getElementById('manualMrrSite').value.trim() : '';
      var receivingDate = document.getElementById('manualMrrDate') ? document.getElementById('manualMrrDate').value : '';
      var preparedByField = document.getElementById('manualMrrPreparedBy') ? document.getElementById('manualMrrPreparedBy').value.trim() : '';
      var preparedBy = preparedByField || _getCurrentUserName() || 'WAREHOUSE';

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
      if (items.length === 0) { showToast('Please add at least one valid item', 'warning'); return; }

      var isPrefill = window._prefillMrrMode === true && window._prefillMrrDocNo;
      var idemKey = 'mmrr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

      try {
        var payload;
        if (isPrefill) {
          payload = {
            action: 'processBalance',
            _idemKey: idemKey,
            docType: 'MRR',
            originalDocNo: window._prefillMrrDocNo,
            items: items.map(function(it) {
              return {
                inventoryId: it.inventoryId,
                description: it.description,
                qty: it.qty,
                issueNow: it.atlQty || 0,
                unit: it.unit,
                remarks: it.remarks
              };
            }),
            processedBy: preparedBy,
            drNo: drNo,
            vendor: vendor,
            receivingSite: site,
            receivingDate: receivingDate,
            poNo: poNo,
            preparedBy: preparedBy
          };
        } else {
          payload = {
            action: 'createMrrRequest',
            _idemKey: idemKey,
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
        }

        var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
        var res = await fetchFn(API_URL, {
          method: 'POST', body: JSON.stringify(payload),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        }, { timeout: 45000, retries: 1 });
        var text = await res.text();
        var data;
        try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
        if (data && data.success) {
          if (manualMrrModal) manualMrrModal.hide();
          if (isPrefill) {
            showToast('New MRR created: ' + data.balDocNo + ' (' + (data.status || 'COMPLETED') + ')', 'success');
          } else {
            showToast('Manual MRR created: ' + data.docNo + ' — Prepared by ' + preparedBy, 'success');
          }
          fetchPendingDocs(true);
          updateWarehouseKPIs();
        } else {
          showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
        }
      } catch(err) { showToast('Error: ' + err.message, 'danger'); }
    }, 'Creating MRR...');
  };

  // ─── QUICK ACTIONS ───
  window.quickProcessPending = function(btn) {
    return withButtonLoading(btn, async function() {
      var statusEl = document.getElementById('quickActionStatus');
      if (statusEl) statusEl.textContent = '⏳ Looking for next pending...';
      try {
        await selectModule('MRIF');
        var docs = await fetchPendingDocs(true);
        if (!docs || docs.length === 0) {
          if (statusEl) statusEl.textContent = '✅ No pending MRIF documents found.';
          return;
        }
        var docNo = typeof docs[0] === 'string' ? docs[0] : (docs[0].docNo || docs[0].name);
        if (!docNo) return;
        await onDocSelect(docNo);
        if (statusEl) statusEl.textContent = '📄 Loaded: ' + cleanDocNo(docNo);
      } catch(err) { if (statusEl) statusEl.textContent = '❌ Error: ' + err.message; }
    }, 'Processing...');
  };

  window.quickNewMrr = function(btn) {
    return withButtonLoading(btn, async function() {
      if (typeof openManualMrrModal === 'function') openManualMrrModal();
      else showToast('Manual MRR modal not available', 'danger');
    }, 'Opening...');
  };

  window.quickNewMrif = function(btn) {
    return withButtonLoading(btn, async function() {
      if (typeof openManualMrifModal === 'function') openManualMrifModal();
      else showToast('Manual MRIF modal not available', 'danger');
    }, 'Opening...');
  };

  // ═══════════════════════════════════════════════════════════
  // PARTIAL ITEMS
  // ═══════════════════════════════════════════════════════════

  window.fetchPartialItems = async function() {
    try {
      var url = API_URL + '?action=getPartialItems&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var data = await res.json();
      if (data.success) return data.items || [];
      return [];
    } catch(err) { return []; }
  };

  window.openPartialItemsModal = async function() {
    var modalEl = document.getElementById('partialItemsModal');
    if (!modalEl) { showToast('Modal not found', 'danger'); return; }
    var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    var container = document.getElementById('partialItemsList');
    if (container) container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="text-muted mt-2">Loading partial items...</div></div>';
    modal.show();

    try {
      var items = await fetchPartialItems();
      if (!container) return;
      if (items.length === 0) {
        container.innerHTML = '<div class="list-group-item text-muted text-center py-4">No partial items found. All items are fully served or pending.</div>';
        return;
      }
      var grouped = {};
      items.forEach(function(it) {
        var doc = it.originalDocNo || it.docNo || '(unknown)';
        if (!grouped[doc]) grouped[doc] = {
          docNo: doc, items: [],
          requestor: it.requestor || '', department: it.department || '',
          joNo: it.joNo || '', gemSoNo: it.gemSoNo || '',
          clientName: it.clientName || '', project: it.project || ''
        };
        grouped[doc].items.push(it);
      });
      var html = '';
      Object.keys(grouped).forEach(function(doc) {
        var g = grouped[doc];
        html += '<div class="card mb-3 border-warning">' +
          '<div class="card-header bg-warning text-dark d-flex justify-content-between align-items-center">' +
            '<div><i class="bi bi-file-earmark-text me-2"></i><strong>' + g.docNo + '</strong> <span class="badge bg-secondary">MRIF</span></div>' +
            '<button class="btn btn-sm btn-dark" onclick="openProcessPartialModal(\'' + doc + '\')">' +
              '<i class="bi bi-arrow-right-circle me-1"></i>Process Balance' +
            '</button>' +
          '</div>' +
          '<div class="card-body p-2">' +
            '<div class="row g-2 small mb-2">' +
              (g.requestor ? '<div class="col-md-6"><strong>Requestor:</strong> ' + g.requestor + '</div>' : '') +
              (g.department ? '<div class="col-md-6"><strong>Dept:</strong> ' + g.department + '</div>' : '') +
              (g.joNo ? '<div class="col-md-6"><strong>JO No:</strong> ' + g.joNo + '</div>' : '') +
              (g.gemSoNo ? '<div class="col-md-6"><strong>GEM SO:</strong> ' + g.gemSoNo + '</div>' : '') +
              (g.clientName ? '<div class="col-md-6"><strong>Client:</strong> ' + g.clientName + '</div>' : '') +
              (g.project ? '<div class="col-md-6"><strong>Project:</strong> ' + g.project + '</div>' : '') +
            '</div>' +
            '<div class="table-responsive">' +
              '<table class="table table-sm table-bordered mb-0">' +
                '<thead class="table-light"><tr>' +
                  '<th style="width:22%">Item Code</th>' +
                  '<th>Description</th>' +
                  '<th class="text-center" style="width:9%">Req.</th>' +
                  '<th class="text-center" style="width:9%">Issued</th>' +
                  '<th class="text-center" style="width:10%">Remaining</th>' +
                  '<th class="text-center" style="width:8%">Unit</th>' +
                '</tr></thead><tbody>';
        g.items.forEach(function(it) {
          html += '<tr>' +
            '<td><code>' + (it.itemCode || '') + '</code></td>' +
            '<td>' + (it.description || '') + '</td>' +
            '<td class="text-center">' + (it.requestedQty || 0) + '</td>' +
            '<td class="text-center">' + (it.issuedQty || 0) + '</td>' +
            '<td class="text-center fw-bold text-danger">' + (it.remainingQty || 0) + '</td>' +
            '<td class="text-center">' + (it.unit || 'PCS') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div></div></div>';
      });
      container.innerHTML = html;
    } catch(err) {
      if (container) container.innerHTML = '<div class="list-group-item text-danger text-center py-4">Failed: ' + err.message + '</div>';
    }
  };

  var _processPartialDocNo = null;
  var _processPartialItems = [];

  window.openProcessPartialModal = async function(docNo) {
    if (!docNo) return;
    _processPartialDocNo = docNo;
    var modalEl = document.getElementById('processPartialModal');
    if (!modalEl) { showToast('Process Balance modal not found', 'danger'); return; }
    var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    var titleEl = document.getElementById('processPartialDocTitle');
    if (titleEl) titleEl.textContent = 'Process Balance for ' + docNo;

    var body = document.getElementById('processPartialBody');
    if (body) body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="text-muted mt-2">Loading items...</div></div>';

    modal.show();

    try {
      var all = await fetchPartialItems();
      _processPartialItems = all.filter(function(it) {
        return (it.originalDocNo || it.docNo) === docNo;
      });
      if (!_processPartialItems.length) {
        if (body) body.innerHTML = '<div class="alert alert-info mb-0">No open partial items for this document.</div>';
        return;
      }
      var html = '<div class="alert alert-info small py-2 mb-3">' +
        '<i class="bi bi-info-circle me-1"></i> ' +
        'A new sheet <strong>Bal.' + docNo + '</strong> will be created. ' +
        'Enter the quantity you are <strong>issuing right now</strong> for each item.' +
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
          '<td><code>' + (it.itemCode || '') + '</code></td>' +
          '<td>' + (it.description || '') + '</td>' +
          '<td class="text-center">' + (it.unit || 'PCS') + '</td>' +
          '<td class="text-center fw-bold text-danger process-remaining-cell" data-idx="' + idx + '">' + remaining + '</td>' +
          '<td class="text-center">' +
            '<input type="number" class="form-control form-control-sm text-center process-qty-input" ' +
            'data-idx="' + idx + '" value="0" min="0" max="' + remaining + '" step="0.01" ' +
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
        '<span class="ms-1">Set all items to their full remaining quantity.</span>' +
        '</div>';
      if (body) body.innerHTML = html;
    } catch(err) {
      if (body) body.innerHTML = '<div class="alert alert-danger">Failed to load items: ' + err.message + '</div>';
    }
  };

  window.onProcessQtyInput = function(input) {
    var idx = input.getAttribute('data-idx');
    var remainingCell = document.querySelector('.process-remaining-cell[data-idx="' + idx + '"]');
    if (!remainingCell) return;
    var remaining = parseFloat(remainingCell.textContent) || 0;
    var value = parseFloat(input.value) || 0;
    if (value > remaining) input.value = remaining;
  };

  window.fillAllRemaining = function() {
    document.querySelectorAll('.process-qty-input').forEach(function(inp) {
      var idx = inp.getAttribute('data-idx');
      var remainingCell = document.querySelector('.process-remaining-cell[data-idx="' + idx + '"]');
      if (remainingCell) inp.value = parseFloat(remainingCell.textContent) || 0;
    });
  };

  window.submitProcessBalance = function() {
    if (!_processPartialDocNo || !_processPartialItems.length) {
      showToast('No items to process', 'warning');
      return;
    }
    var btn = document.getElementById('btnSubmitProcessBalance');
    return withButtonLoading(btn, async function() {
      var itemsPayload = [];
      _processPartialItems.forEach(function(it, idx) {
        var qtyInput = document.querySelector('.process-qty-input[data-idx="' + idx + '"]');
        var remarksInput = document.querySelector('.process-remarks-input[data-idx="' + idx + '"]');
        var remaining = Number(it.remainingQty || 0);
        var issueNow = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;
        var remarks = remarksInput ? (remarksInput.value || '').trim() : '';
        if (issueNow > remaining) issueNow = remaining;
        itemsPayload.push({
          inventoryId: it.itemCode || '',
          description: it.description || '',
          qty: remaining,
          issueNow: issueNow,
          unit: it.unit || 'PCS',
          remarks: remarks || '',
          originalRowIndex: it.originalRowIndex || 0
        });
      });
      var anyIssued = itemsPayload.some(function(it) { return it.issueNow > 0; });
      if (!anyIssued) {
        if (!confirm('You have not entered any "Issued Now" quantity.\n\nContinue anyway?')) return;
      }

      var currentUser = '';
      if (typeof state !== 'undefined') currentUser = state.currentUserFullname || state.currentUser || '';
      if (!currentUser) currentUser = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
      if (!currentUser) currentUser = 'WAREHOUSE';

      var idemKey = 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

      try {
        var payload = {
          action: 'processPartialBalance',
          _idemKey: idemKey,
          originalDocNo: _processPartialDocNo,
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
          showToast('Balance MRIF created: ' + data.balDocNo + ' (' + (data.status || 'COMPLETED') + ')', 'success');
          if (typeof updatePartialCount === 'function') updatePartialCount();
          if (typeof fetchPendingDocs === 'function') fetchPendingDocs(true);
          setTimeout(function() {
            var p = document.getElementById('partialItemsModal');
            if (p) {
              var pm2 = bootstrap.Modal.getInstance(p);
              if (pm2 && pm2._isShown) openPartialItemsModal();
            }
          }, 400);
        } else {
          showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
        }
      } catch(err) {
        showToast('Error: ' + err.message, 'danger');
      }
    }, 'Creating Balance...');
  };

  window.updatePartialCount = async function() {
    try {
      var items = await fetchPartialItems();
      var el = document.getElementById('kpiPartial');
      if (el) el.textContent = items.length;
    } catch(err) {}
  };

})(); // end IIFE
