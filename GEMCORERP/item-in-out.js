// ============================================================
// GEMCOR ERP — Item In & Out (Movement History Viewer)
// v1.0 — Search item → show ledger + adjustments + manual edits
// ============================================================

var _io = {
  currentItem: null,
  allMovements: [],
  filteredMovements: [],
  inventoryCache: null,
  searchTimer: null,
  isSearching: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Item In & Out v1.0] Initializing...');
  ioCheckHealth();
});

async function ioCheckHealth() {
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
// SEARCH AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════
function ioOnSearchInput(value) {
  var dropdown = document.getElementById('ioSearchDropdown');
  var input = document.getElementById('ioSearchInput');
  var term = String(value || '').toLowerCase().trim();

  if (_io.searchTimer) clearTimeout(_io.searchTimer);

  if (!term || term.length < 2) {
    dropdown.classList.add('d-none');
    return;
  }

  dropdown.innerHTML = '<div class="item-search-item" style="color:#9ca3af;text-align:center;">' +
    '<i class="bi bi-hourglass-split me-1"></i>Searching...</div>';
  dropdown.classList.remove('d-none');

  _io.searchTimer = setTimeout(function() {
    ioSearchItems(term);
  }, 250);
}

async function ioSearchItems(term) {
  var dropdown = document.getElementById('ioSearchDropdown');
  try {
    if (!_io.inventoryCache) {
      if (typeof erpGetInventoryListForDropdown === 'function') {
        _io.inventoryCache = await erpGetInventoryListForDropdown();
      } else {
        var rows = await erpFetch('erp_items',
          'select=item_code,description,base_unit,category,location,on_hand' +
          '&is_active=eq.true' +
          '&is_deleted=eq.false' +
          '&limit=5000&order=item_code.asc');
        _io.inventoryCache = (rows || []).map(function(r) {
          return {
            code: r.item_code,
            description: r.description || '',
            unit: r.base_unit || 'PCS',
            category: r.category || '',
            location: r.location || ''
          };
        });
      }
    }

    var items = _io.inventoryCache || [];

    var matches = items.filter(function(it) {
      var code = String(it.code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
    }).slice(0, 25);

    // Sort: exact match > starts-with > contains
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
      dropdown.innerHTML = '<div class="item-search-item" style="color:#9ca3af;text-align:center;">' +
        '<i class="bi bi-x-circle me-1"></i>No matches found</div>';
      return;
    }

    var html = '';
    matches.forEach(function(it) {
      var safeCode = String(it.code || '').replace(/'/g, "\\'");
      html += '<div class="item-search-item" onclick="ioSelectItem(\'' + safeCode + '\')">' +
        '<div class="code">' + ioEsc(it.code) + '</div>' +
        '<div class="desc">' + ioEsc(it.description || '—') + '</div>' +
        '<div class="meta">' +
          '<span class="badge bg-light text-dark">' + ioEsc(it.unit || 'PCS') + '</span>' +
          (it.category ? '<span><i class="bi bi-tag me-1"></i>' + ioEsc(it.category) + '</span>' : '') +
          (it.location ? '<span><i class="bi bi-geo-alt me-1"></i>' + ioEsc(it.location) + '</span>' : '') +
        '</div>' +
      '</div>';
    });
    dropdown.innerHTML = html;
    dropdown.classList.remove('d-none');

  } catch(err) {
    console.error('[ioSearchItems]', err);
    dropdown.innerHTML = '<div class="item-search-item" style="color:#dc2626;">' +
      '<i class="bi bi-exclamation-triangle me-1"></i>Search error</div>';
  }
}

function ioSelectItem(itemCode) {
  document.getElementById('ioSearchDropdown').classList.add('d-none');
  document.getElementById('ioSearchInput').value = itemCode;
  ioLoadItem(itemCode);
}

function ioClearSearch() {
  document.getElementById('ioSearchInput').value = '';
  document.getElementById('ioSearchDropdown').classList.add('d-none');
  document.getElementById('ioContent').classList.add('d-none');
  document.getElementById('ioEmptyState').classList.remove('d-none');
  _io.currentItem = null;
  _io.allMovements = [];
}

// ═══════════════════════════════════════════════════════════
// LOAD ITEM + MOVEMENTS
// ═══════════════════════════════════════════════════════════
async function ioLoadItem(itemCode) {
  if (!itemCode) return;

  console.log('[Item In & Out] Loading:', itemCode);

  try {
    // STEP 1: Fetch item info
    var itemRows = await erpFetch('erp_items',
      'select=item_code,description,base_unit,category,location,on_hand,unit_cost' +
      '&item_code=eq.' + encodeURIComponent(itemCode) +
      '&limit=1');

    if (!itemRows || itemRows.length === 0) {
      erpShowToast('Item not found: ' + itemCode, 'warning');
      return;
    }

    var item = itemRows[0];
    _io.currentItem = item;

    // STEP 2: Fetch movements from view
    var movements = await erpFetch('v_item_movements',
      'select=*&item_code=eq.' + encodeURIComponent(itemCode) +
      '&order=transaction_date.desc&limit=1000');

    _io.allMovements = movements || [];

    console.log('[Item In & Out] Loaded ' + _io.allMovements.length + ' movements');

    // STEP 3: Render
    ioRenderItemInfo(item);
    ioComputeKPIs();
    ioRenderMovements();

    // Show content, hide empty
    document.getElementById('ioEmptyState').classList.add('d-none');
    document.getElementById('ioContent').classList.remove('d-none');

  } catch(err) {
    console.error('[ioLoadItem]', err);
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER ITEM INFO
// ═══════════════════════════════════════════════════════════
function ioRenderItemInfo(item) {
  document.getElementById('ioItemCode').textContent = item.item_code || '—';
  document.getElementById('ioItemDesc').textContent = item.description || '—';
  document.getElementById('ioItemCategory').textContent = item.category || 'Uncategorized';
  document.getElementById('ioItemLocation').textContent = item.location || 'No location';
  document.getElementById('ioItemUnit').textContent = item.base_unit || 'PCS';
  document.getElementById('ioOnHand').textContent = ioNum(item.on_hand || 0);
}

// ═══════════════════════════════════════════════════════════
// COMPUTE KPIs
// ═══════════════════════════════════════════════════════════
function ioComputeKPIs() {
  var totalIn = 0;
  var totalOut = 0;
  var adjustments = 0;

  _io.allMovements.forEach(function(m) {
    var qtyIn = Number(m.qty_in || 0);
    var qtyOut = Number(m.qty_out || 0);
    var dir = String(m.direction || '').toUpperCase();

    if (dir === 'ADJUSTMENT') {
      adjustments++;
    }

    // Always add the actual quantities
    totalIn += qtyIn;
    totalOut += qtyOut;
  });

  document.getElementById('ioTotalIn').textContent = ioNum(totalIn);
  document.getElementById('ioTotalOut').textContent = ioNum(totalOut);
  document.getElementById('ioTotalAdj').textContent = ioNum(adjustments);
  document.getElementById('ioTotalMovements').textContent = ioNum(_io.allMovements.length);
}

// ═══════════════════════════════════════════════════════════
// RENDER MOVEMENTS TABLE
// ═══════════════════════════════════════════════════════════
function ioRenderMovements() {
  var tbody = document.getElementById('ioTableBody');
  if (!tbody) return;

  var dirFilter = document.getElementById('ioDirectionFilter').value;
  var dateFrom = document.getElementById('ioDateFrom').value;
  var dateTo = document.getElementById('ioDateTo').value;

  _io.filteredMovements = _io.allMovements.filter(function(m) {
    // Direction filter
    if (dirFilter) {
      var dir = String(m.direction || '').toUpperCase();
      if (dir !== dirFilter) return false;
    }

    // Date range
    if (dateFrom || dateTo) {
      var txDate = m.transaction_date ? new Date(m.transaction_date) : null;
      if (txDate) {
        if (dateFrom) {
          var fromD = new Date(dateFrom + 'T00:00:00');
          if (txDate < fromD) return false;
        }
        if (dateTo) {
          var toD = new Date(dateTo + 'T23:59:59');
          if (txDate > toD) return false;
        }
      }
    }

    return true;
  });

  var total = _io.filteredMovements.length;
  document.getElementById('ioTableCount').textContent = total + ' movements';

  // Subtitle
  var subtitleEl = document.getElementById('ioTableSubtitle');
  if (subtitleEl) {
    if (dirFilter === 'IN') subtitleEl.textContent = 'IN movements only';
    else if (dirFilter === 'OUT') subtitleEl.textContent = 'OUT movements only';
    else if (dirFilter === 'ADJUSTMENT') subtitleEl.textContent = 'Adjustments only';
    else subtitleEl.textContent = 'All movements';
  }

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No movements found for this filter.</td></tr>';
    return;
  }

  var html = '';
  _io.filteredMovements.forEach(function(m, idx) {
    var txDate = m.transaction_date ? new Date(m.transaction_date) : null;
    var dateStr = txDate ? txDate.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }) : '—';

    var dir = String(m.direction || 'OTHER').toUpperCase();
    var dirBadge = '';
    var rowClass = '';
    if (dir === 'IN') { dirBadge = '<span class="dir-in"><i class="bi bi-arrow-down me-1"></i>IN</span>'; rowClass = 'row-in'; }
    else if (dir === 'OUT') { dirBadge = '<span class="dir-out"><i class="bi bi-arrow-up me-1"></i>OUT</span>'; rowClass = 'row-out'; }
    else if (dir === 'ADJUSTMENT') { dirBadge = '<span class="dir-adj"><i class="bi bi-gear me-1"></i>ADJ</span>'; rowClass = 'row-adj'; }
    else if (dir === 'MIXED') { dirBadge = '<span class="dir-mixed"><i class="bi bi-arrow-left-right me-1"></i>MIXED</span>'; }
    else { dirBadge = '<span class="dir-other">' + ioEsc(dir) + '</span>'; }

    var qtyIn = Number(m.qty_in || 0);
    var qtyOut = Number(m.qty_out || 0);
    var inDisplay = qtyIn > 0 ? '<span class="text-success fw-bold">+' + ioNum(qtyIn) + '</span>' : '—';
    var outDisplay = qtyOut > 0 ? '<span class="text-danger fw-bold">−' + ioNum(qtyOut) + '</span>' : '—';

    var balance = m.balance_after != null ? ioNum(m.balance_after) : '—';

    var typeLabel = String(m.transaction_type || '—').replace(/_/g, ' ');

    html += '<tr class="' + rowClass + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td style="font-size:0.78rem;">' + ioEsc(dateStr) + '</td>' +
      '<td class="text-center">' + dirBadge + '</td>' +
      '<td><span class="badge bg-secondary">' + ioEsc(typeLabel) + '</span></td>' +
      '<td><code style="font-size:0.75rem;">' + ioEsc(m.reference_doc || '—') + '</code></td>' +
      '<td class="text-end">' + inDisplay + '</td>' +
      '<td class="text-end">' + outDisplay + '</td>' +
      '<td class="text-end fw-bold">' + balance + '</td>' +
      '<td>' + ioEsc(m.performed_by || '—') + '</td>' +
      '<td title="' + ioEsc(m.reason || '') + '">' + ioEsc(ioTruncate(m.reason || '—', 40)) + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function ioClearFilters() {
  document.getElementById('ioDirectionFilter').value = '';
  document.getElementById('ioDateFrom').value = '';
  document.getElementById('ioDateTo').value = '';
  ioRenderMovements();
}

// ═══════════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════════
function ioExport() {
  if (!_io.currentItem) {
    erpShowToast('No item selected', 'warning');
    return;
  }
  if (_io.filteredMovements.length === 0) {
    erpShowToast('No movements to export', 'warning');
    return;
  }

  var item = _io.currentItem;
  var headers = [
    'Date', 'Direction', 'Type', 'Reference',
    'Qty In', 'Qty Out', 'Balance Before', 'Balance After',
    'Performed By', 'Reason'
  ];

  var rows = _io.filteredMovements.map(function(m) {
    var txDate = m.transaction_date ? new Date(m.transaction_date) : null;
    return [
      txDate ? txDate.toLocaleString() : '',
      m.direction || '',
      m.transaction_type || '',
      m.reference_doc || '',
      Number(m.qty_in || 0),
      Number(m.qty_out || 0),
      Number(m.balance_before || 0),
      Number(m.balance_after || 0),
      m.performed_by || '',
      m.reason || ''
    ];
  });

  var csv = 'Item Code,' + _csvEscIo(item.item_code) + '\n';
  csv += 'Description,' + _csvEscIo(item.description) + '\n';
  csv += 'Category,' + _csvEscIo(item.category || '') + '\n';
  csv += 'Current On-Hand,' + (item.on_hand || 0) + '\n';
  csv += '\n';
  csv += headers.map(_csvEscIo).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscIo).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Item_Movements_' + item.item_code + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' movements', 'success');
}

function _csvEscIo(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function ioNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function ioTruncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function ioEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// ═══════════════════════════════════════════════════════════
// CLICK OUTSIDE — Close dropdown
// ═══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  if (!e.target.closest('.item-search-wrap')) {
    var dropdown = document.getElementById('ioSearchDropdown');
    if (dropdown) dropdown.classList.add('d-none');
  }
});

console.log('✅ item-in-out.js v1.0 loaded');
