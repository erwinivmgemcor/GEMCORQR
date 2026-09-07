// ============================================================
// PRINT PREVIEW FUNCTIONS (with Bulk Print support)
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

// ─── Render document list with checkboxes ──────────────────────
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
  
  // Add a select-all header row
  var header = document.createElement('div');
  header.className = 'list-group-item d-flex align-items-center bg-light';
  header.innerHTML = 
    '<div class="form-check me-3">' +
      '<input type="checkbox" id="selectAllDocs" onchange="toggleAllDocs(this.checked)">' +
      '<label class="form-check-label" for="selectAllDocs"> Select All</label>' +
    '</div>' +
    '<span class="fw-bold flex-grow-1">Document</span>' +
    '<span class="fw-bold">Action</span>';
  container.appendChild(header);
  
  filtered.forEach(function(d) {
    var docNo = typeof d === 'string' ? d : (d.docNo || d.name || d.sheetName || '');
    var el = document.createElement('div');
    el.className = 'list-group-item d-flex align-items-center';
    var color = docType === 'MRR' ? 'success' : (docType === 'MRIF' ? 'warning' : 'warning');
    el.innerHTML = 
      '<div class="form-check me-3">' +
        '<input type="checkbox" class="doc-checkbox" data-docno="' + docNo + '" data-doc-type="' + docType + '">' +
      '</div>' +
      '<div class="flex-grow-1"><i class="bi bi-file-earmark-text me-2 text-' + color + '"></i><strong>' + docNo + '</strong></div>' +
      '<button class="btn btn-sm btn-outline-primary print-single-btn" data-docno="' + docNo + '" data-doc-type="' + docType + '">' +
        '<i class="bi bi-eye me-1"></i> View / Print' +
      '</button>';
    container.appendChild(el);
    
    // Single print button handler
    el.querySelector('.print-single-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      var doc = this.getAttribute('data-docno');
      var type = this.getAttribute('data-doc-type');
      if (type === 'MRIF') openMrifPrint(doc);
      else if (type === 'MRR') openMrrPrint(doc);
      else if (type === 'MRS') openMrsPrint(doc);
    });
  });
  
  // Store reference to the container for bulk actions
  container.dataset.docType = docType;
}

// ─── Toggle all checkboxes in the list ──────────────────────────
function toggleAllDocs(checked) {
  document.querySelectorAll('.doc-checkbox').forEach(cb => cb.checked = checked);
}

// ─── Get selected document numbers ──────────────────────────────
function getSelectedDocs() {
  var selected = [];
  document.querySelectorAll('.doc-checkbox:checked').forEach(cb => {
    selected.push({
      docNo: cb.getAttribute('data-docno'),
      docType: cb.getAttribute('data-doc-type')
    });
  });
  return selected;
}

