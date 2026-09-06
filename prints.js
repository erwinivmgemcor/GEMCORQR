// ============================================================
// PRINT PREVIEW FUNCTIONS
// ============================================================

// ─── Helper: load document list for a module ────────────────────
async function loadDocumentListForModule(docType) {
  var prevModule = state.currentModule;
  state.currentModule = docType;
  var id = getCleanSheetId();
  state.currentModule = prevModule;
  
  if (!id) {
    showToast('⚠️ No Sheet ID for ' + docType + '. Please sync or enter it in Settings.', 'warning');
    return [];
  }
  
  try {
    const url = API_URL + '?action=getPendingDocs&docType=' + docType + '&sheetId=' + id + '&_t=' + Date.now();
    console.log('[loadDocumentListForModule] URL:', url);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    console.log('[loadDocumentListForModule] Raw response:', text.substring(0, 500));
    let data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return [];
    }
    const docs = Array.isArray(data) ? data : (data.docs || data.documents || []);
    return docs;
  } catch(err) {
    console.error('[loadDocumentListForModule] Error:', err);
    showToast('Failed to load ' + docType + ' list: ' + err.message, 'danger');
    return [];
  }
}

function renderDocumentList(container, docs, docType) {
  if (!container) return;
  container.innerHTML = '';
  if (!docs || docs.length === 0) {
    container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No ' + docType + ' documents found</div>';
    return;
  }
  var ignoreList = ['MONITORING', 'SUMMARY', 'SYNC', 'SERVED', 'INVENTORYCODES', 'REQUESTOR LIST', 'SOF MONITORING 2026', 'GEMCOR PRF PO', 'Sheet1', 'LINKS', 'Copy of INVENTORYCODES', 'DOCLINKS'];
  var filtered = docs.filter(function(d) {
    var name = d.docNo || d.sheetName || '';
    for (var i = 0; i < ignoreList.length; i++) {
      if (name.toUpperCase().indexOf(ignoreList[i]) !== -1) return false;
    }
    return true;
  });
  if (filtered.length === 0) {
    container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No valid ' + docType + ' documents found</div>';
    return;
  }
  filtered.forEach(function(d) {
    var docNo = typeof d === 'string' ? d : (d.docNo || d.name || d.sheetName || '');
    var el = document.createElement('div');
    el.className = 'list-group-item mrif-list-item d-flex justify-content-between align-items-center';
    var color = docType === 'MRR' ? 'success' : (docType === 'MRIF' ? 'warning' : 'warning');
    el.innerHTML = '<div><i class="bi bi-file-earmark-text me-2 text-' + color + '"></i><strong>' + docNo + '</strong></div>' +
      '<button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye me-1"></i>View / Print</button>';
    el.addEventListener('click', function() {
      if (docType === 'MRIF') openMrifPrint(docNo);
      else if (docType === 'MRR') openMrrPrint(docNo);
      else if (docType === 'MRS') openMrsPrint(docNo);
    });
    container.appendChild(el);
  });
}

