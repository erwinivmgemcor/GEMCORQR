// ============================================================
// GEMCOR ERP — Barcode / QR Generator (v1.0)
// Batch QR label printing for warehouse items
// Label: 2" x 1" (Avery 5163) — 4 cols × 10 rows per sheet
// ============================================================

var _bg = {
  allItems: [],
  filteredItems: [],
  selectedItems: {},
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  previewModal: null,
  showCutLines: true,
  qrCache: {},
  
  // ✅ BATCH PRINT STATE
  printItems: [],         // All items to print
  batchMode: 'batched',   // 'all' | 'batched' | 'custom'
  batchSize: 300,
  currentBatch: 0,        // 0-indexed
  totalBatches: 1,
  customFrom: 1,
  customTo: 100
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Barcode Generator v1.0] Initializing...');

  bgCheckHealth();
  bgLoad();
});

async function bgCheckHealth() {
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
// LOAD ITEMS
// ═══════════════════════════════════════════════════════════
async function bgLoad() {
  var grid = document.getElementById('bgItemsGrid');
  if (grid) {
    grid.innerHTML = '<div class="text-center py-5 w-100" style="grid-column: 1 / -1;">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2 text-muted">Loading items...</div>' +
      '</div>';
  }

  try {
    var t0 = Date.now();

    // ✅ PAGINATED FETCH — bypass PostgREST 1000-row default limit
    var allRows = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;
    var maxPages = 20;
    var pageNum = 0;

    while (hasMore && pageNum < maxPages) {
      pageNum++;
      var rows = await erpFetch('erp_items',
        'select=item_code,description,category,location,base_unit' +
        '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false' +
        '&order=item_code.asc&limit=' + pageSize + '&offset=' + offset);

      if (!rows || rows.length === 0) {
        hasMore = false;
        break;
      }

      allRows = allRows.concat(rows);
      offset += rows.length;

      console.log('[BarcodeGen] Page ' + pageNum + ': fetched ' + rows.length + ' (total: ' + allRows.length + ')');

      if (rows.length < pageSize) hasMore = false;
      if (hasMore) await new Promise(function(r) { setTimeout(r, 100); });
    }

    _bg.allItems = allRows;
    console.log('[BarcodeGen] ✅ Loaded ' + _bg.allItems.length + ' items in ' + (Date.now() - t0) + 'ms');

    bgPopulateFilters();
    bgRender();

  } catch(err) {
    console.error('[bgLoad]', err);
    if (grid) {
      grid.innerHTML = '<div class="text-center py-5 w-100 text-danger" style="grid-column: 1 / -1;">' +
        '<i class="bi bi-exclamation-triangle-fill fs-2 d-block mb-2"></i>' +
        'Failed: ' + bgEsc(err.message) +
        '</div>';
    }
  }
}
// ═══════════════════════════════════════════════════════════
// POPULATE FILTERS
// ═══════════════════════════════════════════════════════════
function bgPopulateFilters() {
  var catSel = document.getElementById('bgCategoryFilter');
  var locSel = document.getElementById('bgLocationFilter');
  if (!catSel || !locSel) return;

  var currentCat = catSel.value;
  var currentLoc = locSel.value;

  var cats = {}, locs = {};
  _bg.allItems.forEach(function(it) {
    if (it.category) cats[it.category] = true;
    if (it.location) locs[it.location] = true;
  });

  catSel.innerHTML = '<option value="">All Categories</option>';
  Object.keys(cats).sort().forEach(function(c) {
    catSel.innerHTML += '<option value="' + bgEsc(c) + '"' + (c === currentCat ? ' selected' : '') + '>' + bgEsc(c) + '</option>';
  });

  locSel.innerHTML = '<option value="">All Locations</option>';
  Object.keys(locs).sort().forEach(function(l) {
    locSel.innerHTML += '<option value="' + bgEsc(l) + '"' + (l === currentLoc ? ' selected' : '') + '>' + bgEsc(l) + '</option>';
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER GRID
// ═══════════════════════════════════════════════════════════
function bgRender() {
  var grid = document.getElementById('bgItemsGrid');
  if (!grid) return;

  var search = (document.getElementById('bgSearchInput').value || '').toLowerCase().trim();
  var catFilter = document.getElementById('bgCategoryFilter').value;
  var locFilter = document.getElementById('bgLocationFilter').value;
  var sortBy = document.getElementById('bgSortFilter').value;

  // Filter
  _bg.filteredItems = _bg.allItems.filter(function(it) {
    if (catFilter && it.category !== catFilter) return false;
    if (locFilter && it.location !== locFilter) return false;

    if (search) {
      var code = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      if (code.indexOf(search) === -1 && desc.indexOf(search) === -1) return false;
    }
    return true;
  });

  // Sort
  _bg.filteredItems.sort(function(a, b) {
    switch (sortBy) {
      case 'code_desc':
        return String(b.item_code || '').localeCompare(String(a.item_code || ''));
      case 'desc_asc':
        return String(a.description || '').localeCompare(String(b.description || ''));
      case 'category':
        var catA = String(a.category || '').localeCompare(String(b.category || ''));
        if (catA !== 0) return catA;
        return String(a.item_code || '').localeCompare(String(b.item_code || ''));
      case 'code_asc':
      default:
        return String(a.item_code || '').localeCompare(String(b.item_code || ''));
    }
  });

  // Pagination
  var total = _bg.filteredItems.length;
  var start = (_bg.currentPage - 1) * _bg.pageSize;
  var end = Math.min(start + _bg.pageSize, total);
  var pageItems = _bg.filteredItems.slice(start, end);

  document.getElementById('bgTableCount').textContent = total + ' items';
  document.getElementById('bgPageTotal').textContent = total;
  document.getElementById('bgPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('bgPageEnd').textContent = end;
  document.getElementById('bgPageLabel').textContent = 'Page ' + _bg.currentPage;

  document.getElementById('bgBtnPrev').disabled = (_bg.currentPage <= 1);
  document.getElementById('bgBtnNext').disabled = (end >= total);

  var subtitle = document.getElementById('bgTableSubtitle');
  if (subtitle) {
    if (search || catFilter || locFilter) {
      subtitle.textContent = 'Filtered results · click items to select';
    } else {
      subtitle.textContent = 'Click items to select for printing';
    }
  }

  if (pageItems.length === 0) {
    grid.innerHTML = '<div class="text-center py-5 w-100 text-muted" style="grid-column: 1 / -1;">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</div>';
    bgUpdateBulkBar();
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var isSelected = _bg.selectedItems[it.item_code] === true;
    var safeCode = String(it.item_code || '').replace(/'/g, "\\'");

    html += '<div class="bg-item-card' + (isSelected ? ' selected' : '') + '" ' +
      'onclick="bgToggleItem(\'' + safeCode + '\', event)">' +
      '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' ' +
        'onclick="event.stopPropagation();bgToggleItem(\'' + safeCode + '\', event)">' +
      '<div class="bg-item-body">' +
        '<div class="bg-item-code">' + bgEsc(it.item_code) + '</div>' +
        '<div class="bg-item-desc">' + bgEsc(it.description || '—') + '</div>' +
        '<div class="bg-item-meta">' +
          (it.category ? '<span class="badge bg-primary">' + bgEsc(it.category) + '</span>' : '') +
          (it.location ? '<span class="badge bg-light text-dark">' + bgEsc(bgTruncate(it.location, 20)) + '</span>' : '') +
          (it.base_unit ? '<span class="badge bg-secondary">' + bgEsc(it.base_unit) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  });
  grid.innerHTML = html;

  bgUpdateBulkBar();
}

// ═══════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════
function bgToggleItem(itemCode, event) {
  if (_bg.selectedItems[itemCode]) {
    delete _bg.selectedItems[itemCode];
  } else {
    _bg.selectedItems[itemCode] = true;
  }
  bgRender();
}

function bgSelectAllFiltered() {
  if (_bg.filteredItems.length === 0) {
    erpShowToast('No items to select', 'warning');
    return;
  }

  // ✅ NEW: Warning kung sobrang dami (pero puwede pa rin)
  var totalFiltered = _bg.filteredItems.length;
  
  if (totalFiltered > 500) {
    var proceed = confirm(
      'You are about to select ' + totalFiltered + ' items.\n\n' +
      '⚠️ Warning: Printing ' + totalFiltered + ' labels will use a lot of paper.\n' +
      'Estimated sheets: ' + Math.ceil(totalFiltered / 40) + ' (Avery 5163)\n\n' +
      'Continue?'
    );
    if (!proceed) return;
  }

  // ✅ Walang limit — select lahat ng filtered
  var count = 0;
  _bg.filteredItems.forEach(function(it) {
    if (!_bg.selectedItems[it.item_code]) {
      _bg.selectedItems[it.item_code] = true;
      count++;
    }
  });

  bgRender();
  erpShowToast('✓ Selected ' + count + ' item(s)', 'success');
}

function bgClearSelection() {
  _bg.selectedItems = {};
  bgRender();
  erpShowToast('Selection cleared', 'info');
}

function bgUpdateBulkBar() {
  var count = Object.keys(_bg.selectedItems).length;
  var bar = document.getElementById('bgBulkBar');
  var countEl = document.getElementById('bgBulkCount');
  var previewBtn = document.getElementById('bgPreviewBtn');

  if (bar) {
    bar.classList.toggle('active', count > 0);
  }
  if (countEl) {
    countEl.textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';
  }
  if (previewBtn) {
    previewBtn.disabled = (count === 0);
  }
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function bgOnSearch() {
  clearTimeout(_bg.searchTimer);
  _bg.searchTimer = setTimeout(function() {
    _bg.currentPage = 1;
    bgRender();
  }, 300);
}

function bgClearFilters() {
  document.getElementById('bgSearchInput').value = '';
  document.getElementById('bgCategoryFilter').value = '';
  document.getElementById('bgLocationFilter').value = '';
  document.getElementById('bgSortFilter').value = 'code_asc';
  _bg.currentPage = 1;
  bgRender();
}

function bgPagePrev() {
  if (_bg.currentPage > 1) {
    _bg.currentPage--;
    bgRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function bgPageNext() {
  var maxPage = Math.ceil(_bg.filteredItems.length / _bg.pageSize);
  if (_bg.currentPage < maxPage) {
    _bg.currentPage++;
    bgRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function bgRefresh() {
  erpShowToast('Refreshing...', 'info');
  bgLoad();
  bgCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// QR CODE GENERATION
// ═══════════════════════════════════════════════════════════
function bgGetQrUrl(code, size) {
  size = size || 120;
  // Cache key
  var key = code + '_' + size;
  if (_bg.qrCache[key]) return _bg.qrCache[key];

  var url = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
            '&data=' + encodeURIComponent(code) +
            '&qzone=1&margin=0';
  _bg.qrCache[key] = url;
  return url;
}

// ═══════════════════════════════════════════════════════════
// PREVIEW MODAL
// ═══════════════════════════════════════════════════════════
function bgOpenPreviewModal() {
  var selectedCodes = Object.keys(_bg.selectedItems);
  if (selectedCodes.length === 0) {
    erpShowToast('Select at least one item', 'warning');
    return;
  }

  // Gather selected items
  var selectedItems = _bg.allItems.filter(function(it) {
    return _bg.selectedItems[it.item_code];
  });

  // ✅ Store items for batch processing
  _bg.printItems = selectedItems;
  _bg.currentBatch = 0;
  _bg.customFrom = 1;
  _bg.customTo = Math.min(selectedItems.length, _bg.batchSize);

  // ✅ Auto-suggest batch mode kung > 100 items
  if (selectedItems.length > 100 && _bg.batchMode === 'all') {
    _bg.batchMode = 'batched';
  }

  // Update modal
  document.getElementById('bgPreviewCount').textContent = selectedItems.length + ' labels';

  // Update batch controls
  bgUpdateBatchControls();

  // Render initial batch
  bgRenderCurrentBatch();

  // Show modal
  if (!_bg.previewModal) {
    _bg.previewModal = new bootstrap.Modal(document.getElementById('bgPreviewModal'), {
      backdrop: 'static'
    });
  }
  _bg.previewModal.show();
}

// ✅ Compute total batches
function bgComputeBatches() {
  var total = _bg.printItems.length;
  var mode = _bg.batchMode;
  var batchSize = _bg.batchSize;

  if (mode === 'all') {
    _bg.totalBatches = 1;
    return;
  }

  if (mode === 'custom') {
    var range = _bg.customTo - _bg.customFrom + 1;
    if (range < 1) range = 1;
    _bg.totalBatches = Math.ceil(range / batchSize);
    return;
  }

  // batched mode
  _bg.totalBatches = Math.ceil(total / batchSize);
}

// ✅ Get items for current batch
function bgGetCurrentBatchItems() {
  var total = _bg.printItems.length;
  var mode = _bg.batchMode;
  var batchSize = _bg.batchSize;

  if (mode === 'all') {
    return _bg.printItems;
  }

  if (mode === 'custom') {
    var from = Math.max(1, _bg.customFrom) - 1;  // 0-indexed
    var to = Math.min(total, _bg.customTo);       // exclusive
    var subset = _bg.printItems.slice(from, to);
    var batchStart = _bg.currentBatch * batchSize;
    var batchEnd = Math.min(batchStart + batchSize, subset.length);
    return subset.slice(batchStart, batchEnd);
  }

  // batched mode
  var start = _bg.currentBatch * batchSize;
  var end = Math.min(start + batchSize, total);
  return _bg.printItems.slice(start, end);
}

// ✅ Render current batch
function bgRenderCurrentBatch() {
  var batchItems = bgGetCurrentBatchItems();

  // Render sa preview
  bgRenderLabelGrid('bgLabelGrid', batchItems);

  // Render sa print area
  bgRenderLabelGrid('bgPrintGrid', batchItems);

  // Update nav info
  var total = _bg.printItems.length;
  var mode = _bg.batchMode;
  var batchSize = _bg.batchSize;

  var labelEl = document.getElementById('bgCurrentBatchLabel');
  var rangeEl = document.getElementById('bgBatchRange');

  if (mode === 'all') {
    if (labelEl) labelEl.textContent = 'All items';
    if (rangeEl) rangeEl.textContent = total + ' labels total';
  } else if (mode === 'custom') {
    var from = Math.max(1, _bg.customFrom);
    var to = Math.min(total, _bg.customTo);
    var subsetSize = to - from + 1;
    var batchStart = _bg.currentBatch * batchSize;
    var batchEnd = Math.min(batchStart + batchSize, subsetSize);

    if (labelEl) labelEl.textContent = (_bg.currentBatch + 1) + ' of ' + _bg.totalBatches;
    if (rangeEl) rangeEl.textContent = 'Items ' + (from + batchStart) + '–' + (from + batchEnd - 1) + ' of ' + total;
  } else {
    var start = _bg.currentBatch * batchSize;
    var end = Math.min(start + batchSize, total);
    if (labelEl) labelEl.textContent = (_bg.currentBatch + 1) + ' of ' + _bg.totalBatches;
    if (rangeEl) rangeEl.textContent = 'Items ' + (start + 1) + '–' + end + ' of ' + total;
  }

  // Update print button label
  var printBtnText = document.getElementById('bgBtnPrintLabelsText');
  if (printBtnText) {
    if (mode === 'all') {
      printBtnText.textContent = 'Print All (' + total + ' labels)';
    } else {
      var count = batchItems.length;
      printBtnText.textContent = 'Print Batch ' + (_bg.currentBatch + 1) + ' (' + count + ' labels)';
    }
  }

  // Update nav buttons
  var btnPrev = document.getElementById('bgBtnPrevBatch');
  var btnNext = document.getElementById('bgBtnNextBatch');

  if (btnPrev) btnPrev.disabled = (_bg.currentBatch <= 0);
  if (btnNext) btnNext.disabled = (_bg.currentBatch >= _bg.totalBatches - 1);
}

// ✅ Update batch controls visibility
function bgUpdateBatchControls() {
  var modeSelect = document.getElementById('bgBatchMode');
  var batchSizeWrap = document.getElementById('bgBatchSizeWrap');
  var customFromWrap = document.getElementById('bgCustomFromWrap');
  var customToWrap = document.getElementById('bgCustomToWrap');
  var batchNav = document.getElementById('bgBatchNav');
  var summary = document.getElementById('bgBatchSummary');

  if (modeSelect) modeSelect.value = _bg.batchMode;

  // Show/hide batch size
  if (batchSizeWrap) {
    batchSizeWrap.classList.toggle('d-none', _bg.batchMode === 'all');
  }

  // Show/hide custom range
  if (customFromWrap) customFromWrap.classList.toggle('d-none', _bg.batchMode !== 'custom');
  if (customToWrap) customToWrap.classList.toggle('d-none', _bg.batchMode !== 'custom');

  // Show/hide batch nav
  if (batchNav) {
    batchNav.classList.toggle('d-none', _bg.batchMode === 'all' || _bg.totalBatches <= 1);
  }

  // Set custom inputs
  var fromInput = document.getElementById('bgCustomFrom');
  var toInput = document.getElementById('bgCustomTo');
  var total = _bg.printItems.length;
  if (fromInput) fromInput.max = total;
  if (toInput) toInput.max = total;
  if (fromInput) fromInput.value = _bg.customFrom;
  if (toInput) toInput.value = _bg.customTo;

  // Summary
  if (summary) {
    var sheets = Math.ceil(total / 40);
    var msg = '<i class="bi bi-printer me-1"></i>';
    msg += '<strong>' + total + '</strong> labels total';
    if (_bg.batchMode === 'batched') {
      msg += ' · Will print in <strong>' + _bg.totalBatches + '</strong> batches';
      msg += ' · <strong>' + sheets + '</strong> sheets';
    } else if (_bg.batchMode === 'custom') {
      var range = _bg.customTo - _bg.customFrom + 1;
      msg += ' · Printing <strong>' + range + '</strong> (custom range)';
    } else {
      msg += ' · <strong>' + sheets + '</strong> sheets';
    }
    summary.innerHTML = msg;
  }
}

// ✅ Batch mode change
function bgOnBatchModeChange() {
  _bg.batchMode = document.getElementById('bgBatchMode').value;
  _bg.currentBatch = 0;

  bgComputeBatches();
  bgUpdateBatchControls();
  bgRenderCurrentBatch();
}

// ✅ Batch size change
function bgOnBatchSizeChange() {
  _bg.batchSize = parseInt(document.getElementById('bgBatchSize').value, 10) || 300;
  _bg.currentBatch = 0;

  bgComputeBatches();
  bgUpdateBatchControls();
  bgRenderCurrentBatch();
}

// ✅ Custom range change
function bgOnCustomRangeChange() {
  var from = parseInt(document.getElementById('bgCustomFrom').value, 10) || 1;
  var to = parseInt(document.getElementById('bgCustomTo').value, 10) || 100;

  if (from < 1) from = 1;
  if (to < from) to = from;
  if (to > _bg.printItems.length) to = _bg.printItems.length;

  _bg.customFrom = from;
  _bg.customTo = to;
  _bg.currentBatch = 0;

  bgComputeBatches();
  bgUpdateBatchControls();
  bgRenderCurrentBatch();
}

// ✅ Next batch
function bgNextBatch() {
  if (_bg.currentBatch < _bg.totalBatches - 1) {
    _bg.currentBatch++;
    bgRenderCurrentBatch();
  }
}

// ✅ Prev batch
function bgPrevBatch() {
  if (_bg.currentBatch > 0) {
    _bg.currentBatch--;
    bgRenderCurrentBatch();
  }
}

function bgClosePreview() {
  if (_bg.previewModal) _bg.previewModal.hide();
}

function bgRenderLabelGrid(containerId, items) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var html = '';
  items.forEach(function(it) {
    var qrUrl = bgGetQrUrl(it.item_code, 100);

    html += '<div class="bg-label">' +
      '<div class="bg-label-qr">' +
        '<img src="' + qrUrl + '" alt="QR" loading="lazy">' +
      '</div>' +
      '<div class="bg-label-info">' +
        '<div class="bg-label-code">' + bgEsc(it.item_code) + '</div>' +
        (it.description ? '<div class="bg-label-desc">' + bgEsc(bgTruncate(it.description, 60)) + '</div>' : '') +
        (it.location ? '<div class="bg-label-loc"><i class="bi bi-geo-alt-fill"></i> ' + bgEsc(bgTruncate(it.location, 20)) + '</div>' : '') +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;

  // Update cut lines visibility
  bgUpdateCutLines();
}

function bgToggleBorders() {
  _bg.showCutLines = !_bg.showCutLines;
  bgUpdateCutLines();

  var btn = document.getElementById('bgBorderToggle');
  if (btn) {
    btn.classList.toggle('active', _bg.showCutLines);
    btn.innerHTML = '<i class="bi bi-border-all me-1"></i>' +
      (_bg.showCutLines ? 'Cut Lines ON' : 'Cut Lines OFF');
  }
}

function bgUpdateCutLines() {
  var labels = document.querySelectorAll('.bg-label');
  labels.forEach(function(el) {
    if (_bg.showCutLines) {
      el.style.border = '1px dashed rgba(0,0,0,0.15)';
    } else {
      el.style.border = '1px solid transparent';
    }
  });
}

function bgRegenerateQR() {
  _bg.qrCache = {};
  erpShowToast('Regenerating QR codes...', 'info');

  var selectedItems = _bg.allItems.filter(function(it) {
    return _bg.selectedItems[it.item_code];
  });

  bgRenderLabelGrid('bgLabelGrid', selectedItems);
  bgRenderLabelGrid('bgPrintGrid', selectedItems);
}

// ═══════════════════════════════════════════════════════════
// PRINT
// ═══════════════════════════════════════════════════════════
function bgPrintLabels() {
  var printArea = document.getElementById('bgPrintArea');
  if (!printArea) {
    erpShowToast('Print area not found', 'danger');
    return;
  }

  var batchItems = bgGetCurrentBatchItems();
  var batchCount = batchItems.length;
  var isBatch = _bg.batchMode !== 'all' && _bg.totalBatches > 1;

  // ✅ Warning for printing
  var msg = '';
  if (_bg.batchMode === 'all') {
    msg = 'Print ALL ' + batchCount + ' labels?\n\n' +
          '📄 Sheets needed: ~' + Math.ceil(batchCount / 40) + '\n' +
          '⏱️ Estimated time: ' + Math.ceil(batchCount / 50) + ' seconds';
  } else {
    msg = 'Print Batch ' + (_bg.currentBatch + 1) + ' of ' + _bg.totalBatches + '?\n\n' +
          '📄 Labels in this batch: ' + batchCount + '\n' +
          '📄 Sheets needed: ~' + Math.ceil(batchCount / 40) + '\n' +
          '⏱️ Estimated time: ' + Math.ceil(batchCount / 50) + ' seconds';
  }

  if (!confirm(msg)) return;

  // Make sure QR images are loaded bago mag-print
  var images = printArea.querySelectorAll('img');
  var loaded = 0;
  var total = images.length;

  var printBtn = document.getElementById('bgBtnPrintLabels');
  var originalHtml = printBtn ? printBtn.innerHTML : '';
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Preparing...';
  }

  var doPrint = function() {
    if (printBtn) {
      printBtn.disabled = false;
      printBtn.innerHTML = originalHtml;
    }
    _triggerPrint(printArea);
  };

  if (total === 0) {
    doPrint();
    return;
  }

  var checkDone = function() {
    loaded++;
    if (printBtn) {
      printBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>' +
        'Loading ' + loaded + '/' + total;
    }
    if (loaded >= total) {
      doPrint();
    }
  };

  images.forEach(function(img) {
    if (img.complete) {
      checkDone();
    } else {
      img.onload = checkDone;
      img.onerror = checkDone;
    }
  });

  // Fallback timeout
  setTimeout(function() {
    if (loaded < total) {
      console.log('[BarcodeGen] Timeout waiting for images, printing anyway');
      doPrint();
    }
  }, 5000);
}
function _triggerPrint(printArea) {
  printArea.style.display = 'block';

  setTimeout(function() {
    window.print();

    setTimeout(function() {
      printArea.style.display = 'none';
    }, 1000);
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function bgEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bgTruncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// Expose to global
window.bgOpenPreviewModal = bgOpenPreviewModal;
window.bgClosePreview = bgClosePreview;
window.bgPrintLabels = bgPrintLabels;
window.bgToggleBorders = bgToggleBorders;
window.bgRegenerateQR = bgRegenerateQR;
window.bgToggleItem = bgToggleItem;
window.bgSelectAllFiltered = bgSelectAllFiltered;
window.bgClearSelection = bgClearSelection;
window.bgRefresh = bgRefresh;
window.bgClearFilters = bgClearFilters;
window.bgOnSearch = bgOnSearch;
window.bgPagePrev = bgPagePrev;
window.bgPageNext = bgPageNext;
window.bgRender = bgRender;

// ✅ Batch print controls
window.bgOnBatchModeChange = bgOnBatchModeChange;
window.bgOnBatchSizeChange = bgOnBatchSizeChange;
window.bgOnCustomRangeChange = bgOnCustomRangeChange;
window.bgNextBatch = bgNextBatch;
window.bgPrevBatch = bgPrevBatch;

console.log('✅ barcode-generator.js v1.0 loaded');
