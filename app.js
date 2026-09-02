// ═══════════════════════════════════════════════════════════════════════════
// GEMCOR WMS — app.js (Frontend)
// ═══════════════════════════════════════════════════════════════════════════

const API_URL = 'https://script.google.com/macros/s/YOUR_WEB_APP_URL_HERE/exec';

var currentMode = 'WAREHOUSE';
var currentModule = 'MRR';
var currentUser = null;
var inventoryItems = [];
var selectedInventoryItems = [];
var wizardItems = [];
var manualMrrItems = [];

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[App] DOM loaded');
  setTimeout(checkUrlDocParam, 1500);
});

// ═══════════════════════════════════════════════════════════════════════════
// URL Param Check — Auto-open document from scanned QR
// ═══════════════════════════════════════════════════════════════════════════
function checkUrlDocParam() {
  var urlParams = new URLSearchParams(window.location.search);
  var docParam = urlParams.get('doc');
  if (!docParam) return;
  console.log('[checkUrlDocParam] Found doc param:', docParam);

  // Clean URL
  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  var prefix = docParam.substring(0, 3).toUpperCase();
  if (prefix === 'MRR') {
    currentMode = 'WAREHOUSE';
    currentModule = 'MRR';
    selectModule('MRR');
    setTimeout(function() { openMrrPrint(docParam); }, 500);
  } else if (prefix === 'MRF') {
    currentMode = 'WAREHOUSE';
    currentModule = 'MRIF';
    selectModule('MRIF');
    setTimeout(function() { openMrifPrint(docParam); }, 500);
  } else if (prefix === 'MRS') {
    currentMode = 'WAREHOUSE';
    currentModule = 'MRS';
    selectModule('MRS');
  } else {
    showToast('Document type not recognized: ' + prefix, 'warning');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIN / Login
// ═══════════════════════════════════════════════════════════════════════════
function enterPinDigit(digit) {
  var inputs = document.querySelectorAll('.pin-dot');
  for (var i = 0; i < inputs.length; i++) {
    if (!inputs[i].dataset.filled) {
      inputs[i].dataset.filled = digit;
      inputs[i].classList.add('filled');
      break;
    }
  }
  var filled = document.querySelectorAll('.pin-dot.filled');
  if (filled.length === 4) {
    var pin = '';
    for (var j = 0; j < inputs.length; j++) pin += inputs[j].dataset.filled;
    verifyPin(pin);
  }
}

function clearPin() {
  var inputs = document.querySelectorAll('.pin-dot');
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].dataset.filled = '';
    inputs[i].classList.remove('filled');
  }
}