// ─── MRIF List ────────────────────────────────────────────────────
async function openMrifList() {
  if (state.isLoading) return;
  if (mrifListModal) mrifListModal.show();
  var container = document.getElementById('mrifListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading MRIF documents...</div></div>';
  }
  try {
    var docs = await loadDocumentListForModule('MRIF');
    renderDocumentList(container, docs, 'MRIF');
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

async function openMrifPrint(docNo) {
  if (state.isLoading) return;
  showLoading('Loading ' + cleanDocNo(docNo) + '...');
  try {
    var sheetId = getCleanSheetId();
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[openMrifPrint] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openMrifPrint] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[openMrifPrint] JSON parse error:', e);
      data = {}; 
    }
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return;
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      return;
    }
    if (!data.items || data.items.length === 0) {
      console.warn('[openMrifPrint] No items found for ' + docNo, data.debug);
      showToast('Warning: No items found in this document', 'warning');
    }
    renderMrifPrint(docNo, data.info || {}, data.items || []);
    if (mrifListModal) mrifListModal.hide();
    setTimeout(function() {
      if (mrifPrintModal) mrifPrintModal.show();
    }, 300);
  } catch(err) {
    console.error('[openMrifPrint] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function renderMrifPrint(docNo, info, items) {
  var container = document.getElementById('mrifPrintContent');
  if (!container) return;

  console.log('[renderMrifPrint] docNo:', docNo, 'items count:', items ? items.length : 0);
  console.log('[renderMrifPrint] info:', JSON.stringify(info));

  var requestor = info.Requestor || info.requestor || info.requestorName || '';
  var department = info.Department || info.department || info.dept || '';
  var dateRaw = info.Date || info.date || info['Date Prepared'] || info.datePrepared || '';
  var gemSo = info['GEM SO No.'] || info.gemSoNo || info.gemSo || '';
  var joNo = info['JO No.'] || info.joNo || '';
  var client = info['Client Name'] || info.clientName || info.client || '';
  var project = info.Project || info.project || '';

  var dateStr = dateRaw;
  try {
    var d = new Date(dateRaw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var code = it.itemCode || it.inventoryId || it.code || '';
      var desc = it.description || it.desc || '';
      var qty = it.expectedQty || it.qty || it.requestedQty || 0;
      var issued = it.actualQty || it.issuedQty || it.atlQty || 0;
      var unit = it.unit || 'PIECE';
      var remarks = it.remarks || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code);
      itemsHtml += '<tr>' +
        '<td class="td-center">' + (i + 1) + '</td>' +
        '<td class="td-center">' + code + '</td>' +
        '<td class="td-center"><img src="' + qrUrl + '" style="width:32px;height:32px;display:block;margin:0 auto;" alt=""></td>' +
        '<td class="td-left">' + desc + '</td>' +
        '<td class="td-center">' + qty + '</td>' +
        '<td class="td-center">' + issued + '</td>' +
        '<td class="td-center">' + unit + '</td>' +
        '<td class="td-center">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="8" style="padding:20px;color:#999;font-style:italic;">No items found in this document</td></tr>';
  }

  itemsHtml += '<tr><td class="td-center" colspan="8">&nbsp;</td></tr>';

  var mrifQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

  var html = '<div class="mrif-print-sheet">' +
    '<div class="mrif-header">' +
      '<div class="mrif-logo"><img src="gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrif-docno">' +
        '<div><span class="mrif-dn-label">MRIF No.:</span><span class="mrif-dn-box">' + cleanDocNo(docNo) + '</span></div>' +
        '<div class="mrif-doc-qr"><img src="' + mrifQrUrl + '" alt="MRIF QR" style="width:90px;height:90px;margin-top:4px;"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrif-title">MATERIALS REQUEST AND ISSUANCE FORM</div>' +
    '<table class="mrif-meta">' +
      '<tr>' +
        '<td class="meta-label">REQUESTOR:</td>' +
        '<td class="meta-value" colspan="2">' + requestor + '</td>' +
        '<td class="meta-label-right">GEM SO No.:</td>' +
        '<td class="meta-blue">' + gemSo + '</td>' +
        '<td class="meta-label-right">JO No.:</td>' +
        '<td class="meta-blue">' + joNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DEPARTMENT/SECTION:</td>' +
        '<td class="meta-value" colspan="4">' + department + '</td>' +
        '<td class="meta-label-right">CLIENT NAME:</td>' +
        '<td class="meta-value">' + client + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DATE:</td>' +
        '<td class="meta-blue" colspan="2">' + dateStr + '</td>' +
        '<td class="meta-label-right">PROJECT:</td>' +
        '<td class="meta-value" colspan="3">' + project + '</td>' +
      '</tr>' +
    '</table>' +
    '<table class="mrif-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%">ITEM<br>NO.</th>' +
          '<th style="width:14%">ITEM<br>CODE</th>' +
          '<th style="width:7%">QR<br>IMG</th>' +
          '<th style="width:34%">ITEM DESCRIPTION</th>' +
          '<th style="width:9%">REQ.<br>QTY</th>' +
          '<th style="width:9%">ISSUED<br>QTY</th>' +
          '<th style="width:7%">UNIT</th>' +
          '<th style="width:15%">REMARKS</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrif-sigs">' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line">ANGEL / JOMAR / RICHEL / ERWIN / MARCEL</div>' +
        '<div class="mrif-sig-label">ISSUED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line">&nbsp;</div>' +
        '<div class="mrif-sig-label">CHECKED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line">&nbsp;</div>' +
        '<div class="mrif-sig-label">RECEIVED BY/DATE</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  console.log('[renderMrifPrint] HTML rendered successfully');
}

function printMrif() {
  var previewContent = document.getElementById('mrifPrintContent');
  if (!previewContent) {
    showToast('Print content not found', 'danger');
    return;
  }
  var sheetHtml = previewContent.innerHTML;
  if (!sheetHtml || sheetHtml.trim() === '') {
    showToast('Nothing to print', 'warning');
    return;
  }

  var printStyles =
    '@page { size: letter portrait; margin: 0.3in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #000; line-height: 1.3; }' +
    '.mrif-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.2in; }' +
    '.mrif-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }' +
    '.mrif-logo img { height: 55px; width: auto; }' +
    '.mrif-docno { text-align: right; }' +
    '.mrif-dn-label { font-weight: bold; font-size: 10pt; margin-right: 6px; }' +
    '.mrif-dn-box { display: inline-block; background: #f8d7da; border: 1px solid #f5c6cb; padding: 2px 10px; font-weight: bold; font-size: 11pt; color: #721c24; }' +
    '.mrif-doc-qr { margin-top: 4px; }' +
    '.mrif-doc-qr img { width: 90px; height: 90px; }' +
    '.mrif-title { text-align: center; font-size: 14pt; font-weight: bold; letter-spacing: 4px; margin: 12px 0 16px 0; text-transform: uppercase; }' +
    '.mrif-meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5pt; }' +
    '.mrif-meta td { padding: 3px 6px; vertical-align: top; }' +
    '.meta-label { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; }' +
    '.meta-value { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-label-right { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; padding-left: 12px; }' +
    '.meta-value-right { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-blue { background: #cfe2f3; padding: 2px 6px; font-weight: bold; }' +
    '.mrif-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }' +
    '.mrif-items th, .mrif-items td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }' +
    '.mrif-items th { background: #fff; font-weight: bold; text-align: center; font-size: 8.5pt; }' +
    '.mrif-items td.td-center { text-align: center; }' +
    '.mrif-items td.td-left { text-align: left; }' +
    '.mrif-items td.td-nofurther { text-align: center; font-size: 7pt; font-weight: bold; padding: 4px; border: 1px solid #000; }' +
    '.mrif-sigs { display: flex; justify-content: space-around; margin-top: 30px; text-align: center; }' +
    '.mrif-sig { width: 30%; }' +
    '.mrif-sig-line { border-bottom: 1px solid #000; height: 28px; margin-bottom: 2px; font-size: 8pt; }' +
    '.mrif-sig-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; }';

  var fullHtml = '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>MRIF Print</title><style>' + printStyles + '</style></head>' +
    '<body>' + sheetHtml + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      showToast('Print failed. Try again.', 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 800);
}

function closeMrifPrint() {
  if (mrifPrintModal) mrifPrintModal.hide();
}

// ─── MRR List & Print ────────────────────────────────────────────
async function openMrrList() {
  if (state.isLoading) return;
  if (mrrListModal) mrrListModal.show();
  var container = document.getElementById('mrrListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading MRR documents...</div></div>';
  }
  try {
    var docs = await loadDocumentListForModule('MRR');
    renderDocumentList(container, docs, 'MRR');
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

async function openMrrPrint(docNo) {
  if (state.isLoading) return;
  showLoading('Loading ' + cleanDocNo(docNo) + '...');
  try {
    var sheetId = getCleanSheetId();
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRR&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[openMrrPrint] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openMrrPrint] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[openMrrPrint] JSON parse error:', e);
      data = {}; 
    }
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return;
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      return;
    }
    if (!data.items || data.items.length === 0) {
      console.warn('[openMrrPrint] No items found for ' + docNo, data.debug);
      showToast('Warning: No items found in this document', 'warning');
    }
    renderMrrPrint(docNo, data.info || {}, data.items || []);
    if (mrrListModal) mrrListModal.hide();
    setTimeout(function() {
      if (mrrPrintModal) mrrPrintModal.show();
    }, 300);
  } catch(err) {
    console.error('[openMrrPrint] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function renderMrrPrint(docNo, info, items) {
  var container = document.getElementById('mrrPrintContent');
  if (!container) return;

  console.log('[renderMrrPrint] docNo:', docNo);
  console.log('[renderMrrPrint] Info object:', JSON.stringify(info, null, 2));
  console.log('[renderMrrPrint] Items count:', items ? items.length : 0);

  var receivingSite = info['Receiving Site'] || info.receivingSite || 'GEMCOR CATMON';
  var vendor = info['Vendor/Client'] || info.vendor || info.client || '';
  var datePrepared = info['Date Prepared'] || info.datePrepared || '';
  var poNo = info['PO No.'] || info.poNo || '';
  var drNo = info['DR No.'] || info['DR No / SI No.'] || info['DR No'] || info.drNo || info['D.R. No.'] || info.dr || '';
  var receivingDate = info['Receiving Date'] || info.receivingDate || '';
  var preparedBy = info['Prepared By'] || info.preparedBy || '';

  function formatDate(val) {
    if (!val || val === '') return '';
    if (typeof val === 'string' && val.indexOf('GMT') === -1 && val.indexOf('Standard') === -1) {
      if (val.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)/)) return val;
      if (val.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) return val;
    }
    try {
      var d = new Date(val);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
        var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
      }
    } catch(e) {}
    return String(val).replace(/\s*GMT.*$/, '').replace(/\s*Standard.*$/, '').trim();
  }

  var dateStr = formatDate(datePrepared);
  var recDateStr = formatDate(receivingDate);

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var idx = 0; idx < items.length; idx++) {
      var it = items[idx];
      var code = it.inventoryId || it.itemCode || '';
      var desc = it.description || it.desc || it.itemDescription || '';
      var requestedQty = it.recQty || it.expectedQty || it.qty || it.quantity || 0;
      var receivedQty = it.atlQty || it.actualQty || it.issuedQty || it.actual || 0;
      var unit = it.unit || it.uom || 'PIECE';
      var remarks = it.remarks || it.status || it.note || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code || 'blank');

      itemsHtml += '<tr>' +
        '<td class="td-center" style="width:5%">' + (idx + 1) + '</td>' +
        '<td class="td-center" style="width:16%">' + code + '</td>' +
        '<td class="td-left" style="width:35%">' + desc + '</td>' +
        '<td class="td-center" style="width:10%">' + requestedQty + '</td>' +
        '<td class="td-center" style="width:10%">' + receivedQty + '</td>' +
        '<td class="td-center" style="width:8%">' + unit + '</td>' +
        '<td class="td-center" style="width:16%">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="7" style="padding:20px;color:#999;font-style:italic;">No items found in this document</td></tr>';
  }

  var mrrQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

  var html = '<div class="mrr-print-sheet">' +
    '<div class="mrr-header">' +
      '<div class="mrr-logo"><img src="gemcor-logo.png" alt="GEMCOR" onerror="this.style.display=\'none\'"></div>' +
      '<div class="mrr-docno">' +
        '<div><span class="mrr-dn-label">Receipt No.:</span><span class="mrr-dn-box">' + cleanDocNo(docNo) + '</span></div>' +
        '<div class="mrr-doc-qr"><img src="' + mrrQrUrl + '" alt="MRR QR"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrr-title">MATERIALS RECEIVING REPORT</div>' +
    '<table class="mrr-meta-table">' +
      '<tr>' +
        '<td class="mrr-meta-label">RECEIVING SITE:</td>' +
        '<td class="mrr-meta-value" colspan="5">' + receivingSite + '</td>' +
        '<td class="mrr-meta-label-right">PO No. / SOF No.:</td>' +
        '<td class="mrr-meta-value-right">' + poNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="mrr-meta-label">VENDOR:</td>' +
        '<td class="mrr-meta-value" colspan="5">' + vendor + '</td>' +
        '<td class="mrr-meta-label-right">DR No / SI No.:</td>' +
        '<td class="mrr-meta-value-right">' + drNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="mrr-meta-label">DATE PREPARED:</td>' +
        '<td class="mrr-meta-value" colspan="2">' + dateStr + '</td>' +
        '<td class="mrr-meta-label-right">RECEIVING DATE:</td>' +
        '<td class="mrr-meta-value-right" colspan="4">' + recDateStr + '</td>' +
      '</tr>' +
    '</table>' +
    '<table class="mrr-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%">ITEM<br>NO.</th>' +
          '<th style="width:16%">ITEM<br>CODE</th>' +
          '<th style="width:35%">ITEM DESCRIPTION</th>' +
          '<th style="width:10%">REQUESTED<br>QTY</th>' +
          '<th style="width:10%">RECEIVED<br>QTY</th>' +
          '<th style="width:8%">UNIT</th>' +
          '<th style="width:16%">REMARKS</th>' +
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
        '<div class="mrr-sig-label">RECEIVED BY / DATE</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  console.log('[renderMrrPrint] HTML rendered. DR No displayed:', drNo);
}

