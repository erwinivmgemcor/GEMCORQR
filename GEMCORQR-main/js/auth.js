// ============================================================
// AUTHENTICATION & ROLE MANAGEMENT
// ============================================================

function initRole() {
  const role = localStorage.getItem('ivm_userRole');
  if (!role) {
    roleModal.show();
  } else {
    applyRoleUI();
    if (role === 'warehouse') {
      if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
        setTimeout(() => settingsModal.show(), 500);
      }
      selectModule('MRIF');
    } else {
      checkProductionName();
    }
  }
}

function selectRole(role) {
  if (role === 'production') {
    localStorage.setItem('ivm_userRole', 'production');
    roleModal.hide();
    applyRoleUI();
    showToast('Production mode activated', 'success');
    checkProductionName();
  }
}

function checkProductionName() {
  var name = localStorage.getItem('ivm_requestorName');
  if (!name) {
    productionNameModal.show();
  } else {
    loadMyRequests();
  }
}

function saveProductionName() {
  var name = document.getElementById('productionNameInput').value.trim();
  if (!name) {
    showToast('Please enter your name', 'warning');
    return;
  }
  localStorage.setItem('ivm_requestorName', name);
  productionNameModal.hide();
  localStorage.removeItem('ivm_requestStatuses');
  loadMyRequests();
}

function showPinEntry() {
  document.getElementById('pinEntrySection').classList.remove('d-none');
  clearPin();
}
function enterPinDigit(d) {
  if (state.pinBuffer.length < 4) {
    state.pinBuffer += d;
    updatePinDots();
  }
}
function backspacePin() {
  state.pinBuffer = state.pinBuffer.slice(0, -1);
  updatePinDots();
}
function clearPin() {
  state.pinBuffer = '';
  updatePinDots();
  document.getElementById('pinError').classList.add('d-none');
}
function updatePinDots() {
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById('pinDot' + i);
    if (i <= state.pinBuffer.length) dot.classList.add('filled');
    else dot.classList.remove('filled');
  }
}
function verifyPin() {
  const storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
  if (state.pinBuffer === storedPin) {
    localStorage.setItem('ivm_userRole', 'warehouse');
    state.pinAttempts = 0;
    if (!state.warehouseName) {
      let name = prompt('Please enter your full name (for audit trail):');
      if (name && name.trim()) {
        state.warehouseName = name.trim();
        localStorage.setItem('ivm_warehouseName', state.warehouseName);
      } else {
        state.warehouseName = 'WAREHOUSE';
        localStorage.setItem('ivm_warehouseName', 'WAREHOUSE');
      }
    }
    roleModal.hide();
    applyRoleUI();
    showToast('Warehouse mode unlocked', 'success');
    if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
      setTimeout(() => settingsModal.show(), 500);
    }
    selectModule('MRIF');
  } else {
    state.pinAttempts++;
    document.getElementById('pinError').classList.remove('d-none');
    clearPin();
    playErrorBuzz();
    if (state.pinAttempts >= 3) {
      showToast('Too many failed attempts. Please contact admin.', 'danger');
      state.pinAttempts = 0;
    }
  }
}

function applyRoleUI() {
  const role = localStorage.getItem('ivm_userRole');
  const isProduction = (role === 'production');
  document.getElementById('btnMRR').style.display = isProduction ? 'none' : '';
  document.getElementById('btnMRIF').style.display = isProduction ? 'none' : '';
  document.getElementById('btnMRS').style.display = isProduction ? 'none' : '';
  document.getElementById('productionBanner').classList.toggle('d-none', !isProduction);
  document.getElementById('warehouseDashboard').classList.toggle('d-none', isProduction);
  document.getElementById('myRequestsSection').classList.toggle('d-none', !isProduction);
  document.getElementById('docPickerSection').style.display = isProduction ? 'none' : '';
  document.getElementById('quickScanCard').style.display = isProduction ? 'none' : '';
  const whBtn = document.getElementById('whNotifBtn');
  if (whBtn) whBtn.classList.toggle('d-none', isProduction);
  if (isProduction) {
    document.getElementById('activeTransactionSection').classList.add('d-none');
    document.getElementById('warehouseDashboard').classList.add('d-none');
    if (window._requestsInterval) clearInterval(window._requestsInterval);
    window._requestsInterval = setInterval(function() {
      if (!state.isLoading) loadMyRequests();
    }, 30000);
    if (window._whInterval) clearInterval(window._whInterval);
  } else {
    document.getElementById('warehouseDashboard').classList.remove('d-none');
    if (window._requestsInterval) clearInterval(window._requestsInterval);
    if (window._whInterval) clearInterval(window._whInterval);
    window._whInterval = setInterval(function() {
      if (!state.isLoading) loadWarehouseNotifications();
    }, 30000);
    loadWarehouseNotifications();
    updateWarehouseKPIs();
  }
}

function switchRole() {
  settingsModal.hide();
  document.getElementById('pinEntrySection').classList.add('d-none');
  clearPin();
  roleModal.show();
}

function changePin() {
  const current = document.getElementById('currentPinInput').value;
  const newPin = document.getElementById('newPinInput').value;
  const storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
  const msg = document.getElementById('pinChangeMsg');
  if (current !== storedPin) {
    msg.textContent = 'Current PIN is incorrect';
    msg.className = 'small mt-2 text-danger';
    return;
  }
  if (!/^\d{4}$/.test(newPin)) {
    msg.textContent = 'New PIN must be exactly 4 digits';
    msg.className = 'small mt-2 text-danger';
    return;
  }
  localStorage.setItem('ivm_warehousePin', newPin);
  msg.textContent = 'PIN changed successfully';
  msg.className = 'small mt-2 text-success';
  document.getElementById('currentPinInput').value = '';
  document.getElementById('newPinInput').value = '';
}

function openSettings() {
  loadSettingsToUI();
  const role = localStorage.getItem('ivm_userRole');
  const isProduction = (role === 'production');
  document.getElementById('pinManagementSection').style.display = isProduction ? 'none' : '';
  document.getElementById('syncSection').style.display = isProduction ? 'none' : '';
  document.getElementById('sheetIdsSection').style.display = isProduction ? 'none' : '';
  document.getElementById('currentRoleDisplay').textContent = role === 'warehouse' ? 'Warehouse Staff' : 'Production Staff';
  document.getElementById('currentRoleDisplay').className = role === 'warehouse' ? 'badge bg-success' : 'badge bg-primary';
  document.getElementById('appVersion').textContent = 'v' + APP_VERSION;
  settingsModal.show();
}

function loadSettingsToUI() {
  document.getElementById('sheetId_MRR').value = localStorage.getItem('sheetId_MRR') || '';
  document.getElementById('sheetId_MRIF').value = localStorage.getItem('sheetId_MRIF') || '';
  document.getElementById('sheetId_MRS').value = localStorage.getItem('sheetId_MRS') || '';
}

function saveSettings() {
  const mrr = document.getElementById('sheetId_MRR').value.trim();
  const mrif = document.getElementById('sheetId_MRIF').value.trim();
  const mrs = document.getElementById('sheetId_MRS').value.trim();
  if (mrr) localStorage.setItem('sheetId_MRR', extractSheetId(mrr));
  if (mrif) localStorage.setItem('sheetId_MRIF', extractSheetId(mrif));
  if (mrs) localStorage.setItem('sheetId_MRS', extractSheetId(mrs));
  showToast('Settings saved!', 'success');
  settingsModal.hide();
  if (state.currentModule) selectModule(state.currentModule);
}
