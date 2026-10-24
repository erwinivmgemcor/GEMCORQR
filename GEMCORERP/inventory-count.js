// ============================================================
// GEMCOR ERP — Inventory Count (v1.3)
// ✅ NEW: Auto-suggest for manual input field
// ✅ SUM-based counting + keyboard navigation
// ✅ FIXED: Approve/Reject buttons hide correctly after action
// ✅ v1.3: atomic RPCs (create/save/submit/approve/reject/reopen/cancel), variance ayon sa galaw pagkatapos ng bilang,
//          uncounted ≠ counted (counted_at marker), SPOT count, Reopen/Cancel
// ============================================================

var _ic = {
  sessions: [],
  filteredSessions: [],
  currentSession: null,
  currentItems: [],
  filteredItems: [],
  preview: {},          // item.id -> { expected_qty, delta } (galing sa erp_ic_preview kapag PENDING_REVIEW)
  scanner: null,
  scannerActive: false,
  currentQtyItem: null,
  searchTimer: null,
  dropdownTimer: null,
  isSubmitting: false,
  isSaving: false,
  view: 'list'
};

// ═══════════════════════════════════════════════════════════
// HELPERS (v1.3)
// ═══════════════════════════════════════════════════════════
// Tumatawag ng Supabase RPC. Nagtatapon ng Error kapag HTTP error o success:false.
async function icRpc(name, body) {
  var res = await fetch(erpUrl('rpc/' + name), {
    method: 'POST',
    headers: erpHeaders(),
    body: JSON.stringify(body || {})
  });
  var text = await res.text();
  var data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    var msg = (data && (data.message || data.error || data.details)) || text || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  if (data && data.success === false) throw new Error(data.error || 'Request failed');
  return data;
}

// "Counted" = may counted_at (kaya legit ang bilang na 0; ang uncounted ay walang counted_at).
function icIsCounted(it) { return !!(it && it.counted_at); }

function icCurrentUser(fallback) {
  return localStorage.getItem('ivm_userFullname') || fallback || 'WAREHOUSE';
}

function icIsAdmin() { return localStorage.getItem('ivm_isAdmin') === 'true'; }

// Expected (system) qty sa oras ng bilang:
//  PENDING_REVIEW -> live preview mula sa server (kasama ang galaw pagkatapos ng bilang)
//  APPROVED       -> ang expected_qty na na-save sa approval
//  iba            -> ang snapshot system_qty
function icExpectedQty(it) {
  var p = _ic.preview[it.id];
  if (p && p.expected_qty !== null && p.expected_qty !== undefined) return Number(p.expected_qty);
  if (it.expected_qty !== null && it.expected_qty !== undefined) return Number(it.expected_qty);
  return Number(it.system_qty || 0);
}

function icEffectiveVariance(it) {
  if (!icIsCounted(it)) return 0;
  return Math.round((Number(it.counted_qty || 0) - icExpectedQty(it)) * 10000) / 10000;
}

function icApplyItem(srv) {
  if (!srv) return;
  var local = _ic.currentItems.find(function(it) { return it.id === srv.id; });
  if (!local) return;
  local.counted_qty = srv.counted_qty;
  local.variance = srv.variance;
  local.scan_count = srv.scan_count;
  local.remarks = srv.remarks;
  local.counted_at = srv.counted_at;
  local.counted_by = srv.counted_by;
  local.expected_qty = null;
  local.adjusted_qty = null;
}