function printMrr() {
  var previewContent = document.getElementById('mrrPrintContent');
  if (!previewContent) {
    showToast('Print content not found', 'danger');
    return;
  }
  var sheetHtml = previewContent.innerHTML;
  if (!sheetHtml || sheetHtml.trim() === '') {
    showToast('Nothing to print', 'warning');
    return;
  }

  var printStyles =
    '@page { size: letter portrait; margin: 0.25in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; line-height: 1.3; }' +
    '.mrr-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.2in; }' +
    '.mrr-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }' +
    '.mrr-logo img { height: 48px; width: auto; }' +
    '.mrr-docno { text-align: right; }' +
    '.mrr-dn-label { font-weight: bold; font-size: 9pt; margin-right: 4px; }' +
    '.mrr-dn-box { display: inline-block; background: #f4cccc; border: 1px solid #e6b8b8; padding: 2px 10px; font-weight: bold; font-size: 10pt; color: #000; letter-spacing: 1px; }' +
    '.mrr-doc-qr { margin-top: 4px; text-align: right; }' +
    '.mrr-doc-qr img { width: 75px; height: 75px; }' +
    '.mrr-title { text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 5px; margin: 8px 0 14px 0; text-transform: uppercase; }' +
    '.mrr-meta-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 8.5pt; }' +
    '.mrr-meta-table td { padding: 0; vertical-align: middle; border: none; }' +
    '.mrr-meta-label { font-weight: bold; font-size: 8pt; letter-spacing: 2px; text-align: left; white-space: nowrap; padding: 3px 4px 3px 0; width: 18%; line-height: 1.2; }' +
    '.mrr-meta-value { background: #cfe2f3; padding: 4px 6px; font-size: 9pt; font-weight: bold; text-align: left; border: 1px solid #b6d7e8; width: 32%; line-height: 1.2; }' +
    '.mrr-meta-label-right { font-weight: bold; font-size: 8pt; letter-spacing: 1.5px; text-align: left; white-space: nowrap; padding: 3px 4px 3px 10px; width: 20%; line-height: 1.2; }' +
    '.mrr-meta-value-right { background: #cfe2f3; padding: 4px 6px; font-size: 9pt; font-weight: bold; text-align: left; border: 1px solid #b6d7e8; width: 30%; line-height: 1.2; }' +
    '.mrr-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 8.5pt; }' +
    '.mrr-items th, .mrr-items td { border: 1.5px solid #000; padding: 4px 5px; vertical-align: middle; }' +
    '.mrr-items th { background: #fff; font-weight: bold; text-align: center; font-size: 8pt; letter-spacing: 0.5px; }' +
    '.mrr-items td.td-center { text-align: center; }' +
    '.mrr-items td.td-left { text-align: left; }' +
    '.mrr-items td.td-nofurther { text-align: center; font-size: 7pt; font-weight: bold; padding: 3px; border: 1.5px solid #000; letter-spacing: 0.5px; }' +
    '.mrr-checkboxes { font-size: 7.5pt; margin-top: 6px; margin-bottom: 16px; }' +
    '.mrr-cb-section { margin-bottom: 6px; }' +
    '.mrr-cb-title { font-weight: bold; font-size: 7.5pt; letter-spacing: 0.5px; margin-bottom: 3px; text-transform: uppercase; }' +
    '.mrr-cb-row { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-bottom: 4px; padding-left: 2px; }' +
    '.mrr-cb-item { font-size: 7.5pt; display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }' +
    '.mrr-cb-circle { font-size: 9pt; line-height: 1; font-family: "Courier New", monospace; }' +
    '.mrr-sigs { display: flex; justify-content: center; gap: 50px; margin-top: 24px; text-align: center; }' +
    '.mrr-sig { width: 26%; min-width: 140px; }' +
    '.mrr-sig-name { font-size: 9.5pt; font-weight: bold; text-transform: uppercase; margin-bottom: 1px; min-height: 16px; letter-spacing: 0.5px; }' +
    '.mrr-sig-line { border-bottom: 1.5px solid #000; height: 18px; margin-bottom: 2px; }' +
    '.mrr-sig-label { font-size: 8.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; font-style: italic; }';

  var fullHtml = '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>MRR Print</title><style>' + printStyles + '</style></head>' +
    '<body>' + sheetHtml + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      showToast('Print failed. Try again.', 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 800);
}

