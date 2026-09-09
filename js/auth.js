// ============================================================
// AUTHENTICATION & ROLE MANAGEMENT (with User Login)
// ============================================================

function initRole() {
  // Check if user already logged in (from localStorage)
  var savedUser = localStorage.getItem('ivm_username');
  if (savedUser) {
    state.currentUser = savedUser;
    state.currentUserFullname = localStorage.getItem('ivm_userFullname') || savedUser;
  }

  const role = localStorage.getItem('ivm_userRole');
  if (!role) {
    if (roleModal) roleModal.show();
  } else {
    applyRoleUI();
    if (role === 'warehouse') {
      // ─── Preload lists for warehouse ──────────────────────
      if (!state.currentUser) {
        setTimeout(showLoginModal, 300);
      } else {
        preloadWarehouseLists();
        if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
          setTimeout(() => { if (settingsModal) settingsModal.show(); }, 500);
        }
        selectModule('MRIF');
        setTimeout(loadAnalytics, 500);
        loadWarehouseNotifications();
      }
    } else {
      checkProductionName();
    }
  }
}

// ─── Preload lists (inventory, vendors, IVM team) ──────────────
async function preloadWarehouseLists() {
  try {
    await Promise.all([
      loadRequestInventory(false),
      loadVendorList(false),
      loadIvmTeamList(false)
    ]);
    console.log('[Preload] Warehouse lists loaded');
  } catch(e) {
    console.warn('[Preload] Some lists failed to load:', e);
  }
}

function selectRole(role) {
  if (role === 'production') {
    localStorage.setItem('ivm_userRole', 'production');
    if (roleModal) roleModal.hide();
    applyRoleUI();
    showToast('Production mode activated', 'success');
    checkProductionName();
  } else if (role === 'warehouse') {
    // If already logged in, switch immediately
    if (state.currentUser) {
      localStorage.setItem('ivm_userRole', 'warehouse');
      if (roleModal) roleModal.hide();
      applyRoleUI();
      showToast('Warehouse mode activated', 'success');
      preloadWarehouseLists();
      if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
        setTimeout(() => { if (settingsModal) settingsModal.show(); }, 500);
      }
      selectModule('MRIF');
      loadWarehouseNotifications();
      setTimeout(loadAnalytics, 500);
    } else {
      // Not logged in – show login modal
      if (roleModal) roleModal.hide();
      showLoginModal();
    }
  }
}

function checkProductionName() {
  var name = localStorage.getItem('ivm_requestorName');
  if (!name) {
    if (productionNameModal) productionNameModal.show();
  } else {
    loadMyRequests();
  }
}

function saveProductionName() {
  var name = document.getElementById('productionNameInput') ? document.getElementById('productionNameInput').value.trim() : '';
  if (!name) {
    showToast('Please enter your name', 'warning');
    return;
  }
  localStorage.setItem('ivm_requestorName', name);
  if (productionNameModal) productionNameModal.hide();
  localStorage.removeItem('ivm_requestStatuses');
  loadMyRequests();
}

// ─── User Login ──────────────────────────────────────────────────
function showLoginModal() {
  var loginModal = document.getElementById('loginModal');
  if (!loginModal) return;
  // Reset fields
  var userField = document.getElementById('loginUsername');
  var passField = document.getElementById('loginPassword');
  var errorField = document.getElementById('loginError');
  if (userField) userField.value = '';
  if (passField) passField.value = '';
  if (errorField) errorField.classList.add('d-none');
  var modal = new bootstrap.Modal(loginModal, { backdrop: 'static' });
  modal.show();
  // Focus username
  setTimeout(function() {
    if (userField) userField.focus();
  }, 300);
}

async function loginUser() {
  var username = document.getElementById('loginUsername').value.trim();
  var password = document.getElementById('loginPassword').value.trim();
  var errorField = document.getElementById('loginError');
  var loginBtn = document.getElementById('loginBtn');
  if (!username || !password) {
    if (errorField) {
      errorField.textContent = 'Please enter username and password';
      errorField.classList.remove('d-none');
    }
    return;
  }
  // Show loading
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Checking...';
  }
  try {
    var url = API_URL + '?action=verifyUser&username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password) + '&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var data = await res.json();
    if (data.success) {
      state.currentUser = data.username;
      state.currentUserFullname = data.fullname || data.username;
      localStorage.setItem('ivm_username', state.currentUser);
      localStorage.setItem('ivm_userFullname', state.currentUserFullname);
      localStorage.setItem('ivm_userRole', 'warehouse'); // Ensure role is warehouse
      // Close login modal
      var loginModal = document.getElementById('loginModal');
      if (loginModal) {
        var modal = bootstrap.Modal.getInstance(loginModal);
        if (modal) modal.hide();
      }
      showToast('Welcome, ' + state.currentUserFullname + '!', 'success');
      applyRoleUI();
      preloadWarehouseLists();
      if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
        setTimeout(() => { if (settingsModal) settingsModal.show(); }, 500);
      }
      selectModule('MRIF');
      loadWarehouseNotifications();
      setTimeout(loadAnalytics, 500);
    } else {
      if (errorField) {
        errorField.textContent = data.error || 'Login failed';
        errorField.classList.remove('d-none');
      }
    }
  } catch(err) {
    if (errorField) {
      errorField.textContent = 'Network error: ' + err.message;
      errorField.classList.remove('d-none');
    }
  } finally {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = 'Login';
    }
  }
}

