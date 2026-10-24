// ============================================================
// GEMCOR ERP — Stock Monitor Logic (v3.4)
// Phase 4: Inline Edit + Lock Toggle + CSV Import
// + Variance Filter & Modal
// + Direct SOF Allocated Fetch
// ✅ Available = On-Hand − SOF Allocated (kasama pa rin sa physical On-Hand ang allocated)
// ✅ FIXED: Idempotent rendering
// ============================================================
var _erpAllItems = [];
var _erpFilteredItems = [];
var _erpCurrentPage = 1;
var _erpPageSize = 50;
var _erpCharts = { category: null, abc: null, movement: null };
var _erpSearchTimer = null;

var _editCellContext = null;
var _csvImportData = null;

var _erpSofAllocatedMap = {};
var _erpRenderLock = false; // ✅ Lock para hindi mag-doble ang render

document.addEventListener('DOMContentLoaded', function() {
  console.log('[ERP] Stock Monitor v3.4 initializing...');
  erpCheckHealth();
  erpLoadDashboard();
});

async function erpCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  if (!dot) return;
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

async function erpLoadDashboard() {
  await Promise.all([
    erpLoadSummary(),
    erpLoadCharts(),
    erpLoadItems(),
    erpLoadFilterOptions()
  ]);
}

// ═══════════════════════════════════════════════════════════
// KPI SUMMARY
// ═══════════════════════════════════════════════════════════
async function erpLoadSummary() {
  var result = await erpGetStockSummary();
  if (!result.success) return;
  var s = result.summary || {};
  document.getElementById('kpiTotalItems').textContent = erpNum(s.total_items);
  document.getElementById('kpiStockValue').textContent = erpPeso(s.total_stock_value);
  document.getElementById('kpiBelowReorder').textContent = erpNum(s.below_reorder);
  document.getElementById('kpiNewBelowBuffer').textContent = erpNum(s.new_below_buffer || 0);
  document.getElementById('kpiZeroStock').textContent = erpNum(s.zero_stock_items);
  var subEl = document.getElementById('kpiTotalItemsSub');
  if (subEl) subEl.textContent = (s.active_items || 0) + ' with stock';
}

// ═══════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════
async function erpLoadCharts() {
  var result = await erpGetCategoryStats();
  if (!result.success) return;
  erpRenderCategoryChart(result.byCategory || {});
  erpRenderAbcChart(result.byABC || {});
  erpRenderMovementChart(result.byMovement || {});
}

function erpRenderCategoryChart(byCategory) {
  var canvas = document.getElementById('chartCategory');
  if (!canvas) return;
  if (_erpCharts.category) { _erpCharts.category.destroy(); }
  var entries = Object.keys(byCategory)
    .map(function(k) { return { label: k, value: byCategory[k].value, count: byCategory[k].count }; })
    .sort(function(a, b) { return b.value - a.value; });
  if (entries.length === 0) return;
  var top = entries.slice(0, 8);
  var others = entries.slice(8);
  if (others.length > 0) {
    var otherVal = others.reduce(function(s, e) { return s + e.value; }, 0);
    var otherCount = others.reduce(function(s, e) { return s + e.count; }, 0);
    top.push({ label: 'Others (' + others.length + ')', value: otherVal, count: otherCount });
  }
  var palette = ['#1e3a5f','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#6b7280'];
  _erpCharts.category = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: top.map(function(e) { return e.label; }),
      datasets: [{
        data: top.map(function(e) { return e.value; }),
        backgroundColor: palette.slice(0, top.length),
        borderColor: '#fff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 8, font: { size: 10 } } },
        tooltip: { callbacks: { label: function(ctx) { return ctx.label + ': ' + erpPeso(ctx.parsed); } } }
      }
    }
  });
}

function erpRenderAbcChart(byABC) {
  var canvas = document.getElementById('chartABC');
  if (!canvas) return;
  if (_erpCharts.abc) { _erpCharts.abc.destroy(); }
  var labels = ['Class A', 'Class B', 'Class C'];
  var values = [byABC.A || 0, byABC.B || 0, byABC.C || 0];
  var colors = ['#dc3545', '#f59e0b', '#6c757d'];
  _erpCharts.abc = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'Value', data: values, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return erpPeso(ctx.parsed.y); } } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function(v) { return erpPeso(v); }, font: { size: 10 } } },
        x: { ticks: { font: { size: 11 } } }
      }
    }
  });
}

