// ============================================================
// GEMCOR ERP — Create PRF (v2.5)
// Two Modes: "From Reorder List" + "Manual Entry"
// ✅ v2.4: Select All / Deselect All checkbox bug
// ✅ v2.5: Pending PRF detection + Net Need auto-adjust
// ============================================================

var MAX_ITEMS_PER_PRF = 30;

var _prf = {
  mode: 'reorder',
  items: [],
  selectedItems: [],
  manualItems: [],
  reorderList: [],
  pendingPrfItems: {},
  pendingSummary: {},          // ✅ NEW: Aggregated pending per item
  inventoryList: [],
  inventoryLoaded: false,
  erpItemsMap: {},
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Create PRF v2.5] Initializing...');

  prfCheckHealth();
  initUserInfo();
  generatePrfNo();
  loadReorderList();
  loadPendingPrfItems();
  preloadInventoryForSearch();

  var catEl = document.getElementById('prfCategory');
  if (catEl) {
    catEl.addEventListener('change', onCategoryChange);
  }
});

async function prfCheckHealth() {
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

function initUserInfo() {
  var fullname = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
  var department = localStorage.getItem('ivm_userDepartment') || '';
  document.getElementById('prfPreparedBy').value = fullname;
  document.getElementById('prfDepartment').value = department;
}

function generatePrfNo() {
  var now = new Date();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  document.getElementById('prfNo').value = 'PRF#' + month + '-' + day;
}

// ═══════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════
function prfSwitchMode(mode) {
  _prf.mode = mode;

  document.querySelectorAll('.prf-mode-tab').forEach(function(el) {
    el.classList.toggle('active', el.dataset.mode === mode);
  });

  var reorderContent = document.getElementById('modeReorder');
  var manualContent = document.getElementById('modeManual');

  if (reorderContent) reorderContent.classList.toggle('active', mode === 'reorder');
  if (manualContent) manualContent.classList.toggle('active', mode === 'manual');

  var hint = document.getElementById('categoryHint');
  if (hint) {
    hint.textContent = mode === 'reorder'
      ? 'Required — pinipili kung anong category ng PRF.'
      : 'Required — parehong category gagamitin sa submission.';
  }

  // ✅ Toast alert kapag nag-switch sa reorder mode at may pending
  if (mode === 'reorder' && _prf.items.length > 0) {
    var pendingCount = _prf.items.filter(function(it) {
      return computeSuggestedBreakdown(it).pendingQty > 0;
    }).length;

    if (pendingCount > 0) {
      setTimeout(function() {
        erpShowToast('⚠️ ' + pendingCount + ' item(s) have pending PRF — check the ⚠ PENDING column', 'warning');
      }, 300);
    }
  }

  updateSubmitButton();
}
window.prfSwitchMode = prfSwitchMode;

// ═══════════════════════════════════════════════════════════
// UNIQUE PRF NO CHECK
// ═══════════════════════════════════════════════════════════
async function checkPrfNoAvailable(prfNo) {
  try {
    var res = await erpFetch('prf_documents',
      'prf_no=eq.' + encodeURIComponent(prfNo) + '&select=id&limit=1');
    return (!res || res.length === 0);
  } catch(e) {
    console.warn('[checkPrfNoAvailable]', e.message);
    return true;
  }
}

async function generateUniquePrfNo(basePrfNo) {
  var candidate = basePrfNo;
  var suffix = 1;

  while (!(await checkPrfNoAvailable(candidate))) {
    suffix++;
    candidate = basePrfNo + '-' + suffix;
    if (suffix > 100) throw new Error('Cannot generate unique PRF No.');
  }

  return candidate;
}

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function loadReorderList() {
  try {
    var rows = await erpFetch('erp_v_reorder_list', 'select=*');
    _prf.reorderList = rows || [];
    console.log('[PRF] Reorder list:', _prf.reorderList.length, 'items');
  } catch(err) {
    console.error('[PRF] Load failed:', err);
    erpShowToast('Failed to load reorder list: ' + err.message, 'danger');
  }
}

async function loadPendingPrfItems() {
  try {
    // ═══ Step 1: Load detailed items (per PRF line) ═══
    var rows = await erpFetch('erp_v_prf_pending_items', 'select=*');
    _prf.pendingPrfItems = {};
    
    (rows || []).forEach(function(r) {
      var code = String(r.item_code || '').trim();
      if (!code) return;
      if (!_prf.pendingPrfItems[code]) _prf.pendingPrfItems[code] = [];
      _prf.pendingPrfItems[code].push({
        prf_no: r.prf_no,
        base_prf_no: r.base_prf_no || r.prf_no,
        status: r.status,
        qty: Number(r.qty_for_order || 0),
        description: r.description || ''
      });
    });
    
    // ═══ Step 2: Load summary (aggregated per item) ═══
    _prf.pendingSummary = {};
    try {
      var summaryRows = await erpFetch('erp_v_prf_pending_summary', 'select=*');
      (summaryRows || []).forEach(function(s) {
        var code = String(s.item_code || '').trim();
        if (!code) return;
        _prf.pendingSummary[code] = {
          count: Number(s.pending_prf_count || 0),
          totalQty: Number(s.total_pending_qty || 0),
          prfNos: s.prf_nos || '',
          firstDate: s.first_prf_date,
          latestDate: s.latest_prf_date
        };
      });
      console.log('[PRF] Pending summary loaded:', Object.keys(_prf.pendingSummary).length, 'items');
    } catch(e) {
      console.warn('[PRF] Summary load failed, computing from detail:', e.message);
      // Fallback: compute from pendingPrfItems
      Object.keys(_prf.pendingPrfItems).forEach(function(code) {
        var items = _prf.pendingPrfItems[code];
        var uniquePrfs = {};
        var totalQty = 0;
        items.forEach(function(p) {
          var key = p.base_prf_no || p.prf_no;
          if (!uniquePrfs[key]) uniquePrfs[key] = true;
          totalQty += p.qty;
        });
        _prf.pendingSummary[code] = {
          count: Object.keys(uniquePrfs).length,
          totalQty: totalQty,
          prfNos: Object.keys(uniquePrfs).join(', ')
        };
      });
    }
    
    // Update global refs
    window._prfPending = _prf.pendingPrfItems;
    window._prfPendingSummary = _prf.pendingSummary;
    
    var pendingCount = Object.keys(_prf.pendingSummary).length;
    console.log('[PRF] Pending items loaded:', pendingCount);
    
    // Update UI banner
    var banner = document.getElementById('pendingPrfBanner');
    var countEl = document.getElementById('pendingPrfCount');
    if (banner && countEl) {
      if (pendingCount > 0) {
        countEl.textContent = pendingCount;
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }
    }
  } catch(err) {
    console.warn('[PRF] Pending items load failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// PENDING CHECK HELPERS
// ═══════════════════════════════════════════════════════════
function checkItemPendingPrf(itemCode) {
  if (!itemCode) return null;
  var code = String(itemCode).trim();
  var summary = _prf.pendingSummary[code];
  if (!summary || summary.totalQty === 0) return null;
  return summary;
}

window.checkItemPendingPrf = checkItemPendingPrf;

// ═══════════════════════════════════════════════════════════
// LOAD SEARCH CATALOG (erp_items — PAGINATED)
// ═══════════════════════════════════════════════════════════
async function preloadInventoryForSearch() {
  if (_prf.inventoryLoaded) return;

  try {
    console.log('[PRF] Loading search catalog from erp_items (paginated)...');

    var allRows = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;
    var pageNum = 1;

    while (hasMore) {
      var rows = await erpFetch('erp_items',
        'select=item_code,description,base_unit,category,location,on_hand,buffer_stock,ave_monthly_consumption' +
        '&is_active=eq.true&order=item_code.asc&limit=' + pageSize + '&offset=' + offset);

      if (!rows || rows.length === 0) {
        hasMore = false;
        break;
      }

      allRows = allRows.concat(rows);
      offset += rows.length;
      console.log('[PRF] Page ' + pageNum + ': ' + rows.length + ' items (total: ' + allRows.length + ')');
      pageNum++;

      if (rows.length < pageSize) hasMore = false;
      if (hasMore) await new Promise(function(r) { setTimeout(r, 100); });
    }

    console.log('[PRF] ✅ Total items fetched:', allRows.length);

    _prf.inventoryList = allRows.map(function(r) {
      return {
        code: r.item_code,
        description: r.description || '',
        unit: r.base_unit || 'PCS',
        itemClass: r.category || '',
        category: r.category || '',
        location: r.location || ''
      };
    });

    _prf.erpItemsMap = {};
    allRows.forEach(function(r) {
      _prf.erpItemsMap[String(r.item_code || '').trim()] = {
        buffer_stock: Number(r.buffer_stock || 0),
        on_hand: Number(r.on_hand || 0),
        ave_monthly_consumption: Number(r.ave_monthly_consumption || 0),
        base_unit: r.base_unit || 'PCS',
        location: r.location || '',
        category: r.category || ''
      };
    });

    _prf.inventoryLoaded = true;
    console.log('[PRF] ✅ Search catalog loaded:', _prf.inventoryList.length, 'items');

  } catch(err) {
    console.warn('[PRF] erp_items load failed:', err.message);
    _prf.inventoryList = [];
  }
}

function getSuggestedQty(itemCode) {
  var item = _prf.erpItemsMap[String(itemCode || '').trim()];
  if (!item) return 0;
  var diff = item.buffer_stock - item.on_hand;
  if (diff > 0) return Math.ceil(diff);
  return 0;
}

// ═══════════════════════════════════════════════════════════
// COMPUTE SUGGESTED (with pending deduction)
// ═══════════════════════════════════════════════════════════
function computeSuggested(it) {
  var breakdown = computeSuggestedBreakdown(it);
  return breakdown.netNeed;
}

function computeSuggestedBreakdown(it) {
  var itemCode = it.item_code || it.code || '';
  
  var buffer = Number(it.buffer_stock || 0);
  var onHand = Number(it.on_hand || 0);
  var baseNeed = buffer - onHand;
  if (baseNeed < 0) baseNeed = 0;
  
  var pendingInfo = _prf.pendingSummary[itemCode];
  var pendingQty = pendingInfo ? Number(pendingInfo.totalQty || 0) : 0;
  var pendingCount = pendingInfo ? Number(pendingInfo.count || 0) : 0;
  var prfNos = pendingInfo ? pendingInfo.prfNos : '';
  
  var netNeed = baseNeed - pendingQty;
  if (netNeed < 0) netNeed = 0;
  
  return {
    buffer: buffer,
    onHand: onHand,
    baseNeed: baseNeed,
    pendingQty: pendingQty,
    pendingCount: pendingCount,
    prfNos: prfNos,
    netNeed: Math.ceil(netNeed)
  };
}

window.computeSuggestedBreakdown = computeSuggestedBreakdown;

// ═══════════════════════════════════════════════════════════
// CATEGORY CHANGE (Reorder mode)
// ═══════════════════════════════════════════════════════════
function onCategoryChange() {
  if (_prf.mode !== 'reorder') return;

  var category = document.getElementById('prfCategory').value;
  var container = document.getElementById('reorderItemsContainer');

  if (!category) {
    container.innerHTML = '<div class="text-center text-muted py-4">' +
      '<i class="bi bi-inbox fs-1 d-block mb-2"></i>' +
      '<div>Select a category above to load items.</div></div>';
    _prf.items = [];
    updateSubmitButton();
    return;
  }

  _prf.items = _prf.reorderList.filter(function(it) {
    return String(it.category || '').toUpperCase() === category;
  });

  console.log('[PRF] Category:', category, 'Items:', _prf.items.length);
  renderReorderItems();
}

// ═══════════════════════════════════════════════════════════
// RENDER REORDER ITEMS (with pending column)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// RENDER REORDER ITEMS (v2.6 — Sort pending first + Filter)
// ═══════════════════════════════════════════════════════════
function renderReorderItems() {
  var container = document.getElementById('reorderItemsContainer');
  if (!container) return;

  if (_prf.items.length === 0) {
    container.innerHTML =
      '<div class="alert alert-info mb-0">' +
      '<i class="bi bi-info-circle me-2"></i>' +
      'No items found for this category in the reorder list. ' +
      'You can switch to <strong>Manual Entry</strong> to add items manually.</div>';
    updateSubmitButton();
    updateReorderTabBadge(0);
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // ✅ Filter: show only items with pending PRF (kung naka-check)
  // ═══════════════════════════════════════════════════════════
  var filterCheck = document.getElementById('filterPendingOnly');
  var filterPendingOnly = filterCheck ? filterCheck.checked : false;

  var itemsToRender = _prf.items.slice();

  if (filterPendingOnly) {
    itemsToRender = itemsToRender.filter(function(it) {
      return computeSuggestedBreakdown(it).pendingQty > 0;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ✅ Sort: pending items FIRST, then alphabetical by item_code
  // ═══════════════════════════════════════════════════════════
  itemsToRender.sort(function(a, b) {
    var aPending = computeSuggestedBreakdown(a).pendingQty;
    var bPending = computeSuggestedBreakdown(b).pendingQty;
    
    // Kung pareho (both may pending or both wala) → alphabetical
    if ((aPending > 0) === (bPending > 0)) {
      return String(a.item_code || '').localeCompare(String(b.item_code || ''));
    }
    
    // May pending → mas priority (top)
    return (bPending > 0 ? 1 : 0) - (aPending > 0 ? 1 : 0);
  });

  // ═══════════════════════════════════════════════════════════
  // ✅ Update tab badge (B)
  // ═══════════════════════════════════════════════════════════
  var pendingCountInCategory = _prf.items.filter(function(it) {
    return computeSuggestedBreakdown(it).pendingQty > 0;
  }).length;
  updateReorderTabBadge(pendingCountInCategory);

  // ═══════════════════════════════════════════════════════════
  // Empty state kapag na-filter lahat
  // ═══════════════════════════════════════════════════════════
  if (itemsToRender.length === 0) {
    container.innerHTML = '<div class="alert alert-success mb-0">' +
      '<i class="bi bi-check-circle-fill me-2"></i>' +
      '<strong>Walang items na may pending PRF sa category na ito! 🎉</strong>' +
      '<div class="small mt-1">Untick ang filter checkbox para makita lahat ng items.</div>' +
      '</div>';
    updateSubmitButton();
    return;
  }

  var allSelected = itemsToRender.length > 0 && itemsToRender.every(function(it) {
    return it._selected === true;
  });
  var someSelected = itemsToRender.some(function(it) { return it._selected === true; });

  var html = '<div class="table-responsive">';
  html += '<table class="erp-table" style="font-size:0.82rem;">';
  html += '<thead><tr>' +
    '<th style="width:3%">' +
      '<input type="checkbox" id="selectAllChk"' +
        (allSelected ? ' checked' : '') +
        ' onchange="toggleSelectAll(this.checked)" title="Select/Deselect All">' +
    '</th>' +
    '<th style="width:4%">#</th>' +
    '<th style="width:9%">Item Code</th>' +
    '<th style="width:16%">Description</th>' +
    '<th style="width:6%" class="text-center">Location</th>' +
    '<th style="width:5%" class="text-center">On-Hand</th>' +
    '<th style="width:5%" class="text-center">Buffer</th>' +
    '<th style="width:7%" class="text-center" title="Existing Pending UNSERVED PRF Qty">⚠ Pending</th>' +
    '<th style="width:6%" class="text-center" title="Net need = Buffer - On-Hand - Pending">Net Need</th>' +
    '<th style="width:8%" class="text-center">Qty For Order</th>' +
    '<th style="width:5%" class="text-center">Unit</th>' +
    '<th style="width:17%">Remarks</th>' +
  '</tr></thead><tbody>';

  itemsToRender.forEach(function(it, idx) {
    var breakdown = computeSuggestedBreakdown(it);
    var suggested = breakdown.netNeed;
    var isSelected = it._selected === true;
    var qtyOrder = it._qtyOrder !== undefined ? it._qtyOrder : 0;
    var remarks = it._remarks || '';
    
    // ✅ Find original index para sa callbacks (toggle, update)
    var originalIdx = _prf.items.indexOf(it);

    // ✅ Pending display
    var pendingDisplay = '<span class="text-muted">—</span>';
    if (breakdown.pendingQty > 0) {
      var tooltipText = 'PRF Nos:\n' + String(breakdown.prfNos).replace(/, /g, '\n');
      pendingDisplay = '<span title="' + erpEsc(tooltipText) + '" style="cursor:help;">' +
        '<strong class="text-warning">' + erpNum(breakdown.pendingQty) + '</strong>' +
        '<div style="font-size:0.65rem;color:#6b7280;">' +
        breakdown.pendingCount + ' PRF' + (breakdown.pendingCount > 1 ? 's' : '') +
        '</div></span>';
    }

    // ✅ Net Need display
    var netNeedDisplay = '';
    if (breakdown.pendingQty > 0) {
      netNeedDisplay = '<div style="text-decoration:line-through;color:#9ca3af;font-size:0.72rem;">' +
        erpNum(breakdown.baseNeed) + '</div>' +
        '<div><strong class="text-success">' + erpNum(suggested) + '</strong></div>';
    } else {
      netNeedDisplay = '<span class="text-muted" style="font-style:italic;">' + erpNum(suggested) + '</span>';
    }

    var urgencyBadge = '';
    if (it.urgency === 'CRITICAL') urgencyBadge = ' <span class="badge bg-danger">CRIT</span>';
    else if (it.urgency === 'URGENT') urgencyBadge = ' <span class="badge bg-warning text-dark">URG</span>';

    // ✅ Highlight row kapag may pending
    var rowStyle = '';
    if (isSelected) {
      rowStyle = ' style="background:#ecfdf5;"';
    } else if (breakdown.pendingQty > 0) {
      rowStyle = ' style="background:#fffbeb;"';
    }

    html += '<tr data-idx="' + originalIdx + '"' +
      rowStyle +
      (breakdown.pendingQty > 0 ? ' data-has-pending="true"' : '') + '>' +
      '<td><input type="checkbox" class="item-select-chk" data-idx="' + originalIdx + '"' +
        (isSelected ? ' checked' : '') +
        ' onchange="toggleItemSelect(' + originalIdx + ', this.checked)"></td>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code>' + urgencyBadge + '</td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-center">' + erpNum(it.on_hand || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.buffer_stock || 0) + '</td>' +
      '<td class="text-center">' + pendingDisplay + '</td>' +
      '<td class="text-center">' + netNeedDisplay + '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm qty-order-input" ' +
        'data-idx="' + originalIdx + '" value="' + qtyOrder + '" min="0" step="1" ' +
        'placeholder="' + Math.ceil(suggested) + '" onchange="updateQty(' + originalIdx + ', this.value)">' +
      '</td>' +
      '<td class="text-center">' +
        '<select class="form-select form-select-sm unit-select" data-idx="' + originalIdx + '" onchange="updateUnit(' + originalIdx + ', this.value)" style="font-size:0.75rem;padding:2px 4px;">' +
          buildUnitOptions(it.base_unit || 'PIECE') +
        '</select>' +
      '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm remarks-input" ' +
        'data-idx="' + originalIdx + '" value="' + erpEsc(remarks) + '" placeholder="Optional" ' +
        'onchange="updateRemarks(' + originalIdx + ', this.value)">' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';

  recomputeSelected();
  var totalQty = _prf.selectedItems.reduce(function(s, it) { return s + (it._qtyOrder || 0); }, 0);

  var batchingInfo = '';
  if (_prf.selectedItems.length > MAX_ITEMS_PER_PRF) {
    var batches = Math.ceil(_prf.selectedItems.length / MAX_ITEMS_PER_PRF);
    batchingInfo = '<span class="text-warning ms-3">' +
      '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
      'Will split into <strong>' + batches + '</strong> PRFs' +
      '</span>';
  }

  html += '<div class="mt-3 d-flex justify-content-between align-items-center flex-wrap gap-2">';
  html += '<div class="small text-muted">' +
    '<i class="bi bi-info-circle me-1"></i>' +
    'Net Need = (Buffer − On-Hand − Pending PRF)' +
    batchingInfo + '</div>';
  html += '<div class="d-flex align-items-center gap-3">';
  html += '<button type="button" class="btn btn-sm btn-outline-secondary" onclick="deselectAllItems()" title="Clear all selections">' +
    '<i class="bi bi-x-lg me-1"></i>Deselect All</button>';
  html += '<div><strong>Selected:</strong> ' + _prf.selectedItems.length +
    ' items · <strong>Total Qty:</strong> ' + erpNum(totalQty) + '</div>';
  html += '</div>';
  html += '</div>';

  container.innerHTML = html;

  var headerChk = document.getElementById('selectAllChk');
  if (headerChk && someSelected && !allSelected) {
    headerChk.indeterminate = true;
  }

  updateItemsCount();
  updateSubmitButton();
}

// ═══════════════════════════════════════════════════════════
// ✅ NEW: Update Reorder Tab Badge
// ═══════════════════════════════════════════════════════════
function updateReorderTabBadge(pendingCount) {
  var badge = document.getElementById('reorderPendingBadge');
  if (!badge) return;
  
  if (pendingCount > 0) {
    badge.textContent = pendingCount + ' ⚠';
    badge.style.display = 'inline-block';
    badge.className = 'badge bg-warning text-dark ms-1';
  } else {
    badge.style.display = 'none';
  }
}

window.updateReorderTabBadge = updateReorderTabBadge;

// ═══════════════════════════════════════════════════════════
// ✅ NEW: Show Pending Reorder List (from current category)
// ═══════════════════════════════════════════════════════════
function showPendingReorderList() {
  // Collect items with pending from current reorder list
  var pendingItems = _prf.items.filter(function(it) {
    return computeSuggestedBreakdown(it).pendingQty > 0;
  });

  if (pendingItems.length === 0) {
    erpShowToast('Walang pending items sa category na ito', 'info');
    return;
  }

  var html = '<div style="padding:10px;">';
  html += '<div class="alert alert-warning small mb-3">' +
    '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
    '<strong>' + pendingItems.length + ' item(s)</strong> sa category na ito ang may pending PRF. ' +
    'Ang <strong>Net Need</strong> ay awtomatikong naka-deduct sa pending qty.' +
    '</div>';
  
  html += '<div class="table-responsive" style="max-height:500px;overflow-y:auto;">';
  html += '<table class="table table-sm table-bordered" style="font-size:0.82rem;">';
  html += '<thead class="table-light sticky-top"><tr>' +
    '<th>Item Code</th>' +
    '<th>Description</th>' +
    '<th class="text-center">On-Hand</th>' +
    '<th class="text-center">Buffer</th>' +
    '<th class="text-center">⚠ Pending</th>' +
    '<th class="text-center">Net Need</th>' +
    '<th class="text-center">Pending PRF(s)</th>' +
    '</tr></thead><tbody>';

  pendingItems.forEach(function(it) {
    var breakdown = computeSuggestedBreakdown(it);
    
    html += '<tr style="background:#fffbeb;">' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + erpNum(it.on_hand || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.buffer_stock || 0) + '</td>' +
      '<td class="text-center"><strong class="text-warning">' + erpNum(breakdown.pendingQty) + '</strong></td>' +
      '<td class="text-center"><strong class="text-success">' + erpNum(breakdown.netNeed) + '</strong></td>' +
      '<td><small>' + erpEsc(breakdown.prfNos) + '</small></td>' +
    '</tr>';
  });

  html += '</tbody></table></div></div>';

  // Create/reuse modal
  var modalEl = document.getElementById('pendingReorderListModal');
  if (modalEl) modalEl.remove();

  var wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="modal fade" id="pendingReorderListModal" tabindex="-1">' +
    '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
      '<div class="modal-content">' +
        '<div class="modal-header" style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#fff;">' +
          '<h5 class="modal-title"><i class="bi bi-exclamation-triangle-fill me-2"></i>Pending Items (Current Category)</h5>' +
          '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
        '</div>' +
        '<div class="modal-body p-0">' + html + '</div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
  document.body.appendChild(wrapper.firstChild);

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('pendingReorderListModal'));
  modal.show();
}

window.showPendingReorderList = showPendingReorderList;
// ═══════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════
function toggleItemSelect(idx, checked) {
  var item = _prf.items[idx];
  if (!item) return;
  item._selected = checked;
  if (checked && (!item._qtyOrder || item._qtyOrder === 0)) {
    item._qtyOrder = computeSuggested(item);
  } else if (!checked) {
    item._qtyOrder = 0;
  }
  recomputeSelected();
  renderReorderItems();
}

window.toggleItemSelect = toggleItemSelect;

function toggleSelectAll(checked) {
  console.log('[PRF] Toggle Select All:', checked, '| Items:', _prf.items.length);

  _prf.items.forEach(function(it) {
    it._selected = checked;
    if (checked) {
      it._qtyOrder = computeSuggested(it);
    } else {
      it._qtyOrder = 0;
    }
  });

  recomputeSelected();
  renderReorderItems();
}

window.toggleSelectAll = toggleSelectAll;

function deselectAllItems() {
  console.log('[PRF] Deselect All');
  _prf.items.forEach(function(it) {
    it._selected = false;
    it._qtyOrder = 0;
  });
  recomputeSelected();
  renderReorderItems();
}

window.deselectAllItems = deselectAllItems;

function updateQty(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  var qty = parseFloat(value) || 0;
  if (qty < 0) qty = 0;
  item._qtyOrder = qty;
  if (qty > 0) item._selected = true;
  recomputeSelected();
  updateSubmitButton();
}

window.updateQty = updateQty;

function updateUnit(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  item.base_unit = value;
}

window.updateUnit = updateUnit;

function updateRemarks(idx, value) {
  var item = _prf.items[idx];
  if (!item) return;
  item._remarks = String(value || '').trim();
}

window.updateRemarks = updateRemarks;

function recomputeSelected() {
  _prf.selectedItems = _prf.items.filter(function(it) {
    return it._selected && (it._qtyOrder || 0) > 0;
  });
}

// ═══════════════════════════════════════════════════════════
// MANUAL ITEMS
// ═══════════════════════════════════════════════════════════
function addManualItem() {
  _prf.manualItems.push({
    inventoryId: '',
    description: '',
    qty: 0,
    unit: 'PIECE',
    remarks: ''
  });
  renderManualItems();
  updateSubmitButton();

  setTimeout(function() {
    var inputs = document.querySelectorAll('.manual-item-search-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
}

window.addManualItem = addManualItem;

function renderManualItems() {
  var container = document.getElementById('manualItemsContainer');
  var emptyState = document.getElementById('manualEmptyState');
  if (!container) return;

  if (_prf.manualItems.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.innerHTML = '';
    if (emptyState) container.appendChild(emptyState);
    updateManualCount();
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  var html = '';
  _prf.manualItems.forEach(function(it, idx) {
    var erpItem = _prf.erpItemsMap[it.inventoryId] || {};
    var breakdown = it.inventoryId ? computeSuggestedBreakdown({
      item_code: it.inventoryId,
      buffer_stock: erpItem.buffer_stock || 0,
      on_hand: erpItem.on_hand || 0
    }) : null;
    
    var suggestedQty = breakdown ? breakdown.netNeed : 0;
    
    // ✅ Pending warning
    var warningHtml = '';
    if (breakdown && breakdown.pendingQty > 0 && it.inventoryId) {
      var warningClass = breakdown.pendingCount >= 2 ? 'alert-danger' : 'alert-warning';
      warningHtml = '<div class="alert ' + warningClass + ' py-2 px-3 mt-2 mb-0 small">' +
        '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
        '<strong>May existing pending PRF!</strong> ' +
        '<code>' + erpEsc(breakdown.prfNos) + '</code>' +
        '<div class="mt-1" style="font-size:0.78rem;">' +
        'Pending qty: <strong class="text-danger">' + erpNum(breakdown.pendingQty) + '</strong> · ' +
        'Original need: ' + erpNum(breakdown.baseNeed) + ' · ' +
        '<strong class="text-success">Net: ' + erpNum(breakdown.netNeed) + '</strong>' +
        '</div>' +
        '</div>';
    }
    
    // ✅ Breakdown display
    var breakdownHtml = '';
    if (breakdown && it.inventoryId && breakdown.buffer > 0) {
      breakdownHtml = '<div class="small text-muted mt-1" style="font-size:0.75rem;">' +
        'Buffer: <strong>' + erpNum(breakdown.buffer) + '</strong> · ' +
        'On-Hand: ' + erpNum(breakdown.onHand) + ' · ' +
        (breakdown.pendingQty > 0 
          ? 'Pending: <strong class="text-warning">' + erpNum(breakdown.pendingQty) + '</strong> · ' 
          : '') +
        'Net Need: <strong class="text-success">' + erpNum(breakdown.netNeed) + '</strong>' +
        '</div>';
    }

    html += '<div class="manual-item-row" data-idx="' + idx + '">' +
      '<div class="row g-2 align-items-end">' +
        '<div class="col-md-4">' +
          '<label class="form-label small fw-bold mb-1">Item Code <span class="text-danger">*</span></label>' +
          '<div class="item-search-wrapper">' +
            '<input type="text" class="form-control form-control-sm manual-item-search-input" ' +
              'data-idx="' + idx + '" ' +
              'value="' + erpEsc(it.inventoryId) + '" ' +
              'placeholder="Search item code or description..." ' +
              'autocomplete="off" ' +
              'oninput="onManualItemSearch(' + idx + ', this.value)" ' +
              'onfocus="onManualItemSearch(' + idx + ', this.value)">' +
            '<div class="item-search-dropdown d-none" id="manualDropdown' + idx + '"></div>' +
          '</div>' +
        '</div>' +
        '<div class="col-md-3">' +
          '<label class="form-label small fw-bold mb-1">Description</label>' +
          '<input type="text" class="form-control form-control-sm" ' +
            'id="manualDesc' + idx + '" ' +
            'value="' + erpEsc(it.description) + '" ' +
            'readonly>' +
        '</div>' +
        '<div class="col-md-1">' +
          '<label class="form-label small fw-bold mb-1">Qty <span class="text-danger">*</span></label>' +
          '<input type="number" class="form-control form-control-sm text-center" ' +
            'id="manualQty' + idx + '" ' +
            'value="' + (it.qty || '') + '" ' +
            'min="1" step="1" ' +
            'oninput="onManualQtyChange(' + idx + ', this.value)">' +
          (suggestedQty > 0 ? '<div class="suggested-qty-hint">Net: <strong>' + suggestedQty + '</strong></div>' : '') +
        '</div>' +
        '<div class="col-md-1">' +
          '<label class="form-label small fw-bold mb-1">Unit</label>' +
          '<select class="form-select form-select-sm" id="manualUnit' + idx + '" onchange="onManualUnitChange(' + idx + ', this.value)">' +
            buildUnitOptions(it.unit || 'PIECE') +
          '</select>' +
        '</div>' +
        '<div class="col-md-2">' +
          '<label class="form-label small fw-bold mb-1">Remarks</label>' +
          '<input type="text" class="form-control form-control-sm" ' +
            'id="manualRemarks' + idx + '" ' +
            'value="' + erpEsc(it.remarks || '') + '" ' +
            'placeholder="Optional" ' +
            'oninput="onManualRemarksChange(' + idx + ', this.value)">' +
        '</div>' +
        '<div class="col-md-1">' +
          '<button type="button" class="btn btn-sm btn-outline-danger w-100" ' +
            'onclick="removeManualItem(' + idx + ')" title="Remove">' +
            '<i class="bi bi-trash"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
      warningHtml +
      breakdownHtml +
    '</div>';
  });

  container.innerHTML = html;
  updateManualCount();
}

window.renderManualItems = renderManualItems;

function onManualItemSearch(idx, value) {
  var input = document.querySelector('.manual-item-search-input[data-idx="' + idx + '"]');
  var dropdown = document.getElementById('manualDropdown' + idx);
  if (!dropdown || !input) return;

  var term = String(value || '').toLowerCase().trim();

  if (!term) {
    dropdown.classList.add('d-none');
    return;
  }

  if (!_prf.inventoryLoaded) {
    dropdown.innerHTML = '<div class="item-search-item muted">Loading catalog...</div>';
    _positionDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    return;
  }

  var matches = _prf.inventoryList.filter(function(it) {
    var code = String(it.code || '').toLowerCase();
    var desc = String(it.description || '').toLowerCase();
    return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
  }).slice(0, 30);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="item-search-item muted">No matches found. You can type manually.</div>';
    _positionDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    return;
  }

  var html = '';
  matches.forEach(function(it) {
    var erpItem = _prf.erpItemsMap[it.code] || {};
    var breakdown = computeSuggestedBreakdown({
      item_code: it.code,
      buffer_stock: erpItem.buffer_stock || 0,
      on_hand: erpItem.on_hand || 0
    });
    
    var pendingBadge = '';
    if (breakdown.pendingQty > 0) {
      var pendingClass = breakdown.pendingCount >= 2 ? 'bg-danger' : 'bg-warning text-dark';
      pendingBadge = '<span class="badge ' + pendingClass + '" title="Pending: ' + 
        erpEsc(breakdown.prfNos) + '">' +
        '⚠ ' + breakdown.pendingQty + ' pending</span>';
    }

    html += '<div class="item-search-item" onclick="selectManualItem(' + idx + ', \'' +
      erpJsEsc(it.code) + '\', \'' + erpJsEsc(it.description) + '\', \'' + erpJsEsc(it.unit) + '\')">' +
      '<div class="item-code">' + erpEsc(it.code) + '</div>' +
      '<div class="item-desc">' + erpEsc(it.description.substring(0, 100)) + '</div>' +
      '<div class="item-meta">' +
        '<span class="badge bg-light text-dark">' + erpEsc(it.unit || 'PCS') + '</span>' +
        (breakdown.onHand !== undefined ? '<span>On-Hand: <strong>' + erpNum(breakdown.onHand) + '</strong></span>' : '') +
        (breakdown.buffer > 0 ? '<span>Buffer: ' + erpNum(breakdown.buffer) + '</span>' : '') +
        (breakdown.netNeed > 0 ? '<span class="text-success">Net: <strong>' + breakdown.netNeed + '</strong></span>' : '') +
        pendingBadge +
      '</div>' +
    '</div>';
  });

  dropdown.innerHTML = html;
  _positionDropdown(dropdown, input);
  dropdown.classList.remove('d-none');
}

window.onManualItemSearch = onManualItemSearch;

function _positionDropdown(dropdown, input) {
  var rect = input.getBoundingClientRect();
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;
  var dropdownMinHeight = 320;

  var width = Math.max(rect.width, 420);
  var maxWidth = window.innerWidth - rect.left - 20;
  if (width > maxWidth) width = maxWidth;

  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = width + 'px';
  dropdown.style.zIndex = '99999';

  if (spaceBelow < dropdownMinHeight && spaceAbove > spaceBelow) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceAbove - 20, 320) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceBelow - 20, 320) + 'px';
  }
}

function selectManualItem(idx, code, description, unit) {
  var item = _prf.manualItems[idx];
  if (!item) return;

  item.inventoryId = code;
  item.description = description;
  item.unit = unit || 'PIECE';

  // ✅ Auto-set qty based sa net need
  var erpItem = _prf.erpItemsMap[code] || {};
  var breakdown = computeSuggestedBreakdown({
    item_code: code,
    buffer_stock: erpItem.buffer_stock || 0,
    on_hand: erpItem.on_hand || 0
  });
  
  if (!item.qty || item.qty === 0) {
    item.qty = breakdown.netNeed || 1;
  }

  // ✅ Confirm kung may pending
  if (breakdown.pendingQty > 0) {
    var msg = '⚠️ ATTENTION: Item ' + code + ' has existing pending PRF(s):\n\n';
    msg += '📋 ' + breakdown.prfNos + '\n';
    msg += '📊 Total pending qty: ' + breakdown.pendingQty + '\n\n';
    msg += '💡 Net Need (auto-computed): ' + breakdown.netNeed + '\n\n';
    msg += 'Do you want to proceed?';
    
    if (!confirm(msg)) {
      _prf.manualItems.splice(idx, 1);
      renderManualItems();
      updateSubmitButton();
      erpShowToast('Item removed', 'info');
      return;
    }
  }

  renderManualItems();
  updateSubmitButton();
}

window.selectManualItem = selectManualItem;

function onManualQtyChange(idx, value) {
  var item = _prf.manualItems[idx];
  if (!item) return;
  item.qty = parseFloat(value) || 0;
  updateSubmitButton();
}

window.onManualQtyChange = onManualQtyChange;

function onManualUnitChange(idx, value) {
  var item = _prf.manualItems[idx];
  if (!item) return;
  item.unit = value;
}

window.onManualUnitChange = onManualUnitChange;

function onManualRemarksChange(idx, value) {
  var item = _prf.manualItems[idx];
  if (!item) return;
  item.remarks = String(value || '').trim();
}

window.onManualRemarksChange = onManualRemarksChange;

function removeManualItem(idx) {
  if (!confirm('Remove this item?')) return;
  _prf.manualItems.splice(idx, 1);
  renderManualItems();
  updateSubmitButton();
}

window.removeManualItem = removeManualItem;

function updateManualCount() {
  var el = document.getElementById('manualItemsCount');
  if (el) el.textContent = _prf.manualItems.length + ' manual item(s)';
}

// ═══════════════════════════════════════════════════════════
// SUBMIT BUTTON STATE
// ═══════════════════════════════════════════════════════════
function updateSubmitButton() {
  var btn = document.getElementById('btnSubmitPrf');
  var summary = document.getElementById('submitSummary');
  if (!btn) return;

  var reorderCount = 0;
  var manualCount = 0;

  if (_prf.mode === 'reorder') {
    recomputeSelected();
    reorderCount = _prf.selectedItems.length;
  } else {
    recomputeSelected();
    reorderCount = _prf.selectedItems.length;
  }

  manualCount = _prf.manualItems.filter(function(it) {
    return it.inventoryId && it.inventoryId.trim() && it.qty > 0;
  }).length;

  var totalValid = reorderCount + manualCount;

  var category = document.getElementById('prfCategory').value;
  if (!category) {
    btn.disabled = true;
    summary.textContent = 'Please select a category first.';
    return;
  }

  if (totalValid === 0) {
    btn.disabled = true;
    summary.textContent = 'Select items from reorder list OR add manual items.';
    return;
  }

  btn.disabled = false;

  var summaryParts = [];
  if (reorderCount > 0) summaryParts.push(reorderCount + ' reorder item(s)');
  if (manualCount > 0) summaryParts.push(manualCount + ' manual item(s)');
  summary.textContent = summaryParts.join(' + ') + ' ready to submit.';
}

function updateItemsCount() {
  var el = document.getElementById('itemsCountLabel');
  if (!el) return;
  var reorderCount = _prf.selectedItems.length;
  var manualCount = _prf.manualItems.length;
  var total = reorderCount + manualCount;
  el.textContent = '(' + total + ' items)';
}

// ═══════════════════════════════════════════════════════════
// SHOW PENDING PRF LIST
// ═══════════════════════════════════════════════════════════
function showPendingPrfList() {
  var pending = _prf.pendingSummary;
  var keys = Object.keys(pending);
  
  if (keys.length === 0) {
    erpShowToast('No pending PRF items', 'info');
    return;
  }
  
  var html = '<div style="padding:10px;">';
  html += '<h6 class="mb-3">Items with Pending UNSERVED PRF (' + keys.length + ')</h6>';
  html += '<div class="table-responsive" style="max-height:400px;overflow-y:auto;">';
  html += '<table class="table table-sm table-bordered" style="font-size:0.82rem;">';
  html += '<thead class="table-light sticky-top"><tr>' +
    '<th>Item Code</th>' +
    '<th>Pending PRF(s)</th>' +
    '<th class="text-end">Total Qty</th>' +
    '</tr></thead><tbody>';
  
  keys.sort().forEach(function(code) {
    var s = pending[code];
    html += '<tr>' +
      '<td><code>' + erpEsc(code) + '</code></td>' +
      '<td><small>' + erpEsc(s.prfNos) + '</small></td>' +
      '<td class="text-end fw-bold text-danger">' + erpNum(s.totalQty) + '</td>' +
    '</tr>';
  });
  
  html += '</tbody></table></div></div>';
  
  var modalEl = document.getElementById('pendingPrfListModal');
  if (modalEl) modalEl.remove();
  
  var wrapper = document.createElement('div');
  wrapper.innerHTML = '<div class="modal fade" id="pendingPrfListModal" tabindex="-1">' +
    '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
      '<div class="modal-content">' +
        '<div class="modal-header" style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#fff;">' +
          '<h5 class="modal-title"><i class="bi bi-exclamation-triangle-fill me-2"></i>Pending PRF Items</h5>' +
          '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
        '</div>' +
        '<div class="modal-body p-0">' + html + '</div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
  document.body.appendChild(wrapper.firstChild);
  
  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('pendingPrfListModal'));
  modal.show();
}

window.showPendingPrfList = showPendingPrfList;

// ═══════════════════════════════════════════════════════════
// SUBMIT PRF
// ═══════════════════════════════════════════════════════════
async function submitPrf() {
  if (_prf.isSubmitting) return;

  var prfNo = document.getElementById('prfNo').value.trim();
  var category = document.getElementById('prfCategory').value;
  var preparedBy = document.getElementById('prfPreparedBy').value.trim();
  var department = document.getElementById('prfDepartment').value.trim();
  var notedBy = document.getElementById('prfNotedBy').value.trim();
  var approvedBy = document.getElementById('prfApprovedBy').value.trim();
  var notes = document.getElementById('prfNotes').value.trim();

  if (!prfNo) { erpShowToast('PRF No. required', 'warning'); return; }
  if (!category) { erpShowToast('Category required', 'warning'); return; }

  var allItems = [];

  recomputeSelected();
  _prf.selectedItems.forEach(function(it) {
    allItems.push({
      item_code: it.item_code,
      description: it.description || '',
      category: it.category || category,
      location: it.location || '',
      average_consumption: Number(it.ave_monthly_consumption || 0),
      buffer_stock: Number(it.buffer_stock || 0),
      stock_on_hand: Number(it.on_hand || 0),
      qty_for_order: Number(it._qtyOrder || 0),
      unit: it.base_unit || 'PIECE',
      remarks: it._remarks || '',
      source: 'reorder'
    });
  });

  _prf.manualItems.forEach(function(it) {
    if (!it.inventoryId || !it.inventoryId.trim()) return;
    if (!it.qty || it.qty <= 0) return;

    var erpItem = _prf.erpItemsMap[it.inventoryId] || {};
    allItems.push({
      item_code: it.inventoryId,
      description: it.description || '',
      category: category,
      location: erpItem.location || '',
      average_consumption: Number(erpItem.ave_monthly_consumption || 0),
      buffer_stock: Number(erpItem.buffer_stock || 0),
      stock_on_hand: Number(erpItem.on_hand || 0),
      qty_for_order: Number(it.qty),
      unit: it.unit || 'PIECE',
      remarks: it.remarks || '',
      source: 'manual'
    });
  });

  if (allItems.length === 0) {
    erpShowToast('Select at least one item with qty > 0', 'warning');
    return;
  }

  // ✅ Detect duplicates bago mag-submit
  var duplicateItems = [];
  allItems.forEach(function(it) {
    var pendingInfo = _prf.pendingSummary[it.item_code];
    if (pendingInfo && pendingInfo.totalQty > 0) {
      duplicateItems.push({
        item: it,
        pending: pendingInfo
      });
    }
  });

  var batches = [];
  if (allItems.length > MAX_ITEMS_PER_PRF) {
    for (var i = 0; i < allItems.length; i += MAX_ITEMS_PER_PRF) {
      batches.push(allItems.slice(i, i + MAX_ITEMS_PER_PRF));
    }
  } else {
    batches.push(allItems);
  }

  var isAvailable = await checkPrfNoAvailable(prfNo);
  if (!isAvailable) {
    var originalPrfNo = prfNo;
    prfNo = await generateUniquePrfNo(prfNo);
    console.log('[PRF] Auto-unique:', originalPrfNo, '→', prfNo);
    erpShowToast('PRF No. adjusted to ' + prfNo, 'info');
  }

  for (var bIdx = 0; bIdx < batches.length; bIdx++) {
    var batchBase = prfNo + (bIdx === 0 ? '' : '.' + (bIdx + 1));
    var batchAvailable = await checkPrfNoAvailable(batchBase);
    if (!batchAvailable) {
      var counter = 2;
      var testNo;
      do {
        testNo = batchBase + '-' + counter;
        counter++;
      } while (!(await checkPrfNoAvailable(testNo)) && counter < 20);
      batches[bIdx]._prfNo = testNo;
    } else {
      batches[bIdx]._prfNo = batchBase;
    }
  }

  // ✅ Build confirmation message
  var confirmMsg = 'Create PRF with ' + allItems.length + ' item(s)?\n\n';
  if (batches.length > 1) {
    confirmMsg += 'Will be split into ' + batches.length + ' batches:\n';
    batches.forEach(function(b) {
      confirmMsg += '  • ' + b._prfNo + ' (' + b.length + ' items)\n';
    });
    confirmMsg += '\n';
  }
  confirmMsg += 'Base PRF No.: ' + prfNo;
  confirmMsg += '\nTotal qty: ' + allItems.reduce(function(s, it) { return s + (it.qty_for_order || 0); }, 0);

  if (duplicateItems.length > 0) {
    confirmMsg += '\n\n⚠️ WARNING: ' + duplicateItems.length + ' item(s) may duplicate existing PRF:\n\n';
    duplicateItems.slice(0, 5).forEach(function(d) {
      confirmMsg += '• ' + d.item.item_code + '\n';
      confirmMsg += '  Pending: ' + d.pending.prfNos + '\n';
      confirmMsg += '  Pending Qty: ' + d.pending.totalQty + ' · New Qty: ' + d.item.qty_for_order + '\n';
    });
    if (duplicateItems.length > 5) {
      confirmMsg += '\n... and ' + (duplicateItems.length - 5) + ' more\n';
    }
    confirmMsg += '\nAre you SURE you want to proceed?';
  }

  if (!confirm(confirmMsg)) return;

  _prf.isSubmitting = true;
  var btn = document.getElementById('btnSubmitPrf');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

  try {
    var createdPrfs = [];

    for (var bIdx2 = 0; bIdx2 < batches.length; bIdx2++) {
      var batch = batches[bIdx2];
      var batchPrfNo = batch._prfNo;
      var result = await createSinglePrf(
        batchPrfNo, prfNo, bIdx2 + 1, batch,
        category, preparedBy, department, notedBy, approvedBy, notes
      );
      createdPrfs.push(result);
    }

    document.getElementById('successPrfNo').textContent = createdPrfs.map(function(p) { return p.prf_no; }).join(', ');
    document.getElementById('successItemCount').textContent = allItems.length;
    document.getElementById('successCategory').textContent = category;

    new bootstrap.Modal(document.getElementById('successModal')).show();

  } catch(err) {
    console.error('[submitPrf]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  } finally {
    _prf.isSubmitting = false;
  }
}

window.submitPrf = submitPrf;

async function createSinglePrf(prfNo, basePrfNo, batchNumber, items, category, preparedBy, department, notedBy, approvedBy, notes) {
  var totalQty = items.reduce(function(s, it) { return s + (it.qty_for_order || 0); }, 0);

  var docRes = await fetch(erpUrl('prf_documents'), {
    method: 'POST',
    headers: erpHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify({
      prf_no: prfNo,
      base_prf_no: basePrfNo,
      version_number: 1,
      batch_number: batchNumber,
      category: category,
      requestor: preparedBy,
      department: department,
      notes: notes,
      purpose: 'STOCK',
      total_items: items.length,
      total_qty: totalQty,
      prepared_by: preparedBy,
      noted_by: notedBy,
      approved_by: approvedBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });

  if (!docRes.ok) {
    var errText = await docRes.text();
    throw new Error('Insert PRF failed: ' + docRes.status);
  }

  var docArr = await docRes.json();
  var doc = docArr[0];
  if (!doc || !doc.id) throw new Error('No PRF ID');

  var itemPayloads = items.map(function(it, idx) {
    return {
      prf_id: doc.id,
      prf_no: prfNo,
      line_no: idx + 1,
      item_code: it.item_code,
      description: it.description || '',
      category: it.category || category,
      location: it.location || '',
      average_consumption: Number(it.average_consumption || 0),
      buffer_stock: Number(it.buffer_stock || 0),
      stock_on_hand: Number(it.stock_on_hand || 0),
      qty_for_order: Number(it.qty_for_order || 0),
      unit: it.unit || 'PIECE',
      status: 'UNSERVED',
      remarks: it.remarks || ''
    };
  });

  var itemsRes = await fetch(erpUrl('prf_items'), {
    method: 'POST',
    headers: erpHeaders(),
    body: JSON.stringify(itemPayloads)
  });

  if (!itemsRes.ok) {
    var itemsErrText = await itemsRes.text();
    throw new Error('Insert items failed: ' + itemsRes.status);
  }

  return { prf_no: prfNo, items: items.length };
}

function closeSuccessAndReset() {
  var modal = bootstrap.Modal.getInstance(document.getElementById('successModal'));
  if (modal) modal.hide();
  setTimeout(function() {
    window.location.href = 'prf-monitor.html';
  }, 300);
}

window.closeSuccessAndReset = closeSuccessAndReset;

function cancelCreate() {
  if (!confirm('Cancel? Unsaved data will be lost.')) return;
  window.location.href = 'prf-monitor.html';
}

window.cancelCreate = cancelCreate;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function buildUnitOptions(selected) {
  var units = ['PIECE', 'PCS', 'PAIR', 'SET', 'BOX', 'ROLL', 'SHEET',
    'KG', 'LITERS', 'GAL', 'METER', 'MM', 'LENGTH',
    'ASSEMB', 'CAN', 'REAM', 'TANK', 'UNIT'];
  var html = '';
  units.forEach(function(u) {
    var sel = (u === selected) ? ' selected' : '';
    html += '<option value="' + u + '"' + sel + '>' + u + '</option>';
  });
  return html;
}

function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpJsEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.item-search-wrapper') && !e.target.closest('.item-search-dropdown')) {
    document.querySelectorAll('.item-search-dropdown').forEach(function(el) {
      el.classList.add('d-none');
    });
  }
});

window.addEventListener('scroll', function() {
  document.querySelectorAll('.item-search-dropdown:not(.d-none)').forEach(function(el) {
    var idx = el.id.replace('manualDropdown', '');
    var input = document.querySelector('.manual-item-search-input[data-idx="' + idx + '"]');
    if (input) _positionDropdown(el, input);
  });
}, { passive: true });

window.addEventListener('resize', function() {
  document.querySelectorAll('.item-search-dropdown:not(.d-none)').forEach(function(el) {
    el.classList.add('d-none');
  });
});

console.log('✅ new-prf.js v2.5 loaded (pending PRF + net need)');
