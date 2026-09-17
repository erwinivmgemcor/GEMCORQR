// ============================================================
// AUTHENTICATION & ROLE MANAGEMENT
// (With Production + Warehouse login — both require authentication)
// ============================================================

// Init pendingRole in state
if (typeof state !== 'undefined' && state.pendingRole === undefined) {
  state.pendingRole = null;
}

function initRole() {
  // ─── Restore saved session ───
  var savedUser = localStorage.getItem('ivm_username');
  var savedFullname = localStorage.getItem('ivm_userFullname');
  var savedRole = localStorage.getItem('ivm_userRole');

  if (savedUser) {
    state.currentUser = savedUser;
    state.currentUserFullname = savedFullname || savedUser;
  }
  if (savedRole) {
    state.userRole = savedRole;
  }

  // ─── Require BOTH role AND username ───
  if (!savedRole || !savedUser) {
    // Clean partial state
    if (savedRole && !savedUser) localStorage.removeItem('ivm_userRole');
    if (roleModal) roleModal.show();
    return;
  }

  // ─── Both present → apply UI ───
  applyRoleUI();

  if (savedRole === 'warehouse') {
    preloadWarehouseLists();
    if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
      setTimeout(function() { if (settingsModal) settingsModal.show(); }, 500);
    }
    selectModule('MRIF');
    setTimeout(loadAnalytics, 500);
    loadWarehouseNotifications();
  } else if (savedRole === 'production') {
    loadMyRequests();
  }
}

async function preloadWarehouseLists() {
  try {
    Promise.allSettled([
      loadRequestInventory(false),
      loadVendorList(false),
      loadIvmTeamList(false)
    ]).then(function() {
      var prev = state.currentModule;
      state.currentModule = 'MRIF'; fetchPendingDocs(false).catch(function() {});
      state.currentModule = 'MRR';  fetchPendingDocs(false).catch(function() {});
      state.currentModule = 'MRS';  fetchPendingDocs(false).catch(function() {});
      state.currentModule = prev;
    });
  } catch(e) {
    console.warn('[Preload] Failed:', e);
  }
}

// ─── Role selection → show login ───
function selectRole(role) {
  state.pendingRole = role;
  if (roleModal) roleModal.hide();
  showLoginModal(role);
}

// ─── Show login modal (role-specific) ───
function showLoginModal(role) {
  var loginModalEl = document.getElementById('loginModal');
  if (!loginModalEl) return;

  // Update title based on role
  var titleEl = loginModalEl.querySelector('.modal-title');
  if (titleEl) {
    titleEl.innerHTML = '<i class="bi bi-shield-lock me-2"></i>' +
      (role === 'production' ? 'Production Login' : 'Warehouse Login');
  }

  // Reset fields
  var userField = document.getElementById('loginUsername');
  var passField = document.getElementById('loginPassword');
  var errorField = document.getElementById('loginError');
  if (userField) userField.value = '';
  if (passField) passField.value = '';
  if (errorField) {
    errorField.classList.add('d-none');
    errorField.textContent = '';
  }

  var modal = bootstrap.Modal.getOrCreateInstance(loginModalEl, { backdrop: 'static', keyboard: false });
  modal.show();
  setTimeout(function() { if (userField) userField.focus(); }, 300);
}

// ─── Cancel login → return to role modal ───
function backToRoleSelection() {
  var loginModalEl = document.getElementById('loginModal');
  if (loginModalEl) {
    var m = bootstrap.Modal.getInstance(loginModalEl);
    if (m) m.hide();
  }
  state.pendingRole = null;
  setTimeout(function() {
    if (roleModal) roleModal.show();
  }, 300);
}

