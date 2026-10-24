// ============================================================
// GEMCOR ERP — Replenishment & PRFs (v2.0)
// Tab 1 "Needs": items below buffer, minus what is already on order
// Tab 2 "PRFs" : PRF Monitor (embedded)
//
// Source of truth lives in the database:
//   erp_v_reorder_net  -> qty_needed, on_order_qty, net_needed, open_prf_nos
//   erp_create_prf()   -> all-or-nothing PRF creation (numbering + category/batch split)
// Setup: run sql/01_replenishment_prf.sql in Supabase once.
// ============================================================

var RP_MAX_ITEMS_PER_PRF = 30;                 // same as New PRF
var RP_DEFAULT_NOTED_BY = 'CYNTHIA A. CEREZO'; // used only when nothing was saved before
var RP_DEFAULT_APPROVED_BY = 'REMIGIO BALAOING';

var _rp = {
  allItems: [],
  filteredItems: [],
  selectedItems: {},
  currentPage: 1,
  pageSize: 50,
  searchTimer: null,
  prfModal: null,
  successModal: null,
  isSubmitting: false,
  activeTab: 'needs',
  prfFrameLoaded: false,
  prfsChanged: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  rpCheckHealth();
  rpLoad();
  if (location.hash === '#prfs') rpSwitchTab('prfs');
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
// TABS
// ═══════════════════════════════════════════════════════════
function rpSwitchTab(tab) {
  _rp.activeTab = tab;
  var needs = document.getElementById('rpTabNeeds');
  var prfs = document.getElementById('rpTabPrfs');
  var bNeeds = document.getElementById('rpTabBtnNeeds');
  var bPrfs = document.getElementById('rpTabBtnPrfs');
  var exp = document.getElementById('rpBtnExport');
  if (needs) needs.style.display = (tab === 'needs') ? '' : 'none';
  if (prfs) prfs.style.display = (tab === 'prfs') ? '' : 'none';
  if (bNeeds) bNeeds.classList.toggle('active', tab === 'needs');
  if (bPrfs) bPrfs.classList.toggle('active', tab === 'prfs');
  if (exp) exp.style.display = (tab === 'needs') ? '' : 'none';

  if (tab === 'prfs') {
    var frame = document.getElementById('rpPrfFrame');
    if (frame && (!_rp.prfFrameLoaded || _rp.prfsChanged)) {
      frame.src = 'prf-monitor.html?embed=1&_t=' + Date.now();
      _rp.prfFrameLoaded = true;
      _rp.prfsChanged = false;
    }
    try { history.replaceState(null, '', '#prfs'); } catch(e) {}
  } else {
    try { history.replaceState(null, '', location.pathname + location.search); } catch(e) {}
    // PRF statuses / PO links may have changed in the other tab → numbers must be fresh
    if (_rp.prfFrameLoaded) rpLoad();
  }
}

// Call a function that lives in the embedded PRF Monitor (same origin)
function rpPrfFrameCall(fnName) {
  var frame = document.getElementById('rpPrfFrame');
  try {
    var w = frame && frame.contentWindow;
    if (w && typeof w[fnName] === 'function') { w[fnName](); return; }
  } catch(e) { console.warn('[rpPrfFrameCall]', e); }
  erpShowToast('PRF Monitor is still loading — try again in a moment', 'warning');
}

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function rpLoad() {
  var tbody = document.getElementById('rpTableBody');
  var alertEl = document.getElementById('rpSetupAlert');
  if (alertEl) alertEl.style.display = 'none';
  if (tbody && _rp.allItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading replenishment needs...</div></td></tr>';
  }

  try {
    var rows = await erpFetchAll('erp_v_reorder_net', 'select=*&order=item_code.asc');
    _rp.allItems = rows || [];

    // drop selections that are no longer selectable (e.g. someone else just raised a PRF)
    Object.keys(_rp.selectedItems).forEach(function(code) {
      var it = _rp.allItems.find(function(x) { return x.item_code === code; });
      if (!it || rpNetNeeded(it) <= 0) delete _rp.selectedItems[code];
    });

    rpPopulateFilters();
    rpComputeKPIs();
    _rp.currentPage = 1;
    rpRender();

  } catch(err) {
    console.error('[rpLoad]', err);
    var msg = String(err.message || err);
    if (alertEl && /erp_v_reorder_net|relation|does not exist|404/i.test(msg)) {
      alertEl.innerHTML = '<strong>Setup needed:</strong> the database view <code>erp_v_reorder_net</code> was not found. ' +
        'Run <code>sql/01_replenishment_prf.sql</code> in the Supabase SQL Editor, then refresh.';
      alertEl.style.display = 'block';
    }
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="14" class="erp-empty text-danger">' +
        'Failed: ' + rpEsc(msg) + '</td></tr>';
    }
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS ON ROW DATA
// ═══════════════════════════════════════════════════════════
function rpNetNeeded(it) { return Number(it.net_needed || 0); }
function rpOnOrder(it)   { return Number(it.on_order_qty || 0); }
function rpNetValue(it)  { return Number(it.net_value_needed || 0); }
function rpIsCovered(it) { return rpNetNeeded(it) <= 0; }

// ═══════════════════════════════════════════════════════════
// KPIs — only items that still need a PRF
// ═══════════════════════════════════════════════════════════
function rpComputeKPIs() {
  var critical = 0, urgent = 0, warning = 0, totalCost = 0, needsCount = 0;

  _rp.allItems.forEach(function(it) {
    if (rpIsCovered(it)) return;
    needsCount++;
    var u = String(it.urgency || '').toUpperCase();
    if (u === 'CRITICAL') critical++;
    else if (u === 'URGENT') urgent++;
    else warning++;
    totalCost += rpNetValue(it);
  });

  document.getElementById('rpKpiCritical').textContent = rpNum(critical);
  document.getElementById('rpKpiUrgent').textContent = rpNum(urgent);
  document.getElementById('rpKpiNeeded').textContent = rpNum(warning);
  document.getElementById('rpKpiCost').textContent = '₱' + rpNum(totalCost);
  document.getElementById('rpTabCountNeeds').textContent = needsCount;
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
function rpOnFilterChange() {
  _rp.currentPage = 1;
  rpRender();
}

function rpRender() {
  var tbody = document.getElementById('rpTableBody');
  if (!tbody) return;

  var search = (document.getElementById('rpSearchInput').value || '').toLowerCase().trim();
  var catFilter = document.getElementById('rpCategoryFilter').value;
  var urgFilter = document.getElementById('rpUrgencyFilter').value;
  var locFilter = document.getElementById('rpLocationFilter').value;
  var orderFilter = document.getElementById('rpOrderFilter').value;
  var sortBy = document.getElementById('rpSortFilter').value;

  _rp.filteredItems = _rp.allItems.filter(function(it) {
    if (orderFilter === 'needs' && rpIsCovered(it)) return false;
    if (orderFilter === 'covered' && !(rpIsCovered(it) && rpOnOrder(it) > 0)) return false;
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

  var urgencyOrder = { 'CRITICAL': 0, 'URGENT': 1, 'WARNING': 2, 'OK': 3 };
  function urgRank(it) {
    var r = urgencyOrder[String(it.urgency || '').toUpperCase()];
    return r === undefined ? 99 : r;
  }
  _rp.filteredItems.sort(function(a, b) {
    switch (sortBy) {
      case 'value_desc': return rpNetValue(b) - rpNetValue(a);
      case 'value_asc':  return rpNetValue(a) - rpNetValue(b);
      case 'qty_desc':   return rpNetNeeded(b) - rpNetNeeded(a);
      case 'urgency':    return urgRank(a) - urgRank(b);
      case 'code_asc':   return String(a.item_code || '').localeCompare(String(b.item_code || ''));
      default: return 0;
    }
  });

  var total = _rp.filteredItems.length;
  var maxPage = Math.max(1, Math.ceil(total / _rp.pageSize));
  if (_rp.currentPage > maxPage) _rp.currentPage = maxPage;
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

  var subtitle = document.getElementById('rpTableSubtitle');
  if (subtitle) {
    subtitle.textContent = orderFilter === 'needs' ? 'Items that still need a PRF'
      : orderFilter === 'covered' ? 'Items already covered by an open PRF'
      : 'All items below buffer stock';
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="erp-empty">' +
      '<i class="bi bi-check-circle fs-2 d-block mb-2 text-success"></i>' +
      (orderFilter === 'needs' ? 'Nothing left to order — everything below buffer is already on a PRF or stock is healthy.'
                               : 'No items match the filters.') + '</td></tr>';
    updateRpBulkBar();
    updateRpSelectAllChk();
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var urgency = String(it.urgency || 'WARNING').toUpperCase();
    var covered = rpIsCovered(it);
    var rowClass = covered ? 'row-covered'
      : urgency === 'CRITICAL' ? 'row-critical'
      : urgency === 'URGENT' ? 'row-urgent' : 'row-warning';

    var isSelected = !covered && _rp.selectedItems[it.item_code] === true;
    var onOrder = rpOnOrder(it);

    var onOrderCell = '<span class="text-muted">—</span>';
    if (onOrder > 0) {
      onOrderCell = '<span class="oo-badge' + (covered ? ' full' : '') + '">' + rpNum(onOrder) + '</span>' +
        '<span class="oo-prf" title="' + rpEsc(it.open_prf_nos || '') + '">' + rpEsc(it.open_prf_nos || '') + '</span>';
    }

    html += '<tr class="' + rowClass + '">' +
      '<td class="text-center">' +
        '<input type="checkbox" class="rp-item-chk" data-code="' + rpEsc(it.item_code) + '"' +
          (isSelected ? ' checked' : '') + (covered ? ' disabled title="Already covered by an open PRF"' : '') + '>' +
      '</td>' +
      '<td><code>' + rpEsc(it.item_code) + '</code></td>' +
      '<td title="' + rpEsc(it.description || '') + '">' + rpEsc(rpTruncate(it.description || '—', 60)) + '</td>' +
      '<td class="text-center"><span class="cat-badge">' + rpEsc(it.category || '—') + '</span></td>' +
      '<td>' + rpEsc(rpTruncate(it.location || '—', 18)) + '</td>' +
      '<td class="text-end fw-bold">' + rpNum(it.on_hand) + '</td>' +
      '<td class="text-end">' + rpNum(it.buffer_stock) + '</td>' +
      '<td class="text-end">' + rpNum(it.ave_monthly_consumption) + '</td>' +
      '<td class="text-end">' + rpNum(it.qty_needed) + '</td>' +
      '<td class="text-center">' + onOrderCell + '</td>' +
      '<td class="text-end fw-bold ' + (covered ? '' : 'text-danger') + '">' + rpNum(rpNetNeeded(it)) + '</td>' +
      '<td class="text-center">' + rpEsc(it.base_unit || '—') + '</td>' +
      '<td class="text-end fw-bold">₱' + rpNum(rpNetValue(it)) + '</td>' +
      '<td class="text-center"><span class="urg-' + urgency + '">' + urgency + '</span></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  // one delegated handler instead of inline onchange with escaped item codes
  tbody.querySelectorAll('.rp-item-chk').forEach(function(cb) {
    cb.addEventListener('change', function() { rpToggleSelect(cb.getAttribute('data-code'), cb.checked); });
  });

  updateRpBulkBar();
  updateRpSelectAllChk();
}

// ═══════════════════════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════════════════════
function rpPageItems() {
  return _rp.filteredItems.slice((_rp.currentPage - 1) * _rp.pageSize, _rp.currentPage * _rp.pageSize);
}

function rpToggleSelect(itemCode, checked) {
  if (checked) _rp.selectedItems[itemCode] = true;
  else delete _rp.selectedItems[itemCode];
  updateRpBulkBar();
  updateRpSelectAllChk();
}

function rpToggleSelectAll(checked) {
  rpPageItems().forEach(function(it) {
    if (rpIsCovered(it)) return;
    if (checked) _rp.selectedItems[it.item_code] = true;
    else delete _rp.selectedItems[it.item_code];
  });
  document.querySelectorAll('.rp-item-chk:not(:disabled)').forEach(function(cb) { cb.checked = checked; });
  updateRpBulkBar();
  updateRpSelectAllChk();
}

function updateRpSelectAllChk() {
  var chk = document.getElementById('rpSelectAllChk');
  if (!chk) return;
  var selectable = rpPageItems().filter(function(it) { return !rpIsCovered(it); });
  if (selectable.length === 0) { chk.checked = false; chk.indeterminate = false; return; }
  var allSel = selectable.every(function(it) { return _rp.selectedItems[it.item_code]; });
  var someSel = selectable.some(function(it) { return _rp.selectedItems[it.item_code]; });
  chk.checked = allSel;
  chk.indeterminate = someSel && !allSel;
}

function rpSelectedRows() {
  return _rp.allItems.filter(function(it) { return _rp.selectedItems[it.item_code] && !rpIsCovered(it); });
}

function updateRpBulkBar() {
  var rows = rpSelectedRows();
  var bar = document.getElementById('rpBulkBar');
  if (!bar) return;

  if (rows.length > 0) {
    bar.classList.add('active');
    var totalQty = 0, totalCost = 0;
    rows.forEach(function(it) { totalQty += rpNetNeeded(it); totalCost += rpNetValue(it); });
    document.getElementById('rpBulkCount').textContent = rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' selected';
    document.getElementById('rpBulkQty').textContent = rpNum(totalQty);
    document.getElementById('rpBulkCost').textContent = '₱' + rpNum(totalCost);
  } else {
    bar.classList.remove('active');
  }
}

function rpClearSelection() {
  _rp.selectedItems = {};
  document.querySelectorAll('.rp-item-chk').forEach(function(cb) { cb.checked = false; });
  updateRpSelectAllChk();
  updateRpBulkBar();
}

// ═══════════════════════════════════════════════════════════
// CREATE PRF FROM SELECTION
// ═══════════════════════════════════════════════════════════
function rpSavedSignatory(key, fallback) {
  try { var v = localStorage.getItem(key); if (v !== null) return v; } catch(e) {}
  return fallback;
}

// How many PRFs will the server create? (mirror of the RPC's rule, for the preview only)
function rpPlanFor(rows) {
  var byCat = {};
  rows.forEach(function(it) {
    var c = it.category || 'UNCATEGORIZED';
    byCat[c] = (byCat[c] || 0) + 1;
  });
  var plan = [];
  Object.keys(byCat).sort().forEach(function(c) {
    var n = Math.ceil(byCat[c] / RP_MAX_ITEMS_PER_PRF);
    plan.push({ category: c, items: byCat[c], prfs: n });
  });
  return plan;
}

function rpCreatePrfFromSelection() {
  var rows = rpSelectedRows();
  if (rows.length === 0) {
    erpShowToast('Select at least one item first', 'warning');
    return;
  }

  document.getElementById('rpPrfNotedBy').value = rpSavedSignatory('rp_noted_by', RP_DEFAULT_NOTED_BY);
  document.getElementById('rpPrfApprovedBy').value = rpSavedSignatory('rp_approved_by', RP_DEFAULT_APPROVED_BY);
  document.getElementById('rpPrfNotes').value = '';

  rpRenderPrfPlan(rows);
  renderRpPrfItems(rows);

  if (!_rp.prfModal) {
    _rp.prfModal = new bootstrap.Modal(document.getElementById('rpConfirmPrfModal'), { backdrop: 'static' });
  }
  _rp.prfModal.show();
}

function rpRenderPrfPlan(rows) {
  var plan = rpPlanFor(rows);
  var totalPrfs = plan.reduce(function(s, p) { return s + p.prfs; }, 0);
  var html = '<i class="bi bi-info-circle me-1"></i>' +
    (totalPrfs === 1 ? 'This will create <strong>1 PRF</strong>' : 'This will create <strong>' + totalPrfs + ' PRFs</strong>') +
    ' — one per category' + (rows.length > RP_MAX_ITEMS_PER_PRF ? ', max ' + RP_MAX_ITEMS_PER_PRF + ' items each' : '') +
    '. PRF numbers are assigned automatically.<br><span class="text-muted">' +
    plan.map(function(p) {
      return rpEsc(p.category) + ': ' + p.items + ' item' + (p.items === 1 ? '' : 's') + (p.prfs > 1 ? ' (' + p.prfs + ' PRFs)' : '');
    }).join(' · ') + '</span>';
  document.getElementById('rpPrfPlan').innerHTML = html;
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
      '<td><span class="cat-badge">' + rpEsc(it.category || '—') + '</span></td>' +
      '<td>' + rpEsc(rpTruncate(it.description || '', 70)) + '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm text-center rp-prf-qty" ' +
          'data-code="' + rpEsc(it.item_code) + '" ' +
          'value="' + Math.max(1, Math.ceil(rpNetNeeded(it))) + '" ' +
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
// SUBMIT — one RPC call, all-or-nothing
// ═══════════════════════════════════════════════════════════
async function rpSubmitPrf() {
  if (_rp.isSubmitting) return;

  var notedBy = document.getElementById('rpPrfNotedBy').value.trim();
  var approvedBy = document.getElementById('rpPrfApprovedBy').value.trim();
  var notes = document.getElementById('rpPrfNotes').value.trim();

  var rows = rpSelectedRows();
  var items = [];
  var bad = [];
  rows.forEach(function(it) {
    var qtyEl = document.querySelector('.rp-prf-qty[data-code="' + cssEscape(it.item_code) + '"]');
    var remEl = document.querySelector('.rp-prf-remarks[data-code="' + cssEscape(it.item_code) + '"]');
    var qty = qtyEl ? parseFloat(qtyEl.value) : rpNetNeeded(it);
    if (!(qty > 0)) { bad.push(it.item_code); return; }
    items.push({
      item_code: it.item_code,
      qty: qty,
      unit: it.base_unit || null,
      remarks: remEl ? remEl.value.trim() : ''
    });
  });

  if (bad.length) { erpShowToast('Qty must be greater than 0: ' + bad.join(', '), 'warning'); return; }
  if (items.length === 0) { erpShowToast('No valid items to submit', 'warning'); return; }

  var plan = rpPlanFor(rows);
  var totalPrfs = plan.reduce(function(s, p) { return s + p.prfs; }, 0);
  if (!confirm('Create ' + totalPrfs + ' PRF' + (totalPrfs === 1 ? '' : 's') + ' with ' + items.length + ' item(s)?')) return;

  _rp.isSubmitting = true;
  var btn = document.getElementById('rpBtnCreatePrf');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating...';

  try {
    var preparedBy = '';
    var department = '';
    try {
      preparedBy = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || '';
      department = localStorage.getItem('ivm_userDepartment') || '';
    } catch(e) {}

    var res = await erpCreatePrf({
      items: items,
      header: {
        prepared_by: preparedBy || 'WAREHOUSE',
        department: department,
        noted_by: notedBy,
        approved_by: approvedBy,
        notes: notes,
        purpose: 'STOCK'
      },
      splitByCategory: true,
      maxItems: RP_MAX_ITEMS_PER_PRF,
      force: false
    });

    if (!res || res.success !== true) {
      if (res && res.code === 'OPEN_PRF_CONFLICT') {
        rpClosePrfModal();
        var list = (res.conflicts || []).map(function(c) {
          return c.item_code + ' (' + rpNum(c.open_qty) + ' on ' + c.prf_nos + ')';
        }).join(', ');
        erpShowToast('Not created — already on an open PRF: ' + list, 'danger');
        await rpLoad(); // refresh so the rows show their new On Order
        return;
      }
      throw new Error((res && res.message) || 'PRF was not created');
    }

    try {
      localStorage.setItem('rp_noted_by', notedBy);
      localStorage.setItem('rp_approved_by', approvedBy);
    } catch(e) {}

    _rp.prfsChanged = true;
    rpClosePrfModal();
    rpShowSuccessModal(res.prfs || []);
    _rp.selectedItems = {};
    await rpLoad();

  } catch(err) {
    console.error('[rpSubmitPrf]', err);
    erpShowToast('Failed — nothing was created. ' + err.message, 'danger');
  } finally {
    _rp.isSubmitting = false;
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function rpShowSuccessModal(prfs) {
  var totalItems = 0, totalQty = 0;
  prfs.forEach(function(p) { totalItems += Number(p.items || 0); totalQty += Number(p.total_qty || 0); });

  document.getElementById('rpSuccessLabel').textContent =
    prfs.length === 1 ? 'Successfully created:' : 'Successfully created ' + prfs.length + ' PRFs:';
  document.getElementById('rpSuccessPrfNo').innerHTML = prfs.map(function(p) {
    return rpEsc(p.prf_no) + ' <span class="text-muted small">(' + rpEsc(p.category) + ')</span>';
  }).join('<br>');
  document.getElementById('rpSuccessSummary').innerHTML =
    '<i class="bi bi-box-seam me-1"></i>' + totalItems + ' items · Total Qty: <strong>' + rpNum(totalQty) + '</strong>';

  if (!_rp.successModal) {
    _rp.successModal = new bootstrap.Modal(document.getElementById('rpSuccessModal'), { backdrop: 'static' });
  }
  _rp.successModal.show();
}

function rpCloseSuccessModal() {
  if (_rp.successModal) _rp.successModal.hide();
}

function rpViewCreatedPrfs() {
  if (_rp.successModal) _rp.successModal.hide();
  rpSwitchTab('prfs');
}

// ═══════════════════════════════════════════════════════════
// FILTERS / PAGING
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
  document.getElementById('rpOrderFilter').value = 'needs';
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
  if (_rp.activeTab === 'prfs') rpPrfFrameCall('prfMonitorRefresh');
}

// ═══════════════════════════════════════════════════════════
// EXPORT CSV (current filtered list)
// ═══════════════════════════════════════════════════════════
function rpExport() {
  if (_rp.filteredItems.length === 0) {
    erpShowToast('No data to export', 'warning');
    return;
  }

  var headers = ['Item Code', 'Description', 'Category', 'Location', 'Unit',
                 'On-Hand', 'Buffer Stock', 'Ave Monthly', 'Qty Needed', 'On Order',
                 'Open PRF(s)', 'Net Needed', 'Unit Cost', 'Net Est. Cost', 'Urgency'];
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
      rpOnOrder(it),
      it.open_prf_nos || '',
      rpNetNeeded(it),
      Number(it.unit_cost || 0),
      rpNetValue(it),
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

  erpShowToast('Exported ' + rows.length + ' items', 'success');
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

window.rpSwitchTab = rpSwitchTab;
window.rpPrfFrameCall = rpPrfFrameCall;
console.log('✅ replenishment.js v2.0 loaded');
