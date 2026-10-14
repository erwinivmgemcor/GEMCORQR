// ============================================================
// GEMCOR ERP — Supabase Admin Console
// v1.1 — Phase 1 + Phase 2 + Backup Table Filter
// ============================================================

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
var _asc = {
  currentUser: '',
  currentFullname: '',
  accessMode: 'write',
  adminPin: '9999',
  pinVerified: false,
  
  allTables: [],
  tableStats: [],
  tableCategories: {},
  
  currentTable: '',
  currentData: [],
  currentColumns: [],
  currentPage: 1,
  pageSize: 50,
  totalRows: 0,
  searchTerm: '',
  
  searchTimer: null,
  refreshTimer: null,
  
  settingsModal: null,
  pinPromptModal: null,
  rowDetailsModal: null,
  editRowModal: null,
  auditDetailModal: null,
  deleteModal: null,
  
  pendingPinAction: null,
  pendingDeleteInfo: null
};

// ═══════════════════════════════════════════════════════════
// TABLE CATEGORIZATION (🟢 🟡 🔴 ⚫)
// ═══════════════════════════════════════════════════════════
var ASC_TABLE_CATEGORIES = {
  green: [
    'erp_items', 'vendors', 'requestors',
    'erp_sof_cache', 'erp_prf_po_cache',
    'erp_item_usage', 'erp_v_reorder_list'
  ],
  yellow: [
    'documents', 'prf_documents', 'users',
    'erp_stock_ledger', 'messages', 'edit_requests',
    'erp_inventory_counts'
  ],
  red: [
    'doc_items', 'prf_items',
    'user_audit_log', 'erp_manual_edits_audit',
    'admin_audit_log',
    'erp_inventory_count_items', 'erp_inventory_count_logs',
    'erp_revision_audit', 'prf_revision_audit',
    'erp_alerts'
  ]
};

// ✅ Backup/snapshot table patterns
var ASC_BACKUP_PATTERNS = [
  /^_backup_/i,
  /^_reset_/i,
  /^_security_/i,
  /_backup_\d{8}/i,
  /_archive$/i,
  /^temp_/i,
  /_staging_/i
];

function ascIsBackupTable(tableName) {
  if (!tableName) return false;
  for (var i = 0; i < ASC_BACKUP_PATTERNS.length; i++) {
    if (ASC_BACKUP_PATTERNS[i].test(tableName)) return true;
  }
  return false;
}

window.ascIsBackupTable = ascIsBackupTable;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Admin Console v1.1] Initializing...');
  
  // ✅ Load backup visibility preference
  try {
    var savedShowBackups = localStorage.getItem('ivm_admin_showBackups');
    var toggleEl = document.getElementById('ascShowBackupTables');
    if (toggleEl && savedShowBackups === '1') {
      toggleEl.checked = true;
    }
  } catch(e) {}
  
  _asc.currentUser = localStorage.getItem('ivm_username') || '';
  _asc.currentFullname = localStorage.getItem('ivm_userFullname') || _asc.currentUser;
  
  if (localStorage.getItem('ivm_isAdmin') !== 'true') {
    console.warn('[Admin Console] Access denied');
    window.location.replace('management-dashboard.html');
    return;
  }
  
  ascLoadSettings();
  ascInitTableCategories();
  ascCheckHealth();
  ascLoadDashboard();
  
  _asc.settingsModal = new bootstrap.Modal(document.getElementById('ascSettingsModal'));
  _asc.pinPromptModal = new bootstrap.Modal(document.getElementById('ascPinPromptModal'));
  _asc.rowDetailsModal = new bootstrap.Modal(document.getElementById('ascRowDetailsModal'));
  
  if (_asc.adminPin === '9999') {
    setTimeout(function() {
      if (confirm('🔐 Security Reminder:\n\nNaka-default pa ang Admin PIN (9999).\nGusto mo bang palitan na ngayon?')) {
        ascOpenSettings();
      }
    }, 2000);
  }
  
  ascApplyModeIndicator();
  
  console.log('[Admin Console] ✅ Ready. Mode:', _asc.accessMode);
});

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function ascLoadSettings() {
  try {
    var savedMode = localStorage.getItem('ivm_admin_accessMode');
    if (savedMode && ['readonly', 'write', 'full'].indexOf(savedMode) !== -1) {
      _asc.accessMode = savedMode;
    }
    
    var savedPin = localStorage.getItem('ivm_adminPin');
    if (savedPin && /^\d{4}$/.test(savedPin)) {
      _asc.adminPin = savedPin;
    } else {
      _asc.adminPin = '9999';
      localStorage.setItem('ivm_adminPin', '9999');
    }
  } catch(e) {
    console.warn('[Admin Console] Settings load failed:', e);
  }
}

