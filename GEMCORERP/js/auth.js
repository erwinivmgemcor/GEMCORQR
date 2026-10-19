// ============================================================
// GEMCOR ERP — Authentication & Role Management
// v3.0 — FIXED: Admin flags via v_users_admin view (avoid 400)
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
  
  if (!role) { showError('Please select a role first'); return; }
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
    console.log('[Auth] Verifying via RPC:', username, '/', role);
    
    var res = await fetch(erpUrl('rpc/verify_user'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_username: username,
        p_password: password
      }),
      cache: 'no-store'
    });
    
    if (!res.ok) {
      throw new Error('Server error: ' + res.status);
    }
    
    var data = await res.json();
    
    // Failed
    if (!data || !data.success) {
      _authState.attempts++;
      var errorMsg = (data && data.error) || 'Invalid credentials';
      
      if (errorMsg.toLowerCase().indexOf('deactivated') !== -1) {
        showError('Your account has been <strong>deactivated</strong>. Please contact admin.');
      } else {
        showError('Invalid username or password. Please try again.');
        document.getElementById('loginPassword').value = '';
        document.getElementById('loginPassword').focus();
      }
      
      // Lockout after 5 attempts
      if (_authState.attempts >= 5) {
        btn.disabled = true;
        btnText.textContent = 'Too many attempts — wait 30s';
        showError('Too many failed attempts. Please wait <strong>30 seconds</strong>.');
        setTimeout(function() {
          _authState.attempts = 0;
          btn.disabled = false;
          btnText.textContent = originalText;
        }, 30000);
        return;
      }
      return;
    }
    
    // Check role
    var userRoles = Array.isArray(data.roles) ? data.roles : ['warehouse'];
    
    if (userRoles.indexOf(role) === -1) {
      var allowedRoles = userRoles.map(function(r) {
        return r === 'warehouse' ? 'Warehouse' : (r === 'production' ? 'Production' : r);
      }).join(' and ');
      
      showError('Access denied. Your account is not authorized for <strong>' + 
                (role === 'warehouse' ? 'Warehouse' : 'Production') + 
                '</strong> mode. Allowed: <strong>' + allowedRoles + '</strong>.');
      return;
    }
    
    // Save session
    console.log('[Auth] ✅ Login successful for:', data.username);
    
    localStorage.setItem('ivm_username', data.username);
    localStorage.setItem('ivm_userFullname', data.fullname || data.username);
    localStorage.setItem('ivm_userRole', role);
    localStorage.setItem('ivm_allowedRoles', JSON.stringify(userRoles));
    
    if (data.is_admin === true) {
      localStorage.setItem('ivm_isAdmin', 'true');
    } else {
      localStorage.removeItem('ivm_isAdmin');
    }
    
    if (data.department) {
      localStorage.setItem('ivm_userDepartment', data.department);
    }
    
    sessionStorage.setItem('ivm_justLoggedIn', '1');
    _authState.attempts = 0;
    
    btnText.textContent = 'Success!';
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    
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
    if (_authState.attempts < 5) {
      btn.disabled = false;
      btnText.textContent = originalText;
      btn.style.background = '';
    }
  }
}
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
    'ivm_editReqCount',
    'ivm_isAdmin'                  // ✅ NEW
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
      department: localStorage.getItem('ivm_userDepartment'),
      isAdmin: localStorage.getItem('ivm_isAdmin') === 'true'
    };
  },
  isLoggedIn: function() {
    return !!localStorage.getItem('ivm_username') && !!localStorage.getItem('ivm_userRole');
  },
  isAdmin: function() {
    return localStorage.getItem('ivm_isAdmin') === 'true';
  },
  clearSession: clearSession,
  logout: erpLogout
};

console.log('✅ auth.js v3.0 loaded (view-based admin flags)');
