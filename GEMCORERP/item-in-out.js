// ============================================================
// GEMCOR ERP — Item In & Out (Movement History Viewer)
// v1.1 — Added Beginning Balance (Beg Bal) computation
// ============================================================

var _io = {
  currentItem: null,
  allMovements: [],
  filteredMovements: [],
  allEdits: [],
  inventoryCache: null,
  searchTimer: null,
  activeTab: 'movements'
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Item In & Out v1.1] Initializing...');
  ioCheckHealth();

  // ✅ Auto-load item from URL parameter
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  if (code) {
    console.log('[Item In & Out] Auto-loading from URL:', code);
    setTimeout(function() {
      document.getElementById('ioSearchInput').value = code;
      ioLoadItem(code);
    }, 500);
  }
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
// SEARCH
// ═══════════════════════════════════════════════════════════
function ioOnSearchInput(value) {
  var dropdown = document.getElementById('ioSearchDropdown');
  var term = String(value || '').toLowerCase().trim();

  if (_io.searchTimer) clearTimeout(_io.searchTimer);

  if (!term || term.length < 2) {
    dropdown.classList.add('d-none');
    return;
  }

    dropdown.innerHTML = '<div class="item-search-item" style="color:#9ca3af;text-align:center;">' +
    '<i class="bi bi-hourglass-split me-1"></i>Searching...</div>';
  dropdown.classList.remove('d-none');

  var input = document.getElementById('ioSearchInput');
  _ioPositionDropdown(dropdown, input);

  _io.searchTimer = setTimeout(function() { ioSearchItems(term); }, 250);
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
          '&is_active=eq.true&is_deleted=eq.false&order=item_code.asc&limit=5000');
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

    var input = document.getElementById('ioSearchInput');
    _ioPositionDropdown(dropdown, input);

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
  _io.allEdits = [];
}

// ═══════════════════════════════════════════════════════════
// LOAD ITEM
// ═══════════════════════════════════════════════════════════
async function ioLoadItem(itemCode) {
  if (!itemCode) return;
  console.log('[Item In & Out] Loading:', itemCode);

  try {
    var itemRows = await erpFetch('erp_items',
      'select=item_code,description,base_unit,category,location,on_hand,unit_cost' +
      '&item_code=eq.' + encodeURIComponent(itemCode) + '&limit=1');

    if (!itemRows || itemRows.length === 0) {
      erpShowToast('Item not found: ' + itemCode, 'warning');
      return;
    }

    var item = itemRows[0];
    _io.currentItem = item;

    // Fetch movements + manual edits in parallel
    var [movements, edits] = await Promise.all([
      erpFetch('v_item_movements',
        'select=*&item_code=eq.' + encodeURIComponent(itemCode) +
        '&order=transaction_date.desc&limit=1000'),
      erpFetch('v_item_manual_edits',
        'select=*&item_code=eq.' + encodeURIComponent(itemCode) +
        '&order=edited_at.desc&limit=500').catch(function() { return []; })
    ]);

    _io.allMovements = movements || [];
    _io.allEdits = edits || [];

    console.log('[Item In & Out] Movements:', _io.allMovements.length, '| Edits:', _io.allEdits.length);

    ioRenderItemInfo(item);
    ioComputeKPIs();
    ioRenderMovements();
    ioRenderEdits();

    document.getElementById('ioEmptyState').classList.add('d-none');
    document.getElementById('ioContent').classList.remove('d-none');

  } catch(err) {
    console.error('[ioLoadItem]', err);
    erpShowToast('Failed to load: ' + err.message, 'danger');
  }
}

function ioRenderItemInfo(item) {
  document.getElementById('ioItemCode').textContent = item.item_code || '—';
  document.getElementById('ioItemDesc').textContent = item.description || '—';
  document.getElementById('ioItemCategory').textContent = item.category || 'Uncategorized';
  document.getElementById('ioItemLocation').textContent = item.location || 'No location';
  document.getElementById('ioItemUnit').textContent = item.base_unit || 'PCS';
  document.getElementById('ioOnHand').textContent = ioNum(item.on_hand || 0);
}

// ═══════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════
function ioComputeKPIs() {
  var totalIn = 0, totalOut = 0, adjustments = 0;

  _io.allMovements.forEach(function(m) {
    var qtyIn = Number(m.qty_in || 0);
    var qtyOut = Number(m.qty_out || 0);
    var dir = String(m.direction || '').toUpperCase();

    if (dir === 'ADJUSTMENT') adjustments++;
    totalIn += qtyIn;
    totalOut += qtyOut;
  });

  document.getElementById('ioTotalIn').textContent = ioNum(totalIn);
  document.getElementById('ioTotalOut').textContent = ioNum(totalOut);
  document.getElementById('ioTotalAdj').textContent = ioNum(adjustments);
  document.getElementById('ioTotalMovements').textContent = ioNum(_io.allMovements.length);

  document.getElementById('ioTabMovementsCount').textContent = _io.allMovements.length;
  document.getElementById('ioTabEditsCount').textContent = _io.allEdits.length;
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function ioSwitchTab(tab) {
  _io.activeTab = tab;

  document.querySelectorAll('.io-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });

  var mvTab = document.getElementById('ioTabMovements');
  var edTab = document.getElementById('ioTabEdits');

  if (tab === 'movements') {
    mvTab.classList.remove('d-none');
    edTab.classList.add('d-none');
  } else {
    mvTab.classList.add('d-none');
    edTab.classList.remove('d-none');
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER MOVEMENTS (With Beg Bal Computation)
// ═══════════════════════════════════════════════════════════
function ioRenderMovements() {
  var tbody = document.getElementById('ioTableBody');
  if (!tbody) return;

  var dirFilter = document.getElementById('ioDirectionFilter').value;
  var dateFrom = document.getElementById('ioDateFrom').value;
  var dateTo = document.getElementById('ioDateTo').value;

  // Filter movements base sa Direction at Date Range
  _io.filteredMovements = _io.allMovements.filter(function(m) {
    if (dirFilter) {
      var dir = String(m.direction || '').toUpperCase();
      if (dir !== dirFilter) return false;
    }
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

  // ✅ COMPUTE BEG BAL & END BAL
  var currentOnHand = Number(_io.currentItem ? _io.currentItem.on_hand : 0);
  var periodIn = 0;
  var periodOut = 0;

  _io.filteredMovements.forEach(function(m) {
    periodIn += Number(m.qty_in || 0);
    periodOut += Number(m.qty_out || 0);
  });

  // Beg Bal Formula: Current On-Hand - Period In + Period Out
  // Ito ay 'derived' Beg Bal. Kung walang filter, babalik siya sa Current On-Hand.
  var begBal = currentOnHand - periodIn + periodOut;
  var endBal = begBal + periodIn - periodOut;

  // Update Summary Bar
  document.getElementById('ioBegBal').textContent = ioNum(begBal);
  document.getElementById('ioPeriodIn').textContent
