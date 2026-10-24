// ============================================================
// GEMCOR ERP — System Health Dashboard (v1.0)
// Admin-only monitoring for system uptime & performance
// ============================================================

var _sh = {
  pingHistory: [],
  maxPingHistory: 10,
  refreshTimer: null,
  REFRESH_INTERVAL: 120000,  // 2mins lang baka bumagal system para lang jan eh
  errorLog: [],
  lastCheck: null
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[System Health v1.0] Initializing...');

  shCheckHealth();
  shRefreshAll();
  shLoadClientInfo();

  // Auto-refresh
  shStartAutoRefresh();

  // Pause when tab hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      shStopAutoRefresh();
    } else {
      shStartAutoRefresh();
      shRefreshAll();
    }
  });

  // Capture global errors
  window.addEventListener('error', function(e) {
    shLogError('JS Error', e.message, e.filename + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e) {
    shLogError('Promise Rejection', String(e.reason), '');
  });
});

async function shCheckHealth() {
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
// REFRESH ALL
// ═══════════════════════════════════════════════════════════
async function shRefreshAll() {
  _sh.lastCheck = new Date();
  document.getElementById('shLastCheck').textContent = _sh.lastCheck.toLocaleTimeString();

  // Run in parallel
  await Promise.allSettled([
    shCheckApi(),
    shCheckDatabase(),
    shCheckCache(),
    shLoadErrors(),
    shLoadSessions()
  ]);

  shUpdateOverallStatus();
}

async function shRefresh() {
  erpShowToast('Refreshing health check...', 'info');
  await shRefreshAll();
  await shCheckHealth();
}

// ═══════════════════════════════════════════════════════════
// API HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function shCheckApi() {
  var card = document.getElementById('shCardApi');
  var latencyEl = document.getElementById('shApiLatency');
  var statusEl = document.getElementById('shApiStatus');
  var dotEl = document.getElementById('shDotApi');

  var t0 = Date.now();
  var success = false;
  var latency = 0;

  try {
    var res = await fetch(erpUrl('erp_items') + '?select=id&limit=1', {
      headers: erpHeaders(),
      cache: 'no-store'
    });
    success = res.ok;
    latency = Date.now() - t0;
  } catch (err) {
    latency = Date.now() - t0;
    success = false;
  }

  // Update card
  var status = 'ok';
  if (!success) status = 'critical';
  else if (latency > 1500) status = 'critical';
  else if (latency > 500) status = 'warning';

  if (card) card.className = 'health-card ' + status;
  if (dotEl) dotEl.className = 'status-dot ' + status;
  if (latencyEl) {
    latencyEl.className = 'health-card-value ' + status;
    latencyEl.textContent = success ? latency + 'ms' : 'ERROR';
  }
  if (statusEl) {
    if (!success) statusEl.textContent = 'Connection failed';
    else if (latency > 1500) statusEl.textContent = 'Very slow';
    else if (latency > 500) statusEl.textContent = 'Acceptable';
    else statusEl.textContent = 'Fast response';
  }

  // Track ping history
  shAddPingToHistory(latency, success);
}

function shAddPingToHistory(latency, success) {
  _sh.pingHistory.push({ latency: latency, success: success, ts: Date.now() });
  if (_sh.pingHistory.length > _sh.maxPingHistory) {
    _sh.pingHistory.shift();
  }
  shRenderPingBars();
}

