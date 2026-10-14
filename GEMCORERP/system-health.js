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
    { name: 'erp_items', label: 'Items (ERP)' },
    { name: 'documents', label: 'Documents' },
    { name: 'doc_items', label: 'Doc Items' },
    { name: 'prf_documents', label: 'PRF Documents' },
    { name: 'prf_items', label: 'PRF Items' },
    { name: 'users', label: 'Users' },
    { name: 'vendors', label: 'Vendors' },
    { name: 'erp_sof_cache', label: 'SOF Cache' },
    { name: 'erp_prf_po_cache', label: 'PRF PO Cache' },
    { name: 'partial_items', label: 'Partial Items' }
  ];

  var results = [];
  var totalRows = 0;

  await Promise.all(tables.map(async function(t) {
    try {
      var t0 = Date.now();
      var res = await fetch(erpUrl(t.name) + '?select=id&limit=1', {
        method: 'HEAD',
        headers: {
          ...erpHeaders(),
          'Prefer': 'count=exact',
          'Range': '0-0'
        },
        cache: 'no-store'
      });
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
      connEl.textContent = (c.effectiveType || 'unknown') + ' · ' +
        (c.downlink ? c.downlink + ' Mbps' : '—');
    } else {
      connEl.textContent = 'Not available';
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
