// ============================================================
// GEMCOR ERP — PRF Monitor (v3.4)
// Two Tabs + Bulk Status Update + PO# Display
// ✅ v3.2: Prefer prf_items.po_no over poCacheMap
// ✅ v3.3: PRF Items Edit (Revision Mode) + Version History
// ✅ v3.4: Version Filter (Latest only / All versions)
// ============================================================

var _prfMonitor = {
  activeTab: 'prf',
  allPrfs: [],
  allItems: [],
  poCacheMap: {},
  filteredPrfs: [],
  filteredItems: [],
  currentPrfPage: 1,
  currentItemPage: 1,
  prfPageSize: 20,
  itemPageSize: 50,
  searchTimer: null,
  currentPrf: null,
  selectedItems: {},
  versionFilter: 'latest'  // ✅ NEW: 'latest' | 'all'
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[PRF Monitor v3.4] Initializing...');

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
// FETCH PO CACHE
// ═══════════════════════════════════════════════════════════
async function prfMonitorFetchPoCache() {
  try {
    var rows = await erpFetch('erp_prf_po_cache',
      'select=prf_no,item_no,po_no,supplier,date_delivered&po_no=not.is.null&limit=10000');

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
// Resolve PO data
// ═══════════════════════════════════════════════════════════
function _resolvePoData(item, prfNo) {
  var itemPoNo = String(item.po_no || '').trim();
  var itemSupplier = String(item.po_supplier || '').trim();
  var itemDateDelivered = item.po_date_delivered || '';

  if (itemPoNo) {
    return {
      po_no: itemPoNo,
      supplier: itemSupplier,
      date_delivered: itemDateDelivered,
      source: 'prf_items'
    };
  }

  var cacheKey = String(prfNo || item._prfNo || '').trim() + '|' + (parseInt(item.line_no, 10) || 0);
  var cachedPo = (_prfMonitor.poCacheMap || {})[cacheKey] || {};
  if (cachedPo.po_no) {
    return {
      po_no: cachedPo.po_no,
      supplier: cachedPo.supplier,
      date_delivered: cachedPo.date_delivered,
      source: 'cache'
    };
  }

  return { po_no: '', supplier: '', date_delivered: '', source: 'none' };
}

// ═══════════════════════════════════════════════════════════
// ✅ v3.4: VERSION BADGE with LATEST/OLD indicator
// ═══════════════════════════════════════════════════════════
function _versionBadge(prf, latestPrfId) {
  var v = parseInt(prf.version_number, 10) || 1;
  
  // ✅ Kung version 1 lang, wag nang lagyan ng badge.
  if (v <= 1) return ''; 
  
  var isLatest = (prf.id === latestPrfId);
  
  if (isLatest) {
    return ' <span class="badge bg-success" style="font-size:0.62rem;" title="Latest version">v' + v + ' LATEST</span>';
  } else {
    return ' <span class="badge bg-secondary" style="font-size:0.62rem;" title="Superseded by latest version">v' + v + ' OLD</span>';
  }
}

window._versionBadge = _versionBadge;
// ═══════════════════════════════════════════════════════════
// ✅ v3.4: GET LATEST VERSION ONLY (per base_prf_no)
// ═══════════════════════════════════════════════════════════
function _getLatestVersionsOnly(prfs) {
  var baseMap = {};
  
  prfs.forEach(function(p) {
    var base = String(p.base_prf_no || p.prf_no || '').trim();
    if (!base) return;
    
    var v = parseInt(p.version_number, 10) || 1;
    
    if (!baseMap[base] || v > (parseInt(baseMap[base].version_number, 10) || 1)) {
      baseMap[base] = p;
    }
  });
  
  return Object.keys(baseMap).map(function(k) { return baseMap[k]; });
}

function _getLatestPrfIds(prfs) {
  var latestVersions = _getLatestVersionsOnly(prfs);
  var idSet = {};
  latestVersions.forEach(function(p) { idSet[p.id] = true; });
  return idSet;
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
// ✅ v3.4: VERSION FILTER TOGGLE
// ═══════════════════════════════════════════════════════════
function prfToggleVersionFilter(mode) {
  _prfMonitor.versionFilter = mode || 'latest';
  console.log('[PRF Monitor] Version filter:', _prfMonitor.versionFilter);
  
  // Reset page
  _prfMonitor.currentPrfPage = 1;
  _prfMonitor.currentItemPage = 1;
  
  prfMonitorComputeStatus();
  prfMonitorComputeKPIs();
  prfMonitorRenderPrfTab();
  prfMonitorRenderItemTab();
}

window.prfToggleVersionFilter = prfToggleVersionFilter;

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
    console.log('[PRF Monitor v3.4] Loaded', _prfMonitor.allPrfs.length, 'PRFs');

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
        it._basePrfNo = prf.base_prf_no || prf.prf_no || '';
        it._versionNumber = parseInt(prf.version_number, 10) || 1;
      });

      _prfMonitor.allItems = allItems;
      console.log('[PRF Monitor v3.4] Loaded', allItems.length, 'items');
    } else {
      _prfMonitor.allItems = [];
    }

    try {
      _prfMonitor.poCacheMap = await prfMonitorFetchPoCache();
    } catch(e) {
      _prfMonitor.poCacheMap = {};
    }

    prfMonitorComputeStatus();
    prfMonitorComputeKPIs();
    prfUpdateTabCounts();

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

  var prfsToCount = _prfMonitor.versionFilter === 'latest' 
    ? _getLatestVersionsOnly(_prfMonitor.allPrfs) 
    : _prfMonitor.allPrfs;
  
  var latestIds = _getLatestPrfIds(_prfMonitor.allPrfs);
  var itemsToCount = _prfMonitor.versionFilter === 'latest'
    ? _prfMonitor.allItems.filter(function(it) { return latestIds[it.prf_id]; })
    : _prfMonitor.allItems;

  if (prfCountEl) prfCountEl.textContent = prfsToCount.length;
  if (itemCountEl) itemCountEl.textContent = itemsToCount.length;
}

// ═══════════════════════════════════════════════════════════
// COMPUTE STATUS (latest only by default)
// ═══════════════════════════════════════════════════════════
function prfMonitorComputeStatus() {
  var latestIds = _getLatestPrfIds(_prfMonitor.allPrfs);
  
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
    prf._isLatestVersion = !!latestIds[prf.id];
  });
}

