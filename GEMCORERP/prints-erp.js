// ============================================================
// GEMCOR ERP — Print Preview System (Supabase-first)
// Reused from main system, adapted for ERP
// v1.0 — No GAS, pure Supabase reads
// ============================================================

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function _printEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _printQrData(docNo) {
  if (!docNo) return '';
  var base = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  return base + '?doc=' + encodeURIComponent(docNo) + '&view=print';
}

function _printQrUrl(data, size) {
  size = size || 120;
  return 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
         '&data=' + encodeURIComponent(data) +
         '&qzone=1&margin=0';
}

var _printQrDataUrlCache = {};

async function _printQrToDataUrl(data, size) {
  size = size || 120;
  var cacheKey = size + '_' + data;
  if (_printQrDataUrlCache[cacheKey]) return _printQrDataUrlCache[cacheKey];

  var url = _printQrUrl(data, size);
  try {
    var res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var blob = await res.blob();
    var dataUrl = await new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    _printQrDataUrlCache[cacheKey] = dataUrl;
    return dataUrl;
  } catch(e) {
    console.warn('[QR] Could not embed QR for:', data, e.message);
    return '';
  }
}

async function _printEmbedQrInHtml(html) {
  if (!html) return html;

  var regex = /<img\s+([^>]*?)data-qr="([^"]*)"([^>]*?)data-qr-size="(\d+)"([^>]*?)>/g;
  var matches = [];
  var m;
  while ((m = regex.exec(html)) !== null) {
    matches.push({
      full: m[0],
      before: m[1],
      data: decodeURIComponent(m[2]),
      after: m[3],
      size: parseInt(m[4], 10) || 120,
      trailing: m[5]
    });
  }

  if (matches.length === 0) return html;

  var conversions = matches.map(function(match) {
    return _printQrToDataUrl(match.data, match.size).then(function(dataUrl) {
      if (!dataUrl) return null;
      var newImg = '<img ' + match.before +
        'src="' + dataUrl + '" ' +
        match.after +
        match.trailing +
        '>';
      return { old: match.full, new: newImg };
    });
  });

  var results = await Promise.all(conversions);

  results.forEach(function(r) {
    if (r && r.old && r.new) {
      html = html.split(r.old).join(r.new);
    }
  });

  return html;
}