function logoutUser() {
  if (confirm('Logout ' + (state.currentUserFullname || state.currentUser) + '?')) {
    state.currentUser = null;
    state.currentUserFullname = '';
    localStorage.removeItem('ivm_username');
    localStorage.removeItem('ivm_userFullname');
    localStorage.removeItem('ivm_userRole');
    location.reload();
  }
}

// ─── PIN Entry (kept for admin fallback) ──────────────────────
function showPinEntry() {
  var section = document.getElementById('pinEntrySection');
  if (section) section.classList.remove('d-none');
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
  var err = document.getElementById('pinError');
  if (err) err.classList.add('d-none');
}

function updatePinDots() {
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById('pinDot' + i);
    if (dot) {
      if (i <= state.pinBuffer.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    }
  }
}

function verifyPin() {
  const storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
  if (state.pinBuffer === storedPin) {
    localStorage.setItem('ivm_userRole', 'warehouse');
    state.pinAttempts = 0;
    if (roleModal) roleModal.hide();
    applyRoleUI();
    showToast('Warehouse mode unlocked', 'success');
    // Force login if not logged in
    if (!state.currentUser) {
      setTimeout(showLoginModal, 300);
    } else {
      preloadWarehouseLists();
      if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
        setTimeout(() => { if (settingsModal) settingsModal.show(); }, 500);
      }
      selectModule('MRIF');
    }
  } else {
    state.pinAttempts++;
    var err = document.getElementById('pinError');
    if (err) err.classList.remove('d-none');
    clearPin();
    playErrorBuzz();
    if (state.pinAttempts >= 3) {
      showToast('Too many failed attempts. Please contact admin.', 'danger');
      state.pinAttempts = 0;
    }
  }
}

// ─── Role UI ────────────────────────────────────────────────────
function applyRoleUI() {
  const role = localStorage.getItem('ivm_userRole');
  const isProduction = (role === 'production');
  const isWarehouse = (role === 'warehouse');

  // ─── Update UI elements ──────────────────────────────────────
  var btnMRR = document.getElementById('btnMRR');
  var btnMRIF = document.getElementById('btnMRIF');
  var btnMRS = document.getElementById('btnMRS');
  if (btnMRR) btnMRR.style.display = isProduction ? 'none' : '';
  if (btnMRIF) btnMRIF.style.display = isProduction ? 'none' : '';
  if (btnMRS) btnMRS.style.display = isProduction ? 'none' : '';

  var banner = document.getElementById('productionBanner');
  if (banner) banner.classList.toggle('d-none', !isProduction);

  var dashboard = document.getElementById('warehouseDashboard');
  if (dashboard) dashboard.classList.toggle('d-none', isProduction);

  var myReqs = document.getElementById('myRequestsSection');
  if (myReqs) myReqs.classList.toggle('d-none', !isProduction);

  var picker = document.getElementById('docPickerSection');
  if (picker) picker.style.display = isProduction ? 'none' : '';

  var quickScan = document.getElementById('quickScanCard');
  if (quickScan) quickScan.style.display = isProduction ? 'none' : '';

  var whBtn = document.getElementById('whNotifBtn');
  if (whBtn) whBtn.classList.toggle('d-none', isProduction);

  // ─── Show/hide logout button ────────────────────────────────
  var logoutItem = document.getElementById('logoutNavItem');
  if (logoutItem) {
    logoutItem.style.display = (isWarehouse && state.currentUser) ? 'flex' : 'none';
  }

  // ─── Update sidebar role display ─────────────────────────────
  var sidebarRole = document.getElementById('sidebarRole');
  if (sidebarRole) {
    if (isProduction) {
      sidebarRole.textContent = 'Production Mode';
    } else {
      sidebarRole.textContent = state.currentUserFullname || 'Warehouse';
    }
  }

  // ─── Update current role display in settings ──────────────────
  var roleDisplay = document.getElementById('currentRoleDisplay');
  if (roleDisplay) {
    roleDisplay.textContent = role === 'warehouse' ? 'Warehouse Staff' : 'Production Staff';
    roleDisplay.className = role === 'warehouse' ? 'badge bg-success' : 'badge bg-primary';
  }

  // ─── Handle intervals ────────────────────────────────────────
  if (isProduction) {
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.add('d-none');
    var dash = document.getElementById('warehouseDashboard');
    if (dash) dash.classList.add('d-none');
    if (window._requestsInterval) clearInterval(window._requestsInterval);
    window._requestsInterval = setInterval(function() {
      if (!state.isLoading) loadMyRequests();
    }, 30000);
    if (window._whInterval) clearInterval(window._whInterval);
  } else {
    var dash2 = document.getElementById('warehouseDashboard');
    if (dash2) dash2.classList.remove('d-none');
    if (window._requestsInterval) clearInterval(window._requestsInterval);
    if (window._whInterval) clearInterval(window._whInterval);
    window._whInterval = setInterval(function() {
      if (!state.isLoading) loadWarehouseNotifications();
    }, 30000);
    loadWarehouseNotifications();
    updateWarehouseKPIs();
  }

  // ─── Call sidebar role handler ──────────────────────────────
  if (typeof window.applySidebarRole === 'function') {
    window.applySidebarRole(role);
  }
  
  // ─── Force navigation to correct page ──────────────────────
  if (isProduction) {
    navigateTo('myrequests');
  } else {
    navigateTo('dashboard');
  }
}