function shRenderPingBars() {
  var barsEl = document.getElementById('shPingBars');
  var avgEl = document.getElementById('shPingAvg');
  if (!barsEl) return;

  if (_sh.pingHistory.length === 0) {
    barsEl.innerHTML = '<div class="text-muted small">No data yet</div>';
    return;
  }

  // Compute average
  var validPings = _sh.pingHistory.filter(function(p) { return p.success; });
  var avg = validPings.length > 0 
    ? Math.round(validPings.reduce(function(s, p) { return s + p.latency; }, 0) / validPings.length)
    : 0;
  if (avgEl) avgEl.textContent = avg + 'ms avg';

  // Max for scaling
  var maxLatency = Math.max.apply(null, _sh.pingHistory.map(function(p) { return p.latency; })) || 1;

  var html = '';
  _sh.pingHistory.forEach(function(p) {
    var height = p.success 
      ? Math.max(4, Math.min(20, (p.latency / maxLatency) * 20))
      : 20;
    var cls = 'ping-bar';
    if (!p.success) cls += ' error';
    else if (p.latency > 1000) cls += ' error';
    else if (p.latency > 500) cls += ' slow';
    html += '<div class="' + cls + '" style="height:' + height + 'px;" ' +
      'title="' + (p.success ? p.latency + 'ms' : 'Failed') + '"></div>';
  });
  barsEl.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// DATABASE CHECK
// ═══════════════════════════════════════════════════════════
async function shCheckDatabase() {
  var card = document.getElementById('shCardDb');
  var tablesEl = document.getElementById('shDbTables');
  var rowsEl = document.getElementById('shDbRows');
  var dotEl = document.getElementById('shDotDb');
  var tbody = document.getElementById('shTablesBody');
  var countBadge = document.getElementById('shTableCount');

  // Tables to monitor
    var tables = [
    { name: 'erp_items', label: 'Items (ERP)', critical: true },
    { name: 'documents', label: 'Documents', critical: true },
    { name: 'doc_items', label: 'Doc Items', critical: false },
    { name: 'prf_documents', label: 'PRF Documents', critical: false },
    { name: 'prf_items', label: 'PRF Items', critical: false },
    { name: 'users', label: 'Users', critical: true },
    { name: 'vendors', label: 'Vendors', critical: false },
    { name: 'erp_sof_cache', label: 'SOF Cache', critical: false },
    { name: 'erp_prf_po_cache', label: 'PRF PO Cache', critical: false },
    { name: 'partial_items', label: 'Partial Items', critical: false }
  ];

  var results = [];
  var totalRows = 0;

  // ✅ Fetch with 10-second timeout per table
  await Promise.all(tables.map(async function(t) {
    try {
      var t0 = Date.now();
      var ctrl = new AbortController();
      var timeoutId = setTimeout(function() { ctrl.abort(); }, 10000);
      
      var res = await fetch(erpUrl(t.name) + '?select=id&limit=1', {
        method: 'HEAD',
        headers: {
          ...erpHeaders(),
          'Prefer': 'count=exact',
          'Range': '0-0'
        },
        cache: 'no-store',
        signal: ctrl.signal
      });
      
      clearTimeout(timeoutId);
      
      var range = res.headers.get('content-range') || '';
      var m = range.match(/\/(\d+)/);
      var count = m ? parseInt(m[1], 10) : 0;
      var latency = Date.now() - t0;
      results.push({ name: t.name, label: t.label, count: count, latency: latency, ok: true });
      totalRows += count;
    } catch (err) {
      results.push({ name: t.name, label: t.label, count: 0, latency: 0, ok: false, error: err.message });
    }
  }));

  // Sort by count desc
  results.sort(function(a, b) { return b.count - a.count; });

  // Find max for bar scaling
  var maxCount = Math.max.apply(null, results.map(function(r) { return r.count; })) || 1;

  // Update card
  var allOk = results.every(function(r) { return r.ok; });
  if (card) card.className = 'health-card ' + (allOk ? 'ok' : 'warning');
  if (dotEl) dotEl.className = 'status-dot ' + (allOk ? 'ok' : 'warning');
  if (tablesEl) {
    tablesEl.className = 'health-card-value ok';
    tablesEl.textContent = results.filter(function(r) { return r.ok; }).length + '/' + tables.length;
  }
  if (rowsEl) rowsEl.textContent = totalRows.toLocaleString() + ' total rows';
  if (countBadge) countBadge.textContent = results.length + ' tables';

  // Render table rows
  var html = '';
  results.forEach(function(r) {
    var barWidth = Math.max(4, Math.round((r.count / maxCount) * 100));
    html += '<tr>' +
      '<td>' +
        '<code style="font-size:0.78rem;">' + r.name + '</code>' +
        '<div class="small text-muted">' + r.label + '</div>' +
      '</td>' +
      '<td class="text-end fw-bold">' + (r.ok ? r.count.toLocaleString() : '—') + '</td>' +
      '<td>' +
        (r.ok 
          ? '<span class="table-size-bar" style="width:' + barWidth + '%"></span>' +
            '<small class="text-muted">' + r.latency + 'ms</small>'
          : '<small class="text-danger">Error</small>') +
      '</td>' +
    '</tr>';
  });
  if (tbody) tbody.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// CACHE CHECK
// ═══════════════════════════════════════════════════════════
function shCheckCache() {
  var card = document.getElementById('shCardCache');
  var sizeEl = document.getElementById('shCacheSize');
  var itemsEl = document.getElementById('shCacheItems');
  var dotEl = document.getElementById('shDotCache');

  var totalBytes = 0;
  var count = 0;

  try {
    Object.keys(localStorage).forEach(function(k) {
      if (k.indexOf('ivm_cache_') === 0 || k.indexOf('erp_cache_') === 0) {
        totalBytes += (localStorage.getItem(k) || '').length * 2;  // UTF-16
        count++;
      }
    });
  } catch (e) {}

  var sizeKB = (totalBytes / 1024).toFixed(1);
  var sizeMB = (totalBytes / 1024 / 1024).toFixed(2);

  // Status
  var status = 'ok';
  var bytesMB = totalBytes / 1024 / 1024;
  if (bytesMB > 5) status = 'critical';
  else if (bytesMB > 2) status = 'warning';

  if (card) card.className = 'health-card ' + status;
  if (dotEl) dotEl.className = 'status-dot ' + status;
  if (sizeEl) {
    sizeEl.className = 'health-card-value ' + status;
    sizeEl.textContent = bytesMB > 1 ? sizeMB + ' MB' : sizeKB + ' KB';
  }
  if (itemsEl) {
    itemsEl.textContent = count + ' items cached';
  }
}

// ═══════════════════════════════════════════════════════════
// ERROR LOG
// ═══════════════════════════════════════════════════════════
function shLogError(type, message, source) {
  _sh.errorLog.push({
    type: type,
    message: String(message || '').substring(0, 500),
    source: String(source || '').substring(0, 200),
    ts: Date.now(),
    user: localStorage.getItem('ivm_username') || 'unknown'
  });
  
  // Keep only last 50
  if (_sh.errorLog.length > 50) _sh.errorLog.shift();
  
  // Save to localStorage
  try {
    localStorage.setItem('ivm_errorLog', JSON.stringify(_sh.errorLog.slice(-20)));
  } catch (e) {}
  
  shLoadErrors();
}

function shLoadErrors() {
  var listEl = document.getElementById('shErrorsList');
  var countEl = document.getElementById('shErrorCount');
  var statusEl = document.getElementById('shErrorStatus');
  var cardEl = document.getElementById('shCardErrors');
  var dotEl = document.getElementById('shDotErrors');

  // Load from localStorage
  try {
    var stored = JSON.parse(localStorage.getItem('ivm_errorLog') || '[]');
    _sh.errorLog = stored;
  } catch (e) {
    _sh.errorLog = [];
  }

  // Filter last 24h
  var cutoff = Date.now() - 24 * 60 * 60 * 1000;
  var recent = _sh.errorLog.filter(function(e) { return e.ts >= cutoff; });

  // Update card
  var status = 'ok';
  if (recent.length > 20) status = 'critical';
  else if (recent.length > 5) status = 'warning';
  
  if (cardEl) cardEl.className = 'health-card ' + status;
  if (dotEl) dotEl.className = 'status-dot ' + status;
  if (countEl) {
    countEl.className = 'health-card-value ' + status;
    countEl.textContent = recent.length;
  }
  if (statusEl) {
    statusEl.textContent = recent.length === 0 
      ? 'No errors' 
      : recent.length + ' error(s) found';
  }

  // Render list
  if (!listEl) return;
  if (recent.length === 0) {
    listEl.innerHTML = '<div class="text-muted small text-center py-3">' +
      '<i class="bi bi-check-circle-fill text-success me-1"></i>' +
      'No errors in the last 24 hours</div>';
    return;
  }

  var html = '';
  recent.slice(-20).reverse().forEach(function(e) {
    var ts = new Date(e.ts).toLocaleString();
    html += '<div class="alert alert-danger py-2 px-3 mb-2 small">' +
      '<div class="d-flex justify-content-between mb-1">' +
        '<strong><i class="bi bi-exclamation-triangle-fill me-1"></i>' + escSH(e.type) + '</strong>' +
        '<small class="text-muted">' + escSH(ts) + '</small>' +
      '</div>' +
      '<div>' + escSH(e.message) + '</div>' +
      (e.source ? '<div class="text-muted mt-1" style="font-size:0.72rem;">' + escSH(e.source) + '</div>' : '') +
      '<div class="text-muted mt-1" style="font-size:0.7rem;">User: ' + escSH(e.user) + '</div>' +
    '</div>';
  });
  listEl.innerHTML = html;
}

function shClearErrors() {
  if (!confirm('Clear all local error logs?')) return;
  _sh.errorLog = [];
  try { localStorage.removeItem('ivm_errorLog'); } catch (e) {}
  shLoadErrors();
  erpShowToast('Error logs cleared', 'success');
}

// ═══════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════
async function shLoadSessions() {
  var listEl = document.getElementById('shSessionsList');
  if (!listEl) return;

  // Since sessions are per-browser (localStorage is local), we can't see other users' sessions
  // Instead, we'll show recent login history from audit log
  try {
    var logs = await erpFetch('user_audit_log',
      'select=*&action=eq.CREATED&order=created_at.desc&limit=5').catch(function() { return []; });

    var html = '';
    html += '<div class="alert alert-info small py-2 mb-3">' +
      '<i class="bi bi-info-circle me-1"></i>' +
      '<strong>Note:</strong> Cross-user sessions ay hindi available via frontend. ' +
      'Ito ay current user info lang.' +
    '</div>';

    html += '<div class="row g-2 small">' +
      '<div class="col-md-6"><strong>Current User:</strong> ' + 
        escSH(localStorage.getItem('ivm_userFullname') || 'Not logged in') + '</div>' +
      '<div class="col-md-6"><strong>Role:</strong> ' + 
        escSH(localStorage.getItem('ivm_userRole') || '—') + '</div>' +
      '<div class="col-md-6"><strong>Is Admin:</strong> ' + 
        (localStorage.getItem('ivm_isAdmin') === 'true' ? '✅ Yes' : '❌ No') + '</div>' +
      '<div class="col-md-6"><strong>Session Storage:</strong> ' + 
        Object.keys(sessionStorage).length + ' items</div>' +
      '<div class="col-md-6"><strong>LocalStorage:</strong> ' + 
        Object.keys(localStorage).length + ' items</div>' +
      '<div class="col-md-6"><strong>Cookies:</strong> ' + 
        (navigator.cookieEnabled ? '✅ Enabled' : '❌ Disabled') + '</div>' +
    '</div>';

    listEl.innerHTML = html;

  } catch (err) {
    listEl.innerHTML = '<div class="text-muted small text-center py-3">' +
      'Could not load session info: ' + escSH(err.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════
// CLIENT INFO
// ═══════════════════════════════════════════════════════════
function shLoadClientInfo() {
  try {
    // Browser
    var ua = navigator.userAgent;
    var browser = 'Unknown';
    if (ua.indexOf('Chrome') !== -1) browser = 'Chrome';
    else if (ua.indexOf('Firefox') !== -1) browser = 'Firefox';
    else if (ua.indexOf('Safari') !== -1) browser = 'Safari';
    else if (ua.indexOf('Edge') !== -1) browser = 'Edge';
    
    // Version
    var m = ua.match(/(Chrome|Firefox|Safari|Edge)\/([\d.]+)/);
    if (m) browser += ' ' + m[2].split('.')[0];
    
    document.getElementById('shClientBrowser').textContent = browser;
    
    // Platform
    var platform = navigator.platform || 'Unknown';
    if (/Win/.test(platform)) platform = 'Windows';
    else if (/Mac/.test(platform)) platform = 'macOS';
    else if (/Linux/.test(platform)) platform = 'Linux';
    else if (/iPhone|iPad/.test(platform)) platform = 'iOS';
    else if (/Android/.test(platform)) platform = 'Android';
    document.getElementById('shClientPlatform').textContent = platform;
    
    // Screen
    document.getElementById('shClientScreen').textContent = 
      window.screen.width + '×' + window.screen.height;
    
    // Online
    var onlineEl = document.getElementById('shClientOnline');
    var onlineText = navigator.onLine ? '✅ Online' : '❌ Offline';
    onlineEl.textContent = onlineText;
    onlineEl.className = 'fw-bold ' + (navigator.onLine ? 'text-success' : 'text-danger');
    
       // Connection
    var connEl = document.getElementById('shClientConnection');
    if (navigator.connection) {
      var c = navigator.connection;
      var connInfo = (c.effectiveType || 'unknown');
      if (c.downlink) connInfo += ' · ' + c.downlink + ' Mbps';
      if (c.rtt) connInfo += ' · ' + c.rtt + 'ms RTT';
      connEl.textContent = connInfo;
    } else {
      // Fallback: use API latency
      connEl.textContent = 'Detecting...';
      setTimeout(function() {
        if (_sh.pingHistory.length > 0) {
          var lastPing = _sh.pingHistory[_sh.pingHistory.length - 1];
          connEl.textContent = '~' + lastPing.latency + 'ms (API)';
        } else {
          connEl.textContent = 'Not available';
        }
      }, 1000);
    }
    
    // Timezone
    document.getElementById('shClientTimezone').textContent = 
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Memory
    var memEl = document.getElementById('shClientMemory');
    if (performance.memory) {
      var usedMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
      var limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
      memEl.textContent = usedMB + ' / ' + limitMB + ' MB';
    } else {
      memEl.textContent = 'Not available';
    }
    
    // Service Worker
    var swEl = document.getElementById('shClientSW');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(function(reg) {
        swEl.textContent = reg ? '✅ Active' : '❌ Not registered';
      }).catch(function() {
        swEl.textContent = '⚠️ Error';
      });
    } else {
      swEl.textContent = '❌ Not supported';
    }
    
  } catch (e) {
    console.warn('[System Health] Client info error:', e);
  }
}

// ═══════════════════════════════════════════════════════════
// OVERALL STATUS
// ═══════════════════════════════════════════════════════════
function shUpdateOverallStatus() {
  var banner = document.getElementById('shOverallBanner');
  var icon = document.getElementById('shOverallIcon');
  var title = document.getElementById('shOverallTitle');
  var subtitle = document.getElementById('shOverallSubtitle');

  // Get all statuses
  var statuses = [];
  ['shCardApi', 'shCardDb', 'shCardCache', 'shCardErrors'].forEach(function(id) {
    var card = document.getElementById(id);
    if (!card) return;
    if (card.classList.contains('critical')) statuses.push('critical');
    else if (card.classList.contains('warning')) statuses.push('warning');
    else statuses.push('ok');
  });

  var overall = 'ok';
  if (statuses.indexOf('critical') !== -1) overall = 'critical';
  else if (statuses.indexOf('warning') !== -1) overall = 'warning';

  // Update banner
  if (overall === 'critical') {
    if (banner) {
      banner.style.background = 'linear-gradient(135deg,#fef2f2 0%,#fee2e2 100%)';
      banner.style.borderLeftColor = '#dc2626';
    }
    if (icon) { icon.className = 'bi bi-x-octagon-fill'; icon.style.color = '#dc2626'; }
    if (title) { title.textContent = 'System Has Issues'; title.style.color = '#991b1b'; }
    if (subtitle) { subtitle.textContent = 'May critical errors — i-check ang details below'; subtitle.style.color = '#b91c1c'; }
  } else if (overall === 'warning') {
    if (banner) {
      banner.style.background = 'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)';
      banner.style.borderLeftColor = '#f59e0b';
    }
    if (icon) { icon.className = 'bi bi-exclamation-triangle-fill'; icon.style.color = '#f59e0b'; }
    if (title) { title.textContent = 'System Needs Attention'; title.style.color = '#92400e'; }
    if (subtitle) { subtitle.textContent = 'May warnings — i-monitor ang details'; subtitle.style.color = '#a16207'; }
  } else {
    if (banner) {
      banner.style.background = 'linear-gradient(135deg,#f0fdf4 0%,#d1fae5 100%)';
      banner.style.borderLeftColor = '#10b981';
    }
    if (icon) { icon.className = 'bi bi-shield-check'; icon.style.color = '#10b981'; }
    if (title) { title.textContent = 'All Systems Operational'; title.style.color = '#065f46'; }
    if (subtitle) { subtitle.textContent = 'Running smoothly · Last check: ' + 
      (_sh.lastCheck ? _sh.lastCheck.toLocaleTimeString() : '—'); subtitle.style.color = '#047857'; }
  }

  // Uptime (simple % from ping history)
  var uptimeEl = document.getElementById('shUptime');
  if (uptimeEl && _sh.pingHistory.length > 0) {
    var success = _sh.pingHistory.filter(function(p) { return p.success; }).length;
    var pct = Math.round((success / _sh.pingHistory.length) * 100);
    uptimeEl.textContent = pct + '%';
  }
}

// ═══════════════════════════════════════════════════════════
// AUTO REFRESH
// ═══════════════════════════════════════════════════════════
function shStartAutoRefresh() {
  shStopAutoRefresh();
  _sh.refreshTimer = setInterval(function() {
    if (!document.hidden) {
      shRefreshAll();
    }
  }, _sh.REFRESH_INTERVAL);
}

function shStopAutoRefresh() {
  if (_sh.refreshTimer) {
    clearInterval(_sh.refreshTimer);
    _sh.refreshTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function escSH(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// Expose globally
window.shRefresh = shRefresh;
window.shClearErrors = shClearErrors;

console.log('✅ system-health.js v1.0 loaded');

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// ═══ SYSTEM HEALTH — ENHANCED MODULE ═══
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════

console.log('📌 Loading System Health Enhancements...');

// ═══════════════════════════════════════════════════════════
// ENHANCED STATE
// ═══════════════════════════════════════════════════════════
var _shEnhanced = {
  dbSize: null,
  tableSizes: [],
  tableCounts: {},
  backups: [],
  isExecuting: false,
  storageHistory: []
};

// ═══════════════════════════════════════════════════════════
// STORAGE MONITORING
// ═══════════════════════════════════════════════════════════
async function shLoadStorage() {
  try {
    var res = await fetch(erpUrl('rpc/admin_get_db_size'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({})
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    var data = await res.json();
    _shEnhanced.dbSize = data;

    shRenderStorage(data);

    // Save to history para sa growth tracking
    shSaveStorageHistory(data);

  } catch(err) {
    console.warn('[shLoadStorage]', err.message);
  }
}

function shRenderStorage(data) {
  if (!data) return;

  var sizeMB = Number(data.size_mb || 0);
  var limitMB = Number(data.limit_mb || 500);
  var percent = Number(data.percent_used || 0);
  var remainingMB = Number(data.remaining_mb || 0);

  // Update KPI cards
  var sizeEl = document.getElementById('shDbSize');
  if (sizeEl) sizeEl.textContent = shFormatSize(sizeMB);

  var percentEl = document.getElementById('shDbSizePercent');
  if (percentEl) percentEl.textContent = percent.toFixed(2) + '% of ' + limitMB + ' MB';

  var availEl = document.getElementById('shDbAvailable');
  if (availEl) availEl.textContent = shFormatSize(remainingMB);

  // Growth rate (compute from history)
  var growth = shComputeGrowthRate();
  var growthEl = document.getElementById('shDbGrowth');
  if (growthEl) growthEl.textContent = growth.rate > 0 ? '+' + growth.rate.toFixed(2) + ' MB/wk' : '—';

  // Estimated full date
  var fullEstEl = document.getElementById('shDbFullEstimate');
  if (fullEstEl) {
    if (growth.rate > 0) {
      var weeksLeft = remainingMB / growth.rate;
      var yearsLeft = weeksLeft / 52;
      if (yearsLeft > 1) {
        fullEstEl.textContent = yearsLeft.toFixed(1) + ' years';
      } else {
        fullEstEl.textContent = Math.round(weeksLeft) + ' weeks';
      }
    } else {
      fullEstEl.textContent = '—';
    }
  }

  // Progress bar
  var bar = document.getElementById('shDbBar');
  var barLabel = document.getElementById('shDbBarLabel');
  if (bar) {
    bar.style.width = Math.min(percent, 100) + '%';
    bar.className = percent >= 90 ? 'critical' : (percent >= 70 ? 'warning' : 'ok');
  }
  if (barLabel) {
    barLabel.textContent = sizeMB.toFixed(2) + ' MB used';
  }

  // Color states
  var storageCard = document.getElementById('shStorageCard');
  var storageDot = document.getElementById('shStorageDot');
  if (storageCard) {
    storageCard.className = 'health-card ' + (percent >= 90 ? 'critical' : (percent >= 70 ? 'warning' : 'ok'));
  }
  if (storageDot) {
    storageDot.className = 'status-dot ' + (percent >= 90 ? 'critical' : (percent >= 70 ? 'warning' : 'ok'));
  }

  // Warning box
  var warningBox = document.getElementById('shStorageWarning');
  var warningTitle = document.getElementById('shStorageWarningTitle');
  var warningText = document.getElementById('shStorageWarningText');

  if (warningBox) {
    if (percent >= 90) {
      warningBox.style.display = 'block';
      warningBox.style.background = '#fef2f2';
      warningBox.style.borderLeftColor = '#dc2626';
      warningBox.style.color = '#991b1b';
      if (warningTitle) warningTitle.textContent = '🔴 CRITICAL: Storage Almost Full';
      if (warningText) warningText.textContent = 'Nasa ' + percent.toFixed(1) + '% na ang database. Mag-cleanup na o mag-upgrade sa Pro plan.';
    } else if (percent >= 70) {
      warningBox.style.display = 'block';
      warningBox.style.background = '#fffbeb';
      warningBox.style.borderLeftColor = '#f59e0b';
      warningBox.style.color = '#92400e';
      if (warningTitle) warningTitle.textContent = '⚠️ WARNING: Storage Getting Full';
      if (warningText) warningText.textContent = 'Nasa ' + percent.toFixed(1) + '% na ang database. I-cleanup ang old data.';
    } else {
      warningBox.style.display = 'none';
    }
  }

  // Trend badge
  var trendEl = document.getElementById('shDbSizeTrend');
  if (trendEl) {
    if (percent < 50) {
      trendEl.textContent = '✅ Healthy';
      trendEl.className = 'badge bg-success';
    } else if (percent < 70) {
      trendEl.textContent = '⚠️ Moderate';
      trendEl.className = 'badge bg-info';
    } else if (percent < 90) {
      trendEl.textContent = '⚠️ Getting Full';
      trendEl.className = 'badge bg-warning text-dark';
    } else {
      trendEl.textContent = '🔴 Critical';
      trendEl.className = 'badge bg-danger';
    }
  }
}

function shFormatSize(mb) {
  if (mb < 1) return (mb * 1024).toFixed(0) + ' KB';
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(2) + ' MB';
}

// ═══════════════════════════════════════════════════════════
// GROWTH TRACKING (via localStorage)
// ═══════════════════════════════════════════════════════════
function shSaveStorageHistory(data) {
  try {
    var history = shGetStorageHistory();
    var now = Date.now();

    // Only save if 1 hour+ since last save
    if (history.length > 0 && (now - history[history.length - 1].ts) < 3600000) {
      return;
    }

    history.push({
      ts: now,
      size: Number(data.size_mb || 0)
    });

    // Keep last 100 entries
    if (history.length > 100) history.shift();

    localStorage.setItem('ivm_storageHistory', JSON.stringify(history));
    _shEnhanced.storageHistory = history;

  } catch(e) {}
}

function shGetStorageHistory() {
  try {
    var raw = localStorage.getItem('ivm_storageHistory');
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function shComputeGrowthRate() {
  var history = shGetStorageHistory();
  if (history.length < 2) return { rate: 0 };

  var first = history[0];
  var last = history[history.length - 1];
  var weeksDiff = (last.ts - first.ts) / (7 * 24 * 60 * 60 * 1000);

  if (weeksDiff < 0.01) return { rate: 0 };

  var sizeDiff = last.size - first.size;
  var rate = sizeDiff / weeksDiff;

  return { rate: Math.max(0, rate), weeks: weeksDiff };
}

// ═══════════════════════════════════════════════════════════
// REFRESH STORAGE
// ═══════════════════════════════════════════════════════════
async function shRefreshStorage() {
  erpShowToast('Refreshing storage data...', 'info');
  await shLoadStorage();
  await shLoadCleanupCounts();
  erpShowToast('✅ Storage data refreshed', 'success');
}

window.shRefreshStorage = shRefreshStorage;

// ═══════════════════════════════════════════════════════════
// CLEANUP COUNTS (para sa preview bago mag-delete)
// ═══════════════════════════════════════════════════════════
async function shLoadCleanupCounts() {
  try {
    // Snapshots > 3 months
    var snapshotRes = await fetch(erpUrl('erp_cutover_snapshots') + 
      '?select=id&snapshot_date=lt.' + encodeURIComponent(new Date(Date.now() - 90 * 86400000).toISOString()),
      { method: 'HEAD', headers: Object.assign({}, erpHeaders(), { 'Prefer': 'count=exact', 'Range': '0-0' }) }
    );
    var snapshotCount = shParseCountHeader(snapshotRes.headers.get('content-range'));
    var snapshotEl = document.getElementById('shCleanupSnapshotsCount');
    if (snapshotEl) snapshotEl.textContent = snapshotCount;

    // Audit logs > 6 months
    var auditRes = await fetch(erpUrl('admin_audit_log') + 
      '?select=id&created_at=lt.' + encodeURIComponent(new Date(Date.now() - 180 * 86400000).toISOString()),
      { method: 'HEAD', headers: Object.assign({}, erpHeaders(), { 'Prefer': 'count=exact', 'Range': '0-0' }) }
    );
    var auditCount = shParseCountHeader(auditRes.headers.get('content-range'));
    var auditEl = document.getElementById('shCleanupAuditCount');
    if (auditEl) auditEl.textContent = auditCount;

    // Messages > 3 months
    var msgRes = await fetch(erpUrl('messages') + 
      '?select=id&created_at=lt.' + encodeURIComponent(new Date(Date.now() - 90 * 86400000).toISOString()),
      { method: 'HEAD', headers: Object.assign({}, erpHeaders(), { 'Prefer': 'count=exact', 'Range': '0-0' }) }
    );
    var msgCount = shParseCountHeader(msgRes.headers.get('content-range'));
    var msgEl = document.getElementById('shCleanupMessagesCount');
    if (msgEl) msgEl.textContent = msgCount;

    // Completed docs > 1 year
    var docRes = await fetch(erpUrl('documents') + 
      '?select=id&status=eq.COMPLETED&created_at=lt.' + encodeURIComponent(new Date(Date.now() - 365 * 86400000).toISOString()),
      { method: 'HEAD', headers: Object.assign({}, erpHeaders(), { 'Prefer': 'count=exact', 'Range': '0-0' }) }
    );
    var docCount = shParseCountHeader(docRes.headers.get('content-range'));
    var docEl = document.getElementById('shCleanupDocsCount');
    if (docEl) docEl.textContent = docCount;

  } catch(err) {
    console.warn('[shLoadCleanupCounts]', err.message);
  }
}

function shParseCountHeader(range) {
  if (!range) return 0;
  var m = range.match(/\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ═══════════════════════════════════════════════════════════
// CLEANUP ACTIONS
// ═══════════════════════════════════════════════════════════

// ─── 1. Delete Old Snapshots ───
async function shCleanupSnapshots() {
  var count = document.getElementById('shCleanupSnapshotsCount').textContent;
  if (count === '0') {
    erpShowToast('Walang old snapshots to delete', 'info');
    return;
  }

  var confirm1 = confirm(
    '📸 DELETE OLD SNAPSHOTS?\n\n' +
    'Snapshots > 3 months old: ' + count + '\n\n' +
    '⚠️ Auto-backup ang gagawin bago mag-delete.\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  _shEnhanced.isExecuting = true;
  erpShowToast('🧹 Creating backup + deleting old snapshots...', 'warning');

  try {
    var cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    var sql = 
      "CREATE TABLE IF NOT EXISTS _cleanup_backup_" + Date.now() + " AS " +
      "SELECT * FROM erp_cutover_snapshots WHERE snapshot_date < '" + cutoff + "'; " +
      "DELETE FROM erp_cutover_snapshots WHERE snapshot_date < '" + cutoff + "';";

    await shExecuteSql(sql);

    erpShowToast('✅ Deleted ' + count + ' old snapshot(s)', 'success');
    await shRefreshStorage();

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  } finally {
    _shEnhanced.isExecuting = false;
  }
}

window.shCleanupSnapshots = shCleanupSnapshots;

// ─── 2. Delete Old Audit Logs ───
async function shCleanupAuditLogs() {
  var count = document.getElementById('shCleanupAuditCount').textContent;
  if (count === '0') {
    erpShowToast('Walang old audit logs to delete', 'info');
    return;
  }

  var confirm1 = confirm(
    '📝 DELETE OLD AUDIT LOGS?\n\n' +
    'Logs > 6 months old: ' + count + '\n\n' +
    '⚠️ Auto-backup ang gagawin bago mag-delete.\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  _shEnhanced.isExecuting = true;
  erpShowToast('🧹 Creating backup + deleting old logs...', 'warning');

  try {
    var cutoff = new Date(Date.now() - 180 * 86400000).toISOString();
    var sql = 
      "CREATE TABLE IF NOT EXISTS _cleanup_backup_" + Date.now() + " AS " +
      "SELECT * FROM admin_audit_log WHERE created_at < '" + cutoff + "'; " +
      "DELETE FROM admin_audit_log WHERE created_at < '" + cutoff + "'; " +
      "DELETE FROM user_audit_log WHERE created_at < '" + cutoff + "'; " +
      "DELETE FROM erp_manual_edits_audit WHERE edited_at < '" + cutoff + "';";

    await shExecuteSql(sql);

    erpShowToast('✅ Deleted ' + count + ' old log(s)', 'success');
    await shRefreshStorage();

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  } finally {
    _shEnhanced.isExecuting = false;
  }
}

window.shCleanupAuditLogs = shCleanupAuditLogs;

// ─── 3. Delete Old Messages ───
async function shCleanupMessages() {
  var count = document.getElementById('shCleanupMessagesCount').textContent;
  if (count === '0') {
    erpShowToast('Walang old messages to delete', 'info');
    return;
  }

  var confirm1 = confirm(
    '💬 DELETE OLD MESSAGES?\n\n' +
    'Messages > 3 months old: ' + count + '\n\n' +
    '⚠️ Auto-backup ang gagawin bago mag-delete.\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  _shEnhanced.isExecuting = true;
  erpShowToast('🧹 Creating backup + deleting old messages...', 'warning');

  try {
    var cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    var sql = 
      "CREATE TABLE IF NOT EXISTS _cleanup_backup_" + Date.now() + " AS " +
      "SELECT * FROM messages WHERE created_at < '" + cutoff + "'; " +
      "DELETE FROM messages WHERE created_at < '" + cutoff + "';";

    await shExecuteSql(sql);

    erpShowToast('✅ Deleted ' + count + ' old message(s)', 'success');
    await shRefreshStorage();

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  } finally {
    _shEnhanced.isExecuting = false;
  }
}

window.shCleanupMessages = shCleanupMessages;

// ─── 4. Delete Completed Docs ───
async function shCleanupCompletedDocs() {
  var count = document.getElementById('shCleanupDocsCount').textContent;
  if (count === '0') {
    erpShowToast('Walang old completed docs to delete', 'info');
    return;
  }

  var confirm1 = confirm(
    '📄 DELETE OLD COMPLETED DOCS?\n\n' +
    'Completed docs > 1 year old: ' + count + '\n\n' +
    '⚠️ Auto-backup ang gagawin bago mag-delete.\n' +
    '⚠️ Kasama ang doc_items at messages related sa docs.\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  _shEnhanced.isExecuting = true;
  erpShowToast('🧹 Creating backup + deleting old docs...', 'warning');

  try {
    var cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
    var sql = 
      "CREATE TABLE IF NOT EXISTS _cleanup_backup_docs_" + Date.now() + " AS " +
      "SELECT * FROM documents WHERE status = 'COMPLETED' AND created_at < '" + cutoff + "'; " +
      "DELETE FROM doc_items WHERE doc_no IN (SELECT doc_no FROM documents WHERE status = 'COMPLETED' AND created_at < '" + cutoff + "'); " +
      "DELETE FROM documents WHERE status = 'COMPLETED' AND created_at < '" + cutoff + "';";

    await shExecuteSql(sql);

    erpShowToast('✅ Deleted ' + count + ' old document(s)', 'success');
    await shRefreshStorage();

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  } finally {
    _shEnhanced.isExecuting = false;
  }
}

window.shCleanupCompletedDocs = shCleanupCompletedDocs;

// ─── 5. Custom Date Range Delete ───
async function shOpenCustomDelete() {
  var confirm1 = confirm(
    '🗑️ CUSTOM DELETE\n\n' +
    'Ito ay mag-o-open ng prompt para sa custom date range delete.\n\n' +
    'Available tables:\n' +
    '• erp_cutover_snapshots\n' +
    '• admin_audit_log\n' +
    '• messages\n' +
    '• documents\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  var table = prompt(
    'Select table:\n\n' +
    '1 = erp_cutover_snapshots\n' +
    '2 = admin_audit_log\n' +
    '3 = messages\n' +
    '4 = documents\n\n' +
    'Type number:'
  );

  var tableMap = {
    '1': { name: 'erp_cutover_snapshots', dateCol: 'snapshot_date' },
    '2': { name: 'admin_audit_log', dateCol: 'created_at' },
    '3': { name: 'messages', dateCol: 'created_at' },
    '4': { name: 'documents', dateCol: 'created_at' }
  };

  if (!tableMap[table]) {
    erpShowToast('Cancelled', 'info');
    return;
  }

  var selected = tableMap[table];

  var beforeDate = prompt(
    'Delete rows from ' + selected.name + '\n\n' +
    'Where ' + selected.dateCol + ' is BEFORE:\n\n' +
    'Format: YYYY-MM-DD\n' +
    'Example: 2025-12-31'
  );

  if (!beforeDate || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    erpShowToast('Invalid date format', 'warning');
    return;
  }

  var confirm2 = confirm(
    '⚠️ CONFIRM DELETE?\n\n' +
    'Table: ' + selected.name + '\n' +
    'Before: ' + beforeDate + '\n\n' +
    'Auto-backup ang gagawin.\n\n' +
    'Continue?'
  );
  if (!confirm2) return;

  erpShowToast('🧹 Deleting rows...', 'warning');

  try {
    var sql = 
      "CREATE TABLE IF NOT EXISTS _cleanup_custom_" + Date.now() + " AS " +
      "SELECT * FROM " + selected.name + " WHERE " + selected.dateCol + " < '" + beforeDate + "'; " +
      "DELETE FROM " + selected.name + " WHERE " + selected.dateCol + " < '" + beforeDate + "';";

    await shExecuteSql(sql);

    erpShowToast('✅ Custom delete complete', 'success');
    await shRefreshStorage();

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  }
}

window.shOpenCustomDelete = shOpenCustomDelete;

// ─── 6. Full Cleanup ───
async function shRunFullCleanup() {
  var confirm1 = confirm(
    '🚨 FULL CLEANUP\n\n' +
    'Ito ay mag-de-delete ng LAHAT ng:\n' +
    '• Snapshots > 3 months\n' +
    '• Audit logs > 6 months\n' +
    '• Messages > 3 months\n' +
    '• Completed docs > 1 year\n\n' +
    '⚠️ Auto-backup ang gagawin.\n' +
    '⚠️ Pwedeng i-restore kung may issue.\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  var confirm2 = prompt('Type "CLEANUP" to confirm:');
  if (confirm2 !== 'CLEANUP') {
    erpShowToast('Cancelled', 'info');
    return;
  }

  _shEnhanced.isExecuting = true;
  erpShowToast('🧹 Running full cleanup...', 'warning');

  try {
    var snapshotCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    var auditCutoff = new Date(Date.now() - 180 * 86400000).toISOString();
    var docCutoff = new Date(Date.now() - 365 * 86400000).toISOString();

    var sql = 
      "CREATE TABLE IF NOT EXISTS _cleanup_full_" + Date.now() + " AS SELECT NOW() AS ts; " +
      "DELETE FROM erp_cutover_snapshots WHERE snapshot_date < '" + snapshotCutoff + "'; " +
      "DELETE FROM admin_audit_log WHERE created_at < '" + auditCutoff + "'; " +
      "DELETE FROM user_audit_log WHERE created_at < '" + auditCutoff + "'; " +
      "DELETE FROM erp_manual_edits_audit WHERE edited_at < '" + auditCutoff + "'; " +
      "DELETE FROM messages WHERE created_at < '" + snapshotCutoff + "'; " +
      "DELETE FROM doc_items WHERE doc_no IN (SELECT doc_no FROM documents WHERE status = 'COMPLETED' AND created_at < '" + docCutoff + "'); " +
      "DELETE FROM documents WHERE status = 'COMPLETED' AND created_at < '" + docCutoff + "';";

    await shExecuteSql(sql);

    erpShowToast('✅ Full cleanup complete!', 'success');
    await shRefreshStorage();

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  } finally {
    _shEnhanced.isExecuting = false;
  }
}

window.shRunFullCleanup = shRunFullCleanup;

// ═══════════════════════════════════════════════════════════
// SQL EXECUTION HELPER
// ═══════════════════════════════════════════════════════════
async function shExecuteSql(sql) {
  var res = await fetch(erpUrl('rpc/execute_sql_mutation'), {
    method: 'POST',
    headers: erpHeaders(),
    body: JSON.stringify({ p_sql: sql })
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error('HTTP ' + res.status + ' — ' + errText.substring(0, 150));
  }

  var data = await res.json();
  if (data && data.success === false) {
    throw new Error(data.error || 'Unknown error');
  }

  return data;
}

// ═══════════════════════════════════════════════════════════
// BACKUP CENTER
// ═══════════════════════════════════════════════════════════

// ─── Create Backup ───
// ═══════════════════════════════════════════════════════════
// FIXED: shCreateBackup() v2
// ═══════════════════════════════════════════════════════════
async function shCreateBackup() {
  if (_shEnhanced.isExecuting) return;

  var confirm1 = confirm(
    '💾 CREATE BACKUP?\n\n' +
    'Ito ay gagawa ng snapshot ng lahat ng data.\n' +
    'Estimated: ~13 MB\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  _shEnhanced.isExecuting = true;
  erpShowToast('💾 Creating backup...', 'info');

  try {
    // ✅ FIX 1: Sanitize table name — tanggalin dashes
    var timestamp = new Date().toISOString()
      .replace(/[:.]/g, '')
      .replace(/-/g, '_')
      .slice(0, 15);
    var tableName = 'manual_backup_' + timestamp;

    if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
      throw new Error('Invalid table name: ' + tableName);
    }

    console.log('[Backup] Creating table:', tableName);

    // ✅ FIX 2: Add alias `t` sa bawat FROM clause
    var sql = 
      "CREATE TABLE IF NOT EXISTS \"" + tableName + "\" AS " +
      "SELECT " +
      "(SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM erp_items t WHERE t.is_deleted = false) AS items, " +
      "(SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM users t) AS users, " +
      "(SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM vendors t) AS vendors, " +
      "(SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM requestors t) AS requestors, " +
      "NOW() AS backup_date";

    await shExecuteSql(sql);

    erpShowToast('✅ Backup created: ' + tableName, 'success');
    await shLoadBackups();

  } catch(err) {
    console.error('[shCreateBackup]', err);
    erpShowToast('❌ Backup failed: ' + err.message, 'danger');
  } finally {
    _shEnhanced.isExecuting = false;
  }
}

window.shCreateBackup = shCreateBackup;

// ─── Download Backup ───
async function shDownloadBackup() {
  erpShowToast('📥 Preparing download...', 'info');

  try {
    // Get all data
    var items = await erpFetchAll('erp_items', 'select=*&is_deleted=eq.false&order=item_code.asc');
    var users = await erpFetch('users', 'select=*');
    var vendors = await erpFetch('vendors', 'select=*');
    var requestors = await erpFetch('requestors', 'select=*');

    var backup = {
      backup_date: new Date().toISOString(),
      version: '1.0',
      counts: {
        items: (items || []).length,
        users: (users || []).length,
        vendors: (vendors || []).length,
        requestors: (requestors || []).length
      },
      data: {
        erp_items: items || [],
        users: users || [],
        vendors: vendors || [],
        requestors: requestors || []
      }
    };

    var json = JSON.stringify(backup, null, 2);
    var blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gemcor_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();

    erpShowToast('✅ Backup downloaded', 'success');

  } catch(err) {
    erpShowToast('❌ Download failed: ' + err.message, 'danger');
  }
}

window.shDownloadBackup = shDownloadBackup;

// ─── Restore Backup ───
async function shRestoreBackup() {
  var confirm1 = confirm(
    '⚠️ RESTORE BACKUP\n\n' +
    'Ito ay mag-o-open ng file picker para mag-upload ng backup JSON.\n\n' +
    '⚠️ WARNING: Ito ay mag-o-overwrite ng current data!\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async function(event) {
    var file = event.target.files[0];
    if (!file) return;

   var confirmText = prompt(
  '🚨 FINAL CONFIRMATION\n\n' +
  'File: ' + file.name + '\n\n' +
  'I-restore ang backup? Overwrite current data?\n\n' +
  'Type "RESTORE" to confirm:'
);
    if (confirmText !== 'RESTORE') {
      erpShowToast('Cancelled', 'info');
      return;
    }

    try {
      var text = await file.text();
      var backup = JSON.parse(text);

      if (!backup.data) throw new Error('Invalid backup file');

      erpShowToast('⏳ Restoring backup...', 'warning');

      // Clear + restore items
      if (backup.data.erp_items && backup.data.erp_items.length > 0) {
        var itemsSql = 
          "DELETE FROM erp_items WHERE is_deleted = false; " +
          "INSERT INTO erp_items SELECT * FROM jsonb_populate_recordset(null::erp_items, '" + 
          JSON.stringify(backup.data.erp_items).replace(/'/g, "''") + "'::jsonb);";

        await shExecuteSql(itemsSql);
      }

      erpShowToast('✅ Restore complete! Reloading...', 'success');

      setTimeout(function() {
        window.location.reload();
      }, 1500);

    } catch(err) {
      erpShowToast('❌ Restore failed: ' + err.message, 'danger');
    }
  };

  input.click();
}

window.shRestoreBackup = shRestoreBackup;

// ─── Load Backups List ───
async function shLoadBackups() {
  var container = document.getElementById('shBackupList');
  if (!container) return;

  container.innerHTML = '<div class="text-center py-3"><div class="sh-mini-spinner"></div><div class="small text-muted mt-2">Loading backups...</div></div>';

  try {
    var res = await fetch(erpUrl('rpc/admin_get_backups'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({})
    });

    if (!res.ok) {
      // Fallback: query via pg_stat
      container.innerHTML = '<div class="backup-empty-state">' +
        '<i class="bi bi-inbox"></i>' +
        '<div>Backup list not available</div>' +
        '<div style="font-size:0.75rem;margin-top:4px;">Use "Backup Now" to create your first backup</div>' +
        '</div>';
      return;
    }

    var data = await res.json();
    _shEnhanced.backups = data || [];

    shRenderBackups();

  } catch(err) {
    container.innerHTML = '<div class="backup-empty-state">' +
      '<i class="bi bi-exclamation-triangle"></i>' +
      '<div>Failed to load backups</div>' +
      '<div style="font-size:0.75rem;margin-top:4px;">' + shEsc(err.message) + '</div>' +
      '</div>';
  }
}

function shRenderBackups() {
  var container = document.getElementById('shBackupList');
  if (!container) return;

  var backups = _shEnhanced.backups;

  if (!backups || backups.length === 0) {
    container.innerHTML = '<div class="backup-empty-state">' +
      '<i class="bi bi-inbox"></i>' +
      '<div>Walang backups pa</div>' +
      '<div style="font-size:0.75rem;margin-top:4px;">Click "Backup Now" para mag-create</div>' +
      '</div>';
    return;
  }

  var html = '';
  backups.forEach(function(b) {
    var dateStr = b.backup_date ? new Date(b.backup_date).toLocaleString() : '—';
    var sizeStr = b.size_bytes ? shFormatSize(b.size_bytes / 1024 / 1024) : '—';

    html += '<div class="backup-list-item">' +
      '<div class="backup-info">' +
        '<div class="backup-name">' + shEsc(b.table_name) + '</div>' +
        '<div class="backup-meta">' +
          '<span><i class="bi bi-clock"></i>' + shEsc(dateStr) + '</span>' +
          '<span><i class="bi bi-hdd"></i>' + shEsc(sizeStr) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="backup-actions">' +
        '<button class="btn-backup-action download" onclick="shDownloadBackupItem(\'' + shJsEsc(b.table_name) + '\')" title="Download">' +
          '<i class="bi bi-download"></i>' +
        '</button>' +
        '<button class="btn-backup-action restore" onclick="shRestoreBackupItem(\'' + shJsEsc(b.table_name) + '\')" title="Restore">' +
          '<i class="bi bi-arrow-counterclockwise"></i>' +
        '</button>' +
        '<button class="btn-backup-action delete" onclick="shDeleteBackupItem(\'' + shJsEsc(b.table_name) + '\')" title="Delete">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;
}

async function shDownloadBackupItem(tableName) {
  erpShowToast('📥 Preparing download...', 'info');

  try {
    var rows = await erpFetch(tableName, 'select=*&limit=1');
    if (!rows || rows.length === 0) {
      erpShowToast('Backup not found', 'warning');
      return;
    }

    var json = JSON.stringify(rows[0], null, 2);
    var blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = tableName + '_' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();

    erpShowToast('✅ Backup downloaded', 'success');

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  }
}

window.shDownloadBackupItem = shDownloadBackupItem;

async function shRestoreBackupItem(tableName) {
  var confirm1 = confirm(
    '⚠️ RESTORE ' + tableName + '?\n\n' +
    'I-restore ang lahat ng master data from this backup?\n\n' +
    '⚠️ This will OVERWRITE current data!\n\n' +
    'Continue?'
  );
  if (!confirm1) return;

  var confirmText = prompt('Type "RESTORE" to confirm:');
  if (confirmText !== 'RESTORE') return;

  erpShowToast('⏳ Restoring...', 'warning');

  try {
    var rows = await erpFetch(tableName, 'select=*&limit=1');
    if (!rows || rows.length === 0) throw new Error('Backup not found');

    var backup = rows[0];

    if (backup.items && backup.items.length > 0) {
      var sql = 
        "DELETE FROM erp_items WHERE is_deleted = false; " +
        "INSERT INTO erp_items SELECT * FROM jsonb_populate_recordset(null::erp_items, '" +
        JSON.stringify(backup.items).replace(/'/g, "''") + "'::jsonb);";

      await shExecuteSql(sql);
    }

    erpShowToast('✅ Restore complete! Reloading...', 'success');
    setTimeout(function() { window.location.reload(); }, 1500);

  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  }
}

window.shRestoreBackupItem = shRestoreBackupItem;

async function shDeleteBackupItem(tableName) {
  var confirm1 = confirm(
    '🗑️ DELETE BACKUP?\n\n' +
    'Table: ' + tableName + '\n\n' +
    'Permanent ito. Continue?'
  );
  if (!confirm1) return;

  try {
    await shExecuteSql('DROP TABLE IF EXISTS ' + tableName + ';');
    erpShowToast('✅ Backup deleted', 'success');
    await shLoadBackups();
  } catch(err) {
    erpShowToast('❌ Failed: ' + err.message, 'danger');
  }
}

window.shDeleteBackupItem = shDeleteBackupItem;

// ═══════════════════════════════════════════════════════════
// EXPORT DATA
// ═══════════════════════════════════════════════════════════

var SH_EXPORT_TABLES = [
  { name: 'erp_items', label: 'Inventory Items', icon: 'bi-box-seam' },
  { name: 'users', label: 'Users', icon: 'bi-people' },
  { name: 'vendors', label: 'Vendors', icon: 'bi-shop' },
  { name: 'requestors', label: 'Requestors', icon: 'bi-person-badge' },
  { name: 'documents', label: 'Documents', icon: 'bi-file-earmark-text' },
  { name: 'doc_items', label: 'Document Items', icon: 'bi-list-ul' },
  { name: 'prf_documents', label: 'PRF Documents', icon: 'bi-file-earmark-text' },
  { name: 'prf_items', label: 'PRF Items', icon: 'bi-list-ul' },
  { name: 'messages', label: 'Messages', icon: 'bi-chat-dots' },
  { name: 'erp_stock_ledger', label: 'Stock Ledger', icon: 'bi-journal-text' },
  { name: 'erp_cutover_snapshots', label: 'Cutover Snapshots', icon: 'bi-camera' }
];

async function shLoadExportButtons() {
  var container = document.getElementById('shExportButtons');
  if (!container) return;

  var html = '';
  for (var i = 0; i < SH_EXPORT_TABLES.length; i++) {
    var t = SH_EXPORT_TABLES[i];
    html += '<div class="col-md-4">' +
      '<button class="export-btn" onclick="shExportTable(\'' + t.name + '\')">' +
        '<i class="bi ' + t.icon + '"></i>' +
        '<div class="export-info">' +
          '<div class="export-label">' + t.label + '</div>' +
          '<div class="export-count" id="shExportCount_' + t.name + '">—</div>' +
        '</div>' +
      '</button>' +
    '</div>';
  }
  container.innerHTML = html;

  // Load counts async
  for (var j = 0; j < SH_EXPORT_TABLES.length; j++) {
    shLoadExportCount(SH_EXPORT_TABLES[j].name);
  }
}

async function shLoadExportCount(tableName) {
  try {
    var res = await fetch(erpUrl(tableName) + '?select=id&limit=1', {
      method: 'HEAD',
      headers: Object.assign({}, erpHeaders(), {
        'Prefer': 'count=exact',
        'Range': '0-0'
      })
    });

    var range = res.headers.get('content-range') || '';
    var m = range.match(/\/(\d+)/);
    var count = m ? parseInt(m[1], 10) : 0;

    var el = document.getElementById('shExportCount_' + tableName);
    if (el) el.textContent = count.toLocaleString() + ' rows';

  } catch(err) {
    var el2 = document.getElementById('shExportCount_' + tableName);
    if (el2) el2.textContent = '—';
  }
}

async function shExportTable(tableName) {
  erpShowToast('📥 Exporting ' + tableName + '...', 'info');

  try {
    // Paginated fetch
    var allRows = [];
    var pageSize = 1000;
    var offset = 0;
    var hasMore = true;
    var maxPages = 50;

    while (hasMore && offset / pageSize < maxPages) {
      var rows = await erpFetch(tableName, 'select=*&limit=' + pageSize + '&offset=' + offset);
      if (!rows || rows.length === 0) break;
      allRows = allRows.concat(rows);
      offset += rows.length;
      if (rows.length < pageSize) hasMore = false;
    }

    if (allRows.length === 0) {
      erpShowToast('No data to export', 'warning');
      return;
    }

    // Build CSV
    var headers = Object.keys(allRows[0]);
    var csv = '\uFEFF'; // UTF-8 BOM
    csv += headers.map(shCsvEscape).join(',') + '\n';

    allRows.forEach(function(row) {
      csv += headers.map(function(h) { return shCsvEscape(row[h]); }).join(',') + '\n';
    });

    // Download
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = tableName + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();

    erpShowToast('✅ Exported ' + allRows.length + ' rows', 'success');

  } catch(err) {
    erpShowToast('❌ Export failed: ' + err.message, 'danger');
  }
}

window.shExportTable = shExportTable;

function shCsvEscape(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  if (typeof val === 'object') s = JSON.stringify(val);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function shEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shJsEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ═══════════════════════════════════════════════════════════
// INITIALIZE ON LOAD
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  // Wait for page to load then initialize
  setTimeout(function() {
    console.log('[System Health Enhanced] Initializing...');

    // Load storage
    shLoadStorage();

    // Load cleanup counts
    shLoadCleanupCounts();

    // Load backups
    shLoadBackups();

    // Load export buttons
    shLoadExportButtons();

    console.log('[System Health Enhanced] ✅ Ready');
  }, 500);
});

console.log('✅ System Health Enhanced module loaded');

// ═══════════════════════════════════════════════════════════
// EXPOSE ALL FUNCTIONS TO WINDOW (FIX for undefined errors)
// ═══════════════════════════════════════════════════════════
window.shRefreshStorage = shRefreshStorage;
window.shLoadStorage = shLoadStorage;
window.shLoadCleanupCounts = shLoadCleanupCounts;
window.shCleanupSnapshots = shCleanupSnapshots;
window.shCleanupAuditLogs = shCleanupAuditLogs;
window.shCleanupMessages = shCleanupMessages;
window.shCleanupCompletedDocs = shCleanupCompletedDocs;
window.shOpenCustomDelete = shOpenCustomDelete;
window.shRunFullCleanup = shRunFullCleanup;
window.shCreateBackup = shCreateBackup;
window.shDownloadBackup = shDownloadBackup;
window.shRestoreBackup = shRestoreBackup;
window.shLoadBackups = shLoadBackups;
window.shDownloadBackupItem = shDownloadBackupItem;
window.shRestoreBackupItem = shRestoreBackupItem;
window.shDeleteBackupItem = shDeleteBackupItem;
window.shExportTable = shExportTable;
window.shLoadExportButtons = shLoadExportButtons;
window.shExecuteSql = shExecuteSql;

console.log('✅ System Health — All functions exposed to window');  
