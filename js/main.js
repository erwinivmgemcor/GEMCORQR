// ============================================================
// MAIN - DOM Ready & Initialization
// ============================================================

// Local HTML escaper (defensive — sheet/user data rendered into innerHTML)
function _escMain(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Local prep-status helpers (used by All Requests renderer) ───
function _prepStatusFromMap(prepMap, docNo) {
  var p = prepMap[docNo];
  var s = p ? String(p.prepStatus || 'NEW').toUpperCase() : 'NEW';
  if (s !== 'PREPARED' && s !== 'PICKED_UP') s = 'NEW';
  return s;
}
function _prepClassFromStatus(s) {
  if (s === 'PREPARED') return 'prep-prepared';
  if (s === 'PICKED_UP') return 'prep-pickedup';
  return 'prep-new';
}
function _prepTagFromStatus(s) {
  var label = s === 'PREPARED' ? 'PREPARED' : (s === 'PICKED_UP' ? 'PICKED UP' : 'NOT PREPARED');
  var icon = s === 'PREPARED' ? 'bi-check-circle-fill'
           : (s === 'PICKED_UP' ? 'bi-box-arrow-up-right' : 'bi-exclamation-circle-fill');
  return '<span class="prep-badge"><i class="bi ' + icon + ' me-1"></i>' + label + '</span>';
}

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

  var warehouseNavItems = ['dashboard', 'allrequests', 'releasing', 'receiving', 'returns', 'editrequests'];
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
    allrequests: 'All Requests',
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

  if (sectionId === 'allrequests') {
    if (typeof loadAllRequests === 'function') setTimeout(loadAllRequests, 100);
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
window.openMyRequestDetails = async function(docNo, docType, opts) {
  opts = opts || {};
  var isWarehouseView = opts.warehouse === true;
  var docStatus = String(opts.status || '').toUpperCase();
  var isCompletedDoc = (docStatus === 'COMPLETED');

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

  if (isWarehouseView) {
    window._editReqMap = {};
  } else {
    try {
      var emUrl = API_URL + '?action=getMyEditRequests&requestor=' + encodeURIComponent(localStorage.getItem('ivm_username') || '') + '&_t=' + Date.now();
      var emRes = await fetch(emUrl, { redirect: 'follow' });
      var emText = await emRes.text();
      var emData = JSON.parse(emText);
      window._editReqMap = (emData.success && emData.map) ? emData.map : {};
    } catch(e) {
      window._editReqMap = {};
    }
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

      var requestor = _escMain(info.Requestor || info.requestor || '');
      var dept = _escMain(info.Department || info.department || '');
      var dateStr = _escMain(info.Date || info.date || info['Date Prepared'] || '');
      var joNo = _escMain(info['JO No.'] || info.joNo || '');
      var gemSo = _escMain(info['GEM SO No.'] || info.gemSoNo || '');
      var client = _escMain(info['Client Name'] || info.clientName || '');
      var project = _escMain(info.Project || info.project || '');
      var safeDocType = _escMain(docType || 'MRIF');

      metaHtml = '<div class="row g-2 mb-3">' +
        (requestor ? '<div class="col-md-6"><strong>Requestor:</strong> ' + requestor + '</div>' : '') +
        (dept ? '<div class="col-md-6"><strong>Department:</strong> ' + dept + '</div>' : '') +
        (dateStr ? '<div class="col-md-6"><strong>Date:</strong> ' + dateStr + '</div>' : '') +
        (joNo ? '<div class="col-md-6"><strong>JO No.:</strong> ' + joNo + '</div>' : '') +
        (gemSo ? '<div class="col-md-6"><strong>GEM SO No.:</strong> ' + gemSo + '</div>' : '') +
        (client ? '<div class="col-md-6"><strong>Client:</strong> ' + client + '</div>' : '') +
        (project ? '<div class="col-md-6"><strong>Project:</strong> ' + project + '</div>' : '') +
        '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-secondary">' + safeDocType + '</span></div>' +
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
          var code = _escMain(it.inventoryId || it.itemCode || it.code || '');
          var desc = _escMain(it.description || it.desc || '');
          var qty = it.expectedQty || it.qty || it.requestedQty || 0;
          var unit = _escMain(it.unit || 'PIECE');
          var remarks = _escMain(it.remarks || 'PENDING');
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
      itemsHtml = '<div class="alert alert-warning">Could not load items: ' + _escMain((data && data.error) || 'Unknown error') + '</div>';
    }
  } catch(err) {
    console.error('[openMyRequestDetails] Error:', err);
    itemsHtml = '<div class="alert alert-warning">Could not load items: ' + _escMain(err.message) + '</div>';
  }

  var safeDocNo2 = _escMain(docNo);
  var jsDoc = String(docNo).replace(/'/g, "\\'");
  var jsType = String(docType || 'MRIF').replace(/'/g, "\\'");

  var actionButtons = '<button class="btn btn-sm btn-outline-primary" onclick="discussDocument(\'' + jsDoc + '\', \'' + jsType + '\')">' +
    '<i class="bi bi-chat-dots me-1"></i>Discuss' +
  '</button>';

  if (isWarehouseView) {
    if (isCompletedDoc) {
      actionButtons += '<span class="btn btn-sm btn-outline-success disabled" title="This document is already fully processed">' +
        '<i class="bi bi-check-circle-fill me-1"></i>Completed' +
      '</span>';
    } else {
      actionButtons += '<button class="btn btn-sm btn-success" onclick="processRequestFromDetails(\'' + jsDoc + '\', \'' + jsType + '\')">' +
        '<i class="bi bi-play-circle me-1"></i>Process Request' +
      '</button>';
    }
  } else {
    actionButtons += _editActionButtonHtml(docNo, docType || 'MRIF');
  }

  content.innerHTML =
    '<div class="text-center mb-3">' +
      '<div class="fw-bold mb-2" style="font-size:1.1rem;">' + safeDocNo2 + '</div>' +
      '<div class="mb-2 d-flex justify-content-center gap-2 flex-wrap">' + actionButtons + '</div>' +
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

// ─── Render My Requests (production view) ───
// Prep status shown ONLY for PENDING / PARTIAL docs. Completed docs get
// a clean "COMPLETED" badge alone — no confusing "NOT PREPARED" label.
var originalRenderMyRequests = window.renderMyRequests || function() {};

window.renderMyRequests = async function(requests) {
  requests = (requests || []).filter(function(req) {
    var t = (req.type || '').toUpperCase();
    return t === 'MRIF' || t === 'MRS';
  });

  var prepMap = {};
  try {
    var prepUrl = API_URL + '?action=getPrepStatuses&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(prepUrl, { redirect: 'follow' }, { timeout: 15000, retries: 0 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data && data.success) prepMap = data.statuses || {};
  } catch(e) { /* silent — fallback to no coloring */ }

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
    var status = (req.status || 'PENDING').toUpperCase();
    var isCompleted = (status === 'COMPLETED');
    var isPartial = (status === 'PARTIAL');
    var badgeClass = isCompleted ? 'success' : (isPartial ? 'info' : 'warning');
    var statusText = isCompleted ? 'COMPLETED' : (isPartial ? 'PARTIAL' : 'PENDING');
    var icon = isCompleted ? 'bi-check-circle-fill' : (isPartial ? 'bi-hourglass-split' : 'bi-clock');
    var docNoRaw = req.docNo || '';
    var docNo = _escMain(docNoRaw);
    var docType = _escMain(req.type || 'MRIF');
    var itemCode = _escMain(req.itemCode || '');
    var qty = parseInt(req.qty, 10) || 0;

    // ★ Prep status only applies to active docs. Completed docs show no prep badge.
    var prepClass = '';
    var prepBadge = '';
    if (!isCompleted) {
      var prepStatus = _prepStatusFromMap(prepMap, docNoRaw);
      prepClass = _prepClassFromStatus(prepStatus);
      prepBadge = _prepTagFromStatus(prepStatus);
    }

    var html = '<div class="list-group-item request-card ' + (isCompleted ? 'completed' : '') + ' ' + prepClass + '" ' +
      'data-docno="' + docNo + '" data-doctype="' + docType + '" ' +
      'style="cursor:pointer;">' +
        '<div class="d-flex justify-content-between align-items-start">' +
          '<div class="flex-grow-1">' +
            '<div class="fw-bold">' + docNo + ' <span class="badge bg-secondary">' + docType + '</span> ' + prepBadge + '</div>' +
            '<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + _escMain(dateStr) + '</div>' +
            '<div class="small mt-1"><i class="bi bi-box me-1"></i>' + itemCode + ' <span class="badge bg-light text-dark">x' + qty + '</span></div>' +
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

// ═══════════════════════════════════════════════════════════════
// ALL REQUESTS (Warehouse view — active + completed)
// Prep status coloring is applied HERE now, per user request.
// ═══════════════════════════════════════════════════════════════

window.loadAllRequests = async function() {
  var container = document.getElementById('allRequestsListPage');
  if (!container) return;

  container.innerHTML = '<div class="list-group-item text-muted text-center py-3">' +
    '<div class="spinner-border spinner-border-sm text-primary me-2"></div>Loading all requests...</div>';

  var typeEl = document.getElementById('allRequestsFilter');
  var statusEl = document.getElementById('allRequestsStatusFilter');
  var filterRaw = typeEl ? typeEl.value : 'MRIF,MRS';
  var statusFilter = statusEl ? statusEl.value : 'all';
  var allowedTypes = (filterRaw || 'MRIF,MRS').split(',').map(function(s) { return s.trim().toUpperCase(); });

  var includeCompleted = (statusFilter !== 'active');

  try {
    var url = API_URL + '?action=getAllPendingDocs&_t=' + Date.now();
    if (includeCompleted) url += '&includeCompleted=1';

    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);
    if (!data.success) throw new Error(data.error || 'Failed to load requests');

    var allDocs = data.documents || [];

    // Badge always reflects true PENDING + PARTIAL count
    var activeCount = allDocs.filter(function(d) {
      var s = (d.status || 'PENDING').toUpperCase();
      return s === 'PENDING' || s === 'PARTIAL';
    }).length;
    var badge = document.getElementById('allRequestsBadgeSidebar');
    if (badge) {
      badge.textContent = activeCount;
      badge.classList.toggle('d-none', activeCount === 0);
    }

    // Fetch prep statuses (needed to color active rows)
    var prepMap = {};
    if (statusFilter !== 'completed') {
      try {
        var prepUrl = API_URL + '?action=getPrepStatuses&_t=' + Date.now();
        var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
        var prepRes = await fetchFn(prepUrl, { redirect: 'follow' }, { timeout: 15000, retries: 0 });
        var prepText = await prepRes.text();
        var prepData = JSON.parse(prepText);
        if (prepData && prepData.success) prepMap = prepData.statuses || {};
      } catch(e) { /* silent — fallback to no coloring */ }
    }

    var docs = allDocs.filter(function(d) {
      var t = (d.docType || '').toUpperCase();
      if (allowedTypes.indexOf(t) === -1) return false;
      var s = (d.status || 'PENDING').toUpperCase();
      if (statusFilter === 'active' && s !== 'PENDING' && s !== 'PARTIAL') return false;
      if (statusFilter === 'completed' && s !== 'COMPLETED') return false;
      return true;
    });

    docs.sort(function(a, b) {
      var ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      var tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });

    renderAllRequests(docs, statusFilter, prepMap);
  } catch(err) {
    console.error('[loadAllRequests] Error:', err);
    container.innerHTML = '<div class="list-group-item text-danger text-center py-3">' +
      '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed to load: ' + _escMain(err.message) + '</div>';
  }
};

function renderAllRequests(docs, statusFilter, prepMap) {
  var container = document.getElementById('allRequestsListPage');
  if (!container) return;
  prepMap = prepMap || {};

  if (!docs || docs.length === 0) {
    var emptyMsg = 'No requests found.';
    var emptyHint = 'New requests from production will appear here automatically.';
    if (statusFilter === 'active') {
      emptyMsg = 'No active requests right now.';
      emptyHint = 'All requests have been processed. Switch the filter to "All Statuses" to review past work.';
    } else if (statusFilter === 'completed') {
      emptyMsg = 'No completed requests yet.';
      emptyHint = 'Processed requests will appear here once they are fully served.';
    }
    container.innerHTML = '<div class="list-group-item text-muted text-center py-4">' +
      '<i class="bi bi-inbox fs-3 d-block mb-2"></i>' +
      '<div>' + emptyMsg + '</div>' +
      '<div class="small mt-1">' + emptyHint + '</div>' +
      '</div>';
    return;
  }

  var html = '';
  docs.forEach(function(req) {
    var docNoRaw = req.docNo || '';
    var docNo = _escMain(docNoRaw);
    var docType = _escMain((req.docType || 'MRIF').toUpperCase());
    var status = (req.status || 'PENDING').toUpperCase();
    var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
    var requestor = _escMain(req.requestor || 'Unknown');
    var itemSummary = _escMain(req.itemSummary || '—');
    var isBal = req.isBal || docNoRaw.toUpperCase().indexOf('BAL.') === 0;

    var isCompleted = (status === 'COMPLETED');
    var isPartial = (status === 'PARTIAL');

    var badgeClass = isCompleted ? 'success' : (isPartial ? 'info text-dark' : 'warning text-dark');
    var icon = isCompleted ? 'bi-check-circle-fill' : (isPartial ? 'bi-hourglass-split' : 'bi-clock');

    var typeBadgeClass = docType === 'MRIF' ? 'bg-warning text-dark'
                        : docType === 'MRR' ? 'bg-success'
                        : docType === 'MRS' ? 'bg-danger'
                        : 'bg-secondary';

    var balTag = isBal ? ' <span class="badge bg-info text-dark">BAL</span>' : '';

    // ★ Prep coloring: ONLY for active (non-completed) docs
    var prepClass = '';
    var prepBadge = '';
    if (!isCompleted) {
      var prepStatus = _prepStatusFromMap(prepMap, docNoRaw);
      prepClass = _prepClassFromStatus(prepStatus);
      prepBadge = _prepTagFromStatus(prepStatus);
    }

    // Processed-by line for completed docs
    var processedByLine = '';
    if (isCompleted && req.processedBy) {
      var processedAtStr = req.processedAt ? new Date(req.processedAt).toLocaleString() : '';
      processedByLine = '<div class="small text-success mt-1">' +
        '<i class="bi bi-person-check-fill me-1"></i>Processed by ' + _escMain(req.processedBy) +
        (processedAtStr ? ' on ' + _escMain(processedAtStr) : '') +
        '</div>';
    }

    var cardClass = 'all-request-card ' + prepClass;
    if (isCompleted) cardClass += ' completed';
    else if (isPartial) cardClass += ' partial';

    html += '<div class="list-group-item ' + cardClass + '" ' +
      'data-docno="' + docNo + '" data-doctype="' + docType + '" data-status="' + _escMain(status) + '" style="cursor:pointer;">' +
        '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2">' +
          '<div class="flex-grow-1" style="min-width:0;">' +
            '<div class="fw-bold">' + docNo +
              ' <span class="badge ' + typeBadgeClass + '">' + docType + '</span>' + balTag +
              ' ' + prepBadge +
            '</div>' +
            '<div class="small text-muted">' +
              '<i class="bi bi-person me-1"></i>' + requestor +
              ' &nbsp; <i class="bi bi-calendar me-1"></i>' + _escMain(dateStr) +
            '</div>' +
            '<div class="small mt-1"><i class="bi bi-box me-1"></i>' + itemSummary + '</div>' +
            processedByLine +
            '<div class="small text-muted mt-1">' +
              '<i class="bi bi-info-circle me-1"></i> Click to view details and discuss' +
              (isCompleted ? '' : ', or process it in the scanner') +
            '</div>' +
          '</div>' +
          '<span class="badge bg-' + badgeClass + '"><i class="bi ' + icon + ' me-1"></i>' + status + '</span>' +
        '</div>' +
      '</div>';
  });

  container.innerHTML = html;

  container.querySelectorAll('.all-request-card').forEach(function(el) {
    el.addEventListener('click', function() {
      var docNo = this.getAttribute('data-docno');
      var docType = this.getAttribute('data-doctype') || 'MRIF';
      var status = this.getAttribute('data-status') || 'PENDING';
      if (docNo) openMyRequestDetails(docNo, docType, { warehouse: true, status: status });
    });
  });
}

window.processRequestFromDetails = function(docNo, docType) {
  if (!docNo || !docType) return;

  var modalEl = document.getElementById('myRequestDetailsModal');
  if (modalEl) {
    var m = bootstrap.Modal.getInstance(modalEl);
    if (m) m.hide();
  }

  setTimeout(function() {
    if (typeof openPendingNormalFlow === 'function') {
      openPendingNormalFlow(docNo, docType);
      return;
    }
    var sectionMap = { 'MRIF': 'releasing', 'MRR': 'receiving', 'MRS': 'returns' };
    if (typeof navigateTo === 'function') navigateTo(sectionMap[docType] || 'releasing');
    setTimeout(function() {
      if (typeof selectModule === 'function' && typeof onDocSelect === 'function') {
        selectModule(docType).then(function() { onDocSelect(docNo); });
      }
    }, 300);
  }, 300);
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
