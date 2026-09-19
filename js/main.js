// ============================================================
// MAIN - DOM Ready & Initialization
// ============================================================

window.applySidebarRole = function(role) {
  var isProduction = (role === 'production');
  var isWarehouse = (role === 'warehouse');
  var hasBoth = (typeof _hasBothRoles === 'function') ? _hasBothRoles() : false;

  var sidebarRole = document.getElementById('sidebarRole');
  if (sidebarRole) {
    sidebarRole.textContent = isProduction
      ? 'Production Mode'
      : (state.currentUser ? state.currentUserFullname : 'Warehouse');
  }

  var warehouseNavItems = ['dashboard', 'releasing', 'receiving', 'returns', 'editrequests'];
  var productionNavItems = ['requests', 'myrequests'];

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(el) {
    var section = el.dataset.section;
    if (section === 'switchmode') return;

    if (warehouseNavItems.indexOf(section) !== -1) {
      el.style.display = isProduction ? 'none' : 'flex';
    } else if (productionNavItems.indexOf(section) !== -1) {
      el.style.display = isProduction ? 'flex' : 'none';
    } else {
      el.style.display = 'flex';
    }
  });

  var logoutItem = document.getElementById('logoutNavItem');
  if (logoutItem) {
    logoutItem.style.display = (isWarehouse || isProduction) && state.currentUser ? 'flex' : 'none';
  }

  if (isProduction) {
    navigateTo('myrequests');
  } else {
    navigateTo('dashboard');
  }
};

function navigateTo(sectionId) {
  document.querySelectorAll('.section-page').forEach(function(el) {
    el.classList.remove('active');
  });
  var target = document.getElementById('section-' + sectionId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(el) {
    el.classList.remove('active');
    if (el.dataset.section === sectionId) el.classList.add('active');
  });

  toggleSidebar(false);

  var titles = {
    dashboard: 'Dashboard',
    releasing: 'Releasing (MRIF)',
    receiving: 'Receiving (MRR)',
    returns: 'Returns (MRS)',
    requests: 'New Request',
    myrequests: 'My Requests',
    messages: 'Messages',
    inventory: 'Inventory',
    settings: 'Settings',
    about: 'About / Instructions'
  };
  var titleEl = document.getElementById('pageTitle');
  if (titleEl && titles[sectionId]) titleEl.textContent = titles[sectionId];

  if (sectionId === 'releasing' || sectionId === 'receiving' || sectionId === 'returns') {
    var modMap = { releasing: 'MRIF', receiving: 'MRR', returns: 'MRS' };
    var mod = modMap[sectionId];
    if (mod) {
      state.currentModule = mod;
      var labelEl = document.getElementById('moduleLabel');
      if (labelEl) labelEl.textContent = mod;
      var mrifCard = document.getElementById('mrifListCard');
      var mrrCard = document.getElementById('mrrListCard');
      var mrsCard = document.getElementById('mrsListCard');
      if (mrifCard) mrifCard.classList.toggle('d-none', mod !== 'MRIF');
      if (mrrCard) mrrCard.classList.toggle('d-none', mod !== 'MRR');
      if (mrsCard) mrsCard.classList.toggle('d-none', mod !== 'MRS');
      if (typeof fetchPendingDocs === 'function') fetchPendingDocs();
    }
  }

  if (sectionId === 'dashboard') {
    var role = localStorage.getItem('ivm_userRole');
    if (role === 'warehouse' && !window.analyticsLoaded) setTimeout(loadAnalytics, 300);
    if (role === 'warehouse' && typeof updatePartialCount === 'function') setTimeout(updatePartialCount, 500);
  }

  if (sectionId === 'myrequests') {
    if (typeof loadMyRequests === 'function') setTimeout(loadMyRequests, 100);
  }

  if (sectionId === 'messages') {
    if (typeof openChatSection === 'function') setTimeout(openChatSection, 50);
  }
}

function toggleSidebar(open) {
  var sidebar = document.getElementById('sidebar');
  var backdrop = document.getElementById('sidebarBackdrop');
  if (open) {
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('show');
  } else {
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
  }
}