// ═══════════════════════════════════════════════════════════
// CLEAN REMARKS
// ═══════════════════════════════════════════════════════════
function _cleanRemarksForPrint(remarks) {
  if (!remarks) return '';
  var s = String(remarks).trim();
  s = s.replace(/\s*\((SERVED|PENDING|PARTIAL|COMPLETE|BALANCED)\)\s*/gi, ' ');
  s = s.replace(/\b(SERVED|PENDING|PARTIAL|COMPLETE|BALANCED)\b/gi, '');
  s = s.replace(/\s*\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s;
}

function _displayDocNoErp(docNo) {
  if (!docNo) return '';
  if (docNo.indexOf('Bal.') === 0) {
    var rest = docNo.substring(4);
    var cleaned = rest.replace(/-\w+$/, '');
    return 'Bal.' + cleaned;
  }
  return String(docNo).replace(/-\w+$/, '').replace(/-\w+-\w+$/, '');
}

// ═══════════════════════════════════════════════════════════
// BUILD MRIF HTML (adapted from main system)
// ═══════════════════════════════════════════════════════════
function buildErpMrifHtml(docNo, info, items) {
  var requestor = _printEsc(info.Requestor || info.requestor || '');
  var department = _printEsc(info.Department || info.department || '');
  var dateRaw = info.Date || info.date || info['Date Prepared'] || '';
  var gemSo = _printEsc(info['GEM SO No.'] || info.gemSoNo || '');
  var joNo = _printEsc(info['JO No.'] || info.joNo || '');
  var client = _printEsc(info['Client Name'] || info.clientName || '');
  var project = _printEsc(info.Project || info.project || '');

  var isBal = docNo.indexOf('Bal.') === 0;
  var displayDocNo = _displayDocNoErp(docNo);
  var titleText = isBal ? 'MATERIALS REQUEST AND ISSUANCE FORM (BALANCE)' : 'MATERIALS REQUEST AND ISSUANCE FORM';

  var dateStr = dateRaw;
  try {
    var d = new Date(dateRaw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}
  dateStr = _printEsc(dateStr);

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var codeRaw = it.inventoryId || it.itemCode || it.code || '';
      var code = _printEsc(codeRaw);
      var desc = _printEsc(it.description || it.desc || '');
      var qty = it.expectedQty || it.qty || it.requestedQty || 0;
      var issued = it.actualQty || it.issuedQty || it.atlQty || 0;
      var issuedDisplay = (issued === 0 || issued === '') ? '' : issued;
      var unit = _printEsc(it.unit || 'PIECE');
      var remarks = _printEsc(_cleanRemarksForPrint(it.remarks || ''));

      itemsHtml += '<tr>' +
        '<td class="td-center">' + (i + 1) + '</td>' +
        '<td class="td-center">' + code + '</td>' +
        '<td class="td-center qr-cell"><img class="print-qr-sm" alt="" data-qr="' + encodeURIComponent(codeRaw) + '" data-qr-size="32"></td>' +
        '<td class="td-left">' + desc + '</td>' +
        '<td class="td-center">' + qty + '</td>' +
        '<td class="td-center">' + issuedDisplay + '</td>' +
        '<td class="td-center">' + unit + '</td>' +
        '<td class="td-center">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="8" style="padding:20px;color:#999;font-style:italic;">No items found</td></tr>';
  }

  var docQrData = _printQrData(docNo);

  return '<div class="mrif-print-sheet">' +
    '<div class="mrif-header">' +
      '<div class="mrif-logo"><img src="../gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrif-docno">' +
        '<div><span class="mrif-dn-label">MRIF No.:</span><span class="mrif-dn-box">' + _printEsc(displayDocNo) + '</span></div>' +
        '<div class="mrif-doc-qr"><img class="print-qr-lg" alt="MRIF QR" data-qr="' + encodeURIComponent(docQrData) + '" data-qr-size="62"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrif-title">' + titleText + '</div>' +
    '<table class="mrif-meta">' +
      '<tr><td class="meta-label">REQUESTOR:</td><td class="meta-value" colspan="2">' + requestor + '</td><td class="meta-label-right">GEM SO No.:</td><td class="meta-blue">' + gemSo + '</td><td class="meta-label-right">JO No.:</td><td class="meta-blue">' + joNo + '</td></tr>' +
      '<tr><td class="meta-label">DEPARTMENT/SECTION:</td><td class="meta-value" colspan="4">' + department + '</td><td class="meta-label-right">CLIENT NAME:</td><td class="meta-value">' + client + '</td></tr>' +
      '<tr><td class="meta-label">DATE:</td><td class="meta-blue" colspan="2">' + dateStr + '</td><td class="meta-label-right">PROJECT:</td><td class="meta-value" colspan="3">' + project + '</td></tr>' +
    '</table>' +
    '<table class="mrif-items">' +
      '<thead><tr>' +
        '<th style="width:5%">ITEM<br>NO.</th>' +
        '<th style="width:14%">ITEM<br>CODE</th>' +
        '<th style="width:7%">QR<br>IMG</th>' +
        '<th style="width:35%">ITEM DESCRIPTION</th>' +
        '<th style="width:9%">REQ.<br>QTY</th>' +
        '<th style="width:9%">ISSUED<br>QTY</th>' +
        '<th style="width:7%">UNIT</th>' +
        '<th style="width:14%">REMARKS</th>' +
      '</tr></thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrif-sigs">' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-name">ANGEL / JOMAR / RICHEL / ERWIN / MARCEL</div>' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">ISSUED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-name">&nbsp;</div>' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">CHECKED BY</div>' +
      '</div>' +
      '<div class="mrif-sig">' +
        '<div class="mrif-sig-name">&nbsp;</div>' +
        '<div class="mrif-sig-line"></div>' +
        '<div class="mrif-sig-label">RECEIVED BY/DATE</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ═══════════════════════════════════════════════════════════
// BUILD MRR HTML
// ═══════════════════════════════════════════════════════════
function buildErpMrrHtml(docNo, info, items) {
  var receivingSite = _printEsc(info['Receiving Site'] || info.receivingSite || 'GEMCOR CATMON');
  var vendor = _printEsc(info['Vendor/Client'] || info.vendor || '');
  var datePrepared = info['Date Prepared'] || info.datePrepared || '';
  var poNo = _printEsc(info['PO No.'] || info.poNo || '');
  var drNo = _printEsc(info['DR No.'] || info.drNo || '');
  var receivingDate = info['Receiving Date'] || info.receivingDate || '';
  var preparedBy = _printEsc(info['Prepared By'] || info.preparedBy || '');

  function fmtDate(val) {
    if (!val) return '';
    try {
      var d = new Date(val);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
        var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
      }
    } catch(e) {}
    return String(val);
  }

  var dateStr = _printEsc(fmtDate(datePrepared));
  var recDateStr = _printEsc(fmtDate(receivingDate));

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var idx = 0; idx < items.length; idx++) {
      var it = items[idx];
      var code = _printEsc(it.inventoryId || it.itemCode || '');
      var desc = _printEsc(it.description || '');
      var requestedQty = it.recQty || it.expectedQty || it.qty || 0;
      var receivedQty = it.atlQty || it.actualQty || it.issuedQty || 0;
      var receivedDisplay = (receivedQty === 0 || receivedQty === '') ? '' : receivedQty;
      var unit = _printEsc(it.unit || 'PIECE');
      var remarks = _printEsc(_cleanRemarksForPrint(it.remarks || ''));

      itemsHtml += '<tr>' +
        '<td class="td-center" style="width:5%">' + (idx + 1) + '</td>' +
        '<td class="td-center" style="width:16%">' + code + '</td>' +
        '<td class="td-left" style="width:35%">' + desc + '</td>' +
        '<td class="td-center" style="width:10%">' + requestedQty + '</td>' +
        '<td class="td-center" style="width:10%">' + receivedDisplay + '</td>' +
        '<td class="td-center" style="width:8%">' + unit + '</td>' +
        '<td class="td-center" style="width:16%">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="7" style="padding:20px;color:#999;font-style:italic;">No items found</td></tr>';
  }

  var docQrData = _printQrData(docNo);

  return '<div class="mrr-print-sheet">' +
    '<div class="mrr-header">' +
      '<div class="mrr-logo"><img src="../gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrr-docno">' +
        '<div><span class="mrr-dn-label">Receipt No.:</span><span class="mrr-dn-box">' + _printEsc(_displayDocNoErp(docNo)) + '</span></div>' +
        '<div class="mrr-doc-qr"><img class="print-qr-lg" alt="MRR QR" data-qr="' + encodeURIComponent(docQrData) + '" data-qr-size="62"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrr-title">MATERIALS RECEIVING REPORT</div>' +
    '<table class="mrr-meta-table">' +
      '<tr><td class="mrr-meta-label">RECEIVING SITE:</td><td class="mrr-meta-value" colspan="5">' + receivingSite + '</td><td class="mrr-meta-label-right">PO No. / SOF No.:</td><td class="mrr-meta-value-right">' + poNo + '</td></tr>' +
      '<tr><td class="mrr-meta-label">VENDOR:</td><td class="mrr-meta-value" colspan="5">' + vendor + '</td><td class="mrr-meta-label-right">DR No / SI No.:</td><td class="mrr-meta-value-right">' + drNo + '</td></tr>' +
      '<tr><td class="mrr-meta-label">DATE PREPARED:</td><td class="mrr-meta-value" colspan="2">' + dateStr + '</td><td class="mrr-meta-label-right">RECEIVING DATE:</td><td class="mrr-meta-value-right" colspan="4">' + recDateStr + '</td></tr>' +
    '</table>' +
    '<table class="mrr-items">' +
      '<thead><tr>' +
        '<th style="width:5%">ITEM<br>NO.</th>' +
        '<th style="width:16%">ITEM<br>CODE</th>' +
        '<th style="width:35%">ITEM DESCRIPTION</th>' +
        '<th style="width:10%">REQUESTED<br>QTY</th>' +
        '<th style="width:10%">RECEIVED<br>QTY</th>' +
        '<th style="width:8%">UNIT</th>' +
        '<th style="width:16%">REMARKS</th>' +
      '</tr></thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrr-checkboxes">' +
      '<div class="mrr-cb-section"><div class="mrr-cb-title">ISSUES IN SUPPLIER PERFORMANCE:</div>' +
        '<div class="mrr-cb-row">' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> PRODUCT/SERVICE</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> DELIVERY</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> CUSTOMER RELATIONS</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> SUPPORT FUNCTION</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> PRICE</span>' +
        '</div></div>' +
      '<div class="mrr-cb-section"><div class="mrr-cb-title">ACTION TAKEN IF REJECT / PARTIAL ACCEPTANCE:</div>' +
        '<div class="mrr-cb-row">' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> RETURN TO SUPPLIER</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> ITEMS REPLACED BY SUPPLIER</span>' +
          '<span class="mrr-cb-item"><span class="mrr-cb-circle">( )</span> OTHERS</span>' +
        '</div></div>' +
    '</div>' +
    '<div class="mrr-sigs">' +
      '<div class="mrr-sig"><div class="mrr-sig-name">' + preparedBy + '</div><div class="mrr-sig-line"></div><div class="mrr-sig-label">PREPARED BY</div></div>' +
      '<div class="mrr-sig"><div class="mrr-sig-name">&nbsp;</div><div class="mrr-sig-line"></div><div class="mrr-sig-label">CHECKED BY</div></div>' +
      '<div class="mrr-sig"><div class="mrr-sig-name">&nbsp;</div><div class="mrr-sig-line"></div><div class="mrr-sig-label">RECEIVED BY / DATE</div></div>' +
    '</div>' +
  '</div>';
}

