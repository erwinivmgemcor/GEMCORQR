// ============================================================
// NEW REQUEST FUNCTIONS (with Item Scanner & Remarks)
// ============================================================

function openNewRequest() {
  if (state.isLoading) return;
  resetWizard();
  loadRequestInventory();
  loadRequestorList();
  newRequestModal.show();
}

function resetWizard() {
  document.getElementById('reqDocType').value = '';
  document.getElementById('reqJoNo').value = '';
  document.getElementById('reqRequestor').value = '';
  document.getElementById('reqDepartment').value = '';
  document.getElementById('reqGemSoNo').value = '';
  document.getElementById('reqClientName').value = '';
  document.getElementById('reqProject').value = '';

  document.querySelectorAll('.doc-type-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('btnStep1Next').disabled = true;

  document.getElementById('step2JoNo').value = '';
  document.getElementById('joNoStatus').innerHTML = '';

  document.getElementById('step3Requestor').value = '';
  document.getElementById('step3Department').value = '';
  document.getElementById('btnStep3Next').disabled = true;

  document.getElementById('step5ItemsContainer').innerHTML = '';
  addStep5ItemRow();
  document.getElementById('btnStep5Next').disabled = true;

  closeWizardScanner();

  goToStep(1);
}

function goToStep(step) {
  closeWizardScanner();

  document.querySelectorAll('.wizard-step').forEach(function(el) {
    var s = parseInt(el.getAttribute('data-step'));
    el.classList.remove('active', 'completed');
    if (s === step) {
      el.classList.add('active');
    } else if (s < step) {
      el.classList.add('completed');
    }
  });

  document.querySelectorAll('.wizard-panel').forEach(function(el) {
    el.classList.remove('active');
  });
  var panel = document.getElementById('step' + step);
  if (panel) panel.classList.add('active');

  if (step === 4) {
    populateReviewData();
  }
  if (step === 6) {
    populateFinalReview();
  }
}

function selectDocType(type) {
  document.getElementById('reqDocType').value = type;
  document.querySelectorAll('.doc-type-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('docType' + type).classList.add('selected');
  document.getElementById('btnStep1Next').disabled = false;
}

function onJoNoInput() {
  var val = document.getElementById('step2JoNo').value.trim();
  var status = document.getElementById('joNoStatus');
  if (val.length > 0) {
    status.innerHTML = '<span class="text-muted"><i class="bi bi-info-circle"></i> Click <strong>Next</strong> to look up SOF data</span>';
  } else {
    status.innerHTML = '';
  }
}

async function doStep2Next() {
  var joNo = document.getElementById('step2JoNo').value.trim();
  if (!joNo) {
    document.getElementById('joNoStatus').innerHTML = '<span class="text-danger"><i class="bi bi-exclamation-circle"></i> Please enter a JO No.</span>';
    return;
  }

  document.getElementById('joNoStatus').innerHTML = '<span class="text-primary"><i class="bi bi-arrow-repeat spin"></i> Looking up SOF data...</span>';

  document.getElementById('reqJoNo').value = joNo;

  await lookupSofDataWizard();

  goToStep(3);
}

async function lookupSofDataWizard() {
  var joNo = document.getElementById('reqJoNo').value.trim();
  if (!joNo) return;

  showLoading('Looking up JO No....');
  try {
    var url = API_URL + '?action=getSofData&joNo=' + encodeURIComponent(joNo) + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { data = {}; }

    if (data.success) {
      document.getElementById('reqGemSoNo').value = data.gemSoNo || '';
      document.getElementById('reqClientName').value = data.clientName || '';
      document.getElementById('reqProject').value = data.project || '';
      document.getElementById('joNoStatus').innerHTML = '<span class="text-success"><i class="bi bi-check-circle"></i> JO No. found! SO data auto-filled.</span>';
      showToast('JO No. found! Auto-filled SO data.', 'success');
    } else {
      document.getElementById('reqGemSoNo').value = '';
      document.getElementById('reqClientName').value = '';
      document.getElementById('reqProject').value = '';
      document.getElementById('joNoStatus').innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> JO No. not found. You can still proceed.</span>';
      showToast('JO No. not found in SOF Monitoring. You can still submit.', 'warning');
    }
  } catch(err) {
    document.getElementById('joNoStatus').innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> Lookup failed.</span>';
    showToast('SOF lookup failed: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

function onStep3RequestorChange() {
  var sel = document.getElementById('step3Requestor');
  var selected = sel.options[sel.selectedIndex];
  var name = sel.value;
  var dept = selected ? selected.dataset.department : '';

  document.getElementById('reqRequestor').value = name;
  document.getElementById('reqDepartment').value = dept || '';
  document.getElementById('step3Department').value = dept || '';

  document.getElementById('btnStep3Next').disabled = !name;
}

function populateReviewData() {
  var docType = document.getElementById('reqDocType').value;
  var joNo = document.getElementById('reqJoNo').value;
  var requestor = document.getElementById('reqRequestor').value;
  var dept = document.getElementById('reqDepartment').value;
  var gemSo = document.getElementById('reqGemSoNo').value;
  var client = document.getElementById('reqClientName').value;
  var project = document.getElementById('reqProject').value;

  document.getElementById('reviewDocType').textContent = docType || '-';
  document.getElementById('reviewJoNo').textContent = joNo || '-';
  document.getElementById('reviewGemSoNo').textContent = gemSo || '-';
  document.getElementById('reviewClientName').textContent = client || '-';
  document.getElementById('reviewProject').textContent = project || '-';
  document.getElementById('reviewRequestor').textContent = requestor || '-';
  document.getElementById('reviewDepartment').textContent = dept || '-';
}

// ─── Item row with scanner button and remarks ──────────────────
function addStep5ItemRow() {
  var container = document.getElementById('step5ItemsContainer');
  var idx = container.children.length;
  var div = document.createElement('div');
  div.className = 'step5-item-row';
  div.innerHTML =
    '<div class="row g-2 align-items-end">' +
      '<div class="col-8 col-md-4">' +
        '<label class="form-label small">Item</label>' +
        '<div class="input-group">' +
          '<input type="text" class="form-control req-item-search" placeholder="Type to search or scan..." oninput="filterStep5Items(this,' + idx + ')" onfocus="filterStep5Items(this,' + idx + ')">' +
          '<button class="btn btn-outline-secondary scan-wizard-btn" type="button" onclick="openWizardScanner(' + idx + ')" title="Scan QR Code">' +
            '<i class="bi bi-qr-code-scan"></i>' +
          '</button>' +
        '</div>' +
        '<div class="list-group position-absolute z-3 d-none req-dropdown" style="max-height:150px;overflow-y:auto;width:90%;" id="step5Dropdown' + idx + '"></div>' +
        '<input type="hidden" class="req-item-code" id="step5Code' + idx + '">' +
        '<input type="hidden" class="req-item-desc" id="step5Desc' + idx + '">' +
      '</div>' +
      '<div class="col-2 col-md-2">' +
        '<label class="form-label small">Qty</label>' +
        '<input type="number" class="form-control req-qty" min="1" value="1">' +
      '</div>' +
      '<div class="col-2 col-md-2">' +
        '<label class="form-label small">Unit</label>' +
        '<select class="form-select req-unit">' +
          buildUnitOptions('PIECE') +
        '</select>' +
      '</div>' +
      '<div class="col-3 col-md-3">' +
        '<label class="form-label small">Remarks</label>' +
        '<input type="text" class="form-control req-remarks" placeholder="Optional note..." maxlength="200">' +
      '</div>' +
      '<div class="col-1 col-md-1">' +
        '<button class="btn btn-outline-danger btn-sm w-100" onclick="this.closest(\'.step5-item-row\').remove(); checkStep5Items();">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  container.appendChild(div);
  checkStep5Items();
}

function filterStep5Items(input, idx) {
  var term = input.value.toLowerCase();
  var dropdown = document.getElementById('step5Dropdown' + idx);
  dropdown.innerHTML = '';
  if (!term) { dropdown.classList.add('d-none'); return; }

  var matches = state.requestInventoryList.filter(function(it) {
    var code = (it.code || it.inventoryId || '').toLowerCase();
    var desc = (it.description || '').toLowerCase();
    return code.includes(term) || desc.includes(term);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted">No matches</div>';
  } else {
    matches.forEach(function(it) {
      var code = it.code || it.inventoryId || '';
      var desc = it.description || '';
      var unit = it.unit || 'PIECE';
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.innerHTML = '<div class="fw-bold small">' + code + '</div><div class="small text-muted">' + desc + '</div>';
      el.onclick = function() {
        input.value = code + ' - ' + desc;
        document.getElementById('step5Code' + idx).value = code;
        document.getElementById('step5Desc' + idx).value = desc;
        var unitSelect = input.closest('.step5-item-row').querySelector('.req-unit');
        if (unitSelect && unitSelect.querySelector('option[value="' + unit + '"]')) {
          unitSelect.value = unit;
        }
        dropdown.classList.add('d-none');
        checkStep5Items();
      };
      dropdown.appendChild(el);
    });
  }
  dropdown.classList.remove('d-none');
}

function checkStep5Items() {
  var hasItems = false;
  document.querySelectorAll('#step5ItemsContainer .step5-item-row').forEach(function(row) {
    var code = row.querySelector('.req-item-code').value;
    if (code) hasItems = true;
  });
  document.getElementById('btnStep5Next').disabled = !hasItems;
}

function populateFinalReview() {
  document.getElementById('finalDocType').textContent = document.getElementById('reqDocType').value || '-';
  document.getElementById('finalJoNo').textContent = document.getElementById('reqJoNo').value || '-';
  document.getElementById('finalRequestor').textContent = document.getElementById('reqRequestor').value || '-';
  document.getElementById('finalDepartment').textContent = document.getElementById('reqDepartment').value || '-';
  document.getElementById('finalGemSoNo').textContent = document.getElementById('reqGemSoNo').value || '-';
  document.getElementById('finalClientName').textContent = document.getElementById('reqClientName').value || '-';
  document.getElementById('finalProject').textContent = document.getElementById('reqProject').value || '-';

  var tbody = document.getElementById('finalItemsTable');
  tbody.innerHTML = '';
  var rows = document.querySelectorAll('#step5ItemsContainer .step5-item-row');
  var count = 0;
  rows.forEach(function(row, i) {
    var code = row.querySelector('.req-item-code').value;
    var desc = row.querySelector('.req-item-desc').value;
    var qty = row.querySelector('.req-qty').value;
    var unit = row.querySelector('.req-unit').value;
    var remarks = row.querySelector('.req-remarks').value || '';
    if (code) {
      count++;
      tbody.innerHTML += '<tr><td>' + count + '</td><td>' + code + '</td><td>' + desc + '</td><td>' + qty + '</td><td>' + unit + '</td><td>' + remarks + '</td></tr>';
    }
  });
}

// ─── Wizard Scanner Functions ────────────────────────────────────
var wizardScanner = null;
var wizardScannerRowIndex = null;

function openWizardScanner(rowIndex) {
  closeWizardScanner();
  
  wizardScannerRowIndex = rowIndex;
  var overlay = document.getElementById('wizardScannerOverlay');
  if (!overlay) return;
  overlay.classList.remove('d-none');
  
  if (!wizardScanner) {
    wizardScanner = new Html5Qrcode('wizardReader');
  }
  
  Html5Qrcode.getCameras().then(function(cameras) {
    if (cameras.length === 0) {
      showToast('No cameras found', 'warning');
      closeWizardScanner();
      return;
    }
    var camId = cameras.find(function(c) { return c.label.toLowerCase().includes('back'); })?.id || cameras[0].id;
    wizardScanner.start(camId, { fps: 10, qrbox: { width: 200, height: 200 } }, onWizardScanSuccess, function() {})
      .catch(function(err) {
        showToast('Camera error: ' + err, 'danger');
        closeWizardScanner();
      });
  }).catch(function(err) {
    showToast('Camera access denied', 'danger');
    closeWizardScanner();
  });
}

function closeWizardScanner() {
  if (wizardScanner) {
    wizardScanner.stop().catch(function() {});
    wizardScanner = null;
  }
  var overlay = document.getElementById('wizardScannerOverlay');
  if (overlay) overlay.classList.add('d-none');
  wizardScannerRowIndex = null;
}

function onWizardScanSuccess(decodedText) {
  closeWizardScanner();
  
  var idx = wizardScannerRowIndex;
  if (idx === null) return;
  
  var matchedItem = null;
  var code = decodedText.trim();
  for (var i = 0; i < state.requestInventoryList.length; i++) {
    var it = state.requestInventoryList[i];
    if (it.inventoryId === code || it.code === code) {
      matchedItem = it;
      break;
    }
  }
  if (!matchedItem) {
    var lowerCode = code.toLowerCase();
    for (var i = 0; i < state.requestInventoryList.length; i++) {
      var it = state.requestInventoryList[i];
      if (it.inventoryId.toLowerCase().indexOf(lowerCode) !== -1 || 
          it.code.toLowerCase().indexOf(lowerCode) !== -1) {
        matchedItem = it;
        break;
      }
    }
  }
  
  var row = document.querySelector('#step5ItemsContainer .step5-item-row:nth-child(' + (idx+1) + ')');
  if (!row) return;
  
  var searchInput = row.querySelector('.req-item-search');
  var codeInput = document.getElementById('step5Code' + idx);
  var descInput = document.getElementById('step5Desc' + idx);
  var unitSelect = row.querySelector('.req-unit');
  var dropdown = document.getElementById('step5Dropdown' + idx);
  if (dropdown) dropdown.classList.add('d-none');
  
  if (matchedItem) {
    if (searchInput) searchInput.value = matchedItem.inventoryId + ' - ' + matchedItem.description;
    if (codeInput) codeInput.value = matchedItem.inventoryId || matchedItem.code;
    if (descInput) descInput.value = matchedItem.description || '';
    if (unitSelect) {
      var unit = matchedItem.unit || 'PIECE';
      for (var opt = 0; opt < unitSelect.options.length; opt++) {
        if (unitSelect.options[opt].value === unit) {
          unitSelect.selectedIndex = opt;
          break;
        }
      }
    }
    checkStep5Items();
    playSuccessBeep();
    showToast('Item scanned: ' + matchedItem.inventoryId, 'success');
  } else {
    if (searchInput) searchInput.value = code;
    if (codeInput) codeInput.value = code;
    checkStep5Items();
    showToast('Scanned code: ' + code + ' (not in inventory, you can edit manually)', 'warning');
  }
}

document.addEventListener('hidden.bs.modal', function (event) {
  if (event.target.id === 'newRequestModal') {
    closeWizardScanner();
  }
});

// ─── Submit Request (with remarks) ─────────────────────────────
async function submitNewRequest() {
  if (state.isLoading) return;
  const docType = document.getElementById('reqDocType').value;
  const requestor = document.getElementById('reqRequestor').value.trim();
  const department = document.getElementById('reqDepartment').value.trim();
  const joNo = document.getElementById('reqJoNo').value.trim();
  const gemSoNo = document.getElementById('reqGemSoNo').value.trim();
  const clientName = document.getElementById('reqClientName').value.trim();
  const project = document.getElementById('reqProject').value.trim();
  if (!requestor) {
    showToast('Select a requestor', 'warning');
    return;
  }

  const items = [];
  document.querySelectorAll('#step5ItemsContainer .step5-item-row').forEach(function(row) {
    const code = row.querySelector('.req-item-code').value;
    const desc = row.querySelector('.req-item-desc').value;
    const qty = parseInt(row.querySelector('.req-qty').value, 10);
    const unit = row.querySelector('.req-unit').value || 'PIECE';
    const remarks = row.querySelector('.req-remarks').value || '';
    if (code && qty > 0) items.push({ 
      inventoryId: code, 
      description: desc, 
      qty: qty, 
      unit: unit,
      remarks: remarks 
    });
  });

  if (items.length === 0) {
    showToast('Add at least one item', 'warning');
    return;
  }
  showLoading('Creating request...');
  try {
    const payload = {
      action: 'createRequest',
      docType: docType,
      requestor: requestor,
      department: department,
      joNo: joNo,
      gemSoNo: gemSoNo,
      clientName: clientName,
      project: project,
      items: items,
      timestamp: new Date().toISOString()
    };
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
    if (data && data.success) {
      localStorage.setItem('ivm_requestorName', requestor);
      newRequestModal.hide();
      showRequestQr(data.ticketNo || 'N/A', data.docNo || 'N/A');
      var statuses = JSON.parse(localStorage.getItem('ivm_requestStatuses') || '{}');
      statuses[data.docNo] = 'PENDING';
      localStorage.setItem('ivm_requestStatuses', JSON.stringify(statuses));
      loadMyRequests();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    showToast('Error: ' + err.message, 'danger');
  } finally {
    hideLoading();
  }
}

// ─── QR DOWNLOAD / SHARE ──────────────────────────────────────────
function downloadRequestQr() {
  if (!lastQrDocNo || !lastQrTicketNo) {
    showToast('No QR to download', 'warning');
    return;
  }
  const img = document.getElementById('requestQrImg');
  if (!img || !img.src || img.src === '') {
    showToast('QR image not loaded', 'warning');
    return;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const qrImg = new Image();
  qrImg.crossOrigin = 'Anonymous';
  qrImg.onload = function() {
    const padding = 30;
    const textHeight = 70;
    const width = qrImg.width + padding * 2;
    const height = qrImg.height + padding * 2 + textHeight;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText('Ticket: ' + lastQrTicketNo, width/2, 10);
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText('Doc: ' + lastQrDocNo, width/2, 32);

    ctx.drawImage(qrImg, padding, padding + textHeight);

    const link = document.createElement('a');
    link.download = 'QR-' + lastQrDocNo + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  qrImg.onerror = function() {
    showToast('Failed to load QR image for download', 'danger');
  };
  qrImg.src = img.src;
}

async function shareRequestQr() {
  if (!navigator.share) {
    showToast('Share not supported on this device', 'warning');
    return;
  }
  if (!lastQrDocNo || !lastQrTicketNo) {
    showToast('No QR to share', 'warning');
    return;
  }

  const img = document.getElementById('requestQrImg');
  if (!img || !img.src) {
    showToast('QR image not loaded', 'warning');
    return;
  }

  try {
    const response = await fetch(img.src);
    const blob = await response.blob();
    const file = new File([blob], 'QR-' + lastQrDocNo + '.png', { type: 'image/png' });
    await navigator.share({
      title: 'GEMCOR Request QR',
      text: 'Ticket: ' + lastQrTicketNo + '\nDoc: ' + lastQrDocNo,
      files: [file]
    });
  } catch(err) {
    if (err.name !== 'AbortError') {
      showToast('Share failed: ' + err.message, 'danger');
    }
  }
}

function showRequestQr(ticketNo, docNo) {
  document.getElementById('requestTicketNo').textContent = ticketNo;
  document.getElementById('requestDocNo').textContent = docNo;
  
  lastQrTicketNo = ticketNo;
  lastQrDocNo = docNo;

  var appUrl = window.location.origin + window.location.pathname;
  var qrDataUrl = appUrl + '?doc=' + encodeURIComponent(docNo);
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(qrDataUrl);
  const img = document.getElementById('requestQrImg');
  img.src = qrUrl;
  img.style.display = 'block';
  img.onerror = function() {
    img.style.display = 'none';
    document.getElementById('qrFallback').classList.remove('d-none');
    document.getElementById('qrFallback').innerHTML = '<strong>Doc No:</strong> ' + docNo;
  };

  const shareBtn = document.getElementById('shareQrBtn');
  if (navigator.share) {
    shareBtn.style.display = 'inline-block';
  } else {
    shareBtn.style.display = 'none';
  }

  requestSuccessModal.show();
}

// ─── REQUEST DETAILS ──────────────────────────────────────────────
async function openRequestDetails(docNo, docType) {
  if (!docNo) return;
  
  var modal = document.getElementById('requestDetailsModal');
  if (!modal) return;
  
  var content = document.getElementById('requestDetailsContent');
  content.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="text-muted mt-2">Loading request details...</div></div>';
  
  var bsModal = new bootstrap.Modal(modal);
  bsModal.show();
  
  try {
    var sheetKey = 'sheetId_' + (docType || 'MRIF');
    var sheetIdVal = localStorage.getItem(sheetKey);
    var sheetIdClean = sheetIdVal ? extractSheetId(sheetIdVal) : '';
    
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
              '&docType=' + (docType || 'MRIF') +
              '&sheetId=' + encodeURIComponent(sheetIdClean) +
              '&_t=' + Date.now();
    console.log('[openRequestDetails] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[openRequestDetails] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('Invalid response'); }
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to load request');
    }
    
    var info = data.info || {};
    var items = data.items || [];
    
    var html = buildRequestDetailsHtml(docNo, docType, info, items);
    content.innerHTML = html;
    
  } catch(err) {
    console.error('[openRequestDetails] Error:', err);
    content.innerHTML = '<div class="alert alert-danger">Failed to load request details: ' + err.message + '</div>';
  }
}

function buildRequestDetailsHtml(docNo, docType, info, items) {
  var requestor = info.Requestor || info.requestor || info.requestorName || '—';
  var department = info.Department || info.department || info.dept || '—';
  var dateRaw = info.Date || info.date || info['Date Prepared'] || info.datePrepared || '';
  var gemSo = info['GEM SO No.'] || info.gemSoNo || info.gemSo || '—';
  var joNo = info['JO No.'] || info.joNo || '—';
  var client = info['Client Name'] || info.clientName || info.client || '—';
  var project = info.Project || info.project || '—';
  var poNo = info['PO No.'] || info.poNo || '—';
  var vendor = info['Vendor/Client'] || info.vendor || info.client || '—';
  var drNo = info['DR No.'] || info.drNo || '—';
  var receivingDate = info['Receiving Date'] || info.receivingDate || '—';
  var receivingSite = info['Receiving Site'] || info.receivingSite || '—';
  var preparedBy = info['Prepared By'] || info.preparedBy || '—';

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
    items.forEach(function(it, idx) {
      var code = it.inventoryId || it.itemCode || it.code || '';
      var desc = it.description || it.desc || '';
      var qty = it.expectedQty || it.qty || it.requestedQty || 0;
      var issued = it.actualQty || it.issuedQty || it.atlQty || 0;
      var unit = it.unit || 'PIECE';
      var remarks = it.remarks || 'PENDING';
      // Show blank issued qty if zero
      var issuedDisplay = (issued === 0) ? '' : issued;
      itemsHtml += '<tr>' +
        '<td>' + (idx + 1) + '</td>' +
        '<td><code>' + code + '</code></td>' +
        '<td>' + desc + '</td>' +
        '<td class="text-center">' + qty + '</td>' +
        '<td class="text-center">' + issuedDisplay + '</td>' +
        '<td class="text-center">' + unit + '</td>' +
        '<td>' + remarks + '</td>' +
        '</tr>';
    });
  } else {
    itemsHtml = '<tr><td colspan="7" class="text-center text-muted py-3">No items found</td></tr>';
  }

  var isMRR = (docType === 'MRR');
  
  return '<div class="request-details">' +
    '<div class="row g-2 mb-3">' +
      '<div class="col-md-6"><strong>Document:</strong> ' + docNo + '</div>' +
      '<div class="col-md-6"><strong>Type:</strong> <span class="badge bg-primary">' + (docType || 'MRIF') + '</span></div>' +
      (requestor !== '—' ? '<div class="col-md-6"><strong>Requestor:</strong> ' + requestor + '</div>' : '') +
      (department !== '—' ? '<div class="col-md-6"><strong>Department:</strong> ' + department + '</div>' : '') +
      (dateStr !== '—' ? '<div class="col-md-6"><strong>Date:</strong> ' + dateStr + '</div>' : '') +
      (isMRR ? '<div class="col-md-6"><strong>Receiving Site:</strong> ' + receivingSite + '</div>' : '') +
      (isMRR ? '<div class="col-md-6"><strong>PO No.:</strong> ' + poNo + '</div>' : '') +
      (isMRR ? '<div class="col-md-6"><strong>Vendor:</strong> ' + vendor + '</div>' : '') +
      (isMRR ? '<div class="col-md-6"><strong>DR No.:</strong> ' + drNo + '</div>' : '') +
      (isMRR ? '<div class="col-md-6"><strong>Receiving Date:</strong> ' + receivingDate + '</div>' : '') +
      (isMRR ? '<div class="col-md-6"><strong>Prepared By:</strong> ' + preparedBy + '</div>' : '') +
      (!isMRR && gemSo !== '—' ? '<div class="col-md-6"><strong>GEM SO No.:</strong> ' + gemSo + '</div>' : '') +
      (!isMRR && joNo !== '—' ? '<div class="col-md-6"><strong>JO No.:</strong> ' + joNo + '</div>' : '') +
      (!isMRR && client !== '—' ? '<div class="col-md-6"><strong>Client:</strong> ' + client + '</div>' : '') +
      (!isMRR && project !== '—' ? '<div class="col-md-6"><strong>Project:</strong> ' + project + '</div>' : '') +
    '</div>' +
    '<hr>' +
    '<div class="table-responsive">' +
      '<table class="table table-sm table-bordered">' +
        '<thead class="table-light">' +
          '<tr>' +
            '<th>#</th>' +
            '<th>Item Code</th>' +
            '<th>Description</th>' +
            '<th class="text-center">' + (isMRR ? 'Rec. Qty' : 'Req. Qty') + '</th>' +
            '<th class="text-center">' + (isMRR ? 'ATL Qty' : 'Issued Qty') + '</th>' +
            '<th class="text-center">Unit</th>' +
            '<th>Remarks</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + itemsHtml + '</tbody>' +
      '</table>' +
    '</div>' +
  '</div>';
}

// ─── MY REQUESTS ──────────────────────────────────────────────────
async function loadMyRequests() {
  var requestor = localStorage.getItem('ivm_requestorName');
  if (!requestor) return;
  showLoading('Loading requests...');
  try {
    var url = API_URL + '?action=getMyRequests&requestor=' + encodeURIComponent(requestor) + '&_t=' + Date.now();
    console.log('[loadMyRequests] Fetching:', url);
    var res = await fetch(url);
    var data = await res.json();
    console.log('[loadMyRequests] Response:', data);
    if (data.success && data.requests) {
      data.requests.sort(function(a, b) {
        var ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        var tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      });
      var prevStatuses = {};
      try { prevStatuses = JSON.parse(localStorage.getItem('ivm_requestStatuses') || '{}'); } catch(e) {}
      console.log('[loadMyRequests] Previous statuses:', prevStatuses);
      var newStatuses = {};
      var hasNewReady = false;
      var readyCount = 0;
      var pendingCount = 0;
      data.requests.forEach(function(req) {
        var docNo = req.docNo || '';
        var status = req.status || 'PENDING';
        newStatuses[docNo] = status;
        var prevStatus = prevStatuses[docNo] || 'PENDING';
        if (prevStatus === 'PENDING' && (status === 'PARTIAL' || status === 'COMPLETED')) {
          hasNewReady = true;
          console.log('[loadMyRequests] STATUS CHANGE DETECTED:', docNo, prevStatus, '->', status);
        }
        if (status !== 'PENDING') readyCount++;
        else pendingCount++;
      });
      localStorage.setItem('ivm_requestStatuses', JSON.stringify(newStatuses));
      var badge = document.getElementById('myRequestsBadge');
      if (badge) {
        badge.textContent = readyCount;
        badge.classList.toggle('d-none', readyCount === 0);
        console.log('[loadMyRequests] Badge count:', readyCount);
      }
      // Update sidebar badge
      var badgeSidebar = document.getElementById('myRequestsBadgeSidebar');
      if (badgeSidebar) {
        badgeSidebar.textContent = readyCount;
        badgeSidebar.classList.toggle('d-none', readyCount === 0);
      }
      renderMyRequests(data.requests);
      var kpiActive = document.getElementById('kpiActiveDocs');
      var kpiPending = document.getElementById('kpiPending');
      var kpiCompleted = document.getElementById('kpiCompleted');
      if (kpiActive) kpiActive.textContent = data.requests.length;
      if (kpiPending) kpiPending.textContent = pendingCount;
      if (kpiCompleted) kpiCompleted.textContent = readyCount;
      if (hasNewReady) {
        playSuccessBeep();
        showToast('Your request has been processed by the warehouse!', 'success');
        console.log('[loadMyRequests] Toast notification shown!');
      }
    } else {
      console.log('[loadMyRequests] No requests or error:', data.error);
      document.getElementById('myRequestsList').innerHTML = '<div class="list-group-item text-muted text-center py-3">' + (data.error ? 'Error: ' + data.error : 'No requests found') + '</div>';
    }
  } catch(e) {
    console.error('[loadMyRequests] Error:', e);
    document.getElementById('myRequestsList').innerHTML = '<div class="list-group-item text-danger text-center py-3">Failed to load requests. Check your connection.</div>';
  }
  finally { hideLoading(); }
}

// ─── Updated renderMyRequests with action buttons ──────────────
function renderMyRequests(requests) {
  var container = document.getElementById('myRequestsList');
  container.innerHTML = '';
  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted text-center">No requests found</div>';
    return;
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
    var docType = req.type || 'MRIF';
    
    var html = '<div class="list-group-item">' +
      '<div class="d-flex justify-content-between align-items-start">' +
        '<div class="flex-grow-1">' +
          '<div class="fw-bold">' + docNo + ' <span class="badge bg-secondary">' + docType + '</span></div>' +
          '<div class="small text-muted"><i class="bi bi-calendar me-1"></i>' + dateStr + '</div>' +
          '<div class="small mt-1"><i class="bi bi-box me-1"></i>' + (req.itemCode || '') + ' <span class="badge bg-light text-dark">x' + (req.qty || 0) + '</span></div>' +
        '</div>' +
        '<div class="d-flex flex-column align-items-end gap-1">' +
          '<span class="badge bg-' + badgeClass + '"><i class="bi ' + icon + ' me-1"></i>' + statusText + '</span>' +
          '<div class="btn-group btn-group-sm" role="group">' +
            '<button class="btn btn-outline-primary" onclick="openRequestDetails(\'' + docNo + '\', \'' + docType + '\')" title="View Details"><i class="bi bi-eye"></i></button>' +
            '<button class="btn btn-outline-secondary" onclick="showRequestQr(\'' + docNo + '\', \'' + docNo + '\')" title="Show QR"><i class="bi bi-qr-code"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    container.innerHTML += html;
  });
}

// ─── MANUAL MRIF FUNCTIONS (with Remarks) ───────────────────────
function openManualMrifModal() {
  if (!manualMrifModal) {
    manualMrifModal = new bootstrap.Modal(document.getElementById('manualMrifModal'));
  }
  document.getElementById('manualMrifRequestor').value = '';
  document.getElementById('manualMrifDepartment').value = '';
  document.getElementById('manualMrifJoNo').value = '';
  document.getElementById('manualMrifGemSoNo').value = '';
  document.getElementById('manualMrifClient').value = '';
  document.getElementById('manualMrifProject').value = '';
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('manualMrifDate').value = today;
  manualMrifItems = [];
  renderManualMrifItems();
  updateManualMrifSubmitButton();
  manualMrifModal.show();
  loadRequestInventory();
}

function addManualMrifItem() {
  manualMrifItems.push({
    inventoryId: '',
    description: '',
    qty: 1,
    atlQty: 0,
    unit: 'PIECE',
    remarks: ''
  });
  renderManualMrifItems();
  updateManualMrifSubmitButton();
  setTimeout(function() {
    var searches = document.querySelectorAll('.manual-mrif-search');
    if (searches.length > 0) {
      searches[searches.length - 1].focus();
    }
  }, 100);
}

function removeManualMrifItem(index) {
  manualMrifItems.splice(index, 1);
  renderManualMrifItems();
  updateManualMrifSubmitButton();
}

function updateManualMrifItem(index, field, value) {
  if (manualMrifItems[index]) {
    manualMrifItems[index][field] = value;
  }
  updateManualMrifSubmitButton();
}

function renderManualMrifItems() {
  var tbody = document.getElementById('manualMrifItemsBody');
  var emptyState = document.getElementById('manualMrifEmptyState');
  if (!tbody) return;

  if (manualMrifItems.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  var html = '';
  for (var i = 0; i < manualMrifItems.length; i++) {
    var it = manualMrifItems[i];
    html += '<tr>' +
      '<td class="align-middle text-center">' + (i + 1) + '</td>' +
      '<td>' +
        '<div style="position:relative;">' +
          '<input type="text" class="form-control form-control-sm manual-mrif-search" ' +
            'placeholder="Type to search..." ' +
            'value="' + (it.inventoryId ? it.inventoryId + ' - ' + it.description : '') + '" ' +
            'oninput="filterManualMrifItems(this, ' + i + ')" ' +
            'onfocus="filterManualMrifItems(this, ' + i + ')" ' +
            'autocomplete="off">' +
          '<div class="list-group position-absolute z-3 d-none manual-mrif-dropdown" ' +
            'style="max-height:150px;overflow-y:auto;width:100%;" ' +
            'id="manualMrifDropdown' + i + '"></div>' +
          '<input type="hidden" class="manual-mrif-code" id="manualMrifCode' + i + '" value="' + (it.inventoryId || '') + '">' +
          '<input type="hidden" class="manual-mrif-desc" id="manualMrifDesc' + i + '" value="' + (it.description || '') + '">' +
        '</div>' +
      '</td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
        'value="' + (it.description || '') + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'description\', this.value)" ' +
        'placeholder="Description"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.qty || 1) + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'qty\', parseFloat(this.value)||0)" ' +
        'min="1" step="1"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center" ' +
        'value="' + (it.atlQty || 0) + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'atlQty\', parseFloat(this.value)||0)" ' +
        'min="0" step="1"></td>' +
      '<td><select class="form-select form-select-sm manual-mrif-unit" ' +
        'onchange="updateManualMrifItem(' + i + ', \'unit\', this.value)">' +
        buildUnitOptions(it.unit || 'PIECE') +
      '</select></td>' +
      '<td><input type="text" class="form-control form-control-sm" ' +
        'value="' + (it.remarks || '') + '" ' +
        'onchange="updateManualMrifItem(' + i + ', \'remarks\', this.value)" ' +
        'placeholder="Remarks" maxlength="200"></td>' +
      '<td class="align-middle text-center">' +
        '<button class="btn btn-sm btn-outline-danger" onclick="removeManualMrifItem(' + i + ')" title="Remove">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

function filterManualMrifItems(input, idx) {
  var term = input.value.toLowerCase();
  var dropdown = document.getElementById('manualMrifDropdown' + idx);
  dropdown.innerHTML = '';

  if (!term) {
    dropdown.classList.add('d-none');
    return;
  }

  var matches = state.requestInventoryList.filter(function(it) {
    var code = (it.code || it.inventoryId || '').toLowerCase();
    var desc = (it.description || '').toLowerCase();
    return code.includes(term) || desc.includes(term);
  }).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted">No matches</div>';
  } else {
    matches.forEach(function(it) {
      var code = it.code || it.inventoryId || '';
      var desc = it.description || '';
      var unit = it.unit || 'PIECE';
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.innerHTML = '<div class="fw-bold small">' + code + '</div><div class="small text-muted">' + desc + '</div>';
      el.onclick = function() {
        input.value = code + ' - ' + desc;
        document.getElementById('manualMrifCode' + idx).value = code;
        document.getElementById('manualMrifDesc' + idx).value = desc;
        var row = input.closest('tr');
        if (row) {
          var descInput = row.querySelector('td:nth-child(3) input');
          if (descInput) descInput.value = desc;
        }
        var unitSelect = input.closest('td').querySelector('.manual-mrif-unit') ||
                         input.closest('tr').querySelector('.manual-mrif-unit');
        if (unitSelect && unitSelect.querySelector('option[value="' + unit + '"]')) {
          unitSelect.value = unit;
        }
        manualMrifItems[idx].inventoryId = code;
        manualMrifItems[idx].description = desc;
        manualMrifItems[idx].unit = unit;
        dropdown.classList.add('d-none');
        updateManualMrifSubmitButton();
      };
      dropdown.appendChild(el);
    });
  }
  dropdown.classList.remove('d-none');
}

function updateManualMrifSubmitButton() {
  var btn = document.getElementById('btnSubmitManualMrif');
  if (!btn) return;

  var requestor = document.getElementById('manualMrifRequestor').value.trim();

  var hasValidItems = false;
  for (var i = 0; i < manualMrifItems.length; i++) {
    var it = manualMrifItems[i];
    if (it.inventoryId && it.inventoryId.trim() && it.description && it.description.trim() && it.qty > 0) {
      hasValidItems = true;
      break;
    }
  }

  btn.disabled = !(requestor && hasValidItems);
}

async function submitManualMrif() {
  var requestor = document.getElementById('manualMrifRequestor').value.trim();
  var department = document.getElementById('manualMrifDepartment').value.trim();
  var joNo = document.getElementById('manualMrifJoNo').value.trim();
  var gemSoNo = document.getElementById('manualMrifGemSoNo').value.trim();
  var clientName = document.getElementById('manualMrifClient').value.trim();
  var project = document.getElementById('manualMrifProject').value.trim();

  var items = [];
  var rows = document.querySelectorAll('#manualMrifItemsBody tr');
  for (var i = 0; i < rows.length; i++) {
    var codeInput = rows[i].querySelector('.manual-mrif-code');
    var descInput = rows[i].querySelector('.manual-mrif-desc');
    var qtyInput = rows[i].querySelector('td:nth-child(4) input');
    var atlInput = rows[i].querySelector('td:nth-child(5) input');
    var unitSelect = rows[i].querySelector('.manual-mrif-unit');
    var remarksInput = rows[i].querySelector('td:nth-child(7) input');
    var code = codeInput ? codeInput.value.trim() : '';
    var desc = descInput ? descInput.value.trim() : '';
    var qty = qtyInput ? parseInt(qtyInput.value, 10) : 0;
    var atl = atlInput ? parseInt(atlInput.value, 10) : 0;
    var unit = unitSelect ? unitSelect.value : 'PIECE';
    var remarks = remarksInput ? remarksInput.value.trim() : '';
    if (code && desc && qty > 0) {
      items.push({
        inventoryId: code,
        description: desc,
        qty: qty,
        atlQty: atl,
        unit: unit,
        remarks: remarks
      });
    }
  }

  if (items.length === 0) {
    showToast('Please add at least one valid item', 'warning');
    return;
  }

  if (!requestor) {
    showToast('Please enter a requestor name', 'warning');
    return;
  }

  showLoading('Creating Manual MRIF...');

  var timeoutId = setTimeout(function() {
    console.warn('[Manual MRIF] Loading timeout – forcing hide.');
    hideLoading();
  }, 10000);

  try {
    var payload = {
      action: 'createRequest',
      docType: 'MRIF',
      requestor: requestor,
      department: department || '',
      joNo: joNo || '',
      gemSoNo: gemSoNo || '',
      clientName: clientName || '',
      project: project || '',
      items: items,
      timestamp: new Date().toISOString(),
      isManual: true
    };

    console.log('[Manual MRIF] Payload:', payload);

    var res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    });

    console.log('[Manual MRIF] Response status:', res.status);

    var text = await res.text();
    console.log('[Manual MRIF] Raw response:', text);

    var data;
    try { data = JSON.parse(text); } catch(e) {
      throw new Error('Invalid JSON response from server');
    }

    if (data && data.success) {
      if (manualMrifModal) manualMrifModal.hide();
      showToast('Manual MRIF created: ' + data.docNo, 'success');
      await fetchPendingDocs();
      await loadWarehouseNotifications();
      await updateWarehouseKPIs();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    console.error('[Manual MRIF] Error:', err);
    showToast('Error: ' + err.message, 'danger');
  } finally {
    clearTimeout(timeoutId);
    hideLoading();
  }
}
