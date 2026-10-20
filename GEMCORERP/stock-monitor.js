// ============================================================
// GEMCOR ERP — Stock Monitor Logic (v3)
// Phase 4: Inline Edit + Lock Toggle + CSV Import
// ============================================================
var _erpAllItems = [];
var _erpFilteredItems = [];
var _erpCurrentPage = 1;
var _erpPageSize = 50;
var _erpCharts = { category: null, abc: null, movement: null };
var _erpSearchTimer = null;

// Phase 4 state
var _editCellContext = null;
var _csvImportData = null;

// ✅ NEW: SOF Allocated Map (item_code → allocated qty)
var _erpSofAllocatedMap = {};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[ERP] Stock Monitor v3 initializing...');
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
  if (subEl) {
    subEl.textContent = (s.active_items || 0) + ' with stock';
  }
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
  var tbody = document.getElementById('erpTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="17" class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading inventory...</div></td></tr>';
  
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
    tbody.innerHTML = '<tr><td colspan="17" class="erp-empty text-danger">' +
      '<i class="bi bi-exclamation-triangle-fill"></i> ' + erpEsc(result.error) + '</td></tr>';
    return;
  }
  
  _erpAllItems = result.items || [];
  _erpFilteredItems = _erpAllItems.slice();
  _erpCurrentPage = 1;

  // Fetch SOF allocated qty per item
  try {
    var sofRes = await erpFetch('erp_v_sof_allocated_per_item', 'select=*');
    _erpSofAllocatedMap = {};
    (sofRes || []).forEach(function(sof) {
      _erpSofAllocatedMap[sof.item_code] = Number(sof.total_remaining_qty || 0);
    });
  } catch(sofErr) {
    console.warn('[Stock Monitor] SOF allocation fetch failed:', sofErr.message);
    _erpSofAllocatedMap = {};
  }

  // ✅ NEW: Fetch Latest Variances
  window._erpVarianceMap = {};
  try {
    var varRes = await erpFetch('erp_v_latest_item_variances', 'select=*');
    (varRes || []).forEach(function(v) {
      window._erpVarianceMap[v.item_code] = Number(v.variance_qty || 0);
    });
    
    // Update KPI Card
    var varKpi = document.getElementById('kpiVariances');
    if (varKpi) varKpi.textContent = Object.keys(window._erpVarianceMap).length;

  } catch(e) { 
    console.warn('Variance fetch failed', e); 
  }
  
  erpRenderTable();
}
function erpRenderTable() {
  var tbody = document.getElementById('erpTableBody');
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
    tbody.innerHTML = '<tr><td colspan="18" class="erp-empty">' +
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

    // SOF Allocated
    var sofAllocated = Number(_erpSofAllocatedMap[it.item_code] || 0);
    var available = onHand - sofAllocated;

    // Variance Check
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

    // HTML Row
    html += '<tr onclick="erpRowClick(event, \'' + safeCode + '\')" style="cursor:pointer;' + rowHighlightStyle + '">' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end ' + qtyClass + '">' + erpNum(onHand) + '</td>' +
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
      // ✅ BAGONG TD PARA SA VARIANCE
      '<td class="text-center">' + 
        (variance !== 0 ? '<span class="badge bg-warning text-dark" title="Variance: ' + variance + '"><i class="bi bi-exclamation-triangle-fill"></i> ' + (variance > 0 ? '+' : '') + variance + '</span>' : '<span class="text-muted">—</span>') +
      '</td>' +
      '<td class="text-center">' +
        '<button class="lock-toggle-btn ' + lockClass + '" ' +
          'onclick="event.stopPropagation();erpToggleLock(\'' + safeCode + '\', ' + isLocked + ')" ' +
          'title="' + (isLocked ? 'Unlock buffer (auto-recompute enabled)' : 'Lock buffer (manual value)') + '">' +
          '<i class="bi ' + lockIcon + '"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}
function erpPagePrev() {
  if (_erpCurrentPage > 1) {
    _erpCurrentPage--;
    erpRenderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function erpPageNext() {
  var total = _erpFilteredItems.length;
  var maxPage = Math.ceil(total / _erpPageSize);
  if (_erpCurrentPage < maxPage) {
    _erpCurrentPage++;
    erpRenderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ═══════════════════════════════════════════════════════════
// PHASE 4: INLINE EDIT MODAL
// ═══════════════════════════════════════════════════════════

window.erpOpenEditModal = function(itemCode, fieldName) {
  var item = _erpAllItems.find(function(it) { return it.item_code === itemCode; });
  if (!item) {
    erpShowToast('Item not found', 'warning');
    return;
  }
  
  var fieldLabels = {
    'on_hand': 'On-Hand Quantity',
    'unit_cost': 'Unit Cost (₱)',
    'buffer_stock': 'Buffer Stock'
  };
  
  var currentValues = {
    'on_hand': Number(item.on_hand || 0),
    'unit_cost': Number(item.unit_cost || 0),
    'buffer_stock': Number(item.buffer_stock || 0)
  };
  
  var currentValue = currentValues[fieldName];
  
  document.getElementById('editCellItemCode').textContent = item.item_code;
  document.getElementById('editCellFieldName').textContent = fieldLabels[fieldName] || fieldName;
  document.getElementById('editCellCurrentValue').value = currentValue;
  document.getElementById('editCellNewValue').value = currentValue;
  document.getElementById('editCellReason').value = '';
  document.getElementById('editCellWarning').style.display = 'none';
  
  _editCellContext = {
    item: item,
    itemCode: itemCode,
    fieldName: fieldName,
    currentValue: currentValue
  };
  
  var modalEl = document.getElementById('editCellModal');
  if (!modalEl) {
    erpShowToast('Edit modal not found', 'danger');
    return;
  }
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  setTimeout(function() {
    var input = document.getElementById('editCellNewValue');
    if (input) { input.focus(); input.select(); }
  }, 300);
};

window.erpSaveEditedCell = async function() {
  var context = _editCellContext;
  if (!context) return;
  
  var newValue = parseFloat(document.getElementById('editCellNewValue').value);
  var reason = document.getElementById('editCellReason').value.trim();
  
  if (isNaN(newValue) || newValue < 0) {
    erpShowToast('Invalid value (must be ≥ 0)', 'warning');
    return;
  }
  
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    document.getElementById('editCellReason').focus();
    return;
  }
  
  var currentValue = context.currentValue;
  var variance = Math.abs(newValue - currentValue);
  var variancePct = currentValue > 0 ? (variance / currentValue) * 100 : (newValue > 0 ? 100 : 0);
  
  if (variancePct > 50 && currentValue !== newValue) {
    var confirmMsg = '⚠️ Large change detected:\n\n' +
      'Item: ' + context.itemCode + '\n' +
      'Field: ' + context.fieldName + '\n' +
      'Current: ' + currentValue + '\n' +
      'New: ' + newValue + '\n' +
      'Variance: ' + variancePct.toFixed(1) + '%\n\n' +
      'Continue?';
    
    if (!confirm(confirmMsg)) return;
  }
  
  var editedBy = localStorage.getItem('ivm_userFullname') || 
                 localStorage.getItem('ivm_username') || 
                 'WAREHOUSE';
  
  try {
    var btn = document.getElementById('btnSaveEditCell');
    var originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
    
    var res = await fetch(erpUrl('rpc/erp_manual_edit_item'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_item_code: context.itemCode,
        p_field_name: context.fieldName,
        p_new_value: String(newValue),
        p_reason: reason,
        p_edited_by: editedBy
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      bootstrap.Modal.getInstance(document.getElementById('editCellModal')).hide();
      erpShowToast('✅ ' + context.fieldName + ' updated: ' + data.old_value + ' → ' + newValue, 'success');
      
      await erpLoadItems();
      await erpLoadSummary();
      
      setTimeout(function() {
        var row = document.querySelector('[data-item-code="' + context.itemCode + '"]');
        if (row) {
          row.classList.add('recently-edited');
          setTimeout(function() { row.classList.remove('recently-edited'); }, 3000);
        }
      }, 500);
    } else {
      erpShowToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  } catch(err) {
    console.error('[erpSaveEditedCell]', err);
    erpShowToast('Error: ' + err.message, 'danger');
    
    var btn2 = document.getElementById('btnSaveEditCell');
    if (btn2) {
      btn2.disabled = false;
      btn2.innerHTML = '<i class="bi bi-check-circle me-1"></i>Save Changes';
    }
  }
};

// ═══════════════════════════════════════════════════════════
// PHASE 4: LOCK TOGGLE
// ═══════════════════════════════════════════════════════════

window.erpToggleLock = async function(itemCode, currentLockState) {
  var newLockState = !currentLockState;
  var actionText = newLockState ? 'LOCK' : 'UNLOCK';
  
  if (!confirm(actionText + ' buffer stock for ' + itemCode + '?\n\n' +
    (newLockState 
      ? 'Locked: Manual value, walang auto-recompute' 
      : 'Unlocked: Auto-compute from usage'))) {
    return;
  }
  
  var editedBy = localStorage.getItem('ivm_userFullname') || 
                 localStorage.getItem('ivm_username') || 
                 'WAREHOUSE';
  
  try {
    var res = await fetch(erpUrl('rpc/erp_toggle_buffer_lock'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_item_code: itemCode,
        p_new_lock_state: newLockState,
        p_reason: (newLockState ? 'Manual lock' : 'Unlock for auto-recompute'),
        p_edited_by: editedBy
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      erpShowToast('✅ Buffer ' + (newLockState ? 'LOCKED' : 'UNLOCKED') + ': ' + itemCode, 'success');
      await erpLoadItems();
    } else {
      erpShowToast('Failed: ' + (data.error || 'Unknown'), 'danger');
    }
  } catch(err) {
    console.error('[erpToggleLock]', err);
    erpShowToast('Error: ' + err.message, 'danger');
  }
};

// ═══════════════════════════════════════════════════════════
// PHASE 4: CSV BULK IMPORT
// ═══════════════════════════════════════════════════════════

window.erpOpenCsvImport = function() {
  var modalEl = document.getElementById('csvImportModal');
  if (!modalEl) {
    erpShowToast('CSV Import modal not found', 'danger');
    return;
  }
  
  document.getElementById('csvFileInput').value = '';
  document.getElementById('csvImportReason').value = '';
  document.getElementById('csvStepUpload').style.display = 'block';
  document.getElementById('csvStepPreview').style.display = 'none';
  document.getElementById('csvStepResult').style.display = 'none';
  document.getElementById('btnCsvImport').style.display = 'none';
  _csvImportData = null;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
};

window.erpDownloadCsvTemplate = function() {
  if (!_erpAllItems || _erpAllItems.length === 0) {
    erpShowToast('No items loaded. Please refresh the page.', 'warning');
    return;
  }
  
  // ═══ CSV Header (may description na) ═══
  var csv = 'item_code,description,on_hand,unit_cost,buffer_stock\n';
  
  // ═══ ALL items (walang slice limit) ═══
  _erpAllItems.forEach(function(it) {
    var code = String(it.item_code || '').replace(/,/g, ' ');
    var desc = String(it.description || '').replace(/,/g, ' ').replace(/"/g, '""');
    var onHand = Number(it.on_hand || 0);
    var unitCost = Number(it.unit_cost || 0);
    var buffer = Number(it.buffer_stock || 0);
    
    // Quote description kung may comma
    var descField = desc.indexOf(',') !== -1 ? '"' + desc + '"' : desc;
    
    csv += code + ',' + descField + ',' + onHand + ',' + unitCost + ',' + buffer + '\n';
  });
  
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'inventory_import_template_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  
  erpShowToast('✅ Template downloaded: ' + _erpAllItems.length + ' items');
};
window.erpHandleCsvUpload = function(event) {
  var file = event.target.files[0];
  if (!file) return;
  
  var reader = new FileReader();
  reader.onload = function(e) {
    var csv = e.target.result;
    var lines = csv.split('\n').filter(function(l) { return l.trim(); });
    
    if (lines.length < 2) {
      erpShowToast('CSV is empty', 'warning');
      return;
    }
    
   var header = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
var itemCodeIdx = header.indexOf('item_code');
var descriptionIdx = header.indexOf('description');  // NEW
var onHandIdx = header.indexOf('on_hand');
var unitCostIdx = header.indexOf('unit_cost');
var bufferIdx = header.indexOf('buffer_stock');
    
    if (itemCodeIdx === -1) {
      erpShowToast('CSV must have "item_code" column', 'danger');
      return;
    }
    
    var data = [];
    var errors = [];
    
    for (var i = 1; i < lines.length; i++) {
      var parts = lines[i].split(',');
      var itemCode = parts[itemCodeIdx] ? parts[itemCodeIdx].trim() : '';
      
      if (!itemCode) continue;
      
     var row = { item_code: itemCode };
if (descriptionIdx !== -1 && parts[descriptionIdx]) {
  row.description = parts[descriptionIdx].trim().replace(/^"|"$/g, '');
}
if (onHandIdx !== -1 && parts[onHandIdx]) row.on_hand = parseFloat(parts[onHandIdx]) || 0;
if (unitCostIdx !== -1 && parts[unitCostIdx]) row.unit_cost = parseFloat(parts[unitCostIdx]) || 0;
if (bufferIdx !== -1 && parts[bufferIdx]) row.buffer_stock = parseFloat(parts[bufferIdx]) || 0;
      
      var existing = _erpAllItems.find(function(it) { return it.item_code === itemCode; });
      row._valid = !!existing;
      row._exists = !!existing;
      
      if (!existing) {
        errors.push({ item_code: itemCode, error: 'Item not found' });
      }
      
      data.push(row);
    }
    
    _csvImportData = {
      valid: data.filter(function(r) { return r._valid; }),
      errors: errors,
      total: data.length
    };
    
    var tbody = document.getElementById('csvPreviewBody');
    var html = '';
    
    data.slice(0, 50).forEach(function(row, idx) {
      var statusBadge = row._valid 
        ? '<span class="badge bg-success">VALID</span>' 
        : '<span class="badge bg-danger">NOT FOUND</span>';
      
     // Get item description (from CSV, or fallback sa _erpAllItems)
var itemDesc = row.description || '';
if (!itemDesc) {
  var existingItem = _erpAllItems.find(function(it) { return it.item_code === row.item_code; });
  itemDesc = existingItem ? existingItem.description : '—';
}

html += '<tr class="' + (row._valid ? 'valid' : 'invalid') + '">' +
  '<td>' + (idx + 1) + '</td>' +
  '<td><code>' + erpEsc(row.item_code) + '</code></td>' +
  '<td class="text-muted small">' + erpEsc(itemDesc.substring(0, 50)) + (itemDesc.length > 50 ? '…' : '') + '</td>' +
  '<td class="text-end">' + (row.on_hand != null ? erpNum(row.on_hand) : '—') + '</td>' +
  '<td class="text-end">' + (row.unit_cost != null ? erpPeso(row.unit_cost) : '—') + '</td>' +
  '<td class="text-end">' + (row.buffer_stock != null ? erpNum(row.buffer_stock) : '—') + '</td>' +
  '<td class="text-center">' + statusBadge + '</td>' +
  '</tr>';
    });
    
    tbody.innerHTML = html;
    
    document.getElementById('csvPreviewCount').textContent = data.length;
    document.getElementById('csvStepUpload').style.display = 'none';
    document.getElementById('csvStepPreview').style.display = 'block';
    document.getElementById('btnCsvImport').style.display = 'block';
  };
  
  reader.readAsText(file);
};

window.erpConfirmCsvImport = async function() {
  if (!_csvImportData) {
    erpShowToast('No data to import', 'warning');
    return;
  }
  
  var reason = document.getElementById('csvImportReason').value.trim();
  if (!reason) {
    erpShowToast('Reason is required for CSV import', 'warning');
    document.getElementById('csvImportReason').focus();
    return;
  }
  
  if (_csvImportData.valid.length === 0) {
    erpShowToast('No valid items to import', 'warning');
    return;
  }
  
  if (!confirm('Import ' + _csvImportData.valid.length + ' item(s)?')) return;
  
  var editedBy = localStorage.getItem('ivm_userFullname') || 
                 localStorage.getItem('ivm_username') || 
                 'WAREHOUSE';
  
  var btn = document.getElementById('btnCsvImport');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Importing...';
  
  try {
    var res = await fetch(erpUrl('rpc/erp_bulk_update_items'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_items: _csvImportData.valid,
        p_edited_by: editedBy,
        p_reason: reason
      })
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    if (data && data.success) {
      document.getElementById('csvStepPreview').style.display = 'none';
      document.getElementById('csvStepResult').style.display = 'block';
      document.getElementById('csvResultSummary').innerHTML =
        'Success: <strong>' + data.success_count + '</strong> | ' +
        'Errors: <strong>' + data.error_count + '</strong> | ' +
        'Total: <strong>' + data.total_processed + '</strong>';
      
      document.getElementById('btnCsvImport').style.display = 'none';
      
      await erpLoadItems();
      await erpLoadSummary();
    } else {
      erpShowToast('Import failed: ' + (data.error || 'Unknown'), 'danger');
    }
    
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  } catch(err) {
    console.error('[erpConfirmCsvImport]', err);
    erpShowToast('Error: ' + err.message, 'danger');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

// ═══════════════════════════════════════════════════════════
// SEARCH + FILTERS
// ═══════════════════════════════════════════════════════════
function erpOnSearchInput() {
  clearTimeout(_erpSearchTimer);
  _erpSearchTimer = setTimeout(function() {
    erpLoadItems();
  }, 400);
}

function erpClearFilters() {
  document.getElementById('erpSearchInput').value = '';
  document.getElementById('erpCategoryFilter').value = '';
  document.getElementById('erpLocationFilter').value = '';
  document.getElementById('erpMovementFilter').value = '';
  document.getElementById('erpAbcFilter').value = '';
  erpLoadItems();
}

// ═══════════════════════════════════════════════════════════
// FILTER OPTIONS
// ═══════════════════════════════════════════════════════════
var ERP_CATEGORY_ORDER = [
  'COMPONENTS', 'CONSUMABLES', 'ENCLOSURE', 'EWMAT', 'FABMAT',
  'OFABP', 'PANEL', 'COGSLAB', 'COGSMAT', 'COGSOH',
  'FIXEDASSET', 'OPEX', 'OFFICE SUPPLIES', 'UNCATEGORIZED'
];

async function erpLoadFilterOptions() {
  try {
    var results = await Promise.all([
      erpGetDistinctValues('category'),
      erpGetDistinctValues('location')
    ]);
    
    if (results[0].success) {
      var sel = document.getElementById('erpCategoryFilter');
      var dbValues = results[0].values || [];
      var dbSet = {};
      dbValues.forEach(function(v) {
        if (v) dbSet[String(v).toUpperCase()] = v;
      });
      
      var finalCategories = [];
      var seen = {};
      
      ERP_CATEGORY_ORDER.forEach(function(cat) {
        var key = cat.toUpperCase();
        if (dbSet[key]) {
          finalCategories.push(dbSet[key]);
          seen[key] = true;
        }
      });
      
      dbValues.forEach(function(v) {
        if (!v) return;
        var key = String(v).toUpperCase();
        if (!seen[key]) {
          finalCategories.push(v);
          seen[key] = true;
        }
      });
      
      finalCategories.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      });
    }
    
    if (results[1].success) {
      var sel2 = document.getElementById('erpLocationFilter');
      results[1].values.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel2.appendChild(opt);
      });
    }
  } catch(err) {
    console.warn('[ERP] Filter options load failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// ITEM DETAILS MODAL (with movements)
// ═══════════════════════════════════════════════════════════

async function erpShowItemDetails(itemCode) {
  var modalEl = document.getElementById('erpItemModal');
  if (!modalEl) {
    console.warn('[erpShowItemDetails] Modal not found');
    return;
  }
  
  document.getElementById('erpModalTitle').textContent = itemCode;
  var body = document.getElementById('erpModalBody');
  body.innerHTML = '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading...</div></div>';
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  try {
    var detailResult = await erpGetItemDetails(itemCode);
    var movResult = await erpGetItemMovements(itemCode, 20);
    
    if (!detailResult.success) {
      body.innerHTML = '<div class="text-danger">' + erpEsc(detailResult.error) + '</div>';
      return;
    }
    
    var item = detailResult.item;
    var movements = movResult.success ? movResult.movements : [];
    
    var html = '';
    
    // Basic info grid
    html += '<div class="erp-item-detail">';
    html += '<div class="detail-row"><span class="detail-label">Item Code</span><span class="detail-value"><code>' + erpEsc(item.item_code) + '</code></span></div>';
    html += '<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">' + erpEsc(item.category || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Location</span><span class="detail-value">' + erpEsc(item.location || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Base Unit</span><span class="detail-value">' + erpEsc(item.base_unit || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">On-Hand</span><span class="detail-value">' + erpNum(item.on_hand) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Buffer Stock</span><span class="detail-value">' + erpNum(item.buffer_stock) + (item.buffer_is_locked ? ' <i class="bi bi-lock-fill text-danger" title="Locked"></i>' : '') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Reorder Point</span><span class="detail-value">' + erpNum(item.reorder_point) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Unit Cost</span><span class="detail-value">' + erpPeso(item.unit_cost) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Total Value</span><span class="detail-value">' + erpPeso(Number(item.on_hand || 0) * Number(item.unit_cost || 0)) + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">ABC Class</span><span class="detail-value">' + erpEsc(item.abc_classification || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Movement</span><span class="detail-value">' + erpEsc(item.inventory_movement || '—') + '</span></div>';
    html += '<div class="detail-row"><span class="detail-label">Stock Class</span><span class="detail-value">' + erpEsc(item.stock_classification || '—') + '</span></div>';
    html += '</div>';
    
    // Description
    html += '<div class="erp-section-title">Description</div>';
    html += '<div style="padding:12px;background:#f8fafc;border-radius:8px;font-size:0.9rem;">' + erpEsc(item.description || '—') + '</div>';
    
    // Movement history (In/Out)
    if (movements.length > 0) {
      html += '<div class="erp-section-title">Recent Movements (' + movements.length + ')</div>';
      html += '<div class="table-responsive"><table class="table table-sm" style="font-size:0.82rem;">';
      html += '<thead><tr>' +
        '<th>Date</th>' +
        '<th>Type</th>' +
        '<th>Reference</th>' +
        '<th class="text-end" style="color:#10b981;">In</th>' +
        '<th class="text-end" style="color:#dc2626;">Out</th>' +
        '<th class="text-end">Balance</th>' +
        '</tr></thead>';
      html += '<tbody>';
      movements.forEach(function(m) {
        var date = m.transaction_date ? new Date(m.transaction_date).toLocaleDateString() : '—';
        html += '<tr>' +
          '<td>' + erpEsc(date) + '</td>' +
          '<td><span class="badge bg-secondary">' + erpEsc(m.transaction_type) + '</span></td>' +
          '<td><code style="font-size:0.72rem;">' + erpEsc(m.reference_doc || '—') + '</code></td>' +
          '<td class="text-end text-success fw-bold">' + (Number(m.qty_in) > 0 ? '+' + erpNum(m.qty_in) : '—') + '</td>' +
          '<td class="text-end text-danger fw-bold">' + (Number(m.qty_out) > 0 ? '−' + erpNum(m.qty_out) : '—') + '</td>' +
          '<td class="text-end"><strong>' + erpNum(m.balance_after) + '</strong></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="erp-section-title">Movements</div>';
      html += '<div class="erp-empty">No movement history yet.</div>';
    }
    
    window._currentItemDetails = item;
    body.innerHTML = html;
  } catch(err) {
    console.error('[erpShowItemDetails]', err);
    body.innerHTML = '<div class="text-danger">Failed to load: ' + erpEsc(err.message) + '</div>';
  }
}
// ═══════════════════════════════════════════════════════════
// REORDER MODAL
// ═══════════════════════════════════════════════════════════
async function erpShowReorderModal() {
  var modalEl = document.getElementById('erpReorderModal');
  if (!modalEl) return;
  
  var body = document.getElementById('erpReorderBody');
  body.innerHTML = '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading reorder list...</div></div>';
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  
  var result = await erpGetReorderList();
  if (!result.success) {
    body.innerHTML = '<div class="text-danger">' + erpEsc(result.error) + '</div>';
    return;
  }
  
  var items = result.items || [];
  if (items.length === 0) {
    body.innerHTML = '<div class="erp-empty"><i class="bi bi-check-circle fs-1 text-success d-block mb-2"></i>No items need reordering. All stock levels are healthy!</div>';
    return;
  }
  
  var html = '<div class="alert alert-warning small"><i class="bi bi-info-circle me-1"></i>' +
    '<strong>' + items.length + ' items</strong> need replenishment. This is your Purchase Request (PR) list.</div>';
  
  html += '<div class="table-responsive"><table class="erp-reorder-table">';
  html += '<thead><tr>' +
    '<th>Item Code</th><th>Description</th><th>Location</th>' +
    '<th class="text-end">On-Hand</th>' +
    '<th class="text-end">Buffer</th>' +
    '<th class="text-end">Reorder Pt</th>' +
    '<th class="text-center">Suggest Qty</th>' +
    '<th class="text-center">Urgency</th>' +
    '</tr></thead><tbody>';
  
  items.forEach(function(it) {
    html += '<tr>' +
      '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
      '<td>' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-end text-danger"><strong>' + erpNum(it.on_hand) + '</strong></td>' +
      '<td class="text-end">' + erpNum(it.buffer_stock) + '</td>' +
      '<td class="text-end">' + erpNum(it.reorder_point) + '</td>' +
      '<td class="text-center"><strong>' + erpNum(it.qty_needed) + '</strong></td>' +
      '<td class="text-center"><span class="urgency-' + erpEsc(it.urgency) + '">' + erpEsc(it.urgency) + '</span></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  
  body.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// REFRESH ALL
// ═══════════════════════════════════════════════════════════
async function erpRefreshAll() {
  if (typeof erpClearCache === 'function') erpClearCache();
  erpShowToast('Refreshing all data...');
  await erpLoadDashboard();
  erpCheckHealth();
  erpShowToast('✅ Data refreshed');
}

function erpShowToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) return;
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 });
  toast.show();
}

// ═══════════════════════════════════════════════════════════
// OUT OF STOCK MODAL
// ═══════════════════════════════════════════════════════════
var _outOfStockAll = [];
var _outOfStockFiltered = [];

async function erpShowOutOfStockModal() {
  var modalEl = document.getElementById('erpOutOfStockModal');
  if (!modalEl) return;
  
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  var tbody = document.getElementById('outOfStockBody');
  
  tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
    '<div class="erp-spinner"></div>' +
    '<div class="mt-2">Loading zero-stock items...</div></td></tr>';
  
  modal.show();
  
  try {
    var rows = await erpFetch('erp_items',
      'select=item_code,description,category,location,on_hand,buffer_stock,ave_monthly_consumption,active_consumption_months,stock_classification,abc_classification,inventory_movement' +
      '&is_active=eq.true' +
      '&is_deleted=eq.false' +
      '&is_deprecated_2026=eq.false' +
      '&on_hand=eq.0' +
      '&order=item_code.asc&limit=5000');
    
    _outOfStockAll = rows || [];
    
    document.getElementById('outOfStockCount').textContent = _outOfStockAll.length;
    erpFilterOutOfStock();
  } catch(err) {
    console.error('[erpShowOutOfStockModal]', err);
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty text-danger">' +
      'Failed to load: ' + erpEsc(err.message) + '</td></tr>';
  }
}

function erpFilterOutOfStock() {
  var filter = document.getElementById('outOfStockFilter').value;
  var search = (document.getElementById('outOfStockSearch').value || '').toLowerCase().trim();
  
  _outOfStockFiltered = _outOfStockAll.filter(function(it) {
    var activeMo = Number(it.active_consumption_months || 0);
    
    if (filter === 'standard' && activeMo < 4) return false;
    if (filter === 'no-usage' && activeMo > 0) return false;
    
    if (search) {
      var code = String(it.item_code || '').toLowerCase();
      var desc = String(it.description || '').toLowerCase();
      if (code.indexOf(search) === -1 && desc.indexOf(search) === -1) return false;
    }
    
    return true;
  });
  
  erpRenderOutOfStock();
}

function erpRenderOutOfStock() {
  var tbody = document.getElementById('outOfStockBody');
  if (!tbody) return;
  
  document.getElementById('outOfStockCount').textContent = _outOfStockFiltered.length;
  
  if (_outOfStockFiltered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No items match your filters.</td></tr>';
    return;
  }
  
  var html = '';
  _outOfStockFiltered.forEach(function(it) {
    var activeMo = Number(it.active_consumption_months || 0);
    var buffer = Number(it.buffer_stock || 0);
    var aveMo = Number(it.ave_monthly_consumption || 0);
    
    var statusBadge = '';
    if (buffer > 0) {
      statusBadge = '<span class="reorder-badge reorder-critical">FOR REPLENISHMENT</span>';
    } else if (activeMo >= 1) {
      statusBadge = '<span class="reorder-badge reorder-new">NEW</span>';
    } else {
      statusBadge = '<span class="reorder-badge reorder-none">NO USAGE</span>';
    }
    
 var safeCode = String(it.item_code || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
html += '<tr onclick="erpRowClick(event, \'' + safeCode + '\')" style="cursor:pointer;">' +
  '<td><code>' + erpEsc(it.item_code) + '</code></td>' +
  '<td class="desc-cell">' + erpEsc(it.description || '—') + '</td>' +
      '<td>' + erpEsc(it.category || '—') + '</td>' +
      '<td>' + erpEsc(it.location || '—') + '</td>' +
      '<td class="text-center qty-zero">0</td>' +
      '<td class="text-end">' + erpNum(buffer) + '</td>' +
      '<td class="text-center">' + erpNum(aveMo) + '</td>' +
      '<td class="text-center">' + activeMo + '</td>' +
      '<td class="text-center">' + statusBadge + '</td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

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
  
  // Close Item Details modal first
  var detailsModal = document.getElementById('erpItemModal');
  if (detailsModal) {
    var m = bootstrap.Modal.getInstance(detailsModal);
    if (m) m.hide();
  }
  
  // Slight delay then open Edit modal
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
  
  // Fetch fresh data from DB
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
  
  // ═══ BASIC INFO ═══
  document.getElementById('editItemCode').value = data.item_code || '';
  document.getElementById('editItemCodeDisplay').textContent = data.item_code || '—';
  document.getElementById('editItemDesc').value = data.description || '';
  document.getElementById('editItemCategory').value = data.category || 'UNCATEGORIZED';
  document.getElementById('editItemLocation').value = data.location || '';
  
  // ═══ STOCK & PRICING (BAGO) ═══
  var onHandEl = document.getElementById('editItemOnHand');
  if (onHandEl) onHandEl.value = data.on_hand != null ? data.on_hand : 0;
  
  document.getElementById('editItemCost').value = data.unit_cost != null ? data.unit_cost : 0;
  
  var bufferEl = document.getElementById('editItemBufferStock');
  if (bufferEl) {
    bufferEl.value = data.buffer_stock != null ? data.buffer_stock : 0;
    bufferEl.setAttribute('readonly', 'readonly');
  }
  
  // Buffer lock indicator
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
  
  // ═══ STATUS ═══
  document.getElementById('editItemStatus').value = data.is_active ? 'true' : 'false';
  
  // ═══ READ-ONLY INFO ═══
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
  
  // ═══ REASON (reset) ═══
  var reasonEl = document.getElementById('editItemReason');
  if (reasonEl) reasonEl.value = '';
  
  // ═══ DEACTIVATE BUTTON ═══
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

// ═══════════════════════════════════════════════════════════
// TOGGLE BUFFER LOCK SA EDIT MODAL
// ═══════════════════════════════════════════════════════════

window.erpToggleEditBufferLock = function() {
  var bufferEl = document.getElementById('editItemBufferStock');
  var lockIcon = document.getElementById('editItemBufferLockIcon');
  var lockText = document.getElementById('editItemBufferLockText');
  var lockBtn = document.getElementById('editItemBufferLock');
  var hintEl = document.getElementById('editItemBufferHint');
  
  if (!bufferEl) return;
  
  var isCurrentlyReadonly = bufferEl.hasAttribute('readonly');
  
  if (isCurrentlyReadonly) {
    // UNLOCK → edit mode
    bufferEl.removeAttribute('readonly');
    bufferEl.focus();
    bufferEl.select();
    
    if (lockIcon) lockIcon.className = 'bi bi-unlock me-1';
    if (lockText) lockText.textContent = 'Unlocked';
    if (lockBtn) lockBtn.className = 'btn btn-sm btn-outline-success';
    if (hintEl) hintEl.innerHTML = '<i class="bi bi-pencil-fill text-success me-1"></i>Editing — pwede mo nang baguhin';
  } else {
    // LOCK → read-only
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
  
  // ═══ COLLECT ALL FIELDS ═══
  var code = document.getElementById('editItemCode').value;
  var desc = (document.getElementById('editItemDesc').value || '').trim();
  var category = (document.getElementById('editItemCategory').value || '').trim();
  var location = (document.getElementById('editItemLocation').value || '').trim();
  
  // Stock & Pricing
  var onHandRaw = document.getElementById('editItemOnHand') ? document.getElementById('editItemOnHand').value : '';
  var onHand = onHandRaw !== '' ? parseFloat(onHandRaw) : null;
  
  var costRaw = (document.getElementById('editItemCost').value || '').trim();
  var cost = costRaw !== '' ? parseFloat(costRaw) : null;
  
  var bufferRaw = document.getElementById('editItemBufferStock') ? document.getElementById('editItemBufferStock').value : '';
  var buffer = bufferRaw !== '' ? parseFloat(bufferRaw) : null;
  
  var reorderRaw = document.getElementById('editItemReorderPoint') ? document.getElementById('editItemReorderPoint').value : '';
  var reorder = reorderRaw !== '' ? parseFloat(reorderRaw) : null;
  
  // Status
  var statusRaw = document.getElementById('editItemStatus').value;
  var isActive = statusRaw === 'true';
  
  // Reason
  var reason = (document.getElementById('editItemReason').value || '').trim();
  
  // ═══ VALIDATION ═══
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
  
  // ═══ CHECK IF MAY CHANGES ═══
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
  
  // ═══ REQUIRE REASON IF MAY CHANGES ═══
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
    // ═══ Save via new RPC ═══
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
    
    // Refresh
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
// Opens item details, but ignores clicks on editable cells/buttons
// ═══════════════════════════════════════════════════════════

window.erpRowClick = function(event, itemCode) {
  // Check if click was on editable cell or button
  var target = event.target;
  
  // Ignore if clicked on editable cell (bubbles to row)
  if (target.closest('.editable-cell')) {
    return; // Editable cell has its own handler
  }
  
  // Ignore if clicked on lock button
  if (target.closest('.lock-toggle-btn')) {
    return; // Lock button has its own handler
  }
  
  // Ignore if clicked on checkbox or button
  if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'A') {
    return;
  }
  
  // Ignore if inside an action cell (last column)
  if (target.closest('td:last-child')) {
    return;
  }
  
  // Open item details
  erpShowItemDetails(itemCode);
};

console.log('✅ stock-monitor.js v3 loaded — Phase 4 (Inline Edit + Lock + CSV)');

// ═══════════════════════════════════════════════════════════
// BULK BUFFER LOCK/UNLOCK
// ═══════════════════════════════════════════════════════════
window.erpBulkLockBuffer = async function(isLocked) {
  var action = isLocked ? 'LOCK' : 'UNLOCK';
  if (!confirm('Are you sure you want to ' + action + ' ALL active buffer stocks?\n\nThis will affect all items in the database.')) return;

  erpShowToast('Processing bulk ' + action + '...', 'info');
  
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
      erpShowToast(`✅ ${action}ED ${data.updated} items successfully!`, 'success');
      await erpLoadItems(); // Refresh table
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch(err) {
    console.error('[erpBulkLockBuffer]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
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
    // Kukunin lahat ng naka-soft delete
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
    
    erpShowToast('✅ Item restored successfully!', 'success');
    
    // I-refresh ang deactivated list at main table
    erpOpenDeactivatedModal(); 
    erpLoadItems();
    
  } catch(err) {
    console.error('[erpRestoreItem]', err);
    erpShowToast('Failed to restore: ' + err.message, 'danger');
  }
};
