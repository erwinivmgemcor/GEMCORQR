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
  qrCache: {}
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
    var rows = await erpFetch('erp_items',
      'select=item_code,description,category,location,base_unit' +
      '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false' +
      '&order=item_code.asc&limit=5000');

    _bg.allItems = rows || [];
    console.log('[BarcodeGen] Loaded ' + _bg.allItems.length + ' items in ' + (Date.now() - t0) + 'ms');

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

  var limit = Math.min(_bg.filteredItems.length, 500);
  var count = 0;
  for (var i = 0; i < limit; i++) {
    var code = _bg.filteredItems[i].item_code;
    if (!_bg.selectedItems[code]) {
      _bg.selectedItems[code] = true;
      count++;
    }
  }

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

  if (selectedCodes.length > 500) {
    if (!confirm('You have ' + selectedCodes.length + ' items selected. ' +
                 'Printing more than 500 labels may take a while. Continue?')) {
      return;
    }
  }

  var selectedItems = _bg.allItems.filter(function(it) {
    return _bg.selectedItems[it.item_code];
  });

  // Update modal
  document.getElementById('bgPreviewCount').textContent = selectedItems.length + ' labels';

  // Render label grid
  bgRenderLabelGrid('bgLabelGrid', selectedItems);

  // Also render for print
  bgRenderLabelGrid('bgPrintGrid', selectedItems);

  // Show modal
  if (!_bg.previewModal) {
    _bg.previewModal = new bootstrap.Modal(document.getElementById('bgPreviewModal'), {
      backdrop: 'static'
    });
  }
  _bg.previewModal.show();
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

  // Make sure QR images are loaded bago mag-print
  var images = printArea.querySelectorAll('img');
  var loaded = 0;
  var total = images.length;

  if (total === 0) {
    _triggerPrint(printArea);
    return;
  }

  var checkDone = function() {
    loaded++;
    if (loaded >= total) {
      _triggerPrint(printArea);
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

  // Fallback timeout — just print after 2 seconds
  setTimeout(function() {
    if (loaded < total) {
      console.log('[BarcodeGen] Timeout waiting for images, printing anyway');
      _triggerPrint(printArea);
    }
  }, 2000);
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

console.log('✅ barcode-generator.js v1.0 loaded');
