// ============================================================
// GEMCOR ERP — Monthly Usage Entry Logic
// ============================================================

var _usageState = {
  month: 12,
  year: 2026,
  template: [],
  parsedData: [],
  validRows: [],
  errorRows: []
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Usage Entry] Initializing...');
  usageCheckHealth();
  
  // Month/Year change handlers
  document.getElementById('entryMonth').addEventListener('change', function() {
    _usageState.month = parseInt(this.value);
    usageUpdateTemplateStatus();
  });
  document.getElementById('entryYear').addEventListener('change', function() {
    _usageState.year = parseInt(this.value);
    usageUpdateTemplateStatus();
  });
});

async function usageCheckHealth() {
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

function usageUpdateTemplateStatus() {
  var statusEl = document.getElementById('templateStatus');
  if (!statusEl) return;
  var monthName = _usageGetMonthName(_usageState.month);
  statusEl.innerHTML = '<i class="bi bi-info-circle me-1"></i>' +
    'Ready to download template for <strong>' + monthName + ' ' + _usageState.year + '</strong>';
}

function _usageGetMonthName(month) {
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  return months[month - 1] || '';
}

// ═══════════════════════════════════════════════════════════
// DOWNLOAD TEMPLATE
// ═══════════════════════════════════════════════════════════
async function erpDownloadTemplate() {
  var btn = document.getElementById('btnDownloadTemplate');
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Generating...';
  
  try {
    // Fetch all active items
    var rows = await erpFetch('erp_items',
      'select=item_code,description&is_active=eq.true&order=item_code.asc&limit=5000');
    
    if (!rows || rows.length === 0) {
      erpUsageToast('No items found', 'warning');
      return;
    }
    
    // Fetch existing usage for selected month/year
    var existingRows = await erpFetch('erp_item_usage',
      'select=item_code,quantity&year=eq.' + _usageState.year + 
      '&month=eq.' + _usageState.month + '&limit=5000');
    
    var existingMap = {};
    (existingRows || []).forEach(function(r) {
      existingMap[r.item_code] = Number(r.quantity || 0);
    });
    
    // Build CSV
    var csvLines = [];
    csvLines.push('item_code,description,quantity');
    
    rows.forEach(function(it) {
      var code = it.item_code || '';
      var desc = String(it.description || '').replace(/"/g, '""');
      var existing = existingMap[code] || 0;
      
      // Quote description if may comma
      var descField = desc.indexOf(',') !== -1 ? '"' + desc + '"' : desc;
      
      csvLines.push(code + ',' + descField + ',' + (existing > 0 ? existing : ''));
    });
    
    var csv = csvLines.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'usage_' + _usageState.year + '_' + 
                    String(_usageState.month).padStart(2, '0') + '.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    var monthName = _usageGetMonthName(_usageState.month);
    document.getElementById('templateStatus').innerHTML = 
      '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>' +
      'Downloaded: <strong>' + rows.length + ' items</strong> for ' +
      monthName + ' ' + _usageState.year + '</span>';
    
    erpUsageToast('✅ Template downloaded: ' + rows.length + ' items', 'success');
    
  } catch(err) {
    console.error('[erpDownloadTemplate]', err);
    erpUsageToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ═══════════════════════════════════════════════════════════
// HANDLE CSV UPLOAD
// ═══════════════════════════════════════════════════════════
function erpHandleCsvUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  
  document.getElementById('uploadStatus').innerHTML = 
    '<span class="text-muted"><i class="bi bi-hourglass-split me-1"></i>Parsing...</span>';
  
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      console.log('[CSV Parsed]', results);
      _usageState.parsedData = results.data;
      erpProcessParsedData(results.data);
    },
    error: function(err) {
      console.error('[CSV Error]', err);
      document.getElementById('uploadStatus').innerHTML = 
        '<span class="text-danger"><i class="bi bi-x-circle-fill me-1"></i>' +
        'Failed to parse: ' + err.message + '</span>';
    }
  });
}

