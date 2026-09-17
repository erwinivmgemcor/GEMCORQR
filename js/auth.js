// ============================================================
// AUTHENTICATION & ROLE MANAGEMENT
// Supports: warehouse-only, production-only, BOTH-role users
// Friendly error messages for network/server issues
// ============================================================

if (typeof state !== 'undefined') {
  if (state.pendingRole === undefined) state.pendingRole = null;
  if (state.allowedRoles === undefined) state.allowedRoles = null;
}

// ─── Role helpers ───
function _getAllowedRoles() {
  try {
    var raw = localStorage.getItem('ivm_allowedRoles');
    if (!raw) return null;
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch(e) { return null; }
}
function _setAllowedRoles(roles) {
  try {
    localStorage.setItem('ivm_allowedRoles', JSON.stringify(roles || []));
    state.allowedRoles = roles || [];
  } catch(e) {}
}
function _hasBothRoles() {
  var roles = _getAllowedRoles();
  return roles && roles.indexOf('warehouse') !== -1 && roles.indexOf('production') !== -1;
}

// ─── Init ───
function initRole() {
  var savedUser = localStorage.getItem('ivm_username');
  var savedFullname = localStorage.getItem('ivm_userFullname');
  var savedRole = localStorage.getItem('ivm_userRole');
  var savedRoles = _getAllowedRoles();

  if (savedUser) {
    state.currentUser = savedUser;
    state.currentUserFullname = savedFullname || savedUser;
  }
  if (savedRoles) state.allowedRoles = savedRoles;

  if (!savedRole || !savedUser) {
    if (savedRole && !savedUser) localStorage.removeItem('ivm_userRole');
    if (roleModal) roleModal.show();
    return;
  }

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

// ─── Role picker → login ───
function selectRole(role) {
  state.pendingRole = role;
  if (roleModal) roleModal.hide();
  showLoginModal(role);
}

function showLoginModal(role) {
  var loginModalEl = document.getElementById('loginModal');
  if (!loginModalEl) return;

  var titleEl = loginModalEl.querySelector('.modal-title');
  if (titleEl) {
    titleEl.innerHTML = '<i class="bi bi-shield-lock me-2"></i>' +
      (role === 'production' ? 'Production Login' : 'Warehouse Login');
  }

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

// ─── Friendly error helper ───
function _showLoginError(errorField, html) {
  if (!errorField) return;
  errorField.innerHTML = html;
  errorField.classList.remove('d-none');
}

// ─── Login ───
async function loginUser() {
  var btn = document.getElementById('loginBtn');
  return withButtonLoading(btn, async function() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value.trim();
    var errorField = document.getElementById('loginError');

    if (!username || !password) {
      _showLoginError(errorField, 'Please enter both username and password.');
      return;
    }

    var requestedRole = state.pendingRole || 'warehouse';

    try {
      var url = API_URL + '?action=verifyUser&username=' + encodeURIComponent(username) +
                '&password=' + encodeURIComponent(password) + '&_t=' + Date.now();
      var res = await fetch(url, { redirect: 'follow' });

      // Read as text first (avoids the JSON.parse throwing on HTML)
      var text = '';
      try { text = await res.text(); } catch(e) { text = ''; }

      // ─── Detect HTML / empty response (server offline or deployment issue) ───
      var trimmed = String(text || '').trim();
      if (!trimmed || trimmed.charAt(0) === '<') {
        _showLoginError(errorField,
          '<div class="d-flex gap-2">' +
            '<i class="bi bi-exclamation-triangle-fill fs-5"></i>' +
            '<div>' +
              '<strong>System is temporarily unavailable.</strong><br>' +
              '<small class="text-muted">The server did not respond correctly. ' +
              'Please try again in a moment. If the issue continues, contact your system administrator.</small>' +
            '</div>' +
          '</div>');
        return;
      }

      // ─── Parse JSON safely ───
      var data;
      try {
        data = JSON.parse(trimmed);
      } catch(e) {
        _showLoginError(errorField,
          '<div class="d-flex gap-2">' +
            '<i class="bi bi-exclamation-triangle-fill fs-5"></i>' +
            '<div>' +
              '<strong>Unexpected server response.</strong><br>' +
              '<small class="text-muted">Please try again or contact your administrator.</small>' +
            '</div>' +
          '</div>');
        return;
      }

      // ─── Invalid credentials / server error ───
      if (!data.success) {
        var msg = data.error || 'Login failed.';
        // Translate common backend errors to friendly text
        if (msg.toLowerCase().indexOf('invalid username') !== -1 ||
            msg.toLowerCase().indexOf('invalid password') !== -1 ||
            msg.toLowerCase().indexOf('invalid') !== -1) {
          _showLoginError(errorField,
            '<div class="d-flex gap-2">' +
              '<i class="bi bi-x-circle-fill fs-5"></i>' +
              '<div><strong>Incorrect username or password.</strong><br>' +
              '<small class="text-muted">Please check your credentials and try again.</small></div>' +
            '</div>');
        } else {
          _showLoginError(errorField,
            '<div class="d-flex gap-2">' +
              '<i class="bi bi-exclamation-triangle-fill fs-5"></i>' +
              '<div><strong>' + msg + '</strong></div>' +
            '</div>');
        }
        return;
      }

      // ─── Roles check ───
      var roles = data.roles || [data.role || 'warehouse'];
      roles = roles.filter(function(r) { return r === 'warehouse' || r === 'production'; });
      if (roles.length === 0) roles = ['warehouse'];

      if (roles.indexOf(requestedRole) === -1) {
        var roleLabel = requestedRole === 'production' ? 'Production' : 'Warehouse';
        var allowedLabel = roles.map(function(r) {
          return r === 'production' ? 'Production' : 'Warehouse';
        }).join(' and ');
        _showLoginError(errorField,
          '<div class="d-flex gap-2">' +
            '<i class="bi bi-shield-x fs-5"></i>' +
            '<div>' +
              '<strong>Access denied.</strong><br>' +
              '<small class="text-muted">Your account is not allowed to log in as <strong>' + roleLabel + '</strong>. ' +
              'Allowed role(s): <strong>' + allowedLabel + '</strong>.</small>' +
            '</div>' +
          '</div>');
        return;
      }

      // ─── Success → save session ───
      state.currentUser = data.username;
      state.currentUserFullname = data.fullname || data.username;
      state.userRole = requestedRole;

      localStorage.setItem('ivm_username', state.currentUser);
      localStorage.setItem('ivm_userFullname', state.currentUserFullname);
      localStorage.setItem('ivm_userRole', requestedRole);
      _setAllowedRoles(roles);

      if (requestedRole === 'production') {
        localStorage.setItem('ivm_requestorName', state.currentUserFullname);
      }

      state.pendingRole = null;

      var loginModalEl = document.getElementById('loginModal');
      if (loginModalEl) {
        var m = bootstrap.Modal.getInstance(loginModalEl);
        if (m) m.hide();
      }

      showToast('Welcome, ' + state.currentUserFullname + '!', 'success');

      applyRoleUI();

      if (requestedRole === 'warehouse') {
        preloadWarehouseLists();
        if (!localStorage.getItem('sheetId_MRIF') && !localStorage.getItem('sheetId_MRR')) {
          setTimeout(function() { if (settingsModal) settingsModal.show(); }, 500);
        }
        selectModule('MRIF');
        loadWarehouseNotifications();
        setTimeout(loadAnalytics, 500);
      } else {
        loadMyRequests();
      }

    } catch(err) {
      // Network error (offline, DNS, CORS, etc.)
      _showLoginError(errorField,
        '<div class="d-flex gap-2">' +
          '<i class="bi bi-wifi-off fs-5"></i>' +
          '<div>' +
            '<strong>Could not connect.</strong><br>' +
            '<small class="text-muted">Please check your internet connection and try again.</small>' +
          '</div>' +
        '</div>');
    }
  }, 'Signing in...');
}

// ─── Switch mode (both-role users) ───
window.switchMode = function(newRole) {
  if (newRole !== 'warehouse' && newRole !== 'production') return;
  var roles = _getAllowedRoles() || [];
  if (roles.indexOf(newRole) === -1) {
    showToast('You do not have access to ' + newRole + ' mode.', 'danger');
    return;
  }
  localStorage.setItem('ivm_userRole', newRole);
  state.userRole = newRole;

  var modeModalEl = document.getElementById('modePickerModal');
  if (modeModalEl) {
    var mm = bootstrap.Modal.getInstance(modeModalEl);
    if (mm) mm.hide();
  }

  var active = document.getElementById('activeTransactionSection');
  if (active) active.classList.add('d-none');

  applyRoleUI();
  showToast('Switched to ' + (newRole === 'warehouse' ? 'Warehouse' : 'Production') + ' mode.', 'success');
};

window.openModePicker = function() {
  if (!_hasBothRoles()) {
    if (roleModal) roleModal.show();
    return;
  }
  var el = document.getElementById('modePickerModal');
  if (!el) {
    var current = localStorage.getItem('ivm_userRole');
    switchMode(current === 'warehouse' ? 'production' : 'warehouse');
    return;
  }
  var m = bootstrap.Modal.getOrCreateInstance(el);
  m.show();
};

// ─── Logout ───
function logoutUser() {
  if (!confirm('Logout ' + (state.currentUserFullname || state.currentUser) + '?')) return;
  state.currentUser = null;
  state.currentUserFullname = '';
  state.userRole = null;
  state.pendingRole = null;
  state.allowedRoles = null;
  localStorage.removeItem('ivm_username');
  localStorage.removeItem('ivm_userFullname');
  localStorage.removeItem('ivm_userRole');
  localStorage.removeItem('ivm_requestorName');
  localStorage.removeItem('ivm_allowedRoles');
  location.reload();
}

// ─── PIN (admin fallback) ───
function showPinEntry() {
  var section = document.getElementById('pinEntrySection');
  if (section) section.classList.remove('d-none');
  clearPin();
}
function enterPinDigit(d) { if (state.pinBuffer.length < 4) { state.pinBuffer += d; updatePinDots(); } }
function backspacePin() { state.pinBuffer = state.pinBuffer.slice(0, -1); updatePinDots(); }
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
  var hasBoth = _hasBothRoles();

  var btnMRR = document.getElementById('btnMRR');
  var btnMRIF = document.getElementById('btnMRIF');
  var btnMRS = document.getElementById('btnMRS');
  if (btnMRR) btnMRR.style.display = isProduction ? 'none' : '';
  if (btnMRIF) btnMRIF.style.display = isProduction ? 'none' : '';
  if (btnMRS) btnMRS.style.display = isProduction ? 'none' : '';

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

  var switchModeNavItem = document.getElementById('switchModeNavItem');
  if (switchModeNavItem) {
    switchModeNavItem.style.display = (hasBoth && state.currentUser) ? 'flex' : 'none';
  }

  var logoutItem = document.getElementById('logoutNavItem');
  if (logoutItem) {
    logoutItem.style.display = (isWarehouse || isProduction) && state.currentUser ? 'flex' : 'none';
  }

  var sidebarRole = document.getElementById('sidebarRole');
  if (sidebarRole) {
    if (isProduction) sidebarRole.textContent = 'Production · ' + (state.currentUserFullname || state.currentUser);
    else sidebarRole.textContent = state.currentUserFullname || 'Warehouse';
  }

  var roleDisplay = document.getElementById('currentRoleDisplay');
  if (roleDisplay) {
    roleDisplay.textContent = isProduction ? 'Production Staff' : 'Warehouse Staff';
    roleDisplay.className = isProduction ? 'badge bg-primary' : 'badge bg-success';
  }

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

  if (typeof window.applySidebarRole === 'function') {
    window.applySidebarRole(role);
  }

  if (isProduction) navigateTo('myrequests');
  else navigateTo('dashboard');
}

function switchRole() {
  if (settingsModal) settingsModal.hide();
  var section = document.getElementById('pinEntrySection');
  if (section) section.classList.add('d-none');
  clearPin();
  if (_hasBothRoles()) openModePicker();
  else if (roleModal) roleModal.show();
}

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

function checkProductionName() {}
function saveProductionName() {}
