// ============================================================
// GEMCOR ERP — Inventory Count (v1.0)
// SUM-based counting: scan → auto-add → variance
// ============================================================

var _ic = {
  // Sessions
  sessions: [],
  filteredSessions: [],

  // Current session
  currentSession: null,
  currentItems: [],
  filteredItems: [],

  // Scanner
  scanner: null,
  scannerActive: false,
  currentQtyItem: null,

  // Search
  searchTimer: null,

  // State
  isSubmitting: false,
  view: 'list'   // 'list' | 'counting' | 'review'
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Inventory Count v1.0] Initializing...');

  icCheckHealth();
  icLoadSessions();

  // Enter key on manual input
  var manualInput = document.getElementById('icManualInput');
  if (manualInput) {
    manualInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        icManualVerify();
      }
    });
  }

  // Enter key on qty input
  var qtyInput = document.getElementById('qtyInputValue');
  if (qtyInput) {
    qtyInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        icSaveCountedQty();
      }
    });
  }
});

async function icCheckHealth() {
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
// LOAD SESSIONS
// ═══════════════════════════════════════════════════════════
async function icLoadSessions() {
  var tbody = document.getElementById('icSessionBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
    '<div class="erp-spinner"></div><div class="mt-2">Loading sessions...</div></td></tr>';

  try {
    var rows = await erpFetch('erp_inventory_counts',
      'select=*&order=created_at.desc&limit=500');

    _ic.sessions = rows || [];
    console.log('[IC] Loaded', _ic.sessions.length, 'sessions');

    icRenderSessionList();
  } catch(err) {
    console.error('[icLoadSessions]', err);
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
      'Failed: ' + icEsc(err.message) + '</td></tr>';
  }
}

function icRenderSessionList() {
  var tbody = document.getElementById('icSessionBody');
  if (!tbody) return;

  var searchInput = document.getElementById('icSearchInput');
  var statusFilterEl = document.getElementById('icStatusFilter');
  var search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  var statusFilter = statusFilterEl ? statusFilterEl.value : '';

  _ic.filteredSessions = _ic.sessions.filter(function(s) {
    if (statusFilter && s.status !== statusFilter) return false;
    if (search) {
      var countNo = String(s.count_no || '').toLowerCase();
      var scope = String(s.scope_category || '').toLowerCase();
      if (countNo.indexOf(search) === -1 && scope.indexOf(search) === -1) return false;
    }
    return true;
  });

  var countEl = document.getElementById('icSessionCount');
  if (countEl) countEl.textContent = _ic.filteredSessions.length + ' sessions';

  if (_ic.filteredSessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>No count sessions found.</td></tr>';
    return;
  }

  var html = '';
  _ic.filteredSessions.forEach(function(s) {
    var dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var totalItems = s.total_items || 0;
    var countedItems = s.counted_items || 0;
    var progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

    var varianceCount = s.variance_count || 0;
    var varianceQty = Number(s.variance_total_qty || 0);
    var varianceDisplay = varianceQty === 0 ? '0' : (varianceQty > 0 ? '+' + icNum(varianceQty) : icNum(varianceQty));

    var statusClass = 'status-' + (s.status || 'DRAFT');
    var scope = s.scope_category || (s.count_type === 'FULL' ? 'All Items' : 'N/A');

    var safeId = s.id;

    html += '<tr>' +
      '<td><code>' + icEsc(s.count_no) + '</code></td>' +
      '<td>' + icEsc(dateStr) + '</td>' +
      '<td class="text-center"><span class="badge bg-secondary">' + icEsc(s.count_type || 'CYCLE') + '</span></td>' +
      '<td>' + icEsc(scope) + '</td>' +
      '<td class="text-center">' +
        '<div style="font-weight:700;font-size:0.9rem;">' + countedItems + ' / ' + totalItems + '</div>' +
        '<div class="progress" style="height:4px;margin-top:4px;">' +
          '<div class="progress-bar" style="width:' + progressPct + '%"></div>' +
        '</div>' +
      '</td>' +
      '<td class="text-center">' +
        '<span style="font-weight:700;color:' + (varianceCount > 0 ? '#dc2626' : '#059669') + ';">' +
          varianceCount + '</span>' +
      '</td>' +
      '<td class="text-center"><span class="status-badge-lg ' + statusClass + '">' + icEsc(s.status) + '</span></td>' +
      '<td class="text-center">' +
        '<button class="erp-action-btn primary" onclick="icOpenSession(' + safeId + ')" title="Open">' +
          '<i class="bi bi-play-circle"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="icViewSessionDetails(' + safeId + ')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// CREATE SESSION
// ═══════════════════════════════════════════════════════════
function openNewCountModal() {
  document.getElementById('newCountType').value = 'CYCLE';
  document.getElementById('newCountCategory').value = '';
  document.getElementById('newCountNotes').value = '';
  icOnCountTypeChange();

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('newCountModal'));
  modal.show();
}

window.openNewCountModal = openNewCountModal;

function icOnCountTypeChange() {
  var type = document.getElementById('newCountType').value;
  var catGroup = document.getElementById('newCountCategoryGroup');

  if (type === 'CYCLE') {
    catGroup.style.display = 'block';
  } else {
    catGroup.style.display = 'none';
  }
}

window.icOnCountTypeChange = icOnCountTypeChange;

// Add listener on modal load
document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'newCountType') {
    icOnCountTypeChange();
  }
});

async function icCreateSession() {
  if (_ic.isSubmitting) return;

  var type = document.getElementById('newCountType').value;
  var category = document.getElementById('newCountCategory').value;
  var notes = document.getElementById('newCountNotes').value.trim();

  if (type === 'CYCLE' && !category) {
    icShowToast('Please select a category', 'warning');
    return;
  }

  if (!confirm('Create new count session?\n\nType: ' + type + '\n' + (category ? 'Category: ' + category : 'Scope: All items'))) return;

  _ic.isSubmitting = true;
  var btn = document.getElementById('btnCreateCount');
  var originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
  }

  try {
    // Generate count_no
    var now = new Date();
    var yy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');

    // Get next sequence for this month
    var existingRows = await erpFetch('erp_inventory_counts',
      'select=count_no&count_no=like.IC-' + yy + '-' + mm + '-*&order=count_no.desc&limit=1');

    var nextNum = 1;
    if (existingRows && existingRows.length > 0) {
      var lastNo = existingRows[0].count_no;
      var parts = lastNo.split('-');
      var lastSeq = parseInt(parts[parts.length - 1]) || 0;
      nextNum = lastSeq + 1;
    }

    var countNo = 'IC-' + yy + '-' + mm + '-' + String(nextNum).padStart(3, '0');

    // Fetch items to snapshot
    var itemsQuery = 'select=item_code,description,category,base_unit,on_hand' +
                     '&is_active=eq.true&order=item_code.asc&limit=10000';

    if (type === 'CYCLE' && category) {
      itemsQuery += '&category=eq.' + encodeURIComponent(category);
    }

    // Paginated fetch
    var allItems = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;

    while (hasMore) {
      var pageQuery = itemsQuery + '&limit=' + pageSize + '&offset=' + offset;
      var pageRows = await erpFetch('erp_items', pageQuery);

      if (!pageRows || pageRows.length === 0) {
        hasMore = false;
        break;
      }

      allItems = allItems.concat(pageRows);
      offset += pageRows.length;

      if (pageRows.length < pageSize) hasMore = false;
      if (hasMore) await new Promise(function(r) { setTimeout(r, 100); });
    }

    if (allItems.length === 0) {
      throw new Error('No items found for the selected scope');
    }

    console.log('[IC] Snapshot items:', allItems.length);

    // Create session
    var currentUser = localStorage.getItem('ivm_userFullname') || 'WAREHOUSE';

    var sessionRes = await fetch(erpUrl('erp_inventory_counts'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({
        count_no: countNo,
        count_type: type,
        scope_category: category || null,
        count_method: 'MIXED',
        status: 'IN_PROGRESS',
        total_items: allItems.length,
        counted_items: 0,
        variance_count: 0,
        variance_total_qty: 0,
        counted_by: currentUser,
        started_at: new Date().toISOString(),
        notes: notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!sessionRes.ok) {
      throw new Error('Failed to create session');
    }

    var sessionArr = await sessionRes.json();
    var session = sessionArr[0];
    if (!session || !session.id) throw new Error('No session ID');

    console.log('[IC] Session created:', session.id);

    // Create count items in batches
    var itemPayloads = allItems.map(function(it, idx) {
      return {
        count_id: session.id,
        count_no: countNo,
        line_no: idx + 1,
        item_code: it.item_code,
        description: it.description || '',
        category: it.category || '',
        unit: it.base_unit || 'PCS',
        system_qty: Number(it.on_hand || 0),
        counted_qty: 0,
        variance: 0,
        scan_count: 0,
        remarks: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    // Insert in batches of 500
    var batchSize = 500;
    for (var i = 0; i < itemPayloads.length; i += batchSize) {
      var batch = itemPayloads.slice(i, i + batchSize);
      var batchRes = await fetch(erpUrl('erp_inventory_count_items'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify(batch)
      });

      if (!batchRes.ok) {
        throw new Error('Failed to insert items batch ' + (i / batchSize));
      }

      console.log('[IC] Inserted batch:', i + batch.length, '/', itemPayloads.length);
    }

    icShowToast('✅ Count created: ' + countNo + ' (' + allItems.length + ' items)', 'success');

    // Close modal
    var modal = bootstrap.Modal.getInstance(document.getElementById('newCountModal'));
    if (modal) modal.hide();

    // Reload sessions
    await icLoadSessions();

    // Open the new session
    setTimeout(function() {
      icOpenSession(session.id);
    }, 500);

  } catch(err) {
    console.error('[icCreateSession]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _ic.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

window.icCreateSession = icCreateSession;

// ═══════════════════════════════════════════════════════════
// OPEN SESSION
// ═══════════════════════════════════════════════════════════
async function icOpenSession(sessionId) {
  try {
    var sessionRes = await erpFetch('erp_inventory_counts',
      'id=eq.' + sessionId + '&limit=1');

    if (!sessionRes || sessionRes.length === 0) {
      icShowToast('Session not found', 'danger');
      return;
    }

    _ic.currentSession = sessionRes[0];

    // Fetch items (paginated)
    var allItems = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;

    while (hasMore) {
      var itemsRes = await erpFetch('erp_inventory_count_items',
        'count_id=eq.' + sessionId + '&order=line_no.asc&limit=' + pageSize + '&offset=' + offset);

      if (!itemsRes || itemsRes.length === 0) {
        hasMore = false;
        break;
      }

      allItems = allItems.concat(itemsRes);
      offset += itemsRes.length;

      if (itemsRes.length < pageSize) hasMore = false;
      if (hasMore) await new Promise(function(r) { setTimeout(r, 100); });
    }

    _ic.currentItems = allItems;
    console.log('[IC] Session loaded:', _ic.currentSession.count_no, '| Items:', allItems.length);

    // Route based on status
    var status = _ic.currentSession.status;
    if (status === 'PENDING_REVIEW') {
      icShowReviewView();
    } else if (status === 'IN_PROGRESS' || status === 'DRAFT') {
      icShowCountingView();
    } else if (status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED') {
      icShowReviewView();  // read-only
    }

  } catch(err) {
    console.error('[icOpenSession]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icOpenSession = icOpenSession;

function icShowCountingView() {
  _ic.view = 'counting';
  document.getElementById('viewSessionList').style.display = 'none';
  document.getElementById('viewCounting').style.display = 'block';
  document.getElementById('viewReview').style.display = 'none';

  document.getElementById('icCountHeader').textContent = 
    _ic.currentSession.count_no + ' | ' + (_ic.currentSession.scope_category || 'All Items');

  icUpdateProgress();
  icUpdateRecentScans();
  icUpdateVarianceSummary();
}

function icShowReviewView() {
  _ic.view = 'review';
  document.getElementById('viewSessionList').style.display = 'none';
  document.getElementById('viewCounting').style.display = 'none';
  document.getElementById('viewReview').style.display = 'block';

  document.getElementById('icReviewHeader').textContent = 
    _ic.currentSession.count_no + ' | ' + _ic.currentSession.status;

  icRenderReviewView();
}

function icBackToList() {
  _ic.view = 'list';
  _ic.currentSession = null;
  _ic.currentItems = [];

  document.getElementById('viewSessionList').style.display = 'block';
  document.getElementById('viewCounting').style.display = 'none';
  document.getElementById('viewReview').style.display = 'none';

  // Stop scanner if active
  icStopScanner();

  // Reload sessions
  icLoadSessions();
}

window.icBackToList = icBackToList;

// ═══════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════
function icToggleScanner() {
  if (_ic.scannerActive) {
    icStopScanner();
  } else {
    icStartScanner();
  }
}

window.icToggleScanner = icToggleScanner;

function icStartScanner() {
  if (_ic.scanner) return;

  var readerEl = document.getElementById('icReader');
  if (!readerEl) return;

  _ic.scanner = new Html5Qrcode('icReader');

  Html5Qrcode.getCameras().then(function(cameras) {
    if (cameras.length === 0) {
      icShowToast('No camera found', 'warning');
      return;
    }

    var camId = cameras.find(function(c) {
      return c.label.toLowerCase().indexOf('back') !== -1;
    })?.id || cameras[0].id;

    _ic.scanner.start(camId, {
      fps: 10,
      qrbox: { width: 250, height: 250 }
    }, icOnScanSuccess, function() {}).then(function() {
      _ic.scannerActive = true;
      document.getElementById('btnStartScan').innerHTML = '<i class="bi bi-x-circle me-1"></i>Stop Camera';
      document.getElementById('btnStartScan').className = 'btn btn-danger flex-fill';
      document.getElementById('icScanBox').classList.remove('d-none');
    }).catch(function(err) {
      icShowToast('Camera error: ' + err, 'danger');
    });
  }).catch(function(err) {
    icShowToast('Camera access denied', 'danger');
  });
}

function icStopScanner() {
  if (_ic.scanner) {
    _ic.scanner.stop().then(function() {
      _ic.scanner.clear();
      _ic.scanner = null;
      _ic.scannerActive = false;
      document.getElementById('btnStartScan').innerHTML = '<i class="bi bi-camera-video me-1"></i>Start Camera';
      document.getElementById('btnStartScan').className = 'btn btn-primary flex-fill';
      document.getElementById('icScanBox').classList.add('d-none');
    }).catch(function() {});
  }
}

function icOnScanSuccess(decodedText) {
  console.log('[IC Scan]', decodedText);

  var itemCode = icExtractItemCode(decodedText);
  if (!itemCode) {
    icUpdateScanStatus('Invalid QR code', 'danger');
    icPlayErrorBuzz();
    return;
  }

  icProcessScannedItem(itemCode);
}

function icExtractItemCode(text) {
  if (!text) return '';
  var raw = String(text).trim().replace(/^["'\s]+|["'\s]+$/g, '');

  // Handle URL format
  var urlMatch = raw.match(/[?&](?:code|item|id|inventory)=([^&\s]+)/i);
  if (urlMatch) return decodeURIComponent(urlMatch[1]).trim();

  // Skip document QR
  if (/[?&]doc=/i.test(raw)) return '';

  return raw;
}

function icProcessScannedItem(itemCode) {
  var item = _ic.currentItems.find(function(it) {
    return it.item_code.toUpperCase() === itemCode.toUpperCase();
  });

  if (!item) {
    icUpdateScanStatus('Item not in this count: ' + itemCode, 'warning');
    icPlayErrorBuzz();
    icShowToast('Not in scope: ' + itemCode, 'warning');
    return;
  }

  icUpdateScanStatus('Scanned: ' + itemCode, 'success');
  icPlaySuccessBeep();

  // Open qty input modal
  icOpenQtyInputModal(item);
}

function icManualVerify() {
  var input = document.getElementById('icManualInput');
  if (!input) return;
  var code = input.value.trim();
  if (!code) return;
  input.value = '';
  icProcessScannedItem(code);
}

window.icManualVerify = icManualVerify;

function icUpdateScanStatus(msg, type) {
  var el = document.getElementById('icScanStatus');
  var textEl = document.getElementById('icScanStatusText');
  if (!el) return;
  el.className = 'alert alert-' + type + ' py-2 small mt-2 mb-0';
  if (textEl) textEl.textContent = msg;
}

// ═══════════════════════════════════════════════════════════
// QTY INPUT MODAL
// ═══════════════════════════════════════════════════════════
function icOpenQtyInputModal(item) {
  _ic.currentQtyItem = item;

  document.getElementById('qtyInputItemCode').textContent = item.item_code;
  document.getElementById('qtyInputDesc').textContent = item.description || '—';
  document.getElementById('qtyInputUnit').textContent = item.unit || 'PCS';
  document.getElementById('qtyInputSystemQty').value = icNum(item.system_qty) + ' ' + (item.unit || 'PCS');

  var previous = Number(item.counted_qty || 0);
  var prevBox = document.getElementById('previousQtyBox');
  var prevVal = document.getElementById('previousQtyValue');
  if (previous > 0) {
    prevBox.style.display = 'block';
    prevVal.textContent = icNum(previous) + ' ' + (item.unit || 'PCS');
  } else {
    prevBox.style.display = 'none';
  }

  document.getElementById('qtyInputValue').value = '';
  document.getElementById('qtyInputLocation').value = '';
  document.getElementById('qtyInputRemarks').value = '';
  document.getElementById('qtyPreviewBox').style.display = 'none';

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('qtyInputModal'));
  modal.show();

  setTimeout(function() {
    var input = document.getElementById('qtyInputValue');
    if (input) input.focus();
  }, 300);
}

function icUpdateQtyPreview() {
  if (!_ic.currentQtyItem) return;
  var input = document.getElementById('qtyInputValue');
  var preview = document.getElementById('qtyPreviewBox');
  var totalEl = document.getElementById('qtyPreviewTotal');

  var addQty = parseFloat(input.value) || 0;
  var previous = Number(_ic.currentQtyItem.counted_qty || 0);
  var newTotal = previous + addQty;

  totalEl.textContent = icNum(newTotal) + ' ' + (_ic.currentQtyItem.unit || 'PCS');
  preview.style.display = 'block';
}

window.icUpdateQtyPreview = icUpdateQtyPreview;

async function icSaveCountedQty() {
  if (!_ic.currentQtyItem) return;

  var input = document.getElementById('qtyInputValue');
  var locationInput = document.getElementById('qtyInputLocation');
  var remarksInput = document.getElementById('qtyInputRemarks');

  var addQty = parseFloat(input.value) || 0;
  if (addQty < 0) {
    icShowToast('Quantity must be ≥ 0', 'warning');
    return;
  }

  if (addQty === 0 && !confirm('Add 0 quantity?')) return;

  var location = locationInput ? locationInput.value.trim() : '';
  var remarks = remarksInput ? remarksInput.value.trim() : '';

  var item = _ic.currentQtyItem;
  var oldQty = Number(item.counted_qty || 0);
  var newQty = oldQty + addQty;
  var variance = newQty - Number(item.system_qty || 0);

  // Combine remarks
  var finalRemarks = item.remarks || '';
  if (location) {
    finalRemarks = finalRemarks ? finalRemarks + ', ' + location : location;
  }
  if (remarks) {
    finalRemarks = finalRemarks ? finalRemarks + ' | ' + remarks : remarks;
  }

  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || 'WAREHOUSE';

    // Update item
    var itemRes = await fetch(erpUrl('erp_inventory_count_items?id=eq.' + item.id), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        counted_qty: newQty,
        variance: variance,
        scan_count: (item.scan_count || 0) + 1,
        remarks: finalRemarks,
        counted_at: new Date().toISOString(),
        counted_by: currentUser,
        updated_at: new Date().toISOString()
      })
    });

    if (!itemRes.ok) throw new Error('Failed to save item');

    // Log scan
    await fetch(erpUrl('erp_inventory_count_logs'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify([{
        count_id: _ic.currentSession.id,
        count_no: _ic.currentSession.count_no,
        item_code: item.item_code,
        action: 'SCAN',
        old_qty: oldQty,
        added_qty: addQty,
        new_qty: newQty,
        location_note: location,
        remarks: remarks,
        logged_by: currentUser,
        logged_at: new Date().toISOString()
      }])
    });

    // Update local state
    item.counted_qty = newQty;
    item.variance = variance;
    item.scan_count = (item.scan_count || 0) + 1;
    item.remarks = finalRemarks;
    item.counted_at = new Date().toISOString();
    item.counted_by = currentUser;

    // Close modal
    bootstrap.Modal.getInstance(document.getElementById('qtyInputModal')).hide();

    // Update UI
    await icUpdateSessionStats();
    icUpdateProgress();
    icUpdateRecentScans();
    icUpdateVarianceSummary();

    icShowToast('✓ ' + item.item_code + ' saved (+' + icNum(addQty) + ')', 'success');

    // Clear scan status
    setTimeout(function() {
      icUpdateScanStatus('Ready to scan', 'info');
    }, 500);

    // Focus manual input if camera not active
    if (!_ic.scannerActive) {
      setTimeout(function() {
        var input = document.getElementById('icManualInput');
        if (input) input.focus();
      }, 300);
    }

  } catch(err) {
    console.error('[icSaveCountedQty]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icSaveCountedQty = icSaveCountedQty;

// ═══════════════════════════════════════════════════════════
// UPDATE SESSION STATS
// ═══════════════════════════════════════════════════════════
async function icUpdateSessionStats() {
  var countedItems = _ic.currentItems.filter(function(it) {
    return Number(it.counted_qty || 0) > 0 || it.scan_count > 0;
  }).length;

  var varianceItems = _ic.currentItems.filter(function(it) {
    return Math.abs(Number(it.variance || 0)) > 0.0001;
  });

  var varianceCount = varianceItems.length;
  var varianceTotalQty = varianceItems.reduce(function(sum, it) {
    return sum + Number(it.variance || 0);
  }, 0);

  _ic.currentSession.counted_items = countedItems;
  _ic.currentSession.variance_count = varianceCount;
  _ic.currentSession.variance_total_qty = varianceTotalQty;

  // Update DB
  await fetch(erpUrl('erp_inventory_counts?id=eq.' + _ic.currentSession.id), {
    method: 'PATCH',
    headers: erpHeaders(),
    body: JSON.stringify({
      counted_items: countedItems,
      variance_count: varianceCount,
      variance_total_qty: varianceTotalQty,
      updated_at: new Date().toISOString()
    })
  });
}

// ═══════════════════════════════════════════════════════════
// UPDATE UI
// ═══════════════════════════════════════════════════════════
function icUpdateProgress() {
  var total = _ic.currentItems.length;
  var counted = _ic.currentItems.filter(function(it) {
    return Number(it.counted_qty || 0) > 0 || (it.scan_count || 0) > 0;
  }).length;

  var pct = total > 0 ? (counted / total) * 100 : 0;

  document.getElementById('icProgressFill').style.width = pct + '%';
  document.getElementById('icProgressText').textContent = counted + ' / ' + total + ' counted';

  var totalScans = _ic.currentItems.reduce(function(sum, it) {
    return sum + (it.scan_count || 0);
  }, 0);
  document.getElementById('icTotalScans').textContent = totalScans;
}

function icUpdateRecentScans() {
  var container = document.getElementById('icScanHistory');
  if (!container) return;

  // Show items with count > 0, sorted by counted_at DESC
  var scanned = _ic.currentItems.filter(function(it) {
    return Number(it.counted_qty || 0) > 0;
  }).sort(function(a, b) {
    var ta = a.counted_at ? new Date(a.counted_at).getTime() : 0;
    var tb = b.counted_at ? new Date(b.counted_at).getTime() : 0;
    return tb - ta;
  }).slice(0, 20);

  if (scanned.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-4 small">' +
      '<i class="bi bi-inbox fs-3 d-block mb-2 opacity-50"></i>No scans yet</div>';
    return;
  }

  var html = '';
  scanned.forEach(function(it) {
    var variance = Number(it.variance || 0);
    var varClass = 'variance-ok';
    var varText = 'OK';
    if (Math.abs(variance) > 0.0001) {
      if (variance > 0) { varClass = 'variance-pos'; varText = '+' + icNum(variance); }
      else { varClass = 'variance-neg'; varText = icNum(variance); }
    }

    html += '<div class="scan-history-item">' +
      '<div>' +
        '<div class="item-code">' + icEsc(it.item_code) + '</div>' +
        '<div class="small text-muted">' + icEsc((it.remarks || '').substring(0, 30)) + '</div>' +
      '</div>' +
      '<div class="text-end">' +
        '<div class="qty">' + icNum(it.counted_qty) + '</div>' +
        '<span class="variance ' + varClass + '">' + varText + '</span>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

function icUpdateVarianceSummary() {
  var matched = 0;
  var variance = 0;

  _ic.currentItems.forEach(function(it) {
    if (Number(it.counted_qty || 0) === 0 && (it.scan_count || 0) === 0) return;
    var v = Number(it.variance || 0);
    if (Math.abs(v) < 0.0001) matched++;
    else variance++;
  });

  document.getElementById('icMatchedCount').textContent = matched;
  document.getElementById('icVarianceCount').textContent = variance;
}

function icRefreshItems() {
  if (_ic.currentSession) {
    icOpenSession(_ic.currentSession.id);
  }
}

window.icRefreshItems = icRefreshItems;

// ═══════════════════════════════════════════════════════════
// SUBMIT FOR REVIEW
// ═══════════════════════════════════════════════════════════
async function icSubmitForReview() {
  if (!_ic.currentSession) return;

  var counted = _ic.currentItems.filter(function(it) {
    return Number(it.counted_qty || 0) > 0 || (it.scan_count || 0) > 0;
  }).length;

  var total = _ic.currentItems.length;
  var uncounted = total - counted;

  var msg = 'Submit for review?\n\n';
  msg += 'Counted: ' + counted + ' / ' + total + ' items\n';
  if (uncounted > 0) {
    msg += 'Uncounted: ' + uncounted + ' items (will be treated as 0)\n';
  }
  msg += '\nContinue?';

  if (!confirm(msg)) return;

  try {
    var res = await fetch(erpUrl('erp_inventory_counts?id=eq.' + _ic.currentSession.id), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: 'PENDING_REVIEW',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) throw new Error('Submit failed');

    _ic.currentSession.status = 'PENDING_REVIEW';
    icShowToast('✅ Submitted for review', 'success');

    // Update to review view
    setTimeout(function() {
      icShowReviewView();
    }, 500);

  } catch(err) {
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icSubmitForReview = icSubmitForReview;

// ═══════════════════════════════════════════════════════════
// REVIEW VIEW
// ═══════════════════════════════════════════════════════════
function icRenderReviewView() {
  var total = _ic.currentItems.length;
  var matched = 0;
  var varianceCount = 0;
  var varianceQty = 0;

  _ic.currentItems.forEach(function(it) {
    var v = Number(it.variance || 0);
    if (Math.abs(v) < 0.0001) matched++;
    else { varianceCount++; varianceQty += v; }
  });

  document.getElementById('icReviewTotal').textContent = total;
  document.getElementById('icReviewMatched').textContent = matched;
  document.getElementById('icReviewVariance').textContent = varianceCount;
  document.getElementById('icReviewVarianceQty').textContent = varianceQty > 0 ? '+' + icNum(varianceQty) : icNum(varianceQty);

  icRenderReviewItems();
}

function icRenderReviewItems() {
  var tbody = document.getElementById('icReviewBody');
  if (!tbody) return;

  var filter = document.getElementById('icReviewFilter').value;

  var items = _ic.currentItems.filter(function(it) {
    var v = Number(it.variance || 0);
    var hasVariance = Math.abs(v) > 0.0001;

    if (filter === 'variance' && !hasVariance) return false;
    if (filter === 'matched' && hasVariance) return false;
    return true;
  });

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">No items to display.</td></tr>';
    return;
  }

  var html = '';
  items.forEach(function(it, idx) {
    var variance = Number(it.variance || 0);
    var hasVariance = Math.abs(variance) > 0.0001;

    var varDisplay = !hasVariance ? '0' : (variance > 0 ? '+' + icNum(variance) : icNum(variance));
    var varClass = !hasVariance ? '' : (variance > 0 ? 'text-danger' : 'text-primary');

    var rowClass = hasVariance ? 'has-variance' : '';

    html += '<tr class="' + rowClass + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + icEsc(it.item_code) + '</code></td>' +
      '<td>' + icEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + icNum(it.system_qty) + '</td>' +
      '<td class="text-center fw-bold">' + icNum(it.counted_qty) + '</td>' +
      '<td class="text-center ' + varClass + '"><strong>' + varDisplay + '</strong></td>' +
      '<td class="text-center">' + icEsc(it.unit || 'PCS') + '</td>' +
      '<td><small>' + icEsc(it.remarks || '—') + '</small></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

window.icRenderReviewItems = icRenderReviewItems;

// ═══════════════════════════════════════════════════════════
// APPROVE COUNT (auto-adjust stock)
// ═══════════════════════════════════════════════════════════
async function icApproveCount() {
  if (!_ic.currentSession) return;

  var countNo = _ic.currentSession.count_no;
  var varianceItems = _ic.currentItems.filter(function(it) {
    return Math.abs(Number(it.variance || 0)) > 0.0001;
  });

  var msg = 'Approve this count and adjust stock?\n\n';
  msg += 'Count No.: ' + countNo + '\n';
  msg += 'Items to adjust: ' + varianceItems.length + '\n';
  msg += '\nThis will:\n';
  msg += '• Update on_hand values in erp_items\n';
  msg += '• Create stock ledger entries\n';
  msg += '• Log all changes to audit trail\n';
  msg += '\nContinue?';

  if (!confirm(msg)) return;

  var btn = document.querySelector('button[onclick="icApproveCount()"]');
  var originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Approving...';
  }

  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || 'SUPERVISOR';

    var adjustCount = 0;

    // Process each variance item
    for (var i = 0; i < varianceItems.length; i++) {
      var item = varianceItems[i];
      var newOnHand = Number(item.counted_qty || 0);
      var oldOnHand = Number(item.system_qty || 0);
      var variance = Number(item.variance || 0);

      // 1. Update erp_items.on_hand
      var updateRes = await fetch(erpUrl('erp_items?item_code=eq.' + encodeURIComponent(item.item_code)), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify({
          on_hand: newOnHand,
          updated_at: new Date().toISOString(),
          updated_by: currentUser
        })
      });

      if (!updateRes.ok) {
        console.warn('[Approve] Failed to update erp_items:', item.item_code);
      }

      // 2. Insert stock ledger entry
      await fetch(erpUrl('erp_stock_ledger'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify([{
          item_code: item.item_code,
          transaction_type: 'ADJUSTMENT',
          qty_in: variance > 0 ? variance : 0,
          qty_out: variance < 0 ? Math.abs(variance) : 0,
          balance_before: oldOnHand,
          balance_after: newOnHand,
          reference_doc: countNo,
          transaction_date: new Date().toISOString(),
          created_at: new Date().toISOString()
        }])
      });

      // 3. Insert stock adjustment log
      await fetch(erpUrl('erp_stock_adjustments'), {
        method: 'POST',
        headers: erpHeaders(),
        body: JSON.stringify([{
          adjustment_no: 'ADJ-' + countNo,
          item_code: item.item_code,
          old_on_hand: oldOnHand,
          new_on_hand: newOnHand,
          variance: variance,
          reason: 'Inventory Count Adjustment',
          reference_doc: countNo,
          adjusted_by: currentUser,
          adjusted_at: new Date().toISOString()
        }])
      });

      adjustCount++;
      console.log('[Approve] Adjusted:', item.item_code, 'from', oldOnHand, 'to', newOnHand);
    }

    // 4. Update session status
    await fetch(erpUrl('erp_inventory_counts?id=eq.' + _ic.currentSession.id), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: 'APPROVED',
        approved_by: currentUser,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    _ic.currentSession.status = 'APPROVED';

    icShowToast('✅ Approved! Adjusted ' + adjustCount + ' items', 'success');

    setTimeout(function() {
      icBackToList();
    }, 1500);

  } catch(err) {
    console.error('[icApproveCount]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

window.icApproveCount = icApproveCount;

// ═══════════════════════════════════════════════════════════
// REJECT COUNT
// ═══════════════════════════════════════════════════════════
async function icRejectCount() {
  if (!_ic.currentSession) return;

  var reason = prompt('Rejection reason (required):', '');
  if (reason === null) return;
  reason = String(reason).trim();
  if (!reason) {
    icShowToast('Rejection reason is required', 'warning');
    return;
  }

  try {
    var currentUser = localStorage.getItem('ivm_userFullname') || 'SUPERVISOR';

    await fetch(erpUrl('erp_inventory_counts?id=eq.' + _ic.currentSession.id), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        status: 'REJECTED',
        rejected_reason: reason,
        reviewed_by: currentUser,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    icShowToast('Count rejected', 'info');

    setTimeout(function() {
      icBackToList();
    }, 1000);

  } catch(err) {
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icRejectCount = icRejectCount;

// ═══════════════════════════════════════════════════════════
// MANUAL ENTRY MODAL
// ═══════════════════════════════════════════════════════════
function icOpenManualEntry() {
  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('manualEntryModal'));
  modal.show();
  icRenderManualEntry();
}

window.icOpenManualEntry = icOpenManualEntry;

function icRenderManualEntry() {
  var tbody = document.getElementById('manualEntryBody');
  if (!tbody) return;

  var search = (document.getElementById('manualEntrySearch')?.value || '').toLowerCase();

  var items = _ic.currentItems.filter(function(it) {
    if (!search) return true;
    var code = String(it.item_code || '').toLowerCase();
    var desc = String(it.description || '').toLowerCase();
    return code.indexOf(search) !== -1 || desc.indexOf(search) !== -1;
  });

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No items match filter.</td></tr>';
    return;
  }

  var html = '';
  items.forEach(function(it, idx) {
    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + icEsc(it.item_code) + '</code></td>' +
      '<td>' + icEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + icNum(it.system_qty) + '</td>' +
      '<td><input type="number" class="form-control form-control-sm text-center manual-count-input" ' +
        'data-item-id="' + it.id + '" value="' + (it.counted_qty || 0) + '" min="0" step="0.01" style="width:90px;margin:0 auto;">' +
      '</td>' +
      '<td class="text-center">' + icEsc(it.unit || 'PCS') + '</td>' +
      '<td><input type="text" class="form-control form-control-sm manual-remarks-input" ' +
        'data-item-id="' + it.id + '" value="' + icEsc(it.remarks || '') + '" placeholder="Optional" maxlength="100">' +
      '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

window.icFilterManualEntry = icRenderManualEntry;

async function icSaveAllManualEntry() {
  var inputs = document.querySelectorAll('.manual-count-input');
  var changed = 0;

  for (var i = 0; i < inputs.length; i++) {
    var input = inputs[i];
    var itemId = parseInt(input.getAttribute('data-item-id'));
    var newCount = parseFloat(input.value) || 0;

    var item = _ic.currentItems.find(function(it) { return it.id === itemId; });
    if (!item) continue;

    if (Math.abs(Number(item.counted_qty || 0) - newCount) < 0.0001) continue;

    var remarksInput = document.querySelector('.manual-remarks-input[data-item-id="' + itemId + '"]');
    var remarks = remarksInput ? remarksInput.value.trim() : '';

    var variance = newCount - Number(item.system_qty || 0);

    await fetch(erpUrl('erp_inventory_count_items?id=eq.' + itemId), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        counted_qty: newCount,
        variance: variance,
        remarks: remarks,
        counted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    // Log
    var currentUser = localStorage.getItem('ivm_userFullname') || 'WAREHOUSE';
    await fetch(erpUrl('erp_inventory_count_logs'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify([{
        count_id: _ic.currentSession.id,
        count_no: _ic.currentSession.count_no,
        item_code: item.item_code,
        action: 'MANUAL',
        old_qty: item.counted_qty || 0,
        added_qty: newCount - (item.counted_qty || 0),
        new_qty: newCount,
        remarks: remarks,
        logged_by: currentUser,
        logged_at: new Date().toISOString()
      }])
    });

    item.counted_qty = newCount;
    item.variance = variance;
    item.remarks = remarks;
    item.counted_at = new Date().toISOString();
    changed++;
  }

  if (changed === 0) {
    icShowToast('No changes to save', 'info');
  } else {
    icShowToast('✅ Saved ' + changed + ' item(s)', 'success');
  }

  await icUpdateSessionStats();
  icUpdateProgress();
  icUpdateRecentScans();
  icUpdateVarianceSummary();

  bootstrap.Modal.getInstance(document.getElementById('manualEntryModal')).hide();
}

window.icSaveAllManualEntry = icSaveAllManualEntry;

// ═══════════════════════════════════════════════════════════
// PRINT COUNT SHEET
// ═══════════════════════════════════════════════════════════
function icPrintCountSheet() {
  if (!_ic.currentSession) return;

  document.getElementById('printCountNo').textContent = _ic.currentSession.count_no;
  document.getElementById('printDate').textContent = new Date().toLocaleDateString();
  document.getElementById('printScope').textContent = _ic.currentSession.scope_category || 'All Items';
  document.getElementById('printCountedBy').textContent = _ic.currentSession.counted_by || '—';

  var tbody = document.getElementById('printBody');
  var html = '';

  _ic.currentItems.forEach(function(it, idx) {
    html += '<tr>' +
      '<td style="border:1px solid #000;padding:2px;text-align:center;">' + (idx + 1) + '</td>' +
      '<td style="border:1px solid #000;padding:2px;font-family:Courier New,monospace;font-size:7.5pt;">' + icEsc(it.item_code) + '</td>' +
      '<td style="border:1px solid #000;padding:2px;font-size:7.5pt;">' + icEsc(it.description || '') + '</td>' +
      '<td style="border:1px solid #000;padding:2px;text-align:center;">' + icEsc(it.unit || 'PCS') + '</td>' +
      '<td style="border:1px solid #000;padding:2px;height:20px;"></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;

  var printArea = document.getElementById('countPrintArea');
  printArea.style.display = 'block';

  setTimeout(function() {
    window.print();
    setTimeout(function() {
      printArea.style.display = 'none';
    }, 500);
  }, 200);
}

window.icPrintCountSheet = icPrintCountSheet;

// ═══════════════════════════════════════════════════════════
// VIEW SESSION DETAILS (read-only)
// ═══════════════════════════════════════════════════════════
function icViewSessionDetails(sessionId) {
  icOpenSession(sessionId);
}

window.icViewSessionDetails = icViewSessionDetails;

// ═══════════════════════════════════════════════════════════
// SEARCH + FILTERS
// ═══════════════════════════════════════════════════════════
function icOnSearch() {
  clearTimeout(_ic.searchTimer);
  _ic.searchTimer = setTimeout(function() {
    icRenderSessionList();
  }, 300);
}

window.icOnSearch = icOnSearch;

function icClearFilters() {
  document.getElementById('icSearchInput').value = '';
  document.getElementById('icStatusFilter').value = '';
  icRenderSessionList();
}

window.icClearFilters = icClearFilters;

// ═══════════════════════════════════════════════════════════
// SOUNDS
// ═══════════════════════════════════════════════════════════
var _icAudioCtx = null;

function _icGetAudioCtx() {
  if (!_icAudioCtx) {
    try { _icAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _icAudioCtx;
}

function icPlaySuccessBeep() {
  try {
    var ctx = _icGetAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
    if (navigator.vibrate) navigator.vibrate(50);
  } catch(e) {}
}

function icPlayErrorBuzz() {
  try {
    var ctx = _icGetAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function icNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function icEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// ═══════════════════════════════════════════════════════════
// EXPOSE GLOBALS
// ═══════════════════════════════════════════════════════════
window.icLoadSessions = icLoadSessions;
window.icRenderSessionList = icRenderSessionList;
window.icOpenSession = icOpenSession;
window.icBackToList = icBackToList;
window.icCreateSession = icCreateSession;
window.icOpenManualEntry = icOpenManualEntry;
window.icPrintCountSheet = icPrintCountSheet;
window.icSubmitForReview = icSubmitForReview;
window.icApproveCount = icApproveCount;
window.icRejectCount = icRejectCount;

console.log('✅ inventory-count.js v1.0 loaded');