function icApplyStats(st) {
  if (!st || !_ic.currentSession) return;
  _ic.currentSession.total_items = st.total_items;
  _ic.currentSession.counted_items = st.counted_items;
  _ic.currentSession.variance_count = st.variance_count;
  _ic.currentSession.variance_total_qty = st.variance_total_qty;
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Inventory Count v1.3] Initializing...');

  icCheckHealth();
  icLoadSessions();

  var manualInput = document.getElementById('icManualInput');
  if (manualInput) {
    manualInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        icManualVerify();
      }
    });
  }

  var qtyInput = document.getElementById('qtyInputValue');
  if (qtyInput) {
    qtyInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        icSaveCountedQty();
      }
    });
  }

  document.addEventListener('keydown', icHandleDropdownKeydown);
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

  var isAdmin = icIsAdmin();
  var html = '';
  _ic.filteredSessions.forEach(function(s) {
    var dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : '—';

    var totalItems = s.total_items || 0;
    var countedItems = s.counted_items || 0;
    var progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;
    var varianceCount = s.variance_count || 0;
    var statusClass = 'status-' + (s.status || 'DRAFT');
    var scope = s.scope_category || (s.count_type === 'FULL' ? 'All Items' : 'N/A');

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
        '<button class="erp-action-btn primary" onclick="icOpenSession(' + s.id + ')" title="Open">' +
          '<i class="bi bi-play-circle"></i>' +
        '</button>' +
        '<button class="erp-action-btn" onclick="icViewSessionDetails(' + s.id + ')" title="View Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' +
        (s.status === 'REJECTED' && isAdmin
          ? '<button class="erp-action-btn" style="background:#10b981; color:#fff;" onclick="icReopenSession(' + s.id + ')" title="Reopen for Recount">' +
              '<i class="bi bi-arrow-counterclockwise"></i>' +
            '</button>'
          : '') +
        ((s.status === 'IN_PROGRESS' || (isAdmin && (s.status === 'PENDING_REVIEW' || s.status === 'REJECTED')))
          ? '<button class="erp-action-btn" style="background:#6b7280; color:#fff;" onclick="icCancelSession(' + s.id + ')" title="Cancel this count">' +
              '<i class="bi bi-x-octagon"></i>' +
            '</button>'
          : '') +
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
  var spotEl = document.getElementById('newCountSpotCodes');
  if (spotEl) spotEl.value = '';
  icOnCountTypeChange();

  var modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('newCountModal'));
  modal.show();
}

window.openNewCountModal = openNewCountModal;

function icOnCountTypeChange() {
  var type = document.getElementById('newCountType').value;
  var catGroup = document.getElementById('newCountCategoryGroup');
  var spotGroup = document.getElementById('newCountSpotGroup');
  if (catGroup) catGroup.style.display = (type === 'CYCLE') ? 'block' : 'none';
  if (spotGroup) spotGroup.style.display = (type === 'SPOT') ? 'block' : 'none';
}

window.icOnCountTypeChange = icOnCountTypeChange;