// ═══════════════════════════════════════════════════════════
// BUILD MRS HTML
// ═══════════════════════════════════════════════════════════
function buildErpMrsHtml(docNo, info, items) {
  var requestor = _printEsc(info.Requestor || info.requestor || '');
  var department = _printEsc(info.Department || info.department || '');
  var dateRaw = info.Date || info.date || info['Date Prepared'] || '';
  var gemSo = _printEsc(info['GEM SO No.'] || info.gemSoNo || '');
  var joNo = _printEsc(info['JO No.'] || info.joNo || '');
  var client = _printEsc(info['Client Name'] || info.clientName || '');
  var project = _printEsc(info.Project || info.project || '');

  var dateStr = dateRaw;
  try {
    var d = new Date(dateRaw);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
  } catch(e) {}
  dateStr = _printEsc(dateStr);

  var itemsHtml = '';
  if (items && items.length > 0) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var codeRaw = it.inventoryId || it.itemCode || it.code || '';
      var code = _printEsc(codeRaw);
      var desc = _printEsc(it.description || '');
      var qtyReturned = it.expectedQty || it.qty || it.requestedQty || 0;
      var actualReturned = it.actualQty || it.issuedQty || it.atlQty || 0;
      var actualDisplay = (actualReturned === 0 || actualReturned === '') ? '' : actualReturned;
      var unit = _printEsc(it.unit || 'PIECE');
      var remarks = _printEsc(_cleanRemarksForPrint(it.remarks || ''));

      itemsHtml += '<tr>' +
        '<td class="td-center">' + (i + 1) + '</td>' +
        '<td class="td-center">' + code + '</td>' +
        '<td class="td-center qr-cell"><img class="print-qr-sm" alt="" data-qr="' + encodeURIComponent(codeRaw) + '" data-qr-size="32"></td>' +
        '<td class="td-left">' + desc + '</td>' +
        '<td class="td-center">' + qtyReturned + '</td>' +
        '<td class="td-center">' + actualDisplay + '</td>' +
        '<td class="td-center">' + unit + '</td>' +
        '<td class="td-center">' + remarks + '</td>' +
        '</tr>';
    }
  } else {
    itemsHtml += '<tr><td class="td-center" colspan="8" style="padding:20px;color:#999;font-style:italic;">No items found</td></tr>';
  }

  var docQrData = _printQrData(docNo);

  return '<div class="mrif-print-sheet">' +
    '<div class="mrif-header">' +
      '<div class="mrif-logo"><img src="../gemcor-logo.png" alt="GEMCOR"></div>' +
      '<div class="mrif-docno">' +
        '<div><span class="mrif-dn-label">MRS No.:</span><span class="mrif-dn-box">' + _printEsc(_displayDocNoErp(docNo)) + '</span></div>' +
        '<div class="mrif-doc-qr"><img class="print-qr-lg" alt="MRS QR" data-qr="' + encodeURIComponent(docQrData) + '" data-qr-size="62"></div>' +
      '</div>' +
    '</div>' +
    '<div class="mrif-title">MATERIALS RETURN SLIP</div>' +
    '<table class="mrif-meta">' +
      '<tr><td class="meta-label">REQUESTOR:</td><td class="meta-value" colspan="2">' + requestor + '</td><td class="meta-label-right">GEM SO No.:</td><td class="meta-blue">' + gemSo + '</td><td class="meta-label-right">JO No.:</td><td class="meta-blue">' + joNo + '</td></tr>' +
      '<tr><td class="meta-label">DEPARTMENT/SECTION:</td><td class="meta-value" colspan="4">' + department + '</td><td class="meta-label-right">CLIENT NAME:</td><td class="meta-value">' + client + '</td></tr>' +
      '<tr><td class="meta-label">DATE:</td><td class="meta-blue" colspan="2">' + dateStr + '</td><td class="meta-label-right">PROJECT:</td><td class="meta-value" colspan="3">' + project + '</td></tr>' +
    '</table>' +
    '<table class="mrif-items">' +
      '<thead><tr>' +
        '<th style="width:5%">ITEM<br>NO.</th>' +
        '<th style="width:14%">ITEM<br>CODE</th>' +
        '<th style="width:7%">QR<br>IMG</th>' +
        '<th style="width:35%">ITEM DESCRIPTION</th>' +
        '<th style="width:9%">QTY<br>RETURNED</th>' +
        '<th style="width:9%">ATL QTY<br>(Actual)</th>' +
        '<th style="width:7%">UNIT</th>' +
        '<th style="width:14%">REMARKS</th>' +
      '</tr></thead>' +
      '<tbody>' + itemsHtml + '</tbody>' +
    '</table>' +
    '<div class="mrif-sigs">' +
      '<div class="mrif-sig"><div class="mrif-sig-name">&nbsp;</div><div class="mrif-sig-line"></div><div class="mrif-sig-label">ISSUED BY</div></div>' +
      '<div class="mrif-sig"><div class="mrif-sig-name">&nbsp;</div><div class="mrif-sig-line"></div><div class="mrif-sig-label">CHECKED BY</div></div>' +
      '<div class="mrif-sig"><div class="mrif-sig-name">&nbsp;</div><div class="mrif-sig-line"></div><div class="mrif-sig-label">RECEIVED BY/DATE</div></div>' +
    '</div>' +
  '</div>';
}