function switchRole() {
  if (settingsModal) settingsModal.hide();
  var section = document.getElementById('pinEntrySection');
  if (section) section.classList.add('d-none');
  clearPin();
  if (roleModal) roleModal.show();
}

function changePin() {
  const current = document.getElementById('currentPinInput') ? document.getElementById('currentPinInput').value : '';
  const newPin = document.getElementById('newPinInput') ? document.getElementById('newPinInput').value : '';
  const storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
  const msg = document.getElementById('pinChangeMsg');
  if (current !== storedPin) {
    if (msg) { msg.textContent = 'Current PIN is incorrect'; msg.className = 'small mt-2 text-danger'; }
    return;
  }
  if (!/^\d{4}$/.test(newPin)) {
    if (msg) { msg.textContent = 'New PIN must be exactly 4 digits'; msg.className = 'small mt-2 text-danger'; }
    return;
  }
  localStorage.setItem('ivm_warehousePin', newPin);
  if (msg) { msg.textContent = 'PIN changed successfully'; msg.className = 'small mt-2 text-success'; }
  var cur = document.getElementById('currentPinInput');
  var newP = document.getElementById('newPinInput');
  if (cur) cur.value = '';
  if (newP) newP.value = '';
}

function openSettings() {
  loadSettingsToUI();
  const role = localStorage.getItem('ivm_userRole');
  const isProduction = (role === 'production');
  var pinSection = document.getElementById('pinManagementSection');
  var syncSection = document.getElementById('syncSection');
  var sheetSection = document.getElementById('sheetIdsSection');
  var roleDisplay = document.getElementById('currentRoleDisplay');
  var versionEl = document.getElementById('appVersion');
  if (pinSection) pinSection.style.display = isProduction ? 'none' : '';
  if (syncSection) syncSection.style.display = isProduction ? 'none' : '';
  if (sheetSection) sheetSection.style.display = isProduction ? 'none' : '';
  if (roleDisplay) {
    roleDisplay.textContent = role === 'warehouse' ? 'Warehouse Staff' : 'Production Staff';
    roleDisplay.className = role === 'warehouse' ? 'badge bg-success' : 'badge bg-primary';
  }
  if (versionEl) versionEl.textContent = 'v' + APP_VERSION;
  if (settingsModal) settingsModal.show();
}

function loadSettingsToUI() {
  var mrr = document.getElementById('sheetId_MRR');
  var mrif = document.getElementById('sheetId_MRIF');
  var mrs = document.getElementById('sheetId_MRS');
  if (mrr) mrr.value = localStorage.getItem('sheetId_MRR') || '';
  if (mrif) mrif.value = localStorage.getItem('sheetId_MRIF') || '';
  if (mrs) mrs.value = localStorage.getItem('sheetId_MRS') || '';
}

function saveSettings() {
  var mrr = document.getElementById('sheetId_MRR') ? document.getElementById('sheetId_MRR').value.trim() : '';
  var mrif = document.getElementById('sheetId_MRIF') ? document.getElementById('sheetId_MRIF').value.trim() : '';
  var mrs = document.getElementById('sheetId_MRS') ? document.getElementById('sheetId_MRS').value.trim() : '';
  if (mrr) localStorage.setItem('sheetId_MRR', extractSheetId(mrr));
  if (mrif) localStorage.setItem('sheetId_MRIF', extractSheetId(mrif));
  if (mrs) localStorage.setItem('sheetId_MRS', extractSheetId(mrs));
  showToast('Settings saved!', 'success');
  if (settingsModal) settingsModal.hide();
  if (state.currentModule) selectModule(state.currentModule);
}
