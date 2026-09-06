// ============================================================
// WAREHOUSE NOTIFICATIONS
// ============================================================

async function updateWarehouseKPIs() {
  try {
    var sheetId = getCleanSheetId() || '';
    var url = API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }
    var pendingCount = data.pendingCount || 0;
    var completedCount = data.completedCount || 0;
    var totalCount = data.totalCount || 0;

    var kpiActive = document.getElementById('kpiActiveDocs');
    var kpiPending = document.getElementById('kpiPending');
    var kpiNotif = document.getElementById('kpiNotifications');
    var kpiCompleted = document.getElementById('kpiCompleted');

    if (kpiActive) kpiActive.textContent = totalCount;
    if (kpiPending) kpiPending.textContent = pendingCount;
    if (kpiNotif) kpiNotif.textContent = pendingCount;
    if (kpiCompleted) kpiCompleted.textContent = completedCount;

    console.log('[KPI] Total:', totalCount, 'Pending:', pendingCount, 'Completed:', completedCount);
  } catch(e) { console.error('[KPI] Error:', e); }
}

async function loadWarehouseNotifications() {
  if (localStorage.getItem('ivm_userRole') === 'production') return;
  try {
    var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
    var res = await fetch(url);
    var data = await res.json();
    console.log('[WH Notifications] Response:', data);
    if (data.success && data.requests) {
      var today = new Date();
      var sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      var currentMrifId = localStorage.getItem('sheetId_MRIF') || '';
      var filtered = data.requests.filter(function(req) {
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
      console.log('[WH Notifications] Filtered count:', filtered.length);

      var prevCount = parseInt(localStorage.getItem('ivm_whNotifCount') || '0');
      var newCount = filtered.length;
      localStorage.setItem('ivm_whNotifCount', newCount);

      if (newCount > prevCount) {
        var diff = newCount - prevCount;
        playSuccessBeep();
        showToast(diff + ' new request(s) received!', 'warning');
      }

      var badge = document.getElementById('whNotifBadge');
      var btn = document.getElementById('whNotifBtn');
      if (badge && btn) {
        badge.textContent = newCount;
        badge.classList.toggle('d-none', newCount === 0);
        btn.classList.toggle('d-none', false);
      }

      updateWarehouseKPIs();
      renderWarehouseNotifications(filtered);
    }
  } catch(e) {
    console.error('[WH Notifications] Error:', e);
  }
}

function renderWarehouseNotifications(requests) {
  var container = document.getElementById('whNotificationsList');
  if (!container) return;
  container.innerHTML = '';
  if (requests.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted text-center py-3">No pending requests</div>';
    return;
  }
  requests.slice(0, 5).forEach(function(req) {
    var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
    var docNo = req.docNo || '';
    var type = req.type || 'MRIF';
    var html = '<div class="list-group-item wh-notif-item py-2" data-docno="' + docNo + '" data-type="' + type + '">' +
      '<div class="d-flex justify-content-between align-items-start">' +
      '<div>' +
      '<div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
      '<div class="requestor"><i class="bi bi-person me-1"></i>' + (req.requestor || 'Unknown') + '</div>' +
      '<div class="timestamp"><i class="bi bi-clock me-1"></i>' + dateStr + '</div>' +
      '</div>' +
      '<span class="badge bg-warning text-dark">PENDING</span>' +
      '</div>' +
      '<div class="small mt-1 text-muted">' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
      '</div>';
    container.innerHTML += html;
  });
  container.querySelectorAll('.wh-notif-item').forEach(function(el) {
    el.addEventListener('click', function() {
      processRequestFromNotification(this.getAttribute('data-docno'), this.getAttribute('data-type'));
    });
  });
  if (requests.length > 5) {
    container.innerHTML += '<div class="list-group-item text-center text-muted small py-2">+' + (requests.length - 5) + ' more pending requests</div>';
  }
}

function renderWhNotifModal(requests) {
  var container = document.getElementById('whNotifModalList');
  if (!container) return;
  container.innerHTML = '';
  if (requests.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted text-center py-3">No pending requests</div>';
    return;
  }
  requests.forEach(function(req) {
    var dateStr = req.timestamp ? new Date(req.timestamp).toLocaleString() : '';
    var docNo = req.docNo || '';
    var type = req.type || 'MRIF';
    var html = '<div class="list-group-item wh-notif-item py-3" data-docno="' + docNo + '" data-type="' + type + '">' +
      '<div class="d-flex justify-content-between align-items-start">' +
      '<div>' +
      '<div class="doc-no">' + docNo + ' <span class="badge bg-secondary">' + type + '</span></div>' +
      '<div class="requestor"><i class="bi bi-person me-1"></i>' + (req.requestor || 'Unknown') + '</div>' +
      '<div class="timestamp"><i class="bi bi-clock me-1"></i>' + dateStr + '</div>' +
      '</div>' +
      '<span class="badge bg-warning text-dark">PENDING</span>' +
      '</div>' +
      '<div class="small mt-1 text-muted">' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
      '</div>';
    container.innerHTML += html;
  });
  container.querySelectorAll('.wh-notif-item').forEach(function(el) {
    el.addEventListener('click', function() {
      if (whNotifModal) whNotifModal.hide();
      processRequestFromNotification(this.getAttribute('data-docno'), this.getAttribute('data-type'));
    });
  });
}

function openWhNotifications() {
  if (!whNotifModal && document.getElementById('whNotifModal')) {
    whNotifModal = new bootstrap.Modal(document.getElementById('whNotifModal'));
  }
  if (whNotifModal) whNotifModal.show();
  loadAndRenderWhModal();
}

async function loadAndRenderWhModal() {
  var container = document.getElementById('whNotifModalList');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading...</div></div>';
  }
  try {
    var url = API_URL + '?action=getPendingRequests&_t=' + Date.now();
    var res = await fetch(url);
    var data = await res.json();
    console.log('[WH Modal] Response:', data);
    if (data.success && data.requests) {
      var today = new Date();
      var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
      var currentMrifId = localStorage.getItem('sheetId_MRIF') || '';
      var filtered = data.requests.filter(function(req) {
        var reqDate = new Date(req.timestamp);
        var reqStr = reqDate.getFullYear() + '-' + String(reqDate.getMonth()+1).padStart(2,'0') + '-' + String(reqDate.getDate()).padStart(2,'0');
        var type = (req.type || '').toUpperCase();
        if (reqStr !== todayStr || type !== 'MRIF') return false;
        if (currentMrifId && req.url) {
          var reqUrl = String(req.url || '');
          if (reqUrl.indexOf(currentMrifId) === -1) return false;
        }
        return true;
      });
      filtered.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
      renderWhNotifModal(filtered);
    } else {
      renderWhNotifModal([]);
    }
  } catch(e) {
    console.error('[WH Modal] Error:', e);
    renderWhNotifModal([]);
  }
}

async function processRequestFromNotification(docNo, docType) {
  console.log('[WH] Processing request:', docNo, docType);
  state.currentModule = docType;
  updateLabels();
  await fetchPendingDocs();
  var select = document.getElementById('docSelect');
  if (select) {
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === docNo) {
        select.selectedIndex = i;
        onDocSelect(docNo);
        showToast('Loading ' + cleanDocNo(docNo) + '...', 'info');
        return;
      }
    }
  }
  showToast('Document not in current list. Refreshing...', 'warning');
  await fetchPendingDocs();
  setTimeout(function() {
    var select2 = document.getElementById('docSelect');
    if (select2) {
      for (var i = 0; i < select2.options.length; i++) {
        if (select2.options[i].value === docNo) {
          select2.selectedIndex = i;
          onDocSelect(docNo);
          return;
        }
      }
    }
    showToast('Could not find ' + cleanDocNo(docNo) + '. It may have been processed.', 'danger');
  }, 1000);
}

function clearWhNotifications() {
  if (!confirm('Clear all warehouse notifications? This will reset the badge count.')) return;
  localStorage.setItem('ivm_whNotifCount', '0');
  var badge = document.getElementById('whNotifBadge');
  if (badge) badge.classList.add('d-none');
  showToast('Notifications cleared', 'info');
}
