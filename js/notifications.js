// ============================================================
// WAREHOUSE NOTIFICATIONS
// v3 — Partial MRR / Partial MRIF KPI + modals
//      + 5 min polling, cache-first
// ============================================================

(function() {
  if (typeof getCache === 'undefined') {
    window.getCache = function() { return null; };
    window.setCache = function() {};
    window.clearCache = function() {};
  }
})();

(function() {
  "use strict";

  var POLL_INTERVAL = 5 * 60 * 1000;

  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ═══════════════════════════════════════════════════════════
  // KPI UPDATER
  // ═══════════════════════════════════════════════════════════
  window.updateWarehouseKPIs = async function() {
    try {
      // ─── Fetch partial MRR count ───
      var partialMrrCount = 0;
      try {
        var mrrUrl = API_URL + '?action=getPartialDocsByType&docType=MRR&_t=' + Date.now();
        var mrrRes = await fetch(mrrUrl, { redirect: 'follow' });
        var mrrText = await mrrRes.text();
        var mrrData;
        try { mrrData = JSON.parse(mrrText); } catch(e) { mrrData = {}; }
        if (mrrData.success) partialMrrCount = (mrrData.documents || []).length;
      } catch(e) { console.warn('[KPI] Partial MRR fetch failed:', e); }

      // ─── Fetch partial MRIF count ───
      var partialMrifCount = 0;
      try {
        var mrifUrl = API_URL + '?action=getPartialDocsByType&docType=MRIF&_t=' + Date.now();
        var mrifRes = await fetch(mrifUrl, { redirect: 'follow' });
        var mrifText = await mrifRes.text();
        var mrifData;
        try { mrifData = JSON.parse(mrifText); } catch(e) { mrifData = {}; }
        if (mrifData.success) partialMrifCount = (mrifData.documents || []).length;
      } catch(e) { console.warn('[KPI] Partial MRIF fetch failed:', e); }

      // ─── Fetch pending count ───
      var pendingCount = 0;
      try {
        var pendingUrl = API_URL + '?action=getAllPendingDocs&_t=' + Date.now();
        var pendingRes = await fetch(pendingUrl, { redirect: 'follow' });
        var pendingText = await pendingRes.text();
        var pendingData;
        try { pendingData = JSON.parse(pendingText); } catch(e) { pendingData = {}; }
        var allDocs = (pendingData && pendingData.documents) || [];
        pendingCount = allDocs.filter(function(d) {
          return String(d.status || '').toUpperCase() === 'PENDING';
        }).length;
      } catch(e) { console.warn('[KPI] Pending fetch failed:', e); }

      // ─── Total / Completed from sheet-count endpoint ───
      var totalCount = 0;
      var completedCount = 0;
      try {
        var sheetId = getCleanSheetId() || '';
        var countUrl = API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
        var countRes = await fetch(countUrl, { redirect: 'follow' });
        var countText = await countRes.text();
        var countData;
        try { countData = JSON.parse(countText); } catch(e) { countData = {}; }
        completedCount = countData.completedCount || 0;
        totalCount = countData.totalCount || 0;
      } catch(e) { console.warn('[KPI] Count fetch failed:', e); }

      // ─── Update DOM ───
      var kpiActive = document.getElementById('kpiActiveDocs');
      var kpiPending = document.getElementById('kpiPending');
      var kpiPartialMrr = document.getElementById('kpiPartialMrr');
      var kpiPartialMrif = document.getElementById('kpiPartial');
      var kpiCompleted = document.getElementById('kpiCompleted');

      if (kpiActive) kpiActive.textContent = totalCount;
      if (kpiPending) kpiPending.textContent = pendingCount;
      if (kpiPartialMrr) kpiPartialMrr.textContent = partialMrrCount;
      if (kpiPartialMrif) kpiPartialMrif.textContent = partialMrifCount;
      if (kpiCompleted) kpiCompleted.textContent = completedCount;

      console.log('[KPI] Pending:', pendingCount, '| Partial MRR:', partialMrrCount, '| Partial MRIF:', partialMrifCount);
    } catch(e) { console.error('[KPI] Error:', e); }
  };

  // ═══════════════════════════════════════════════════════════
  // PROCESS NOTIFICATIONS (badge + list)
  // ═══════════════════════════════════════════════════════════
  function processNotifications(requests) {
    if (!requests) requests = [];
    var today = new Date();
    var sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    var currentMrifId = localStorage.getItem('sheetId_MRIF') || '';

    var filtered = requests.filter(function(req) {
      var reqDate = new Date(req.timestamp);
      var type = (req.type || '').toUpperCase();
      if (reqDate < sevenDaysAgo || (type !== 'MRIF' && type !== 'MRS')) return false;
      if (currentMrifId && req.url) {
        var reqUrl = String(req.url || '');
        if (reqUrl.indexOf(currentMrifId) === -1) return false;
      }
      return true;
    });
    filtered.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

    var prevCount = parseInt(localStorage.getItem('ivm_whNotifCount') || '0');
    var newCount = filtered.length;
    localStorage.setItem('ivm_whNotifCount', newCount);

    if (newCount > prevCount) {
      var diff = newCount - prevCount;
      playSuccessBeep();
      showToast(diff + ' new request(s) received!', 'warning');
    }

    var badge = document.getElementById('whNotifBadge');
    if (badge) {
      badge.textContent = newCount;
      badge.classList.toggle('d-none', newCount === 0);
    }

    renderWarehouseNotifications(filtered);
  }

  // ═══════════════════════════════════════════════════════════
  // LOAD / REFRESH
  // ═══════════════════════════════════════════════════════════
  window.loadWarehouseNotifications = async function(forceRefresh) {
    if (localStorage.getItem('ivm_userRole') === 'production') return;

    const cacheKey = 'pendingRequests';
    if (!forceRefresh) {
      const cached = getCache(cacheKey);
      if (cached) {
        processNotifications(cached);
        return;
      }
    }
    await refreshNotifications();
  };

  async function refreshNotifications() {
    try {
      var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.requests) {
        setCache('pendingRequests', data.requests, 5 * 60 * 1000);
        processNotifications(data.requests);
      } else {
        processNotifications([]);
      }
    } catch(e) {
      console.error('[WH Notifications] Error:', e);
      processNotifications([]);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER WAREHOUSE NOTIFICATION DROPDOWN (top-bar list)
  // ═══════════════════════════════════════════════════════════
  window.renderWarehouseNotifications = function(requests) {
    var container = document.getElementById('whNotificationsList');
    if (!container) return;
    container.innerHTML = '';
    if (requests.length === 0) return;

    requests.slice(0, 5).forEach(function(req) {
      var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
      var docNo = _esc(req.docNo || '');
      var type = _esc(req.type || 'MRIF');
      var requestor = _esc(req.requestor || 'Unknown');

      container.innerHTML += '<div class="list-group-item wh-notif-item py-2">' +
        '<div class="d-flex justify-content-between align-items-start">' +
        '<div>' +
        '<div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
        '<div class="requestor"><i class="bi bi-person me-1"></i>' + requestor + '</div>' +
        '<div class="timestamp"><i class="bi bi-clock me-1"></i>' + _esc(dateStr) + '</div>' +
        '</div>' +
        '<span class="badge bg-warning text-dark">PENDING</span>' +
        '</div></div>';
    });
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER WH NOTIF MODAL
  // ═══════════════════════════════════════════════════════════
  window.renderWhNotifModal = function(requests) {
    var container = document.getElementById('whNotifModalList');
    if (!container) return;
    container.innerHTML = '';
    if (requests.length === 0) {
      container.innerHTML = '<div class="list-group-item text-muted text-center py-3">No pending requests</div>';
      return;
    }
    requests.forEach(function(req) {
      var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
      var docNo = _esc(req.docNo || '');
      var type = _esc(req.type || 'MRIF');
      var requestor = _esc(req.requestor || 'Unknown');

      container.innerHTML += '<div class="list-group-item wh-notif-item py-3">' +
        '<div><div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
        '<div class="requestor"><i class="bi bi-person me-1"></i>' + requestor + '</div>' +
        '<div class="timestamp"><i class="bi bi-clock me-1"></i>' + _esc(dateStr) + '</div></div></div>';
    });
  };

  // ═══════════════════════════════════════════════════════════
  // OPEN WH NOTIF MODAL
  // ═══════════════════════════════════════════════════════════
  window.openWhNotifications = function() {
    if (!whNotifModal && document.getElementById('whNotifModal')) {
      whNotifModal = new bootstrap.Modal(document.getElementById('whNotifModal'));
    }
    if (whNotifModal) whNotifModal.show();
    loadAndRenderWhModal();
  };

  async function loadAndRenderWhModal() {
    var container = document.getElementById('whNotifModalList');
    if (container) {
      container.innerHTML = '<div class="list-group-item text-center py-3">' +
        '<div class="spinner-border spinner-border-sm text-primary"></div></div>';
    }
    try {
      var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.requests) {
        var today = new Date();
        var todayStr = today.getFullYear() + '-' +
                       String(today.getMonth() + 1).padStart(2, '0') + '-' +
                       String(today.getDate()).padStart(2, '0');
        var filtered = data.requests.filter(function(req) {
          var reqDate = new Date(req.timestamp);
          var reqStr = reqDate.getFullYear() + '-' +
                       String(reqDate.getMonth() + 1).padStart(2, '0') + '-' +
                       String(reqDate.getDate()).padStart(2, '0');
          var type = (req.type || '').toUpperCase();
          return reqStr === todayStr && type === 'MRIF';
        });
        renderWhNotifModal(filtered);
      } else {
        renderWhNotifModal([]);
      }
    } catch(e) {
      renderWhNotifModal([]);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PROCESS A REQUEST FROM THE NOTIFICATION LIST
  // ═══════════════════════════════════════════════════════════
  window.processRequestFromNotification = async function(docNo, docType) {
    if (typeof navigateTo === 'function') navigateTo('releasing');
    await new Promise(resolve => setTimeout(resolve, 300));
    state.currentModule = docType;
    updateLabels();
    var sheetId = getCleanSheetId();
    if (!sheetId) {
      await syncModuleLinks();
      sheetId = getCleanSheetId();
      if (!sheetId) return;
    }
    try {
      await onDocSelect(docNo);
      showToast('Loaded ' + cleanDocNo(docNo), 'success');
    } catch(err) {
      showToast('Failed to load document: ' + err.message, 'danger');
    }
  };

  // ═══════════════════════════════════════════════════════════
  // CLEAR NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════
  window.clearWhNotifications = function() {
    if (!confirm('Clear all warehouse notifications?')) return;
    localStorage.setItem('ivm_whNotifCount', '0');
    var badge = document.getElementById('whNotifBadge');
    if (badge) badge.classList.add('d-none');
    clearCache('pendingRequests');
    showToast('Notifications cleared', 'info');
  };

  // ═══════════════════════════════════════════════════════════
  // POLLING
  // ═══════════════════════════════════════════════════════════
  window.startNotificationPolling = function() {
    if (window._whPollInterval) clearInterval(window._whPollInterval);
    loadWarehouseNotifications();
    window._whPollInterval = setInterval(function() {
      if (!state.isLoading) loadWarehouseNotifications();
    }, POLL_INTERVAL);
  };

  window.stopNotificationPolling = function() {
    if (window._whPollInterval) {
      clearInterval(window._whPollInterval);
      window._whPollInterval = null;
    }
  };

  // ═══════════════════════════════════════════════════════════
  // PARTIAL MRR MODAL
  // ═══════════════════════════════════════════════════════════
  window.openPartialMrrModal = async function() {
    await _openPartialDocModal('MRR');
  };

  // ═══════════════════════════════════════════════════════════
  // PARTIAL MRIF MODAL
  // ═══════════════════════════════════════════════════════════
  window.openPartialMrifModal = async function() {
    await _openPartialDocModal('MRIF');
  };

  // ═══════════════════════════════════════════════════════════
  // SHARED PARTIAL DOC MODAL
  // ═══════════════════════════════════════════════════════════
  async function _openPartialDocModal(docType) {
    showLoading('Loading partial ' + docType + 's...');
    try {
      var url = API_URL + '?action=getPartialDocsByType&docType=' + docType + '&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var text = await res.text();
      var data;
      try { data = JSON.parse(text); } catch(e) { data = {}; }

      hideLoading();

      if (!data.success) {
        showToast('Failed to load: ' + (data.error || 'Unknown error'), 'danger');
        return;
      }

      var docs = data.documents || [];

      var modalId = 'partialDocModal_' + docType;
      var existing = document.getElementById(modalId);
      if (existing) existing.remove();

      var headerClass = docType === 'MRR' ? 'bg-success text-white'
                      : docType === 'MRIF' ? 'bg-warning text-dark'
                      : 'bg-danger text-white';
      var closeClass = docType === 'MRIF' ? '' : ' btn-close-white';
      var headerIcon = docType === 'MRR' ? 'bi-box-arrow-in-down'
                     : docType === 'MRIF' ? 'bi-box-arrow-up'
                     : 'bi-arrow-counterclockwise';
      var label = 'Partial ' + docType + 's';
      var btnClass = docType === 'MRR' ? 'btn-success' : 'btn-warning';
      var typeBadgeClass = docType === 'MRR' ? 'bg-success'
                         : docType === 'MRIF' ? 'bg-warning text-dark'
                         : 'bg-danger';

      var html = '<div class="modal fade" id="' + modalId + '" tabindex="-1">' +
        '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
          '<div class="modal-content">' +
            '<div class="modal-header ' + headerClass + '">' +
              '<h5 class="modal-title"><i class="bi ' + headerIcon + ' me-2"></i>' +
                label + ' (' + docs.length + ')</h5>' +
              '<button type="button" class="btn-close' + closeClass + '" data-bs-dismiss="modal"></button>' +
            '</div>' +
            '<div class="modal-body p-0">';

      if (docs.length === 0) {
        html += '<div class="text-center text-muted py-5">' +
          '<i class="bi bi-check-circle fs-1 d-block mb-2 text-success"></i>' +
          '<div>No partial ' + docType + 's found.</div>' +
          '<div class="small mt-1">All ' + docType + ' documents are either fully processed or pending.</div>' +
          '</div>';
      } else {
        html += '<div class="list-group list-group-flush">';
        docs.forEach(function(d) {
          var docNo = String(d.docNo || '');
          var docNoSafe = _esc(docNo);
          var docNoJs = docNo.replace(/'/g, "\\'");
          var balTag = d.isBal ? ' <span class="badge bg-info text-dark">BAL</span>' : '';

          var subtitleParts = [];
          if (d.poNo) subtitleParts.push('PO: ' + d.poNo);
          if (d.vendor) subtitleParts.push('Vendor: ' + d.vendor);
          if (d.drNo) subtitleParts.push('DR: ' + d.drNo);
          if (d.joNo) subtitleParts.push('JO: ' + d.joNo);
          if (d.gemSoNo) subtitleParts.push('GEM SO: ' + d.gemSoNo);
          if (d.requestor) subtitleParts.push(d.requestor);
          var subtitle = _esc(subtitleParts.join(' · '));

          var dateStr = '';
          var dateRaw = d.receivingDate || d.datePrepared || '';
          if (dateRaw) {
            try { dateStr = new Date(dateRaw).toLocaleDateString(); } catch(e) { dateStr = String(dateRaw); }
          }

          html += '<div class="list-group-item">' +
            '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2">' +
              '<div class="flex-grow-1" style="min-width:0;">' +
                '<div class="fw-bold">' + docNoSafe +
                  ' <span class="badge ' + typeBadgeClass + '">' + docType + '</span>' +
                  balTag +
                  ' <span class="badge bg-danger">' + d.partialItems + ' partial item' + (d.partialItems > 1 ? 's' : '') + '</span>' +
                '</div>' +
                (subtitle ? '<div class="small text-muted mt-1">' + subtitle + '</div>' : '') +
                (dateStr ? '<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + _esc(dateStr) + '</div>' : '') +
                '<div class="small mt-1"><i class="bi bi-box me-1"></i>Total remaining: <strong>' + d.remainingQty + '</strong></div>' +
                (d.firstItemCode ? '<div class="small text-muted"><i class="bi bi-info-circle me-1"></i>First partial: <code>' + _esc(d.firstItemCode) + '</code></div>' : '') +
              '</div>' +
              '<div class="d-flex flex-column gap-1 flex-shrink-0">' +
                '<button class="btn btn-sm ' + btnClass + '" ' +
                  'onclick="closePartialDocModal(\'' + docType + '\');processPartialDoc(\'' + docNoJs + '\', \'' + docType + '\')">' +
                  '<i class="bi bi-arrow-right-circle me-1"></i>Process' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';
      }

      html += '</div>' +
            '<div class="modal-footer">' +
              '<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

      var wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      document.body.appendChild(wrapper.firstChild);

      var modalEl = document.getElementById(modalId);
      var bsModal = new bootstrap.Modal(modalEl);
      bsModal.show();

      modalEl.addEventListener('hidden.bs.modal', function() {
        modalEl.remove();
      });

    } catch (err) {
      hideLoading();
      showToast('Failed to load partial docs: ' + err.message, 'danger');
      console.error('[_openPartialDocModal] Error:', err);
    }
  }

  window.closePartialDocModal = function(docType) {
    var modalEl = document.getElementById('partialDocModal_' + docType);
    if (modalEl) {
      var m = bootstrap.Modal.getInstance(modalEl);
      if (m) m.hide();
    }
  };

  // ═══════════════════════════════════════════════════════════
  // PROCESS A PARTIAL DOC FROM THE MODAL
  // ═══════════════════════════════════════════════════════════
  window.processPartialDoc = function(docNo, docType) {
    if (!docNo || !docType) return;

    if (docType === 'MRR') {
      // MRR partial → open Manual MRR with prefilled remaining items
      if (typeof prefillManualMrrFromDoc === 'function') {
        prefillManualMrrFromDoc(docNo);
      } else {
        showToast('Manual MRR form not available', 'danger');
      }
    } else if (docType === 'MRIF') {
      // MRIF partial → open Process Balance modal
      if (typeof openProcessPartialModal === 'function') {
        openProcessPartialModal(docNo);
      } else {
        showToast('Process Balance modal not available', 'danger');
      }
    } else if (docType === 'MRS') {
      if (typeof openPendingProcessModal === 'function') {
        openPendingProcessModal(docNo, 'MRS');
      } else {
        showToast('MRS processing not available', 'danger');
      }
    }
  };

  // ═══════════════════════════════════════════════════════════
  // DEPRECATED — kept for backward compat
  // ═══════════════════════════════════════════════════════════
  window.openPartialItemsModal = async function() {
    // Redirects to the new MRIF partial modal
    if (typeof window.openPartialMrifModal === 'function') {
      return window.openPartialMrifModal();
    }
  };

  console.log('✅ notifications.js loaded (Partial MRR + MRIF)');
})();