function verifyPin(pin) {
  if (pin === '1234') {
    document.getElementById('pinScreen').classList.add('d-none');
    document.getElementById('mainApp').classList.remove('d-none');
    showToast('Welcome to GEMCOR WMS', 'success');
    loadDashboard();
  } else {
    showToast('Invalid PIN', 'error');
    clearPin();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Mode Switching
// ═══════════════════════════════════════════════════════════════════════════
function switchMode(mode) {
  currentMode = mode;
  document.getElementById('modeLabel').textContent = mode === 'WAREHOUSE' ? 'WAREHOUSE MODE' : 'PRODUCTION MODE';
  loadDashboard();
}

function loadDashboard() {
  if (currentMode === 'WAREHOUSE') {
    document.getElementById('warehouseDashboard').classList.remove('d-none');
    document.getElementById('productionDashboard').classList.add('d-none');
    loadDocCounts();
  } else {
    document.getElementById('warehouseDashboard').classList.add('d-none');
    document.getElementById('productionDashboard').classList.remove('d-none');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Module Selection
// ═══════════════════════════════════════════════════════════════════════════
function selectModule(mod) {
  currentModule = mod;
  document.getElementById('moduleTitle').textContent = mod;
  document.getElementById('dashboardView').classList.add('d-none');
  document.getElementById('moduleView').classList.remove('d-none');

  var mrrCard = document.getElementById('mrrListCard');
  if (mrrCard) mrrCard.classList.toggle('d-none', mod !== 'MRR');

  if (mod === 'MRR') loadMrrList();
  else if (mod === 'MRIF') loadMrifList();
  else if (mod === 'MRS') loadMrsList();
}

function backToDashboard() {
  document.getElementById('moduleView').classList.add('d-none');
  document.getElementById('dashboardView').classList.remove('d-none');
}

// ═══════════════════════════════════════════════════════════════════════════
// Document Lists
// ═══════════════════════════════════════════════════════════════════════════
function loadDocCounts() {
  fetch(API_URL + '?action=getPendingDocs&docType=MRR')
    .then(r => r.json()).then(d => {
      document.getElementById('mrrCount').textContent = d.count || 0;
    }).catch(e => console.log(e));
  fetch(API_URL + '?action=getPendingDocs&docType=MRIF')
    .then(r => r.json()).then(d => {
      document.getElementById('mrifCount').textContent = d.count || 0;
    }).catch(e => console.log(e));
}

function loadMrrList() {
  var container = document.getElementById('docListContainer');
  container.innerHTML = '<div class="text-center p-3"><div class="spinner-border"></div></div>';
  // Fetch from DOCLINKS or similar
  setTimeout(function() {
    container.innerHTML = '<div class="alert alert-info">Select a document to view</div>';
  }, 500);
}

function loadMrifList() {
  var container = document.getElementById('docListContainer');
  container.innerHTML = '<div class="text-center p-3"><div class="spinner-border"></div></div>';
  setTimeout(function() {
    container.innerHTML = '<div class="alert alert-info">Select a document to view</div>';
  }, 500);
}

function loadMrsList() {
  var container = document.getElementById('docListContainer');
  container.innerHTML = '<div class="alert alert-info">MRS module</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
// MRR Print — Iframe approach
// ═══════════════════════════════════════════════════════════════════════════
function openMrrPrint(docNo) {
  console.log('[openMrrPrint] docNo:', docNo);
  var sheetId = getSheetIdForType('MRR');
  fetch(API_URL + '?action=getDocItems&sheetId=' + encodeURIComponent(sheetId) + '&docNo=' + encodeURIComponent(docNo) + '&docType=MRR')
    .then(r => r.json()).then(data => {
      console.log('[openMrrPrint] Parsed data:', data);
      if (!data.success) {
        showToast('Error loading MRR: ' + (data.error || 'Unknown'), 'error');
        return;
      }
      renderMrrPrint(docNo, data.info || {}, data.items || []);
      var modal = new bootstrap.Modal(document.getElementById('mrrPrintModal'));
      modal.show();
    }).catch(err => {
      console.error('[openMrrPrint] Error:', err);
      showToast('Failed to load MRR data', 'error');
    });
}

function renderMrrPrint(docNo, info, items) {
  var container = document.getElementById('mrrPrintContent');
  if (!container) return;
  console.log('[renderMrrPrint] docNo:', docNo, 'items count:', items ? items.length : 0);

  var receivingSite = info['Receiving Site'] || info.receivingSite || 'GEMCOR CATMON';
  var vendor = info['Vendor/Client'] || info.vendor || info.client || '';
  var datePrepared = info['Date Prepared'] || info.datePrepared || '';
  var poNo = info['PO No.'] || info.poNo || '';
  var drNo = info['DR No.'] || info.drNo || info.dr || '';
  var receivingDate = info['Receiving Date'] || info.receivingDate || '';
  var preparedBy = info['Prepared By'] || info.preparedBy || '';

  function formatDate(val) {
    if (!val || val === '') return '';
    if (typeof val === 'string') {
      val = val.replace(/\s*GMT.*$/, '').replace(/\s*Standard.*$/, '').trim();
      if (val.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)/)) return val;
      if (val.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) return val;
    }
    try {
      var d = new Date(val);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
        var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
      }
    } catch(e) {}
    return String(val);
  }

  var dateStr = formatDate(datePrepared);
  var recDateStr = formatDate(receivingDate);

  // Build items HTML — 7 columns, NO QR column
  var itemsHtml = '';
  if (items && items.length > 0) {
    items.forEach(function(it, idx) {
      var code = it.itemCode || it.inventoryId || it.code || it.id || '';
      var desc = it.description || it.desc || it.itemDescription || '';
      var recQty = it.recQty || it.expectedQty || it.qty || it.quantity || 0;
      var atlQty = it.atlQty || it.actualQty || it.issuedQty || it.actual || 0;
      var unit = it.unit || it.uom || 'PIECE';
      var remarks = it.remarks || it.status || it.note || '';
      itemsHtml += '<tr>' +
        '<td class="td-center" style="width:5%">' + (idx + 1) + '</td>' +
        '<td class="td-center" style="width:18%">' + code + '</td>' +
        '<td class="td-left" style="width:39%">' + desc + '</td>' +
        '<td class="td-center" style="width:11%">' + recQty + '</td>' +
        '<td class="td-center" style="width:11%">' + atlQty + '</td>' +
        '<td class="td-center" style="width:8%">' + unit + '</td>' +
        '<td class="td-center" style="width:18%">' + remarks + '</td>' +
        '</tr>';
    });
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="7" style="padding:20px;color:#999;font-style:italic;">No items found in this document</td></tr>';
  }

  var mrrQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

  var html = '<div class="mrr-print-sheet">' +
    '<div class="mrr-header">' +
      '<div class="mrr-logo"><img src="gemcor-logo.png" alt="GEMCOR" onerror="this.style.display=\'none\'"></div>' +
      '<div class="mrr-docno">' +
        '<div><span class="mrr-dn-label">Receipt No.:</span><span class="mrr-dn-box">' + docNo + '</span></div>' +
        '<div class="mrr-doc-qr"><img src="' + mrrQrUrl + '" alt="MRR QR"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrr-title">MATERIALS RECEIVING REPORT</div>' +
    '<table class="mrr-meta-table">' +
      '<tr>' +
        '<td class="mrr-meta-label">RECEIVING SITE:</td>' +
        '<td class="mrr-meta-value">' + receivingSite + '</td>' +
        '<td class="mrr-meta-label-right">PO No. / SOF No.:</td>' +
        '<td class="mrr-meta-value-right">' + poNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="mrr-meta-label">VENDOR:</td>' +
        '<td class="mrr-meta-value">' + vendor + '</td>' +
        '<td class="mrr-meta-label-right">DR No / SI No.:</td>' +
        '<td class="mrr-meta-value-right">' + drNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="mrr-meta-label">DATE PREPARED:</td>' +
        '<td class="mrr-meta-value">' + dateStr + '</td>' +
        '<td class="mrr-meta-label-right">RECEIVING DATE:</td>' +
        '<td class="mrr-meta-value-right">' + recDateStr + '</td>' +
      '</tr>' +
    '</table>' +
    '<table class="mrr-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%">ITEM<br>NO.</th>' +
          '<th style="width:18%">ITEM<br>CODE</th>' +
          '<th style="width:39%">ITEM DESCRIPTION</th>' +
          '<th style="width:11%">REQUESTED<br>QUANTITY</th>' +
          '<th style="width:11%">RECEIVED<br>QUANTITY</th>' +
          '<th style="width:8%">UNIT</th>' +
          '<th style="width:18%">REMARKS</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrr-checkboxes">' +
      '<div class="mrr-cb-section">' +
        '<div class="mrr-cb-title">ISSUES IN SUPPLIER PERFORMANCE:</div>' +
        '<div class="mrr-cb-row">' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> PRODUCT/SERVICE</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> DELIVERY</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> CUSTOMER RELATIONS</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> SUPPORT FUNCTION</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> PRICE</span>' +
        '</div>' +
      '</div>' +
      '<div class="mrr-cb-section">' +
        '<div class="mrr-cb-title">ACTION TAKEN IF REJECT / PARTIAL ACCEPTANCE:</div>' +
        '<div class="mrr-cb-row">' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> RETURN TO SUPPLIER</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> ITEMS REPLACED BY SUPPLIER</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> OTHERS</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="mrr-sigs">' +
      '<div class="mrr-sig">' +
        '<div class="mrr-sig-name">' + preparedBy + '</div>' +
        '<div class="mrr-sig-line"></div>' +
        '<div class="mrr-sig-label">PREPARED BY</div>' +
      '</div>' +
      '<div class="mrr-sig">' +
        '<div class="mrr-sig-name"></div>' +
        '<div class="mrr-sig-line"></div>' +
        '<div class="mrr-sig-label">CHECKED BY</div>' +
      '</div>' +
      '<div class="mrr-sig">' +
        '<div class="mrr-sig-name"></div>' +
        '<div class="mrr-sig-line"></div>' +
        '<div class="mrr-sig-label">NOTED BY</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  console.log('[renderMrrPrint] HTML rendered successfully');
}

function printMrr() {
  var content = document.getElementById('mrrPrintContent').innerHTML;
  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '210mm';
  iframe.style.height = '297mm';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head>');
  doc.write('<meta charset="utf-8">');
  doc.write('<style>');
  doc.write('body { font-family: Arial, sans-serif; margin: 0; padding: 15px; font-size: 11px; }');
  doc.write('.mrr-print-sheet { width: 100%; }');
  doc.write('.mrr-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }');
  doc.write('.mrr-logo img { height: 50px; }');
  doc.write('.mrr-docno { text-align: right; }');
  doc.write('.mrr-dn-label { font-weight: bold; margin-right: 5px; }');
  doc.write('.mrr-dn-box { border: 2px solid #c00; padding: 3px 10px; font-weight: bold; color: #c00; }');
  doc.write('.mrr-doc-qr img { width: 80px; height: 80px; margin-top: 5px; }');
  doc.write('.mrr-title { text-align: center; font-size: 14px; font-weight: bold; letter-spacing: 4px; margin: 10px 0; }');
  doc.write('.mrr-meta-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }');
  doc.write('.mrr-meta-table td { padding: 3px 5px; font-size: 10px; }');
  doc.write('.mrr-meta-label { font-weight: bold; width: 15%; }');
  doc.write('.mrr-meta-value { width: 35%; }');
  doc.write('.mrr-meta-label-right { font-weight: bold; width: 15%; text-align: right; }');
  doc.write('.mrr-meta-value-right { width: 35%; }');
  doc.write('.mrr-items { width: 100%; border-collapse: collapse; margin-top: 10px; }');
  doc.write('.mrr-items th { border: 1px solid #333; padding: 5px; background: #d9d9d9; font-size: 9px; text-align: center; vertical-align: middle; }');
  doc.write('.mrr-items td { border: 1px solid #333; padding: 5px; font-size: 10px; vertical-align: middle; }');
  doc.write('.td-center { text-align: center; }');
  doc.write('.td-left { text-align: left; }');
  doc.write('.mrr-checkboxes { margin-top: 15px; font-size: 9px; }');
  doc.write('.mrr-cb-title { font-weight: bold; margin-bottom: 3px; }');
  doc.write('.mrr-cb-row { display: flex; gap: 15px; margin-bottom: 5px; flex-wrap: wrap; }');
  doc.write('.mrr-cb-item { display: flex; align-items: center; gap: 3px; }');
  doc.write('.mrr-cb-circle { font-size: 12px; }');
  doc.write('.mrr-sigs { display: flex; justify-content: space-around; margin-top: 30px; }');
  doc.write('.mrr-sig { text-align: center; width: 30%; }');
  doc.write('.mrr-sig-name { min-height: 20px; font-size: 10px; }');
  doc.write('.mrr-sig-line { border-bottom: 1px solid #333; margin: 5px 0; }');
  doc.write('.mrr-sig-label { font-size: 9px; font-weight: bold; }');
  doc.write('@media print { body { padding: 0; } iframe { display: none; } }');
  doc.write('</style></head><body>');
  doc.write(content);
  doc.write('</body></html>');
  doc.close();

  setTimeout(function() {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(function() { document.body.removeChild(iframe); }, 1000);
  }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// MRIF Print
// ═══════════════════════════════════════════════════════════════════════════
function openMrifPrint(docNo) {
  console.log('[openMrifPrint] docNo:', docNo);
  var sheetId = getSheetIdForType('MRIF');
  fetch(API_URL + '?action=getDocItems&sheetId=' + encodeURIComponent(sheetId) + '&docNo=' + encodeURIComponent(docNo) + '&docType=MRIF')
    .then(r => r.json()).then(data => {
      if (!data.success) { showToast('Error loading MRIF: ' + (data.error || 'Unknown'), 'error'); return; }
      renderMrifPrint(docNo, data.info || {}, data.items || []);
      var modal = new bootstrap.Modal(document.getElementById('mrifPrintModal'));
      modal.show();
    }).catch(err => { showToast('Failed to load MRIF data', 'error'); });
}

function renderMrifPrint(docNo, info, items) {
  var container = document.getElementById('mrifPrintContent');
  if (!container) return;
  var joNo = info['JO No.'] || info.joNo || '';
  var dept = info['Department'] || info.department || '';
  var requestor = info['Requestor'] || info.requestor || '';
  var dateNeeded = info['Date Needed'] || info.dateNeeded || '';
  var datePrepared = info['Date Prepared'] || info.datePrepared || '';
  var preparedBy = info['Prepared By'] || info.preparedBy || '';

  var itemsHtml = '';
  if (items && items.length > 0) {
    items.forEach(function(it, idx) {
      var code = it.itemCode || it.inventoryId || it.code || it.id || '';
      var desc = it.description || it.desc || it.itemDescription || '';
      var recQty = it.recQty || it.expectedQty || it.qty || it.quantity || 0;
      var atlQty = it.atlQty || it.actualQty || it.issuedQty || it.actual || 0;
      var unit = it.unit || it.uom || 'PIECE';
      var remarks = it.remarks || it.status || it.note || '';
      itemsHtml += '<tr>' +
        '<td class="td-center" style="width:5%">' + (idx + 1) + '</td>' +
        '<td class="td-center" style="width:14%">' + code + '</td>' +
        '<td class="td-center" style="width:7%"><img src="https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code) + '" style="width:30px;height:30px;display:block;margin:0 auto;" alt=""></td>' +
        '<td class="td-left" style="width:34%">' + desc + '</td>' +
        '<td class="td-center" style="width:9%">' + recQty + '</td>' +
        '<td class="td-center" style="width:9%">' + atlQty + '</td>' +
        '<td class="td-center" style="width:7%">' + unit + '</td>' +
        '<td class="td-center" style="width:15%">' + remarks + '</td>' +
        '</tr>';
    });
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="8" style="padding:20px;color:#999;font-style:italic;">No items found</td></tr>';
  }

  var html = '<div class="mrif-print-sheet">' +
    '<div style="text-align:center;font-size:16px;font-weight:bold;margin-bottom:10px;">GEMCOR</div>' +
    '<div style="text-align:center;font-size:14px;font-weight:bold;letter-spacing:3px;margin-bottom:15px;">MATERIALS REQUISITION & ISSUANCE FORM</div>' +
    '<table style="width:100%;font-size:10px;margin-bottom:10px;">' +
    '<tr><td style="font-weight:bold;width:15%;">JO NO.:</td><td style="width:35%;">' + joNo + '</td><td style="font-weight:bold;width:15%;text-align:right;">DEPARTMENT:</td><td style="width:35%;">' + dept + '</td></tr>' +
    '<tr><td style="font-weight:bold;">REQUESTOR:</td><td>' + requestor + '</td><td style="font-weight:bold;text-align:right;">DATE NEEDED:</td><td>' + dateNeeded + '</td></tr>' +
    '<tr><td style="font-weight:bold;">DATE PREPARED:</td><td>' + datePrepared + '</td><td style="font-weight:bold;text-align:right;">PREPARED BY:</td><td>' + preparedBy + '</td></tr>' +
    '</table>' +
    '<table class="mrr-items">' +
    '<thead><tr>' +
    '<th style="width:5%">ITEM<br>NO.</th>' +
    '<th style="width:14%">ITEM<br>CODE</th>' +
    '<th style="width:7%">QR<br>IMG</th>' +
    '<th style="width:34%">ITEM DESCRIPTION</th>' +
    '<th style="width:9%">REC.<br>QTY</th>' +
    '<th style="width:9%">ATL.<br>QTY</th>' +
    '<th style="width:7%">UNIT</th>' +
    '<th style="width:15%">REMARKS</th>' +
    '</tr></thead>' +
    '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div style="display:flex;justify-content:space-around;margin-top:30px;">' +
    '<div style="text-align:center;width:30%;"><div style="min-height:20px;"></div><div style="border-bottom:1px solid #333;margin:5px 0;"></div><div style="font-size:9px;font-weight:bold;">ISSUED BY</div></div>' +
    '<div style="text-align:center;width:30%;"><div style="min-height:20px;"></div><div style="border-bottom:1px solid #333;margin:5px 0;"></div><div style="font-size:9px;font-weight:bold;">CHECKED BY</div></div>' +
    '<div style="text-align:center;width:30%;"><div style="min-height:20px;"></div><div style="border-bottom:1px solid #333;margin:5px 0;"></div><div style="font-size:9px;font-weight:bold;">RECEIVED BY / DATE</div></div>' +
    '</div>' +
    '</div>';

  container.innerHTML = html;
}

function printMrif() {
  var content = document.getElementById('mrifPrintContent').innerHTML;
  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed'; iframe.style.top = '-9999px'; iframe.style.left = '-9999px';
  iframe.style.width = '210mm'; iframe.style.height = '297mm';
  document.body.appendChild(iframe);
  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>');
  doc.write('body { font-family: Arial, sans-serif; margin: 0; padding: 15px; font-size: 11px; }');
  doc.write('.mrr-items { width: 100%; border-collapse: collapse; margin-top: 10px; }');
  doc.write('.mrr-items th { border: 1px solid #333; padding: 5px; background: #d9d9d9; font-size: 9px; text-align: center; }');
  doc.write('.mrr-items td { border: 1px solid #333; padding: 5px; font-size: 10px; vertical-align: middle; }');
  doc.write('.td-center { text-align: center; } .td-left { text-align: left; }');
  doc.write('</style></head><body>' + content + '</body></html>');
  doc.close();
  setTimeout(function() { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(function() { document.body.removeChild(iframe); }, 1000); }, 500);
}

// ═══════════════════════════════════════════════════════════════════════════
// Inventory Browser
// ═══════════════════════════════════════════════════════════════════════════
function openInventoryBrowser() {
  document.getElementById('inventoryBrowserModal').classList.remove('d-none');
  loadInventoryItems();
}

function closeInventoryBrowser() {
  document.getElementById('inventoryBrowserModal').classList.add('d-none');
}

function loadInventoryItems() {
  var container = document.getElementById('inventoryListContainer');
  container.innerHTML = '<div class="text-center p-3"><div class="spinner-border"></div></div>';
  fetch(API_URL + '?action=getInventoryItems')
    .then(r => r.json()).then(data => {
      if (!data.success) { container.innerHTML = '<div class="alert alert-danger">' + (data.error || 'Failed to load') + '</div>'; return; }
      inventoryItems = data.items || [];
      renderInventoryList(inventoryItems);
    }).catch(err => { container.innerHTML = '<div class="alert alert-danger">Error loading inventory</div>'; });
}

function renderInventoryList(items) {
  var container = document.getElementById('inventoryListContainer');
  if (!items || items.length === 0) { container.innerHTML = '<div class="alert alert-info">No items found</div>'; return; }
  var html = '<table class="table table-sm table-hover">';
  html += '<thead><tr><th>QR</th><th>Item Code</th><th>Description</th><th>On Hand</th><th>Unit</th><th>Action</th></tr></thead><tbody>';
  items.forEach(function(it) {
    var qrImg = it.qrImage ? '<img src="' + it.qrImage + '" style="width:40px;height:40px;">' : '<span class="text-muted">-</span>';
    html += '<tr>' +
      '<td>' + qrImg + '</td>' +
      '<td>' + (it.inventoryId || '') + '</td>' +
      '<td>' + (it.description || '') + '</td>' +
      '<td>' + (it.onHand || 0) + '</td>' +
      '<td>' + (it.unit || 'PCS') + '</td>' +
      '<td><button class="btn btn-success btn-sm" onclick="addItemToRequest(\'' + (it.inventoryId || '').replace(/'/g, "\\'") + '\', \'' + (it.description || '').replace(/'/g, "\\'") + '\', \'' + (it.unit || 'PCS').replace(/'/g, "\\'") + '\')">+</button></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function filterInventory() {
  var term = document.getElementById('inventorySearchInput').value.toLowerCase();
  var filtered = inventoryItems.filter(function(it) {
    return (it.inventoryId || '').toLowerCase().indexOf(term) !== -1 || (it.description || '').toLowerCase().indexOf(term) !== -1;
  });
  renderInventoryList(filtered);
}

function addItemToRequest(code, desc, unit) {
  wizardItems.push({ inventoryId: code, description: desc, unit: unit, qty: 1, atlQty: 0 });
  renderWizardItems();
  showToast('Item added: ' + code, 'success');
}

function scanInventoryItem() {
  openQrScanner('inventory');
}

// ═══════════════════════════════════════════════════════════════════════════
// Manual MRR
// ═══════════════════════════════════════════════════════════════════════════
function openManualMrrModal() {
  manualMrrItems = [];
  renderManualMrrItems();
  var modal = new bootstrap.Modal(document.getElementById('manualMrrModal'));
  modal.show();
}

function addManualMrrItem() {
  manualMrrItems.push({ inventoryId: '', description: '', qty: 0, atlQty: 0, unit: 'PCS' });
  renderManualMrrItems();
}

function removeManualMrrItem(index) {
  manualMrrItems.splice(index, 1);
  renderManualMrrItems();
}

function updateManualMrrItem(index, field, value) {
  manualMrrItems[index][field] = value;
}

function renderManualMrrItems() {
  var tbody = document.getElementById('manualMrrItemsBody');
  if (!tbody) return;
  var html = '';
  manualMrrItems.forEach(function(it, i) {
    html += '<tr>' +
      '<td><input type="text" class="form-control form-control-sm" value="' + (it.inventoryId || '') + '" onchange="updateManualMrrItem(' + i + ', \'inventoryId\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm" value="' + (it.description || '') + '" onchange="updateManualMrrItem(' + i + ', \'description\', this.value)"></td>' +
      '<td><input type="number" class="form-control form-control-sm" value="' + (it.qty || 0) + '" onchange="updateManualMrrItem(' + i + ', \'qty\', this.value)"></td>' +
      '<td><input type="number" class="form-control form-control-sm" value="' + (it.atlQty || 0) + '" onchange="updateManualMrrItem(' + i + ', \'atlQty\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm" value="' + (it.unit || 'PCS') + '" onchange="updateManualMrrItem(' + i + ', \'unit\', this.value)"></td>' +
      '<td><button class="btn btn-danger btn-sm" onclick="removeManualMrrItem(' + i + ')">🗑</button></td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function submitManualMrr() {
  var poNo = document.getElementById('manualMrrPoNo').value || '';
  var drNo = document.getElementById('manualMrrDrNo').value || '';
  var vendor = document.getElementById('manualMrrVendor').value || '';
  var receivingSite = document.getElementById('manualMrrSite').value || 'GEMCOR CATMON';
  var receivingDate = document.getElementById('manualMrrDate').value || '';
  var preparedBy = document.getElementById('manualMrrPreparedBy').value || '';

  if (!drNo) { showToast('DR No. is required', 'error'); return; }
  if (!vendor) { showToast('Vendor is required', 'error'); return; }
  if (manualMrrItems.length === 0) { showToast('Add at least one item', 'error'); return; }

  var payload = {
    action: 'createMrrRequest',
    isManual: true,
    poNo: poNo,
    drNo: drNo,
    supplier: vendor,
    receivingSite: receivingSite,
    receivingDate: receivingDate,
    preparedBy: preparedBy,
    items: manualMrrItems
  };

  fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(r => r.json()).then(data => {
      if (data.success) {
        showToast('MRR created: ' + data.docNo, 'success');
        bootstrap.Modal.getInstance(document.getElementById('manualMrrModal')).hide();
      } else {
        showToast('Error: ' + (data.error || 'Unknown'), 'error');
      }
    }).catch(err => { showToast('Failed to create MRR', 'error'); });
}

// ═══════════════════════════════════════════════════════════════════════════
// New Request Wizard
// ═══════════════════════════════════════════════════════════════════════════
function openNewRequestWizard() {
  wizardItems = [];
  renderWizardItems();
  document.getElementById('newRequestWizard').classList.remove('d-none');
  showWizardStep(1);
}

function closeNewRequestWizard() {
  document.getElementById('newRequestWizard').classList.add('d-none');
}

function showWizardStep(step) {
  var panels = document.querySelectorAll('.wizard-panel');
  panels.forEach(function(p) { p.classList.remove('active'); });
  var activePanel = document.getElementById('wizardStep' + step);
  if (activePanel) activePanel.classList.add('active');

  var steps = document.querySelectorAll('.wizard-step');
  steps.forEach(function(s, idx) {
    s.classList.toggle('active', idx + 1 === step);
    s.classList.toggle('completed', idx + 1 < step);
  });
}

function nextWizardStep() {
  var current = document.querySelector('.wizard-panel.active');
  var currentNum = current ? parseInt(current.id.replace('wizardStep', '')) : 1;
  if (currentNum < 5) showWizardStep(currentNum + 1);
}

function prevWizardStep() {
  var current = document.querySelector('.wizard-panel.active');
  var currentNum = current ? parseInt(current.id.replace('wizardStep', '')) : 1;
  if (currentNum > 1) showWizardStep(currentNum - 1);
}

function selectDocType(type) {
  document.querySelectorAll('.doc-type-card').forEach(function(c) { c.classList.remove('selected'); });
  event.currentTarget.classList.add('selected');
  document.getElementById('selectedDocType').value = type;
}

function addWizardItem() {
  wizardItems.push({ inventoryId: '', description: '', qty: 1, atlQty: 0, unit: 'PCS' });
  renderWizardItems();
}

function removeWizardItem(index) {
  wizardItems.splice(index, 1);
  renderWizardItems();
}

function updateWizardItem(index, field, value) {
  wizardItems[index][field] = value;
}

function renderWizardItems() {
  var tbody = document.getElementById('wizardItemsBody');
  if (!tbody) return;
  var html = '';
  wizardItems.forEach(function(it, i) {
    html += '<tr>' +
      '<td><input type="text" class="form-control form-control-sm" value="' + (it.inventoryId || '') + '" onchange="updateWizardItem(' + i + ', \'inventoryId\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm" value="' + (it.description || '') + '" onchange="updateWizardItem(' + i + ', \'description\', this.value)"></td>' +
      '<td><input type="number" class="form-control form-control-sm" value="' + (it.qty || 0) + '" onchange="updateWizardItem(' + i + ', \'qty\', this.value)"></td>' +
      '<td><input type="text" class="form-control form-control-sm" value="' + (it.unit || 'PCS') + '" onchange="updateWizardItem(' + i + ', \'unit\', this.value)"></td>' +
      '<td><button class="btn btn-danger btn-sm" onclick="removeWizardItem(' + i + ')">🗑</button></td>' +
      '</tr>';
  });
  tbody.innerHTML = html;
}

function submitNewRequest() {
  var docType = document.getElementById('selectedDocType').value || 'MRIF';
  var joNo = document.getElementById('wizardJoNo').value || '';
  var department = document.getElementById('wizardDepartment').value || '';
  var requestor = document.getElementById('wizardRequestor').value || '';
  var dateNeeded = document.getElementById('wizardDateNeeded').value || '';
  var preparedBy = document.getElementById('wizardPreparedBy').value || '';

  if (wizardItems.length === 0) { showToast('Add at least one item', 'error'); return; }

  var payload = {
    action: 'createDigitalRequest',
    docType: docType,
    joNo: joNo,
    department: department,
    requestor: requestor,
    dateNeeded: dateNeeded,
    preparedBy: preparedBy,
    items: wizardItems
  };

  fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(r => r.json()).then(data => {
      if (data.success) {
        showToast(docType + ' created: ' + data.docNo, 'success');
        closeNewRequestWizard();
        // Show QR modal
        showQrModal(data.docNo);
      } else {
        showToast('Error: ' + (data.error || 'Unknown'), 'error');
      }
    }).catch(err => { showToast('Failed to create request', 'error'); });
}

function showQrModal(docNo) {
  var appUrl = window.location.origin + window.location.pathname;
  var qrDataUrl = appUrl + '?doc=' + encodeURIComponent(docNo);
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrDataUrl);
  document.getElementById('qrDocNo').textContent = docNo;
  document.getElementById('qrImage').src = qrUrl;
  var modal = new bootstrap.Modal(document.getElementById('qrModal'));
  modal.show();
}

// ═══════════════════════════════════════════════════════════════════════════
// QR Scanner
// ═══════════════════════════════════════════════════════════════════════════
var qrScanner = null;
var scannerCallback = null;

function openQrScanner(callbackType) {
  scannerCallback = callbackType;
  document.getElementById('qrScannerModal').classList.remove('d-none');
  startQrScanner();
}

function closeQrScanner() {
  document.getElementById('qrScannerModal').classList.add('d-none');
  if (qrScanner) { qrScanner.stop(); qrScanner = null; }
}

function startQrScanner() {
  var html5Qrcode = new Html5Qrcode('qrScannerVideo');
  qrScanner = html5Qrcode;
  html5Qrcode.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } },
    function(decodedText) {
      console.log('[QR Scan] decoded:', decodedText);
      // Detect URL with ?doc= parameter
      var urlDocMatch = decodedText.match(/[?&]doc=([^&\s]+)/);
      if (urlDocMatch) {
        var extractedDoc = decodeURIComponent(urlDocMatch[1]);
        decodedText = extractedDoc;
        console.log('[QR Scan] Extracted doc from URL:', extractedDoc);
      }
      var docPattern = /^(MRIF|MRR|MRS)\d{6,}/i;
      if (docPattern.test(decodedText)) {
        closeQrScanner();
        if (confirm('Document QR detected: ' + decodedText + '. Open document?')) {
          var prefix = decodedText.substring(0, 3).toUpperCase();
          if (prefix === 'MRR') { selectModule('MRR'); openMrrPrint(decodedText); }
          else if (prefix === 'MRF') { selectModule('MRIF'); openMrifPrint(decodedText); }
        }
      } else if (scannerCallback === 'inventory') {
        closeQrScanner();
        var found = inventoryItems.find(function(it) { return (it.inventoryId || '').toLowerCase() === decodedText.toLowerCase(); });
        if (found) { addItemToRequest(found.inventoryId, found.description, found.unit); }
        else { showToast('Item not found: ' + decodedText, 'warning'); }
      } else {
        showToast('QR: ' + decodedText, 'info');
      }
    },
    function(error) {}
  ).catch(err => { console.error('QR scanner error:', err); showToast('Camera error', 'error'); });
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════
function showToast(message, type) {
  var toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;';
    document.body.appendChild(toastContainer);
  }
  var bgClass = type === 'success' ? 'bg-success' : type === 'error' ? 'bg-danger' : type === 'warning' ? 'bg-warning' : 'bg-info';
  var toast = document.createElement('div');
  toast.className = 'toast align-items-center text-white ' + bgClass + ' border-0 mb-2';
  toast.setAttribute('role', 'alert');
  toast.innerHTML = '<div class="d-flex"><div class="toast-body">' + message + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
  toastContainer.appendChild(toast);
  var bsToast = new bootstrap.Toast(toast, { delay: 3000 });
  bsToast.show();
  setTimeout(function() { toast.remove(); }, 3500);
}

function getSheetIdForType(docType) {
  // Return the spreadsheet ID for the document type
  // This should match your Google Sheets setup
  return '';
}

function openSettings() {
  var modal = new bootstrap.Modal(document.getElementById('settingsModal'));
  modal.show();
}
