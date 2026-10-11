// ============================================================
// GEMCOR ERP — Authentication & Role Management
// Standalone ERP login (no legacy dependency)
// ============================================================

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
var _authState = {
  selectedRole: null,
  isLoggingIn: false,
  attempts: 0
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Auth] Initializing...');
  
  // Check if already logged in
  var existingUser = localStorage.getItem('ivm_username');
  var existingRole = localStorage.getItem('ivm_userRole');
  
  if (existingUser && existingRole) {
    console.log('[Auth] Already logged in — redirecting...');
    redirectAfterLogin(existingRole);
    return;
  }
  
  // Clear any stale sessions
  clearSession();
  
  // Auto-focus
  setTimeout(function() {
    var input = document.getElementById('loginUsername');
    if (input && document.getElementById('loginStep').classList.contains('active')) {
      input.focus();
    }
  }, 300);
});

// ═══════════════════════════════════════════════════════════
// ROLE SELECTION
// ═══════════════════════════════════════════════════════════
function selectRole(role) {
  if (role !== 'warehouse' && role !== 'production') {
    showError('Invalid role selection');
    return;
  }
  
  _authState.selectedRole = role;
  
  // Update UI
  document.querySelectorAll('.role-card').forEach(function(el) {
    el.classList.toggle('selected', el.dataset.role === role);
  });
  
  // Update label
  var label = document.getElementById('loginRoleLabel');
  if (label) {
    label.textContent = (role === 'warehouse' ? 'Warehouse' : 'Production') + ' Login';
  }
  
  // Show form
  setTimeout(function() {
    document.getElementById('roleStep').style.display = 'none';
    var loginStep = document.getElementById('loginStep');
    loginStep.classList.add('active');
    document.getElementById('btnBack').classList.add('show');
    
    // Clear previous inputs
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginUsername').classList.remove('is-invalid');
    document.getElementById('loginPassword').classList.remove('is-invalid');
    hideError();
    
    // Focus username
    setTimeout(function() {
      document.getElementById('loginUsername').focus();
    }, 100);
  }, 150);
}

window.selectRole = selectRole;

// ═══════════════════════════════════════════════════════════
// BACK TO ROLE
// ═══════════════════════════════════════════════════════════
function backToRole() {
  _authState.selectedRole = null;
  
  document.querySelectorAll('.role-card').forEach(function(el) {
    el.classList.remove('selected');
  });
  
  document.getElementById('roleStep').style.display = 'block';
  document.getElementById('loginStep').classList.remove('active');
  document.getElementById('btnBack').classList.remove('show');
  
  // Clear inputs
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginUsername').classList.remove('is-invalid');
  document.getElementById('loginPassword').classList.remove('is-invalid');
  hideError();
}

window.backToRole = backToRole;

// ═══════════════════════════════════════════════════════════
// TOGGLE PASSWORD VISIBILITY
// ═══════════════════════════════════════════════════════════
function togglePassword() {
  var input = document.getElementById('loginPassword');
  var icon = document.getElementById('passwordToggleIcon');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'bi bi-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'bi bi-eye';
  }
}

window.togglePassword = togglePassword;

