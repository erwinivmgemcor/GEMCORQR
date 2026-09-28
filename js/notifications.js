// ============================================================
// WAREHOUSE NOTIFICATIONS
// ★ v2 — 5 min polling, cache-first, no aggressive refresh
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

  var POLL_INTERVAL = 5 * 60 * 1000;   // ★ 5 min

  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  updateWarehouseKPIs 

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
        '<div><div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
        '<div class="requestor"><i class="bi bi-person me-1"></i>' + requestor + '</div>' +
        '<div class="timestamp"><i class="bi bi-clock me-1"></i>' + _esc(dateStr) + '</div></div>' +
        '<span class="badge bg-warning text-dark">PENDING</span></div></div>';
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
      container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    }
    try {
      var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && data.requests) {
        var today = new Date();
        var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
        var filtered = data.requests.filter(function(req) {
          var reqDate = new Date(req.timestamp);
          var reqStr = reqDate.getFullYear() + '-' + String(reqDate.getMonth()+1).padStart(2,'0') + '-' + String(reqDate.getDate()).padStart(2,'0');
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
    if (window._whPollInterval) { clearInterval(window._whPollInterval); window._whPollInterval = null; }
  };

  console.log('✅ notifications.js loaded (5 min poll)');
})();