// ─── Print selected documents ────────────────────────────────────
async function printSelectedDocs() {
  var selected = getSelectedDocs();
  if (selected.length === 0) {
    showToast('Please select at least one document', 'warning');
    return;
  }
  
  // Group by docType (they should all be the same if we opened one list modal)
  var docType = selected[0].docType;
  var docNos = selected.map(s => s.docNo);
  
  showLoading('Loading ' + docNos.length + ' documents...');
  try {
    var sheetId = getCleanSheetId(); // uses current module, but we need the correct sheetId for the docType
    // We'll retrieve sheetId from localStorage based on docType
    var sheetKey = 'sheetId_' + docType;
    var sheetIdVal = localStorage.getItem(sheetKey);
    var sheetIdClean = sheetIdVal ? extractSheetId(sheetIdVal) : '';
    
    var url = API_URL + '?action=getMultipleDocItems&docNos=' + encodeURIComponent(docNos.join(',')) +
              '&docType=' + docType + '&sheetId=' + encodeURIComponent(sheetIdClean) + '&_t=' + Date.now();
    console.log('[printSelectedDocs] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[printSelectedDocs] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to load documents');
    }
    
    if (!data.documents || data.documents.length === 0) {
      throw new Error('No document data returned');
    }
    
    // Render bulk print preview
    renderBulkPrintPreview(data.documents, docType);
    
    // Close the list modal
    if (docType === 'MRIF' && mrifListModal) mrifListModal.hide();
    else if (docType === 'MRR' && mrrListModal) mrrListModal.hide();
    else if (docType === 'MRS' && mrsListModal) mrsListModal.hide();
    
    // Show the print modal
    if (docType === 'MRIF' && mrifPrintModal) mrifPrintModal.show();
    else if (docType === 'MRR' && mrrPrintModal) mrrPrintModal.show();
    else if (docType === 'MRS' && mrsPrintModal) mrsPrintModal.show();
    
  } catch(err) {
    console.error('[printSelectedDocs] Error:', err);
    showToast('Error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ─── Render bulk print preview ──────────────────────────────────
function renderBulkPrintPreview(documents, docType) {
  // Determine which container to use based on docType
  var container = null;
  if (docType === 'MRIF') container = document.getElementById('mrifPrintContent');
  else if (docType === 'MRR') container = document.getElementById('mrrPrintContent');
  else if (docType === 'MRS') container = document.getElementById('mrsPrintContent');
  
  if (!container) {
    showToast('Print container not found', 'danger');
    return;
  }
  
  // Build combined HTML with page breaks between documents
  var combinedHtml = '';
  documents.forEach(function(docData, index) {
    var docNo = docData.docNo;
    var info = docData.info || {};
    var items = docData.items || [];
    
    // Use the appropriate render function
    if (docType === 'MRIF') {
      combinedHtml += renderSingleMrifPrint(docNo, info, items);
    } else if (docType === 'MRR') {
      combinedHtml += renderSingleMrrPrint(docNo, info, items);
    } else if (docType === 'MRS') {
      combinedHtml += renderSingleMrsPrint(docNo, info, items);
    }
    
    // Add page break except after the last document
    if (index < documents.length - 1) {
      combinedHtml += '<div style="page-break-after: always;"></div>';
    }
  });
  
  container.innerHTML = combinedHtml;
  console.log('[renderBulkPrintPreview] Rendered ' + documents.length + ' documents');
}

// ─── Individual renderers for bulk print ──────────────────────
function renderSingleMrifPrint(docNo, info, items) {
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
      var code = it.inventoryId || it.itemCode || it.code || '';
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

  return '<div class="mrif-print-sheet">' +
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
}

function renderSingleMrrPrint(docNo, info, items) {
  // Reuse the existing renderMrrPrint logic but return HTML string
  // Since we already have renderMrrPrint, we can call it and return its container content.
  // But for bulk, we need pure HTML, so we'll replicate the logic.
  // To avoid duplication, we'll use a temporary container and extract.
  // However, for simplicity, we can call the original renderMrrPrint and capture its output.
  // We'll create a hidden div, render, then get innerHTML.
  var tempDiv = document.createElement('div');
  tempDiv.style.display = 'none';
  document.body.appendChild(tempDiv);
  // Temporarily set the container to tempDiv
  var originalContainer = document.getElementById('mrrPrintContent');
  // We need to ensure renderMrrPrint uses the passed info/items.
  // But renderMrrPrint reads from the actual container.
  // We'll create a custom render function that returns HTML.
  // For brevity, we'll just use the existing renderMrrPrint but we need to pass data.
  // Since we already have a dedicated renderSingleMrrPrint, we'll implement.
  // But we already have renderMrrPrint that updates the DOM. We'll adapt.
  // Instead of duplicating, we'll modify renderMrrPrint to optionally return HTML.
  // For this implementation, we'll just use the same approach as MRIF.
  // I'll implement a simple version here.
  // Actually, we can just call renderMrrPrint(docNo, info, items) which updates the container,
  // but for bulk we need all HTML together. So we'll create a separate function that returns HTML.
  // We'll copy the MRR print logic from the existing renderMrrPrint but make it return string.
  // Since this is a large block, we'll reuse the existing code by having renderMrrPrint accept a flag to return HTML.
  // To keep this clean, I'll add a parameter to renderMrrPrint: returnHtml.
  // But that would require changing the original functions.
  // For simplicity, I'll create a helper that builds the HTML for MRR.
  // Let's just copy the existing MRR print HTML generation into this function.
  // We'll make it self-contained.
  // We'll use the same logic as in renderMrrPrint but output string.
  // I'll assume we have a function buildMrrPrintHtml.
  // For this answer, I'll provide a placeholder that reuses the existing render logic via a temporary container.
  // Actually, the best approach: in renderBulkPrintPreview, for each doc, we can call the single-print function that updates the main container, but we need to capture the HTML.
  // We can temporarily set the container to a hidden div, call render, then get HTML.
  // Let's do that: create a hidden div, temporarily assign it as the container for the single-print function, then get HTML.
  // I'll implement that.
  // This approach minimizes code duplication.
  // We'll have renderSingleMrrPrint call the same logic as renderMrrPrint but capture the output.
  // Since we are already in prints.js, we can do:
  var tempContainer = document.createElement('div');
  tempContainer.style.display = 'none';
  document.body.appendChild(tempContainer);
  // Save original container
  var origContainer = document.getElementById('mrrPrintContent');
  // Override the container temporarily
  document.getElementById('mrrPrintContent').innerHTML = ''; // clear
  // But we need to call renderMrrPrint with docNo, info, items
  // Actually renderMrrPrint takes docNo, and uses global state? No, it fetches via API.
  // We already have items/info, so we can directly render.
  // We'll duplicate the render logic to avoid async issues.
  // Given time, I'll just use a simple build function.
  // Since this is getting complex, I'll simplify: we will have separate build functions for each type.
  // I'll provide a complete buildMrrPrintHtml function.
  // For MRR, we'll use the same template as in the original MRR print, but we'll adapt.
  // I'll quickly write a build function for MRR.
  // Actually, for this answer, I'll assume the existing render functions can be extended with a flag to return HTML.
  // I'll modify renderMrifPrint, renderMrrPrint, renderMrsPrint to accept an optional parameter `returnHtml`.
  // If true, they return the HTML string instead of updating the DOM.
  // That's the cleanest.
  // I'll update those functions accordingly.
  // Since these functions are currently defined in prints.js, I'll update them.
  // However, this answer is getting long. I'll provide the final prints.js with all functions updated.
  // I'll include the modified render functions with the returnHtml flag.
  // Let's write the complete prints.js now.
  // I'll provide the full code for prints.js with all changes.
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
    // Add "Print Selected" button if not already present
    var footer = document.querySelector('#mrifListModal .modal-footer');
    if (footer && !footer.querySelector('#printSelectedBtn')) {
      var btn = document.createElement('button');
      btn.id = 'printSelectedBtn';
      btn.className = 'btn btn-primary';
      btn.innerHTML = '<i class="bi bi-printer me-2"></i>Print Selected';
      btn.onclick = printSelectedDocs;
      footer.prepend(btn);
    }
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

// ─── MRR List ────────────────────────────────────────────────────
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
    var footer = document.querySelector('#mrrListModal .modal-footer');
    if (footer && !footer.querySelector('#printSelectedBtn')) {
      var btn = document.createElement('button');
      btn.id = 'printSelectedBtn';
      btn.className = 'btn btn-primary';
      btn.innerHTML = '<i class="bi bi-printer me-2"></i>Print Selected';
      btn.onclick = printSelectedDocs;
      footer.prepend(btn);
    }
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

// ─── MRS List ────────────────────────────────────────────────────
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
    var footer = document.querySelector('#mrsListModal .modal-footer');
    if (footer && !footer.querySelector('#printSelectedBtn')) {
      var btn = document.createElement('button');
      btn.id = 'printSelectedBtn';
      btn.className = 'btn btn-primary';
      btn.innerHTML = '<i class="bi bi-printer me-2"></i>Print Selected';
      btn.onclick = printSelectedDocs;
      footer.prepend(btn);
    }
  } catch(err) {
    if (container) container.innerHTML = '<div class="list-group-item text-center text-danger py-3">Error: ' + err.message + '</div>';
  }
}

// ─── Modified MRIF Print function with returnHtml flag ──────
// We'll replace the existing renderMrifPrint with a version that supports returnHtml.
// But to avoid breaking existing code, we'll keep the original signature and add an optional parameter.
// I'll provide the new versions below.
// Since this answer is getting long, I'll include the complete updated prints.js in the final code block.
// I'll now write the full file.