// ─── Actual login call ───
async function loginUser() {
  var btn = document.getElementById('loginBtn');

  return withButtonLoading(btn, async function() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value.trim();
    var errorField = document.getElementById('loginError');

    if (!username || !password) {
      if (errorField) {
        errorField.textContent = 'Please enter username and password';
        errorField.classList.remove('d-none');
      }
      return;
    }

    var requestedRole = state.pendingRole || 'warehouse';

    try {
      var url = API_URL + '?action=verifyUser&username=' + encodeURIComponent(username) +
                '&password=' + encodeURIComponent(password) + '&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });
      var data = await res.json();

      if (!data.success) {
        if (errorField) {
          errorField.textContent = data.error || 'Login failed';
          errorField.classList.remove('d-none');
        }
        return;
      }

      // ─── Role authorization check ───
      var serverRole = (data.role || 'warehouse').toLowerCase();
      if (serverRole !== requestedRole) {
        if (errorField) {
          errorField.textContent = 'This account is not authorized as ' + requestedRole +
            '. You are registered as ' + serverRole + '.';
          errorField.classList.remove('d-none');
        }
        return;
      }

      // ─── Save session ───
      state.currentUser = data.username;
      state.currentUserFullname = data.fullname || data.username;
      state.userRole = serverRole;
      state.pendingRole = null;

      localStorage.setItem('ivm_username', state.currentUser);
      localStorage.setItem('ivm_userFullname', state.currentUserFullname);
      localStorage.setItem('ivm_userRole', serverRole);

      // For production, also store requestor name
      if (serverRole === 'production') {
        localStorage.setItem('ivm_requestorName', state.currentUserFullname);
      }

      // ─── Close login modal ───
      var loginModalEl = document.getElementById('loginModal');
      if (loginModalEl) {
        var m = bootstrap.Modal.getInstance(loginModalEl);
        if (m) m.hide();
      }

      showToast('Welcome, ' + state.currentUserFullname + '!', 'success');

      // ─── Apply role UI ───
      applyRoleUI();

      if (serverRole === 'warehouse') {
        preloadWarehouseLists();
        if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
          setTimeout(function() { if (settingsModal) settingsModal.show(); }, 500);
        }
        selectModule('MRIF');
        loadWarehouseNotifications();
        setTimeout(loadAnalytics, 500);
      } else if (serverRole === 'production') {
        loadMyRequests();
      }

    } catch(err) {
      if (errorField) {
        errorField.textContent = 'Network error: ' + err.message;
        errorField.classList.remove('d-none');
      }
    }
  }, 'Signing in...');
}

// ─── Logout ───
function logoutUser() {
  if (!confirm('Logout ' + (state.currentUserFullname || state.currentUser) + '?')) return;
  state.currentUser = null;
  state.currentUserFullname = '';
  state.userRole = null;
  state.pendingRole = null;
  localStorage.removeItem('ivm_username');
  localStorage.removeItem('ivm_userFullname');
  localStorage.removeItem('ivm_userRole');
  localStorage.removeItem('ivm_requestorName');
  location.reload();
}