// ═══════════════════════════════════════════════════════════
// COMPUTE KPIs (latest only by default)
// ═══════════════════════════════════════════════════════════
function prfMonitorComputeKPIs() {
  var latestIds = _getLatestPrfIds(_prfMonitor.allPrfs);
  
  var itemsToCount = _prfMonitor.versionFilter === 'latest'
    ? _prfMonitor.allItems.filter(function(it) { return latestIds[it.prf_id]; })
    : _prfMonitor.allItems;

  var totalItems = 0;
  var unservedItems = 0;
  var staggeredItems = 0;
  var servedItems = 0;
  var canceledItems = 0;

  itemsToCount.forEach(function(it) {
    totalItems++;
    var s = String(it.status || 'UNSERVED').toUpperCase();
    if (s === 'UNSERVED') unservedItems++;
    else if (s === 'STAGGERED') staggeredItems++;
    else if (s === 'SERVED') servedItems++;
    else if (s === 'CANCELED') canceledItems++;
  });

  var prfCount = _prfMonitor.versionFilter === 'latest'
    ? _getLatestVersionsOnly(_prfMonitor.allPrfs).length
    : _prfMonitor.allPrfs.length;

  document.getElementById('prfKpiTotal').textContent = erpNum(totalItems);
  document.getElementById('prfKpiUnserved').textContent = erpNum(unservedItems);
  document.getElementById('prfKpiStaggered').textContent = erpNum(staggeredItems);
  document.getElementById('prfKpiServed').textContent = erpNum(servedItems);
  document.getElementById('prfKpiCanceled').textContent = erpNum(canceledItems);

  var totalSub = document.getElementById('prfKpiTotalSub');
  if (totalSub) totalSub.textContent = 'across ' + prfCount + ' PRF' + (prfCount === 1 ? '' : 's');

  console.log('[PRF KPI] Mode:', _prfMonitor.versionFilter,
    '| Items:', totalItems,
    '| Unserved:', unservedItems,
    '| Served:', servedItems);
}