async function erpProcessParsedData(data) {
  // Fetch items for validation
  var items = await erpFetch('erp_items',
    'select=item_code,description&is_active=eq.true&limit=5000');
  
  var itemMap = {};
  (items || []).forEach(function(it) {
    itemMap[it.item_code] = it;
  });
  
  var valid = [];
  var errors = [];
  var zeroRows = [];
  
  (data || []).forEach(function(row) {
    var code = String(row.item_code || '').trim();
    var qtyRaw = String(row.quantity || '').trim();
    var qty = parseFloat(qtyRaw) || 0;
    
    if (!code) {
      errors.push({ item_code: '(blank)', quantity: qtyRaw, error: 'Missing item code' });
      return;
    }
    
    if (!itemMap[code]) {
      errors.push({ item_code: code, quantity: qtyRaw, error: 'Item not found in inventory' });
      return;
    }
    
    if (qty < 0) {
      errors.push({ item_code: code, quantity: qtyRaw, error: 'Negative quantity' });
      return;
    }
    
    if (qty === 0) {
      zeroRows.push({
        item_code: code,
        description: itemMap[code].description,
        quantity: 0
      });
      return;
    }
    
    valid.push({
      item_code: code,
      description: itemMap[code].description,
      quantity: qty
    });
  });
  
  _usageState.validRows = valid;
  _usageState.errorRows = errors;
  
  // Update counts
  document.getElementById('previewValidCount').textContent = valid.length;
  document.getElementById('previewErrorCount').textContent = errors.length;
  document.getElementById('previewZeroCount').textContent = zeroRows.length;
  document.getElementById('previewTotalCount').textContent = data.length;
  
  // Render preview
  erpRenderPreview(valid, errors, zeroRows);
  
  // Show preview section
  document.getElementById('previewSection').classList.remove('d-none');
  
  document.getElementById('uploadStatus').innerHTML = 
    '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>' +
    'Parsed: ' + data.length + ' rows</span>';
  
  // Scroll to preview
  document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
}

function erpRenderPreview(valid, errors, zeroRows) {
  var tbody = document.getElementById('previewTableBody');
  var html = '';
  
  // Valid rows first
  valid.slice(0, 50).forEach(function(row) {
    html += '<tr>' +
      '<td><code>' + erpEsc(row.item_code) + '</code></td>' +
      '<td class="desc-cell">' + erpEsc(row.description) + '</td>' +
      '<td class="text-end">' + erpNum(row.quantity) + '</td>' +
      '<td class="text-center"><span class="badge bg-success">OK</span></td>' +
      '</tr>';
  });
  
  // Show first 50 ng valid
  if (valid.length > 50) {
    html += '<tr><td colspan="4" class="text-center text-muted py-3">' +
      '... and ' + (valid.length - 50) + ' more valid rows</td></tr>';
  }
  
  // Errors
  if (errors.length > 0) {
    html += '<tr><td colspan="4" class="bg-danger text-white fw-bold py-2">' +
      '⚠ ' + errors.length + ' ERRORS</td></tr>';
    errors.slice(0, 20).forEach(function(row) {
      html += '<tr style="background:#fee2e2;">' +
        '<td><code>' + erpEsc(row.item_code) + '</code></td>' +
        '<td class="text-danger">' + erpEsc(row.error) + '</td>' +
        '<td class="text-end">' + erpEsc(row.quantity) + '</td>' +
        '<td class="text-center"><span class="badge bg-danger">ERROR</span></td>' +
        '</tr>';
    });
    if (errors.length > 20) {
      html += '<tr><td colspan="4" class="text-center text-danger py-2">' +
        '... and ' + (errors.length - 20) + ' more errors</td></tr>';
    }
  }
  
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// CANCEL IMPORT
// ═══════════════════════════════════════════════════════════
function erpCancelImport() {
  if (!confirm('Cancel this import?')) return;
  
  document.getElementById('previewSection').classList.add('d-none');
  document.getElementById('csvFileInput').value = '';
  document.getElementById('uploadStatus').innerHTML = '';
  _usageState.parsedData = [];
  _usageState.validRows = [];
  _usageState.errorRows = [];
}

// ═══════════════════════════════════════════════════════════
// CONFIRM IMPORT (placeholder - Session C)
// ═══════════════════════════════════════════════════════════
async function erpConfirmImport() {
  erpUsageToast('Import function — coming in Session C', 'info');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function erpUsageToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 });
  toast.show();
}

console.log('✅ usage-entry.js loaded');