async function icCreateSession() {
  if (_ic.isSubmitting) return;

  var type = document.getElementById('newCountType').value;
  var category = document.getElementById('newCountCategory').value;
  var notes = document.getElementById('newCountNotes').value.trim();
  var codes = null;

  if (type === 'CYCLE' && !category) {
    icShowToast('Please select a category', 'warning');
    return;
  }

  if (type === 'SPOT') {
    var spotEl = document.getElementById('newCountSpotCodes');
    var raw = spotEl ? spotEl.value : '';
    var seen = {};
    codes = raw.split(/[\s,;]+/).map(function(c) { return c.trim().toUpperCase(); }).filter(function(c) {
      if (!c || seen[c]) return false;
      seen[c] = true;
      return true;
    });
    if (codes.length === 0) {
      icShowToast('Maglagay ng kahit isang item code para sa Spot count', 'warning');
      return;
    }
  }

  var scopeTxt = type === 'CYCLE' ? 'Category: ' + category
               : type === 'SPOT' ? 'Items: ' + codes.length + ' item code(s)'
               : 'Scope: All items';
  if (!confirm('Create new count session?\n\nType: ' + type + '\n' + scopeTxt)) return;

  _ic.isSubmitting = true;
  var btn = document.getElementById('btnCreateCount');
  var originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';
  }

  try {
    // Atomic sa database: count_no + session + lahat ng items sa isang transaksyon
    var r = await icRpc('erp_ic_create_count', {
      p_type: type,
      p_category: type === 'CYCLE' ? category : null,
      p_notes: notes,
      p_user: icCurrentUser(),
      p_item_codes: codes
    });

    var msg = '✅ Count created: ' + r.count_no + ' (' + r.total_items + ' items)';
    if (codes && r.total_items < codes.length) {
      msg += ' — ' + (codes.length - r.total_items) + ' code(s) hindi nahanap / inactive';
    }
    icShowToast(msg, codes && r.total_items < codes.length ? 'warning' : 'success');

    var modal = bootstrap.Modal.getInstance(document.getElementById('newCountModal'));
    if (modal) modal.hide();

    await icLoadSessions();
    setTimeout(function() { icOpenSession(r.id); }, 500);

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

    // Para sa PENDING_REVIEW: kunin ang expected qty (live on_hand - galaw pagkatapos ng bilang)
    _ic.preview = {};
    if (_ic.currentSession.status === 'PENDING_REVIEW') {
      try {
        var pv = await icRpc('erp_ic_preview', { p_count_id: sessionId });
        (pv || []).forEach(function(p) { _ic.preview[p.id] = p; });
      } catch (pvErr) {
        console.warn('[IC] Preview failed (snapshot ang gagamitin):', pvErr.message);
      }
    }
    console.log('[IC] Session loaded:', _ic.currentSession.count_no, '| Items:', allItems.length);

    var status = _ic.currentSession.status;
    if (status === 'PENDING_REVIEW' || status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED') {
      icShowReviewView();
    } else {
      icShowCountingView();
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

// ✅ FIXED: Inalis ang doble at inayos ang variable definition
function icShowReviewView() {
  _ic.view = 'review';
  document.getElementById('viewSessionList').style.display = 'none';
  document.getElementById('viewCounting').style.display = 'none';
  document.getElementById('viewReview').style.display = 'block';

  document.getElementById('icReviewHeader').textContent =
    _ic.currentSession.count_no + ' | ' + _ic.currentSession.status;

  var isAdmin = icIsAdmin();
  var status = _ic.currentSession.status;
  var actionButtons = document.getElementById('icReviewActionButtons');
  var actionMessage = document.getElementById('icReviewActionMessage');
  var btnApprove = document.getElementById('btnReviewApprove');
  var btnReject = document.getElementById('btnReviewReject');

  function setMsg(html) { if (actionMessage) actionMessage.innerHTML = html; }
  function showButtons(approve, reject, rejectLabel) {
    if (actionButtons) actionButtons.style.display = (approve || reject) ? 'block' : 'none';
    if (btnApprove) btnApprove.style.display = approve ? '' : 'none';
    if (btnReject) {
      btnReject.style.display = reject ? '' : 'none';
      btnReject.innerHTML = '<i class="bi bi-x-circle me-1"></i>' + rejectLabel;
    }
  }

  if (status === 'PENDING_REVIEW') {
    if (isAdmin) {
      showButtons(true, true, 'Reject');
      setMsg('<i class="bi bi-info-circle me-1"></i> Approve to auto-adjust stock, or reject to return for recount. ' +
             'Ang <strong>System</strong> column ay ang stock sa oras ng bilang (kasama na ang mga MRIF/MRR/MRS pagkatapos nito).');
    } else {
      showButtons(false, false, 'Reject');
      setMsg('<i class="bi bi-shield-lock me-1 text-danger"></i> <strong>Awaiting Admin Review.</strong> Only admins can approve or reject this count.');
    }
  } else if (status === 'APPROVED') {
    showButtons(false, isAdmin, 'Reverse Approval');
    setMsg('<i class="bi bi-check-circle-fill text-success me-1"></i> <strong>This count has been APPROVED.</strong> Stock has been adjusted.' +
           (isAdmin ? ' Kung nagkamali, i-click ang Reverse Approval para ibalik ang eksaktong adjustment.' : ''));
  } else if (status === 'REJECTED') {
    showButtons(false, false, 'Reject');
    setMsg('<i class="bi bi-x-circle-fill text-danger me-1"></i> <strong>REJECTED:</strong> ' + icEsc(_ic.currentSession.rejected_reason || '—') +
           (isAdmin ? '<br>Gamitin ang <i class="bi bi-arrow-counterclockwise"></i> Reopen sa listahan para sa recount.' : ''));
  } else {
    showButtons(false, false, 'Reject');
    setMsg('<i class="bi bi-slash-circle me-1 text-muted"></i> This count is ' + icEsc(status) + '.');
  }

  icRenderReviewView();
}

function icBackToList() {
  _ic.view = 'list';
  _ic.currentSession = null;
  _ic.currentItems = [];

  document.getElementById('viewSessionList').style.display = 'block';
  document.getElementById('viewCounting').style.display = 'none';
  document.getElementById('viewReview').style.display = 'none';

  icStopScanner();
  icLoadSessions();
}

window.icBackToList = icBackToList;

// ═══════════════════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════════════════
function icToggleScanner() {
  if (_ic.scannerActive) icStopScanner();
  else icStartScanner();
}

window.icToggleScanner = icToggleScanner;

function icStartScanner() {
  if (_ic.scanner) return;
  var readerEl = document.getElementById('icReader');
  if (!readerEl) return;

  _ic.scanner = new Html5Qrcode('icReader');

  Html5Qrcode.getCameras().then(function(cameras) {
    if (cameras.length === 0) { icShowToast('No camera found', 'warning'); return; }

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
  }).catch(function() {
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
  var urlMatch = raw.match(/[?&](?:code|item|id|inventory)=([^&\s]+)/i);
  if (urlMatch) return decodeURIComponent(urlMatch[1]).trim();
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
  icOpenQtyInputModal(item);
}

function icManualVerify() {
  var input = document.getElementById('icManualInput');
  if (!input) return;
  var code = input.value.trim();
  if (!code) return;
  input.value = '';
  icHideManualDropdown();
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
// MANUAL INPUT AUTO-SUGGEST
// ═══════════════════════════════════════════════════════════
function icOnManualInput(value) {
  var term = String(value || '').toLowerCase().trim();
  var dropdown = document.getElementById('icManualDropdown');
  var input = document.getElementById('icManualInput');

  if (!dropdown || !input) return;

  if (!term || term.length < 2) {
    icHideManualDropdown();
    return;
  }

  if (_ic.dropdownTimer) clearTimeout(_ic.dropdownTimer);
  _ic.dropdownTimer = setTimeout(function() {
    icBuildManualSuggestions(term, dropdown, input);
  }, 150);
}

window.icOnManualInput = icOnManualInput;

function icBuildManualSuggestions(term, dropdown, input) {
  if (!_ic.currentItems || _ic.currentItems.length === 0) {
    dropdown.innerHTML = '<div class="item-search-item muted">No count session loaded</div>';
    icPositionManualDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    return;
  }

  var matches = _ic.currentItems.filter(function(it) {
    var code = String(it.item_code || '').toLowerCase();
    var desc = String(it.description || '').toLowerCase();
    return code.indexOf(term) !== -1 || desc.indexOf(term) !== -1;
  });

  matches.sort(function(a, b) {
    var aCode = String(a.item_code || '').toLowerCase();
    var bCode = String(b.item_code || '').toLowerCase();
    var aExact = aCode === term ? 0 : 1;
    var bExact = bCode === term ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    var aStart = aCode.indexOf(term) === 0 ? 0 : 1;
    var bStart = bCode.indexOf(term) === 0 ? 0 : 1;
    if (aStart !== bStart) return aStart - bStart;
    return aCode.localeCompare(bCode);
  });

  matches = matches.slice(0, 30);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="item-search-item muted">No matches in this session</div>';
    icPositionManualDropdown(dropdown, input);
    dropdown.classList.remove('d-none');
    return;
  }

  var html = '';
  matches.forEach(function(it) {
    var code = String(it.item_code || '');
    var desc = String(it.description || '');
    var unit = String(it.unit || 'PCS');
    var systemQty = Number(it.system_qty || 0);
    var countedQty = Number(it.counted_qty || 0);
    var scanCount = it.scan_count || 0;

    var statusBadge = '';
    if (scanCount > 0) {
      statusBadge = '<span class="badge bg-success">Counted: ' + icNum(countedQty) + '</span>';
    } else {
      statusBadge = '<span class="badge bg-secondary">Not counted</span>';
    }

    var safeCode = code.replace(/'/g, "\\'");

    html += '<div class="item-search-item" data-code="' + icEsc(code) + '" onclick="icSelectManualSuggestion(\'' + safeCode + '\')">' +
      '<div class="item-code">' + icEsc(code) + '</div>' +
      '<div class="item-desc">' + icEsc(desc.substring(0, 100)) + '</div>' +
      '<div class="item-meta">' +
        '<span class="badge bg-light text-dark">' + icEsc(unit) + '</span>' +
        '<span>System: <strong>' + icNum(systemQty) + '</strong></span>' +
        statusBadge +
      '</div>' +
    '</div>';
  });

  dropdown.innerHTML = html;
  icPositionManualDropdown(dropdown, input);
  dropdown.classList.remove('d-none');
}

function icPositionManualDropdown(dropdown, input) {
  var rect = input.getBoundingClientRect();
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;
  var dropdownMinHeight = 320;

  var width = Math.max(rect.width, 420);
  var maxWidth = window.innerWidth - rect.left - 20;
  if (width > maxWidth) width = maxWidth;

  dropdown.style.position = 'fixed';
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = width + 'px';
  dropdown.style.zIndex = '99999';

  if (spaceBelow < dropdownMinHeight && spaceAbove > spaceBelow) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceAbove - 20, 320) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.maxHeight = Math.min(spaceBelow - 20, 320) + 'px';
  }
}

function icHideManualDropdown() {
  var dropdown = document.getElementById('icManualDropdown');
  if (dropdown) dropdown.classList.add('d-none');
}

function icSelectManualSuggestion(itemCode) {
  var input = document.getElementById('icManualInput');
  if (input) input.value = itemCode;
  icHideManualDropdown();

  icProcessScannedItem(itemCode);

  if (input) input.value = '';
}

window.icSelectManualSuggestion = icSelectManualSuggestion;

function icHandleDropdownKeydown(e) {
  var dropdown = document.getElementById('icManualDropdown');
  if (!dropdown || dropdown.classList.contains('d-none')) return;

  var items = dropdown.querySelectorAll('.item-search-item:not(.muted)');
  if (items.length === 0) return;

  var current = dropdown.querySelector('.item-search-item.highlighted');
  var idx = current ? Array.prototype.indexOf.call(items, current) : -1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (current) current.classList.remove('highlighted');
    idx = (idx + 1) % items.length;
    items[idx].classList.add('highlighted');
    items[idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (current) current.classList.remove('highlighted');
    idx = idx <= 0 ? items.length - 1 : idx - 1;
    items[idx].classList.add('highlighted');
    items[idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    if (current) {
      e.preventDefault();
      var code = current.getAttribute('data-code');
      if (code) icSelectManualSuggestion(code);
    }
  } else if (e.key === 'Escape') {
    icHideManualDropdown();
  }
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#icManualInput') && !e.target.closest('#icManualDropdown')) {
    icHideManualDropdown();
  }
});

window.addEventListener('scroll', function() {
  var dropdown = document.getElementById('icManualDropdown');
  var input = document.getElementById('icManualInput');
  if (dropdown && !dropdown.classList.contains('d-none') && input) {
    icPositionManualDropdown(dropdown, input);
  }
}, { passive: true });

window.addEventListener('resize', function() {
  icHideManualDropdown();
});

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
  if (icIsCounted(item)) {
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
  if (!_ic.currentQtyItem || _ic.isSaving) return;

  var input = document.getElementById('qtyInputValue');
  var locationInput = document.getElementById('qtyInputLocation');
  var remarksInput = document.getElementById('qtyInputRemarks');

  var addQty = parseFloat(input.value) || 0;
  if (addQty < 0) { icShowToast('Quantity must be ≥ 0', 'warning'); return; }
  if (addQty === 0 && !confirm('Add 0 quantity?\n\n(Mamarkahan ang item na NABILANG kahit 0.)')) return;

  var location = locationInput ? locationInput.value.trim() : '';
  var remarks = remarksInput ? remarksInput.value.trim() : '';
  var item = _ic.currentQtyItem;

  _ic.isSaving = true;
  try {
    // Atomic increment sa server (ligtas kahit dalawang tao ang nag-scan ng iisang item)
    var r = await icRpc('erp_ic_save_count', {
      p_count_id: _ic.currentSession.id,
      p_item_id: item.id,
      p_qty: addQty,
      p_mode: 'ADD',
      p_location: location,
      p_remarks: remarks,
      p_user: icCurrentUser()
    });

    icApplyItem(r.item);
    icApplyStats(r.stats);

    bootstrap.Modal.getInstance(document.getElementById('qtyInputModal')).hide();

    icUpdateProgress();
    icUpdateRecentScans();
    icUpdateVarianceSummary();

    icShowToast('✓ ' + item.item_code + ' saved (+' + icNum(addQty) + ') → total ' + icNum(r.item.counted_qty), 'success');

    setTimeout(function() {
      icUpdateScanStatus('Ready to scan', 'info');
    }, 500);

    if (!_ic.scannerActive) {
      setTimeout(function() {
        var mi = document.getElementById('icManualInput');
        if (mi) mi.focus();
      }, 300);
    }

  } catch(err) {
    console.error('[icSaveCountedQty]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  } finally {
    _ic.isSaving = false;
  }
}

window.icSaveCountedQty = icSaveCountedQty;

// ═══════════════════════════════════════════════════════════
// SESSION STATS
// ═══════════════════════════════════════════════════════════
// Lokal na recompute lang (ang server na ang nagsusulat ng stats sa bawat save).
function icUpdateSessionStats() {
  var counted = _ic.currentItems.filter(icIsCounted);
  var varianceItems = counted.filter(function(it) {
    return Math.abs(Number(it.variance || 0)) > 0.0001;
  });
  _ic.currentSession.counted_items = counted.length;
  _ic.currentSession.variance_count = varianceItems.length;
  _ic.currentSession.variance_total_qty = varianceItems.reduce(function(sum, it) {
    return sum + Number(it.variance || 0);
  }, 0);
}

// ═══════════════════════════════════════════════════════════
// UPDATE UI
// ═══════════════════════════════════════════════════════════
function icUpdateProgress() {
  var total = _ic.currentItems.length;
  var counted = _ic.currentItems.filter(icIsCounted).length;

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

  var scanned = _ic.currentItems.filter(icIsCounted).sort(function(a, b) {
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
    if (!icIsCounted(it)) return;
    var v = Number(it.variance || 0);
    if (Math.abs(v) < 0.0001) matched++;
    else variance++;
  });

  document.getElementById('icMatchedCount').textContent = matched;
  document.getElementById('icVarianceCount').textContent = variance;
}

function icRefreshItems() {
  if (_ic.currentSession) icOpenSession(_ic.currentSession.id);
}

window.icRefreshItems = icRefreshItems;

// ═══════════════════════════════════════════════════════════
// SUBMIT / APPROVE / REJECT
// ═══════════════════════════════════════════════════════════
async function icSubmitForReview() {
  if (!_ic.currentSession) return;

  if (_ic.currentSession.status !== 'IN_PROGRESS') {
    icShowToast('Cannot submit. This session is already ' + _ic.currentSession.status, 'warning');
    return;
  }

  var total = _ic.currentItems.length;
  var counted = _ic.currentItems.filter(icIsCounted).length;
  var uncounted = total - counted;

  if (counted === 0) {
    icShowToast('Walang na-count na item. Magbilang muna bago mag-submit.', 'warning');
    return;
  }

  var msg = 'Submit for review?\n\n';
  msg += 'Counted: ' + counted + ' / ' + total + ' items\n';
  if (uncounted > 0) {
    msg += 'Not counted: ' + uncounted + ' items — HINDI ito iaadjust (mananatili ang kasalukuyang stock nila).\n';
  }
  msg += '\nHindi na pwedeng baguhin ang bilang pagkatapos mag-submit. Continue?';

  if (!confirm(msg)) return;

  try {
    await icRpc('erp_ic_submit', { p_count_id: _ic.currentSession.id, p_user: icCurrentUser() });
    icShowToast('✅ Submitted for review', 'success');
    await icOpenSession(_ic.currentSession.id);   // reload (kasama ang preview)
  } catch(err) {
    console.error('[icSubmitForReview]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icSubmitForReview = icSubmitForReview;

function icRenderReviewView() {
  var total = _ic.currentItems.length;
  var matched = 0;
  var varianceCount = 0;
  var varianceQty = 0;
  var uncounted = 0;

  _ic.currentItems.forEach(function(it) {
    if (!icIsCounted(it)) { uncounted++; return; }
    var v = icEffectiveVariance(it);
    if (Math.abs(v) < 0.0001) matched++;
    else { varianceCount++; varianceQty += v; }
  });

  document.getElementById('icReviewTotal').textContent = total;
  document.getElementById('icReviewMatched').textContent = matched;
  document.getElementById('icReviewVariance').textContent = varianceCount;
  var ucEl = document.getElementById('icReviewUncounted');
  if (ucEl) ucEl.textContent = uncounted;
  document.getElementById('icReviewVarianceQty').textContent = varianceQty > 0 ? '+' + icNum(varianceQty) : icNum(varianceQty);

  icRenderReviewItems();
}

function icRenderReviewItems() {
  var tbody = document.getElementById('icReviewBody');
  if (!tbody) return;

  var filter = document.getElementById('icReviewFilter').value;

  var items = _ic.currentItems.filter(function(it) {
    var counted = icIsCounted(it);
    var hasVariance = counted && Math.abs(icEffectiveVariance(it)) > 0.0001;
    if (filter === 'variance' && !hasVariance) return false;
    if (filter === 'matched' && !(counted && !hasVariance)) return false;
    if (filter === 'uncounted' && counted) return false;
    return true;
  });

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">No items to display.</td></tr>';
    return;
  }

  var html = '';
  items.forEach(function(it, idx) {
    var counted = icIsCounted(it);
    var variance = icEffectiveVariance(it);
    var hasVariance = counted && Math.abs(variance) > 0.0001;

    var varDisplay = !counted ? '<span class="badge bg-secondary">Not counted</span>'
                   : '<strong>' + (!hasVariance ? '0' : (variance > 0 ? '+' + icNum(variance) : icNum(variance))) + '</strong>';
    var varClass = !hasVariance ? '' : (variance > 0 ? 'text-danger' : 'text-primary');
    var rowClass = hasVariance ? 'has-variance' : '';

    html += '<tr class="' + rowClass + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + icEsc(it.item_code) + '</code></td>' +
      '<td>' + icEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + icNum(icExpectedQty(it)) + '</td>' +
      '<td class="text-center fw-bold">' + (counted ? icNum(it.counted_qty) : '—') + '</td>' +
      '<td class="text-center ' + varClass + '">' + varDisplay + '</td>' +
      '<td class="text-center">' + icEsc(it.unit || 'PCS') + '</td>' +
      '<td><small>' + icEsc(it.remarks || '—') + '</small></td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

window.icRenderReviewItems = icRenderReviewItems;


// ═══════════════════════════════════════════════════════════
// APPROVE / REJECT / REOPEN / CANCEL — lahat ay atomic RPC sa database.
// Ledger lang ang gumagalaw ng on_hand (trigger fn_apply_stock_movement) — walang direktang PATCH sa on_hand.
// ═══════════════════════════════════════════════════════════
async function icApproveCount() {
  if (!_ic.currentSession) return;

  if (_ic.currentSession.status !== 'PENDING_REVIEW') {
    icShowToast('Hindi pwedeng i-approve: ' + _ic.currentSession.status, 'info');
    return;
  }
  if (!icIsAdmin()) {
    icShowToast('Admin lang ang pwedeng mag-approve.', 'warning');
    return;
  }

  var countNo = _ic.currentSession.count_no;
  var adjust = 0, matched = 0, uncounted = 0;
  _ic.currentItems.forEach(function(it) {
    if (!icIsCounted(it)) { uncounted++; return; }
    if (Math.abs(icEffectiveVariance(it)) > 0.0001) adjust++; else matched++;
  });

  if (adjust === 0) {
    if (!confirm('Walang variance na ma-aadjust (' + matched + ' matched, ' + uncounted + ' not counted).\n\nI-approve pa rin at isara ang count?')) return;
  } else {
    var msg = 'Approve this count and adjust stock?\n\n' +
      'Count No.: ' + countNo + '\n' +
      'Items to adjust: ' + adjust + '\n' +
      'Matched: ' + matched + '\n' +
      'Not counted (hindi gagalawin): ' + uncounted + '\n\n' +
      'Ia-adjust ang stock base sa bilang MINUS ang mga galaw (MRIF/MRR/MRS) pagkatapos ng bilang.\n' +
      'Lahat o wala: kapag may pumalya, walang magbabago.\n\nContinue?';
    if (!confirm(msg)) return;
  }

  var btn = document.getElementById('btnReviewApprove');
  var originalHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Approving...'; }

  try {
    var r = await icRpc('erp_ic_approve', { p_count_id: _ic.currentSession.id, p_user: icCurrentUser('SUPERVISOR') });
    icShowToast('✅ Approved! Adjusted ' + r.adjusted + ' item(s), ' + r.matched + ' matched, ' + r.not_counted + ' not counted', 'success');
    setTimeout(function() { icBackToList(); }, 1500);
  } catch(err) {
    console.error('[icApproveCount]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
  }
}

async function icRejectCount() {
  if (!_ic.currentSession) return;
  if (!icIsAdmin()) { icShowToast('Admin lang ang pwedeng mag-reject.', 'warning'); return; }

  var isApproved = _ic.currentSession.status === 'APPROVED';

  var reason = prompt((isApproved ? 'Reason for REVERSING this approved count (required):' : 'Rejection reason (required):'), '');
  if (reason === null) return;
  reason = String(reason).trim();
  if (!reason) { icShowToast('Reason is required', 'warning'); return; }

  if (isApproved) {
    if (!confirm('⚠️ WARNING: This count is already APPROVED and stock has been adjusted.\n\n' +
                 'Ibabalik ang EKSAKTONG adjustment na ginawa ng count na ito (hindi mabubura ang ibang transaksyon pagkatapos).\n' +
                 'Kapag nagamit na ang stock at hindi na kayang ibalik, mabibigo ang reversal at walang magbabago.\n\nContinue?')) {
      return;
    }
  }

  try {
    var r = await icRpc('erp_ic_reject', {
      p_count_id: _ic.currentSession.id,
      p_reason: reason,
      p_user: icCurrentUser('SUPERVISOR')
    });
    icShowToast('Count rejected' + (isApproved ? ' — ' + r.reversed + ' adjustment(s) reversed' : ''), 'info');
    setTimeout(function() { icBackToList(); }, 1000);
  } catch(err) {
    console.error('[icRejectCount]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

async function icReopenSession(sessionId) {
  if (!icIsAdmin()) { icShowToast('Admin lang ang pwedeng mag-reopen.', 'warning'); return; }
  if (!confirm('Reopen this count for recount?\n\nMananatili ang mga naunang bilang; pwede mo silang baguhin at mag-submit ulit.')) return;
  try {
    await icRpc('erp_ic_reopen', { p_count_id: sessionId, p_user: icCurrentUser('SUPERVISOR') });
    icShowToast('Count reopened — pwede nang mag-recount', 'success');
    await icLoadSessions();
    icOpenSession(sessionId);
  } catch(err) {
    console.error('[icReopenSession]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

async function icCancelSession(sessionId) {
  var s = _ic.sessions.find(function(x) { return x.id === sessionId; });
  var label = s ? s.count_no : ('#' + sessionId);
  var reason = prompt('Cancel ' + label + '?\n\nWalang magbabago sa stock. Reason (required):', '');
  if (reason === null) return;
  reason = String(reason).trim();
  if (!reason) { icShowToast('Reason is required', 'warning'); return; }
  try {
    await icRpc('erp_ic_cancel', { p_count_id: sessionId, p_reason: reason, p_user: icCurrentUser() });
    icShowToast('Count cancelled', 'info');
    await icLoadSessions();
  } catch(err) {
    console.error('[icCancelSession]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icApproveCount = icApproveCount;
window.icRejectCount = icRejectCount;
window.icReopenSession = icReopenSession;
window.icCancelSession = icCancelSession;

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

  var searchInput = document.getElementById('manualEntrySearch');
  var search = (searchInput ? searchInput.value : '').toLowerCase();

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

  // Blangko = hindi pa nabilang. I-type ang 0 para markahang nabilang na 0.
  var html = '';
  items.forEach(function(it, idx) {
    var counted = icIsCounted(it);
    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + icEsc(it.item_code) + '</code></td>' +
      '<td>' + icEsc(it.description || '—') + '</td>' +
      '<td class="text-center">' + icNum(it.system_qty) + '</td>' +
      '<td><input type="number" class="form-control form-control-sm text-center manual-count-input" ' +
        'data-item-id="' + it.id + '" value="' + (counted ? it.counted_qty : '') + '" placeholder="—" min="0" step="0.01" style="width:90px;margin:0 auto;">' +
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
  if (!_ic.currentSession || _ic.currentSession.status !== 'IN_PROGRESS') {
    icShowToast('Hindi na pwedeng baguhin ang bilang: ' + (_ic.currentSession ? _ic.currentSession.status : ''), 'warning');
    return;
  }

  var inputs = document.querySelectorAll('.manual-count-input');
  var rows = [];
  var invalid = false;

  inputs.forEach(function(input) {
    var raw = String(input.value).trim();
    if (raw === '') return;                       // blangko = hindi nabilang, walang gagalawin
    var itemId = parseInt(input.getAttribute('data-item-id'), 10);
    var newCount = parseFloat(raw);
    if (isNaN(newCount) || newCount < 0) { invalid = true; return; }

    var item = _ic.currentItems.find(function(it) { return it.id === itemId; });
    if (!item) return;

    var remarksInput = document.querySelector('.manual-remarks-input[data-item-id="' + itemId + '"]');
    var remarks = remarksInput ? remarksInput.value.trim() : '';

    var qtyChanged = !icIsCounted(item) || Math.abs(Number(item.counted_qty || 0) - newCount) >= 0.0001;
    var remarksChanged = remarks !== String(item.remarks || '');
    if (!qtyChanged && !remarksChanged) return;

    rows.push({ id: itemId, counted_qty: newCount, remarks: remarks });
  });

  if (invalid) { icShowToast('May maling quantity (dapat 0 o higit pa)', 'warning'); return; }
  if (rows.length === 0) { icShowToast('No changes to save', 'info'); return; }

  try {
    var r = await icRpc('erp_ic_save_manual', {
      p_count_id: _ic.currentSession.id,
      p_rows: rows,
      p_user: icCurrentUser()
    });

    (r.items || []).forEach(icApplyItem);
    icApplyStats(r.stats);

    icShowToast('✅ Saved ' + rows.length + ' item(s)', 'success');
    icUpdateProgress();
    icUpdateRecentScans();
    icUpdateVarianceSummary();

    var m = bootstrap.Modal.getInstance(document.getElementById('manualEntryModal'));
    if (m) m.hide();
  } catch(err) {
    console.error('[icSaveAllManualEntry]', err);
    icShowToast('Failed: ' + err.message, 'danger');
  }
}

window.icSaveAllManualEntry = icSaveAllManualEntry;

// ═══════════════════════════════════════════════════════════
// PRINT
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
    setTimeout(function() { printArea.style.display = 'none'; }, 500);
  }, 200);
}

window.icPrintCountSheet = icPrintCountSheet;

// ═══════════════════════════════════════════════════════════
// VIEW DETAILS
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
  _ic.searchTimer = setTimeout(function() { icRenderSessionList(); }, 300);
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
// GLOBAL EXPORTS
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

console.log('✅ inventory-count.js v1.3 loaded (atomic RPC flow)');