// ─── Edit request action button helper ───
function _editActionButtonHtml(docNo, docType) {
  var map = window._editReqMap || {};
  var entry = map[docNo];
  var safeDoc = String(docNo).replace(/'/g, "\\'");
  var safeType = String(docType || 'MRIF').replace(/'/g, "\\'");

  if (!entry) {
    return '<button class="btn btn-sm btn-outline-warning" onclick="requestEditPermissionFromUser(\'' + safeDoc + '\', \'' + safeType + '\')">' +
      '<i class="bi bi-pencil me-1"></i>Request Edit' +
    '</button>';
  }
  if (entry.status === 'PENDING') {
    return '<span class="btn btn-sm btn-outline-secondary disabled" title="Waiting for warehouse approval">' +
      '<i class="bi bi-hourglass-split me-1"></i>Edit Pending Approval' +
    '</span>';
  }
  if (entry.status === 'APPROVED') {
    return '<button class="btn btn-sm btn-success" onclick="openRequestEditModal(\'' + safeDoc + '\', \'' + safeType + '\')">' +
      '<i class="bi bi-pencil-square me-1"></i>Edit Now' +
    '</button>';
  }
  if (entry.status === 'REJECTED') {
    var reason = entry.rejectReason ? ' title="' + String(entry.rejectReason).replace(/"/g, '&quot;') + '"' : '';
    return '<button class="btn btn-sm btn-outline-danger" onclick="requestEditPermissionFromUser(\'' + safeDoc + '\', \'' + safeType + '\')"' + reason + '>' +
      '<i class="bi bi-x-circle me-1"></i>Rejected — Request Again' +
    '</button>';
  }
  if (entry.status === 'COMPLETED') {
    return '<button class="btn btn-sm btn-outline-warning" onclick="requestEditPermissionFromUser(\'' + safeDoc + '\', \'' + safeType + '\')">' +
      '<i class="bi bi-pencil me-1"></i>Request Edit' +
    '</button>';
  }
  return '';
}

// ─── My Request Details ───
window.openMyRequestDetails = async function(docNo, docType) {
  var modalEl = document.getElementById('myRequestDetailsModal');
  if (!modalEl) {
    if (typeof openRequestDetails === 'function') {
      openRequestDetails(docNo, docType);
      return;
    }
    showToast('Details modal not found', 'danger');
    return;
  }

  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  var content = document.getElementById('myRequestDetailsContent');
  if (!content) return;

  content.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="text-muted mt-2">Loading request details...</div></div>';
  modal.show();

  // Load edit request map for this user
  try {
    var emUrl = API_URL + '?action=getMyEditRequests&requestor=' + encodeURIComponent(localStorage.getItem('ivm_username') || '') + '&_t=' + Date.now();
    var emRes = await fetch(emUrl, { redirect: 'follow' });
    var emText = await emRes.text();
    var emData = JSON.parse(emText);
    window._editReqMap = (emData.success && emData.map) ? emData.map : {};
  } catch(e) {
    window._editReqMap = {};
  }

  var appUrl = window.location.origin + window.location.pathname;
  var qrData = appUrl + '?doc=' + encodeURIComponent(docNo);
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(qrData);

  var itemsHtml = '';
  var metaHtml = '';

  try {
    var sheetKey = 'sheetId_' + (docType || 'MRIF');
    var sheetIdVal = localStorage.getItem(sheetKey);
    var sheetIdClean = sheetIdVal ? extractSheetId(sheetIdVal) : '';

    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
              '&docType=' + (docType || 'MRIF') +
              '&sheetId=' + encodeURIComponent(sheetIdClean) +
              '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);

    if (data && data.success) {
      var info = data.info || {};
      var items = data.items || [];

      var requestor = info.Requestor || info.requestor || '';
      var dept = info.Department || info.department || '';
      var dateStr = info.Date || info.date || info['Date Prepared'] || '';
      var joNo = info['JO No.'] || info.joNo || '';
      var gemSo = info['GEM SO No.'] || info.gemSoNo || '';
      var client = info['Client Name'] || info.clientName || '';
      var project = info.Project || info.project || '';

      metaHtml = '<div class="row g-2 mb-3">' +
        (requestor ? '<div class="col-md-6"><strong>Requestor:</strong> ' + requestor + '</div>' : '') +
        (dept ? '<div class="col-md-6"><strong>Department:</strong> ' + dept + '</div>' : '') +
        (dateStr ? '<div class="col-md-6"><strong>Date:</strong> ' + dateStr + '</div>' : '') +
        (joNo ? '<div class="col-md-6"><strong>JO No.:</strong> ' + joNo + '</div>' : '') +
        (gemSo ? '<div class="col-md-6"><strong>GEM SO No.:</strong> ' + gemSo + '</div>' : '') +
        (client ? '<div class="col-md-6"><strong>Client:</strong> ' + client + '</div>' : '') +
        (project ? '<div class="col-md-6"><strong>Project:</strong> ' + project + '</div>' : '') +
        '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-secondary">' + (docType || 'MRIF') + '</span></div>' +
        '</div>';

      if (items.length > 0) {
        itemsHtml = '<h6 class="mt-2"><i class="bi bi-box-seam me-1"></i>Requested Items (' + items.length + ')</h6>';
        itemsHtml += '<div class="table-responsive"><table class="table table-sm table-bordered mb-0">';
        itemsHtml += '<thead class="table-light"><tr>' +
          '<th style="width:5%">#</th>' +
          '<th style="width:22%">Item Code</th>' +
          '<th>Description</th>' +
          '<th class="text-center" style="width:10%">Qty</th>' +
          '<th class="text-center" style="width:10%">Unit</th>' +
          '<th style="width:15%">Remarks</th>' +
          '</tr></thead><tbody>';

        items.forEach(function(it, idx) {
          var code = it.inventoryId || it.itemCode || it.code || '';
          var desc = it.description || it.desc || '';
          var qty = it.expectedQty || it.qty || it.requestedQty || 0;
          var unit = it.unit || 'PIECE';
          var remarks = it.remarks || 'PENDING';
          itemsHtml += '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td><code>' + code + '</code></td>' +
            '<td>' + desc + '</td>' +
            '<td class="text-center">' + qty + '</td>' +
            '<td class="text-center">' + unit + '</td>' +
            '<td>' + remarks + '</td>' +
            '</tr>';
        });
        itemsHtml += '</tbody></table></div>';
      } else {
        itemsHtml = '<div class="alert alert-info">No items found in this request.</div>';
      }
    } else {
      itemsHtml = '<div class="alert alert-warning">Could not load items: ' + ((data && data.error) || 'Unknown error') + '</div>';
    }
  } catch(err) {
    console.error('[openMyRequestDetails] Error:', err);
    itemsHtml = '<div class="alert alert-warning">Could not load items: ' + err.message + '</div>';
  }

  content.innerHTML =
    '<div class="text-center mb-3">' +
      '<div class="fw-bold mb-2" style="font-size:1.1rem;">' + docNo + '</div>' +
      '<div class="mb-2 d-flex justify-content-center gap-2 flex-wrap">' +
        '<button class="btn btn-sm btn-outline-primary" onclick="discussDocument(\'' + docNo + '\', \'' + (docType || 'MRIF') + '\')">' +
          '<i class="bi bi-chat-dots me-1"></i>Discuss' +
        '</button>' +
        _editActionButtonHtml(docNo, docType || 'MRIF') +
      '</div>' +
      '<img id="myRequestQrImg" src="' + qrUrl + '" alt="QR" style="max-width:220px;width:100%;border:1px solid #ddd;border-radius:8px;padding:8px;background:#fff;">' +
      '<div class="mt-2">' +
        '<button class="btn btn-sm btn-success" onclick="downloadMyRequestQr()"><i class="bi bi-download me-1"></i>Download QR</button>' +
      '</div>' +
    '</div>' +
    '<hr>' +
    metaHtml +
    itemsHtml;

  window._myReqLastDocNo = docNo;
};

window.downloadMyRequestQr = function() {
  var img = document.getElementById('myRequestQrImg');
  if (!img || !img.src) { showToast('No QR to download', 'warning'); return; }
  var docNo = window._myReqLastDocNo || 'request';
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  var qrImg = new Image();
  qrImg.crossOrigin = 'Anonymous';
  qrImg.onload = function() {
    var padding = 24;
    var textHeight = 50;
    canvas.width = qrImg.width + padding * 2;
    canvas.height = qrImg.height + padding * 2 + textHeight;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('Doc: ' + docNo, canvas.width / 2, 10);
    ctx.drawImage(qrImg, padding, padding + textHeight);
    var link = document.createElement('a');
    link.download = 'QR-' + docNo + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  qrImg.onerror = function() { showToast('Failed to load QR image', 'danger'); };
  qrImg.src = img.src;
};

// ─── Render My Requests with Prep Status coloring ───
var originalRenderMyRequests = window.renderMyRequests || function() {};

window.renderMyRequests = async function(requests) {
  requests = (requests || []).filter(function(req) {
    var t = (req.type || '').toUpperCase();
    return t === 'MRIF' || t === 'MRS';
  });

  // Load prep statuses for color-coding
  var prepMap = {};
  try {
    var prepUrl = API_URL + '?action=getPrepStatuses&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(prepUrl, { redirect: 'follow' }, { timeout: 15000, retries: 0 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data && data.success) prepMap = data.statuses || {};
  } catch(e) { /* silent — fallback to no coloring */ }

  function prepCls(docNo) {
    var p = prepMap[docNo];
    var s = p ? String(p.prepStatus || 'NEW').toUpperCase() : 'NEW';
    if (s === 'PREPARED') return 'prep-prepared';
    if (s === 'PICKED_UP') return 'prep-pickedup';
    return 'prep-new';
  }
  function prepTag(docNo) {
    var p = prepMap[docNo];
    var s = p ? String(p.prepStatus || 'NEW').toUpperCase() : 'NEW';
    var label = s === 'PREPARED' ? 'PREPARED' : (s === 'PICKED_UP' ? 'PICKED UP' : 'NOT PREPARED');
    var icon = s === 'PREPARED' ? 'bi-check-circle-fill' : (s === 'PICKED_UP' ? 'bi-box-arrow-up-right' : 'bi-exclamation-circle-fill');
    return '<span class="prep-badge"><i class="bi ' + icon + ' me-1"></i>' + label + '</span>';
  }

  // Call the original renderer (if it was defined elsewhere) with filtered list
  if (typeof originalRenderMyRequests === 'function') {
    try { originalRenderMyRequests(requests); } catch(e) { console.warn('[renderMyRequests] Original error:', e); }
  }

  var container = document.getElementById('myRequestsListPage');
  if (!container) return;
  container.innerHTML = '';
  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted text-center py-4">' +
      '<i class="bi bi-inbox fs-3 d-block mb-2"></i>' +
      'No requests found.</div>';
    return;
  }

  var readyCount = 0;
  requests.forEach(function(req) {
    var status = req.status || 'PENDING';
    if (status !== 'PENDING') readyCount++;
  });
  var badge1 = document.getElementById('myRequestsBadgeSidebar');
  var badge2 = document.getElementById('myRequestsBadgePage');
  if (badge1) { badge1.textContent = readyCount; badge1.classList.toggle('d-none', readyCount === 0); }
  if (badge2) { badge2.textContent = readyCount; badge2.classList.toggle('d-none', readyCount === 0); }

  requests.forEach(function(req) {
    var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
    var status = req.status || 'PENDING';
    var isCompleted = (status === 'COMPLETED');
    var isPartial = (status === 'PARTIAL');
    var badgeClass = isCompleted ? 'success' : (isPartial ? 'info' : 'warning');
    var statusText = isCompleted ? 'COMPLETED' : (isPartial ? 'PARTIAL' : 'PENDING');
    var icon = isCompleted ? 'bi-check-circle-fill' : (isPartial ? 'bi-hourglass-split' : 'bi-clock');
    var docNo = req.docNo || '';
    var docType = req.type || 'MRIF';

    var prepClass = prepCls(docNo);
    var prepBadge = prepTag(docNo);

    var html = '<div class="list-group-item request-card ' + (isCompleted ? 'completed' : '') + ' ' + prepClass + '" ' +
      'data-docno="' + docNo + '" data-doctype="' + docType + '" ' +
      'style="cursor:pointer;">' +
        '<div class="d-flex justify-content-between align-items-start">' +
          '<div class="flex-grow-1">' +
            '<div class="fw-bold">' + docNo + ' <span class="badge bg-secondary">' + docType + '</span> ' + prepBadge + '</div>' +
            '<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + dateStr + '</div>' +
            '<div class="small mt-1"><i class="bi bi-box me-1"></i>' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
            '<div class="small text-muted mt-1"><i class="bi bi-info-circle me-1"></i> Click to view QR &amp; requested items</div>' +
          '</div>' +
          '<span class="badge bg-' + badgeClass + '"><i class="bi ' + icon + ' me-1"></i>' + statusText + '</span>' +
        '</div>' +
      '</div>';
    container.innerHTML += html;
  });

  container.querySelectorAll('.request-card').forEach(function(el) {
    el.addEventListener('click', function() {
      var docNo = this.getAttribute('data-docno');
      var docType = this.getAttribute('data-doctype') || 'MRIF';
      if (docNo) openMyRequestDetails(docNo, docType);
    });
  });
};

// ─── Wrappers ───
var originalLoadMyRequests = window.loadMyRequests || function() {};
window.loadMyRequests = function() {
  if (typeof originalLoadMyRequests === 'function') {
    try { originalLoadMyRequests(); } catch(e) {}
  }
};

var originalUpdateWarehouseKPIs = window.updateWarehouseKPIs || function() {};
window.updateWarehouseKPIs = function() {
  if (typeof originalUpdateWarehouseKPIs === 'function') {
    try { originalUpdateWarehouseKPIs(); } catch(e) {}
  }
};

// ─── Test connection ───
async function testConnection() {
  var resultDiv = document.getElementById('testResult');
  if (!resultDiv) return;
  resultDiv.classList.remove('d-none');
  resultDiv.textContent = 'Testing...';
  try {
    var url = API_URL + '?action=ping&_t=' + Date.now();
    resultDiv.textContent += '\nURL: ' + url.substring(0, 80) + '...';
    var res = await fetch(url, { redirect: 'follow' });
    resultDiv.textContent += '\nHTTP Status: ' + res.status;
    var text = await res.text();
    resultDiv.textContent += '\nRaw Response: ' + text.substring(0, 200);
    try {
      var data = JSON.parse(text);
      resultDiv.textContent += '\nParsed: ' + JSON.stringify(data, null, 2);
      if (data.success) resultDiv.textContent += '\n✅ CONNECTION OK';
      else resultDiv.textContent += '\n⚠️ Error: ' + data.error;
    } catch(e) {
      resultDiv.textContent += '\n❌ Response is not valid JSON!';
    }
  } catch(err) {
    resultDiv.textContent += '\n❌ FETCH FAILED: ' + err.message;
  }
}

// ─── URL doc parameter ───
function checkUrlDocParam() {
  var params = new URLSearchParams(window.location.search);
  var docNo = params.get('doc');
  if (!docNo) return;

  var docType = 'MRIF';
  if (docNo.indexOf('MRR') === 0) docType = 'MRR';
  else if (docNo.indexOf('MRS') === 0) docType = 'MRS';
  else if (docNo.indexOf('Bal.MRIF') === 0) docType = 'MRIF';

  if (window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  var role = localStorage.getItem('ivm_userRole');
  if (role === 'warehouse') {
    selectModule(docType).then(function() {
      setTimeout(function() { onDocSelect(docNo); }, 300);
    }).catch(function() {
      showToast('Could not open document: ' + cleanDocNo(docNo), 'warning');
    });
  } else {
    showToast('Document ' + cleanDocNo(docNo) + ' scanned. Switch to Warehouse mode to process.', 'info');
  }
}

// ─── DOM Ready ───
document.addEventListener('DOMContentLoaded', function() {
  var sidebarVer = document.getElementById('sidebarAppVersion');
  if (sidebarVer && typeof APP_VERSION !== 'undefined') {
    sidebarVer.textContent = 'v' + APP_VERSION;
  }

  var modalIds = ['qtyModal', 'successModal', 'settingsModal', 'newRequestModal',
    'requestSuccessModal', 'whNotifModal', 'mrifListModal', 'mrifPrintModal',
    'pendingMrifModal', 'mrrListModal', 'mrrPrintModal', 'mrsListModal',
    'mrsPrintModal', 'quickScanModal', 'roleModal', 'productionNameModal',
    'batchVerifyModal', 'qrZoomModal', 'poScanModal', 'poItemsModal', 'loginModal',
    'editRequestsModal', 'editRequestModal'];

  modalIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (id === 'qtyModal') qtyModal = new bootstrap.Modal(el);
    else if (id === 'successModal') successModal = new bootstrap.Modal(el);
    else if (id === 'settingsModal') settingsModal = new bootstrap.Modal(el);
    else if (id === 'newRequestModal') newRequestModal = new bootstrap.Modal(el);
    else if (id === 'requestSuccessModal') requestSuccessModal = new bootstrap.Modal(el);
    else if (id === 'whNotifModal') whNotifModal = new bootstrap.Modal(el);
    else if (id === 'mrifListModal') mrifListModal = new bootstrap.Modal(el);
    else if (id === 'mrifPrintModal') mrifPrintModal = new bootstrap.Modal(el);
    else if (id === 'pendingMrifModal') pendingMrifModal = new bootstrap.Modal(el);
    else if (id === 'mrrListModal') mrrListModal = new bootstrap.Modal(el);
    else if (id === 'mrrPrintModal') mrrPrintModal = new bootstrap.Modal(el);
    else if (id === 'mrsListModal') mrsListModal = new bootstrap.Modal(el);
    else if (id === 'mrsPrintModal') mrsPrintModal = new bootstrap.Modal(el);
    else if (id === 'quickScanModal') quickScanModal = new bootstrap.Modal(el);
    else if (id === 'roleModal') roleModal = new bootstrap.Modal(el);
    else if (id === 'productionNameModal') productionNameModal = new bootstrap.Modal(el);
    else if (id === 'batchVerifyModal') batchVerifyModal = new bootstrap.Modal(el);
    else if (id === 'qrZoomModal') qrZoomModal = new bootstrap.Modal(el);
    else if (id === 'poScanModal') state.poScanModal = new bootstrap.Modal(el);
    else if (id === 'poItemsModal') state.poItemsModal = new bootstrap.Modal(el);
    else if (id === 'loginModal') window.loginModalEl = el;
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/GEMCORQR/sw.js').catch(function() {});
  }

  initRole();

  setTimeout(function() {
    var role = localStorage.getItem('ivm_userRole');
    if (role === 'warehouse' && state.currentUser) {
      setTimeout(loadAnalytics, 800);
      if (typeof updatePartialCount === 'function') setTimeout(updatePartialCount, 1000);
    }
  }, 1500);

  var dateInput = document.getElementById('mrrReceivingDate');
  if (dateInput) dateInput.valueAsDate = new Date();

  setTimeout(checkUrlDocParam, 1500);

  if ('requestIdleCallback' in window) {
    requestIdleCallback(function() {
      if (typeof state !== 'undefined' && state.userRole === 'warehouse') {
        if (typeof loadRequestInventory === 'function') loadRequestInventory().catch(function(){});
        if (typeof loadVendorList === 'function') loadVendorList().catch(function(){});
        if (typeof loadIvmTeamList === 'function') loadIvmTeamList().catch(function(){});
      }
    }, { timeout: 3000 });
  }

  document.addEventListener('click', function(e) {
    var sidebar = document.getElementById('sidebar');
    var toggleBtn = document.querySelector('.sidebar-toggle');
    if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open')) {
      var isClickInside = sidebar.contains(e.target) || (toggleBtn && toggleBtn.contains(e.target));
      if (!isClickInside) toggleSidebar(false);
    }
  });
});
