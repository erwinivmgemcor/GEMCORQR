// ============================================================
// MAIN - DOM Ready & Initialization
// ============================================================

// ─── Sidebar role handler (called from applyRoleUI) ───
window.applySidebarRole = function(role) {
  var isProduction = (role === 'production');
  var isWarehouse = (role === 'warehouse');
  var sidebarRole = document.getElementById('sidebarRole');
  if (sidebarRole) {
    sidebarRole.textContent = isProduction ? 'Production Mode' : (state.currentUser ? state.currentUserFullname : 'Warehouse');
  }

  // ─── Inventory visible for both roles ──────────────────────
  var warehouseNavItems = ['dashboard', 'releasing', 'receiving', 'returns'];
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(el) {
    var section = el.dataset.section;
    if (warehouseNavItems.indexOf(section) !== -1) {
      el.style.display = isProduction ? 'none' : 'flex';
    } else {
      el.style.display = 'flex';
    }
  });

  // ─── Show/hide logout button ────────────────────────────────
  var logoutItem = document.getElementById('logoutNavItem');
  if (logoutItem) {
    logoutItem.style.display = (isWarehouse && state.currentUser) ? 'flex' : 'none';
  }

  if (isProduction) {
    navigateTo('myrequests');
  } else {
    navigateTo('dashboard');
  }
};

// ─── Navigation (with page title update) ─────────────────────
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

  // ─── Update page title ──────────────────────────────────────
  var titles = {
    dashboard: 'Dashboard',
    releasing: 'Releasing (MRIF)',
    receiving: 'Receiving (MRR)',
    returns: 'Returns (MRS)',
    requests: 'New Request',
    myrequests: 'My Requests',
    inventory: 'Inventory',
    settings: 'Settings',
    about: 'About / Instructions'
  };
  var titleEl = document.getElementById('pageTitle');
  if (titleEl && titles[sectionId]) {
    titleEl.textContent = titles[sectionId];
  }

  // Module-specific actions
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
      fetchPendingDocs();
    }
  }

  if (sectionId === 'dashboard') {
    var role = localStorage.getItem('ivm_userRole');
    if (role === 'warehouse' && !window.analyticsLoaded) {
      setTimeout(loadAnalytics, 300);
    }
    if (role === 'warehouse') {
      setTimeout(updatePartialCount, 500);
    }
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

// ─── Override renderMyRequests ──────────────────────────────────
var originalRenderMyRequests = window.renderMyRequests || function() {};

window.renderMyRequests = function(requests) {
  if (typeof originalRenderMyRequests === 'function') {
    try { originalRenderMyRequests(requests); } catch(e) { console.warn('[renderMyRequests] Original error:', e); }
  }

  var container = document.getElementById('myRequestsListPage');
  if (!container) return;
  container.innerHTML = '';
  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted text-center">No requests found</div>';
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
    var html = '<div class="list-group-item request-card ' + (isCompleted ? 'completed' : '') + '" data-docno="' + docNo + '" style="cursor:pointer;">' +
      '<div class="d-flex justify-content-between align-items-start">' +
      '<div>' +
      '<div class="fw-bold">' + docNo + ' <span class="badge bg-secondary">' + (req.type || '') + '</span></div>' +
      '<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + dateStr + '</div>' +
      '</div>' +
      '<span class="badge bg-' + badgeClass + '"><i class="bi ' + icon + ' me-1"></i>' + statusText + '</span>' +
      '</div>' +
      '<div class="small mt-1"><i class="bi bi-box me-1"></i>' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
      '<div class="small text-muted mt-1"><i class="bi bi-qr-code me-1"></i> Click to re-open QR</div>' +
      '</div>';
    container.innerHTML += html;
  });

  container.querySelectorAll('.request-card').forEach(function(el) {
    el.addEventListener('click', function(e) {
      var docNo = this.getAttribute('data-docno');
      if (docNo) showRequestQr(docNo, docNo);
    });
  });
};

// ─── Override loadMyRequests ────────────────────────────────────
var originalLoadMyRequests = window.loadMyRequests || function() {};

window.loadMyRequests = function() {
  if (typeof originalLoadMyRequests === 'function') {
    try { originalLoadMyRequests(); } catch(e) { console.warn('[loadMyRequests] Original error:', e); }
  }
};

// ─── Override updateWarehouseKPIs ──────────────────────────────
var originalUpdateWarehouseKPIs = window.updateWarehouseKPIs || function() {};

window.updateWarehouseKPIs = function() {
  if (typeof originalUpdateWarehouseKPIs === 'function') {
    try { originalUpdateWarehouseKPIs(); } catch(e) { console.warn('[updateWarehouseKPIs] Original error:', e); }
  }
};

