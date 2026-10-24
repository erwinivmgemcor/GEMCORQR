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
// Add + Update ng items (HINDI nagbubura). Para sa starting inventory ng buwan.
// Ang on_hand ay dumadaan sa Stock Ledger (ADJUSTMENT) kaya may opening balance sa Item In & Out.
// Blank na cell = huwag galawin ang existing na value.
var _CSV_HEADERS = ['Item Code', 'Description', 'Category', 'Location', 'On-Hand', 'Buffer', 'Unit', 'Unit Cost', 'Active Mo', 'Ave/Mo', 'Ave/Day', 'ABC', 'Movement'];

function _csvDefaultStartMonth() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  if (now.getDate() >= 20) { m++; if (m > 12) { m = 1; y++; } }
  return y + '-' + (m < 10 ? '0' + m : m);
}

function erpOpenCsvImport() {
  _csvImportData = null;
  document.getElementById('csvStepUpload').style.display = '';
  document.getElementById('csvStepPreview').style.display = 'none';
  document.getElementById('csvStepResult').style.display = 'none';
  document.getElementById('btnCsvImport').style.display = 'none';
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvImportReason').value = '';
  var sm = document.getElementById('csvStartMonth');
  if (sm && !sm.value) sm.value = _csvDefaultStartMonth();
  var lk = document.getElementById('csvLockBuffer');
  if (lk) lk.checked = false;
  var st = document.getElementById('csvUploadStatus');
  if (st) st.innerHTML = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('csvImportModal')).show();
}

function erpDownloadCsvTemplate() {
  var csv = '\uFEFF' + _CSV_HEADERS.join(',') + '\n' +
    'GEM-XXX,Sample item description,CONSUMABLES,GEMCATM001,100,35,PIECE,12.50,4,20,0.67,B,MODERATE MOVING\n';
  var link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  link.download = 'stock_import_template.csv';
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// Full-file parser: BOM, quoted cells na may comma/line-break, CRLF, auto-detect ng delimiter.
function _csvParse(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  var first = text.split(/\r\n|\n|\r/)[0] || '';
  var counts = { ',': 0, ';': 0, '\t': 0 }, q0 = false;
  for (var k = 0; k < first.length; k++) {
    var ch = first[k];
    if (ch === '"') q0 = !q0;
    else if (!q0 && counts[ch] !== undefined) counts[ch]++;
  }
  var delim = ',';
  if (counts[';'] > counts[delim]) delim = ';';
  if (counts['\t'] > counts[delim]) delim = '\t';

  var rows = [], row = [], cur = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur.trim()); cur = '';
      if (row.some(function(x) { return x !== ''; })) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur.trim());
  if (row.some(function(x) { return x !== ''; })) rows.push(row);
  return rows;
}

function _csvNormHeader(h) {
  return String(h || '').replace(/^\uFEFF/, '').toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
}

// Blank/"-"/"N/A" => null (hindi 0). Invalid text => NaN (error). Tumatanggap ng "1,234.50", "₱12".
function _csvNum(v) {
  if (v === undefined || v === null) return null;
  var t = String(v).trim();
  if (t === '' || t === '-' || t === '—' || /^n\/?a$/i.test(t)) return null;
  t = t.replace(/[₱$,\s%]/g, '');
  if (t === '') return null;
  var n = Number(t);
  return isNaN(n) ? NaN : n;
}

var _CSV_ALIASES = {
  item_code: ['item code', 'item_code', 'itemcode', 'code'],
  description: ['description', 'desc', 'item description'],
  category: ['category', 'cat'],
  location: ['location', 'loc'],
  on_hand: ['on-hand', 'on hand', 'on_hand', 'onhand', 'stock'],
  buffer_stock: ['buffer', 'buffer stock', 'buffer_stock'],
  base_unit: ['unit', 'base unit', 'base_unit', 'uom'],
  unit_cost: ['unit cost', 'unit_cost', 'unitcost', 'cost', 'price'],
  active_consumption_months: ['active mo', 'active mos', 'active_mo', 'active months', 'active month', 'active_consumption_months'],
  ave_monthly_consumption: ['ave/mo', 'ave_mo', 'ave mo', 'ave monthly', 'avg/mo', 'avg mo', 'average/mo', 'ave_monthly_consumption'],
  ave_daily_consumption: ['ave/day', 'ave_day', 'ave day', 'ave daily', 'avg/day', 'avg day', 'average/day', 'ave_daily_consumption'],
  abc_classification: ['abc', 'abc classification', 'abc_classification'],
  inventory_movement: ['movement', 'inventory movement', 'inventory_movement']
};