function erpRenderMovementChart(byMovement) {
  var canvas = document.getElementById('chartMovement');
  if (!canvas) return;
  if (_erpCharts.movement) { _erpCharts.movement.destroy(); }
  var entries = Object.keys(byMovement)
    .map(function(k) { return { label: k, value: byMovement[k] }; })
    .sort(function(a, b) { return b.value - a.value; });
  if (entries.length === 0) return;
  var colorMap = {
    'FAST MOVING': '#10b981', 'MODERATE MOVING': '#06b6d4',
    'SLOW MOVING': '#f59e0b', 'NO MOVEMENT': '#6b7280', 'UNCLASSIFIED': '#9ca3af'
  };
  _erpCharts.movement = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: entries.map(function(e) { return e.label; }),
      datasets: [{
        data: entries.map(function(e) { return e.value; }),
        backgroundColor: entries.map(function(e) { return colorMap[e.label] || '#6b7280'; }),
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.x + ' items'; } } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 100, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// ITEMS TABLE
// ═══════════════════════════════════════════════════════════
async function erpLoadItems() {
  if (_erpRenderLock) return;
  _erpRenderLock = true;

  var tbody = document.getElementById('erpTableBody');
  if (!tbody) { _erpRenderLock = false; return; }
  
  tbody.innerHTML = '<tr><td colspan="19" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading inventory...</div></td></tr>';
  
  var filters = {
    category: document.getElementById('erpCategoryFilter').value,
    location: document.getElementById('erpLocationFilter').value,
    movement: document.getElementById('erpMovementFilter').value,
    abc: document.getElementById('erpAbcFilter').value,
    search: document.getElementById('erpSearchInput').value.trim(),
    limit: 5000
  };
  
  var result = await erpGetAllItems(filters);
  
  if (!result.success) {
    tbody.innerHTML = '<tr><td colspan="19" class="erp-empty text-danger">' +
      '<i class="bi bi-exclamation-triangle-fill"></i> ' + erpEsc(result.error) + '</td></tr>';
    _erpRenderLock = false;
    return;
  }
  
  _erpAllItems = result.items || [];
  _erpFilteredItems = _erpAllItems.slice();
  _erpCurrentPage = 1;

  try {
    var sofRes = await erpFetch('erp_sof_allocation_items', 'select=item_code,allocated_qty,used_qty');
    _erpSofAllocatedMap = {};
    (sofRes || []).forEach(function(sof) {
      var remaining = Number(sof.allocated_qty || 0) - Number(sof.used_qty || 0);
      if (remaining > 0) {
        var currentMap = _erpSofAllocatedMap[sof.item_code] || 0;
        _erpSofAllocatedMap[sof.item_code] = currentMap + remaining;
      }
    });
    console.log('[Stock Monitor] ✅ SOF Allocated Map:', _erpSofAllocatedMap);
  } catch(sofErr) {
    console.warn('[Stock Monitor] SOF allocation fetch failed:', sofErr.message);
    _erpSofAllocatedMap = {};
  }

  window._erpVarianceMap = {};
  try {
    var varRes = await erpFetch('erp_v_latest_item_variances', 'select=*');
    (varRes || []).forEach(function(v) {
      window._erpVarianceMap[v.item_code] = Number(v.variance_qty || 0);
    });
    var varKpi = document.getElementById('kpiVariances');
    if (varKpi) varKpi.textContent = Object.keys(window._erpVarianceMap).length;
  } catch(e) { 
    console.warn('Variance fetch failed', e); 
  }

  var varianceFilter = document.getElementById('erpVarianceFilter');
  var varValue = varianceFilter ? varianceFilter.value : '';
  
  if (varValue) {
    _erpFilteredItems = _erpFilteredItems.filter(function(it) {
      var v = window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0;
      if (varValue === 'with') return v !== 0;
      if (varValue === 'without') return v === 0;
      if (varValue === 'positive') return v > 0;
      if (varValue === 'negative') return v < 0;
      return true;
    });
  }
  
  erpRenderTable();
  _erpRenderLock = false;
}

function erpRenderTable() {
  var tbody = document.getElementById('erpTableBody');
  if (!tbody) return;
  
  var total = _erpFilteredItems.length;
  var start = (_erpCurrentPage - 1) * _erpPageSize;
  var end = Math.min(start + _erpPageSize, total);
  var pageItems = _erpFilteredItems.slice(start, end);

  document.getElementById('erpTableCount').textContent = total + ' items';
  document.getElementById('erpPageTotal').textContent = total;
  document.getElementById('erpPageStart').textContent = total > 0 ? start + 1 : 0;
  document.getElementById('erpPageEnd').textContent = end;
  document.getElementById('erpPageLabel').textContent = 'Page ' + _erpCurrentPage;

  document.getElementById('erpBtnPrev').disabled = (_erpCurrentPage <= 1);
  document.getElementById('erpBtnNext').disabled = (end >= total);

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="19" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }

  var html = '';
  pageItems.forEach(function(it) {
    var onHand = Number(it.on_hand || 0);
    var buffer = Number(it.buffer_stock || 0);
    var isLocked = it.buffer_is_locked === true;
    var aveMo = Number(it.ave_monthly_consumption || 0);
    var aveDay = Number(it.ave_daily_consumption || 0);
    var activeMo = Number(it.active_consumption_months || 0);

    // Available = on_hand − sof_allocated (ang allocated ay nasa physical on_hand pa rin, naka-reserve lang)
    var sofAllocated = Number(_erpSofAllocatedMap[it.item_code] || 0);
    var available = onHand - sofAllocated;

    var variance = window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0;
    var rowHighlightStyle = variance !== 0 ? 'background:#fffbeb;' : '';

    var qtyClass = 'qty-ok';
    if (onHand === 0) qtyClass = 'qty-zero';
    else if (onHand <= buffer) qtyClass = 'qty-low';

    var availableClass = 'qty-ok';
    if (available <= 0) availableClass = 'qty-zero';
    else if (available <= buffer) availableClass = 'qty-low';

    var abcBadge = '';
    if (it.abc_classification) {
      abcBadge = '<span class="abc-badge abc-' + erpEsc(it.abc_classification) + '">' + erpEsc(it.abc_classification) + '</span>';
    }

    var movBadge = '';
    if (it.inventory_movement) {
      var m = it.inventory_movement.toUpperCase();
      var mClass = 'mov-none';
      if (m.indexOf('FAST') !== -1) mClass = 'mov-fast';
      else if (m.indexOf('MODERATE') !== -1) mClass = 'mov-mod';
      else if (m.indexOf('SLOW') !== -1) mClass = 'mov-slow';
      var shortLabel = m.replace(' MOVING', '').replace('MOVEMENT', '').trim() || 'N/A';
      movBadge = '<span class="mov-badge ' + mClass + '">' + erpEsc(shortLabel) + '</span>';
    }

    var reorderStatus = '';
    if (buffer > 0 && onHand <= buffer) {
      reorderStatus = '<span class="reorder-badge reorder-critical">FOR REPLENISHMENT</span>';
    } else if (buffer > 0 && onHand <= buffer * 1.25) {
      reorderStatus = '<span class="reorder-badge reorder-low">LOW STOCK</span>';
    } else if (buffer > 0) {
      reorderStatus = '<span class="reorder-badge reorder-ok">OK</span>';
    } else if (activeMo >= 1) {
      reorderStatus = '<span class="reorder-badge reorder-new">NEW</span>';
    } else {
      reorderStatus = '<span class="reorder-badge reorder-none">NO USAGE</span>';
    }

    var lockIcon = isLocked ? 'bi-lock-fill' : 'bi-unlock';
    var lockClass = isLocked ? 'locked' : 'unlocked';

    var safeCode = String(it.item_code || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var unitCost = Number(it.unit_cost || 0);
    var onHandCost = onHand * unitCost;

    var sofDisplay = sofAllocated > 0 
      ? '<span class="fw-bold" style="color:#f59e0b;">' + erpNum(sofAllocated) + '</span>'
      : '<span class="text-muted">—</span>';

    var availableDisplay = sofAllocated > 0
      ? '<span class="fw-bold ' + availableClass + '">' + erpNum(available) + '</span>'
      : '<span class="text-muted">' + erpNum(onHand) + '</span>';

    html += '<tr onclick="erpRowClick(event, \'' + safeCode + '\')" style="cursor:pointer;' + rowHighlightStyle + '">' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end ' + qtyClass + '">' + erpNum(onHand) + '</td>' +
      '<td class="text-center">' + 
        (variance !== 0 ? '<span class="badge bg-warning text-dark" title="Variance: ' + variance + '"><i class="bi bi-exclamation-triangle-fill"></i> ' + (variance > 0 ? '+' : '') + variance + '</span>' : '<span class="text-muted">—</span>') +
      '</td>' +
      '<td class="text-end">' + sofDisplay + '</td>' +
      '<td class="text-end">' + availableDisplay + '</td>' +
      '<td class="text-end buffer-cell">' +
        (isLocked ? '<i class="bi bi-lock-fill" style="color:#dc2626;font-size:0.7rem;margin-right:4px;" title="Locked (manual value)"></i>' : '') +
        erpNum(buffer) +
      '</td>' +
      '<td class="text-center">' + erpEsc(it.base_unit || '') + '</td>' +
      '<td class="text-end" style="font-family:\'Courier New\',monospace;">₱' + erpNum(unitCost.toFixed(2)) + '</td>' +
      '<td class="text-end fw-bold" style="font-family:\'Courier New\',monospace;color:#1e3a5f;">₱' + erpNum(onHandCost.toFixed(2)) + '</td>' +
      '<td class="text-center usage-cell">' + activeMo + '</td>' +
      '<td class="text-end usage-cell">' + erpNum(aveMo) + '</td>' +
      '<td class="text-end usage-cell">' + erpNum(aveDay) + '</td>' +
      '<td class="text-center">' + reorderStatus + '</td>' +
      '<td class="text-center">' + abcBadge + '</td>' +
      '<td class="text-center">' + movBadge + '</td>' +
      '<td class="text-center">' +
        '<button class="lock-toggle-btn ' + lockClass + '" ' +
          'onclick="event.stopPropagation();erpToggleLock(\'' + safeCode + '\', ' + isLocked + ')" ' +
          'title="' + (isLocked ? 'Unlock buffer' : 'Lock buffer') + '">' +
          '<i class="bi ' + lockIcon + '"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

// ... (I-keep mo na lang yung ibang functions gaya ng erpPagePrev, erpPageNext, erpOpenEditModal, etc. Hindi ko na i-type lahat dito para hindi masyadong mahaba, pero yung logic nila ay pareho pa rin.)

function erpExportOutOfStock() {
  if (_outOfStockFiltered.length === 0) {
    erpShowToast('No data to export');
    return;
  }
  
  var headers = ['Item Code', 'Description', 'Category', 'Location', 'On-Hand', 'Buffer Stock', 'Ave Monthly', 'Active Months', 'Status'];
  var rows = _outOfStockFiltered.map(function(it) {
    var buffer = Number(it.buffer_stock || 0);
    var status = buffer > 0 ? 'FOR REPLENISHMENT' : 'NO USAGE';
    return [
      it.item_code || '',
      it.description || '',
      it.category || '',
      it.location || '',
      0,
      buffer,
      Number(it.ave_monthly_consumption || 0),
      Number(it.active_consumption_months || 0),
      status
    ];
  });
  
  var csv = headers.map(_csvEscErp).join(',') + '\n';
  rows.forEach(function(row) {
    csv += row.map(_csvEscErp).join(',') + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'OutOfStock_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  erpShowToast('✅ Exported ' + rows.length + ' rows');
}

function _csvEscErp(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// ADD NEW ITEM MODAL
// ═══════════════════════════════════════════════════════════
var _addItemModal = null;
var _addItemSuccessModal = null;
var _addItemCheckTimer = null;
var _addItemLastCheckCode = '';
var _isSubmittingAddItem = false;

function erpOpenAddItemModal() {
  var modalEl = document.getElementById('erpAddItemModal');
  if (!modalEl) return;
  
  if (!_addItemModal) {
    _addItemModal = new bootstrap.Modal(modalEl);
  }
  
  document.getElementById('addItemCode').value = '';
  document.getElementById('addItemDesc').value = '';
  document.getElementById('addItemCategory').value = '';
  document.getElementById('addItemLocation').value = 'PROJECT STOCK';
  document.getElementById('addItemUnit').value = 'PIECE';
  document.getElementById('addItemCost').value = '';
  document.getElementById('addItemCodeStatus').innerHTML = '';
  
  _addItemLastCheckCode = '';
  _isSubmittingAddItem = false;
  
  _addItemModal.show();
  
  setTimeout(function() {
    var el = document.getElementById('addItemCode');
    if (el) el.focus();
  }, 300);
}

function erpCheckAddItemCode() {
  clearTimeout(_addItemCheckTimer);
  var code = (document.getElementById('addItemCode').value || '').trim();
  var statusEl = document.getElementById('addItemCodeStatus');
  
  if (!code) {
    statusEl.innerHTML = '';
    _addItemLastCheckCode = '';
    return;
  }
  
  statusEl.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split me-1"></i>Checking...</span>';
  
  _addItemCheckTimer = setTimeout(async function() {
    if (code === _addItemLastCheckCode) return;
    _addItemLastCheckCode = code;
    
    try {
      var rows = await erpFetch('erp_items',
        'select=item_code&item_code=ilike.' + encodeURIComponent(code) + '&limit=1');
      
      if (rows && rows.length > 0) {
        statusEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle-fill me-1"></i>' +
          'Item code already exists: <strong>' + erpEsc(rows[0].item_code) + '</strong></span>';
      } else {
        statusEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>' +
          'Available</span>';
      }
    } catch(err) {
      statusEl.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i>' +
        'Could not verify (will check on save)</span>';
    }
  }, 500);
}

async function erpSubmitNewItem() {
  if (_isSubmittingAddItem) return;
  
  var code = (document.getElementById('addItemCode').value || '').trim();
  var desc = (document.getElementById('addItemDesc').value || '').trim();
  var category = (document.getElementById('addItemCategory').value || '').trim();
  var location = (document.getElementById('addItemLocation').value || '').trim();
  var unit = (document.getElementById('addItemUnit').value || '').trim();
  var costRaw = (document.getElementById('addItemCost').value || '').trim();
  var cost = costRaw ? parseFloat(costRaw) : 0;
  
  if (!code) { erpShowToast('Item Code is required', 'warning'); return; }
  if (!desc) { erpShowToast('Description is required', 'warning'); return; }
  if (!category) { erpShowToast('Category is required', 'warning'); return; }
  if (!location) { erpShowToast('Location is required', 'warning'); return; }
  if (!unit) { erpShowToast('Base Unit is required', 'warning'); return; }
  if (isNaN(cost) || cost < 0) { erpShowToast('Unit Cost must be valid', 'warning'); return; }
  
  var createdBy = localStorage.getItem('ivm_userFullname') || 
                  localStorage.getItem('ivm_username') || 
                  'WAREHOUSE';
  
  _isSubmittingAddItem = true;
  var btn = document.getElementById('btnSaveNewItem');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
  
  try {
    var res = await fetch(erpUrl('rpc/erp_add_item'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_item_code: code,
        p_description: desc,
        p_category: category,
        p_location: location,
        p_base_unit: unit,
        p_unit_cost: cost,
        p_created_by: createdBy
      })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('API error: ' + res.status + ' ' + errText);
    }
    
    var data = await res.json();
    if (!data || !data.success) throw new Error((data && data.error) || 'Failed to add item');
    
    if (_addItemModal) _addItemModal.hide();
    
    var successEl = document.getElementById('erpAddItemSuccessModal');
    if (!_addItemSuccessModal) {
      _addItemSuccessModal = new bootstrap.Modal(successEl);
    }
    document.getElementById('addItemSuccessCode').textContent = data.item_code || code;
    _addItemSuccessModal.show();
    
    if (typeof erpLoadItems === 'function') erpLoadItems();
    if (typeof erpLoadSummary === 'function') erpLoadSummary();
  } catch(err) {
    console.error('[erpSubmitNewItem]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _isSubmittingAddItem = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function erpAddAnotherItem() {
  if (_addItemSuccessModal) _addItemSuccessModal.hide();
  setTimeout(function() { erpOpenAddItemModal(); }, 300);
}

function erpCloseAddItemSuccess() {
  if (_addItemSuccessModal) _addItemSuccessModal.hide();
}

// ═══════════════════════════════════════════════════════════
// EDIT ITEM MODAL (legacy)
// ═══════════════════════════════════════════════════════════
var _editItemModal = null;
var _editItemCurrent = null;
var _isSubmittingEditItem = false;

function erpOpenEditFromDetails() {
  console.log('[Edit] erpOpenEditFromDetails called');
  
  if (!window._currentItemDetails) {
    erpShowToast('No item loaded', 'warning');
    return;
  }
  
  var detailsModal = document.getElementById('erpItemModal');
  if (detailsModal) {
    var m = bootstrap.Modal.getInstance(detailsModal);
    if (m) m.hide();
  }
  
  setTimeout(function() {
    erpOpenEditItemModal(window._currentItemDetails);
  }, 350);
}

async function erpOpenEditItemModal(item) {
  console.log('[Edit] erpOpenEditItemModal called for:', item.item_code);
  
  if (!item || !item.item_code) {
    erpShowToast('Invalid item data', 'warning');
    return;
  }
  
  var freshItem = null;
  try {
    var rows = await erpFetch('erp_items',
      'select=*&item_code=eq.' + encodeURIComponent(item.item_code) + '&limit=1');
    if (rows && rows[0]) freshItem = rows[0];
  } catch(err) {
    console.warn('[erpOpenEditItemModal] Could not fetch fresh:', err.message);
  }
  
  var data = freshItem || item;
  _editItemCurrent = data;
  
  var modalEl = document.getElementById('erpEditItemModal');
  if (!modalEl) {
    console.error('[Edit] Modal erpEditItemModal NOT FOUND in HTML!');
    erpShowToast('Edit modal not found in HTML', 'danger');
    return;
  }
  
  if (!_editItemModal) {
    _editItemModal = new bootstrap.Modal(modalEl);
  }
  
  document.getElementById('editItemCode').value = data.item_code || '';
  document.getElementById('editItemCodeDisplay').textContent = data.item_code || '—';
  document.getElementById('editItemDesc').value = data.description || '';
  document.getElementById('editItemCategory').value = data.category || 'UNCATEGORIZED';
  document.getElementById('editItemLocation').value = data.location || '';
  
  var onHandEl = document.getElementById('editItemOnHand');
  if (onHandEl) onHandEl.value = data.on_hand != null ? data.on_hand : 0;
  
  document.getElementById('editItemCost').value = data.unit_cost != null ? data.unit_cost : 0;
  
  var bufferEl = document.getElementById('editItemBufferStock');
  if (bufferEl) {
    bufferEl.value = data.buffer_stock != null ? data.buffer_stock : 0;
    bufferEl.setAttribute('readonly', 'readonly');
  }
  
  var lockBtn = document.getElementById('editItemBufferLock');
  var lockIcon = document.getElementById('editItemBufferLockIcon');
  var lockText = document.getElementById('editItemBufferLockText');
  var bufferHint = document.getElementById('editItemBufferHint');
  
  if (data.buffer_is_locked) {
    if (lockIcon) lockIcon.className = 'bi bi-lock-fill me-1';
    if (lockText) lockText.textContent = 'Locked';
    if (lockBtn) lockBtn.className = 'btn btn-sm btn-outline-warning';
    if (bufferHint) bufferHint.innerHTML = '<i class="bi bi-lock-fill text-warning me-1"></i>Locked — click the button above to unlock';
  } else {
    if (lockIcon) lockIcon.className = 'bi bi-unlock me-1';
    if (lockText) lockText.textContent = 'Unlocked';
    if (lockBtn) lockBtn.className = 'btn btn-sm btn-outline-success';
    if (bufferHint) bufferHint.innerHTML = '<i class="bi bi-unlock text-success me-1"></i>Unlocked — auto-computed from usage';
  }
  
  var reorderEl = document.getElementById('editItemReorderPoint');
  if (reorderEl) reorderEl.value = data.reorder_point != null ? data.reorder_point : 0;
  
  document.getElementById('editItemStatus').value = data.is_active ? 'true' : 'false';
  
  document.getElementById('editItemStockClass').textContent = data.stock_classification || '—';
  document.getElementById('editItemMovement').textContent = data.inventory_movement || '—';
  document.getElementById('editItemActiveMo').textContent = data.active_consumption_months || 0;
  
  var lastUpdatedEl = document.getElementById('editItemLastUpdated');
  if (data.updated_by || data.updated_at) {
    var when = data.updated_at ? new Date(data.updated_at).toLocaleString() : '—';
    lastUpdatedEl.innerHTML = '<i class="bi bi-clock-history me-1"></i>' +
      'Last updated by <strong>' + erpEsc(data.updated_by || 'unknown') + '</strong> on ' + erpEsc(when);
  } else {
    lastUpdatedEl.innerHTML = '';
  }
  
  var reasonEl = document.getElementById('editItemReason');
  if (reasonEl) reasonEl.value = '';
  
  var deactivateBtn = document.getElementById('btnDeactivateItem');
  if (data.is_active === false) {
    deactivateBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise me-1"></i>Reactivate';
    deactivateBtn.className = 'btn btn-outline-success me-auto';
  } else {
    deactivateBtn.innerHTML = '<i class="bi bi-trash me-1"></i>Deactivate';
    deactivateBtn.className = 'btn btn-outline-danger me-auto';
  }
  
  _isSubmittingEditItem = false;
  _editItemModal.show();
  console.log('[Edit] Modal shown');
}

window.erpToggleEditBufferLock = function() {
  var bufferEl = document.getElementById('editItemBufferStock');
  var lockIcon = document.getElementById('editItemBufferLockIcon');
  var lockText = document.getElementById('editItemBufferLockText');
  var lockBtn = document.getElementById('editItemBufferLock');
  var hintEl = document.getElementById('editItemBufferHint');
  
  if (!bufferEl) return;
  
  var isCurrentlyReadonly = bufferEl.hasAttribute('readonly');
  
  if (isCurrentlyReadonly) {
    bufferEl.removeAttribute('readonly');
    bufferEl.focus();
    bufferEl.select();
    
    if (lockIcon) lockIcon.className = 'bi bi-unlock me-1';
    if (lockText) lockText.textContent = 'Unlocked';
    if (lockBtn) lockBtn.className = 'btn btn-sm btn-outline-success';
    if (hintEl) hintEl.innerHTML = '<i class="bi bi-pencil-fill text-success me-1"></i>Editing — pwede mo nang baguhin';
  } else {
    bufferEl.setAttribute('readonly', 'readonly');
    
    if (lockIcon) lockIcon.className = 'bi bi-lock-fill me-1';
    if (lockText) lockText.textContent = 'Locked';
    if (lockBtn) lockBtn.className = 'btn btn-sm btn-outline-warning';
    if (hintEl) hintEl.innerHTML = '<i class="bi bi-lock-fill text-warning me-1"></i>Locked — click the button above to unlock';
  }
};

async function erpSubmitEditItem() {
  console.log('[Edit] erpSubmitEditItem called');
  
  if (_isSubmittingEditItem) return;
  if (!_editItemCurrent) {
    erpShowToast('No item loaded', 'warning');
    return;
  }
  
  var code = document.getElementById('editItemCode').value;
  var desc = (document.getElementById('editItemDesc').value || '').trim();
  var category = (document.getElementById('editItemCategory').value || '').trim();
  var location = (document.getElementById('editItemLocation').value || '').trim();
  
  var onHandRaw = document.getElementById('editItemOnHand') ? document.getElementById('editItemOnHand').value : '';
  var onHand = onHandRaw !== '' ? parseFloat(onHandRaw) : null;
  
  var costRaw = (document.getElementById('editItemCost').value || '').trim();
  var cost = costRaw !== '' ? parseFloat(costRaw) : null;
  
  var bufferRaw = document.getElementById('editItemBufferStock') ? document.getElementById('editItemBufferStock').value : '';
  var buffer = bufferRaw !== '' ? parseFloat(bufferRaw) : null;
  
  var reorderRaw = document.getElementById('editItemReorderPoint') ? document.getElementById('editItemReorderPoint').value : '';
  var reorder = reorderRaw !== '' ? parseFloat(reorderRaw) : null;
  
  var statusRaw = document.getElementById('editItemStatus').value;
  var isActive = statusRaw === 'true';
  
  var reason = (document.getElementById('editItemReason').value || '').trim();
  
  if (!desc) { erpShowToast('Description is required', 'warning'); return; }
  if (!category) { erpShowToast('Category is required', 'warning'); return; }
  if (!location) { erpShowToast('Location is required', 'warning'); return; }
  
  if (onHand !== null && (isNaN(onHand) || onHand < 0)) { 
    erpShowToast('On-Hand must be valid (≥ 0)', 'warning'); return; 
  }
  if (cost !== null && (isNaN(cost) || cost < 0)) { 
    erpShowToast('Unit Cost must be valid (≥ 0)', 'warning'); return; 
  }
  if (buffer !== null && (isNaN(buffer) || buffer < 0)) { 
    erpShowToast('Buffer Stock must be valid (≥ 0)', 'warning'); return; 
  }
  if (reorder !== null && (isNaN(reorder) || reorder < 0)) { 
    erpShowToast('Reorder Point must be valid (≥ 0)', 'warning'); return; 
  }
  
  var old = _editItemCurrent;
  var hasChanges = false;
  
  if (desc !== (old.description || '')) hasChanges = true;
  if (category !== (old.category || '')) hasChanges = true;
  if (location !== (old.location || '')) hasChanges = true;
  if (onHand !== null && onHand !== Number(old.on_hand || 0)) hasChanges = true;
  if (cost !== null && cost !== Number(old.unit_cost || 0)) hasChanges = true;
  if (buffer !== null && buffer !== Number(old.buffer_stock || 0)) hasChanges = true;
  if (reorder !== null && reorder !== Number(old.reorder_point || 0)) hasChanges = true;
  if (isActive !== old.is_active) hasChanges = true;
  
  if (!hasChanges) {
    erpShowToast('Walang binago', 'info');
    return;
  }
  
  if (!reason) {
    erpShowToast('⚠️ Reason is required for changes', 'warning');
    document.getElementById('editItemReason').focus();
    return;
  }
  
  var updatedBy = localStorage.getItem('ivm_userFullname') || 
                  localStorage.getItem('ivm_username') || 
                  'WAREHOUSE';
  
  _isSubmittingEditItem = true;
  var btn = document.getElementById('btnSaveEditItem');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
  
  try {
    var payload = {
      p_item_code: code,
      p_description: desc,
      p_category: category,
      p_location: location,
      p_unit_cost: cost,
      p_is_active: isActive,
      p_updated_by: updatedBy,
      p_reason: reason,
      p_on_hand: onHand,
      p_buffer_stock: buffer,
      p_reorder_point: reorder
    };
    
    console.log('[Edit] Sending payload:', payload);
    
    var res = await fetch(erpUrl('rpc/erp_update_item_full'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error('API error: ' + res.status);
    var data = await res.json();
    
    if (!data || !data.success) throw new Error((data && data.error) || 'Failed to update item');
    
    if (_editItemModal) _editItemModal.hide();
    erpShowToast('✅ Item updated: ' + code);
    
    if (typeof erpLoadItems === 'function') await erpLoadItems();
    if (typeof erpLoadSummary === 'function') await erpLoadSummary();
    if (typeof erpLoadCharts === 'function') await erpLoadCharts();
    
  } catch(err) {
    console.error('[erpSubmitEditItem]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _isSubmittingEditItem = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function erpConfirmDeactivateItem() {
  if (!_editItemCurrent) return;
  
  var code = _editItemCurrent.item_code;
  var isCurrentlyActive = _editItemCurrent.is_active !== false;
  
  if (isCurrentlyActive) {
    if (!confirm('Deactivate item "' + code + '"?')) return;
  } else {
    if (!confirm('Reactivate item "' + code + '"?')) return;
    return erpSubmitEditItem();
  }
  
  var deletedBy = localStorage.getItem('ivm_userFullname') || 
                  localStorage.getItem('ivm_username') || 
                  'WAREHOUSE';
  
  var btn = document.getElementById('btnDeactivateItem');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Deactivating...';
  
  try {
    var res = await fetch(erpUrl('rpc/erp_soft_delete_item'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_item_code: code,
        p_deleted_by: deletedBy
      })
    });
    
    if (!res.ok) throw new Error('API error: ' + res.status);
    var data = await res.json();
    if (!data || !data.success) throw new Error((data && data.error) || 'Failed');
    
    if (_editItemModal) _editItemModal.hide();
    erpShowToast('✅ Item deactivated');
    
    if (typeof erpLoadItems === 'function') erpLoadItems();
  } catch(err) {
    console.error('[erpConfirmDeactivateItem]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ═══════════════════════════════════════════════════════════
// ROW CLICK HANDLER
// ═══════════════════════════════════════════════════════════
window.erpRowClick = function(event, itemCode) {
  var target = event.target;
  
  if (target.closest('.editable-cell')) {
    return;
  }
  
  if (target.closest('.lock-toggle-btn')) {
    return;
  }
  
  if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'A') {
    return;
  }
  
  if (target.closest('td:last-child')) {
    return;
  }
  
  erpShowItemDetails(itemCode);
};

// ═══════════════════════════════════════════════════════════
// BULK BUFFER LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════
window.erpBulkLockBuffer = async function(isLocked) {
  var action = isLocked ? 'LOCK' : 'UNLOCK';
  if (!confirm('Are you sure you want to ' + action + ' ALL active buffer stocks?\n\nThis will affect all items in the database.')) return;

  erpShowToast('Processing bulk ' + action + '...');
  
  try {
    var user = localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';
    
    var res = await fetch(erpUrl('rpc/erp_bulk_toggle_buffer_lock'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_is_locked: isLocked,
        p_updated_by: user
      })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      erpShowToast(`✅ ${action}ED ${data.updated} items successfully!`);
      await erpLoadItems();
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch(err) {
    console.error('[erpBulkLockBuffer]', err);
    erpShowToast('Failed: ' + err.message);
  }
};

// ═══════════════════════════════════════════════════════════
// VIEW DEACTIVATED ITEMS & RESTORE
// ═══════════════════════════════════════════════════════════
window.erpOpenDeactivatedModal = async function() {
  var modalEl = document.getElementById('erpDeactivatedModal');
  if (!modalEl) return;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  var tbody = document.getElementById('erpDeactivatedBody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    var rows = await erpFetch('erp_items', 'select=item_code,description,category,location&is_deleted=eq.true&limit=1000');
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><i class="bi bi-inbox fs-3 d-block mb-2"></i>No deactivated items found.</td></tr>';
      return;
    }
    
    var html = '';
    rows.forEach(function(it) {
      var safeCode = String(it.item_code).replace(/'/g, "\\'");
      html += '<tr>' +
        '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
        '<td>' + erpEsc(it.description || '—') + '</td>' +
        '<td>' + erpEsc(it.category || '—') + '</td>' +
        '<td>' + erpEsc(it.location || '—') + '</td>' +
        '<td class="text-center">' +
          '<button class="btn btn-sm btn-success" onclick="erpRestoreItem(\'' + safeCode + '\')">' +
            '<i class="bi bi-arrow-counterclockwise me-1"></i>Restore' +
          '</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
    
  } catch(err) {
    console.error('[erpOpenDeactivatedModal]', err);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Failed to load: ' + erpEsc(err.message) + '</td></tr>';
  }
};

window.erpRestoreItem = async function(itemCode) {
  if (!confirm('Restore item "' + itemCode + '" to active inventory?')) return;
  
  try {
    var res = await fetch(erpUrl('erp_items?item_code=eq.' + encodeURIComponent(itemCode)), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        is_deleted: false,
        is_active: true,
        updated_at: new Date().toISOString()
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    erpShowToast('✅ Item restored successfully!');
    
    erpOpenDeactivatedModal(); 
    erpLoadItems();
    
  } catch(err) {
    console.error('[erpRestoreItem]', err);
    erpShowToast('Failed to restore: ' + err.message);
  }
};

// ═══════════════════════════════════════════════════════════
// VARIANCE FILTER & MODAL FUNCTIONS
// ═══════════════════════════════════════════════════════════

window.erpFilterByVariance = function() {
  var varFilter = document.getElementById('erpVarianceFilter');
  if (!varFilter) return;
  
  if (varFilter.value === 'with') {
    varFilter.value = ''; 
    erpShowToast('Showing all items');
  } else {
    varFilter.value = 'with'; 
    erpShowToast('Filtered: Items with variance');
  }
  
  erpLoadItems();
  
  setTimeout(function() {
    var tableCard = document.querySelector('.erp-table-card');
    if (tableCard) tableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
};

window.erpShowVariancesModal = function() {
  var modalEl = document.getElementById('erpVariancesModal');
  if (!modalEl) {
    alert('Error: Modal HTML not found. Please add erpVariancesModal in stock-monitor.html');
    return;
  }
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  var tbody = document.getElementById('variancesTableBody');
  
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  modal.show();
  
  var varianceItems = _erpAllItems.filter(function(it) {
    return window._erpVarianceMap && (window._erpVarianceMap[it.item_code] || 0) !== 0;
  });
  
  window._variancesAll = varianceItems;
  window._variancesFiltered = varianceItems;
  
  document.getElementById('variancesSearchInput').value = '';
  erpRenderVariancesModal();
};

function erpRenderVariancesModal() {
  var tbody = document.getElementById('variancesTableBody');
  var items = window._variancesFiltered || [];
  var countEl = document.getElementById('variancesCount');
  
  if (countEl) countEl.textContent = items.length;
  
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted"><i class="bi bi-check-circle text-success fs-3 d-block mb-2"></i>No variances found!</td></tr>';
    return;
  }
  
  var html = '';
  items.forEach(function(it) {
    var v = window._erpVarianceMap[it.item_code] || 0;
    var systemQty = Number(it.on_hand || 0) - v;
    var countedQty = Number(it.on_hand || 0);
    var varColor = v > 0 ? 'text-danger' : 'text-primary';
    var varPrefix = v > 0 ? '+' : '';
    var safeCode = String(it.item_code).replace(/'/g, "\\'");
    
    html += '<tr>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td class="text-center text-muted">' + erpNum(systemQty) + '</td>' +
      '<td class="text-center fw-bold">' + erpNum(countedQty) + '</td>' +
      '<td class="text-center ' + varColor + '"><strong>' + varPrefix + erpNum(v) + '</strong></td>' +
      '<td class="text-center"><button class="btn btn-sm btn-outline-primary" onclick="erpViewVarianceItem(\'' + safeCode + '\')"><i class="bi bi-eye"></i> View</button></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

window.erpFilterVariancesModal = function() {
  var term = (document.getElementById('variancesSearchInput').value || '').toLowerCase().trim();
  var all = window._variancesAll || [];
  
  if (!term) {
    window._variancesFiltered = all;
  } else {
    window._variancesFiltered = all.filter(function(it) {
      return String(it.item_code || '').toLowerCase().indexOf(term) !== -1 || 
             String(it.description || '').toLowerCase().indexOf(term) !== -1;
    });
  }
  erpRenderVariancesModal();
};

window.erpViewVarianceItem = function(itemCode) {
  var modalEl = document.getElementById('erpVariancesModal');
  if (modalEl) {
    var m = bootstrap.Modal.getInstance(modalEl);
    if (m) m.hide();
  }
  setTimeout(function() {
    window.location.href = 'item-in-out.html?code=' + encodeURIComponent(itemCode);
  }, 300);
};

window.erpExportVariances = function() {
  var items = window._variancesFiltered || [];
  if (items.length === 0) { erpShowToast('No data to export'); return; }
  
  var headers = ['Item Code', 'Description', 'Category', 'System Qty', 'Counted Qty', 'Variance'];
  var rows = items.map(function(it) {
    var v = window._erpVarianceMap[it.item_code] || 0;
    return [it.item_code, it.description || '', it.category || '', Number(it.on_hand || 0) - v, Number(it.on_hand || 0), v];
  });
  
  var csv = headers.map(_csvEscErp).join(',') + '\n';
  rows.forEach(function(row) { csv += row.map(_csvEscErp).join(',') + '\n'; });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Inventory_Variances_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  erpShowToast('✅ Exported ' + rows.length + ' variances');
};


// ============================================================
// ✅ RESTORED FUNCTIONS (v3.4)
// Nawala ang mga ito nang i-paste ang pinaikling stock-monitor.js
// (yung "... I-keep mo na lang yung ibang functions" na placeholder).
// ============================================================
var _outOfStockAll = [];
var _outOfStockFiltered = [];

function _erpUser() {
  return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';
}

// ─── Filter dropdown options ───
async function erpLoadFilterOptions() {
  var targets = [
    { col: 'category', id: 'erpCategoryFilter' },
    { col: 'location', id: 'erpLocationFilter' }
  ];
  for (var i = 0; i < targets.length; i++) {
    var sel = document.getElementById(targets[i].id);
    if (!sel) continue;
    try {
      var res = await erpGetDistinctValues(targets[i].col);
      if (!res.success) continue;
      var keep = sel.value;
      var first = sel.options[0] ? sel.options[0].outerHTML : '<option value="">All</option>';
      sel.innerHTML = first + res.values.map(function(v) {
        return '<option value="' + erpEsc(v) + '">' + erpEsc(v) + '</option>';
      }).join('');
      sel.value = keep;
    } catch (e) { console.warn('[erpLoadFilterOptions]', e.message); }
  }
}

// ─── Search (client-side, walang bagong fetch bawat type) ───
function erpOnSearchInput() {
  clearTimeout(_erpSearchTimer);
  _erpSearchTimer = setTimeout(function() {
    var q = (document.getElementById('erpSearchInput').value || '').trim().toLowerCase();
    var varValue = (document.getElementById('erpVarianceFilter') || {}).value || '';
    _erpFilteredItems = _erpAllItems.filter(function(it) {
      if (q) {
        var hay = ((it.item_code || '') + ' ' + (it.description || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (varValue) {
        var v = window._erpVarianceMap ? (window._erpVarianceMap[it.item_code] || 0) : 0;
        if (varValue === 'with' && v === 0) return false;
        if (varValue === 'without' && v !== 0) return false;
        if (varValue === 'positive' && v <= 0) return false;
        if (varValue === 'negative' && v >= 0) return false;
      }
      return true;
    });
    _erpCurrentPage = 1;
    erpRenderTable();
  }, 250);
}

function erpPagePrev() {
  if (_erpCurrentPage > 1) { _erpCurrentPage--; erpRenderTable(); }
}
function erpPageNext() {
  if (_erpCurrentPage * _erpPageSize < _erpFilteredItems.length) { _erpCurrentPage++; erpRenderTable(); }
}

function erpClearFilters() {
  ['erpSearchInput', 'erpCategoryFilter', 'erpLocationFilter', 'erpMovementFilter', 'erpAbcFilter', 'erpVarianceFilter']
    .forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
  erpLoadItems();
}

async function erpRefreshAll() {
  try { if (typeof erpClearCache === 'function') erpClearCache(); } catch (e) {}
  try { if (typeof erpClearInventoryCache === 'function') erpClearInventoryCache(); } catch (e) {}
  erpShowToast('Refreshing...');
  await erpLoadDashboard();
  erpShowToast('✅ Refreshed');
}

// ─── ITEM DETAILS MODAL ───
async function erpShowItemDetails(itemCode) {
  var modalEl = document.getElementById('erpItemModal');
  if (!modalEl) return;
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  var body = document.getElementById('erpModalBody');
  document.getElementById('erpModalTitle').textContent = itemCode;
  body.innerHTML = '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading...</div></div>';
  window._currentItemDetails = null;
  modal.show();

  try {
    var results = await Promise.all([erpGetItemDetails(itemCode), erpGetItemMovements(itemCode, 50), erpGetManualOnHandEdits(itemCode, 100)]);
    var dRes = results[0], mRes = results[1], editRows = results[2] || [];
    if (!dRes.success) {
      body.innerHTML = '<div class="text-center text-danger py-4">' + erpEsc(dRes.error) + '</div>';
      return;
    }
    var it = dRes.item;
    window._currentItemDetails = it;

    var onHand = Number(it.on_hand || 0);
    var sof = Number(_erpSofAllocatedMap[it.item_code] || 0);
    var cost = Number(it.unit_cost || 0);
    document.getElementById('erpModalTitle').textContent = it.item_code + ' — ' + (it.description || '');

    function cell(label, val) {
      return '<div class="col-6 col-md-4"><div class="small text-muted text-uppercase" style="font-size:0.68rem;font-weight:700;">' +
        erpEsc(label) + '</div><div class="fw-semibold">' + val + '</div></div>';
    }
    var html = '<div class="row g-3 mb-3">' +
      cell('Item Code', '<code>' + erpEsc(it.item_code) + '</code>') +
      cell('Category', erpEsc(it.category || '—')) +
      cell('Location', erpEsc(it.location || '—')) +
      cell('On-Hand', erpNum(onHand) + ' ' + erpEsc(it.base_unit || '')) +
      cell('SOF Allocated', sof > 0 ? erpNum(sof) : '—') +
      cell('Available', erpNum(onHand - sof)) +
      cell('Buffer Stock', erpNum(it.buffer_stock || 0) + (it.buffer_is_locked ? ' 🔒' : '')) +
      cell('Unit Cost', '₱' + erpNum(cost.toFixed(2))) +
      cell('On-Hand Cost', '₱' + erpNum((onHand * cost).toFixed(2))) +
      cell('Ave / Month', erpNum(it.ave_monthly_consumption || 0)) +
      cell('Active Months', erpNum(it.active_consumption_months || 0)) +
      cell('Classification', erpEsc(it.stock_classification || '—')) +
      cell('ABC', erpEsc(it.abc_classification || '—')) +
      cell('Movement', erpEsc(it.inventory_movement || '—')) +
      '</div>';

    html += '<h6 class="fw-bold mt-3 mb-2"><i class="bi bi-clock-history me-1"></i>Recent Movements</h6>';
    var mv = erpMergeManualAdjustments((mRes && mRes.movements) || [], editRows).slice(0, 50);
    if (mv.length === 0) {
      html += '<div class="text-muted small">Walang movements.</div>';
    } else {
      html += '<div class="table-responsive"><table class="erp-table"><thead><tr>' +
        '<th>Date</th><th>Type</th><th class="text-end">In</th><th class="text-end">Out</th>' +
        '<th class="text-end">Balance</th><th>Reference / Reason</th></tr></thead><tbody>';
      mv.forEach(function(m) {
        var d = m.transaction_date || m.created_at;
        var ds = d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
        var qin = Number(m.qty_in || 0), qout = Number(m.qty_out || 0);
        var isAdj = m._synthetic || String(m.transaction_type || '').toUpperCase().indexOf('ADJ') !== -1;
        var typeCell = isAdj
          ? '<span class="badge bg-warning text-dark">ADJ</span>'
          : erpEsc(m.transaction_type || '—');
        var refCell = erpEsc(m.reference_doc || '') +
          (m._synthetic && m.reason ? ' <span class="text-muted small">— ' + erpEsc(m.reason) + '</span>' : '') +
          (m._synthetic && m.performed_by ? ' <span class="text-muted small">(' + erpEsc(m.performed_by) + ')</span>' : '');
        html += '<tr' + (isAdj ? ' style="background:#fffbeb;"' : '') + '><td>' + erpEsc(ds) + '</td><td>' + typeCell + '</td>' +
          '<td class="text-end text-success">' + (qin ? '+' + erpNum(qin) : '') + '</td>' +
          '<td class="text-end text-danger">' + (qout ? '-' + erpNum(qout) : '') + '</td>' +
          '<td class="text-end">' + (m.balance_after !== null && m.balance_after !== undefined ? erpNum(m.balance_after) : '') + '</td>' +
          '<td>' + refCell + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    body.innerHTML = html;
  } catch (err) {
    console.error('[erpShowItemDetails]', err);
    body.innerHTML = '<div class="text-center text-danger py-4">Failed to load: ' + erpEsc(err.message) + '</div>';
  }
}
window.erpShowItemDetails = erpShowItemDetails;

// ─── Lock toggle (buffer) ───
async function erpToggleLock(itemCode, currentlyLocked) {
  var newState = !currentlyLocked;
  try {
    var res = await fetch(erpUrl('erp_items?item_code=eq.' + encodeURIComponent(itemCode)), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({ buffer_is_locked: newState, updated_at: new Date().toISOString(), updated_by: _erpUser() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()));
    _erpAllItems.forEach(function(it) { if (it.item_code === itemCode) it.buffer_is_locked = newState; });
    erpRenderTable();
    erpShowToast(newState ? '🔒 Buffer locked' : '🔓 Buffer unlocked');
  } catch (err) {
    console.error('[erpToggleLock]', err);
    erpShowToast('Failed: ' + err.message);
  }
}
window.erpToggleLock = erpToggleLock;

// ─── KPI modals ───
function _erpMiniRows(items, withStatus) {
  if (!items.length) return '<tr><td colspan="9" class="text-center text-muted py-4">Walang items.</td></tr>';
  return items.map(function(it) {
    var buffer = Number(it.buffer_stock || 0);
    var status = withStatus ? withStatus(it) : '';
    return '<tr><td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end">' + erpNum(it.on_hand || 0) + '</td>' +
      '<td class="text-end">' + erpNum(buffer) + '</td>' +
      '<td class="text-end">' + erpNum(it.ave_monthly_consumption || 0) + '</td>' +
      '<td class="text-center">' + erpNum(it.active_consumption_months || 0) + '</td>' +
      '<td class="text-center">' + status + '</td></tr>';
  }).join('');
}

function erpShowNewItemsModal() {
  var items = _erpAllItems.filter(function(it) {
    var b = Number(it.buffer_stock || 0);
    return String(it.stock_classification || '').toUpperCase() === 'NEW' && b > 0 && Number(it.on_hand || 0) <= b;
  });
  document.getElementById('newItemsCount').textContent = items.length;
  document.getElementById('newItemsBody').innerHTML = _erpMiniRows(items, function() {
    return '<span class="reorder-badge reorder-new">MONITOR</span>';
  });
  bootstrap.Modal.getOrCreateInstance(document.getElementById('erpNewItemsModal')).show();
}

function erpShowOutOfStockModal() {
  _outOfStockAll = _erpAllItems.filter(function(it) { return Number(it.on_hand || 0) <= 0; });
  document.getElementById('outOfStockFilter').value = 'all';
  document.getElementById('outOfStockSearch').value = '';
  erpFilterOutOfStock();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('erpOutOfStockModal')).show();
}

function erpFilterOutOfStock() {
  var mode = document.getElementById('outOfStockFilter').value;
  var q = (document.getElementById('outOfStockSearch').value || '').trim().toLowerCase();
  _outOfStockFiltered = _outOfStockAll.filter(function(it) {
    var b = Number(it.buffer_stock || 0);
    if (mode === 'standard' && !(b > 0)) return false;
    if (mode === 'no-usage' && b > 0) return false;
    if (q && ((it.item_code || '') + ' ' + (it.description || '')).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  document.getElementById('outOfStockCount').textContent = _outOfStockFiltered.length;
  document.getElementById('outOfStockBody').innerHTML = _erpMiniRows(_outOfStockFiltered, function(it) {
    return Number(it.buffer_stock || 0) > 0
      ? '<span class="reorder-badge reorder-critical">FOR REPLENISHMENT</span>'
      : '<span class="reorder-badge reorder-none">NO USAGE</span>';
  });
}

async function erpShowReorderModal() {
  var modalEl = document.getElementById('erpReorderModal');
  var body = document.getElementById('erpReorderBody');
  body.innerHTML = '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading reorder list...</div></div>';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  var res = await erpGetReorderList(true);
  if (!res.success) {
    body.innerHTML = '<div class="text-center text-danger py-4">' + erpEsc(res.error) + '</div>';
    return;
  }
  var items = res.items || [];
  if (!items.length) {
    body.innerHTML = '<div class="text-center text-muted py-4">Walang items na kailangang i-reorder.</div>';
    return;
  }
  var html = '<div class="table-responsive"><table class="erp-table"><thead><tr>' +
    '<th>Item Code</th><th>Description</th><th>Category</th><th class="text-end">On-Hand</th>' +
    '<th class="text-end">Buffer</th><th class="text-end">Shortfall</th><th class="text-end">Ave/Mo</th></tr></thead><tbody>';
  items.forEach(function(it) {
    var oh = Number(it.on_hand || 0), bf = Number(it.buffer_stock || 0);
    html += '<tr><td><code>' + erpEsc(it.item_code) + '</code></td><td>' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td><td class="text-end">' + erpNum(oh) + '</td>' +
      '<td class="text-end">' + erpNum(bf) + '</td><td class="text-end fw-bold">' + erpNum(Math.max(bf - oh, 0)) + '</td>' +
      '<td class="text-end">' + erpNum(it.ave_monthly_consumption || 0) + '</td></tr>';
  });
  body.innerHTML = html + '</tbody></table></div>';
}

// ─── Inline edit cell (gumagamit ng erp_manual_edit_item RPC) ───
// _editCellContext = { itemCode, field, label, current }
async function erpSaveEditedCell() {
  var ctx = _editCellContext;
  if (!ctx) { erpShowToast('Walang item na ie-edit', 'warning'); return; }
  var newVal = document.getElementById('editCellNewValue').value;
  var reason = (document.getElementById('editCellReason').value || '').trim();
  if (newVal === '' || isNaN(Number(newVal)) || Number(newVal) < 0) { erpShowToast('Maglagay ng valid na value (≥ 0)', 'warning'); return; }
  if (!reason) { erpShowToast('Reason is required', 'warning'); return; }
  try {
    var res = await fetch(erpUrl('rpc/erp_manual_edit_item'), {
      method: 'POST', headers: erpHeaders(),
      body: JSON.stringify({ p_item_code: ctx.itemCode, p_field_name: ctx.field, p_new_value: String(newVal), p_reason: reason, p_edited_by: _erpUser() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()));
    var data = await res.json();
    if (data && data.success === false) throw new Error(data.error || 'Unknown error');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('editCellModal')).hide();
    erpShowToast('✅ Saved');
    await erpLoadItems();
  } catch (err) {
    console.error('[erpSaveEditedCell]', err);
    erpShowToast('Failed: ' + err.message);
  }
}

// ─── CSV bulk import ───
function erpOpenCsvImport() {
  _csvImportData = null;
  document.getElementById('csvStepUpload').style.display = '';
  document.getElementById('csvStepPreview').style.display = 'none';
  document.getElementById('csvStepResult').style.display = 'none';
  document.getElementById('btnCsvImport').style.display = 'none';
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvImportReason').value = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('csvImportModal')).show();
}

function erpDownloadCsvTemplate() {
  var csv = 'item_code,on_hand,unit_cost,buffer_stock\nGEM-XXX,0,0,0\n';
  var link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  link.download = 'stock_import_template.csv';
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function _csvParse(text) {
  var rows = [], row = [], cur = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(function(x) { return x.trim() !== ''; })) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(function(x) { return x.trim() !== ''; })) rows.push(row);
  return rows;
}

function erpHandleCsvUpload(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var rows = _csvParse(String(e.target.result || '').replace(/^﻿/, ''));
    if (rows.length < 2) { erpShowToast('Walang laman ang CSV', 'warning'); return; }
    var head = rows[0].map(function(h) { return h.trim().toLowerCase(); });
    var idx = { code: head.indexOf('item_code'), oh: head.indexOf('on_hand'), cost: head.indexOf('unit_cost'), buf: head.indexOf('buffer_stock') };
    if (idx.code === -1) { erpShowToast('Kailangan ng item_code column', 'warning'); return; }
    var byCode = {};
    _erpAllItems.forEach(function(it) { byCode[it.item_code] = it; });
    var num = function(r, i) { if (i === -1 || r[i] === undefined || String(r[i]).trim() === '') return null; var n = Number(r[i]); return isNaN(n) ? null : n; };
    _csvImportData = [];
    var html = '';
    rows.slice(1).forEach(function(r, n) {
      var code = (r[idx.code] || '').trim();
      var item = byCode[code];
      var rec = { code: code, item: item, on_hand: num(r, idx.oh), unit_cost: num(r, idx.cost), buffer_stock: num(r, idx.buf) };
      var changes = [];
      if (item) {
        if (rec.on_hand !== null && rec.on_hand !== Number(item.on_hand || 0)) changes.push('on_hand');
        if (rec.unit_cost !== null && rec.unit_cost !== Number(item.unit_cost || 0)) changes.push('unit_cost');
        if (rec.buffer_stock !== null && rec.buffer_stock !== Number(item.buffer_stock || 0)) changes.push('buffer_stock');
      }
      rec.changes = changes;
      _csvImportData.push(rec);
      var st = !item ? '<span class="badge bg-danger">NOT FOUND</span>' : (changes.length ? '<span class="badge bg-warning text-dark">CHANGE</span>' : '<span class="badge bg-secondary">NO CHANGE</span>');
      html += '<tr><td>' + (n + 1) + '</td><td><code>' + erpEsc(code) + '</code></td><td>' + erpEsc(item ? item.description : '—') + '</td>' +
        '<td>' + (rec.on_hand === null ? '—' : erpNum(rec.on_hand)) + '</td><td>' + (rec.unit_cost === null ? '—' : erpNum(rec.unit_cost)) + '</td>' +
        '<td>' + (rec.buffer_stock === null ? '—' : erpNum(rec.buffer_stock)) + '</td><td>' + st + '</td></tr>';
    });
    document.getElementById('csvPreviewBody').innerHTML = html;
    document.getElementById('csvPreviewCount').textContent = _csvImportData.length;
    document.getElementById('csvStepUpload').style.display = 'none';
    document.getElementById('csvStepPreview').style.display = '';
    document.getElementById('btnCsvImport').style.display = '';
  };
  reader.readAsText(file);
}

async function erpConfirmCsvImport() {
  var reason = (document.getElementById('csvImportReason').value || '').trim();
  if (!_csvImportData) return;
  if (!reason) { erpShowToast('Reason is required', 'warning'); return; }
  var todo = _csvImportData.filter(function(r) { return r.item && r.changes.length; });
  if (!todo.length) { erpShowToast('Walang babaguhin', 'info'); return; }
  if (!confirm('Mag-a-update ng ' + todo.length + ' item(s). Tuloy?')) return;
  var btn = document.getElementById('btnCsvImport');
  btn.disabled = true;
  var ok = 0, fail = 0;
  for (var i = 0; i < todo.length; i++) {
    for (var j = 0; j < todo[i].changes.length; j++) {
      var f = todo[i].changes[j];
      try {
        var res = await fetch(erpUrl('rpc/erp_manual_edit_item'), {
          method: 'POST', headers: erpHeaders(),
          body: JSON.stringify({ p_item_code: todo[i].code, p_field_name: f, p_new_value: String(todo[i][f]), p_reason: 'CSV import: ' + reason, p_edited_by: _erpUser() })
        });
        var d = res.ok ? await res.json() : null;
        if (res.ok && !(d && d.success === false)) ok++; else fail++;
      } catch (e) { fail++; }
    }
  }
  btn.disabled = false;
  document.getElementById('csvStepPreview').style.display = 'none';
  document.getElementById('csvStepResult').style.display = '';
  btn.style.display = 'none';
  document.getElementById('csvResultSummary').textContent = ok + ' field(s) updated, ' + fail + ' failed.';
  await erpLoadItems();
}


// ─── Toast (nawala sa pinaikling bersyon) ───
if (typeof window.erpShowToast !== 'function') {
  window.erpShowToast = function(msg, type) {
    var toastEl = document.getElementById('erpToast');
    if (!toastEl) { console.log('[Toast]', type || '', msg); return; }
    document.getElementById('erpToastBody').textContent = msg;
    bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
  };
}

console.log('✅ Variance functions loaded successfully!');
