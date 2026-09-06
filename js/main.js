// ============================================================
// MAIN - DOM Ready & Initialization
// ============================================================

async function testConnection() {
  const resultDiv = document.getElementById('testResult');
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

// ============================================================
// SIDEBAR NAVIGATION
// ============================================================

function navigateTo(sectionId) {
  // Hide all sections
  document.querySelectorAll('.section-page').forEach(function(el) {
    el.classList.remove('active');
  });
  // Show target section
  var target = document.getElementById('section-' + sectionId);
  if (target) target.classList.add('active');

  // Update sidebar active state
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(el) {
    el.classList.remove('active');
    if (el.dataset.section === sectionId) el.classList.add('active');
  });

  // Close sidebar on mobile
  toggleSidebar(false);

  // If we navigate to dashboard, load analytics if not loaded
  if (sectionId === 'dashboard') {
    var role = localStorage.getItem('ivm_userRole');
    if (role === 'warehouse' && !window.analyticsLoaded) {
      setTimeout(loadAnalytics, 300);
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

// ─── Override applyRoleUI to handle sidebar items ───
var originalApplyRoleUI = window.applyRoleUI || function() {};

window.applyRoleUI = function() {
  // Call the original function if it exists in auth.js
  if (typeof originalApplyRoleUI === 'function') {
    originalApplyRoleUI();
  }

  var role = localStorage.getItem('ivm_userRole');
  var isProduction = (role === 'production');

  // Update sidebar role display
  var sidebarRole = document.getElementById('sidebarRole');
  if (sidebarRole) {
    sidebarRole.textContent = isProduction ? 'Production Mode' : 'Warehouse Mode';
  }

  // Show/hide warehouse-only nav items
  var warehouseNavItems = ['dashboard', 'releasing', 'receiving', 'returns', 'inventory'];
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(function(el) {
    var section = el.dataset.section;
    if (warehouseNavItems.indexOf(section) !== -1) {
      el.style.display = isProduction ? 'none' : 'flex';
    } else {
      el.style.display = 'flex';
    }
  });

  // Navigate to appropriate default section
  if (isProduction) {
    navigateTo('myrequests');
  } else {
    navigateTo('dashboard');
  }
};

// ─── Override renderMyRequests to populate both containers ───
var originalRenderMyRequests = window.renderMyRequests || function() {};

window.renderMyRequests = function(requests) {
  // Call original if it exists
  if (typeof originalRenderMyRequests === 'function') {
    originalRenderMyRequests(requests);
  }

  // Also populate the standalone page container
  var container = document.getElementById('myRequestsListPage');
  if (!container) return;

  container.innerHTML = '';
  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted text-center">No requests found</div>';
    return;
  }

  // Update badge on sidebar and page
  var readyCount = 0;
  requests.forEach(function(req) {
    var status = req.status || 'PENDING';
    if (status !== 'PENDING') readyCount++;
  });
  var badge1 = document.getElementById('myRequestsBadgeSidebar');
  var badge2 = document.getElementById('myRequestsBadgePage');
  if (badge1) {
    badge1.textContent = readyCount;
    badge1.classList.toggle('d-none', readyCount === 0);
  }
  if (badge2) {
    badge2.textContent = readyCount;
    badge2.classList.toggle('d-none', readyCount === 0);
  }

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
      if (docNo) {
        showRequestQr(docNo, docNo);
      }
    });
  });
};

// ─── Override loadMyRequests to update page badge ───
var originalLoadMyRequests = window.loadMyRequests || function() {};

window.loadMyRequests = function() {
  // Call original if it exists
  if (typeof originalLoadMyRequests === 'function') {
    originalLoadMyRequests();
  }
  // The badge will be updated via renderMyRequests override above
};

// ─── Override updateWarehouseKPIs to update sidebar badge ───
var originalUpdateWarehouseKPIs = window.updateWarehouseKPIs || function() {};

window.updateWarehouseKPIs = function() {
  if (typeof originalUpdateWarehouseKPIs === 'function') {
    originalUpdateWarehouseKPIs();
  }
  // The KPI values are already updated by the original function
};

// ============================================================
// DOM READY
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
  // Initialize modals
  qtyModal = new bootstrap.Modal(document.getElementById('qtyModal'));
  successModal = new bootstrap.Modal(document.getElementById('successModal'));
  settingsModal = new bootstrap.Modal(document.getElementById('settingsModal'));
  newRequestModal = new bootstrap.Modal(document.getElementById('newRequestModal'));
  requestSuccessModal = new bootstrap.Modal(document.getElementById('requestSuccessModal'));
  whNotifModal = document.getElementById('whNotifModal') ? new bootstrap.Modal(document.getElementById('whNotifModal')) : null;
  mrifListModal = document.getElementById('mrifListModal') ? new bootstrap.Modal(document.getElementById('mrifListModal')) : null;
  mrifPrintModal = document.getElementById('mrifPrintModal') ? new bootstrap.Modal(document.getElementById('mrifPrintModal')) : null;
  pendingMrifModal = document.getElementById('pendingMrifModal') ? new bootstrap.Modal(document.getElementById('pendingMrifModal')) : null;
  mrrListModal = document.getElementById('mrrListModal') ? new bootstrap.Modal(document.getElementById('mrrListModal')) : null;
  mrrPrintModal = document.getElementById('mrrPrintModal') ? new bootstrap.Modal(document.getElementById('mrrPrintModal')) : null;
  mrsListModal = document.getElementById('mrsListModal') ? new bootstrap.Modal(document.getElementById('mrsListModal')) : null;
  mrsPrintModal = document.getElementById('mrsPrintModal') ? new bootstrap.Modal(document.getElementById('mrsPrintModal')) : null;
  quickScanModal = new bootstrap.Modal(document.getElementById('quickScanModal'));
  roleModal = new bootstrap.Modal(document.getElementById('roleModal'));
  productionNameModal = new bootstrap.Modal(document.getElementById('productionNameModal'));
  batchVerifyModal = new bootstrap.Modal(document.getElementById('batchVerifyModal'));
  qrZoomModal = new bootstrap.Modal(document.getElementById('qrZoomModal'));
  state.poScanModal = new bootstrap.Modal(document.getElementById('poScanModal'));
  state.poItemsModal = new bootstrap.Modal(document.getElementById('poItemsModal'));

  // ─── Register service worker ───
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/GEMCORQR/sw.js')
      .then(function(registration) {
        console.log('[SW] Registered successfully:', registration);
      })
      .catch(function(error) {
        console.log('[SW] Registration failed:', error);
      });
  }

  // ─── Initialize role ───
  initRole();

  // ─── Load analytics for warehouse mode ────────────────
  setTimeout(function() {
    var role = localStorage.getItem('ivm_userRole');
    console.log('[Main] Role detected:', role);
    if (role === 'warehouse') {
      setTimeout(loadAnalytics, 800);
    }
  }, 1500);

  // ─── Set receiving date default ───
  var dateInput = document.getElementById('mrrReceivingDate');
  if (dateInput) dateInput.valueAsDate = new Date();

  // ─── Check URL doc parameter ───
  setTimeout(checkUrlDocParam, 1500);

  // ─── Close sidebar when clicking outside on mobile ───
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
