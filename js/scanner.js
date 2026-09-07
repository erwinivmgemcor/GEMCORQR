// ============================================================
// QR SCANNER FUNCTIONS
// ============================================================

function startScanner() {
  if (state.html5QrCode) { state.html5QrCode.stop().catch(()=>{}); }
  state.html5QrCode = new Html5Qrcode('reader');
  Html5Qrcode.getCameras().then(cameras => {
    state.cameras = cameras;
    if (cameras.length === 0) { showToast('No cameras found', 'warning'); return; }
    const camId = state.currentCamera === 'environment' ? cameras.find(c=>c.label.toLowerCase().includes('back'))?.id || cameras[0].id : cameras.find(c=>c.label.toLowerCase().includes('front'))?.id || cameras[0].id;
    state.html5QrCode.start(camId, { fps:10, qrbox:{width:200,height:200} }, onScanSuccess, ()=>{}).then(()=>{
      document.getElementById('torchBtn').classList.remove('d-none');
    }).catch(err => showToast('Camera error: ' + err, 'danger'));
  }).catch(err => showToast('Camera access denied', 'danger'));
}

function stopScanner() {
  if (state.html5QrCode) { state.html5QrCode.stop().catch(()=>{}); state.html5QrCode = null; }
}

function onScanSuccess(decodedText) {
  clearErrorAlert();

  var urlDocMatch = decodedText.match(/[?&]doc=([^&\s]+)/);
  if (urlDocMatch) {
    var extractedDoc = decodeURIComponent(urlDocMatch[1]);
    console.log('[Scan] Extracted doc from URL:', extractedDoc);
    var mod = 'MRIF';
    if (extractedDoc.indexOf('MRR') === 0) mod = 'MRR';
    else if (extractedDoc.indexOf('MRS') === 0) mod = 'MRS';
    playSuccessBeep();
    showToast('Loading document ' + cleanDocNo(extractedDoc) + '...', 'success');
    selectModule(mod).then(() => {
      onDocSelect(extractedDoc);
    }).catch(err => {
      console.error('[onScanSuccess] Error switching module:', err);
      showToast('Failed to switch module: ' + err.message, 'danger');
    });
    return;
  }

  const docPattern = /^(MRIF|MRR|MRS)\d{6,}/i;
  if (docPattern.test(decodedText)) {
    playSuccessBeep();
    if (confirm('Document QR detected: ' + decodedText + '\n\nSwitch to this document?')) {
      const mod = decodedText.substring(0, 4).toUpperCase();
      if (['MRIF','MRR','MRS'].includes(mod)) {
        selectModule(mod).then(() => {
          onDocSelect(decodedText);
        }).catch(err => {
          console.error('[onScanSuccess] Error switching module:', err);
          showToast('Failed to switch module: ' + err.message, 'danger');
        });
      }
    }
    return;
  }

  const item = state.items.find(i => i.inventoryId.toLowerCase() === decodedText.toLowerCase());
  if (!item) {
    playErrorBuzz();
    showMismatchAlert(decodedText);
    return;
  }
  playSuccessBeep();
  openQtyModal(item);
}

function manualVerify() {
  if (state.isLoading) return;
  const val = document.getElementById('manualInput').value.trim();
  if (!val) return;
  document.getElementById('manualInput').value = '';
  onScanSuccess(val);
}

function toggleTorch() {
  const video = document.querySelector('#reader video');
  if (!video || !video.srcObject) return;
  const track = video.srcObject.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities();
  if (!caps.torch) { showToast('Flashlight not supported', 'warning'); return; }
  state.torchOn = !state.torchOn;
  track.applyConstraints({ advanced:[{torch:state.torchOn}] }).then(()=>{
    document.getElementById('torchBtn').classList.toggle('active', state.torchOn);
    showToast(state.torchOn ? 'Flashlight ON' : 'Flashlight OFF', 'info');
  }).catch(()=>showToast('Torch failed', 'warning'));
}

function switchCamera() {
  state.currentCamera = state.currentCamera === 'environment' ? 'user' : 'environment';
  startScanner();
}