// ─── Test connection ─────────────────────────────────────────────
async function testConnection() {
  var resultDiv = document.getElementById('testResult');
  if (!resultDiv) return;
  resultDiv.classList.remove('d-none');
  resultDiv.textContent = 'Testing...';
  try {
    const url = API_URL + '?action=ping&_t=' + Date.now();
    console.log('[Test] URL:', url);
    resultDiv.textContent += '\nURL: ' + url.substring(0, 80) + '...';
    const res = await fetch(url, { redirect: 'follow' });
    console.log('[Test] Status:', res.status);
    resultDiv.textContent += '\nHTTP Status: ' + res.status;
    const text = await res.text();
    console.log('[Test] Response:', text);
    resultDiv.textContent += '\nRaw Response: ' + text.substring(0, 200);
    try {
      const data = JSON.parse(text);
      resultDiv.textContent += '\nParsed: ' + JSON.stringify(data, null, 2);
      if (data.success) {
        resultDiv.textContent += '\n✅ CONNECTION OK - GAS is responding!';
      } else {
        resultDiv.textContent += '\n⚠️ GAS responded but reported error: ' + data.error;
      }
    } catch(e) {
      resultDiv.textContent += '\n❌ Response is not valid JSON!';
    }
  } catch(err) {
    console.error('[Test] Error:', err);
    resultDiv.textContent += '\n❌ FETCH FAILED: ' + err.message;
    resultDiv.textContent += '\n\nThis means CORS is blocking the request OR the URL is wrong.';
    resultDiv.textContent += '\nMake sure you deployed the NEW Master.gs and updated the URL above.';
  }
}

// ─── URL doc parameter ──────────────────────────────────────────
function checkUrlDocParam() {
  var params = new URLSearchParams(window.location.search);
  var docNo = params.get('doc');
  if (!docNo) return;

  console.log('[QR Scan] Detected doc parameter:', docNo);

  var docType = 'MRIF';
  if (docNo.indexOf('MRR') === 0) docType = 'MRR';
  else if (docNo.indexOf('MRS') === 0) docType = 'MRS';

  if (window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  showLoading('Opening ' + cleanDocNo(docNo) + '...');

  var role = localStorage.getItem('ivm_userRole');
  if (role === 'warehouse') {
    selectModule(docType).then(function() {
      setTimeout(function() {
        onDocSelect(docNo);
        hideLoading();
      }, 500);
    }).catch(function(err) {
      console.error('[QR Scan] Error:', err);
      hideLoading();
      showToast('Could not open document: ' + cleanDocNo(docNo), 'warning');
    });
  } else {
    hideLoading();
    showToast('Document ' + cleanDocNo(docNo) + ' scanned. Switch to Warehouse mode to process.', 'info');
  }
}

// ─── DOM Ready ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Initialize modals safely
  var modalIds = ['qtyModal', 'successModal', 'settingsModal', 'newRequestModal',
    'requestSuccessModal', 'whNotifModal', 'mrifListModal', 'mrifPrintModal',
    'pendingMrifModal', 'mrrListModal', 'mrrPrintModal', 'mrsListModal',
    'mrsPrintModal', 'quickScanModal', 'roleModal', 'productionNameModal',
    'batchVerifyModal', 'qrZoomModal', 'poScanModal', 'poItemsModal', 'loginModal'];

  modalIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
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
      else if (id === 'loginModal') window.loginModalEl = el; // store for later
    }
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/GEMCORQR/sw.js')
      .then(function(registration) {
        console.log('[SW] Registered successfully:', registration);
      })
      .catch(function(error) {
        console.log('[SW] Registration failed:', error);
      });
  }

  // Initialize role
  initRole();

  // Load analytics and partial count for warehouse mode
  setTimeout(function() {
    var role = localStorage.getItem('ivm_userRole');
    console.log('[Main] Role detected:', role);
    if (role === 'warehouse' && state.currentUser) {
      setTimeout(loadAnalytics, 800);
      setTimeout(updatePartialCount, 1000);
    }
  }, 1500);

  // Set receiving date default
  var dateInput = document.getElementById('mrrReceivingDate');
  if (dateInput) dateInput.valueAsDate = new Date();

  // Check URL doc parameter
  setTimeout(checkUrlDocParam, 1500);

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', function(e) {
    var sidebar = document.getElementById('sidebar');
    var toggleBtn = document.querySelector('.sidebar-toggle');
    if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('open')) {
      var isClickInside = sidebar.contains(e.target) || (toggleBtn && toggleBtn.contains(e.target));
      if (!isClickInside) {
        toggleSidebar(false);
      }
    }
  });
});