// Kunin lahat ng existing items (kasama ang naka-soft-delete) — hindi umaasa sa filter ng table
async function _csvFetchExisting() {
  var all = [], offset = 0, size = 1000, selectCols =
    'item_code,description,category,location,base_unit,on_hand,unit_cost,buffer_stock,' +
    'active_consumption_months,ave_monthly_consumption,ave_daily_consumption,' +
    'abc_classification,inventory_movement,is_deleted,baseline_from_ym';
  for (var page = 0; page < 30; page++) {
    var rows = await erpFetch('erp_items', 'select=' + selectCols + '&order=item_code.asc&limit=' + size + '&offset=' + offset);
    if (!rows || !rows.length) break;
    all = all.concat(rows);
    offset += rows.length;
    if (rows.length < size) break;
  }
  var map = {};
  all.forEach(function(it) { map[String(it.item_code).toLowerCase()] = it; });
  return map;
}

async function erpHandleCsvUpload(event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  var statusEl = document.getElementById('csvUploadStatus');
  var setStatus = function(html) { if (statusEl) statusEl.innerHTML = html; };
  setStatus('<div class="alert alert-info small py-2"><span class="spinner-border spinner-border-sm me-1"></span>Binabasa ang CSV...</div>');

  try {
    var rows = _csvParse(await file.text());
    if (rows.length < 2) { setStatus('<div class="alert alert-warning small py-2">Walang laman ang CSV (kailangan ng header + 1 row).</div>'); return; }

    var headerMap = {};
    rows[0].forEach(function(h, i) { var k = _csvNormHeader(h); if (headerMap[k] === undefined) headerMap[k] = i; });
    var col = {};
    Object.keys(_CSV_ALIASES).forEach(function(f) {
      col[f] = undefined;
      for (var a = 0; a < _CSV_ALIASES[f].length; a++) {
        if (headerMap[_CSV_ALIASES[f][a]] !== undefined) { col[f] = headerMap[_CSV_ALIASES[f][a]]; break; }
      }
    });
    if (col.item_code === undefined) {
      setStatus('<div class="alert alert-danger small py-2">Kailangan ng <b>Item Code</b> column. Nakita: ' + erpEsc(rows[0].join(' | ')) + '</div>');
      return;
    }

    var existing;
    try {
      existing = await _csvFetchExisting();
    } catch (e) {
      setStatus('<div class="alert alert-danger small py-2"><b>Hindi mabasa ang items:</b> ' + erpEsc(e.message || String(e)) +
        '<br>Kung "baseline_from_ym does not exist", i-run muna ang <code>FIX_NOVEMBER_START.sql</code> sa Supabase.</div>');
      return;
    }

    var txt = function(r, f) { return col[f] === undefined ? '' : String(r[col[f]] === undefined ? '' : r[col[f]]).trim(); };
    var numFields = ['on_hand', 'buffer_stock', 'unit_cost', 'active_consumption_months', 'ave_monthly_consumption', 'ave_daily_consumption'];
    var seen = {};
    _csvImportData = [];
    var counts = { add: 0, change: 0, same: 0, error: 0, dup: 0, reactivate: 0, warnBuf: 0 };

    rows.slice(1).forEach(function(r, n) {
      var code = txt(r, 'item_code');
      if (!code) return;
      var key = code.toLowerCase();
      var rec = {
        row: n + 2, code: code, status: '', msg: '', send: false,
        payload: { item_code: code }
      };

      if (seen[key]) { rec.status = 'DUPLICATE'; rec.msg = 'Doble ang Item Code — unang row lang ang gagamitin'; counts.dup++; _csvImportData.push(rec); return; }
      seen[key] = true;

      ['description', 'category', 'location', 'base_unit', 'abc_classification', 'inventory_movement'].forEach(function(f) {
        var v = txt(r, f);
        if (f === 'inventory_movement') v = v.toUpperCase();
        if (v !== '') rec.payload[f] = v;
      });
      var bad = [];
      numFields.forEach(function(f) {
        if (col[f] === undefined) return;
        var v = _csvNum(r[col[f]]);
        if (v === null) return;                       // blank → hindi gagalawin
        if (isNaN(v)) { bad.push(f + ' ("' + r[col[f]] + '" ay hindi numero)'); return; }
        if (v < 0) { bad.push(f + ' ay negatibo'); return; }
        rec.payload[f] = (f === 'active_consumption_months') ? Math.round(v) : v;
      });
      if (bad.length) { rec.status = 'ERROR'; rec.msg = bad.join('; '); counts.error++; _csvImportData.push(rec); return; }

      var p = rec.payload, it = existing[key];
      rec.item = it;
      if (p.buffer_stock !== undefined && p.ave_monthly_consumption === undefined && p.active_consumption_months === undefined) {
        counts.warnBuf++; rec.warn = true;
      }
      if (!it) {
        rec.status = 'ADD'; rec.send = true; counts.add++;
      } else if (it.is_deleted === true) {
        rec.status = 'REACTIVATE'; rec.send = true; counts.reactivate++;
      } else {
        var diffs = [];
        var eq = function(a, b) { return Math.abs(Number(a || 0) - Number(b || 0)) < 0.00001; };
        ['on_hand', 'buffer_stock', 'active_consumption_months', 'ave_monthly_consumption', 'ave_daily_consumption'].forEach(function(f) {
          if (p[f] !== undefined && !eq(p[f], it[f])) diffs.push(f);
        });
        if (p.unit_cost !== undefined && p.unit_cost !== 0 && !eq(p.unit_cost, it.unit_cost)) diffs.push('unit_cost');
        ['description', 'category', 'location', 'base_unit', 'abc_classification', 'inventory_movement'].forEach(function(f) {
          if (p[f] !== undefined && String(p[f]) !== String(it[f] || '')) diffs.push(f);
        });
        if ((p.ave_monthly_consumption !== undefined || p.active_consumption_months !== undefined) && it.baseline_from_ym == null) diffs.push('baseline');
        rec.changes = diffs;
        if (diffs.length) { rec.status = 'CHANGE'; rec.send = true; counts.change++; }
        else { rec.status = 'NO CHANGE'; counts.same++; }
      }
      _csvImportData.push(rec);
    });

    // Preview
    var badge = {
      'ADD': 'bg-success', 'REACTIVATE': 'bg-info text-dark', 'CHANGE': 'bg-warning text-dark',
      'NO CHANGE': 'bg-secondary', 'ERROR': 'bg-danger', 'DUPLICATE': 'bg-dark'
    };
    var html = '', shown = 0;
    _csvImportData.forEach(function(rec) {
      if (shown >= 500) return;
      shown++;
      var p = rec.payload, it = rec.item || {};
      var cell = function(f) {
        if (p[f] === undefined) return '<span class="text-muted">—</span>';
        var nv = erpNum(p[f]);
        if (rec.item && rec.status === 'CHANGE' && rec.changes && rec.changes.indexOf(f) !== -1)
          return '<span class="text-muted text-decoration-line-through">' + erpNum(it[f]) + '</span> → <b>' + nv + '</b>';
        return nv;
      };
      html += '<tr' + (rec.status === 'ERROR' ? ' class="table-danger"' : '') + '>' +
        '<td>' + rec.row + '</td><td><code>' + erpEsc(rec.code) + '</code></td>' +
        '<td>' + erpEsc(p.description || it.description || '—') + '</td>' +
        '<td>' + cell('on_hand') + '</td><td>' + cell('unit_cost') + '</td><td>' + cell('buffer_stock') + '</td>' +
        '<td>' + cell('ave_monthly_consumption') + '</td>' +
        '<td><span class="badge ' + badge[rec.status] + '">' + rec.status + '</span>' +
          (rec.warn ? ' <i class="bi bi-exclamation-triangle-fill text-warning" title="May Buffer pero walang Ave/Mo o Active Mo"></i>' : '') +
          (rec.msg ? '<div class="small text-danger">' + erpEsc(rec.msg) + '</div>' : '') + '</td></tr>';
    });
    if (_csvImportData.length > 500) {
      html += '<tr><td colspan="8" class="text-center text-muted small">Unang 500 lang ang ipinapakita — ang lahat ng ' + _csvImportData.length + ' row ay isasama sa import.</td></tr>';
    }
    document.getElementById('csvPreviewBody').innerHTML = html;
    document.getElementById('csvPreviewCount').textContent = _csvImportData.length;
    var sum = document.getElementById('csvPreviewSummary');
    if (sum) {
      sum.innerHTML =
        '<span class="badge bg-success me-1">ADD ' + counts.add + '</span>' +
        '<span class="badge bg-info text-dark me-1">REACTIVATE ' + counts.reactivate + '</span>' +
        '<span class="badge bg-warning text-dark me-1">CHANGE ' + counts.change + '</span>' +
        '<span class="badge bg-secondary me-1">NO CHANGE ' + counts.same + '</span>' +
        (counts.error ? '<span class="badge bg-danger me-1">ERROR ' + counts.error + '</span>' : '') +
        (counts.dup ? '<span class="badge bg-dark me-1">DUPLICATE ' + counts.dup + '</span>' : '') +
        (counts.warnBuf ? '<div class="small text-warning-emphasis mt-1"><i class="bi bi-exclamation-triangle-fill me-1"></i>' + counts.warnBuf +
          ' item ang may Buffer pero walang Ave/Mo o Active Mo — mare-recompute ang buffer nila sa unang MRIF maliban kung i-check ang "Lock imported Buffer".</div>' : '');
    }
    setStatus('');
    document.getElementById('csvStepUpload').style.display = 'none';
    document.getElementById('csvStepPreview').style.display = '';
    document.getElementById('btnCsvImport').style.display = '';
  } catch (err) {
    console.error('[erpHandleCsvUpload]', err);
    setStatus('<div class="alert alert-danger small py-2">Error: ' + erpEsc(err.message || String(err)) + '</div>');
  }
}