// ═══════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════
async function loginUser() {
  if (_authState.isLoggingIn) {
    console.log('[Auth] Login already in progress');
    return;
  }
  
  var username = document.getElementById('loginUsername').value.trim();
  var password = document.getElementById('loginPassword').value.trim();
  var role = _authState.selectedRole;
  
  // Validation
  if (!role) {
    showError('Please select a role first');
    return;
  }
  
  if (!username) {
    showError('Please enter your username');
    document.getElementById('loginUsername').classList.add('is-invalid');
    document.getElementById('loginUsername').focus();
    return;
  }
  
  if (!password) {
    showError('Please enter your password');
    document.getElementById('loginPassword').classList.add('is-invalid');
    document.getElementById('loginPassword').focus();
    return;
  }
  
  // Set loading state
  _authState.isLoggingIn = true;
  var btn = document.getElementById('btnLogin');
  var btnText = document.getElementById('btnLoginText');
  var originalText = btnText.textContent;
  btn.disabled = true;
  btnText.textContent = 'Signing in...';
  
  hideError();
  document.getElementById('loginUsername').classList.remove('is-invalid');
  document.getElementById('loginPassword').classList.remove('is-invalid');
  
  try {
    console.log('[Auth] Verifying user:', username, '/', role);
    
    // ═══ Query users table ═══
    var url = erpUrl('users') + 
              '?username=eq.' + encodeURIComponent(username) +
              '&password=eq.' + encodeURIComponent(password) +
              '&select=username,fullname,roles,department' +
              '&limit=1';
    
    var res = await fetch(url, {
      method: 'GET',
      headers: erpHeaders(),
      cache: 'no-store'
    });
    
    if (!res.ok) {
      throw new Error('Server error: ' + res.status);
    }
    
    var users = await res.json();
    
    // ═══ Check if user exists ═══
    if (!users || users.length === 0) {
      console.warn('[Auth] Invalid credentials for:', username);
      _authState.attempts++;
      showError('Invalid username or password. Please try again.');
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword').focus();
      return;
    }
    
    var user = users[0];
    console.log('[Auth] User found:', user.username, '| Roles:', user.roles);
    
    // ═══ Verify role permission ═══
    var userRoles = Array.isArray(user.roles) ? user.roles : ['warehouse'];
    
    if (userRoles.indexOf(role) === -1) {
      var allowedRoles = userRoles.map(function(r) {
        return r === 'warehouse' ? 'Warehouse' : 'Production';
      }).join(' and ');
      
      showError('Access denied. Your account is not authorized for <strong>' + 
                (role === 'warehouse' ? 'Warehouse' : 'Production') + 
                '</strong> mode. Allowed: <strong>' + allowedRoles + '</strong>.');
      return;
    }
    
    // ═══ Success — Save session ═══
    console.log('[Auth] ✅ Login successful');
    
    localStorage.setItem('ivm_username', user.username);
    localStorage.setItem('ivm_userFullname', user.fullname || user.username);
    localStorage.setItem('ivm_userRole', role);
    localStorage.setItem('ivm_allowedRoles', JSON.stringify(userRoles));
    
    if (user.department) {
      localStorage.setItem('ivm_userDepartment', user.department);
    }
    
    sessionStorage.setItem('ivm_justLoggedIn', '1');
    
    // Show success
    btnText.textContent = 'Success!';
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    
    // Redirect
    setTimeout(function() {
      redirectAfterLogin(role);
    }, 500);
    
  } catch(err) {
    console.error('[Auth] Login error:', err);
    
    var errorMsg = err.message || 'Unknown error';
    if (errorMsg.indexOf('Failed to fetch') !== -1) {
      showError('Cannot connect to server. Please check your internet connection.');
    } else if (errorMsg.indexOf('Server error') !== -1) {
      showError('Server is temporarily unavailable. Please try again.');
    } else {
      showError('Login failed: ' + errorMsg);
    }
    
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginPassword').focus();
    
  } finally {
    _authState.isLoggingIn = false;
    btn.disabled = false;
    btnText.textContent = originalText;
    btn.style.background = '';
  }
}

window.loginUser = loginUser;

// ═══════════════════════════════════════════════════════════
// REDIRECT AFTER LOGIN
// ═══════════════════════════════════════════════════════════
function redirectAfterLogin(role) {
  if (role === 'warehouse') {
    console.log('[Auth] Redirecting to Management Dashboard...');
    window.location.replace('management-dashboard.html');
  } else if (role === 'production') {
    console.log('[Auth] Redirecting to My Requests...');
    window.location.replace('my-requests.html');
  } else {
    console.error('[Auth] Unknown role:', role);
    clearSession();
    window.location.replace('login.html');
  }
}

// ═══════════════════════════════════════════════════════════
// ERROR MESSAGES
// ═══════════════════════════════════════════════════════════
function showError(msg) {
  var el = document.getElementById('errorMessage');
  var text = document.getElementById('errorText');
  if (el && text) {
    text.innerHTML = msg;
    el.classList.add('show');
  }
}

function hideError() {
  var el = document.getElementById('errorMessage');
  if (el) el.classList.remove('show');
}

window.showError = showError;
window.hideError = hideError;

// ═══════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════
function clearSession() {
  var keys = [
    'ivm_username',
    'ivm_userFullname',
    'ivm_userRole',
    'ivm_allowedRoles',
    'ivm_userDepartment',
    'ivm_requestorName',
    'ivm_chatUnread',
    'ivm_editReqCount'
  ];
  
  keys.forEach(function(k) {
    localStorage.removeItem(k);
  });
  
  try {
    sessionStorage.clear();
  } catch(e) {}
  
  console.log('[Auth] Session cleared');
}

window.clearSession = clearSession;

// ═══════════════════════════════════════════════════════════
// LOGOUT (for use in other pages)
// ═══════════════════════════════════════════════════════════
function erpLogout() {
  var user = localStorage.getItem('ivm_userFullname') || 'user';
  
  if (!confirm('Logout ' + user + '?')) return;
  
  clearSession();
  window.location.href = 'login.html';
}

window.erpLogout = erpLogout;

// ═══════════════════════════════════════════════════════════
// EXPORT HELPERS
// ═══════════════════════════════════════════════════════════
window.erpAuth = {
  getCurrentUser: function() {
    return {
      username: localStorage.getItem('ivm_username'),
      fullname: localStorage.getItem('ivm_userFullname'),
      role: localStorage.getItem('ivm_userRole'),
      department: localStorage.getItem('ivm_userDepartment')
    };
  },
  isLoggedIn: function() {
    return !!localStorage.getItem('ivm_username') && !!localStorage.getItem('ivm_userRole');
  },
  clearSession: clearSession,
  logout: erpLogout
};

console.log('✅ auth.js loaded (standalone ERP auth)');
