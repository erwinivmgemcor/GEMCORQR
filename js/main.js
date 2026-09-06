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

  initRole();

  // ─── Load analytics for warehouse mode ────────────
  setTimeout(function() {
    var role = localStorage.getItem('ivm_userRole');
    if (role === 'warehouse') {
      loadAnalytics();
    }
  }, 1500);

  document.getElementById('mrrReceivingDate').valueAsDate = new Date();
  setTimeout(checkUrlDocParam, 1500);
});