async function erpConfirmCsvImport() {
  var reason = (document.getElementById('csvImportReason').value || '').trim();
  if (!_csvImportData) return;
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    // nasa Step 1 ang reason field — bumalik doon kung nakatago
    document.getElementById('csvStepPreview').style.display = 'none';
    document.getElementById('csvStepUpload').style.display = '';
    document.getElementById('btnCsvImport').style.display = 'none';
    document.getElementById('csvImportReason').focus();
    return;
  }
  var todo = _csvImportData.filter(function(r) { return r.send; });
  if (!todo.length) { erpShowToast('Walang babaguhin', 'info'); return; }

  var startVal = (document.getElementById('csvStartMonth') || {}).value || _csvDefaultStartMonth();
  var startYm = parseInt(startVal.replace('-', ''), 10);
  if (!startYm || (startYm % 100) < 1 || (startYm % 100) > 12) { erpShowToast('Piliin ang tamang "First month of real usage"', 'warning'); return; }
  var lock = !!((document.getElementById('csvLockBuffer') || {}).checked);

  if (!confirm('Mag-i-import ng ' + todo.length + ' item(s).\n' +
    'Real usage starts: ' + startVal + '\nLock imported Buffer: ' + (lock ? 'YES' : 'NO') +
    '\n\nAng On-Hand ay itatala sa Stock Ledger. Walang item na buburahin.\nTuloy?')) return;

  var btn = document.getElementById('btnCsvImport');
  btn.disabled = true;
  var agg = { added: 0, updated: 0, errors: 0, details: [] };
  var CHUNK = 150;
  try {
    for (var i = 0; i < todo.length; i += CHUNK) {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>' + Math.min(i + CHUNK, todo.length) + ' / ' + todo.length;
      var items = todo.slice(i, i + CHUNK).map(function(r) {
        return lock ? Object.assign({}, r.payload, { lock_buffer: true }) : r.payload;
      });
      var res = await fetch(erpUrl('rpc/erp_bulk_import_items'), {
        method: 'POST', headers: erpHeaders(),
        body: JSON.stringify({ p_items: items, p_performed_by: _erpUser(), p_reason: 'CSV import: ' + reason, p_start_ym: startYm })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).substring(0, 300) +
        (res.status === 404 ? ' — i-run muna ang FIX_NOVEMBER_START.sql sa Supabase' : ''));
      var d = await res.json();
      if (!d || d.success === false) throw new Error((d && d.error) || 'Unknown error');
      agg.added += d.added || 0; agg.updated += d.updated || 0; agg.errors += d.errors || 0;
      (d.error_details || []).forEach(function(e) { agg.details.push(e.item_code + ': ' + e.error); });
    }
  } catch (err) {
    console.error('[erpConfirmCsvImport]', err);
    erpShowToast('Import stopped: ' + err.message, 'danger');
    agg.details.push('STOPPED: ' + err.message);
    agg.errors++;
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>Confirm Import';
  document.getElementById('csvStepPreview').style.display = 'none';
  document.getElementById('csvStepResult').style.display = '';
  btn.style.display = 'none';
  var out = agg.added + ' added, ' + agg.updated + ' updated, ' + agg.errors + ' failed.';
  document.getElementById('csvResultSummary').innerHTML = erpEsc(out) +
    (agg.details.length ? '<div class="text-start small text-danger mt-2" style="max-height:160px;overflow:auto;">' +
      agg.details.slice(0, 30).map(function(x) { return erpEsc(x); }).join('<br>') + '</div>' : '');
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
