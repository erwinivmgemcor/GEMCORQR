// ============================================================
// GEMCOR ERP — Replenishment Needs (v1.0)
// Shows items below reorder point + Create PRF Batch
// ============================================================

var _rp = {
  allItems: [],
  filteredItems: [],
  selectedItems: {},
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  prfModal: null,
  successModal: null,
  isSubmitting: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Replenishment v1.0] Initializing...');

  rpCheckHealth();
  rpLoad();
});

async function rpCheckHealth() {
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
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function rpLoad() {
  var tbody = document.getElementById('rpTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="13" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading replenishment needs...</div></td></tr>';
  }

  try {
    var t0 = Date.now();
    var rows = await erpFetch('erp_v_reorder_list', 'select=*');
    _rp.allItems = rows || [];
    console.log('[Replenishment] Loaded ' + _rp.allItems.length + ' items in ' + (Date.now() - t0) + 'ms');

    rpPopulateFilters();
    rpComputeKPIs();
    _rp.currentPage = 1;
    rpRender();

  } catch(err) {
    console.error('[rpLoad]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="13" class="erp-empty text-danger">' +
        'Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════
function rpComputeKPIs() {
  var critical = 0, urgent = 0, needed = 0;
  var totalCost = 0;

  _rp.allItems.forEach(function(it) {
    var u = String(it.urgency || '').toUpperCase();
    if (u === 'CRITICAL') critical++;
    else if (u === 'URGENT') urgent++;
    else if (u === 'NEEDED') needed++;
    
    totalCost += Number(it.value_needed || 0);
  });

  document.getElementById('rpKpiCritical').textContent = rpNum(critical);
  document.getElementById('rpKpiUrgent').textContent = rpNum(urgent);
  document.getElementById('rpKpiNeeded').textContent = rpNum(needed);
  document.getElementById('rpKpiCost').textContent = '₱' + rpNum(totalCost);
}

// ═══════════════════════════════════════════════════════════
// POPULATE FILTERS
// ═══════════════════════════════════════════════════════════
function rpPopulateFilters() {
  var catSel = document.getElementById('rpCategoryFilter');
  var locSel = document.getElementById('rpLocationFilter');
  if (!catSel || !locSel) return;

  var currentCat = catSel.value;
  var currentLoc = locSel.value;

  var cats = {}, locs = {};
  _rp.allItems.forEach(function(it) {
    if (it.category) cats[it.category] = true;
    if (it.location) locs[it.location] = true;
  });

  catSel.innerHTML = '<option value="">All Categories</option>';
  Object.keys(cats).sort().forEach(function(c) {
    catSel.innerHTML += '<option value="' + rpEsc(c) + '"' + (c === currentCat ? ' selected' : '') + '>' + rpEsc(c) + '</option>';
  });

  locSel.innerHTML = '<option value="">All Locations</option>';
  Object.keys(locs).sort().forEach(function(l) {
    locSel.innerHTML += '<option value="' + rpEsc(l) + '"' + (l === currentLoc ? ' selected' : '') + '>' + rpEsc(l) + '</option>';
  });
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function rpRender() {
  var tbody = document.getElementById('rpTableBody');
  if (!tbody) return;

  var search = (document.getElementById('rpSearchInput').value || '').toLowerCase().trim();
  var catFilter = document.getElementById('rpCategoryFilter').value;
  var urgFilter = document.getElementById('rpUrgencyFilter').value;
  var locFilter = document.getElementById('rpLocationFilter').value;
  var sortBy = document.getElementById('rpSortFilter').value;

  // Filter
  _rp.filteredItems = _rp.allItems.filter(function(it) {
    if (catFilter && it.category !== catFilter) return false;
    if (locFilter && it.location !== locFilter) return false;
    if (urgFilter && String(it.urgency || '').toUpperCase() !== urgFilter) return false;

    if (search) {
      var code = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      if (code.indexOf(search) === -1 && desc.indexOf(search) === -1) return false;
    }
    return true;
  });

  // Sort
  var urgencyOrder = { 'CRITICAL': 0, 'URGENT': 1, 'NEEDED': 2, 'OK': 3 };
  _rp.filteredItems.sort(function(a, b) {
    switch (sortBy) {
      case 'value_desc':
        return Number(b.value_needed || 0) - Number(a.value_needed || 0);
      case 'value_asc':
        return Number(a.value_needed || 0) - Number(b.value_needed || 0);
      case 'qty_desc':
        return Number(b.qty_needed || 0) - Number(a.qty_needed || 0);
      case 'urgency':
        return (urgencyOrder[a.urgency] || 99) - (urgencyOrder[b.urgency] || 99);
      case 'code_asc':
        return String(a.item_code || '').localeCompare(String(b.item_code || ''));
      default:
        return 0;
    }
  });

  // Pagination
  var total = _rp.filteredItems.length;
  var start = (_rp.currentPage - 1) * _rp.pageSize;
  var end = Math.min(start + _rp.pageSize, total);
  var pageItems = _rp.filteredItems.slice(start, end);

  document.getElementById('rpTableCount').textContent = total + ' items';
  document.getElementById('rpPageTotal').textContent = total;
  document.getElementById('rpPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('rpPageEnd').textContent = end;
  document.getElementById('rpPageLabel').textContent = 'Page ' + _rp.currentPage;

  document.getElementById('rpBtnPrev').disabled = (_rp.currentPage <= 1);
  document.getElementById('rpBtnNext').disabled = (end >= total);

  // Subtitle
  var subtitle = document.getElementById('rpTableSubtitle');
  if (subtitle) {
    if (search || catFilter || urgFilter || locFilter) {
      subtitle.textContent = 'Filtered results';
    } else {
      subtitle.textContent = 'All items below reorder point';
    }
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="erp-empty">' +
      '<i class="bi bi-check-circle fs-2 d-block mb-2 text-success"></i>' +
      'No items need replenishment! All stock levels healthy.</td></tr>';
    updateRpBulkBar();
    return;
  }

  var html = '';
  pageItems.forEach(function(it, idx) {
    var urgency = String(it.urgency || 'NEEDED').toUpperCase();
    var rowClass = '';
    if (urgency === 'CRITICAL') rowClass = 'row-critical';
    else if (urgency === 'URGENT') rowClass = 'row-urgent';
    else if (urgency === 'NEEDED') rowClass = 'row-needed';

    var isSelected = _rp.selectedItems[it.item_code] === true;
    var safeCode = String(it.item_code || '').replace(/'/g, "\\'");

    html += '<tr class="' + rowClass + '">' +
      '<td class="text-center">' +
        '<input type="checkbox" class="rp-item-chk" data-code="' + rpEsc(it.item_code) + '"' +
          (isSelected ? ' checked' : '') +
          ' onchange="rpToggleSelect(\'' + safeCode + '\', this.checked)">' +
      '</td>' +
      '<td>' + (start + idx + 1) + '</td>' +
      '<td><code>' + rpEsc(it.item_code) + '</code></td>' +
      '<td title="' + rpEsc(it.description || '') + '">' + rpEsc(rpTruncate(it.description || '—', 60)) + '</td>' +
      '<td class="text-center"><span class="cat-badge">' + rpEsc(it.category || '—') + '</span></td>' +
      '<td>' + rpEsc(rpTruncate(it.location || '—', 18)) + '</td>' +
      '<td class="text-end fw-bold">' + rpNum(it.on_hand) + '</td>' +
      '<td class="text-end">' + rpNum(it.buffer_stock) + '</td>' +
      '<td class="text-end">' + rpNum(it.ave_monthly_consumption) + '</td>' +
      '<td class="text-end fw-bold text-danger">' + rpNum(it.qty_needed) + '</td>' +
      '<td class="text-center">' + rpEsc(it.base_unit || '—') + '</td>' +
      '<td class="text-end fw-bold">₱' + rpNum(it.value_needed) + '</td>' +
      '<td class="text-center"><span class="urg-' + urgency + '">' + urgency + '</span></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  updateRpBulkBar();
  updateRpSelectAllChk();
}

// ═══════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════
function rpToggleSelect(itemCode, checked) {
  if (checked) {
    _rp.selectedItems[itemCode] = true;
  } else {
    delete _rp.selectedItems[itemCode];
  }
  updateRpBulkBar();
  updateRpSelectAllChk();
}

function rpToggleSelectAll(checked) {
  var pageItems = _rp.filteredItems.slice(
    (_rp.currentPage - 1) * _rp.pageSize,
    _rp.currentPage * _rp.pageSize
  );

  pageItems.forEach(function(it) {
    if (checked) _rp.selectedItems[it.item_code] = true;
    else delete _rp.selectedItems[it.item_code];
  });

  document.querySelectorAll('.rp-item-chk').forEach(function(cb) {
    cb.checked = checked;
  });

  updateRpBulkBar();
}

function updateRpSelectAllChk() {
  var chk = document.getElementById('rpSelectAllChk');
  if (!chk) return;
  var pageItems = _rp.filteredItems.slice(
    (_rp.currentPage - 1) * _rp.pageSize,
    _rp.currentPage * _rp.pageSize
  );
  if (pageItems.length === 0) {
    chk.checked = false;
    chk.indeterminate = false;
    return;
  }
  var allSel = pageItems.every(function(it) { return _rp.selectedItems[it.item_code]; });
  var someSel = pageItems.some(function(it) { return _rp.selectedItems[it.item_code]; });
  chk.checked = allSel;
  chk.indeterminate = someSel && !allSel;
}

function updateRpBulkBar() {
  var count = Object.keys(_rp.selectedItems).length;
  var bar = document.getElementById('rpBulkBar');
  var countEl = document.getElementById('rpBulkCount');
  var qtyEl = document.getElementById('rpBulkQty');
  var costEl = document.getElementById('rpBulkCost');

  if (!bar) return;

  if (count > 0) {
    bar.classList.add('active');
    
    var totalQty = 0, totalCost = 0;
    _rp.allItems.forEach(function(it) {
      if (_rp.selectedItems[it.item_code]) {
        totalQty += Number(it.qty_needed || 0);
        totalCost += Number(it.value_needed || 0);
      }
    });

    countEl.textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';
    qtyEl.textContent = rpNum(totalQty);
    costEl.textContent = '₱' + rpNum(totalCost);
  } else {
    bar.classList.remove('active');
  }
}

function rpClearSelection() {
  _rp.selectedItems = {};
  document.querySelectorAll('.rp-item-chk').forEach(function(cb) { cb.checked = false; });
  var chk = document.getElementById('rpSelectAllChk');
  if (chk) { chk.checked = false; chk.indeterminate = false; }
  updateRpBulkBar();
}

// ═══════════════════════════════════════════════════════════
// CREATE PRF FROM SELECTION
// ═══════════════════════════════════════════════════════════
function rpCreatePrfFromSelection() {
  var selected = Object.keys(_rp.selectedItems);
  if (selected.length === 0) {
    erpShowToast('Select at least one item first', 'warning');
    return;
  }

  // Generate PRF No.
  var now = new Date();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  var rpPrfNoEl = document.getElementById('rpPrfNo');
  rpPrfNoEl.value = 'PRF#' + month + '-' + day;

  // Auto-fill default noted/approved
  document.getElementById('rpPrfNotedBy').value = 'CYNTHIA A. CEREZO';
  document.getElementById('rpPrfApprovedBy').value = 'REMIGIO BALAOING';

  // Detect if all items have same category
  var categories = {};
  var selectedItems = _rp.allItems.filter(function(it) {
    return _rp.selectedItems[it.item_code];
  });
  selectedItems.forEach(function(it) {
    if (it.category) categories[it.category] = true;
  });

  var catSel = document.getElementById('rpPrfCategory');
  if (Object.keys(categories).length === 1) {
    catSel.value = Object.keys(categories)[0];
  } else {
    catSel.value = '';
  }

  renderRpPrfItems(selectedItems);

  if (!_rp.prfModal) {
    _rp.prfModal = new bootstrap.Modal(document.getElementById('rpConfirmPrfModal'), { backdrop: 'static' });
  }
  _rp.prfModal.show();
}

function renderRpPrfItems(items) {
  var tbody = document.getElementById('rpPrfItemsBody');
  if (!tbody) return;

  document.getElementById('rpPrfItemsCount').textContent = items.length;

  var html = '';
  items.forEach(function(it, idx) {
    html += '<tr>' +
      '<td class="text-center">' + (idx + 1) + '</td>' +
      '<td><code style="font-size:0.75rem;">' + rpEsc(it.item_code) + '</code></td>' +
      '<td>' + rpEsc(rpTruncate(it.description || '', 70)) + '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm text-center rp-prf-qty" ' +
          'data-code="' + rpEsc(it.item_code) + '" ' +
          'value="' + Math.ceil(Number(it.qty_needed || 0)) + '" ' +
          'min="1" step="1" style="width:80px;margin:0 auto;">' +
      '</td>' +
      '<td class="text-center">' + rpEsc(it.base_unit || '—') + '</td>' +
      '<td>' +
        '<input type="text" class="form-control form-control-sm rp-prf-remarks" ' +
          'data-code="' + rpEsc(it.item_code) + '" ' +
          'placeholder="Optional" maxlength="200">' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

function rpClosePrfModal() {
  if (_rp.prfModal) _rp.prfModal.hide();
}

// ═══════════════════════════════════════════════════════════
// SUBMIT PRF (Create in prf_documents + prf_items)
// ═══════════════════════════════════════════════════════════
async function rpSubmitPrf() {
  if (_rp.isSubmitting) return;

  var prfNo = document.getElementById('rpPrfNo').value.trim();
  var category = document.getElementById('rpPrfCategory').value;
  var notedBy = document.getElementById('rpPrfNotedBy').value.trim();
  var approvedBy = document.getElementById('rpPrfApprovedBy').value.trim();
  var notes = document.getElementById('rpPrfNotes').value.trim();

  if (!prfNo) { erpShowToast('PRF No. required', 'warning'); return; }
  if (!category) { erpShowToast('Please select a Category', 'warning'); return; }

  // Gather items from inputs
  var selectedItems = _rp.allItems.filter(function(it) {
    return _rp.selectedItems[it.item_code];
  });

  var items = [];
  for (var i = 0; i < selectedItems.length; i++) {
    var it = selectedItems[i];
    var qtyInput = document.querySelector('.rp-prf-qty[data-code="' + cssEscape(it.item_code) + '"]');
    var remarksInput = document.querySelector('.rp-prf-remarks[data-code="' + cssEscape(it.item_code) + '"]');
    var qty = qtyInput ? parseFloat(qtyInput.value) : Number(it.qty_needed || 0);
    var remarks = remarksInput ? remarksInput.value.trim() : '';
    if (qty <= 0) continue;
    items.push({
      item_code: it.item_code,
      description: it.description || '',
      category: it.category || category,
      location: it.location || '',
      average_consumption: Number(it.ave_monthly_consumption || 0),
      buffer_stock: Number(it.buffer_stock || 0),
      stock_on_hand: Number(it.on_hand || 0),
      qty_for_order: qty,
      unit: it.base_unit || 'PIECE',
      remarks: remarks
    });
  }

  if (items.length === 0) {
    erpShowToast('No valid items to submit', 'warning');
    return;
  }

  if (!confirm('Create PRF with ' + items.length + ' item(s)?\n\nPRF No.: ' + prfNo)) return;

  _rp.isSubmitting = true;
  var btn = document.getElementById('rpBtnCreatePrf');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...';

  try {
    var preparedBy = localStorage.getItem('ivm_userFullname') || 
                     localStorage.getItem('ivm_username') || 'WAREHOUSE';
    var department = localStorage.getItem('ivm_userDepartment') || '';

    // Check if PRF No. exists
    var existing = await erpFetch('prf_documents',
      'prf_no=eq.' + encodeURIComponent(prfNo) + '&select=id&limit=1');

    if (existing && existing.length > 0) {
      // Auto-unique
      var counter = 1;
      var newNo = prfNo;
      while (existing && existing.length > 0 && counter < 20) {
        counter++;
        newNo = prfNo + '-' + counter;
        existing = await erpFetch('prf_documents',
          'prf_no=eq.' + encodeURIComponent(newNo) + '&select=id&limit=1');
      }
      prfNo = newNo;
      erpShowToast('PRF No. auto-adjusted to ' + prfNo, 'info');
    }

    var totalQty = items.reduce(function(s, it) { return s + (it.qty_for_order || 0); }, 0);

    // Insert PRF Document
    var docRes = await fetch(erpUrl('prf_documents'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        prf_no: prfNo,
        base_prf_no: prfNo,
        version_number: 1,
        batch_number: 1,
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

    if (!docRes.ok) throw new Error('Insert PRF failed: ' + docRes.status);

    var docArr = await docRes.json();
    var doc = docArr[0];
    if (!doc || !doc.id) throw new Error('No PRF ID returned');

    // Insert PRF Items
    var itemPayloads = items.map(function(it, idx) {
      return {
        prf_id: doc.id,
        prf_no: prfNo,
        line_no: idx + 1,
        item_code: it.item_code,
        description: it.description,
        category: it.category,
        location: it.location,
        average_consumption: it.average_consumption,
        buffer_stock: it.buffer_stock,
        stock_on_hand: it.stock_on_hand,
        qty_for_order: it.qty_for_order,
        unit: it.unit,
        status: 'UNSERVED',
        remarks: it.remarks
      };
    });

    var itemsRes = await fetch(erpUrl('prf_items'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(itemPayloads)
    });

    if (!itemsRes.ok) throw new Error('Insert items failed: ' + itemsRes.status);

    // Success!
    rpClosePrfModal();
    rpShowSuccessModal(prfNo, items.length, totalQty);
    _rp.selectedItems = {};
    rpClearSelection();

  } catch(err) {
    console.error('[rpSubmitPrf]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _rp.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function rpShowSuccessModal(prfNo, itemCount, totalQty) {
  document.getElementById('rpSuccessPrfNo').textContent = prfNo;
  document.getElementById('rpSuccessSummary').innerHTML = 
    '<i class="bi bi-box-seam me-1"></i>' + itemCount + ' items · Total Qty: <strong>' + totalQty + '</strong>';

  if (!_rp.successModal) {
    _rp.successModal = new bootstrap.Modal(document.getElementById('rpSuccessModal'), { backdrop: 'static' });
  }
  _rp.successModal.show();
}

function rpCloseSuccessModal() {
  if (_rp.successModal) _rp.successModal.hide();
  rpRefresh();
}

function rpViewCreatedPrfs() {
  window.location.href = 'prf-monitor.html';
}

// ═══════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════
function rpOnSearch() {
  clearTimeout(_rp.searchTimer);
  _rp.searchTimer = setTimeout(function() {
    _rp.currentPage = 1;
    rpRender();
  }, 300);
}

function rpClearFilters() {
  document.getElementById('rpSearchInput').value = '';
  document.getElementById('rpCategoryFilter').value = '';
  document.getElementById('rpUrgencyFilter').value = '';
  document.getElementById('rpLocationFilter').value = '';
  document.getElementById('rpSortFilter').value = 'value_desc';
  _rp.currentPage = 1;
  rpRender();
}

function rpPagePrev() {
  if (_rp.currentPage > 1) {
    _rp.currentPage--;
    rpRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function rpPageNext() {
  var maxPage = Math.ceil(_rp.filteredItems.length / _rp.pageSize);
  if (_rp.currentPage < maxPage) {
    _rp.currentPage++;
    rpRender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function rpRefresh() {
  erpShowToast('Refreshing...', 'info');
  rpLoad();
  rpCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════════
function rpExport() {
  if (_rp.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = ['Item Code', 'Description', 'Category', 'Location', 'Unit',
                 'On-Hand', 'Buffer Stock', 'Ave Monthly', 'Qty Needed', 'Unit Cost',
                 'Est. Cost', 'Urgency'];
  var rows = _rp.filteredItems.map(function(it) {
    return [
      it.item_code || '',
      it.description || '',
      it.category || '',
      it.location || '',
      it.base_unit || '',
      Number(it.on_hand || 0),
      Number(it.buffer_stock || 0),
      Number(it.ave_monthly_consumption || 0),
      Number(it.qty_needed || 0),
      Number(it.unit_cost || 0),
      Number(it.value_needed || 0),
      it.urgency || ''
    ];
  });

  var csv = headers.map(_csvEscRp).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscRp).join(',') + '\n'; });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Replenishment_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();

  erpShowToast('✅ Exported ' + rows.length + ' items', 'success');
}

function _csvEscRp(val) {
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
function rpNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function rpTruncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function rpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cssEscape(str) {
  return String(str || '').replace(/([^\w-])/g, '\\$1');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

console.log('✅ replenishment.js v1.0 loaded');
