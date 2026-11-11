// ============================================================
// GEMCOR ERP — User Management (Admin Panel)
// v1.0 — Full CRUD + Audit Logging
// Access: Admin only (is_admin = true)
// ============================================================

var _um = {
  allUsers: [],
  filteredUsers: [],
  currentUser: '',
  currentFullname: '',
  searchTimer: null,
  userModal: null,
  confirmModal: null,
  auditModal: null,
  pendingAction: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[User Management v1.0] Initializing...');

  _um.currentUser = localStorage.getItem('ivm_username') || '';
  _um.currentFullname = localStorage.getItem('ivm_userFullname') || _um.currentUser;

  // Double-check admin access
  if (localStorage.getItem('ivm_isAdmin') !== 'true') {
    console.warn('[User Management] Access denied');
    window.location.replace('management-dashboard.html');
    return;
  }

  console.log('[User Management] Admin:', _um.currentUser);

  umCheckHealth();
  umLoadUsers();
});

async function umCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var result = await erpHealthCheck();
    if (result.success) {
      dot.className = 'dot dot-ok';
      text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      dot.className = 'dot dot-error';
      text.textContent = 'Offline';
    }
  } catch(err) {
    dot.className = 'dot dot-error';
    text.textContent = 'Error';
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD USERS
// ═══════════════════════════════════════════════════════════
async function umLoadUsers() {
  var tbody = document.getElementById('umTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<div class="erp-spinner"></div>' +
      '<div class="mt-2">Loading users...</div></td></tr>';
  }

  try {
    var rows = await erpFetch('v_users_admin', 'select=*');
    _um.allUsers = rows || [];
    console.log('[User Management] Loaded ' + _um.allUsers.length + ' users');

    umComputeKPIs();
    umRender();
  } catch(err) {
    console.error('[umLoadUsers]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="erp-empty text-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-2"></i>' +
        'Failed: ' + erpEsc(err.message) + '</td></tr>';
    }
  }
}

function umComputeKPIs() {
  var total = _um.allUsers.length;
  var active = 0, admins = 0, warehouse = 0, production = 0;

  _um.allUsers.forEach(function(u) {
    if (u.is_active) active++;
    if (u.is_admin) admins++;
    var roles = Array.isArray(u.roles) ? u.roles : [];
    if (roles.indexOf('warehouse') !== -1) warehouse++;
    if (roles.indexOf('production') !== -1) production++;
  });

  var el;
  el = document.getElementById('umKpiTotal'); if (el) el.textContent = umNum(total);
  el = document.getElementById('umKpiActive'); if (el) el.textContent = umNum(active);
  el = document.getElementById('umKpiAdmins'); if (el) el.textContent = umNum(admins);
  el = document.getElementById('umKpiWarehouse'); if (el) el.textContent = umNum(warehouse);
  el = document.getElementById('umKpiProduction'); if (el) el.textContent = umNum(production);
}

// ═══════════════════════════════════════════════════════════
// RENDER TABLE
// ═══════════════════════════════════════════════════════════
function umRender() {
  var tbody = document.getElementById('umTableBody');
  if (!tbody) return;

  var search = (document.getElementById('umSearchInput').value || '').toLowerCase().trim();
  var roleFilter = document.getElementById('umRoleFilter').value;
  var statusFilter = document.getElementById('umStatusFilter').value;

  _um.filteredUsers = _um.allUsers.filter(function(u) {
    // Search
    if (search) {
      var uname = String(u.username || '').toLowerCase();
      var fname = String(u.fullname || '').toLowerCase();
      var dept = String(u.department || '').toLowerCase();
      if (uname.indexOf(search) === -1 && fname.indexOf(search) === -1 && dept.indexOf(search) === -1) {
        return false;
      }
    }

    // Role filter
    if (roleFilter) {
      if (roleFilter === 'admin') {
        if (!u.is_admin) return false;
      } else {
        var roles = Array.isArray(u.roles) ? u.roles : [];
        if (roles.indexOf(roleFilter) === -1) return false;
      }
    }

    // Status filter
    if (statusFilter === 'active' && !u.is_active) return false;
    if (statusFilter === 'inactive' && u.is_active) return false;

    return true;
  });

  var total = _um.filteredUsers.length;
  var countEl = document.getElementById('umTableCount');
  if (countEl) countEl.textContent = total + ' users';

  var subtitleEl = document.getElementById('umTableSubtitle');
  if (subtitleEl) {
    if (search || roleFilter || statusFilter) {
      subtitleEl.textContent = 'Filtered results';
    } else {
      subtitleEl.textContent = 'All accounts';
    }
  }

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="erp-empty">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2"></i>' +
      'No users match your filters.</td></tr>';
    return;
  }

  var html = '';
  _um.filteredUsers.forEach(function(u, idx) {
    var roles = Array.isArray(u.roles) ? u.roles : [];
    var isSelf = (u.username === _um.currentUser);

    // Roles badges
    var rolesBadges = '';
    roles.forEach(function(r) {
      if (r === 'warehouse') rolesBadges += '<span class="role-badge role-warehouse">WH</span>';
      else if (r === 'production') rolesBadges += '<span class="role-badge role-production">PR</span>';
      else if (r === 'procurement') rolesBadges += '<span class="role-badge role-production" style="background:#dbeafe;color:#1e40af;">PC</span>';
      else if (r === 'finance') rolesBadges += '<span class="role-badge role-production" style="background:#ede9fe;color:#5b21b6;">FN</span>';
    });
    if (!rolesBadges) rolesBadges = '<span class="text-muted small">—</span>';

    // Admin badge
    var adminBadge = u.is_admin 
      ? '<span class="admin-badge"><i class="bi bi-shield-fill-check me-1"></i>ADMIN</span>'
      : '<span class="text-muted small">—</span>';

    // Status badge
    var statusBadge = u.is_active 
      ? '<span class="status-active"><i class="bi bi-check-circle-fill me-1"></i>ACTIVE</span>'
      : '<span class="status-inactive"><i class="bi bi-x-circle-fill me-1"></i>INACTIVE</span>';

    // Actions
    var safeUsername = String(u.username).replace(/'/g, "\\'");
    var actionsHtml = 
      '<button class="action-btn" onclick="umOpenEditModal(\'' + safeUsername + '\')" title="Edit">' +
        '<i class="bi bi-pencil-square"></i>' +
      '</button>' +
      '<button class="action-btn" onclick="umOpenAuditModal(\'' + safeUsername + '\')" title="Audit Log">' +
        '<i class="bi bi-clock-history"></i>' +
      '</button>';

    if (!isSelf) {
      if (u.is_active) {
        actionsHtml += 
          '<button class="action-btn danger" onclick="umAskDeactivate(\'' + safeUsername + '\')" title="Deactivate">' +
            '<i class="bi bi-person-x-fill"></i>' +
          '</button>';
      } else {
        actionsHtml += 
          '<button class="action-btn success" onclick="umAskReactivate(\'' + safeUsername + '\')" title="Reactivate">' +
            '<i class="bi bi-person-check-fill"></i>' +
          '</button>';
      }
    } else {
      actionsHtml += '<span class="text-muted small" style="padding:0 8px;">(You)</span>';
    }

    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><code>' + erpEsc(u.username) + '</code></td>' +
      '<td><strong>' + erpEsc(u.fullname) + '</strong></td>' +
      '<td>' + erpEsc(u.department || '—') + '</td>' +
      '<td class="text-center">' + rolesBadges + '</td>' +
      '<td class="text-center">' + adminBadge + '</td>' +
      '<td class="text-center">' + statusBadge + '</td>' +
      '<td class="text-center">' + actionsHtml + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// SEARCH / FILTERS
// ═══════════════════════════════════════════════════════════
function umOnSearch() {
  clearTimeout(_um.searchTimer);
  _um.searchTimer = setTimeout(umRender, 300);
}

function umClearFilters() {
  document.getElementById('umSearchInput').value = '';
  document.getElementById('umRoleFilter').value = '';
  document.getElementById('umStatusFilter').value = '';
  umRender();
}

// ═══════════════════════════════════════════════════════════
// ADD USER MODAL
// ═══════════════════════════════════════════════════════════
function umOpenAddModal() {
  document.getElementById('umEditMode').value = 'add';
  document.getElementById('umModalTitle').textContent = 'Add New User';
  document.getElementById('umSaveBtnText').textContent = 'Create User';

  document.getElementById('umUsername').value = '';
  document.getElementById('umUsername').readOnly = false;
  document.getElementById('umPassword').value = '';
  document.getElementById('umPassword').placeholder = 'e.g. 12345';
  document.getElementById('umFullname').value = '';
  document.getElementById('umDepartment').value = '';
  document.getElementById('umRoleWarehouse').checked = true;
  document.getElementById('umRoleProduction').checked = false;
  document.getElementById('umRoleProcurement').checked = false;
  document.getElementById('umRoleFinance').checked = false;
  document.getElementById('umIsAdmin').checked = false;
  document.getElementById('umOriginalUsername').value = '';
  document.getElementById('umReason').value = '';
  document.getElementById('umReasonRow').style.display = 'none';
  document.getElementById('umUsernameHint').textContent = 'Uppercase letters, no spaces';

  if (!_um.userModal) {
    _um.userModal = new bootstrap.Modal(document.getElementById('umUserModal'), { backdrop: 'static' });
  }
  _um.userModal.show();
}

// ═══════════════════════════════════════════════════════════
// EDIT USER MODAL
// ═══════════════════════════════════════════════════════════
async function umOpenEditModal(username) {
  var user = _um.allUsers.find(function(u) { return u.username === username; });
  if (!user) {
    erpShowToast('User not found', 'warning');
    return;
  }

  document.getElementById('umEditMode').value = 'edit';
  document.getElementById('umModalTitle').textContent = 'Edit User';
  document.getElementById('umSaveBtnText').textContent = 'Save Changes';

  document.getElementById('umUsername').value = user.username;
  document.getElementById('umUsername').readOnly = true;
  // Passwords are hashed — never shown. Leave blank to keep the current one.
  document.getElementById('umPassword').value = '';
  document.getElementById('umPassword').placeholder = 'Leave blank to keep current password';
  document.getElementById('umFullname').value = user.fullname || '';
  document.getElementById('umDepartment').value = user.department || '';

  var roles = Array.isArray(user.roles) ? user.roles : [];
  document.getElementById('umRoleWarehouse').checked = roles.indexOf('warehouse') !== -1;
  document.getElementById('umRoleProduction').checked = roles.indexOf('production') !== -1;
  document.getElementById('umRoleProcurement').checked = roles.indexOf('procurement') !== -1;
  document.getElementById('umRoleFinance').checked = roles.indexOf('finance') !== -1;
  document.getElementById('umIsAdmin').checked = !!user.is_admin;

  document.getElementById('umOriginalUsername').value = user.username;
  document.getElementById('umReason').value = '';
  document.getElementById('umReasonRow').style.display = 'block';
  document.getElementById('umUsernameHint').textContent = 'Username cannot be changed';

  if (!_um.userModal) {
    _um.userModal = new bootstrap.Modal(document.getElementById('umUserModal'), { backdrop: 'static' });
  }
  _um.userModal.show();
}

function umCloseModal() {
  if (_um.userModal) _um.userModal.hide();
}

window.umOpenAddModal = umOpenAddModal;
window.umOpenEditModal = umOpenEditModal;
window.umCloseModal = umCloseModal;

// ═══════════════════════════════════════════════════════════
// GENERATE PASSWORD
// ═══════════════════════════════════════════════════════════
function umGeneratePassword() {
  var num = Math.floor(10000 + Math.random() * 90000);
  document.getElementById('umPassword').value = 'GEM' + num;
  erpShowToast('Password generated: GEM' + num, 'info');
}
window.umGeneratePassword = umGeneratePassword;

// ═══════════════════════════════════════════════════════════
// ADMIN RE-VERIFICATION (kailangan ng admin password sa bawat user-management RPC)
// ═══════════════════════════════════════════════════════════
var _umAdminPw = { value: '', expires: 0 };   // memory lang, 3 minuto, hindi sine-save sa storage

function umAskAdminPassword(message) {
  return new Promise(function(resolve) {
    var old = document.getElementById('umAdminAuthModal');
    if (old) old.remove();

    var el = document.createElement('div');
    el.className = 'modal fade';
    el.id = 'umAdminAuthModal';
    el.tabIndex = -1;
    el.innerHTML =
      '<div class="modal-dialog modal-dialog-centered modal-sm"><div class="modal-content">' +
        '<div class="modal-header"><h6 class="modal-title"><i class="bi bi-shield-lock me-2"></i>Confirm Admin Password</h6>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body">' +
          '<div class="small text-muted mb-2" id="umAdminAuthMsg"></div>' +
          '<input type="password" class="form-control" id="umAdminAuthInput" autocomplete="current-password" placeholder="Your password">' +
          '<div class="text-danger small mt-2 d-none" id="umAdminAuthErr">Password is required</div>' +
        '</div>' +
        '<div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="umAdminAuthOk">Confirm</button></div>' +
      '</div></div>';
    document.body.appendChild(el);
    el.querySelector('#umAdminAuthMsg').textContent =
      message || 'Ilagay ang password ng admin account mo para ituloy.';

    var input = el.querySelector('#umAdminAuthInput');
    var modal = new bootstrap.Modal(el, { backdrop: 'static' });
    var done = false;

    function finish(v) {
      if (done) return;
      done = true;
      modal.hide();
      resolve(v);
    }
    function submit() {
      if (!input.value) { el.querySelector('#umAdminAuthErr').classList.remove('d-none'); return; }
      finish(input.value);
    }
    el.querySelector('#umAdminAuthOk').addEventListener('click', submit);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') submit(); });
    el.addEventListener('shown.bs.modal', function() { input.focus(); });
    el.addEventListener('hidden.bs.modal', function() {
      if (!done) { done = true; resolve(null); }
      el.remove();
    });
    modal.show();
  });
}

// Tumatawag ng admin RPC na may kasamang credentials ng current admin.
async function umAdminRpc(rpcName, body, promptMsg) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var pw = (_umAdminPw.value && Date.now() < _umAdminPw.expires) ? _umAdminPw.value : null;
    if (!pw) {
      pw = await umAskAdminPassword(attempt ? 'Mali ang password. Subukan ulit.' : promptMsg);
      if (!pw) throw new Error('Cancelled — admin password required');
    }

    var payload = Object.assign({ p_admin_username: _um.currentUser, p_admin_password: pw }, body);
    var res = await fetch(erpUrl('rpc/' + rpcName), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      var t = await res.text();
      throw new Error('HTTP ' + res.status + ' ' + t);
    }

    var data = await res.json();
    if (data && data.error === 'ADMIN_AUTH_FAILED') {
      _umAdminPw = { value: '', expires: 0 };
      continue;
    }
    _umAdminPw = { value: pw, expires: Date.now() + 3 * 60 * 1000 };
    return data;
  }
  throw new Error('Admin verification failed');
}

// ═══════════════════════════════════════════════════════════
// SAVE USER (Create or Update)
// ═══════════════════════════════════════════════════════════
async function umSaveUser() {
  var mode = document.getElementById('umEditMode').value;
  var username = document.getElementById('umUsername').value.trim().toUpperCase();
  var password = document.getElementById('umPassword').value.trim();
  if (password === 'HASHED_NO_LONGER_USED') password = '';
  var fullname = document.getElementById('umFullname').value.trim();
  var department = document.getElementById('umDepartment').value.trim();
  var roleWarehouse = document.getElementById('umRoleWarehouse').checked;
  var roleProduction = document.getElementById('umRoleProduction').checked;
  var roleProcurement = document.getElementById('umRoleProcurement').checked;
  var roleFinance = document.getElementById('umRoleFinance').checked;
  var isAdmin = document.getElementById('umIsAdmin').checked;
  var reason = document.getElementById('umReason').value.trim();
  var originalUsername = document.getElementById('umOriginalUsername').value;

  if (!username) { erpShowToast('Username is required', 'warning'); return; }
  if (mode === 'add' && !password) { erpShowToast('Password is required for new user', 'warning'); return; }
  if (!fullname) { erpShowToast('Full name is required', 'warning'); return; }
  if (!roleWarehouse && !roleProduction && !roleProcurement && !roleFinance) {
    erpShowToast('Select at least one role', 'warning'); return;
  }
  if (mode === 'edit' && !reason) {
    erpShowToast('Reason is required for changes', 'warning'); return;
  }

  var roles = [];
  if (roleWarehouse) roles.push('warehouse');
  if (roleProduction) roles.push('production');
  if (roleProcurement) roles.push('procurement');
  if (roleFinance) roles.push('finance');

  if (mode === 'add') {
    var existing = _um.allUsers.find(function(u) { return u.username === username; });
    if (existing) {
      erpShowToast('Username already exists: ' + username, 'danger');
      return;
    }
  }

  var btn = document.getElementById('umSaveBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';

  try {
    var data = await umAdminRpc('admin_upsert_user', {
      p_mode: mode,
      p_username: username,
      p_password: password || null,
      p_fullname: fullname,
      p_department: department || null,
      p_roles: roles,
      p_is_admin: isAdmin,
      p_original_username: mode === 'edit' ? originalUsername : null
    }, 'Kumpirmahin gamit ang admin password mo para i-save ang user.');
    if (!data || !data.success) throw new Error((data && data.error) || 'Unknown error');

    var actionType = mode === 'add' ? 'CREATED' 
                   : (data.password_changed ? 'PASSWORD_RESET' : 'UPDATED');

    await umLogAction(
      mode === 'add' ? username : originalUsername,
      actionType,
      null,
      { fullname: fullname, roles: roles, is_admin: isAdmin },
      reason || (mode === 'add' ? 'New user created' : 'User updated')
    );

    erpShowToast('✅ User ' + (mode === 'add' ? 'created' : 'updated') + ': ' + username, 'success');
    umCloseModal();
    await umLoadUsers();

  } catch(err) {
    console.error('[umSaveUser]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}
// ═══════════════════════════════════════════════════════════
// DEACTIVATE / REACTIVATE
// ═══════════════════════════════════════════════════════════
function umAskDeactivate(username) {
  if (username === _um.currentUser) {
    erpShowToast('Cannot deactivate your own account', 'warning');
    return;
  }
  _um.pendingAction = { type: 'deactivate', username: username };
  document.getElementById('umConfirmTitle').textContent = 'Deactivate User';
  document.getElementById('umConfirmMessage').innerHTML = 
    'Deactivate user <strong>' + erpEsc(username) + '</strong>?<br>' +
    '<small class="text-muted">User will not be able to log in until reactivated.</small>';
  document.getElementById('umConfirmReason').value = '';
  document.getElementById('umConfirmBtn').className = 'btn btn-danger';
  document.getElementById('umConfirmBtn').textContent = 'Deactivate';

  if (!_um.confirmModal) {
    _um.confirmModal = new bootstrap.Modal(document.getElementById('umConfirmModal'));
  }
  _um.confirmModal.show();
}

function umAskReactivate(username) {
  _um.pendingAction = { type: 'reactivate', username: username };
  document.getElementById('umConfirmTitle').textContent = 'Reactivate User';
  document.getElementById('umConfirmMessage').innerHTML = 
    'Reactivate user <strong>' + erpEsc(username) + '</strong>?<br>' +
    '<small class="text-muted">User will be able to log in again.</small>';
  document.getElementById('umConfirmReason').value = '';
  document.getElementById('umConfirmBtn').className = 'btn btn-success';
  document.getElementById('umConfirmBtn').textContent = 'Reactivate';

  if (!_um.confirmModal) {
    _um.confirmModal = new bootstrap.Modal(document.getElementById('umConfirmModal'));
  }
  _um.confirmModal.show();
}

window.umAskDeactivate = umAskDeactivate;
window.umAskReactivate = umAskReactivate;

// Confirm button sa confirm modal
document.addEventListener('DOMContentLoaded', function() {
  var confirmBtn = document.getElementById('umConfirmBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', umConfirmAction);
  }
});

async function umConfirmAction() {
  if (!_um.pendingAction) return;

  var action = _um.pendingAction;
  var reason = document.getElementById('umConfirmReason').value.trim();

  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    return;
  }

  var btn = document.getElementById('umConfirmBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Processing...';

  try {
    var newStatus = (action.type === 'deactivate') ? false : true;
    var actionType = (action.type === 'deactivate') ? 'DEACTIVATED' : 'REACTIVATED';

    var rpcOut = await umAdminRpc('admin_set_user_active', {
      p_username: action.username,
      p_active: newStatus
    }, 'Kumpirmahin gamit ang admin password mo.');
    if (!rpcOut || rpcOut.success !== true) throw new Error('User not found: ' + action.username);

    await umLogAction(action.username, actionType, null, { is_active: newStatus }, reason);

    _um.confirmModal.hide();
    erpShowToast('✅ ' + action.username + ' ' + actionType.toLowerCase(), 'success');

    await umLoadUsers();
  } catch(err) {
    console.error('[umConfirmAction]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    _um.pendingAction = null;
  }
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════
async function umOpenAuditModal(username) {
  document.getElementById('umAuditTarget').textContent = username;
  document.getElementById('umAuditContent').innerHTML = 
    '<div class="erp-empty"><div class="erp-spinner"></div><div class="mt-2">Loading audit log...</div></div>';

  if (!_um.auditModal) {
    _um.auditModal = new bootstrap.Modal(document.getElementById('umAuditModal'));
  }
  _um.auditModal.show();

  try {
    var rows = await erpFetch('user_audit_log',
      'select=*&target_username=eq.' + encodeURIComponent(username) +
      '&order=created_at.desc&limit=200');

    umRenderAuditLog(rows || []);
  } catch(err) {
    document.getElementById('umAuditContent').innerHTML = 
      '<div class="alert alert-danger">Failed: ' + erpEsc(err.message) + '</div>';
  }
}

window.umOpenAuditModal = umOpenAuditModal;

function umRenderAuditLog(rows) {
  var container = document.getElementById('umAuditContent');
  if (!container) return;

  if (rows.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-4">' +
      '<i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>' +
      'No audit log entries yet.</div>';
    return;
  }

  var html = '<div class="table-responsive"><table class="erp-table" style="font-size:0.82rem;">' +
    '<thead><tr>' +
      '<th style="width:5%">#</th>' +
      '<th style="width:15%">Date</th>' +
      '<th style="width:12%">Action</th>' +
      '<th style="width:15%">Performed By</th>' +
      '<th style="width:23%">Changes</th>' +
      '<th style="width:30%">Reason</th>' +
    '</tr></thead><tbody>';

  rows.forEach(function(r, idx) {
    var dateStr = r.created_at ? new Date(r.created_at).toLocaleString() : '—';
    var actionClass = 'audit-updated';
    var actionUpper = String(r.action || '').toUpperCase();
    if (actionUpper === 'CREATED') actionClass = 'audit-created';
    else if (actionUpper === 'PASSWORD_RESET') actionClass = 'audit-password';
    else if (actionUpper === 'DEACTIVATED') actionClass = 'audit-deactivated';
    else if (actionUpper === 'REACTIVATED') actionClass = 'audit-reactivated';
    else if (actionUpper === 'PROMOTED') actionClass = 'audit-promoted';
    else if (actionUpper === 'DEMOTED') actionClass = 'audit-demoted';

    // Compute changes summary
    var changesHtml = '—';
    if (r.old_data && r.new_data) {
      var diffs = [];
      var keys = Object.keys(r.new_data || {});
      keys.forEach(function(k) {
        var oldV = r.old_data[k];
        var newV = r.new_data[k];
        if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
          diffs.push('<strong>' + erpEsc(k) + ':</strong> ' + erpEsc(JSON.stringify(oldV)) + ' → ' + erpEsc(JSON.stringify(newV)));
        }
      });
      if (diffs.length > 0) changesHtml = diffs.join('<br>');
    } else if (r.new_data) {
      changesHtml = '<em>' + erpEsc(JSON.stringify(r.new_data).substring(0, 100)) + '</em>';
    }

    html += '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td style="font-size:0.78rem;">' + erpEsc(dateStr) + '</td>' +
      '<td><span class="audit-action ' + actionClass + '">' + erpEsc(actionUpper) + '</span></td>' +
      '<td>' + erpEsc(r.performed_by_fullname || r.performed_by || '—') + '</td>' +
      '<td style="font-size:0.78rem;">' + changesHtml + '</td>' +
      '<td>' + erpEsc(r.reason || '—') + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOG WRITER
// ═══════════════════════════════════════════════════════════
async function umLogAction(targetUsername, action, oldData, newData, reason) {
  try {
    await fetch(erpUrl('user_audit_log'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify({
        target_username: targetUsername,
        action: action,
        performed_by: _um.currentUser,
        performed_by_fullname: _um.currentFullname,
        old_data: oldData,
        new_data: newData,
        reason: reason
      })
    });
  } catch(e) {
    console.warn('[umLogAction] Failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════════════
function umRefresh() {
  erpShowToast('Refreshing...', 'info');
  umLoadUsers();
  umCheckHealth();
}

window.umRefresh = umRefresh;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function umNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US');
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

console.log('✅ admin-users.js v1.0 loaded');