// ═══════════════════════════════════════════════════════════
// MAIN: Open print preview
// ═══════════════════════════════════════════════════════════
async function erpOpenPrintPreview(docNo, docType) {
  if (!docNo) return;
  docType = String(docType || '').toUpperCase();
  
  // Auto-detect type from docNo
  if (!docType) {
    var upper = String(docNo).toUpperCase();
    if (upper.indexOf('MRIF') !== -1 || upper.indexOf('BAL.MRIF') !== -1) docType = 'MRIF';
    else if (upper.indexOf('MRR') !== -1 || upper.indexOf('BAL.MRR') !== -1) docType = 'MRR';
    else if (upper.indexOf('MRS') !== -1 || upper.indexOf('BAL.MRS') !== -1) docType = 'MRS';
    else docType = 'MRIF';
  }
  
  erpPrintShowToast('Loading document ' + docNo + '...');
  
  try {
    // Fetch doc + items from Supabase
    var result = await erpFetchDocWithItems(docNo, docType);
    if (!result.success) {
      erpPrintShowToast('Failed to load: ' + (result.error || 'Unknown error'));
      return;
    }
    
    var info = result.info || {};
    var items = result.items || [];
    
    // Build HTML based on type
    var html;
    if (docType === 'MRIF') html = buildErpMrifHtml(docNo, info, items);
    else if (docType === 'MRR') html = buildErpMrrHtml(docNo, info, items);
    else if (docType === 'MRS') html = buildErpMrsHtml(docNo, info, items);
    else { erpPrintShowToast('Unknown doc type: ' + docType); return; }
    
    // Embed QR codes
    html = await _printEmbedQrInHtml(html);
    
    // Open print modal
    erpShowPrintModal(html);
    
  } catch(err) {
    console.error('[erpOpenPrintPreview]', err);
    erpPrintShowToast('Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FETCH DOC + ITEMS (from Supabase)
// ═══════════════════════════════════════════════════════════
async function erpFetchDocWithItems(docNo, docType) {
  try {
    // Fetch document metadata
    var docs = await erpFetch('erp_documents',
      'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    
    if (!docs || docs.length === 0) {
      return { success: false, error: 'Document not found: ' + docNo };
    }
    
    var doc = docs[0];
    
    // Fetch doc items
    var items = await erpFetch('erp_doc_items',
      'doc_no=eq.' + encodeURIComponent(docNo) + '&order=line_no.asc');
    
    // Build info object (same structure as old GAS format)
    var info = {
      'Requestor': doc.requestor || '',
      'Department': doc.department || '',
      'JO No.': doc.jo_no || '',
      'GEM SO No.': doc.gem_so_no || '',
      'Client Name': doc.client_name || '',
      'Project': doc.project || '',
      'Date': doc.date_prepared || '',
      'PO No.': doc.po_no || '',
      'Vendor/Client': doc.vendor || '',
      'DR No.': doc.dr_no || '',
      'Receiving Site': doc.receiving_site || '',
      'Date Prepared': doc.date_prepared || '',
      'Receiving Date': doc.receiving_date || '',
      'Prepared By': doc.prepared_by || ''
    };
    
    // Build items array (same structure)
    var mappedItems = (items || []).map(function(it) {
      return {
        inventoryId: it.item_code,
        itemCode: it.item_code,
        code: it.item_code,
        description: it.description || '',
        expectedQty: Number(it.requested_qty || 0),
        recQty: Number(it.requested_qty || 0),
        requestedQty: Number(it.requested_qty || 0),
        qty: Number(it.requested_qty || 0),
        actualQty: Number(it.issued_qty || it.received_qty || it.returned_qty || 0),
        atlQty: Number(it.issued_qty || it.received_qty || it.returned_qty || 0),
        issuedQty: Number(it.issued_qty || it.received_qty || it.returned_qty || 0),
        unit: it.unit || 'PIECE',
        remarks: it.remarks || 'PENDING'
      };
    });
    
    return { success: true, info: info, items: mappedItems };
  } catch(err) {
    console.error('[erpFetchDocWithItems]', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// PRINT MODAL
// ═══════════════════════════════════════════════════════════
function erpShowPrintModal(html) {
  // Remove existing modal
  var existing = document.getElementById('erpPrintModal');
  if (existing) existing.remove();
  
  var modalHtml = 
    '<div class="modal fade" id="erpPrintModal" tabindex="-1" data-bs-backdrop="static">' +
      '<div class="modal-dialog modal-lg modal-dialog-scrollable" style="max-width:900px;">' +
        '<div class="modal-content">' +
          '<div class="modal-header erp-modal-header">' +
            '<h5 class="modal-title"><i class="bi bi-printer me-2"></i>Print Preview</h5>' +
            '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>' +
          '</div>' +
          '<div class="modal-body p-0" style="background:#e5e5e5;">' +
            '<div id="erpPrintContent" style="padding:20px;">' + html + '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>' +
            '<button type="button" class="btn btn-primary" onclick="erpPrintNow()">' +
              '<i class="bi bi-printer me-2"></i>Print / Save PDF' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  
  var wrapper = document.createElement('div');
  wrapper.innerHTML = modalHtml;
  document.body.appendChild(wrapper.firstChild);
  
  var modalEl = document.getElementById('erpPrintModal');
  var modal = new bootstrap.Modal(modalEl);
  modal.show();
  
  // Clean up on hide
  modalEl.addEventListener('hidden.bs.modal', function() {
    modalEl.remove();
  });
}

function erpPrintNow() {
  var content = document.getElementById('erpPrintContent');
  if (!content) return;
  
  var html = content.innerHTML;
  var printStyles = 
    '@page { size: letter portrait; margin: 0.25in; }' +
    '* { box-sizing: border-box; }' +
    'body { margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 9pt; color: #000; }' +
    '.mrif-print-sheet, .mrr-print-sheet { width: 100%; max-width: 8in; margin: 0 auto; background: #fff; padding: 0.15in; }' +
    '.mrif-header, .mrr-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }' +
    '.mrif-logo img, .mrr-logo img { height: 42px; width: auto; }' +
    '.mrif-docno, .mrr-docno { text-align: right; }' +
    '.mrif-dn-label, .mrr-dn-label { font-weight: bold; font-size: 9pt; margin-right: 4px; }' +
    '.mrif-dn-box, .mrr-dn-box { display: inline-block; background: #f4cccc; border: 1px solid #e6b8b8; padding: 1px 8px; font-weight: bold; font-size: 10pt; }' +
    '.print-qr-sm { width: 32px; height: 32px; display: block; margin: 0 auto; }' +
    '.print-qr-lg { width: 62px; height: 62px; display: block; margin: 0 auto; }' +
    '.mrif-title, .mrr-title { text-align: center; font-size: 12pt; font-weight: bold; letter-spacing: 4px; margin: 6px 0 10px 0; text-transform: uppercase; }' +
    '.mrif-meta, .mrr-meta-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 8pt; }' +
    '.mrif-meta td, .mrr-meta-table td { padding: 1px 4px; vertical-align: top; }' +
    '.meta-label, .meta-label-right, .mrr-meta-label, .mrr-meta-label-right { font-weight: bold; font-size: 8pt; }' +
    '.meta-value, .meta-value-right, .mrr-meta-value, .mrr-meta-value-right { border-bottom: 1px solid #000; }' +
    '.meta-blue { background: #cfe2f3; padding: 1px 5px; font-weight: bold; }' +
    '.mrif-items, .mrr-items { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 8pt; }' +
    '.mrif-items th, .mrif-items td, .mrr-items th, .mrr-items td { border: 1px solid #000; padding: 1px 3px; }' +
    '.mrif-items th, .mrr-items th { background: #fff; font-weight: bold; text-align: center; font-size: 7.5pt; }' +
    '.td-center { text-align: center; }' +
    '.td-left { text-align: left; }' +
    '.qr-cell { padding: 0 !important; line-height: 0; }' +
    '.mrif-sigs, .mrr-sigs { display: flex; justify-content: center; gap: 40px; margin-top: 16px; text-align: center; }' +
    '.mrif-sig, .mrr-sig { width: 26%; }' +
    '.mrif-sig-line, .mrr-sig-line { border-bottom: 1px solid #000; height: 22px; margin-bottom: 2px; }' +
    '.mrif-sig-label, .mrr-sig-label { font-size: 8pt; font-weight: bold; text-transform: uppercase; }' +
    '.mrif-sig-name, .mrr-sig-name { font-size: 8pt; font-weight: 600; margin-bottom: 4px; }';
  
  var fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title><style>' + printStyles + '</style></head><body>' + html + '</body></html>';
  
  var iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
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
    }
    setTimeout(function() {
      if (iframe.parentNode) document.body.removeChild(iframe);
    }, 3000);
  }, 400);
}

function erpPrintShowToast(msg) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Print]', msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2500 }).show();
}

console.log('✅ prints-erp.js loaded');
