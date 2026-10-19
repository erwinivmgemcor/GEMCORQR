// ============================================================
// GEMCOR ERP — Authentication & Role Management
// v4.0 — Hashed Passwords via Supabase RPC
// ============================================================

var _authState = {
  selectedRole: null,
  isLoggingIn: false,
  attempts: 0
};

document.addEventListener('DOMContentLoaded', function() {
  console.log('[Auth] Initializing...');
  
  var existingUser = localStorage.getItem('ivm_username');
  var existingRole = localStorage.getItem('ivm_userRole');
  
  if (existingUser && existingRole) {
    console.log('[Auth] Already logged in — redirecting...');
    redirectAfterLogin(existingRole);
    return;
  }
  
  clearSession();
  
  setTimeout(function() {
    var input = document.getElementById('loginUsername');
    if (input && document.getElementById('loginStep').classList.contains('active')) {
      input.focus();
    }
  }, 300);
});

function selectRole(role) {
  if (role !== 'warehouse' && role !== 'production') {
    showError('Invalid role selection');
    return;
  }
  
  _authState.selectedRole = role;
  
  document.querySelectorAll('.role-card').forEach(function(el) {
    el.classList.toggle('selected', el.dataset.role === role);
  });
  
  var label = document.getElementById('loginRoleLabel');
  if (label) {
    label.textContent = (role === 'warehouse' ? 'Warehouse' : 'Production') + ' Login';
  }
  
  setTimeout(function() {
    document.getElementById('roleStep').style.display = 'none';
    var loginStep = document.getElementById('loginStep');
    loginStep.classList.add('active');
    document.getElementById('btnBack').classList.add('show');
    
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginUsername').classList.remove('is-invalid');
    document.getElementById('loginPassword').classList.remove('is-invalid');
    hideError();
    
    setTimeout(function() {
      document.getElementById('loginUsername').focus();
    }, 100);
  }, 150);
}

window.selectRole = selectRole;

function backToRole() {
  _authState.selectedRole = null;
  
  document.querySelectorAll('.role-card').forEach(function(el) {
    el.classList.remove('selected');
  });
  
  document.getElementById('roleStep').style.display = 'block';
  document.getElementById('loginStep').classList.remove('active');
  document.getElementById('btnBack').classList.remove('show');
  
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginUsername').classList.remove('is-invalid');
  document.getElementById('loginPassword').classList.remove('is-invalid');
  hideError();
}

window.backToRole = backToRole;

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

async function loginUser() {
  if (_authState.isLoggingIn) return;
  
  var username = document.getElementById('loginUsername').value.trim();
  var password = document.getElementById('loginPassword').value.trim();
  var role = _authState.selectedRole;
  
  if (!role) { showError('Please select a role first'); return; }
  if (!username) { showError('Please enter your username'); return; }
  if (!password) { showError('Please enter your password'); return; }
  
  _authState.isLoggingIn = true;
  var btn = document.getElementById('btnLogin');
  var btnText = document.getElementById('btnLoginText');
  var originalText = btnText.textContent;
  btn.disabled = true;
  btnText.textContent = 'Signing in...';
  
  hideError();
  
  try {
    // ═══ Tawagin ang Supabase RPC ═══
    var res = await fetch(erpUrl('rpc/verify_user'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_username: username,
        p_password: password
      }),
      cache: 'no-store'
    });
    
    if (!res.ok) throw new Error('Server error: ' + res.status);
    
    var data = await res.json();
    
    // ═══ Failed login ═══
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
      
      if (_authState.attempts >= 5) {
        btn.disabled = true;
        btnText.textContent = 'Too many attempts';
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
    
    // ═══ Role Check ═══
    var userRoles = Array.isArray(data.roles) ? data.roles : ['warehouse'];
    if (userRoles.indexOf(role) === -1) {
      showError('Access denied. Your account is not authorized for <strong>' + 
                (role === 'warehouse' ? 'Warehouse' : 'Production') + '</strong> mode.');
      return;
    }
    
    // ═══ Success ═══
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
    showError('Login failed: ' + (err.message || 'Check internet connection.'));
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

window.loginUser = loginUser;

function redirectAfterLogin(role) {
  if (role === 'warehouse') {
    window.location.replace('management-dashboard.html');
  } else if (role === 'production') {
    window.location.replace('my-requests.html');
  } else {
    clearSession();
    window.location.replace('login.html');
  }
}

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

function clearSession() {
  var keys = [
    'ivm_username', 'ivm_userFullname', 'ivm_userRole',
    'ivm_allowedRoles', 'ivm_userDepartment', 'ivm_requestorName',
    'ivm_chatUnread', 'ivm_editReqCount', 'ivm_isAdmin'
  ];
  keys.forEach(function(k) { localStorage.removeItem(k); });
  try { sessionStorage.clear(); } catch(e) {}
}

window.clearSession = clearSession;

function erpLogout() {
  var user = localStorage.getItem('ivm_userFullname') || 'user';
  if (!confirm('Logout ' + user + '?')) return;
  clearSession();
  window.location.href = 'login.html';
}

window.erpLogout = erpLogout;

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

console.log('✅ auth.js v4.0 loaded (Supabase RPC Hashed)');