function ascSaveSettings() {
  try {
    localStorage.setItem('ivm_admin_accessMode', _asc.accessMode);
    localStorage.setItem('ivm_adminPin', _asc.adminPin);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// ACCESS MODE
// ═══════════════════════════════════════════════════════════
function ascSetMode(newMode) {
  if (['readonly', 'write', 'full'].indexOf(newMode) === -1) return;
  
  if (newMode === 'full') {
    ascRequestPin('Enable FULL ACCESS mode (Raw SQL + Hard Delete)', function() {
      _asc.accessMode = newMode;
      ascSaveSettings();
      ascApplyModeIndicator();
      ascUpdateUIForMode();
      erpShowToast('✅ Full Access mode enabled', 'success');
    });
    return;
  }
  
  _asc.accessMode = newMode;
  ascSaveSettings();
  ascApplyModeIndicator();
  ascUpdateUIForMode();
  
  var labels = {
    readonly: '🔒 Read-Only mode',
    write: '✏️ Read + Write mode',
    full: '🔓 Full Access mode'
  };
  erpShowToast(labels[newMode] || 'Mode changed', 'info');
}

window.ascSetMode = ascSetMode;

function ascApplyModeIndicator() {
  var indicator = document.getElementById('adminModeIndicator');
  var text = document.getElementById('adminModeText');
  if (!indicator || !text) return;
  
  indicator.className = 'admin-mode-indicator ' + _asc.accessMode;
  
  var labels = { readonly: 'Read-Only', write: 'Read + Write', full: 'Full Access' };
  text.textContent = labels[_asc.accessMode] || _asc.accessMode;
  
  var banner = document.getElementById('ascModeBanner');
  var icon = document.getElementById('ascModeIcon');
  var title = document.getElementById('ascModeTitle');
  var desc = document.getElementById('ascModeDesc');
  
  if (banner) banner.className = 'asc-mode-banner ' + _asc.accessMode;
  
  if (_asc.accessMode === 'readonly') {
    if (icon) icon.innerHTML = '<i class="bi bi-eye-fill"></i>';
    if (title) title.textContent = 'Read-Only Mode';
    if (desc) desc.textContent = 'Safe browsing only. Walang write access. Perfect para sa pag-view lang.';
  } else if (_asc.accessMode === 'write') {
    if (icon) icon.innerHTML = '<i class="bi bi-pencil-fill"></i>';
    if (title) title.textContent = 'Read + Write Mode';
    if (desc) desc.textContent = 'Insert, Update, at Soft Delete allowed. Hindi kasama Raw SQL at Hard Delete.';
  } else if (_asc.accessMode === 'full') {
    if (icon) icon.innerHTML = '<i class="bi bi-shield-fill-x"></i>';
    if (title) title.textContent = '⚠️ FULL ACCESS MODE';
    if (desc) desc.textContent = 'Lahat kasama Raw SQL at Hard Delete. Naka-log lahat ng actions.';
  }
}

function ascUpdateUIForMode() {
  var isReadOnly = (_asc.accessMode === 'readonly');
  var isFull = (_asc.accessMode === 'full');
  
  var insertBtn = document.getElementById('ascInsertBtn');
  if (insertBtn) {
    insertBtn.disabled = isReadOnly;
    insertBtn.title = isReadOnly ? 'Hindi available sa Read-Only mode' : '';
  }
  
  var sqlLockBadge = document.getElementById('sqlLockBadge');
  if (sqlLockBadge) sqlLockBadge.style.display = isFull ? 'none' : 'inline-block';
  
  var sqlInput = document.getElementById('ascSqlInput');
  var runSqlBtn = document.getElementById('ascRunSqlBtn');
  var unlockSqlBtn = document.getElementById('ascUnlockSqlBtn');
  var sqlLocked = document.getElementById('ascSqlLocked');
  
  if (sqlInput) sqlInput.disabled = true;
  if (runSqlBtn) runSqlBtn.disabled = true;
  if (unlockSqlBtn) unlockSqlBtn.style.display = isFull ? 'inline-block' : 'none';
  if (sqlLocked) sqlLocked.style.display = _asc.pinVerified ? 'none' : 'inline-block';
}

// ═══════════════════════════════════════════════════════════
// PIN PROMPT
// ═══════════════════════════════════════════════════════════
function ascRequestPin(reason, onSuccess) {
  _asc.pendingPinAction = onSuccess;
  
  var reasonEl = document.getElementById('ascPinPromptReason');
  if (reasonEl) reasonEl.textContent = reason || 'Enter Admin PIN para ma-access ito.';
  
  var inputEl = document.getElementById('ascPinPromptInput');
  if (inputEl) inputEl.value = '';
  
  var errEl = document.getElementById('ascPinPromptError');
  if (errEl) errEl.style.display = 'none';
  
  if (_asc.pinPromptModal) _asc.pinPromptModal.show();
  
  setTimeout(function() {
    if (inputEl) inputEl.focus();
  }, 300);
}

window.ascRequestPin = ascRequestPin;

function ascSubmitPinPrompt() {
  var inputEl = document.getElementById('ascPinPromptInput');
  var errEl = document.getElementById('ascPinPromptError');
  var input = inputEl ? inputEl.value.trim() : '';
  
  if (input === _asc.adminPin) {
    _asc.pinVerified = true;
    if (_asc.pinPromptModal) _asc.pinPromptModal.hide();
    
    var callback = _asc.pendingPinAction;
    _asc.pendingPinAction = null;
    
    if (typeof callback === 'function') callback();
    return;
  }
  
  if (errEl) {
    errEl.textContent = '❌ Incorrect PIN. Try again.';
    errEl.style.display = 'block';
  }
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
}

window.ascSubmitPinPrompt = ascSubmitPinPrompt;

function ascClosePinPrompt() {
  if (_asc.pinPromptModal) _asc.pinPromptModal.hide();
  _asc.pendingPinAction = null;
}

window.ascClosePinPrompt = ascClosePinPrompt;

// ═══════════════════════════════════════════════════════════
// OPEN SETTINGS
// ═══════════════════════════════════════════════════════════
function ascOpenSettings() {
  document.querySelectorAll('input[name="ascMode"]').forEach(function(radio) {
    radio.checked = (radio.value === _asc.accessMode);
  });
  
  var curPin = document.getElementById('ascPinCurrent');
  var newPin = document.getElementById('ascPinNew');
  var msg = document.getElementById('ascPinMsg');
  if (curPin) curPin.value = '';
  if (newPin) newPin.value = '';
  if (msg) msg.textContent = '';
  
  if (_asc.settingsModal) _asc.settingsModal.show();
}

window.ascOpenSettings = ascOpenSettings;

// ═══════════════════════════════════════════════════════════
// CHANGE PIN
// ═══════════════════════════════════════════════════════════
function ascChangePin() {
  var curEl = document.getElementById('ascPinCurrent');
  var newEl = document.getElementById('ascPinNew');
  var msg = document.getElementById('ascPinMsg');
  
  var current = curEl ? curEl.value.trim() : '';
  var newPin = newEl ? newEl.value.trim() : '';
  
  if (current !== _asc.adminPin) {
    if (msg) {
      msg.textContent = '❌ Current PIN is incorrect.';
      msg.className = 'small mt-2 text-danger';
    }
    return;
  }
  
  if (!/^\d{4}$/.test(newPin)) {
    if (msg) {
      msg.textContent = '❌ New PIN must be exactly 4 digits.';
      msg.className = 'small mt-2 text-danger';
    }
    return;
  }
  
  if (newPin === '9999') {
    if (msg) {
      msg.textContent = '⚠️ Cannot use default PIN. Choose a different one.';
      msg.className = 'small mt-2 text-warning';
    }
    return;
  }
  
  _asc.adminPin = newPin;
  ascSaveSettings();
  
  if (msg) {
    msg.textContent = '✅ PIN changed successfully!';
    msg.className = 'small mt-2 text-success';
  }
  if (curEl) curEl.value = '';
  if (newEl) newEl.value = '';
  
  erpShowToast('✅ Admin PIN updated', 'success');
  ascLogAction('PIN_CHANGED', 'system', null, null, null, 'Admin PIN changed');
}

window.ascChangePin = ascChangePin;

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function ascCheckHealth() {
  try {
    var result = await erpHealthCheck();
    var badge = document.getElementById('erpHealthBadge');
    if (!badge) return;
    
    var text = document.getElementById('erpHealthText');
    var dot = badge.querySelector('.dot');
    
    if (result.success) {
      if (dot) dot.className = 'dot dot-ok';
      if (text) text.textContent = 'Connected (' + result.latency + 'ms)';
    } else {
      if (dot) dot.className = 'dot dot-error';
      if (text) text.textContent = 'Offline';
    }
  } catch(err) {}
}

// ═══════════════════════════════════════════════════════════
// TABLE CATEGORIES
// ═══════════════════════════════════════════════════════════
function ascInitTableCategories() {
  _asc.tableCategories = {};
  
  ASC_TABLE_CATEGORIES.green.forEach(function(t) { _asc.tableCategories[t] = 'green'; });
  ASC_TABLE_CATEGORIES.yellow.forEach(function(t) { _asc.tableCategories[t] = 'yellow'; });
  ASC_TABLE_CATEGORIES.red.forEach(function(t) { _asc.tableCategories[t] = 'red'; });
}

function ascGetTableCategory(tableName) {
  if (ascIsBackupTable(tableName)) return 'backup';
  return _asc.tableCategories[tableName] || 'yellow';
}

function ascGetCategoryBadge(tableName) {
  var cat = ascGetTableCategory(tableName);
  
  var labels = {
    green: '🟢 Safe',
    yellow: '🟡 Careful',
    red: '🔴 Danger',
    backup: '⚫ Backup'
  };
  
  var classes = {
    green: 'asc-cat-green',
    yellow: 'asc-cat-yellow',
    red: 'asc-cat-red',
    backup: 'asc-cat-backup'
  };
  
  return '<span class="' + classes[cat] + '">' + labels[cat] + '</span>';
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
async function ascLoadDashboard() {
  await ascRefreshStats();
  await ascLoadRecentActions();
}

async function ascRefreshStats() {
  var tbody = document.getElementById('ascTableStatsBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">' +
      '<div class="erp-spinner" style="margin:0 auto;"></div>' +
      '<div class="mt-2">Loading table stats...</div></td></tr>';
  }
  
  try {
    var t0 = Date.now();
    var res = await fetch(erpUrl('rpc/admin_get_table_stats'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({})
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    
    _asc.tableStats = data || [];
    console.log('[Admin Console] Stats loaded in ' + (Date.now() - t0) + 'ms. Tables:', _asc.tableStats.length);
    
    ascRenderStats();
    ascComputeKPIs();
    
  } catch(err) {
    console.error('[ascRefreshStats]', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">' +
        'Failed to load stats: ' + ascEsc(err.message) + '</td></tr>';
    }
  }
}

window.ascRefreshStats = ascRefreshStats;

function ascRenderStats() {
  var tbody = document.getElementById('ascTableStatsBody');
  if (!tbody) return;
  
  if (_asc.tableStats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">' +
      'No tables found</td></tr>';
    return;
  }
  
  // ✅ Filter: hide backup tables unless toggle is on
  var showBackups = document.getElementById('ascShowBackupTables');
  var includeBackups = showBackups ? showBackups.checked : false;
  
  var backupCount = _asc.tableStats.filter(function(t) {
    return ascIsBackupTable(t.table_name);
  }).length;
  
  var filtered = _asc.tableStats.filter(function(t) {
    if (includeBackups) return true;
    return !ascIsBackupTable(t.table_name);
  });
  
  // Update count badge
  var countEl = document.getElementById('ascTableStatsCount');
  if (countEl) {
    if (includeBackups) {
      countEl.textContent = _asc.tableStats.length + ' total (' + backupCount + ' backups)';
    } else {
      countEl.textContent = filtered.length + ' (hiding ' + backupCount + ' backups)';
    }
  }
  
  var sorted = filtered.slice().sort(function(a, b) {
    return Number(b.row_count) - Number(a.row_count);
  });
  
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">' +
      'No tables match filter</td></tr>';
    return;
  }
  
  var html = '';
  sorted.forEach(function(t) {
    var rowCount = Number(t.row_count || 0);
    var sizeBytes = Number(t.size_bytes || 0);
    var sizeStr = ascFormatBytes(sizeBytes);
    var catBadge = ascGetCategoryBadge(t.table_name);
    
    html += '<tr>' +
      '<td><code>' + ascEsc(t.table_name) + '</code></td>' +
      '<td class="text-end fw-bold">' + ascNum(rowCount) + '</td>' +
      '<td class="text-end text-muted">' + sizeStr + '</td>' +
      '<td class="text-center">' + catBadge + '</td>' +
      '<td class="text-center">' +
        '<button class="asc-action-btn" onclick="ascSwitchTab(\'tables\'); ascLoadTable(\'' + ascJsEsc(t.table_name) + '\')" title="Browse">' +
          '<i class="bi bi-table"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });
  
  tbody.innerHTML = html;
}

function ascToggleBackupTables(show) {
  try {
    localStorage.setItem('ivm_admin_showBackups', show ? '1' : '0');
  } catch(e) {}
  ascRenderStats();
}

window.ascToggleBackupTables = ascToggleBackupTables;

function ascComputeKPIs() {
  var totalTables = _asc.tableStats.length;
  var totalRows = 0;
  var totalSize = 0;
  
  _asc.tableStats.forEach(function(t) {
    totalRows += Number(t.row_count || 0);
    totalSize += Number(t.size_bytes || 0);
  });
  
  var elTables = document.getElementById('ascKpiTables');
  if (elTables) elTables.textContent = ascNum(totalTables);
  
  var elRows = document.getElementById('ascKpiRows');
  if (elRows) elRows.textContent = ascNum(totalRows);
  
  var elSize = document.getElementById('ascKpiSize');
  if (elSize) elSize.textContent = ascFormatBytes(totalSize);
}

async function ascLoadRecentActions() {
  try {
    var res = await erpFetch('admin_audit_log', 'select=id&order=created_at.desc&limit=100');
    
    var count = (res || []).length;
    var el = document.getElementById('ascKpiActions');
    if (el) el.textContent = ascNum(count);
    
    var sub = document.getElementById('ascKpiActionsSub');
    if (sub) sub.textContent = count === 0 ? 'Wala pang actions' : 'Total logged actions';
  } catch(e) {
    console.warn('[ascLoadRecentActions]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════
function ascSwitchTab(tabName) {
  document.querySelectorAll('.asc-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tabName);
  });
  
  document.querySelectorAll('.asc-tab-content').forEach(function(el) {
    el.classList.remove('active');
  });
  
  var target = document.getElementById('tab-' + tabName);
  if (target) target.classList.add('active');
  
  if (tabName === 'tables' && _asc.allTables.length === 0) {
    ascLoadTableList();
  } else if (tabName === 'audit') {
    ascLoadAudit();
  } else if (tabName === 'csv') {
    ascPopulateCsvTableDropdowns();
  }
}

window.ascSwitchTab = ascSwitchTab;

// ═══════════════════════════════════════════════════════════
// TABLE LIST
// ═══════════════════════════════════════════════════════════
async function ascLoadTableList() {
  try {
    _asc.allTables = _asc.tableStats.map(function(t) { return t.table_name; });
    
    if (_asc.allTables.length === 0) {
      await ascRefreshStats();
      _asc.allTables = _asc.tableStats.map(function(t) { return t.table_name; });
    }
    
    _asc.allTables.sort();
    
    var showBackups = document.getElementById('ascShowBackupTables');
    var includeBackups = showBackups ? showBackups.checked : false;
    
    var filteredTables = _asc.allTables.filter(function(t) {
      if (includeBackups) return true;
      return !ascIsBackupTable(t);
    });
    
    var sel = document.getElementById('ascTableSelect');
    if (sel) {
      sel.innerHTML = '<option value="">-- Select Table --</option>';
      
      var regularTables = filteredTables.filter(function(t) { return !ascIsBackupTable(t); });
      var backupTables = includeBackups ? filteredTables.filter(function(t) { return ascIsBackupTable(t); }) : [];
      
      if (regularTables.length > 0) {
        var optGroupReg = document.createElement('optgroup');
        optGroupReg.label = '📊 Tables';
        regularTables.forEach(function(t) {
          var cat = ascGetTableCategory(t);
          var icon = cat === 'green' ? '🟢' : (cat === 'yellow' ? '🟡' : '🔴');
          var opt = document.createElement('option');
          opt.value = t;
          opt.textContent = icon + ' ' + t;
          optGroupReg.appendChild(opt);
        });
        sel.appendChild(optGroupReg);
      }
      
      if (backupTables.length > 0) {
        var optGroupBk = document.createElement('optgroup');
        optGroupBk.label = '⚫ Backup Tables';
        backupTables.forEach(function(t) {
          var opt = document.createElement('option');
          opt.value = t;
          opt.textContent = '⚫ ' + t;
          optGroupBk.appendChild(opt);
        });
        sel.appendChild(optGroupBk);
      }
    }
  } catch(e) {
    console.error('[ascLoadTableList]', e);
  }
}

// ═══════════════════════════════════════════════════════════
// LOAD TABLE DATA
// ═══════════════════════════════════════════════════════════
async function ascLoadTable(tableName) {
  if (!tableName) {
    document.getElementById('ascTableContainer').innerHTML =
      '<div class="text-center text-muted py-5">' +
      '<i class="bi bi-inbox" style="font-size:3rem;opacity:0.3;"></i>' +
      '<div class="mt-2">Select a table above to browse</div></div>';
    document.getElementById('ascTableFooter').style.display = 'none';
    return;
  }
  
  _asc.currentTable = tableName;
  _asc.currentPage = 1;
  _asc.searchTerm = '';
  
  var searchInput = document.getElementById('ascTableSearch');
  if (searchInput) searchInput.value = '';
  
  var badge = document.getElementById('ascTableCategoryBadge');
  if (badge) {
    badge.innerHTML = ascGetCategoryBadge(tableName);
    badge.style.display = 'inline-block';
  }
  
  var isReadOnly = (_asc.accessMode === 'readonly');
  var insertBtn = document.getElementById('ascInsertBtn');
  var exportBtn = document.getElementById('ascExportBtn');
  
  if (insertBtn) insertBtn.disabled = isReadOnly;
  if (exportBtn) exportBtn.disabled = false;
  
  await ascFetchTableData();
}

window.ascLoadTable = ascLoadTable;

async function ascFetchTableData() {
  var container = document.getElementById('ascTableContainer');
  var footer = document.getElementById('ascTableFooter');
  
  if (container) {
    container.innerHTML = '<div class="text-center text-muted py-5">' +
      '<div class="erp-spinner" style="margin:0 auto;"></div>' +
      '<div class="mt-2">Loading ' + ascEsc(_asc.currentTable) + '...</div></div>';
  }
  
  try {
    var countRes = await fetch(erpUrl(_asc.currentTable) + '?select=id&limit=1', {
      method: 'HEAD',
      headers: Object.assign({}, erpHeaders(), {
        'Prefer': 'count=exact',
        'Range': '0-0'
      }),
      cache: 'no-store'
    });
    
    var range = countRes.headers.get('content-range') || '';
    var m = range.match(/\/(\d+)/);
    _asc.totalRows = m ? parseInt(m[1], 10) : 0;
    
    var offset = (_asc.currentPage - 1) * _asc.pageSize;
    var query = 'select=*&limit=' + _asc.pageSize + '&offset=' + offset;
    
    var data = await erpFetch(_asc.currentTable, query);
    _asc.currentData = data || [];
    
    if (_asc.currentData.length > 0) {
      _asc.currentColumns = Object.keys(_asc.currentData[0]);
    } else {
      _asc.currentColumns = [];
    }
    
    console.log('[Admin Console] Loaded ' + _asc.currentData.length + ' rows from ' + _asc.currentTable);
    
    ascRenderTableData();
    
    if (footer) footer.style.display = 'flex';
    
  } catch(err) {
    console.error('[ascFetchTableData]', err);
    if (container) {
      container.innerHTML = '<div class="text-center text-danger py-5">' +
        '<i class="bi bi-exclamation-triangle-fill" style="font-size:2rem;"></i>' +
        '<div class="mt-2">Failed to load: ' + ascEsc(err.message) + '</div></div>';
    }
  }
}

function ascRenderTableData() {
  var container = document.getElementById('ascTableContainer');
  if (!container) return;
  
  if (_asc.currentData.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-5">' +
      '<i class="bi bi-inbox" style="font-size:3rem;opacity:0.3;"></i>' +
      '<div class="mt-2">No rows found</div></div>';
    ascUpdatePagination();
    return;
  }
  
  var cols = _asc.currentColumns;
  var canWrite = _asc.accessMode !== 'readonly';
  
  var html = '<div class="table-responsive" style="max-height:600px;overflow-y:auto;">';
  html += '<table class="asc-table">';
  
  html += '<thead><tr>';
  html += '<th style="width:50px;">#</th>';
  cols.forEach(function(c) {
    html += '<th>' + ascEsc(c) + '</th>';
  });
  html += '<th style="width:120px;" class="text-center">Actions</th>';
  html += '</tr></thead>';
  
  html += '<tbody>';
  _asc.currentData.forEach(function(row, idx) {
    html += '<tr>';
    html += '<td class="text-muted small">' + ((_asc.currentPage - 1) * _asc.pageSize + idx + 1) + '</td>';
    
    cols.forEach(function(c) {
      var val = row[c];
      var displayVal = ascFormatCellValue(val, c);
      html += '<td title="' + ascEsc(String(val == null ? '' : val)) + '">' + displayVal + '</td>';
    });
    
    var rowId = row.id || row.item_code || row.doc_no || '';
    var safeRowId = ascJsEsc(String(rowId));
    
    html += '<td class="text-center">' +
      '<button class="asc-action-btn" onclick="ascViewRow(\'' + safeRowId + '\')" title="View">' +
        '<i class="bi bi-eye"></i>' +
      '</button>';
    
    if (canWrite) {
      html += '<button class="asc-action-btn success" onclick="ascOpenEditModal(\'' + safeRowId + '\')" title="Edit">' +
        '<i class="bi bi-pencil"></i>' +
      '</button>' +
      '<button class="asc-action-btn danger" onclick="ascOpenDeleteModal(\'' + safeRowId + '\')" title="Delete">' +
        '<i class="bi bi-trash"></i>' +
      '</button>';
    } else {
      html += '<button class="asc-action-btn" disabled title="Edit (read-only)">' +
        '<i class="bi bi-pencil"></i>' +
      '</button>' +
      '<button class="asc-action-btn danger" disabled title="Delete (read-only)">' +
        '<i class="bi bi-trash"></i>' +
      '</button>';
    }
    
    html += '</td>';
    html += '</tr>';
  });
  html += '</tbody>';
  
  html += '</table></div>';
  
  container.innerHTML = html;
  ascUpdatePagination();
}

function ascFormatCellValue(val, colName) {
  if (val === null || val === undefined) {
    return '<span class="text-muted fst-italic">null</span>';
  }
  
  if (typeof val === 'boolean') {
    return val ? '<span class="badge bg-success">true</span>' : '<span class="badge bg-secondary">false</span>';
  }
  
  if (typeof val === 'object') {
    var json = JSON.stringify(val);
    if (json.length > 50) json = json.substring(0, 50) + '…';
    return '<code style="font-size:0.7rem;">' + ascEsc(json) + '</code>';
  }
  
  var str = String(val);
  
  if (str.length > 60) {
    return ascEsc(str.substring(0, 60)) + '…';
  }
  
  if (colName === 'id' || colName === 'item_code' || colName === 'doc_no' || colName === 'prf_no') {
    return '<code>' + ascEsc(str) + '</code>';
  }
  
  return ascEsc(str);
}

function ascUpdatePagination() {
  var total = _asc.totalRows;
  var start = (_asc.currentPage - 1) * _asc.pageSize + 1;
  var end = Math.min(_asc.currentPage * _asc.pageSize, total);
  
  if (total === 0) { start = 0; end = 0; }
  
  var infoEl = document.getElementById('ascTablePaginationInfo');
  if (infoEl) infoEl.textContent = 'Showing ' + start + '–' + end + ' of ' + ascNum(total);
  
  var labelEl = document.getElementById('ascPageLabel');
  var maxPage = Math.ceil(total / _asc.pageSize) || 1;
  if (labelEl) labelEl.textContent = 'Page ' + _asc.currentPage + ' / ' + maxPage;
  
  var prevBtn = document.getElementById('ascPagePrev');
  var nextBtn = document.getElementById('ascPageNext');
  if (prevBtn) prevBtn.disabled = (_asc.currentPage <= 1);
  if (nextBtn) nextBtn.disabled = (end >= total);
}

function ascPagePrev() {
  if (_asc.currentPage > 1) {
    _asc.currentPage--;
    ascFetchTableData();
  }
}

window.ascPagePrev = ascPagePrev;

function ascPageNext() {
  var maxPage = Math.ceil(_asc.totalRows / _asc.pageSize);
  if (_asc.currentPage < maxPage) {
    _asc.currentPage++;
    ascFetchTableData();
  }
}

window.ascPageNext = ascPageNext;

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
function ascDebouncedSearch() {
  clearTimeout(_asc.searchTimer);
  _asc.searchTimer = setTimeout(function() {
    var input = document.getElementById('ascTableSearch');
    _asc.searchTerm = (input ? input.value : '').trim();
    ascFilterCurrentPage();
  }, 300);
}

window.ascDebouncedSearch = ascDebouncedSearch;

function ascFilterCurrentPage() {
  var container = document.getElementById('ascTableContainer');
  if (!container) return;
  
  if (!_asc.searchTerm) {
    ascRenderTableData();
    return;
  }
  
  var term = _asc.searchTerm.toLowerCase();
  var filtered = _asc.currentData.filter(function(row) {
    return _asc.currentColumns.some(function(c) {
      var v = row[c];
      if (v === null || v === undefined) return false;
      return String(v).toLowerCase().indexOf(term) !== -1;
    });
  });
  
  var originalData = _asc.currentData;
  _asc.currentData = filtered;
  ascRenderTableData();
  _asc.currentData = originalData;
}

// ═══════════════════════════════════════════════════════════
// VIEW ROW
// ═══════════════════════════════════════════════════════════
function ascViewRow(rowId) {
  if (!rowId) return;
  
  var row = _asc.currentData.find(function(r) {
    var id = r.id || r.item_code || r.doc_no || '';
    return String(id) === String(rowId);
  });
  
  if (!row) {
    erpShowToast('Row not found', 'warning');
    return;
  }
  
  var body = document.getElementById('ascRowDetailsBody');
  if (!body) return;
  
  var html = '<div style="padding:10px;">';
  html += '<div class="alert alert-info small py-2 mb-3">' +
    '<i class="bi bi-info-circle me-1"></i>' +
    '<strong>Table:</strong> <code>' + ascEsc(_asc.currentTable) + '</code>' +
    '</div>';
  
  html += '<table class="table table-sm table-bordered" style="font-size:0.85rem;">';
  html += '<thead class="table-light"><tr>' +
    '<th style="width:30%;">Column</th>' +
    '<th style="width:15%;">Type</th>' +
    '<th>Value</th>' +
    '</tr></thead><tbody>';
  
  Object.keys(row).forEach(function(key) {
    var val = row[key];
    var valStr = '';
    var typeStr = typeof val;
    
    if (val === null) {
      valStr = '<span class="text-muted fst-italic">null</span>';
      typeStr = 'null';
    } else if (typeof val === 'object') {
      valStr = '<pre style="margin:0;font-size:0.75rem;white-space:pre-wrap;">' + ascEsc(JSON.stringify(val, null, 2)) + '</pre>';
      typeStr = Array.isArray(val) ? 'array' : 'json';
    } else if (typeof val === 'boolean') {
      valStr = val ? '<span class="badge bg-success">true</span>' : '<span class="badge bg-secondary">false</span>';
    } else {
      valStr = ascEsc(String(val));
    }
    
    html += '<tr>' +
      '<td><code>' + ascEsc(key) + '</code></td>' +
      '<td><span class="badge bg-secondary" style="font-size:0.65rem;">' + typeStr + '</span></td>' +
      '<td>' + valStr + '</td>' +
      '</tr>';
  });
  
  html += '</tbody></table></div>';
  
  body.innerHTML = html;
  
  if (_asc.rowDetailsModal) _asc.rowDetailsModal.show();
}

window.ascViewRow = ascViewRow;

// ═══════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════
async function ascLoadAudit() {
  var tbody = document.getElementById('ascAuditBody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' +
    '<div class="erp-spinner" style="margin:0 auto;"></div></td></tr>';
  
  try {
    var filter = document.getElementById('ascAuditActionFilter');
    var actionFilter = filter ? filter.value : '';
    
    var query = 'select=*&order=created_at.desc&limit=200';
    if (actionFilter) query += '&action=eq.' + encodeURIComponent(actionFilter);
    
    var rows = await erpFetch('admin_audit_log', query);
    
    var countEl = document.getElementById('ascAuditCount');
    if (countEl) countEl.textContent = (rows || []).length;
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">' +
        '<i class="bi bi-inbox" style="font-size:2rem;opacity:0.3;"></i>' +
        '<div class="mt-2">Wala pang audit log entries</div></td></tr>';
      return;
    }
    
    var html = '';
    rows.forEach(function(log) {
      var dateStr = log.created_at ? new Date(log.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '—';
      
      var actionClass = 'bg-secondary';
      if (log.action === 'INSERT') actionClass = 'bg-success';
      else if (log.action === 'UPDATE') actionClass = 'bg-warning text-dark';
      else if (log.action === 'SOFT_DELETE') actionClass = 'bg-info text-dark';
      else if (log.action === 'HARD_DELETE') actionClass = 'bg-danger';
      else if (log.action === 'RAW_SQL') actionClass = 'bg-dark';
      else if (log.action === 'RPC') actionClass = 'bg-primary';
      else if (log.action === 'PIN_CHANGED') actionClass = 'bg-warning text-dark';
      
      html += '<tr>' +
        '<td style="font-size:0.75rem;">' + ascEsc(dateStr) + '</td>' +
        '<td><span class="badge ' + actionClass + '" style="font-size:0.68rem;">' + ascEsc(log.action) + '</span></td>' +
        '<td><code>' + ascEsc(log.target_table || '—') + '</code></td>' +
        '<td><code>' + ascEsc(String(log.target_id || '—').substring(0, 20)) + '</code></td>' +
        '<td>' + ascEsc(log.performed_by_fullname || log.performed_by || '—') + '</td>' +
        '<td><small>' + ascEsc(String(log.reason || '—').substring(0, 50)) + '</small></td>' +
        '<td class="text-center">' +
          '<button class="asc-action-btn" onclick="ascViewAuditDetail(' + log.id + ')" title="Details">' +
            '<i class="bi bi-eye"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
    
  } catch(err) {
    console.error('[ascLoadAudit]', err);
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">' +
      'Failed: ' + ascEsc(err.message) + '</td></tr>';
  }
}

window.ascLoadAudit = ascLoadAudit;

async function ascViewAuditDetail(logId) {
  try {
    var rows = await erpFetch('admin_audit_log', 'id=eq.' + logId + '&limit=1');
    if (!rows || rows.length === 0) return;
    
    var log = rows[0];
    var body = document.getElementById('ascAuditDetailBody');
    if (!body) return;
    
    var html = '<div style="padding:10px;">';
    
    html += '<div class="row g-3 mb-3">' +
      '<div class="col-md-6"><strong>Action:</strong> ' + ascEsc(log.action) + '</div>' +
      '<div class="col-md-6"><strong>Table:</strong> <code>' + ascEsc(log.target_table) + '</code></div>' +
      '<div class="col-md-6"><strong>Target ID:</strong> <code>' + ascEsc(log.target_id || '—') + '</code></div>' +
      '<div class="col-md-6"><strong>When:</strong> ' + ascEsc(new Date(log.created_at).toLocaleString()) + '</div>' +
      '<div class="col-md-6"><strong>By:</strong> ' + ascEsc(log.performed_by_fullname || log.performed_by) + '</div>' +
      '<div class="col-md-6"><strong>Reason:</strong> ' + ascEsc(log.reason || '—') + '</div>' +
      '</div>';
    
    if (log.sql_text) {
      html += '<h6 class="mt-3">SQL Text</h6>' +
        '<pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:0.78rem;overflow-x:auto;">' + ascEsc(log.sql_text) + '</pre>';
    }
    
    if (log.old_data) {
      html += '<h6 class="mt-3">Old Data</h6>' +
        '<pre style="background:#fef2f2;padding:12px;border-radius:8px;font-size:0.75rem;overflow-x:auto;">' + ascEsc(JSON.stringify(log.old_data, null, 2)) + '</pre>';
    }
    
    if (log.new_data) {
      html += '<h6 class="mt-3">New Data</h6>' +
        '<pre style="background:#f0fdf4;padding:12px;border-radius:8px;font-size:0.75rem;overflow-x:auto;">' + ascEsc(JSON.stringify(log.new_data, null, 2)) + '</pre>';
    }
    
    html += '</div>';
    body.innerHTML = html;
    
    if (!_asc.auditDetailModal) {
      _asc.auditDetailModal = new bootstrap.Modal(document.getElementById('ascAuditDetailModal'));
    }
    _asc.auditDetailModal.show();
    
  } catch(e) {
    erpShowToast('Failed to load details', 'danger');
  }
}

window.ascViewAuditDetail = ascViewAuditDetail;

// ═══════════════════════════════════════════════════════════
// LOG ACTION
// ═══════════════════════════════════════════════════════════
async function ascLogAction(action, table, targetId, oldData, newData, reason) {
  try {
    await fetch(erpUrl('admin_audit_log'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify({
        action: action,
        target_table: table || 'system',
        target_id: targetId ? String(targetId) : null,
        old_data: oldData || null,
        new_data: newData || null,
        sql_text: null,
        performed_by: _asc.currentUser,
        performed_by_fullname: _asc.currentFullname,
        reason: reason || null,
        user_agent: navigator.userAgent.substring(0, 200)
      })
    });
  } catch(e) {
    console.warn('[ascLogAction]', e.message);
  }
}

window.ascLogAction = ascLogAction;

// ═══════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════
function ascClearLocalCache() {
  if (!confirm('Clear ALL local browser cache?\n\nKasama lahat ng cached data, settings, at iba pa (maliban sa login session at admin PIN).')) {
    return;
  }
  
  var preserveKeys = [
    'ivm_username', 'ivm_userFullname', 'ivm_userRole', 'ivm_isAdmin',
    'ivm_allowedRoles', 'ivm_userDepartment',
    'ivm_adminPin', 'ivm_admin_accessMode',
    'ivm_admin_showBackups',
    'ivm_theme', 'erp_theme'
  ];
  
  var preserved = {};
  preserveKeys.forEach(function(k) {
    var v = localStorage.getItem(k);
    if (v !== null) preserved[k] = v;
  });
  
  localStorage.clear();
  
  Object.keys(preserved).forEach(function(k) {
    localStorage.setItem(k, preserved[k]);
  });
  
  try { sessionStorage.clear(); } catch(e) {}
  
  if ('caches' in window) {
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    });
  }
  
  ascLogAction('CLEAR_CACHE', 'system', null, null, null, 'Local browser cache cleared');
  erpShowToast('✅ Cache cleared. Reloading...', 'success');
  
  setTimeout(function() {
    window.location.reload();
  }, 1500);
}

window.ascClearLocalCache = ascClearLocalCache;

// ═══════════════════════════════════════════════════════════
// REFRESH ALL
// ═══════════════════════════════════════════════════════════
async function ascRefreshAll() {
  erpShowToast('Refreshing...', 'info');
  await ascCheckHealth();
  await ascRefreshStats();
  await ascLoadRecentActions();
  
  if (_asc.currentTable) {
    await ascFetchTableData();
  }
  
  erpShowToast('✅ Refreshed', 'success');
}

window.ascRefreshAll = ascRefreshAll;

// ═══════════════════════════════════════════════════════════
// CSV TOOLS
// ═══════════════════════════════════════════════════════════
function ascPopulateCsvTableDropdowns() {
  var exportSel = document.getElementById('ascCsvExportTable');
  var importSel = document.getElementById('ascCsvImportTable');
  
  if (!_asc.allTables.length) {
    _asc.allTables = _asc.tableStats.map(function(t) { return t.table_name; });
  }
  
  var sorted = _asc.allTables.slice().sort();
  
  [exportSel, importSel].forEach(function(sel) {
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select Table --</option>';
    sorted.forEach(function(t) {
      var cat = ascGetTableCategory(t);
      var icon = cat === 'green' ? '🟢' : (cat === 'yellow' ? '🟡' : (cat === 'backup' ? '⚫' : '🔴'));
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = icon + ' ' + t;
      sel.appendChild(opt);
    });
  });
}

window.ascPopulateCsvTableDropdowns = ascPopulateCsvTableDropdowns;

// ═══════════════════════════════════════════════════════════
// SQL RUNNER
// ═══════════════════════════════════════════════════════════
function ascUnlockSql() {
  if (_asc.accessMode !== 'full') {
    erpShowToast('Kailangan muna i-enable ang Full Access mode', 'warning');
    return;
  }
  
  ascRequestPin('Unlock SQL Runner', function() {
    _asc.pinVerified = true;
    
    var input = document.getElementById('ascSqlInput');
    var btn = document.getElementById('ascRunSqlBtn');
    var locked = document.getElementById('ascSqlLocked');
    var unlockBtn = document.getElementById('ascUnlockSqlBtn');
    
    if (input) input.disabled = false;
    if (btn) btn.disabled = false;
    if (locked) locked.style.display = 'none';
    if (unlockBtn) unlockBtn.style.display = 'none';
    
    erpShowToast('🔓 SQL Runner unlocked', 'success');
    if (input) input.focus();
  });
}

window.ascUnlockSql = ascUnlockSql;

async function ascRunSql() {
  if (!_asc.pinVerified) {
    erpShowToast('Kailangan i-unlock muna ang SQL Runner', 'warning');
    return;
  }
  
  var input = document.getElementById('ascSqlInput');
  var sql = input ? input.value.trim() : '';
  
  if (!sql) {
    erpShowToast('Enter SQL query', 'warning');
    return;
  }
  
  var upperSql = sql.toUpperCase();
  var isDangerous = (
    upperSql.indexOf('DROP TABLE') !== -1 ||
    upperSql.indexOf('TRUNCATE') !== -1 ||
    upperSql.indexOf('ALTER TABLE') !== -1 ||
    (upperSql.indexOf('DELETE FROM') !== -1 && upperSql.indexOf('WHERE') === -1)
  );
  
  if (isDangerous) {
    var reason = prompt(
      '⚠️ DANGEROUS SQL detected!\n\n' +
      'May DROP/TRUNCATE/ALTER/DELETE-without-WHERE sa query mo.\n\n' +
      'Type reason para i-execute:'
    );
    
    if (!reason || !reason.trim()) return;
    if (!confirm('FINAL CONFIRMATION:\n\nI-execute ang DANGEROUS SQL?\n\nReason: ' + reason)) return;
    
    await ascLogAction('RAW_SQL', 'raw', null, null, { sql: sql }, reason + ' (DANGEROUS)');
  } else {
    var reason2 = prompt('Reason for this SQL query:', 'Admin query');
    if (!reason2) return;
    await ascLogAction('RAW_SQL', 'raw', null, null, { sql: sql }, reason2);
  }
  
  var btn = document.getElementById('ascRunSqlBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Running...';
  
  var resultEl = document.getElementById('ascSqlResult');
  if (resultEl) resultEl.innerHTML = '<div class="alert alert-info small">Executing...</div>';
  
  try {
    var t0 = Date.now();
    var isSelect = upperSql.trim().indexOf('SELECT') === 0 || upperSql.trim().indexOf('WITH') === 0;
    
    var rpcName = isSelect ? 'execute_sql_query' : 'execute_sql_mutation';
    
    var res = await fetch(erpUrl('rpc/' + rpcName), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({ p_sql: sql })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText.substring(0, 200));
    }
    
    var data = await res.json();
    var elapsed = Date.now() - t0;
    
    if (resultEl) {
      var html = '<div class="alert alert-success small py-2 mb-2">' +
        '✅ Query OK (' + elapsed + 'ms)</div>';
      
      if (Array.isArray(data) && data.length > 0) {
        html += '<div class="table-responsive" style="max-height:400px;overflow-y:auto;">';
        html += '<table class="asc-table" style="font-size:0.8rem;">';
        html += '<thead><tr>';
        Object.keys(data[0]).forEach(function(k) { html += '<th>' + ascEsc(k) + '</th>'; });
        html += '</tr></thead><tbody>';
        
        data.slice(0, 200).forEach(function(row) {
          html += '<tr>';
          Object.keys(row).forEach(function(k) {
            var v = row[k];
            if (v === null) v = '<span class="text-muted">null</span>';
            else if (typeof v === 'object') v = '<code>' + ascEsc(JSON.stringify(v).substring(0, 100)) + '</code>';
            else v = ascEsc(String(v).substring(0, 200));
            html += '<td>' + v + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        
        if (data.length > 200) {
          html += '<div class="text-muted small mt-2">Showing first 200 of ' + data.length + ' rows</div>';
        }
      } else {
        html += '<pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:0.78rem;overflow-x:auto;">' +
          ascEsc(JSON.stringify(data, null, 2)) + '</pre>';
      }
      
      resultEl.innerHTML = html;
    }
    
  } catch(err) {
    console.error('[ascRunSql]', err);
    
    var errMsg = err.message || 'Unknown error';
    if (errMsg.indexOf('function') !== -1 && errMsg.indexOf('does not exist') !== -1) {
      errMsg = '⚠️ Ang `execute_sql_query` / `execute_sql_mutation` RPC functions ay hindi pa naka-install. ' +
                'I-run mo muna ang SQL migration para sa Phase 2.';
    }
    
    if (resultEl) {
      resultEl.innerHTML = '<div class="alert alert-danger">' +
        '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
        '<strong>Error:</strong><br><small>' + ascEsc(errMsg) + '</small></div>';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

window.ascRunSql = ascRunSql;

function ascSqlClear() {
  var input = document.getElementById('ascSqlInput');
  if (input) input.value = '';
}

window.ascSqlClear = ascSqlClear;

function ascSqlLoadTemplate() {
  var input = document.getElementById('ascSqlInput');
  if (input) {
    input.value = '-- Template queries\n\n-- 1. Count all items\nSELECT COUNT(*) FROM erp_items;\n\n-- 2. View recent PRFs\nSELECT prf_no, category, requestor, created_at\nFROM prf_documents\nORDER BY created_at DESC\nLIMIT 10;\n\n-- 3. UNSERVED PRF items\nSELECT prf_no, item_code, qty_for_order, status\nFROM prf_items\nWHERE status = \'UNSERVED\'\nLIMIT 20;';
  }
}

window.ascSqlLoadTemplate = ascSqlLoadTemplate;

// ═══════════════════════════════════════════════════════════
// RPC RUNNER
// ═══════════════════════════════════════════════════════════
function ascRpcChange() {
  var sel = document.getElementById('ascRpcSelect');
  var input = document.getElementById('ascRpcParams');
  var btn = document.getElementById('ascRunRpcBtn');
  
  if (!sel || !input) return;
  
  var rpc = sel.value;
  
  if (!rpc) {
    input.value = '';
    input.placeholder = 'Select RPC first';
    if (btn) btn.disabled = true;
    return;
  }
  
  if (btn) btn.disabled = false;
  
  var templates = {
    'admin_get_table_stats': '{}',
    'get_next_doc_number': '{"p_prefix": "MRIF"}',
    'erp_get_management_dashboard': '{"p_from_date": "2026-01-01", "p_to_date": "2026-12-31"}',
    'erp_manual_edit_item': '{"p_item_code": "GEM-XXX", "p_field_name": "on_hand", "p_new_value": "100", "p_reason": "test", "p_edited_by": "admin"}'
  };
  
  input.value = templates[rpc] || '{}';
}

window.ascRpcChange = ascRpcChange;

async function ascRunRpc() {
  var sel = document.getElementById('ascRpcSelect');
  var input = document.getElementById('ascRpcParams');
  var resultEl = document.getElementById('ascRpcResult');
  
  if (!sel || !input || !resultEl) return;
  
  var rpc = sel.value;
  if (!rpc) return;
  
  var paramsStr = input.value.trim() || '{}';
  var params;
  
  try {
    params = JSON.parse(paramsStr);
  } catch(e) {
    erpShowToast('Invalid JSON parameters', 'danger');
    return;
  }
  
  var btn = document.getElementById('ascRunRpcBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Running...';
  
  resultEl.innerHTML = '<div class="alert alert-info small">Executing RPC...</div>';
  
  try {
    var t0 = Date.now();
    var res = await fetch(erpUrl('rpc/' + rpc), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify(params)
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText.substring(0, 200));
    }
    
    var data = await res.json();
    var elapsed = Date.now() - t0;
    
    await ascLogAction('RPC', rpc, null, null, { params: params, result: data }, 'RPC call');
    
    var html = '<div class="alert alert-success small py-2 mb-2">✅ RPC OK (' + elapsed + 'ms)</div>';
    
    if (Array.isArray(data) && data.length > 0) {
      html += '<div class="table-responsive" style="max-height:400px;overflow-y:auto;">';
      html += '<table class="asc-table" style="font-size:0.8rem;">';
      html += '<thead><tr>';
      Object.keys(data[0]).forEach(function(k) { html += '<th>' + ascEsc(k) + '</th>'; });
      html += '</tr></thead><tbody>';
      
      data.slice(0, 100).forEach(function(row) {
        html += '<tr>';
        Object.keys(row).forEach(function(k) {
          var v = row[k];
          if (v === null) v = '<span class="text-muted">null</span>';
          else if (typeof v === 'object') v = '<code>' + ascEsc(JSON.stringify(v).substring(0, 80)) + '</code>';
          else v = ascEsc(String(v).substring(0, 150));
          html += '<td>' + v + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:0.78rem;overflow-x:auto;">' +
        ascEsc(JSON.stringify(data, null, 2)) + '</pre>';
    }
    
    resultEl.innerHTML = html;
    
  } catch(err) {
    console.error('[ascRunRpc]', err);
    resultEl.innerHTML = '<div class="alert alert-danger">' +
      '<i class="bi bi-exclamation-triangle-fill me-1"></i>' +
      'Error: ' + ascEsc(err.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

window.ascRunRpc = ascRunRpc;

// ═══════════════════════════════════════════════════════════
// SCHEMA CACHE
// ═══════════════════════════════════════════════════════════
var _ascSchemaCache = {};

async function ascGetTableSchema(tableName) {
  if (_ascSchemaCache[tableName]) return _ascSchemaCache[tableName];
  
  try {
    var sample = await erpFetch(tableName, 'select=*&limit=1');
    
    if (!sample || sample.length === 0) {
      try {
        var res = await fetch(erpUrl('rpc/admin_get_table_columns'), {
          method: 'POST',
          headers: erpHeaders(),
          body: JSON.stringify({ p_table_name: tableName })
        });
        
        if (res.ok) {
          var cols = await res.json();
          _ascSchemaCache[tableName] = cols;
          return cols;
        }
      } catch(e) {}
      
      _ascSchemaCache[tableName] = [];
      return [];
    }
    
    var columns = Object.keys(sample[0]).map(function(col) {
      var val = sample[0][col];
      var type = 'text';
      
      if (typeof val === 'number') type = 'number';
      else if (typeof val === 'boolean') type = 'boolean';
      else if (val instanceof Object) type = 'json';
      else if (col === 'id') type = 'id';
      else if (col.indexOf('_at') !== -1 || col.indexOf('date') !== -1) type = 'date';
      else if (col.indexOf('email') !== -1) type = 'email';
      
      return {
        name: col,
        type: type,
        isId: col === 'id',
        isTimestamp: col.indexOf('_at') !== -1,
        sample: val
      };
    });
    
    _ascSchemaCache[tableName] = columns;
    return columns;
    
  } catch(err) {
    console.warn('[ascGetTableSchema]', tableName, err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// INSERT / EDIT
// ═══════════════════════════════════════════════════════════
function ascOpenInsertModal() {
  if (_asc.accessMode === 'readonly') {
    erpShowToast('Read-Only mode — hindi pwedeng mag-insert', 'warning');
    return;
  }
  
  if (!_asc.currentTable) {
    erpShowToast('Pumili muna ng table', 'warning');
    return;
  }
  
  _asc.editRowModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('ascEditRowModal'));
  
  document.getElementById('ascEditRowTitle').innerHTML = 
    '<i class="bi bi-plus-circle me-2"></i>Insert Row — ' + ascEsc(_asc.currentTable);
  
  document.getElementById('ascEditRowBody').innerHTML = 
    '<div class="text-center py-4">' +
      '<div class="erp-spinner" style="margin:0 auto;"></div>' +
      '<div class="mt-2">Loading schema...</div>' +
    '</div>';
  
  _asc.editRowModal.show();
  
  ascGetTableSchema(_asc.currentTable).then(function(columns) {
    ascRenderEditRowForm(columns, null, 'insert');
  });
}

window.ascOpenInsertModal = ascOpenInsertModal;

function ascOpenEditModal(rowId) {
  if (_asc.accessMode === 'readonly') {
    erpShowToast('Read-Only mode — hindi pwedeng mag-edit', 'warning');
    return;
  }
  
  if (!_asc.currentTable) return;
  
  var row = _asc.currentData.find(function(r) {
    var id = r.id || r.item_code || r.doc_no || '';
    return String(id) === String(rowId);
  });
  
  if (!row) {
    erpShowToast('Row not found', 'warning');
    return;
  }
  
  _asc.editRowModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('ascEditRowModal'));
  
  document.getElementById('ascEditRowTitle').innerHTML = 
    '<i class="bi bi-pencil-square me-2"></i>Edit Row — ' + ascEsc(_asc.currentTable);
  
  _asc.editRowModal.show();
  
  ascGetTableSchema(_asc.currentTable).then(function(columns) {
    ascRenderEditRowForm(columns, row, 'edit');
  });
}

window.ascOpenEditModal = ascOpenEditModal;

var _ascEditState = {
  mode: 'insert',
  originalRow: null,
  tableName: '',
  columns: []
};

function ascRenderEditRowForm(columns, row, mode) {
  var body = document.getElementById('ascEditRowBody');
  if (!body) return;
  
  _ascEditState.mode = mode;
  _ascEditState.originalRow = row;
  _ascEditState.tableName = _asc.currentTable;
  _ascEditState.columns = columns;
  
  if (columns.length === 0) {
    body.innerHTML = '<div class="alert alert-warning">' +
      'Walang makitang schema. Siguraduhing may data ang table na ito.</div>';
    return;
  }
  
  var html = '';
  
  html += '<div class="alert alert-info small py-2 mb-3">' +
    '<i class="bi bi-info-circle me-1"></i>' +
    'Table: <code>' + ascEsc(_asc.currentTable) + '</code>' +
    ' · Mode: <strong>' + (mode === 'insert' ? 'Insert New Row' : 'Edit Existing Row') + '</strong>' +
    '</div>';
  
  html += '<div class="row g-3">';
  
  columns.forEach(function(col) {
    var val = row ? row[col.name] : '';
    var valStr = '';
    
    if (val !== null && val !== undefined) {
      if (typeof val === 'object') valStr = JSON.stringify(val, null, 2);
      else valStr = String(val);
    }
    
    var isAutoManaged = (
      (col.name === 'id' && mode === 'insert') ||
      (col.name === 'created_at' && mode === 'insert') ||
      (col.name === 'updated_at' && mode === 'insert') ||
      (col.name === 'updated_by' && mode === 'insert')
    );
    
    var disabledAttr = isAutoManaged ? ' disabled' : '';
    var readonlyAttr = col.isId ? ' readonly' : '';
    var labelExtra = isAutoManaged 
      ? ' <span class="badge bg-secondary ms-1" style="font-size:0.6rem;">auto</span>' 
      : '';
    if (col.isId) labelExtra = ' <span class="badge bg-warning text-dark ms-1" style="font-size:0.6rem;">read-only</span>';
    
    html += '<div class="col-md-6">' +
      '<label class="form-label small fw-bold">' + ascEsc(col.name) + labelExtra + '</label>';
    
    if (col.type === 'boolean') {
      html += '<select class="form-select form-select-sm asc-edit-field" data-col="' + ascEsc(col.name) + '"' + disabledAttr + '>' +
        '<option value="">-- Select --</option>' +
        '<option value="true"' + (valStr === 'true' ? ' selected' : '') + '>true</option>' +
        '<option value="false"' + (valStr === 'false' ? ' selected' : '') + '>false</option>' +
        '</select>';
    } else if (col.type === 'json') {
      html += '<textarea class="form-control form-control-sm asc-edit-field font-monospace" ' +
        'data-col="' + ascEsc(col.name) + '" rows="3" style="font-size:0.78rem;"' + disabledAttr + readonlyAttr + '>' +
        ascEsc(valStr) + '</textarea>';
    } else if (col.type === 'number' || col.type === 'id') {
      html += '<input type="number" step="any" class="form-control form-control-sm asc-edit-field" ' +
        'data-col="' + ascEsc(col.name) + '" value="' + ascEsc(valStr) + '"' + disabledAttr + readonlyAttr + '>';
    } else if (col.type === 'email') {
      html += '<input type="email" class="form-control form-control-sm asc-edit-field" ' +
        'data-col="' + ascEsc(col.name) + '" value="' + ascEsc(valStr) + '"' + disabledAttr + readonlyAttr + '>';
    } else if (col.type === 'date') {
      var dateVal = '';
      if (valStr) {
        try {
          var d = new Date(valStr);
          if (!isNaN(d.getTime())) dateVal = d.toISOString().slice(0, 16);
        } catch(e) {}
      }
      html += '<input type="datetime-local" class="form-control form-control-sm asc-edit-field" ' +
        'data-col="' + ascEsc(col.name) + '" value="' + ascEsc(dateVal) + '"' + disabledAttr + readonlyAttr + '>';
    } else {
      html += '<input type="text" class="form-control form-control-sm asc-edit-field" ' +
        'data-col="' + ascEsc(col.name) + '" value="' + ascEsc(valStr) + '"' + disabledAttr + readonlyAttr + '>';
    }
    
    html += '</div>';
  });
  
  html += '</div>';
  
  html += '<div class="mt-4 p-3" style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;">' +
    '<label class="form-label fw-bold" style="color:#92400e;">' +
      '<i class="bi bi-chat-left-text me-1"></i>Reason for change <span class="text-danger">*</span>' +
    '</label>' +
    '<input type="text" class="form-control" id="ascEditReason" ' +
      'placeholder="e.g., Data correction, Update from physical count" maxlength="300">' +
    '<div class="form-text"><i class="bi bi-info-circle me-1"></i>Required for audit trail.</div>' +
    '</div>';
  
  body.innerHTML = html;
  
  var saveBtn = document.getElementById('ascSaveRowBtn');
  if (saveBtn) {
    saveBtn.innerHTML = mode === 'insert' 
      ? '<i class="bi bi-plus-circle me-1"></i>Insert Row'
      : '<i class="bi bi-check-circle me-1"></i>Save Changes';
    saveBtn.className = 'btn ' + (mode === 'insert' ? 'btn-success' : 'btn-primary');
  }
}

async function ascSaveRow() {
  if (_asc.accessMode === 'readonly') {
    erpShowToast('Read-Only mode', 'warning');
    return;
  }
  
  var reasonEl = document.getElementById('ascEditReason');
  var reason = reasonEl ? reasonEl.value.trim() : '';
  
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    if (reasonEl) reasonEl.focus();
    return;
  }
  
  var fields = {};
  document.querySelectorAll('.asc-edit-field').forEach(function(el) {
    var col = el.getAttribute('data-col');
    if (!col || el.disabled) return;
    
    var val = el.value;
    var colType = _ascEditState.columns.find(function(c) { return c.name === col; });
    if (!colType) return;
    
    if (colType.type === 'number' || colType.type === 'id') {
      val = val === '' ? null : Number(val);
    } else if (colType.type === 'boolean') {
      val = val === '' ? null : (val === 'true');
    } else if (colType.type === 'json') {
      if (val.trim()) {
        try { val = JSON.parse(val); } catch(e) {
          erpShowToast('Invalid JSON sa ' + col, 'danger');
          return;
        }
      } else val = null;
    } else if (colType.type === 'date') {
      if (val) {
        try { val = new Date(val).toISOString(); } catch(e) {}
      } else val = null;
    } else {
      val = val === '' ? null : val;
    }
    
    fields[col] = val;
  });
  
  var now = new Date().toISOString();
  if (_ascEditState.mode === 'edit') {
    if (_ascEditState.columns.find(function(c) { return c.name === 'updated_at'; })) fields.updated_at = now;
    if (_ascEditState.columns.find(function(c) { return c.name === 'updated_by'; })) fields.updated_by = _asc.currentFullname;
  } else {
    if (_ascEditState.columns.find(function(c) { return c.name === 'created_at'; })) fields.created_at = now;
    if (_ascEditState.columns.find(function(c) { return c.name === 'updated_at'; })) fields.updated_at = now;
  }
  
  if (!confirm((_ascEditState.mode === 'insert' ? 'Insert new row?' : 'Save changes?') + '\n\nReason: ' + reason)) return;
  
  var btn = document.getElementById('ascSaveRowBtn');
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving...';
  
  try {
    var res;
    
    if (_ascEditState.mode === 'insert') {
      res = await fetch(erpUrl(_ascEditState.tableName), {
        method: 'POST',
        headers: erpHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(fields)
      });
    } else {
      var rowId = _ascEditState.originalRow.id;
      res = await fetch(erpUrl(_ascEditState.tableName + '?id=eq.' + rowId), {
        method: 'PATCH',
        headers: erpHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(fields)
      });
    }
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText.substring(0, 200));
    }
    
    var result = await res.json();
    
    await ascLogAction(
      _ascEditState.mode === 'insert' ? 'INSERT' : 'UPDATE',
      _ascEditState.tableName,
      _ascEditState.mode === 'edit' ? _ascEditState.originalRow.id : (result[0] && result[0].id),
      _ascEditState.mode === 'edit' ? _ascEditState.originalRow : null,
      fields,
      reason
    );
    
    erpShowToast(_ascEditState.mode === 'insert' ? '✅ Row inserted' : '✅ Row updated', 'success');
    
    ascCloseEditRow();
    await ascFetchTableData();
    await ascLoadRecentActions();
    
  } catch(err) {
    console.error('[ascSaveRow]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

window.ascSaveRow = ascSaveRow;

function ascCloseEditRow() {
  if (_asc.editRowModal) _asc.editRowModal.hide();
}

window.ascCloseEditRow = ascCloseEditRow;

// ═══════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════
var _ascDeleteInfo = { rowId: null, rowData: null, tableName: '' };

function ascOpenDeleteModal(rowId) {
  if (_asc.accessMode === 'readonly') {
    erpShowToast('Read-Only mode', 'warning');
    return;
  }
  
  if (!_asc.currentTable) return;
  
  var row = _asc.currentData.find(function(r) {
    var id = r.id || r.item_code || r.doc_no || '';
    return String(id) === String(rowId);
  });
  
  if (!row) {
    erpShowToast('Row not found', 'warning');
    return;
  }
  
  ascCheckDependencies(_asc.currentTable, row).then(function(deps) {
    _ascDeleteInfo = { rowId: rowId, rowData: row, tableName: _asc.currentTable, dependencies: deps };
    
    var msgEl = document.getElementById('ascDeleteMessage');
    if (msgEl) {
      var html = 'Delete <code>' + ascEsc(String(rowId)) + '</code> from <code>' + ascEsc(_asc.currentTable) + '</code>?';
      
      if (deps.length > 0) {
        html += '<div class="alert alert-danger small mt-2 mb-0">' +
          '<strong>⚠️ May dependencies:</strong>' +
          '<ul class="mb-0 mt-1 ps-3">';
        deps.forEach(function(d) {
          html += '<li>' + d.count + ' related row(s) sa <code>' + ascEsc(d.table) + '</code></li>';
        });
        html += '</ul>' +
          '<div class="mt-2 small">Ang related rows ay <strong>hindi</strong> awtomatikong mabubura.</div>' +
          '</div>';
      }
      
      msgEl.innerHTML = html;
    }
    
    var reasonEl = document.getElementById('ascDeleteReason');
    if (reasonEl) reasonEl.value = '';
    
    _asc.deleteModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('ascDeleteModal'));
    _asc.deleteModal.show();
  });
}

window.ascOpenDeleteModal = ascOpenDeleteModal;

async function ascCheckDependencies(tableName, row) {
  var deps = [];
  
  var FK_MAP = {
    'documents': [{ table: 'doc_items', column: 'doc_no', rowCol: 'doc_no' }],
    'prf_documents': [{ table: 'prf_items', column: 'prf_no', rowCol: 'prf_no' }],
    'users': [{ table: 'edit_requests', column: 'requested_by', rowCol: 'username' }],
    'erp_items': [
      { table: 'doc_items', column: 'item_code', rowCol: 'item_code' },
      { table: 'prf_items', column: 'item_code', rowCol: 'item_code' }
    ]
  };
  
  var checks = FK_MAP[tableName] || [];
  
  for (var i = 0; i < checks.length; i++) {
    var check = checks[i];
    var val = row[check.rowCol];
    if (!val) continue;
    
    try {
      var res = await fetch(erpUrl(check.table) + 
        '?select=id&' + check.column + '=eq.' + encodeURIComponent(val) + '&limit=1',
        {
          method: 'HEAD',
          headers: Object.assign({}, erpHeaders(), {
            'Prefer': 'count=exact',
            'Range': '0-0'
          })
        });
      
      var range = res.headers.get('content-range') || '';
      var m = range.match(/\/(\d+)/);
      var count = m ? parseInt(m[1], 10) : 0;
      
      if (count > 0) deps.push({ table: check.table, column: check.column, count: count });
    } catch(e) {}
  }
  
  return deps;
}

async function ascConfirmDelete() {
  var reasonEl = document.getElementById('ascDeleteReason');
  var reason = reasonEl ? reasonEl.value.trim() : '';
  
  if (!reason) {
    erpShowToast('Reason is required', 'warning');
    return;
  }
  
  var info = _ascDeleteInfo;
  if (!info.tableName || !info.rowId) return;
  
  if (!confirm('Soft delete this row?\n\nClick OK to proceed (recoverable via is_deleted = true)')) return;
  
  try {
    var patchBody = {
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: _asc.currentFullname
    };
    
    var columns = _ascEditState.columns.length ? _ascEditState.columns : await ascGetTableSchema(info.tableName);
    var hasIsDeleted = columns.some(function(c) { return c.name === 'is_deleted'; });
    
    if (!hasIsDeleted) {
      var proceed = confirm('⚠️ Walang `is_deleted` column sa ' + info.tableName + '.\n\nClick OK = HARD DELETE (permanent)\nClick Cancel = cancel');
      if (!proceed) return;
      
      var delRes = await fetch(erpUrl(info.tableName + '?id=eq.' + info.rowId), {
        method: 'DELETE',
        headers: erpHeaders()
      });
      
      if (!delRes.ok) throw new Error('HTTP ' + delRes.status);
      
      await ascLogAction('HARD_DELETE', info.tableName, info.rowId, info.rowData, null, reason);
      erpShowToast('✅ Row permanently deleted', 'success');
    } else {
      var res = await fetch(erpUrl(info.tableName + '?id=eq.' + info.rowId), {
        method: 'PATCH',
        headers: erpHeaders(),
        body: JSON.stringify(patchBody)
      });
      
      if (!res.ok) throw new Error('HTTP ' + res.status);
      
      await ascLogAction('SOFT_DELETE', info.tableName, info.rowId, info.rowData, patchBody, reason);
      erpShowToast('✅ Row soft-deleted', 'success');
    }
    
    ascCloseDelete();
    await ascFetchTableData();
    await ascLoadRecentActions();
    
  } catch(err) {
    console.error('[ascConfirmDelete]', err);
    erpShowToast('Failed: ' + err.message, 'danger');
  }
}

window.ascConfirmDelete = ascConfirmDelete;

function ascCloseDelete() {
  if (_asc.deleteModal) _asc.deleteModal.hide();
  _ascDeleteInfo = { rowId: null, rowData: null, tableName: '' };
}

window.ascCloseDelete = ascCloseDelete;

// ═══════════════════════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════════════════════
async function ascCsvExport() {
  var sel = document.getElementById('ascCsvExportTable');
  if (!sel) return;
  
  var table = sel.value;
  if (!table) {
    erpShowToast('Pumili ng table', 'warning');
    return;
  }
  
  erpShowToast('📤 Exporting ' + table + '...', 'info');
  
  try {
    var allRows = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;
    
    while (hasMore) {
      var rows = await erpFetch(table, 'select=*&limit=' + pageSize + '&offset=' + offset);
      if (!rows || rows.length === 0) break;
      allRows = allRows.concat(rows);
      offset += rows.length;
      if (rows.length < pageSize) hasMore = false;
    }
    
    if (allRows.length === 0) {
      erpShowToast('Walang data to export', 'warning');
      return;
    }
    
    var headers = Object.keys(allRows[0]);
    var csv = headers.map(ascCsvEscape).join(',') + '\n';
    
    allRows.forEach(function(row) {
      csv += headers.map(function(h) { return ascCsvEscape(row[h]); }).join(',') + '\n';
    });
    
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = table + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    
    erpShowToast('✅ Exported ' + allRows.length + ' rows', 'success');
    
  } catch(err) {
    erpShowToast('Export failed: ' + err.message, 'danger');
  }
}

window.ascCsvExport = ascCsvExport;

function ascCsvEscape(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// CSV IMPORT
// ═══════════════════════════════════════════════════════════
var _ascCsvImportData = null;

async function ascCsvPreview(event) {
  if (_asc.accessMode === 'readonly') {
    erpShowToast('Read-Only mode', 'warning');
    event.target.value = '';
    return;
  }
  
  var file = event.target.files[0];
  if (!file) return;
  
  var tableSel = document.getElementById('ascCsvImportTable');
  var table = tableSel ? tableSel.value : '';
  
  if (!table) {
    erpShowToast('Pumili muna ng target table', 'warning');
    event.target.value = '';
    return;
  }
  
  var previewArea = document.getElementById('ascCsvPreviewArea');
  if (previewArea) {
    previewArea.innerHTML = '<div class="alert alert-info small py-2">Parsing CSV...</div>';
  }
  
  try {
    var text = await file.text();
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    
    if (lines.length < 2) throw new Error('CSV needs header + at least 1 data row');
    
    var headers = ascCsvParseLine(lines[0]);
    var rows = [];
    
    for (var i = 1; i < lines.length; i++) {
      var vals = ascCsvParseLine(lines[i]);
      var row = {};
      headers.forEach(function(h, idx) {
        row[h.trim()] = vals[idx] !== undefined ? vals[idx] : null;
      });
      rows.push(row);
    }
    
    _ascCsvImportData = { table: table, headers: headers.map(function(h) { return h.trim(); }), rows: rows };
    
    ascRenderCsvPreview();
    
  } catch(err) {
    if (previewArea) {
      previewArea.innerHTML = '<div class="alert alert-danger small py-2">' +
        'Parse error: ' + ascEsc(err.message) + '</div>';
    }
  }
}

window.ascCsvPreview = ascCsvPreview;

function ascCsvParseLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    
    if (c === '"') {
      if (inQuotes && line[i+1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else current += c;
  }
  
  result.push(current);
  return result;
}

function ascRenderCsvPreview() {
  var previewArea = document.getElementById('ascCsvPreviewArea');
  if (!previewArea || !_ascCsvImportData) return;
  
  var d = _ascCsvImportData;
  
  var html = '<div class="alert alert-success small py-2 mb-2">' +
    '✅ Parsed: <strong>' + d.rows.length + ' rows</strong> · ' + d.headers.length + ' columns' +
    '</div>';
  
  html += '<div class="table-responsive" style="max-height:300px;overflow-y:auto;margin-bottom:12px;">';
  html += '<table class="table table-sm table-bordered" style="font-size:0.78rem;">';
  html += '<thead class="table-light"><tr>';
  d.headers.forEach(function(h) { html += '<th>' + ascEsc(h) + '</th>'; });
  html += '</tr></thead><tbody>';
  
  d.rows.slice(0, 20).forEach(function(row) {
    html += '<tr>';
    d.headers.forEach(function(h) {
      html += '<td>' + ascEsc(String(row[h] || '').substring(0, 40)) + '</td>';
    });
    html += '</tr>';
  });
  
  html += '</tbody></table></div>';
  
  if (d.rows.length > 20) {
    html += '<div class="small text-muted mb-2">Showing first 20 of ' + d.rows.length + ' rows</div>';
  }
  
  html += '<div class="d-flex gap-2">' +
    '<button class="btn btn-success btn-sm" onclick="ascCsvImportConfirm()">' +
      '<i class="bi bi-check-circle me-1"></i>Import ' + d.rows.length + ' rows' +
    '</button>' +
    '<button class="btn btn-outline-secondary btn-sm" onclick="ascCsvImportCancel()">Cancel</button>' +
    '</div>';
  
  previewArea.innerHTML = html;
}

async function ascCsvImportConfirm() {
  if (!_ascCsvImportData) return;
  
  var d = _ascCsvImportData;
  
  var reason = prompt('Reason for this import:', 'CSV bulk import');
  if (!reason || !reason.trim()) return;
  
  if (!confirm('Import ' + d.rows.length + ' rows to ' + d.table + '?\n\nReason: ' + reason)) return;
  
  var previewArea = document.getElementById('ascCsvPreviewArea');
  if (previewArea) {
    previewArea.innerHTML = '<div class="alert alert-info small py-2">' +
      '<span class="spinner-border spinner-border-sm me-1"></span>Importing...</div>';
  }
  
  try {
    var success = 0;
    var failed = 0;
    var errors = [];
    var batchSize = 100;
    
    for (var i = 0; i < d.rows.length; i += batchSize) {
      var batch = d.rows.slice(i, i + batchSize);
      
      try {
        var res = await fetch(erpUrl(d.table), {
          method: 'POST',
          headers: erpHeaders({ 'Prefer': 'return=minimal' }),
          body: JSON.stringify(batch)
        });
        
        if (res.ok) success += batch.length;
        else {
          failed += batch.length;
          var errText = await res.text();
          errors.push('Batch ' + Math.floor(i / batchSize) + ': ' + errText.substring(0, 100));
        }
      } catch(e) {
        failed += batch.length;
        errors.push('Batch ' + Math.floor(i / batchSize) + ': ' + e.message);
      }
    }
    
    await ascLogAction('INSERT', d.table, null, null, { 
      rows_imported: success, rows_failed: failed 
    }, reason);
    
    var msg = '✅ Import complete: ' + success + ' success, ' + failed + ' failed.';
    if (errors.length > 0) msg += '\n\nErrors:\n' + errors.slice(0, 3).join('\n');
    
    alert(msg);
    
    _ascCsvImportData = null;
    if (previewArea) previewArea.innerHTML = '';
    var fileInput = document.getElementById('ascCsvFile');
    if (fileInput) fileInput.value = '';
    
    if (_asc.currentTable === d.table) await ascFetchTableData();
    
  } catch(err) {
    erpShowToast('Import failed: ' + err.message, 'danger');
  }
}

window.ascCsvImportConfirm = ascCsvImportConfirm;

function ascCsvImportCancel() {
  _ascCsvImportData = null;
  var previewArea = document.getElementById('ascCsvPreviewArea');
  if (previewArea) previewArea.innerHTML = '';
  var fileInput = document.getElementById('ascCsvFile');
  if (fileInput) fileInput.value = '';
}

window.ascCsvImportCancel = ascCsvImportCancel;

async function ascExportCurrentTable() {
  if (!_asc.currentTable) {
    erpShowToast('Pumili muna ng table', 'warning');
    return;
  }
  
  var sel = document.getElementById('ascCsvExportTable');
  if (sel) sel.value = _asc.currentTable;
  
  ascSwitchTab('csv');
  setTimeout(function() { ascCsvExport(); }, 300);
}

window.ascExportCurrentTable = ascExportCurrentTable;

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function ascNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US');
}

function ascEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ascJsEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function ascFormatBytes(bytes) {
  if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
}

// ═══════════════════════════════════════════════════════════
// AUTO-REFRESH
// ═══════════════════════════════════════════════════════════
setInterval(function() {
  if (document.hidden) return;
  var dashTab = document.getElementById('tab-dashboard');
  if (dashTab && dashTab.classList.contains('active')) {
    ascLoadRecentActions();
  }
}, 60000);

console.log('✅ admin-supabase.js v1.1 loaded (Phase 1 + 2 + Backup Filter)');
