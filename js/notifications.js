// ============================================================
// WAREHOUSE NOTIFICATIONS
// v5 — No safeFetch (plain fetch, no auto-abort)
//      Partial modal uses plain fetch + native fetch timeout
//      KPI client cache (60s) to reduce GAS hammering
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

  // ─── Internal: parse JSON safely, detect HTML ───
  async function _fetchJson(url, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, timeoutMs);
    var res;
    try {
      res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server returned HTML');
    return JSON.parse(trimmed);
  }

  // ═══════════════════════════════════════════════════════════
  // KPI UPDATER — client cache (60s)
  // ═══════════════════════════════════════════════════════════
  window.updateWarehouseKPIs = async function() {
    try {
      var partialMrrCount = 0;
      try {
        var mrrCached = (typeof getCache === 'function') ? getCache('kpi_partial_MRR') : null;
        if (mrrCached && mrrCached.success) {
          partialMrrCount = (mrrCached.documents || []).length;
        } else {
          var mrrData = await _fetchJson(API_URL + '?action=getPartialDocsByType&docType=MRR&_t=' + Date.now(), 90000);
          if (mrrData && mrrData.success) {
            partialMrrCount = (mrrData.documents || []).length;
            if (typeof setCache === 'function') setCache('kpi_partial_MRR', mrrData, 60000);
          }
        }
      } catch(e) { console.warn('[KPI] Partial MRR:', e.message); }

      var partialMrifCount = 0;
      try {
        var mrifCached = (typeof getCache === 'function') ? getCache('kpi_partial_MRIF') : null;
        if (mrifCached && mrifCached.success) {
          partialMrifCount = (mrifCached.documents || []).length;
        } else {
          var mrifData = await _fetchJson(API_URL + '?action=getPartialDocsByType&docType=MRIF&_t=' + Date.now(), 90000);
          if (mrifData && mrifData.success) {
            partialMrifCount = (mrifData.documents || []).length;
            if (typeof setCache === 'function') setCache('kpi_partial_MRIF', mrifData, 60000);
          }
        }
      } catch(e) { console.warn('[KPI] Partial MRIF:', e.message); }

      var pendingCount = 0;
      try {
        var pendingData = await _fetchJson(API_URL + '?action=getAllPendingDocs&_t=' + Date.now(), 90000);
        var allDocs = (pendingData && pendingData.documents) || [];
        pendingCount = allDocs.filter(function(d) {
          return String(d.status || '').toUpperCase() === 'PENDING';
        }).length;
      } catch(e) { console.warn('[KPI] Pending:', e.message); }

      var totalCount = 0;
      var completedCount = 0;
      try {
        var sheetId = (typeof getCleanSheetId === 'function') ? getCleanSheetId() : '';
        var countData = await _fetchJson(API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now(), 90000);
        completedCount = countData.completedCount || 0;
        totalCount = countData.totalCount || 0;
      } catch(e) { console.warn('[KPI] Count:', e.message); }

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
  // WAREHOUSE NOTIFICATIONS
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
      if (typeof playSuccessBeep === 'function') playSuccessBeep();
      if (typeof showToast === 'function') showToast(diff + ' new request(s) received!', 'warning');
    }

    var badge = document.getElementById('whNotifBadge');
    if (badge) {
      badge.textContent = newCount;
      badge.classList.toggle('d-none', newCount === 0);
    }

    renderWarehouseNotifications(filtered);
  }

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
      var data = await _fetchJson(API_URL + '?action=getPendingRequests&_t=' + Date.now(), 90000);
      if (data.success && data.requests) {
        setCache('pendingRequests', data.requests, 5 * 60 * 1000);
        processNotifications(data.requests);
      } else {
        processNotifications([]);
      }
    } catch(e) {
      console.error('[WH Notifications] Error:', e.message);
      processNotifications([]);
    }
  }

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
      var data = await _fetchJson(API_URL + '?action=getPendingRequests&_t=' + Date.now(), 90000);
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
          return reqStr === todayStr && (req.type || '').toUpperCase() === 'MRIF';
        });
        renderWhNotifModal(filtered);
      } else {
        renderWhNotifModal([]);
      }
    } catch(e) {
      renderWhNotifModal([]);
    }
  }

  window.processRequestFromNotification = async function(docNo, docType) {
    if (typeof navigateTo === 'function') navigateTo('releasing');
    await new Promise(resolve => setTimeout(resolve, 300));
    state.currentModule = docType;
    if (typeof updateLabels === 'function') updateLabels();
    var sheetId = (typeof getCleanSheetId === 'function') ? getCleanSheetId() : '';
    if (!sheetId && typeof syncModuleLinks === 'function') {
      await syncModuleLinks();
    }
    try {
      await onDocSelect(docNo);
      showToast('Loaded ' + cleanDocNo(docNo), 'success');
    } catch(err) {
      showToast('Failed to load document: ' + err.message, 'danger');
    }
  };

  window.clearWhNotifications = function() {
    if (!confirm('Clear all warehouse notifications?')) return;
    localStorage.setItem('ivm_whNotifCount', '0');
    var badge = document.getElementById('whNotifBadge');
    if (badge) badge.classList.add('d-none');
    clearCache('pendingRequests');
    showToast('Notifications cleared', 'info');
  };

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
  // PARTIAL MODALS
  // ═══════════════════════════════════════════════════════════
  window.openPartialMrrModal = async function() {
    await _openPartialDocModal('MRR');
  };
  window.openPartialMrifModal = async function() {
    await _openPartialDocModal('MRIF');
  };

  async function _openPartialDocModal(docType) {
    showLoading('Loading partial ' + docType + 's...');
    try {
      var data = await _fetchJson(
        API_URL + '?action=getPartialDocsByType&docType=' + docType + '&_t=' + Date.now(),
        90000
      );

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
          var partialCount = d.partialItems != null ? d.partialItems : 0;
          var totalItems = d.totalItems != null ? d.totalItems : 0;
          var servedCount = d.servedItems != null ? d.servedItems : 0;

          html += '<div class="list-group-item">' +
            '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2">' +
              '<div class="flex-grow-1" style="min-width:0;">' +
                '<div class="fw-bold">' + docNoSafe +
                  ' <span class="badge ' + typeBadgeClass + '">' + docType + '</span>' +
                  balTag +
                  ' <span class="badge bg-danger">' + partialCount + ' partial</span>' +
                  (servedCount > 0 ? ' <span class="badge bg-success">' + servedCount + ' served</span>' : '') +
                  ' <span class="badge bg-secondary">' + totalItems + ' total</span>' +
                '</div>' +
                (subtitle ? '<div class="small text-muted mt-1">' + subtitle + '</div>' : '') +
                (dateStr ? '<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + _esc(dateStr) + '</div>' : '') +
                '<div class="small mt-1"><i class="bi bi-box me-1"></i>Total remaining: <strong>' + (d.remainingQty || 0) + '</strong></div>' +
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
      if (err.name === 'AbortError') {
        showToast('⚠️ Server is slow (>90s). Please try again.', 'warning', 8000);
      } else if (err.message && err.message.indexOf('HTML') !== -1) {
        showToast('⚠️ Server returned HTML. Check the GAS deployment URL.', 'danger', 10000);
      } else {
        showToast('Failed to load partial docs: ' + err.message, 'danger');
      }
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

  window.processPartialDoc = function(docNo, docType) {
    if (!docNo || !docType) return;
    if (docType === 'MRR') {
      if (typeof prefillManualMrrFromDoc === 'function') prefillManualMrrFromDoc(docNo);
      else showToast('Manual MRR form not available', 'danger');
    } else if (docType === 'MRIF') {
      if (typeof openProcessPartialModal === 'function') openProcessPartialModal(docNo);
      else showToast('Process Balance modal not available', 'danger');
    } else if (docType === 'MRS') {
      if (typeof openPendingProcessModal === 'function') openPendingProcessModal(docNo, 'MRS');
      else showToast('MRS processing not available', 'danger');
    }
  };

  window.openPartialItemsModal = async function() {
    if (typeof window.openPartialMrifModal === 'function') return window.openPartialMrifModal();
  };

  console.log('✅ notifications.js loaded (v5 — plain fetch, no auto-abort)');
})();