// ═══════════════════════════════════════════════════════════
// RENDER TAB 1: BY PRF (with version filter)
// ═══════════════════════════════════════════════════════════
function prfMonitorRenderPrfTab() {
  var tbody = document.getElementById('prfTableBody');
  if (!tbody) return;

  var searchInput = document.getElementById('prfSearchInput');
  var statusFilterEl = document.getElementById('prfStatusFilter');

  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';

  // ✅ v3.4: Filter by version mode
  var latestIds = _getLatestPrfIds(_prfMonitor.allPrfs);
  var basePrfs = _prfMonitor.versionFilter === 'latest'
    ? _getLatestVersionsOnly(_prfMonitor.allPrfs)
    : _prfMonitor.allPrfs;

  _prfMonitor.filteredPrfs = basePrfs.filter(function(p) {
    if (statusFilter && String(p._status || '').toUpperCase() !== statusFilter) return false;

    if (search) {
      var prfNo = String(p.prf_no || '').toLowerCase();
      var req = String(p.requestor || '').toLowerCase();
      var basePrfNo = String(p.base_prf_no || '').toLowerCase();
      if (prfNo.indexOf(search) === -1 && req.indexOf(search) === -1 && basePrfNo.indexOf(search) === -1) return false;
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
    var safeBasePrf = String(p.base_prf_no || p.prf_no || '').replace(/'/g, "\\'");
    
    // ✅ v3.4: Dynamic version badge
   var versionBadge = _versionBadge(p, latestIds[p.id] ? p.id : null);
var batchNum = parseInt(p.batch_number, 10) || 1;
var batchBadge = batchNum > 1 ? ' <span class="badge bg-info text-dark" style="font-size:0.65rem;" title="Split Batch #' + batchNum + '">B' + batchNum + '</span>' : '';

html += '<tr>' +
  '<td><code>' + erpEsc(p.prf_no) + '</code>' + batchBadge + versionBadge + '</td>' +
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
          '<i class="bi bi-tag"></i>' +
        '</button>' +
        '<button class="erp-action-btn" style="background:#f59e0b;color:#fff;" ' +
          'onclick="openEditPrfItems(' + safeId + ')" title="Edit Items (New Version)">' +
          '<i class="bi bi-pencil-square"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="openPrfVersionHistory(\'' + safeBasePrf + '\')" title="Version History">' +
          '<i class="bi bi-clock-history"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// RENDER TAB 2: BY ITEM (with version, duplicate & sort filter)
// ═══════════════════════════════════════════════════════════
function prfMonitorRenderItemTab() {
  var tbody = document.getElementById('itemTableBody');
  if (!tbody) return;

  var searchInput = document.getElementById('prfSearchInput');
  var statusFilterEl = document.getElementById('prfStatusFilter');

  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';

  // ✅ Kunin ang bagong filter values
  var dupFilter = document.getElementById('itemFilterDuplicates') ? document.getElementById('itemFilterDuplicates').value : 'all';
  var sortOrder = document.getElementById('itemSortOrder') ? document.getElementById('itemSortOrder').value : 'newest';

  // ✅ Filter by version mode
  var latestIds = _getLatestPrfIds(_prfMonitor.allPrfs);
  var baseItems = _prfMonitor.versionFilter === 'latest'
    ? _prfMonitor.allItems.filter(function(it) { return latestIds[it.prf_id]; })
    : _prfMonitor.allItems;

  // ✅ Count duplicates (bilangin kung ilang beses lumabas ang item_code)
  var itemCounts = {};
  baseItems.forEach(function(it) {
    var code = String(it.item_code || '').trim();
    if (code) {
      itemCounts[code] = (itemCounts[code] || 0) + 1;
    }
  });

  // ✅ Apply standard filters + Duplicate filter
  _prfMonitor.filteredItems = baseItems.filter(function(it) {
    if (statusFilter && String(it.status || 'UNSERVED').toUpperCase() !== statusFilter) return false;

    // Duplicate logic: Ipakita lang kung >1 ang bilang
    if (dupFilter === 'duplicates') {
      var code = String(it.item_code || '').trim();
      if ((itemCounts[code] || 0) <= 1) return false;
    }

    if (search) {
      var prfNo = String(it._prfNo || '').toLowerCase();
      var itemCode = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();

      var poData = _resolvePoData(it);
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

  // ✅ SORTING Logic (Newest or Oldest based on PRF Date)
  _prfMonitor.filteredItems.sort(function(a, b) {
    var dateA = a._prfDate ? new Date(a._prfDate).getTime() : 0;
    var dateB = b._prfDate ? new Date(b._prfDate).getTime() : 0;
    
    if (sortOrder === 'newest') {
      return dateB - dateA; // Pinakabago sa taas
    } else {
      return dateA - dateB; // Pinakaluma sa taas
    }
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
    // ... (Yung rendering ng table row, hayaan mo lang kung ano ang existing, walang binago dito)
    
    // Wait, kailangan nating i-paste yung buong forEach para sure. Kopyahin mo lang mula sa existing mo kung may nakalimutan.
    
    var status = String(it.status || 'UNSERVED').toUpperCase();
    var rowClass = '';
    if (status === 'SERVED') rowClass = 'item-row-served';
    else if (status === 'CANCELED') rowClass = 'item-row-canceled';
    else if (status === 'STAGGERED') rowClass = 'item-row-staggered';

    var dateStr = it._prfDate ? new Date(it._prfDate).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    }) : '—';

    var isSelected = _prfMonitor.selectedItems[it.id] === true;

    var poData = _resolvePoData(it);

    var poDisplay = poData.po_no 
      ? '<span class="po-badge">' + erpEsc(poData.po_no) + '</span>' 
      : '<span class="text-muted">—</span>';

    var supplierDisplay = poData.supplier 
      ? erpEsc(truncate(poData.supplier, 25)) 
      : '<span class="text-muted">—</span>';

    var dateDeliveredDisplay = '<span class="text-muted">—</span>';
    if (poData.date_delivered) {
      try {
        var dd = new Date(poData.date_delivered);
        if (!isNaN(dd.getTime())) {
          dateDeliveredDisplay = erpEsc(dd.toLocaleDateString('en-US', { 
            month: 'short', day: 'numeric', year: 'numeric' 
          }));
        } else {
          dateDeliveredDisplay = erpEsc(String(poData.date_delivered));
        }
      } catch(e) {
        dateDeliveredDisplay = erpEsc(String(poData.date_delivered));
      }
    }

    var versionBadgeSmall = it._versionNumber > 1 
      ? ' <span class="badge bg-warning text-dark" style="font-size:0.55rem;">v' + it._versionNumber + '</span>'
      : '';
      
    // ✅ Dagdag natin: Duplicate Badge kung > 1 ang count
    var codeStr = String(it.item_code || '').trim();
    var dupCount = itemCounts[codeStr] || 0;
    var dupBadge = dupCount > 1 
      ? ' <span class="badge bg-danger ms-1" style="font-size:0.6rem;" title="Naka-request ng ' + dupCount + ' beses">x' + dupCount + '</span>' 
      : '';

    html += '<tr class="' + rowClass + '" data-item-id="' + it.id + '">' +
      '<td><input type="checkbox" class="item-select-cb" data-item-id="' + it.id + '"' +
        (isSelected ? ' checked' : '') +
        ' onchange="toggleItemSelect(' + it.id + ', this.checked)"></td>' +
      '<td>' + (start + idx + 1) + '</td>' +
      '<td><span class="prf-link" onclick="viewPrfDetailsFromItem(' + it.prf_id + ')">' + erpEsc(it._prfNo) + '</span>' + versionBadgeSmall + '</td>' +
      '<td>' + erpEsc(dateStr) + '</td>' +
      '<td><code>' + erpEsc(it.item_code) + '</code>' + dupBadge + '</td>' +
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

  if (!confirm('Mark ' + selectedIds.length + ' item(s) as ' + newStatus + '?')) return;

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
      throw new Error('Bulk update failed: ' + res.status);
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
  var items = _prfMonitor.allItems.filter(function(it) {
    return _prfMonitor.selectedItems[it.id] === true;
  });

  if (items.length === 0) {
    erpShowToast('No items selected', 'warning');
    return;
  }

  var headers = ['PRF No.', 'Version', 'Item Code', 'Description', 'Qty Order', 'Unit', 'PO#', 'Supplier', 'Date Delivered', 'Status'];
  var rows = items.map(function(it) {
    var poData = _resolvePoData(it);
    return [
      it._prfNo || '',
      it._versionNumber || 1,
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
    html += '<div class="col-md-6"><strong>PRF No.:</strong> <code>' + erpEsc(prf.prf_no) + '</code>';
    var vNum = parseInt(prf.version_number, 10) || 1;
    if (vNum > 1) html += ' <span class="badge bg-warning text-dark">v' + vNum + '</span>';
    html += '</div>';
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

        var poData = _resolvePoData(it, prf.prf_no);

        var poDisplay = poData.po_no 
          ? '<span class="po-badge">' + erpEsc(poData.po_no) + '</span>' 
          : '<span class="text-muted">—</span>';

        var supplierDisplay = poData.supplier 
          ? erpEsc(poData.supplier) 
          : '<span class="text-muted">—</span>';

        var dateDeliveredDisplay = '<span class="text-muted">—</span>';
        if (poData.date_delivered) {
          try {
            var dd = new Date(poData.date_delivered);
            if (!isNaN(dd.getTime())) {
              dateDeliveredDisplay = erpEsc(dd.toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric' 
              }));
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
// SYNC & RECOMPUTE
// ═══════════════════════════════════════════════════════════
async function prfSyncAndRecompute() {
  if (!confirm('Sync PO data from Google Sheet and recompute all statuses?\n\nThis may take 30-60 seconds.')) {
    return;
  }

  erpShowToast('Starting sync...', 'info');

  var btn = document.querySelector('button[onclick="prfSyncAndRecompute()"]');
  var origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Syncing...';
  }

  try {
    var GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwTiA7IOQOdq7cfuiiptoA06Oa7xkuh2-wA1fSA3pP2gqZKHUvcjy5AF2rb28ThF842/exec';

    var syncRes = await fetch(GAS_WEBHOOK_URL + '?action=prfSyncAndRecompute&_t=' + Date.now(), {
      redirect: 'follow'
    });

    var syncText = await syncRes.text();
    var syncData;
    try { syncData = JSON.parse(syncText); } catch(e) {
      throw new Error('Invalid response from GAS');
    }

    if (!syncData.success) {
      throw new Error(syncData.error || 'Unknown error');
    }

    erpShowToast('✅ Sync complete! ' + syncData.synced + ' rows, ' +
                 syncData.statusChanges + ' status updates', 'success');

    await prfMonitorLoad();

  } catch(err) {
    console.error('[PRF Sync] Error:', err);
    erpShowToast('Sync failed: ' + err.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// MANUAL PO ENTRY
// ═══════════════════════════════════════════════════════════
window.openPoEditModal = function(prfNo, lineNo, itemCode) {
  var currentItem = _prfMonitor.allItems.find(function(it) {
    return String(it._prfNo).trim() === String(prfNo).trim() 
        && parseInt(it.line_no, 10) === parseInt(lineNo, 10);
  });
  
  if (!currentItem) {
    erpShowToast('Item not found', 'warning');
    return;
  }
  
  var poData = _resolvePoData(currentItem, prfNo);
  
  document.getElementById('poEditPrfNo').value = prfNo;
  document.getElementById('poEditLineNo').value = lineNo;
  document.getElementById('poEditItemCode').value = itemCode;
  document.getElementById('poEditDisplay').textContent = 
    prfNo + ' | Line ' + lineNo + ' | ' + itemCode;
  
  document.getElementById('poEditPoNo').value = poData.po_no || '';
  document.getElementById('poEditSupplier').value = poData.supplier || '';
  document.getElementById('poEditDateDelivered').value = poData.date_delivered || '';
  
  bootstrap.Modal.getOrCreateInstance(document.getElementById('poEditModal')).show();
};

window.savePoEdit = async function() {
  var prfNo = document.getElementById('poEditPrfNo').value;
  var lineNo = parseInt(document.getElementById('poEditLineNo').value, 10);
  var poNo = document.getElementById('poEditPoNo').value.trim();
  var supplier = document.getElementById('poEditSupplier').value.trim();
  var dateDelivered = document.getElementById('poEditDateDelivered').value || null;
  
  if (!poNo) {
    erpShowToast('PO No. is required', 'warning');
    return;
  }
  if (!supplier) {
    erpShowToast('Supplier is required', 'warning');
    return;
  }
  
  var btn = document.querySelector('#poEditModal .btn-primary');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
  
  try {
    var res = await fetch(erpUrl('prf_items?prf_no=eq.' + encodeURIComponent(prfNo) 
      + '&line_no=eq.' + lineNo), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        po_no: poNo,
        po_supplier: supplier,
        po_date_delivered: dateDelivered,
        po_updated_at: new Date().toISOString(),
        po_updated_by: localStorage.getItem('ivm_username') || 'WAREHOUSE'
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    bootstrap.Modal.getInstance(document.getElementById('poEditModal')).hide();
    erpShowToast('✅ PO data saved for ' + prfNo, 'success');
    
    await prfMonitorLoad();
    
  } catch(err) {
    console.error('[savePoEdit]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
};

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
function prfMonitorExport() {
  if (_prfMonitor.filteredPrfs.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }
  var headers = ['PRF No.', 'Version', 'Date', 'Requestor', 'Category', 'Items', 'Total Qty', 'Status'];
  var rows = _prfMonitor.filteredPrfs.map(function(p) {
    return [
      p.prf_no || '',
      p.version_number || 1,
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
  var headers = ['PRF No.', 'Version', 'Date', 'Item Code', 'Description', 'On-Hand', 'Qty Order', 'Unit', 'PO#', 'Supplier', 'Date Delivered', 'Status', 'Remarks'];
  var rows = _prfMonitor.filteredItems.map(function(it) {
    var poData = _resolvePoData(it);
    return [
      it._prfNo || '',
      it._versionNumber || 1,
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
window.prfSyncAndRecompute = prfSyncAndRecompute;
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

// ═══════════════════════════════════════════════════════════
// PRF ITEMS EDIT (REVISION MODE)
// ═══════════════════════════════════════════════════════════

var _editPrfState = {
  prfId: null,
  originalPrf: null,
  originalItems: [],
  currentItems: [],
  newVersionNumber: 2,
  isSaving: false
};

window.openEditPrfItems = async function(prfId) {
  console.log('[EditPRF] Opening:', prfId);
  
  var prf = _prfMonitor.allPrfs.find(function(p) { return p.id === prfId; });
  if (!prf) {
    erpShowToast('PRF not found', 'warning');
    return;
  }
  
  _editPrfState.prfId = prfId;
  _editPrfState.originalPrf = prf;
  _editPrfState.isSaving = false;
  
  var basePrfNo = prf.base_prf_no || prf.prf_no;
  var currentVersion = parseInt(prf.version_number, 10) || 1;
  
  try {
    var versionRows = await erpFetch('prf_documents',
      'select=version_number&base_prf_no=eq.' + encodeURIComponent(basePrfNo) +
      '&order=version_number.desc&limit=1');
    
    var maxVersion = (versionRows && versionRows[0]) 
      ? parseInt(versionRows[0].version_number, 10) 
      : currentVersion;
    
    _editPrfState.newVersionNumber = maxVersion + 1;
  } catch(e) {
    _editPrfState.newVersionNumber = currentVersion + 1;
  }
  
  document.getElementById('editPrfItemsTitle').textContent = basePrfNo;
  document.getElementById('editPrfVersionBadge').textContent = 
    'v' + currentVersion + ' → v' + _editPrfState.newVersionNumber;
  
  document.getElementById('editPrfItemsBody').innerHTML = 
    '<div class="text-center py-5">' +
      '<div class="erp-spinner" style="margin:0 auto;"></div>' +
      '<div class="mt-2 text-muted">Loading PRF items...</div>' +
    '</div>';
  
  var modalEl = document.getElementById('editPrfItemsModal');
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  try {
    var items = await erpFetch('prf_items',
      'select=*&prf_id=eq.' + prfId + '&order=line_no.asc');
    
    _editPrfState.originalItems = (items || []).map(function(it) {
      return {
        id: it.id,
        item_code: it.item_code || '',
        description: it.description || '',
        category: it.category || '',
        location: it.location || '',
        average_consumption: Number(it.average_consumption || 0),
        buffer_stock: Number(it.buffer_stock || 0),
        stock_on_hand: Number(it.stock_on_hand || 0),
        qty_for_order: Number(it.qty_for_order || 0),
        unit: it.unit || 'PIECE',
        remarks: it.remarks || '',
        _isNew: false
      };
    });
    
    _editPrfState.currentItems = JSON.parse(JSON.stringify(_editPrfState.originalItems));
    
    renderEditPrfItems();
    
  } catch(err) {
    console.error('[openEditPrfItems]', err);
    document.getElementById('editPrfItemsBody').innerHTML = 
      '<div class="alert alert-danger">Failed to load items: ' + erpEsc(err.message) + '</div>';
  }
};

window.closeEditPrfItems = function() {
  var modalEl = document.getElementById('editPrfItemsModal');
  if (modalEl) {
    var m = bootstrap.Modal.getInstance(modalEl);
    if (m) m.hide();
  }
};

function renderEditPrfItems() {
  var body = document.getElementById('editPrfItemsBody');
  if (!body) return;
  
  var items = _editPrfState.currentItems;
  var prf = _editPrfState.originalPrf;
  
  var html = '';
  
  html += '<div class="alert alert-warning small py-2 mb-3">' +
    '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
    '<strong>Revision Mode:</strong> Puwede kang mag-add, mag-remove, o mag-modify ng items. ' +
    'Ang original PRF ay mananatili sa database. Ang bagong version ay magiging <strong>v' + 
    _editPrfState.newVersionNumber + '</strong>.' +
    '</div>';
  
  html += '<div class="row g-2 mb-3 small">' +
    '<div class="col-md-6"><strong>Category:</strong> ' + erpEsc(prf.category || '—') + '</div>' +
    '<div class="col-md-6"><strong>Requestor:</strong> ' + erpEsc(prf.requestor || '—') + '</div>' +
    '</div>';
  
  html += '<div class="d-flex justify-content-between align-items-center mb-3">' +
    '<div>' +
      '<strong>Items</strong> ' +
      '<span class="badge bg-secondary ms-1">' + items.length + '</span>' +
    '</div>' +
    '<button class="btn btn-sm btn-primary" onclick="addEditPrfItem()">' +
      '<i class="bi bi-plus-lg me-1"></i>Add Item' +
    '</button>' +
    '</div>';
  
  html += '<div class="table-responsive" style="max-height:50vh;overflow-y:auto;">' +
    '<table class="table table-sm table-bordered align-middle" style="font-size:0.85rem;">' +
    '<thead class="table-light sticky-top"><tr>' +
      '<th style="width:4%">#</th>' +
      '<th style="width:18%">Item Code</th>' +
      '<th style="width:28%">Description</th>' +
      '<th style="width:10%" class="text-center">Qty Order</th>' +
      '<th style="width:8%" class="text-center">Unit</th>' +
      '<th style="width:12%">Remarks</th>' +
      '<th style="width:5%"></th>' +
    '</tr></thead><tbody>';
  
  if (items.length === 0) {
    html += '<tr><td colspan="7" class="text-center text-muted py-3">' +
      'No items. Click "Add Item" above.</td></tr>';
  } else {
    items.forEach(function(it, idx) {
      html += '<tr data-idx="' + idx + '"' + (it._isNew ? ' style="background:#f0fdf4;"' : '') + '>' +
        '<td class="text-center">' + (idx + 1) + '</td>' +
        '<td style="position:relative;">' +
          '<input type="text" class="form-control form-control-sm edit-prf-item-search" ' +
            'id="editPrfItemCode' + idx + '" ' +
            'data-idx="' + idx + '" ' +
            'data-field="item_code" ' +
            'value="' + erpEsc(it.item_code) + '" ' +
            'placeholder="Type to search..." ' +
            'autocomplete="off" ' +
            'oninput="onEditPrfItemSearch(' + idx + ', this.value)" ' +
            'onfocus="onEditPrfItemSearch(' + idx + ', this.value)" ' +
            'onblur="onEditPrfItemBlur(' + idx + ')" ' +
            'style="font-family:\'Courier New\',monospace;">' +
          '<div class="list-group edit-prf-item-dropdown d-none" id="editPrfDropdown' + idx + '" ' +
            'style="position:fixed;z-index:99999;max-height:300px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.18);min-width:400px;"></div>' +
        '</td>' +
        '<td><input type="text" class="form-control form-control-sm" ' +
            'value="' + erpEsc(it.description) + '" data-field="description" ' +
            'oninput="editPrfUpdateItem(' + idx + ', \'description\', this.value)"></td>' +
        '<td><input type="number" class="form-control form-control-sm text-center" ' +
            'value="' + (it.qty_for_order || 0) + '" min="0" step="1" data-field="qty_for_order" ' +
            'oninput="editPrfUpdateItem(' + idx + ', \'qty_for_order\', parseFloat(this.value) || 0)"></td>' +
        '<td><input type="text" class="form-control form-control-sm text-center" ' +
            'value="' + erpEsc(it.unit) + '" data-field="unit" ' +
            'oninput="editPrfUpdateItem(' + idx + ', \'unit\', this.value)"></td>' +
        '<td><input type="text" class="form-control form-control-sm" ' +
            'value="' + erpEsc(it.remarks) + '" data-field="remarks" ' +
            'placeholder="Optional" maxlength="200" ' +
            'oninput="editPrfUpdateItem(' + idx + ', \'remarks\', this.value)"></td>' +
        '<td class="text-center">' +
          '<button class="btn btn-sm btn-outline-danger" onclick="editPrfRemoveItem(' + idx + ')" title="Remove">' +
            '<i class="bi bi-trash"></i></button></td>' +
      '</tr>';
    });
  }
  
  html += '</tbody></table></div>';
  
  html += '<div class="mt-3 p-3" style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;">' +
    '<label class="form-label fw-bold" style="color:#92400e;">' +
      '<i class="bi bi-chat-left-text me-1"></i>Reason for Revision <span class="text-danger">*</span>' +
    '</label>' +
    '<input type="text" class="form-control" id="editPrfRevisionReason" ' +
      'placeholder="e.g., Manager requested removal of item X" maxlength="300">' +
    '</div>';
  
  body.innerHTML = html;
}

window.editPrfUpdateItem = function(idx, field, value) {
  if (!_editPrfState.currentItems[idx]) return;
  _editPrfState.currentItems[idx][field] = value;
};

window.addEditPrfItem = function() {
  _editPrfState.currentItems.push({
    id: null, item_code: '', description: '',
    category: _editPrfState.originalPrf.category || '',
    location: '', average_consumption: 0, buffer_stock: 0, stock_on_hand: 0,
    qty_for_order: 0, unit: 'PIECE', remarks: '', _isNew: true
  });
  renderEditPrfItems();
  
  setTimeout(function() {
    var rows = document.querySelectorAll('#editPrfItemsBody tbody tr');
    if (rows.length > 0) {
      var lastRow = rows[rows.length - 1];
      var firstInput = lastRow.querySelector('input[data-field="item_code"]');
      if (firstInput) firstInput.focus();
    }
  }, 100);
};

window.editPrfRemoveItem = function(idx) {
  var item = _editPrfState.currentItems[idx];
  if (!item) return;
  
  if (!item._isNew) {
    if (!confirm('Remove item "' + item.item_code + '" from this revision?')) return;
  }
  
  _editPrfState.currentItems.splice(idx, 1);
  renderEditPrfItems();
};

function computePrfItemsDiff(oldItems, newItems) {
  var diff = { added: [], removed: [], modified: [] };
  
  var oldMap = {};
  oldItems.forEach(function(it) { oldMap[it.item_code] = it; });
  
  var newMap = {};
  newItems.forEach(function(it) { newMap[it.item_code] = it; });
  
  newItems.forEach(function(newIt) {
    var oldIt = oldMap[newIt.item_code];
    if (!oldIt) {
      diff.added.push({ item_code: newIt.item_code, description: newIt.description, qty: newIt.qty_for_order });
    } else if (Number(oldIt.qty_for_order) !== Number(newIt.qty_for_order)) {
      diff.modified.push({ item_code: newIt.item_code, old_qty: oldIt.qty_for_order, new_qty: newIt.qty_for_order });
    }
  });
  
  oldItems.forEach(function(oldIt) {
    if (!newMap[oldIt.item_code]) {
      diff.removed.push({ item_code: oldIt.item_code, description: oldIt.description, qty: oldIt.qty_for_order });
    }
  });
  
  return diff;
}

window.saveEditPrfItems = async function() {
  if (_editPrfState.isSaving) return;

  // Sync inputs to state bago mag-save
  _syncEditPrfInputs();

  var prf = _editPrfState.originalPrf;
  if (!prf) { erpShowToast('No PRF loaded', 'warning'); return; }

  var reason = (document.getElementById('editPrfRevisionReason').value || '').trim();
  if (!reason) {
    erpShowToast('Reason for revision is required', 'warning');
    document.getElementById('editPrfRevisionReason').focus();
    return;
  }

  var validItems = [];
  for (var i = 0; i < _editPrfState.currentItems.length; i++) {
    var it = _editPrfState.currentItems[i];
    if (!it.item_code || !it.item_code.trim()) {
      erpShowToast('Item #' + (i + 1) + ' has no item code', 'warning'); return;
    }
    if (it.qty_for_order <= 0) {
      erpShowToast('Item #' + (i + 1) + ' has invalid qty', 'warning'); return;
    }
    validItems.push(it);
  }

  if (validItems.length === 0) { erpShowToast('Add at least one item', 'warning'); return; }

  if (!confirm('Save changes to ' + prf.prf_no + ' as v' + _editPrfState.newVersionNumber + '?\n\n' +
    validItems.length + ' item(s) will be saved. Same PRF number, updated version.')) return;

  _editPrfState.isSaving = true;
  var btn = document.getElementById('btnSaveEditPrfItems');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

  try {
    var currentUser = localStorage.getItem('ivm_username') || '';
    var currentFullname = localStorage.getItem('ivm_userFullname') || currentUser;

    var currentVersion = parseInt(prf.version_number, 10) || 1;
    var newVersion = _editPrfState.newVersionNumber;
    var diff = computePrfItemsDiff(_editPrfState.originalItems, validItems);
    var totalQty = validItems.reduce(function(s, it) { return s + (it.qty_for_order || 0); }, 0);

    // STEP 1: Update PRF document
    var updateDocPayload = {
      version_number: newVersion,
      total_items: validItems.length,
      total_qty: totalQty,
      revision_reason: reason,
      revised_by: currentUser,
      revised_by_fullname: currentFullname,
      revised_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    var docRes = await fetch(erpUrl('prf_documents?id=eq.' + prf.id), {
      method: 'PATCH',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(updateDocPayload)
    });

    if (!docRes.ok) throw new Error('Update PRF doc failed: ' + docRes.status);

    // STEP 2: Replace items
    var delRes = await fetch(erpUrl('prf_items?prf_id=eq.' + prf.id), {
      method: 'DELETE',
      headers: erpHeaders()
    });

    if (!delRes.ok) throw new Error('Delete old items failed');

    var itemPayloads = validItems.map(function(it, idx) {
      return {
        prf_id: prf.id,
        prf_no: prf.prf_no,
        line_no: idx + 1,
        item_code: it.item_code,
        description: it.description,
        category: it.category || prf.category,
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

    var itemRes = await fetch(erpUrl('prf_items'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(itemPayloads)
    });

    if (!itemRes.ok) throw new Error('Insert new items failed: ' + itemRes.status);

    // STEP 3: Log audit
    try {
      await fetch(erpUrl('prf_revision_audit'), {
        method: 'POST',
        headers: erpHeaders({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          base_prf_no: prf.base_prf_no || prf.prf_no,
          prf_no: prf.prf_no,
          from_version: currentVersion,
          to_version: newVersion,
          new_prf_id: prf.id,
          revised_by: currentUser,
          revised_by_fullname: currentFullname,
          reason: reason,
          changes: diff
        })
      });
    } catch(auditErr) {
      console.warn('[EditPRF] Audit log failed:', auditErr);
    }

    closeEditPrfItems();

    var diffSummary = 'Added: ' + diff.added.length + ' | Removed: ' + diff.removed.length + ' | Modified: ' + diff.modified.length;
    erpShowToast('✅ ' + prf.prf_no + ' updated to v' + newVersion + '! ' + diffSummary, 'success');

    await prfMonitorLoad();

  } catch(err) {
    console.error('[saveEditPrfItems]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _editPrfState.isSaving = false;
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
};

// Helper function para basahin lahat ng inputs at i-sync sa state
function _syncEditPrfInputs() {
  var rows = document.querySelectorAll('#editPrfItemsBody tbody tr');
  rows.forEach(function(row, idx) {
    if (!_editPrfState.currentItems[idx]) return;
    row.querySelectorAll('input[data-field]').forEach(function(inp) {
      var field = inp.getAttribute('data-field');
      var val = inp.value;
      if (field === 'qty_for_order') val = parseFloat(val) || 0;
      _editPrfState.currentItems[idx][field] = val;
    });
  });
}

// ═══════════════════════════════════════════════════════════
// AUTO-SUGGEST FOR EDIT PRF ITEMS
// ═══════════════════════════════════════════════════════════

var _editPrfInventoryCache = null;
var _editPrfSearchTimers = {};

async function _loadEditPrfInventory() {
  if (_editPrfInventoryCache) return _editPrfInventoryCache;
  try {
    if (typeof erpGetInventoryListForDropdown === 'function') {
      _editPrfInventoryCache = await erpGetInventoryListForDropdown();
    } else {
      var rows = await erpFetch('erp_items',
        'select=item_code,description,base_unit,category,location' +
        '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false' +
        '&order=item_code.asc&limit=5000');
      _editPrfInventoryCache = (rows || []).map(function(r) {
        return {
          code: r.item_code,
          description: r.description || '',
          unit: r.base_unit || 'PIECE',
          category: r.category || '',
          location: r.location || ''
        };
      });
    }
    console.log('[EditPRF] Inventory loaded:', _editPrfInventoryCache.length);
    return _editPrfInventoryCache;
  } catch(err) {
    console.warn('[EditPRF] Load inventory failed:', err.message);
    _editPrfInventoryCache = [];
    return [];
  }
}

window.onEditPrfItemSearch = async function(idx, value) {
  var input = document.getElementById('editPrfItemCode' + idx);
  var dropdown = document.getElementById('editPrfDropdown' + idx);
  if (!input || !dropdown) return;

  var term = String(value || '').toLowerCase().trim();

  if (_editPrfSearchTimers[idx]) clearTimeout(_editPrfSearchTimers[idx]);

  if (!term || term.length < 2) {
    dropdown.classList.add('d-none');
    return;
  }

  dropdown.innerHTML = '<div class="list-group-item text-muted small" style="padding:10px 14px;">' +
    '<i class="bi bi-hourglass-split me-1"></i>Searching...</div>';
  _positionEditPrfDropdown(dropdown, input);
  dropdown.classList.remove('d-none');

  _editPrfSearchTimers[idx] = setTimeout(async function() {
    var items = await _loadEditPrfInventory();
    var matches = items.filter(function(it) {
      var code = String(it.code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
    }).slice(0, 25);

    matches.sort(function(a, b) {
      var aC = String(a.code || '').toLowerCase();
      var bC = String(b.code || '').toLowerCase();
      var aExact = aC === term ? 0 : 1;
      var bExact = bC === term ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      var aStart = aC.indexOf(term) === 0 ? 0 : 1;
      var bStart = bC.indexOf(term) === 0 ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return aC.localeCompare(bC);
    });

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="list-group-item text-muted small" style="padding:10px 14px;">' +
        '<i class="bi bi-x-circle me-1"></i>No matches found</div>';
      return;
    }

    var html = '';
    matches.forEach(function(it) {
      var code = String(it.code || '');
      var desc = String(it.description || '');
      var unit = String(it.unit || 'PIECE');
      var category = String(it.category || '');
      var safeCode = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safeDesc = desc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var safeUnit = unit.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      html += '<div class="list-group-item list-group-item-action" ' +
        'style="padding:10px 14px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid #f0f0f0;background:#fff;" ' +
        'onmousedown="event.preventDefault();selectEditPrfItem(' + idx + ', \'' +
          safeCode + '\', \'' + safeDesc + '\', \'' + safeUnit + '\')">' +
        '<div style="font-family:\'Courier New\',monospace;font-weight:700;color:#1e3a5f;">' + erpEsc(code) + '</div>' +
        '<div style="color:#4b5563;font-size:0.8rem;">' + erpEsc(desc.substring(0, 100)) + (desc.length > 100 ? '…' : '') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:3px;font-size:0.7rem;color:#6b7280;">' +
          '<span class="badge bg-light text-dark">' + erpEsc(unit) + '</span>' +
          (category ? '<span class="badge bg-secondary">' + erpEsc(category) + '</span>' : '') +
        '</div>' +
      '</div>';
    });
    dropdown.innerHTML = html;
    _positionEditPrfDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
  }, 200);
};

function _positionEditPrfDropdown(dropdown, input) {
  var rect = input.getBoundingClientRect();
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;
  var width = Math.max(rect.width, 450);
  var maxWidth = window.innerWidth - rect.left - 20;
  if (width > maxWidth) width = maxWidth;

  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = width + 'px';
  dropdown.style.zIndex = '99999';

  if (spaceBelow < 320 && spaceAbove > spaceBelow) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceAbove - 20, 320) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceBelow - 20, 320) + 'px';
  }
}

window.selectEditPrfItem = function(idx, code, description, unit) {
  if (!_editPrfState.currentItems[idx]) return;

  _editPrfState.currentItems[idx].item_code = code;
  _editPrfState.currentItems[idx].description = description;
  _editPrfState.currentItems[idx].unit = unit;

  var codeInput = document.getElementById('editPrfItemCode' + idx);
  if (codeInput) codeInput.value = code;

  var row = codeInput ? codeInput.closest('tr') : null;
  if (row) {
    var descInput = row.querySelector('input[data-field="description"]');
    if (descInput) descInput.value = description;

    var unitInput = row.querySelector('input[data-field="unit"]');
    if (unitInput) unitInput.value = unit;
  }

  var dropdown = document.getElementById('editPrfDropdown' + idx);
  if (dropdown) dropdown.classList.add('d-none');

  setTimeout(function() {
    if (row) {
      var qtyInput = row.querySelector('input[data-field="qty_for_order"]');
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }
  }, 100);
};

window.onEditPrfItemBlur = function(idx) {
  setTimeout(function() {
    var dropdown = document.getElementById('editPrfDropdown' + idx);
    if (dropdown) dropdown.classList.add('d-none');
  }, 200);
};

document.addEventListener('click', function(e) {
  if (!e.target.closest('.edit-prf-item-search') && !e.target.closest('.edit-prf-item-dropdown')) {
    document.querySelectorAll('.edit-prf-item-dropdown').forEach(function(el) {
      el.classList.add('d-none');
    });
  }
});

window.addEventListener('scroll', function() {
  document.querySelectorAll('.edit-prf-item-dropdown:not(.d-none)').forEach(function(el) {
    var idx = el.id.replace('editPrfDropdown', '');
    var input = document.getElementById('editPrfItemCode' + idx);
    if (input) _positionEditPrfDropdown(el, input);
  });
}, { passive: true });

// ═══════════════════════════════════════════════════════════
// VERSION HISTORY
// ═══════════════════════════════════════════════════════════

window.openPrfVersionHistory = async function(basePrfNo) {
  document.getElementById('prfHistoryTitle').textContent = basePrfNo;
  document.getElementById('prfHistoryBody').innerHTML = 
    '<div class="text-center py-4"><div class="erp-spinner" style="margin:0 auto;"></div></div>';
  
  var modalEl = document.getElementById('prfVersionHistoryModal');
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  try {
    var versions = await erpFetch('prf_documents',
      'select=*&base_prf_no=eq.' + encodeURIComponent(basePrfNo) +
      '&order=version_number.desc');
    
    var audits = await erpFetch('prf_revision_audit',
      'select=*&base_prf_no=eq.' + encodeURIComponent(basePrfNo) +
      '&order=created_at.desc');
    
    renderVersionHistory(versions || [], audits || []);
  } catch(err) {
    document.getElementById('prfHistoryBody').innerHTML = 
      '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
};

function renderVersionHistory(versions, audits) {
  var body = document.getElementById('prfHistoryBody');
  if (!body) return;
  
  var html = '';
  
  html += '<h6 class="mb-3"><i class="bi bi-layers me-1"></i>All Versions (' + versions.length + ')</h6>';
  
  if (versions.length === 0) {
    html += '<div class="text-muted text-center py-3">No versions found</div>';
  } else {
    var maxVersion = Math.max.apply(null, versions.map(function(v) {
      return parseInt(v.version_number, 10) || 1;
    }));
    
    html += '<div class="list-group mb-4">';
    versions.forEach(function(v) {
      var vNum = parseInt(v.version_number, 10) || 1;
      var isLatest = (vNum === maxVersion);
      var dateStr = v.created_at ? new Date(v.created_at).toLocaleString() : '—';
      
      html += '<div class="list-group-item"' + (isLatest ? ' style="background:#f0fdf4;border-left:4px solid #10b981;"' : '') + '>' +
        '<div class="d-flex justify-content-between align-items-start">' +
          '<div class="flex-grow-1">' +
            '<div class="d-flex align-items-center gap-2 flex-wrap">' +
              '<strong style="font-family:\'Courier New\',monospace;">' + erpEsc(v.prf_no) + '</strong>' +
              '<span class="badge ' + (isLatest ? 'bg-success' : 'bg-secondary') + '">' +
                'v' + vNum + (isLatest ? ' LATEST' : ' OLD') + '</span>' +
              '<span class="badge bg-light text-dark">' + erpEsc(v.category) + '</span>' +
              '<span class="text-muted small">' + (v.total_items || 0) + ' items · ' + 
                (v.total_qty || 0) + ' qty</span>' +
            '</div>' +
            '<div class="small text-muted mt-1">' +
              '<i class="bi bi-calendar me-1"></i>' + erpEsc(dateStr) +
              (v.revised_by_fullname ? ' · <i class="bi bi-person me-1"></i>' + erpEsc(v.revised_by_fullname) : '') +
            '</div>' +
            (v.revision_reason ? '<div class="small mt-2 p-2" style="background:#fffbeb;border-radius:6px;">' +
              '<strong>Reason:</strong> ' + erpEsc(v.revision_reason) + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }
  
  if (audits.length > 0) {
    html += '<h6 class="mb-3"><i class="bi bi-clock-history me-1"></i>Revision History</h6>';
    html += '<div class="table-responsive"><table class="erp-table" style="font-size:0.82rem;">';
    html += '<thead><tr><th>Date</th><th>Version</th><th>By</th><th>Changes</th><th>Reason</th></tr></thead><tbody>';
    
    audits.forEach(function(a) {
      var dateStr = a.created_at ? new Date(a.created_at).toLocaleString() : '—';
      var changes = a.changes || {};
      var addedCount = (changes.added || []).length;
      var removedCount = (changes.removed || []).length;
      var modifiedCount = (changes.modified || []).length;
      
      var changesParts = [];
      if (addedCount > 0) changesParts.push('<span class="badge bg-success">+' + addedCount + ' added</span>');
      if (removedCount > 0) changesParts.push('<span class="badge bg-danger">−' + removedCount + ' removed</span>');
      if (modifiedCount > 0) changesParts.push('<span class="badge bg-warning text-dark">' + modifiedCount + ' modified</span>');
      
      var changesSummary = changesParts.length > 0 
        ? changesParts.join(' ')
        : '<span class="text-muted small">No item changes</span>';
      
      html += '<tr>' +
        '<td style="font-size:0.75rem;">' + erpEsc(dateStr) + '</td>' +
        '<td><span class="badge bg-secondary">v' + a.from_version + ' → v' + a.to_version + '</span></td>' +
        '<td>' + erpEsc(a.revised_by_fullname || a.revised_by) + '</td>' +
        '<td>' + changesSummary + '</td>' +
        '<td style="font-size:0.75rem;">' + erpEsc(a.reason || '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }
  
  body.innerHTML = html;
}

console.log('✅ prf-monitor.js v3.4 loaded (with version filter)');