// ─── Quick Scan ───
function openQuickScan() {
  if (state.isLoading) return;
  quickScanModal.show();
  setTimeout(startQuickScanner, 300);
}
function closeQuickScan() {
  if (state.quickScanner) {
    state.quickScanner.stop().catch(()=>{});
    state.quickScanner = null;
  }
  quickScanModal.hide();
}
function startQuickScanner() {
  if (state.quickScanner) { state.quickScanner.stop().catch(()=>{}); }
  const el = document.getElementById('quickReader');
  if (!el) return;
  state.quickScanner = new Html5Qrcode('quickReader');
  Html5Qrcode.getCameras().then(cameras => {
    if (cameras.length === 0) { showToast('No cameras found', 'warning'); return; }
    const camId = cameras.find(c=>c.label.toLowerCase().includes('back'))?.id || cameras[0].id;
    state.quickScanner.start(camId, { fps:10, qrbox:{width:250,height:250} }, onQuickScanSuccess, ()=>{}).catch(err => {
      showToast('Quick scan camera error: ' + err, 'danger');
    });
  }).catch(err => showToast('Camera access denied', 'danger'));
}
async function onQuickScanSuccess(decodedText) {
  if (state.quickScanner) {
    state.quickScanner.stop().catch(()=>{});
    state.quickScanner = null;
  }
  quickScanModal.hide();

  var urlDocMatch = decodedText.match(/[?&]doc=([^&\s]+)/);
  if (urlDocMatch) {
    var extractedDoc = decodeURIComponent(urlDocMatch[1]);
    console.log('[QuickScan] Extracted doc from URL:', extractedDoc);
    var mod = 'MRIF';
    if (extractedDoc.indexOf('MRR') === 0) mod = 'MRR';
    else if (extractedDoc.indexOf('MRS') === 0) mod = 'MRS';
    playSuccessBeep();
    
    var sheetKey = 'sheetId_' + mod;
    var sheetId = localStorage.getItem(sheetKey);
    if (!sheetId || !extractSheetId(sheetId)) {
      showToast('⚠️ Sheet ID for ' + mod + ' is missing. Please go to Settings and sync or enter the Sheet ID.', 'warning');
      await syncModuleLinks();
      sheetId = localStorage.getItem(sheetKey);
      if (!sheetId || !extractSheetId(sheetId)) {
        showToast('Still missing Sheet ID. Please set it manually in Settings.', 'danger');
        return;
      }
    }
    
    showToast('Loading document ' + cleanDocNo(extractedDoc) + '...', 'success');
    try {
      await selectModule(mod);
      await onDocSelect(extractedDoc);
    } catch(err) {
      console.error('[QuickScan] Error loading document:', err);
      showToast('Failed to load document: ' + err.message, 'danger');
      document.getElementById('docPickerSection').classList.remove('d-none');
      document.getElementById('activeTransactionSection').classList.add('d-none');
    }
    return;
  }

  const docPattern = /^(MRIF|MRR|MRS)\d{6,}/i;
  if (docPattern.test(decodedText)) {
    const mod = decodedText.substring(0, 4).toUpperCase();
    if (['MRIF','MRR','MRS'].includes(mod)) {
      playSuccessBeep();
      var sheetKey = 'sheetId_' + mod;
      var sheetId = localStorage.getItem(sheetKey);
      if (!sheetId || !extractSheetId(sheetId)) {
        showToast('⚠️ Sheet ID for ' + mod + ' is missing. Please go to Settings and sync or enter the Sheet ID.', 'warning');
        await syncModuleLinks();
        sheetId = localStorage.getItem(sheetKey);
        if (!sheetId || !extractSheetId(sheetId)) {
          showToast('Still missing Sheet ID. Please set it manually in Settings.', 'danger');
          return;
        }
      }
      showToast('Loading document ' + cleanDocNo(decodedText) + '...', 'success');
      try {
        await selectModule(mod);
        await onDocSelect(decodedText);
      } catch(err) {
        console.error('[QuickScan] Error loading document:', err);
        showToast('Failed to load document: ' + err.message, 'danger');
        document.getElementById('docPickerSection').classList.remove('d-none');
        document.getElementById('activeTransactionSection').classList.add('d-none');
      }
      return;
    }
  }

  const poResult = await lookupPoFromScan(decodedText);
  if (poResult && poResult.success) {
    playSuccessBeep();
    state.currentPoNo = decodedText;
    state.currentPoPrf = poResult.prfNo || '';
    state.currentPoClient = poResult.client || '';
    state.currentPoSupplier = poResult.supplier || poResult.client || '';
    state.poItemsData = poResult.items;
    renderPoItems();
    state.poItemsModal.show();
    return;
  }

  if (state.currentDoc && state.items.length > 0) {
    const item = state.items.find(i => i.inventoryId.toLowerCase() === decodedText.toLowerCase());
    if (item) {
      playSuccessBeep();
      document.getElementById('docPickerSection').classList.add('d-none');
      document.getElementById('activeTransactionSection').classList.remove('d-none');
      openQtyModal(item);
      return;
    }
  }

  playErrorBuzz();
  showToast('Not recognized: ' + decodedText + '. Scan a Document QR, PO QR, or Item QR.', 'danger');
}

// ─── Upload QR Image (Desktop) ─────────────────────────────────────
// Call this function from the file input's onchange event.
// It reads the selected image file, decodes the QR code using html5-qrcode,
// and then processes the result as if it were a live scan.
function handleQrFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // Reset the input so the same file can be re-uploaded
  event.target.value = '';
  
  showLoading('Decoding QR image...');
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const imageData = e.target.result;
    
    // Create a temporary scanner instance to decode the image
    // We don't need a renderer element, so we pass an empty string.
    const scanner = new Html5Qrcode('');
    scanner.decodeFromImage(imageData, null)
      .then(function(decodedText) {
        hideLoading();
        console.log('[QR Upload] Decoded:', decodedText);
        // Process the decoded text as a successful scan
        onScanSuccess(decodedText);
      })
      .catch(function(err) {
        hideLoading();
        console.error('[QR Upload] Decode error:', err);
        showToast('Failed to decode QR from image. Please ensure it is a valid QR code.', 'danger');
      });
  };
  reader.onerror = function() {
    hideLoading();
    showToast('Failed to read the image file.', 'danger');
  };
  reader.readAsDataURL(file);
}