function closeMrrPrint() {
  if (mrrPrintModal) mrrPrintModal.hide();
}

// ─── MRS List & Print ────────────────────────────────────────────
async function openMrsList() {
  if (state.isLoading) return;
  if (mrsListModal) mrsListModal.show();
  var container = document.getElementById('mrsListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading MRS documents...</div></div>';
  }
  try {
    var docs = await loadDocumentListForModule('MRS');
    renderDocumentList(container, docs, 'MRS');
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

async function openMrsPrint(docNo) {
  if (state.isLoading) return;
  showLoading('Loading ' + cleanDocNo(docNo) + '...');
  try {
    var sheetId = getCleanSheetId();
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) + '&docType=MRS&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[openMrsPrint] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openMrsPrint] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[openMrsPrint] JSON parse error:', e);
      data = {}; 
    }
    if (data.error) {
      showToast('Error: ' + data.error, 'danger');
      return;
    }
    if (!data.success) {
      showToast('Error: ' + (data.error || 'Failed to load document'), 'danger');
      return;
    }
    if (!data.items || data.items.length === 0) {
      console.warn('[openMrsPrint] No items found for ' + docNo, data.debug);
      showToast('Warning: No items found in this document', 'warning');
    }
    renderMrsPrint(docNo, data.info || {}, data.items || []);
    if (mrsListModal) mrsListModal.hide();
    setTimeout(function() {
      if (mrsPrintModal) mrsPrintModal.show();
    }, 300);
  } catch(err) {
    console.error('[openMrsPrint] Error:', err);
    showToast('Failed to load document: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function renderMrsPrint(docNo, info, items) {
  var container = document.getElementById('mrsPrintContent');
  if (!container) return;

  console.log('[renderMrsPrint] docNo:', docNo, 'items count:', items ? items.length : 0);
  console.log('[renderMrsPrint] info:', JSON.stringify(info));

  var requestor = info.Requestor || info.requestor || info.requestorName || '';
  var department = info.Department || info.department || info.dept || '';
  var dateRaw = info.Date || info.date || info['Date Prepared'] || info.datePrepared || '';
  var gemSo = info['GEM SO No.'] || info.gemSoNo || info.gemSo || '';
  var joNo = info['JO No.'] || info.joNo || '';
  var client = info['Client Name'] || info.clientName || info.client || '';
  var project = info.Project || info.project || '';

  var dateStr = dateRaw;
  try {
    var d = new Date(dateRaw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var code = it.itemCode || it.inventoryId || it.code || '';
      var desc = it.description || it.desc || '';
      var qtyReturned = it.expectedQty || it.qty || it.requestedQty || 0;
      var actualReturned = it.actualQty || it.issuedQty || it.atlQty || 0;
      var unit = it.unit || 'PIECE';
      var remarks = it.remarks || '';
      var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code);
      itemsHtml += '<tr>' +
        '<td class="td-center">' + (i + 1) + '</td>' +
        '<td class="td-center">' + code + '</td>' +
        '<td class="td-center"><img src="' + qrUrl + '" style="width:32px;height:32px;display:block;margin:0 auto;" alt=""></td>' +
        '<td class="td-left">' + desc + '</td>' +
        '<td class="td-center">' + qtyReturned + '</td>' +
        '<td class="td-center">' + actualReturned + '</td>' +
        '<td class="td-center">' + unit + '</td>' +
        '<td class="td-center">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="7" style="padding:20px;color:#999;font-style:italic;">No items found in this document</td></tr>';
  }

  itemsHtml += '<tr><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-left">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td><td class="td-center">&nbsp;</td></tr>';

  var mrsQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(docNo);

  var html = '<div class="mrif-print-sheet">' +
    '<div class="mrif-header">' +
      '<div class="mrif-logo"><img src="gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrif-docno">' +
        '<div><span class="mrif-dn-label">MRS No.:</span><span class="mrif-dn-box">' + cleanDocNo(docNo) + '</span></div>' +
        '<div class="mrif-doc-qr"><img src="' + mrsQrUrl + '" alt="MRS QR" style="width:90px;height:90px;margin-top:4px;"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrif-title">MATERIALS RETURN SLIP</div>' +
    '<table class="mrif-meta">' +
      '<tr>' +
        '<td class="meta-label">REQUESTOR:</td>' +
        '<td class="meta-value" colspan="2">' + requestor + '</td>' +
        '<td class="meta-label-right">GEM SO No.:</td>' +
        '<td class="meta-blue">' + gemSo + '</td>' +
        '<td class="meta-label-right">JO No.:</td>' +
        '<td class="meta-blue">' + joNo + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DEPARTMENT/SECTION:</td>' +
        '<td class="meta-value" colspan="4">' + department + '</td>' +
        '<td class="meta-label-right">CLIENT NAME:</td>' +
        '<td class="meta-value">' + client + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="meta-label">DATE:</td>' +
        '<td class="meta-blue" colspan="2">' + dateStr + '</td>' +
        '<td class="meta-label-right">PROJECT:</td>' +
        '<td class="meta-value" colspan="3">' + project + '</td>' +
      '</tr>' +
    '</table>' +
    '<table class="mrif-items">' +
      '<thead>' +
        '<tr>' +
          '<th style="width:5%">ITEM<br>NO.</th>' +
          '<th style="width:14%">ITEM<br>CODE</th>' +
          '<th style="width:7%">QR<br>IMG</th>' +
          '<th style="width:34%">ITEM DESCRIPTION</th>' +
          '<th style="width:9%">QTY<br>RETURNED</th>' +
          '<th style="width:9%">ATL QTY<br>(Actual)</th>' +
          '<th style="width:7%">UNIT</th>' +
          '<th style="width:15%">REMARKS</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrif-sigs">' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">ISSUED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">CHECKED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">RECEIVED BY/DATE</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  console.log('[renderMrsPrint] HTML rendered successfully');
}

function printMrs() {
  var previewContent = document.getElementById('mrsPrintContent');
  if (!previewContent) {
    showToast('Print content not found', 'danger');
    return;
  }
  var sheetHtml = previewContent.innerHTML;
  if (!sheetHtml || sheetHtml.trim() === '') {
    showToast('Nothing to print', 'warning');
    return;
  }

  var printStyles =
    '@page { size: letter portrait; margin: 0.3in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #000; line-height: 1.3; }' +
    '.mrif-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.2in; }' +
    '.mrif-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }' +
    '.mrif-logo img { height: 55px; width: auto; }' +
    '.mrif-docno { text-align: right; }' +
    '.mrif-dn-label { font-weight: bold; font-size: 10pt; margin-right: 6px; }' +
    '.mrif-dn-box { display: inline-block; background: #f8d7da; border: 1px solid #f5c6cb; padding: 2px 10px; font-weight: bold; font-size: 11pt; color: #721c24; }' +
    '.mrif-doc-qr { margin-top: 4px; }' +
    '.mrif-doc-qr img { width: 90px; height: 90px; }' +
    '.mrif-title { text-align: center; font-size: 14pt; font-weight: bold; letter-spacing: 4px; margin: 12px 0 16px 0; text-transform: uppercase; }' +
    '.mrif-meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5pt; }' +
    '.mrif-meta td { padding: 3px 6px; vertical-align: top; }' +
    '.meta-label { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; }' +
    '.meta-value { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-label-right { font-weight: bold; width: 18%; text-align: left; white-space: nowrap; padding-left: 12px; }' +
    '.meta-value-right { width: 32%; text-align: left; border-bottom: 1px solid #000; }' +
    '.meta-blue { background: #cfe2f3; padding: 2px 6px; font-weight: bold; }' +
    '.mrif-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }' +
    '.mrif-items th, .mrif-items td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }' +
    '.mrif-items th { background: #fff; font-weight: bold; text-align: center; font-size: 8.5pt; }' +
    '.mrif-items td.td-center { text-align: center; }' +
    '.mrif-items td.td-left { text-align: left; }' +
    '.mrif-items td.td-nofurther { text-align: center; font-size: 7pt; font-weight: bold; padding: 4px; border: 1px solid #000; }' +
    '.mrif-sigs { display: flex; justify-content: space-around; margin-top: 30px; text-align: center; }' +
    '.mrif-sig { width: 30%; }' +
    '.mrif-sig-line { border-bottom: 1px solid #000; height: 28px; margin-bottom: 2px; font-size: 8pt; }' +
    '.mrif-sig-label { font-size: 9pt; font-weight: bold; text-transform: uppercase; }';

  var fullHtml = '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><title>MRS Print</title><style>' + printStyles + '</style></head>' +
    '<body>' + sheetHtml + '</body></html>';

  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  setTimeout(function() {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      console.error('Print error:', e);
      showToast('Print failed. Try again.', 'danger');
    }
    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 800);
}

function closeMrsPrint() {
  if (mrsPrintModal) mrsPrintModal.hide();
}

// ─── PENDING MRIF LIST ───────────────────────────────────────────
async function openPendingMrifList() {
  if (state.isLoading) return;
  if (pendingMrifModal) pendingMrifModal.show();
  var container = document.getElementById('pendingMrifListContainer');
  if (container) {
    container.innerHTML = '<div class="list-group-item text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div><div class="small text-muted mt-1">Loading pending MRIFs...</div></div>';
  }
  try {
    var sheetId = getCleanSheetId() || '';
    var url = API_URL + '?action=getPendingDocCount&docType=MRIF&sheetId=' + sheetId + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }
    if (data.success && data.documents) {
      renderPendingMrifList(data.documents);
    } else {
      if (container) container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No pending MRIFs found</div>';
    }
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

function renderPendingMrifList(docs) {
  var container = document.getElementById('pendingMrifListContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!docs || docs.length === 0) {
    container.innerHTML = '<div class="list-group-item text-center text-muted py-3">No pending MRIFs</div>';
    return;
  }
  docs.forEach(function(d) {
    var docNo = typeof d === 'string' ? d : (d.docNo || d.name || '');
    var el = document.createElement('div');
    el.className = 'list-group-item pending-mrif-item';
    el.innerHTML = '<div class="d-flex justify-content-between align-items-center">' +
      '<div><i class="bi bi-file-earmark-text me-2 text-warning"></i><strong>' + docNo + '</strong></div>' +
      '<button class="btn btn-sm btn-primary"><i class="bi bi-box-arrow-in-right me-1"></i>Process</button>' +
      '</div>' +
      '<div class="small text-muted mt-1"><i class="bi bi-info-circle me-1"></i>Has items awaiting release</div>';
    el.querySelector('button').addEventListener('click', async function(e) {
      e.stopPropagation();
      if (pendingMrifModal) pendingMrifModal.hide();
      showToast('Loading ' + cleanDocNo(docNo) + '...', 'info');
      try {
        await selectModule('MRIF');
        await onDocSelect(docNo);
      } catch(err) {
        console.error('[Pending MRIF] Error loading doc:', err);
        showToast('Failed to load ' + cleanDocNo(docNo) + '. Try again.', 'danger');
      }
    });
    container.appendChild(el);
  });
}
