// ============================================================
// GEMCOR ERP — PRF Monitor (v3.1)
// Two Tabs + Bulk Status Update + PO# Display from erp_prf_po_cache
// ============================================================

var _prfMonitor = {
  activeTab: 'prf',
  allPrfs: [],
  allItems: [],
  poCacheMap: {},              // "PRF_NO|ITEM_NO" → { po_no, supplier, date_delivered }
  filteredPrfs: [],
  filteredItems: [],
  currentPrfPage: 1,
  currentItemPage: 1,
  prfPageSize: 20,
  itemPageSize: 50,
  searchTimer: null,
  currentPrf: null,
  selectedItems: {}
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[PRF Monitor v3.1] Initializing...');

  prfMonitorCheckHealth();
  prfMonitorLoad();
  prfMonitorPopulateFilters();
});

async function prfMonitorCheckHealth() {
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
// FETCH PO CACHE (from erp_prf_po_cache)
// ═══════════════════════════════════════════════════════════
async function prfMonitorFetchPoCache() {
  try {
    // Fetch lahat ng may PO# — limit 10000 para safe
    var rows = await erpFetch('erp_prf_po_cache',
      'select=prf_no,item_no,po_no,supplier,date_delivered&po_no=not.is.null&limit=10000');

    // Build lookup map
    var map = {};
    (rows || []).forEach(function(r) {
      var key = String(r.prf_no || '').trim() + '|' + (parseInt(r.item_no, 10) || 0);
      map[key] = {
        po_no: String(r.po_no || '').trim(),
        supplier: String(r.supplier || '').trim(),
        date_delivered: r.date_delivered || ''
      };
    });

    console.log('[PRF Monitor] PO cache loaded:', Object.keys(map).length, 'entries');
    return map;
  } catch(err) {
    console.warn('[PRF Monitor] PO cache fetch failed:', err.message);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════
function prfSwitchTab(tab) {
  _prfMonitor.activeTab = tab;

  document.querySelectorAll('.prf-tab').forEach(function(el) {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  var prfContent = document.getElementById('tabContentPrf');
  var itemContent = document.getElementById('tabContentItem');

  if (prfContent) prfContent.style.display = (tab === 'prf') ? 'block' : 'none';
  if (itemContent) itemContent.style.display = (tab === 'item') ? 'block' : 'none';

  console.log('[PRF Monitor] Switched to tab:', tab);
}

window.prfSwitchTab = prfSwitchTab;

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function prfMonitorLoad() {
  var prfBody = document.getElementById('prfTableBody');
  var itemBody = document.getElementById('itemTableBody');

  if (prfBody) {
    prfBody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading PRFs...</div></td></tr>';
  }
  if (itemBody) {
    itemBody.innerHTML = '<tr><td colspan="13" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading items...</div></td></tr>';
  }

  try {
    // ─── Query 1: Fetch PRF documents ───
    var query = 'select=*&order=created_at.desc&limit=2000';

    var catFilterEl = document.getElementById('prfCategoryFilter');
    if (catFilterEl && catFilterEl.value) {
      query += '&category=eq.' + encodeURIComponent(catFilterEl.value);
    }

    var reqFilterEl = document.getElementById('prfRequestorFilter');
    if (reqFilterEl && reqFilterEl.value) {
      query += '&requestor=eq.' + encodeURIComponent(reqFilterEl.value);
    }

    var fromDateEl = document.getElementById('prfDateFrom');
    if (fromDateEl && fromDateEl.value) {
      query += '&created_at=gte.' + encodeURIComponent(fromDateEl.value + 'T00:00:00');
    }

    var toDateEl = document.getElementById('prfDateTo');
    if (toDateEl && toDateEl.value) {
      query += '&created_at=lt.' + encodeURIComponent(toDateEl.value + 'T23:59:59');
    }

    var prfs = await erpFetch('prf_documents', query);
    _prfMonitor.allPrfs = prfs || [];
    console.log('[PRF Monitor v3.1] Loaded', _prfMonitor.allPrfs.length, 'PRFs');

    // ─── Query 2: Fetch items ───
    if (_prfMonitor.allPrfs.length > 0) {
      var prfIds = _prfMonitor.allPrfs.map(function(p) { return p.id; });
      var allItems = [];

      var chunkSize = 100;
      for (var c = 0; c < prfIds.length; c += chunkSize) {
        var chunk = prfIds.slice(c, c + chunkSize);
        try {
          var itemsQuery = 'select=*&prf_id=in.(' + chunk.join(',') + ')&order=prf_no.asc,line_no.asc&limit=10000';
          var itemsChunk = await erpFetch('prf_items', itemsQuery);
          if (itemsChunk) allItems = allItems.concat(itemsChunk);
        } catch(e) {
          console.warn('[PRF Monitor] Items chunk failed:', e.message);
        }
      }

      // Enrich items with PRF metadata
      var prfMap = {};
      _prfMonitor.allPrfs.forEach(function(p) {
        prfMap[p.id] = p;
      });

      allItems.forEach(function(it) {
        var prf = prfMap[it.prf_id] || {};
        it._prfNo = prf.prf_no || '';
        it._prfDate = prf.created_at || '';
        it._prfCategory = prf.category || '';
        it._prfRequestor = prf.requestor || '';
      });

      _prfMonitor.allItems = allItems;
      console.log('[PRF Monitor v3.1] Loaded', allItems.length, 'items');
    } else {
      _prfMonitor.allItems = [];
    }

    // ─── Query 3: Fetch PO cache (NEW) ───
    try {
      _prfMonitor.poCacheMap = await prfMonitorFetchPoCache();
    } catch(e) {
      console.warn('[PRF Monitor] Could not load PO cache:', e.message);
      _prfMonitor.poCacheMap = {};
    }

    // ─── Compute statuses + KPIs ───
    prfMonitorComputeStatus();
    prfMonitorComputeKPIs();
    prfUpdateTabCounts();

    // ─── Render both tabs ───
    prfMonitorRenderPrfTab();
    prfMonitorRenderItemTab();

  } catch(err) {
    console.error('[prfMonitorLoad]', err);
    if (prfBody) {
      prfBody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
        'Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
    if (itemBody) {
      itemBody.innerHTML = '<tr><td colspan="13" class="erp-empty text-danger">' +
        'Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function prfUpdateTabCounts() {
  var prfCountEl = document.getElementById('prfTabCount');
  var itemCountEl = document.getElementById('itemTabCount');

  if (prfCountEl) prfCountEl.textContent = _prfMonitor.allPrfs.length;
  if (itemCountEl) itemCountEl.textContent = _prfMonitor.allItems.length;
}

// ═══════════════════════════════════════════════════════════
// COMPUTE STATUS (per document)
// ═══════════════════════════════════════════════════════════
function prfMonitorComputeStatus() {
  var itemsByPrf = {};
  _prfMonitor.allItems.forEach(function(it) {
    if (!itemsByPrf[it.prf_id]) itemsByPrf[it.prf_id] = [];
    itemsByPrf[it.prf_id].push(String(it.status || 'UNSERVED').toUpperCase());
  });

  _prfMonitor.allPrfs.forEach(function(prf) {
    var statuses = itemsByPrf[prf.id] || [];
    var counts = { UNSERVED: 0, STAGGERED: 0, SERVED: 0, CANCELED: 0 };
    statuses.forEach(function(s) {
      if (counts[s] !== undefined) counts[s]++;
    });

    var total = statuses.length;
    var servedCount = counts.SERVED;
    var canceledCount = counts.CANCELED;
    var activeCount = total - canceledCount;

    if (activeCount === 0 && total > 0) {
      prf._status = 'CANCELED';
    } else if (servedCount === activeCount && activeCount > 0) {
      prf._status = 'SERVED';
    } else if (servedCount > 0 || counts.STAGGERED > 0) {
      prf._status = 'STAGGERED';
    } else {
      prf._status = 'UNSERVED';
    }

    prf._statusCounts = counts;
    prf._statusTotal = total;
  });
}

// ═══════════════════════════════════════════════════════════
// COMPUTE KPIs (item-level)
// ═══════════════════════════════════════════════════════════
function prfMonitorComputeKPIs() {
  var totalItems = 0;
  var unservedItems = 0;
  var staggeredItems = 0;
  var servedItems = 0;
  var canceledItems = 0;

  _prfMonitor.allItems.forEach(function(it) {
    totalItems++;
    var s = String(it.status || 'UNSERVED').toUpperCase();
    if (s === 'UNSERVED') unservedItems++;
    else if (s === 'STAGGERED') staggeredItems++;
    else if (s === 'SERVED') servedItems++;
    else if (s === 'CANCELED') canceledItems++;
  });

  var prfCount = _prfMonitor.allPrfs.length;

  document.getElementById('prfKpiTotal').textContent = erpNum(totalItems);
  document.getElementById('prfKpiUnserved').textContent = erpNum(unservedItems);
  document.getElementById('prfKpiStaggered').textContent = erpNum(staggeredItems);
  document.getElementById('prfKpiServed').textContent = erpNum(servedItems);
  document.getElementById('prfKpiCanceled').textContent = erpNum(canceledItems);

  var totalSub = document.getElementById('prfKpiTotalSub');
  if (totalSub) totalSub.textContent = 'across ' + prfCount + ' PRF' + (prfCount === 1 ? '' : 's');

  console.log('[PRF KPI] Items:', totalItems,
    '| Unserved:', unservedItems,
    '| Staggered:', staggeredItems,
    '| Served:', servedItems,
    '| Canceled:', canceledItems);
}

// ═══════════════════════════════════════════════════════════
// RENDER TAB 1: BY PRF
// ═══════════════════════════════════════════════════════════
function prfMonitorRenderPrfTab() {
  var tbody = document.getElementById('prfTableBody');
  if (!tbody) return;

  var searchInput = document.getElementById('prfSearchInput');
  var statusFilterEl = document.getElementById('prfStatusFilter');

  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';

  _prfMonitor.filteredPrfs = _prfMonitor.allPrfs.filter(function(p) {
    if (statusFilter && String(p._status || '').toUpperCase() !== statusFilter) return false;

    if (search) {
      var prfNo = String(p.prf_no || '').toLowerCase();
      var req = String(p.requestor || '').toLowerCase();
      if (prfNo.indexOf(search) === -1 && req.indexOf(search) === -1) return false;
    }
    return true;
  });

  var total = _prfMonitor.filteredPrfs.length;
  var start = (_prfMonitor.currentPrfPage - 1) * _prfMonitor.prfPageSize;
  var end = Math.min(start + _prfMonitor.prfPageSize, total);
  var pageItems = _prfMonitor.filteredPrfs.slice(start, end);

  document.getElementById('prfTableCount').textContent = total + ' items';
  document.getElementById('prfPageTotal').textContent = total;
  document.getElementById('prfPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('prfPageEnd').textContent = end;
  document.getElementById('prfPageLabel').textContent = 'Page ' + _prfMonitor.currentPrfPage;

  document.getElementById('prfBtnPrev').disabled = (_prfMonitor.currentPrfPage <= 1);
  document.getElementById('prfBtnNext').disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No PRFs found.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(p) {
    var dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var status = String(p._status || 'UNSERVED').toUpperCase();
    var statusClass = '';
    var statusIcon = '';
    if (status === 'SERVED') { statusClass = 'status-completed'; statusIcon = 'bi-check-circle-fill'; }
    else if (status === 'STAGGERED') { statusClass = 'status-partial'; statusIcon = 'bi-hourglass'; }
    else if (status === 'CANCELED') { statusClass = 'status-pending'; statusIcon = 'bi-x-circle-fill'; }
    else { statusClass = 'status-pending'; statusIcon = 'bi-clock-history'; }

    var categoryBadge = 'bg-secondary';
    var cat = String(p.category || '').toUpperCase();
    if (cat === 'COMPONENTS') categoryBadge = 'bg-primary';
    else if (cat === 'FABMAT') categoryBadge = 'bg-warning text-dark';
    else if (cat === 'CONSUMABLES') categoryBadge = 'bg-info text-dark';
    else if (cat === 'EWMAT') categoryBadge = 'bg-danger';
    else if (cat === 'ENCLOSURE') categoryBadge = 'bg-success';

    var safePrf = String(p.prf_no || '').replace(/'/g, "\\'");
    var safeId = p.id;

    html += '<tr>' +
      '<td><code>' + erpEsc(p.prf_no) + '</code></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td>' + erpEsc(p.requestor || '—') + '</td>' +
      '<td class="text-center"><span class="badge ' + categoryBadge + '">' + erpEsc(cat || '—') + '</span></td>' +
      '<td class="text-center">' + (p.total_items || 0) + '</td>' +
      '<td class="text-center">' + erpNum(p.total_qty || 0) + '</td>' +
      '<td class="text-center"><span class="' + statusClass + '"><i class="bi ' + statusIcon + ' me-1"></i>' + status + '</span></td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="viewPrfDetails(' + safeId + ')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="openPrfPrintPreview(' + safeId + ')" title="Print">' +
          '<i class="bi bi-printer"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="openEditPrfNo(' + safeId + ', \'' + safePrf + '\')" title="Edit PRF No.">' +
          '<i class="bi bi-pencil"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// RENDER TAB 2: BY ITEM (with PO# columns)
// ═══════════════════════════════════════════════════════════
function prfMonitorRenderItemTab() {
  var tbody = document.getElementById('itemTableBody');
  if (!tbody) return;

  var searchInput = document.getElementById('prfSearchInput');
  var statusFilterEl = document.getElementById('prfStatusFilter');

  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';

  _prfMonitor.filteredItems = _prfMonitor.allItems.filter(function(it) {
    if (statusFilter && String(it.status || 'UNSERVED').toUpperCase() !== statusFilter) return false;

    if (search) {
      var prfNo = String(it._prfNo || '').toLowerCase();
      var itemCode = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();

      // ✅ Search din sa PO#
      var cacheKey = String(it._prfNo || '').trim() + '|' + (parseInt(it.line_no, 10) || 0);
      var poData = (_prfMonitor.poCacheMap || {})[cacheKey] || {};
      var poNo = String(poData.po_no || '').toLowerCase();
      var supplier = String(poData.supplier || '').toLowerCase();

      if (prfNo.indexOf(search) === -1 &&
          itemCode.indexOf(search) === -1 &&
          desc.indexOf(search) === -1 &&
          poNo.indexOf(search) === -1 &&
          supplier.indexOf(search) === -1) return false;
    }
    return true;
  });

  var total = _prfMonitor.filteredItems.length;
  var start = (_prfMonitor.currentItemPage - 1) * _prfMonitor.itemPageSize;
  var end = Math.min(start + _prfMonitor.itemPageSize, total);
  var pageItems = _prfMonitor.filteredItems.slice(start, end);

  document.getElementById('itemTableCount').textContent = total + ' items';
  document.getElementById('itemPageTotal').textContent = total;
  document.getElementById('itemPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('itemPageEnd').textContent = end;
  document.getElementById('itemPageLabel').textContent = 'Page ' + _prfMonitor.currentItemPage;

  document.getElementById('itemBtnPrev').disabled = (_prfMonitor.currentItemPage <= 1);
  document.getElementById('itemBtnNext').disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items found.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(it, idx) {
    var status = String(it.status || 'UNSERVED').toUpperCase();
    var rowClass = '';
    if (status === 'SERVED') rowClass = 'item-row-served';
    else if (status === 'CANCELED') rowClass = 'item-row-canceled';
    else if (status === 'STAGGERED') rowClass = 'item-row-staggered';

    var dateStr = it._prfDate ? new Date(it._prfDate).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    }) : '—';

    var isSelected = _prfMonitor.selectedItems[it.id] === true;

    // ✅ PO data lookup
    var cacheKey = String(it._prfNo || '').trim() + '|' + (parseInt(it.line_no, 10) || 0);
    var poData = (_prfMonitor.poCacheMap || {})[cacheKey] || {};
    var poDisplay = poData.po_no ? '<span class="po-badge">' + erpEsc(poData.po_no) + '</span>' : '<span class="text-muted">—</span>';
    var supplierDisplay = poData.supplier ? erpEsc(truncate(poData.supplier, 25)) : '<span class="text-muted">—</span>';
    var dateDeliveredDisplay = '<span class="text-muted">—</span>';
    if (poData.date_delivered) {
      try {
        var dd = new Date(poData.date_delivered);
        if (!isNaN(dd.getTime())) {
          dateDeliveredDisplay = erpEsc(dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
        } else {
          dateDeliveredDisplay = erpEsc(String(poData.date_delivered));
        }
      } catch(e) {
        dateDeliveredDisplay = erpEsc(String(poData.date_delivered));
      }
    }

    html += '<tr class="' + rowClass + '" data-item-id="' + it.id + '">' +
      '<td><input type="checkbox" class="item-select-cb" data-item-id="' + it.id + '"' +
        (isSelected ? ' checked' : '') +
        ' onchange="toggleItemSelect(' + it.id + ', this.checked)"></td>' +
      '<td>' + (start + idx + 1) + '</td>' +
      '<td><span class="prf-link" onclick="viewPrfDetailsFromItem(' + it.prf_id + ')">' + erpEsc(it._prfNo) + '</span></td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td title="' + erpEsc(it.description || '') + '">' + erpEsc(truncate(it.description || '—', 45)) + '</td>' +
      '<td class="text-center">' + erpNum(it.stock_on_hand || 0) + '</td>' +
      '<td class="text-center fw-bold">' + erpNum(it.qty_for_order || 0) + '</td>' +
      '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
      '<td class="text-center">' + poDisplay + '</td>' +
      '<td>' + supplierDisplay + '</td>' +
      '<td class="text-center" style="font-size:0.72rem;">' + dateDeliveredDisplay + '</td>' +
      '<td class="text-center">' +
        '<select class="form-select form-select-sm inline-status" onchange="updateItemStatus(' + it.id + ', this.value)">' +
          '<option value="UNSERVED"' + (status === 'UNSERVED' ? ' selected' : '') + '>UNSERVED</option>' +
          '<option value="STAGGERED"' + (status === 'STAGGERED' ? ' selected' : '') + '>STAGGERED</option>' +
          '<option value="SERVED"' + (status === 'SERVED' ? ' selected' : '') + '>SERVED</option>' +
          '<option value="CANCELED"' + (status === 'CANCELED' ? ' selected' : '') + '>CANCELED</option>' +
        '</select>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  updateBulkActionsBar();
  updateSelectAllCheckbox();
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

// ═══════════════════════════════════════════════════════════
// ITEM SELECTION + BULK ACTIONS
// ═══════════════════════════════════════════════════════════
function toggleItemSelect(itemId, checked) {
  if (checked) {
    _prfMonitor.selectedItems[itemId] = true;
  } else {
    delete _prfMonitor.selectedItems[itemId];
  }
  updateBulkActionsBar();
  updateSelectAllCheckbox();
}

function toggleSelectAllItems(checked) {
  var pageItems = _prfMonitor.filteredItems.slice(
    (_prfMonitor.currentItemPage - 1) * _prfMonitor.itemPageSize,
    _prfMonitor.currentItemPage * _prfMonitor.itemPageSize
  );

  pageItems.forEach(function(it) {
    if (checked) {
      _prfMonitor.selectedItems[it.id] = true;
    } else {
      delete _prfMonitor.selectedItems[it.id];
    }
  });

  document.querySelectorAll('.item-select-cb').forEach(function(cb) {
    cb.checked = checked;
  });

  updateBulkActionsBar();
}

function selectAllFilteredItems() {
  if (_prfMonitor.filteredItems.length === 0) {
    erpShowToast('No items to select', 'warning');
    return;
  }

  if (!confirm('Select all ' + _prfMonitor.filteredItems.length + ' filtered item(s)?')) return;

  _prfMonitor.filteredItems.forEach(function(it) {
    _prfMonitor.selectedItems[it.id] = true;
  });

  prfMonitorRenderItemTab();
  erpShowToast('✓ Selected ' + _prfMonitor.filteredItems.length + ' item(s)', 'success');
}

function clearItemSelection() {
  _prfMonitor.selectedItems = {};
  prfMonitorRenderItemTab();
}

function updateBulkActionsBar() {
  var count = Object.keys(_prfMonitor.selectedItems).length;
  var bar = document.getElementById('bulkActionsBar');
  var countEl = document.getElementById('bulkCount');

  if (!bar || !countEl) return;

  if (count > 0) {
    bar.classList.add('active');
    countEl.textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';
  } else {
    bar.classList.remove('active');
  }
}

function updateSelectAllCheckbox() {
  var checkbox = document.getElementById('selectAllItems');
  if (!checkbox) return;

  var pageItems = _prfMonitor.filteredItems.slice(
    (_prfMonitor.currentItemPage - 1) * _prfMonitor.itemPageSize,
    _prfMonitor.currentItemPage * _prfMonitor.itemPageSize
  );

  if (pageItems.length === 0) {
    checkbox.checked = false;
    return;
  }

  var allSelected = pageItems.every(function(it) {
    return _prfMonitor.selectedItems[it.id] === true;
  });

  checkbox.checked = allSelected;
}

// ═══════════════════════════════════════════════════════════
// BULK STATUS UPDATE
// ═══════════════════════════════════════════════════════════
async function bulkUpdateStatus(newStatus) {
  var selectedIds = Object.keys(_prfMonitor.selectedItems).filter(function(id) {
    return _prfMonitor.selectedItems[id] === true;
  }).map(function(id) { return parseInt(id, 10); });

  if (selectedIds.length === 0) {
    erpShowToast('No items selected', 'warning');
    return;
  }

  var confirmMsg = 'Mark ' + selectedIds.length + ' item(s) as ' + newStatus + '?';
  if (!confirm(confirmMsg)) return;

  try {
    var currentUser = localStorage.getItem('ivm_userFullname') ||
                      localStorage.getItem('ivm_username') || 'WAREHOUSE';

    var res = await fetch(erpUrl('prf_items?id=in.(' + selectedIds.join(',') + ')'), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: newStatus,
        updated_by: currentUser,
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) {
      var errText = await res.text();
      throw new Error('Bulk update failed: ' + res.status + ' ' + errText.substring(0, 100));
    }

    erpShowToast('✅ ' + selectedIds.length + ' item(s) marked as ' + newStatus, 'success');

    _prfMonitor.selectedItems = {};
    await prfMonitorLoad();

  } catch(err) {
    console.error('[bulkUpdateStatus]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// INLINE ITEM STATUS UPDATE
// ═══════════════════════════════════════════════════════════
async function updateItemStatus(itemId, newStatus) {
  try {
    var currentUser = localStorage.getItem('ivm_userFullname') ||
                      localStorage.getItem('ivm_username') || 'WAREHOUSE';

    var res = await fetch(erpUrl('prf_items?id=eq.' + itemId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: newStatus,
        updated_by: currentUser,
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) throw new Error('Update failed: ' + res.status);

    erpShowToast('✓ Status updated to ' + newStatus, 'success');

    await prfMonitorLoad();

  } catch(err) {
    erpShowToast('Failed: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT SELECTED ITEMS
// ═══════════════════════════════════════════════════════════
function exportSelectedItems() {
  var selectedIds = Object.keys(_prfMonitor.selectedItems).filter(function(id) {
    return _prfMonitor.selectedItems[id] === true;
  });

  if (selectedIds.length === 0) {
    erpShowToast('No items selected', 'warning');
    return;
  }

  var items = _prfMonitor.allItems.filter(function(it) {
    return _prfMonitor.selectedItems[it.id] === true;
  });

  var headers = ['PRF No.', 'Item Code', 'Description', 'Qty Order', 'Unit', 'PO#', 'Supplier', 'Date Delivered', 'Status'];
  var rows = items.map(function(it) {
    var cacheKey = String(it._prfNo || '').trim() + '|' + (parseInt(it.line_no, 10) || 0);
    var poData = (_prfMonitor.poCacheMap || {})[cacheKey] || {};
    return [
      it._prfNo || '',
      it.item_code || '',
      it.description || '',
      it.qty_for_order || 0,
      it.unit || '',
      poData.po_no || '',
      poData.supplier || '',
      poData.date_delivered || '',
      it.status || 'UNSERVED'
    ];
  });

  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) {
    csv += row.map(_csvEsc).join(',') + '\n';
  });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'PRF_Selected_Items_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();

  erpShowToast('✅ Exported ' + rows.length + ' item(s)', 'success');
}

// ═══════════════════════════════════════════════════════════
// VIEW PRF DETAILS
// ═══════════════════════════════════════════════════════════
async function viewPrfDetails(prfId) {
  var prf = _prfMonitor.allPrfs.find(function(p) { return p.id === prfId; });
  if (!prf) return;

  _prfMonitor.currentPrf = prf;

  var modalEl = document.getElementById('prfDetailModal');
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  document.getElementById('prfDetailTitle').textContent = prf.prf_no;
  document.getElementById('prfDetailBody').innerHTML =
    '<div class="text-center py-4"><div class="erp-spinner"></div></div>';

  modal.show();

  try {
    var items = await erpFetch('prf_items', 'prf_id=eq.' + prfId + '&order=line_no.asc');

    var html = '';

    html += '<div class="row g-2 mb-3" style="font-size:0.9rem;">';
    html += '<div class="col-md-6"><strong>PRF No.:</strong> <code>' + erpEsc(prf.prf_no) + '</code></div>';
    html += '<div class="col-md-6"><strong>Category:</strong> <span class="badge bg-primary">' + erpEsc(prf.category) + '</span></div>';
    html += '<div class="col-md-6"><strong>Requestor:</strong> ' + erpEsc(prf.requestor || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Department:</strong> ' + erpEsc(prf.department || '—') + '</div>';
    html += '<div class="col-md-6"><strong>Date:</strong> ' + (prf.created_at ? new Date(prf.created_at).toLocaleString() : '—') + '</div>';
    html += '<div class="col-md-6"><strong>Purpose:</strong> ' + erpEsc(prf.purpose || 'STOCK') + '</div>';
    if (prf.prepared_by) html += '<div class="col-md-6"><strong>Prepared By:</strong> ' + erpEsc(prf.prepared_by) + '</div>';
    if (prf.noted_by) html += '<div class="col-md-6"><strong>Noted By:</strong> ' + erpEsc(prf.noted_by) + '</div>';
    if (prf.approved_by) html += '<div class="col-md-6"><strong>Approved By:</strong> ' + erpEsc(prf.approved_by) + '</div>';
    if (prf.notes) html += '<div class="col-12"><strong>Notes:</strong> ' + erpEsc(prf.notes) + '</div>';
    html += '</div>';

    var counts = prf._statusCounts || {};
    html += '<div class="alert alert-info small">' +
      '<strong>Items:</strong> ' + (items.length) +
      ' · <span class="text-warning">Unserved: ' + (counts.UNSERVED || 0) + '</span>' +
      ' · <span class="text-info">Staggered: ' + (counts.STAGGERED || 0) + '</span>' +
      ' · <span class="text-success">Served: ' + (counts.SERVED || 0) + '</span>' +
      ' · <span class="text-danger">Canceled: ' + (counts.CANCELED || 0) + '</span>' +
      '</div>';

    html += '<h6 class="mt-3">Items (' + items.length + ')</h6>';
    html += '<div class="table-responsive"><table class="erp-table" style="font-size:0.82rem;">';
    html += '<thead><tr>' +
      '<th style="width:4%">#</th>' +
      '<th style="width:12%">Item Code</th>' +
      '<th style="width:22%">Description</th>' +
      '<th style="width:7%" class="text-center">On-Hand</th>' +
      '<th style="width:7%" class="text-center">Qty Order</th>' +
      '<th style="width:5%" class="text-center">Unit</th>' +
      '<th style="width:8%" class="text-center">PO#</th>' +
      '<th style="width:13%">Supplier</th>' +
      '<th style="width:9%" class="text-center">Date Deliv.</th>' +
      '<th style="width:8%" class="text-center">Status</th>' +
      '<th style="width:5%">Remarks</th>' +
    '</tr></thead><tbody>';

    if (items.length === 0) {
      html += '<tr><td colspan="11" class="text-center text-muted py-3">No items</td></tr>';
    } else {
      items.forEach(function(it, idx) {
        var status = String(it.status || 'UNSERVED').toUpperCase();

        // ✅ PO lookup
        var cacheKey = String(prf.prf_no || '').trim() + '|' + (parseInt(it.line_no, 10) || 0);
        var poData = (_prfMonitor.poCacheMap || {})[cacheKey] || {};
        var poDisplay = poData.po_no ? '<span class="po-badge">' + erpEsc(poData.po_no) + '</span>' : '<span class="text-muted">—</span>';
        var supplierDisplay = poData.supplier ? erpEsc(poData.supplier) : '<span class="text-muted">—</span>';
        var dateDeliveredDisplay = '<span class="text-muted">—</span>';
        if (poData.date_delivered) {
          try {
            var dd = new Date(poData.date_delivered);
            if (!isNaN(dd.getTime())) {
              dateDeliveredDisplay = erpEsc(dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
            } else {
              dateDeliveredDisplay = erpEsc(String(poData.date_delivered));
            }
          } catch(e) {
            dateDeliveredDisplay = erpEsc(String(poData.date_delivered));
          }
        }

        html += '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
          '<td>' + erpEsc(it.description || '—') + '</td>' +
          '<td class="text-center">' + erpNum(it.stock_on_hand || 0) + '</td>' +
          '<td class="text-center fw-bold">' + erpNum(it.qty_for_order || 0) + '</td>' +
          '<td class="text-center">' + erpEsc(it.unit || '—') + '</td>' +
          '<td class="text-center">' + poDisplay + '</td>' +
          '<td>' + supplierDisplay + '</td>' +
          '<td class="text-center" style="font-size:0.72rem;">' + dateDeliveredDisplay + '</td>' +
          '<td class="text-center">' +
            '<select class="form-select form-select-sm" style="font-size:0.75rem;" onchange="updateItemStatus(' + it.id + ', this.value)">' +
              '<option value="UNSERVED"' + (status === 'UNSERVED' ? ' selected' : '') + '>UNSERVED</option>' +
              '<option value="STAGGERED"' + (status === 'STAGGERED' ? ' selected' : '') + '>STAGGERED</option>' +
              '<option value="SERVED"' + (status === 'SERVED' ? ' selected' : '') + '>SERVED</option>' +
              '<option value="CANCELED"' + (status === 'CANCELED' ? ' selected' : '') + '>CANCELED</option>' +
            '</select>' +
          '</td>' +
          '<td>' + erpEsc(it.remarks || '—') + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';

    document.getElementById('prfDetailBody').innerHTML = html;

  } catch(err) {
    console.error('[viewPrfDetails]', err);
    document.getElementById('prfDetailBody').innerHTML =
      '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
}

function viewPrfDetailsFromItem(prfId) {
  prfSwitchTab('prf');
  setTimeout(function() {
    viewPrfDetails(prfId);
  }, 100);
}

// ═══════════════════════════════════════════════════════════
// EDIT PRF NO
// ═══════════════════════════════════════════════════════════
function openEditPrfNo(prfId, currentPrfNo) {
  document.getElementById('editPrfId').value = prfId;
  document.getElementById('editPrfOldNo').value = currentPrfNo;
  document.getElementById('editPrfOldNoDisplay').value = currentPrfNo;
  document.getElementById('editPrfNewNo').value = currentPrfNo;

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('editPrfNoModal'));
  modal.show();

  setTimeout(function() {
    var input = document.getElementById('editPrfNewNo');
    input.focus();
    input.select();
  }, 300);
}

async function saveEditedPrfNo() {
  var prfId = document.getElementById('editPrfId').value;
  var oldNo = document.getElementById('editPrfOldNo').value;
  var newNo = document.getElementById('editPrfNewNo').value.trim();

  if (!newNo) {
    erpShowToast('New PRF No. required', 'warning');
    return;
  }

  if (newNo === oldNo) {
    bootstrap.Modal.getInstance(document.getElementById('editPrfNoModal')).hide();
    return;
  }

  try {
    var res = await fetch(erpUrl('prf_documents?id=eq.' + prfId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        prf_no: newNo,
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) throw new Error('Update failed');

    await fetch(erpUrl('prf_items?prf_id=eq.' + prfId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({ prf_no: newNo })
    });

    bootstrap.Modal.getInstance(document.getElementById('editPrfNoModal')).hide();
    erpShowToast('✅ PRF No. updated to ' + newNo, 'success');

    prfMonitorLoad();
  } catch(err) {
    erpShowToast('Failed: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// FILTERS + PAGINATION
// ═══════════════════════════════════════════════════════════
async function prfMonitorPopulateFilters() {
  var cats = ['COMPONENTS', 'CONSUMABLES', 'ENCLOSURE', 'EWMAT', 'FABMAT', 'OFABP', 'PANEL', 'UNCATEGORIZED'];
  var catSel = document.getElementById('prfCategoryFilter');
  cats.forEach(function(c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catSel.appendChild(opt);
  });

  try {
    var rows = await erpFetch('prf_documents', 'select=requestor&requestor=not.is.null&limit=1000');
    var seen = {};
    var reqs = [];
    (rows || []).forEach(function(r) {
      var v = String(r.requestor || '').trim();
      if (v && !seen[v]) { seen[v] = true; reqs.push(v); }
    });
    var reqSel = document.getElementById('prfRequestorFilter');
    reqs.sort().forEach(function(v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      reqSel.appendChild(opt);
    });
  } catch(e) {}
}

function prfMonitorOnSearch() {
  clearTimeout(_prfMonitor.searchTimer);
  _prfMonitor.searchTimer = setTimeout(function() {
    _prfMonitor.currentPrfPage = 1;
    _prfMonitor.currentItemPage = 1;
    prfMonitorRenderPrfTab();
    prfMonitorRenderItemTab();
  }, 300);
}

function prfMonitorApplyFilter() {
  _prfMonitor.currentPrfPage = 1;
  _prfMonitor.currentItemPage = 1;
  prfMonitorRenderPrfTab();
  prfMonitorRenderItemTab();
}

function prfMonitorClearFilters() {
  document.getElementById('prfSearchInput').value = '';
  document.getElementById('prfCategoryFilter').value = '';
  document.getElementById('prfStatusFilter').value = '';
  document.getElementById('prfRequestorFilter').value = '';
  document.getElementById('prfDateFrom').value = '';
  document.getElementById('prfDateTo').value = '';
  _prfMonitor.currentPrfPage = 1;
  _prfMonitor.currentItemPage = 1;
  prfMonitorLoad();
}

function prfMonitorPagePrev() {
  if (_prfMonitor.currentPrfPage > 1) {
    _prfMonitor.currentPrfPage--;
    prfMonitorRenderPrfTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function prfMonitorPageNext() {
  var total = _prfMonitor.filteredPrfs.length;
  var maxPage = Math.ceil(total / _prfMonitor.prfPageSize);
  if (_prfMonitor.currentPrfPage < maxPage) {
    _prfMonitor.currentPrfPage++;
    prfMonitorRenderPrfTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function itemPagePrev() {
  if (_prfMonitor.currentItemPage > 1) {
    _prfMonitor.currentItemPage--;
    prfMonitorRenderItemTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function itemPageNext() {
  var total = _prfMonitor.filteredItems.length;
  var maxPage = Math.ceil(total / _prfMonitor.itemPageSize);
  if (_prfMonitor.currentItemPage < maxPage) {
    _prfMonitor.currentItemPage++;
    prfMonitorRenderItemTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function prfMonitorRefresh() {
  erpShowToast('Refreshing...', 'info');
  prfMonitorLoad();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function prfMonitorExport() {
  if (_prfMonitor.filteredPrfs.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }
  var headers = ['PRF No.', 'Date', 'Requestor', 'Category', 'Items', 'Total Qty', 'Status'];
  var rows = _prfMonitor.filteredPrfs.map(function(p) {
    return [
      p.prf_no || '',
      p.created_at ? new Date(p.created_at).toLocaleDateString() : '',
      p.requestor || '',
      p.category || '',
      p.total_items || 0,
      p.total_qty || 0,
      p._status || 'UNSERVED'
    ];
  });
  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEsc).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'PRF_Export_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' rows', 'success');
}

function prfMonitorExportItems() {
  if (_prfMonitor.filteredItems.length === 0) {
    erpShowToast('No items to export', 'warning');
    return;
  }
  var headers = ['PRF No.', 'Date', 'Item Code', 'Description', 'On-Hand', 'Qty Order', 'Unit', 'PO#', 'Supplier', 'Date Delivered', 'Status', 'Remarks'];
  var rows = _prfMonitor.filteredItems.map(function(it) {
    var cacheKey = String(it._prfNo || '').trim() + '|' + (parseInt(it.line_no, 10) || 0);
    var poData = (_prfMonitor.poCacheMap || {})[cacheKey] || {};
    return [
      it._prfNo || '',
      it._prfDate ? new Date(it._prfDate).toLocaleDateString() : '',
      it.item_code || '',
      it.description || '',
      it.stock_on_hand || 0,
      it.qty_for_order || 0,
      it.unit || '',
      poData.po_no || '',
      poData.supplier || '',
      poData.date_delivered || '',
      it.status || 'UNSERVED',
      it.remarks || ''
    ];
  });
  var csv = headers.map(_csvEsc).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEsc).join(',') + '\n'; });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'PRF_Items_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' items', 'success');
}

function _csvEsc(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// PRINT
// ═══════════════════════════════════════════════════════════
function printCurrentPrf() {
  if (!_prfMonitor.currentPrf) {
    erpShowToast('No PRF selected', 'warning');
    return;
  }
  if (typeof openPrfPrintPreview === 'function') {
    openPrfPrintPreview(_prfMonitor.currentPrf.id);
  } else {
    erpShowToast('Print module not loaded', 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// Expose functions globally
window.prfMonitorLoad = prfMonitorLoad;
window.prfMonitorRefresh = prfMonitorRefresh;
window.prfMonitorClearFilters = prfMonitorClearFilters;
window.prfMonitorOnSearch = prfMonitorOnSearch;
window.prfMonitorApplyFilter = prfMonitorApplyFilter;
window.prfMonitorPagePrev = prfMonitorPagePrev;
window.prfMonitorPageNext = prfMonitorPageNext;
window.itemPagePrev = itemPagePrev;
window.itemPageNext = itemPageNext;
window.prfMonitorExport = prfMonitorExport;
window.prfMonitorExportItems = prfMonitorExportItems;
window.viewPrfDetails = viewPrfDetails;
window.viewPrfDetailsFromItem = viewPrfDetailsFromItem;
window.openEditPrfNo = openEditPrfNo;
window.saveEditedPrfNo = saveEditedPrfNo;
window.updateItemStatus = updateItemStatus;
window.toggleItemSelect = toggleItemSelect;
window.toggleSelectAllItems = toggleSelectAllItems;
window.selectAllFilteredItems = selectAllFilteredItems;
window.clearItemSelection = clearItemSelection;
window.bulkUpdateStatus = bulkUpdateStatus;
window.exportSelectedItems = exportSelectedItems;
window.printCurrentPrf = printCurrentPrf;

console.log('✅ prf-monitor.js v3.1 loaded (with PO# display from cache)');