// ─── PIN (admin fallback — kept for compatibility) ───
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
  for (var i = 1; i <= 4; i++) {
    var dot = document.getElementById('pinDot' + i);
    if (dot) {
      if (i <= state.pinBuffer.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    }
  }
}
function verifyPin() {
  var storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
  if (state.pinBuffer === storedPin) {
    state.pinAttempts = 0;
    if (roleModal) roleModal.hide();
    showToast('PIN verified', 'success');
    selectRole('warehouse');
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

// ─── Apply role UI ───
function applyRoleUI() {
  var role = localStorage.getItem('ivm_userRole');
  var isProduction = (role === 'production');
  var isWarehouse = (role === 'warehouse');

  // Hide/show module buttons
  var btnMRR = document.getElementById('btnMRR');
  var btnMRIF = document.getElementById('btnMRIF');
  var btnMRS = document.getElementById('btnMRS');
  if (btnMRR) btnMRR.style.display = isProduction ? 'none' : '';
  if (btnMRIF) btnMRIF.style.display = isProduction ? 'none' : '';
  if (btnMRS) btnMRS.style.display = isProduction ? 'none' : '';

  // Production banner — show logged-in user
  var banner = document.getElementById('productionBanner');
  if (banner) {
    if (isProduction) {
      banner.classList.remove('d-none');
      banner.innerHTML = '<i class="bi bi-person-badge"></i>' +
        '<div class="ms-2">' +
        '<strong>Production Mode</strong><br>' +
        '<small>Logged in as ' + (state.currentUserFullname || state.currentUser) + '</small>' +
        '</div>';
    } else {
      banner.classList.add('d-none');
    }
  }

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

  // Logout button
  var logoutItem = document.getElementById('logoutNavItem');
  if (logoutItem) {
    logoutItem.style.display = (isWarehouse || isProduction) && state.currentUser ? 'flex' : 'none';
  }

  // Sidebar role display
  var sidebarRole = document.getElementById('sidebarRole');
  if (sidebarRole) {
    if (isProduction) {
      sidebarRole.textContent = 'Production · ' + (state.currentUserFullname || state.currentUser);
    } else {
      sidebarRole.textContent = state.currentUserFullname || 'Warehouse';
    }
  }

  // Current role display in Settings
  var roleDisplay = document.getElementById('currentRoleDisplay');
  if (roleDisplay) {
    roleDisplay.textContent = isProduction ? 'Production Staff' : 'Warehouse Staff';
    roleDisplay.className = isProduction ? 'badge bg-primary' : 'badge bg-success';
  }

  // Intervals
  if (isProduction) {
    var active = document.getElementById('activeTransactionSection');
    if (active) active.classList.add('d-none');
    var dash = document.getElementById('warehouseDashboard');
    if (dash) dash.classList.add('d-none');
    if (window._requestsInterval) clearInterval(window._requestsInterval);
    window._requestsInterval = setInterval(function() {
      if (!state.isLoading && typeof loadMyRequests === 'function') loadMyRequests();
    }, 30000);
    if (window._whInterval) clearInterval(window._whInterval);
  } else {
    var dash2 = document.getElementById('warehouseDashboard');
    if (dash2) dash2.classList.remove('d-none');
    if (window._requestsInterval) clearInterval(window._requestsInterval);
    if (window._whInterval) clearInterval(window._whInterval);
    window._whInterval = setInterval(function() {
      if (!state.isLoading && typeof loadWarehouseNotifications === 'function') loadWarehouseNotifications();
    }, 30000);
    if (typeof loadWarehouseNotifications === 'function') loadWarehouseNotifications();
    if (typeof updateWarehouseKPIs === 'function') updateWarehouseKPIs();
  }

  // Sidebar
  if (typeof window.applySidebarRole === 'function') {
    window.applySidebarRole(role);
  }

  // Navigate to correct page
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

// ─── PIN management ───
function changePin() {
  var current = document.getElementById('currentPinInput') ? document.getElementById('currentPinInput').value : '';
  var newPin = document.getElementById('newPinInput') ? document.getElementById('newPinInput').value : '';
  var storedPin = localStorage.getItem('ivm_warehousePin') || DEFAULT_PIN;
  var msg = document.getElementById('pinChangeMsg');
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

// ─── Settings ───
function openSettings() {
  loadSettingsToUI();
  var role = localStorage.getItem('ivm_userRole');
  var isProduction = (role === 'production');
  var pinSection = document.getElementById('pinManagementSection');
  var syncSection = document.getElementById('syncSection');
  var sheetSection = document.getElementById('sheetIdsSection');
  var roleDisplay = document.getElementById('currentRoleDisplay');
  var versionEl = document.getElementById('appVersion');
  if (pinSection) pinSection.style.display = isProduction ? 'none' : '';
  if (syncSection) syncSection.style.display = isProduction ? 'none' : '';
  if (sheetSection) sheetSection.style.display = isProduction ? 'none' : '';
  if (roleDisplay) {
    roleDisplay.textContent = isProduction ? 'Production Staff' : 'Warehouse Staff';
    roleDisplay.className = isProduction ? 'badge bg-primary' : 'badge bg-success';
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

// ─── Legacy no-ops (kept for compatibility) ───
function checkProductionName() { /* no longer used — production must login */ }
function saveProductionName() { /* no longer used */ }
