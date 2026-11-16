// ============================================================
// GEMCOR ERP — Notifications System
// Real-time alerts for pending requests + status updates
// No new tables — computed from documents/prf_documents
// ============================================================

var _notifState = {
  userRole: '',
  username: '',
  userFullname: '',
  notifications: [],
  unreadCount: 0,
  unreadReq: 0,
  unreadAnn: 0,
  tab: 'request',
  refreshInterval: null,
  lastFetchTs: 0,
  fetching: false,
  hadError: false,
  ov: {},   // per-item read/unread override  { id: { s: 'r'|'u', t: notifTimestamp } }
  dm: {},   // per-item dismissed (hidden)    { id: { t: notifTimestamp } }
  nc: { open: false, tab: 'request', q: '', type: '', unreadOnly: false, sel: {}, lastIdx: -1, undo: null }
};

var NOTIF_MAX_PER_CAT = 100;      // kept in memory per category; the bell dropdown only lists the newest NOTIF_DROPDOWN_MAX
var NOTIF_DROPDOWN_MAX = 20;
var NOTIF_REFRESH_MS = 15000;        // while the tab is visible
var NOTIF_REFRESH_HIDDEN_MS = 30000; // background tabs keep polling so sound alerts still arrive

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
function initNotifications() {
  console.log('[Notifications] Initializing...');

  _notifState.userRole = localStorage.getItem('ivm_userRole') || '';
  _notifState.username = localStorage.getItem('ivm_username') || '';
  _notifState.userFullname = localStorage.getItem('ivm_userFullname') || _notifState.username;

  if (!_notifState.username) {
    console.warn('[Notifications] No user logged in');
    return;
  }

  try { _notifState.tab = localStorage.getItem('ivm_notif_tab') === 'announce' ? 'announce' : 'request'; } catch (e) {}
  _notifState.ov = nsLoad('ov');
  _notifState.dm = nsLoad('dm');

  // Warehouse: stock & conflict announcements (banner + alerts)
  if ((_notifState.userRole === 'warehouse' || _notifState.userRole === 'production') && !window.erpStockAlerts) {
    var sa = document.createElement('script');
    sa.src = 'stock-alerts.js';
    document.head.appendChild(sa);
  }

  // Initial fetch
  fetchNotifications();

  // Auto-refresh (slower, but never paused, when the tab is in the background)
  notifSchedule();
  document.addEventListener('visibilitychange', function() {
    notifSchedule();
    if (!document.hidden) fetchNotifications();
  });

  console.log('[Notifications] Ready for', _notifState.userRole, ':', _notifState.userFullname);
}

function notifSchedule() {
  if (_notifState.refreshInterval) clearInterval(_notifState.refreshInterval);
  _notifState.refreshInterval = setInterval(fetchNotifications,
    document.hidden ? NOTIF_REFRESH_HIDDEN_MS : NOTIF_REFRESH_MS);
}

// ═══════════════════════════════════════════════════════════
// FETCH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
async function fetchNotifications() {
  if (_notifState.fetching) return;   // a slow poll must not overlap the next one
  _notifState.fetching = true;
  _notifState.hadError = false;
  try {
    var notifications = [];

    if (_notifState.userRole === 'warehouse') {
      notifications = await fetchWarehouseNotifications();
    } else if (_notifState.userRole === 'production') {
      notifications = await fetchProductionNotifications();
    }

    // Stock / conflict alerts (warehouse): bell-only here; their sound/toast is handled by stock-alerts.js
    var stockItems = [];
    if (_notifState.userRole === 'warehouse' && window.erpStockAlerts) {
      try { stockItems = erpStockAlerts.bellItems(); } catch (e) {}
    }

    // Sort by timestamp desc
    notifications.sort(function(a, b) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Alert on anything new. Skipped when a sub-query failed: the list is then
    // incomplete, and the missing items would look "new" on the next good poll.
    if (!_notifState.hadError && window.erpAlerts) {
      try { erpAlerts.process(notifications); } catch (e) { console.warn('[Alerts]', e); }
    }

    notifications = notifications.concat(stockItems);
    notifications.sort(function(a, b) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
    // Cap each category separately so a flood of stock alerts can never push requests out of the list
    // (dismissed items are hidden here, after the alert pass above, so they can never re-trigger a sound)
    var visible = notifications.filter(function(n) { return !isNotifDismissed(n); });
    var reqs = visible.filter(function(n) { return notifCategory(n) === 'request'; }).slice(0, NOTIF_MAX_PER_CAT);
    var anns = visible.filter(function(n) { return notifCategory(n) === 'announce'; }).slice(0, NOTIF_MAX_PER_CAT);
    _notifState.notifications = reqs.concat(anns);
    computeUnreadCount(_notifState.notifications);
    _notifState.lastFetchTs = Date.now();

    renderBell();
    renderDropdown();
    if (_notifState.nc.open) ncRender();

    console.log('[Notifications] Fetched', notifications.length, 'notifications · Unread:', _notifState.unreadCount);

  } catch(err) {
    console.error('[fetchNotifications]', err);
  } finally {
    _notifState.fetching = false;
  }
}

// ═══════════════════════════════════════════════════════════
// WAREHOUSE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
async function fetchWarehouseNotifications() {
  var notifications = [];

  try {
    // 1. Pending MRIF/MRS from production (created in last 7 days)
    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var docsRes = await erpFetch('documents',
      'select=doc_no,doc_type,status,requestor,department,jo_no,created_at' +
      '&or=(doc_type.eq.MRIF,doc_type.eq.MRS)' +
      '&status=in.(PENDING,PARTIAL)' +
      '&created_at=gte.' + sevenDaysAgo +
      '&order=created_at.desc&limit=50');

    (docsRes || []).forEach(function(d) {
      var status = String(d.status || '').toUpperCase();
      var isPartial = status === 'PARTIAL';
      notifications.push({
        id: 'doc_' + d.doc_no,
        type: isPartial ? 'partial' : 'new_request',
        icon: isPartial ? 'bi-hourglass-split' : 'bi-file-earmark-plus',
        iconColor: isPartial ? '#3b82f6' : '#f59e0b',
        title: (isPartial ? 'Partial: ' : 'New ') + d.doc_type,
        subtitle: d.doc_no,
        meta: (d.requestor || '') + (d.department ? ' · ' + d.department : ''),
        timestamp: d.created_at,
        link: 'all-requests.html',
        docNo: d.doc_no
      });
    });

  } catch(err) {
    _notifState.hadError = true;
    console.warn('[Warehouse notif] Documents failed:', err.message);
  }

  try {
    // 2. UNSERVED PRF items (recently created)
    var sevenDaysAgo2 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var prfRes = await erpFetch('prf_documents',
      'select=prf_no,category,requestor,total_items,created_at' +
      '&created_at=gte.' + sevenDaysAgo2 +
      '&order=created_at.desc&limit=30');

    (prfRes || []).forEach(function(p) {
      notifications.push({
        id: 'prf_' + p.prf_no,
        type: 'new_prf',
        icon: 'bi-file-earmark-text',
        iconColor: '#8b5cf6',
        title: 'New PRF Created',
        subtitle: p.prf_no,
        meta: (p.category || '') + ' · ' + (p.total_items || 0) + ' items',
        timestamp: p.created_at,
        link: 'prf-monitor.html',
        docNo: p.prf_no
      });
    });

  } catch(err) {
    _notifState.hadError = true;
    console.warn('[Warehouse notif] PRF failed:', err.message);
  }

  return notifications;
}

// ═══════════════════════════════════════════════════════════
// PRODUCTION NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
async function fetchProductionNotifications() {
  var notifications = [];

  if (!_notifState.userFullname) return notifications;

  try {
    // Fetch own requests — recent
    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var docsRes = await erpFetch('documents',
      'select=doc_no,doc_type,status,requestor,processed_by,processed_at,created_at' +
      '&requestor=eq.' + encodeURIComponent(_notifState.userFullname) +
      '&or=(doc_type.eq.MRIF,doc_type.eq.MRS)' +   // production only hears about MRIF / MRS (never MRR, which warehouse creates)
      '&order=created_at.desc&limit=50');

    (docsRes || []).forEach(function(d) {
      var type = String(d.doc_type || '').toUpperCase();
      if (type !== 'MRIF' && type !== 'MRS') return;   // safety net
      var status = String(d.status || '').toUpperCase();

      // Notify if status changed to COMPLETED/PARTIAL
      if (status === 'COMPLETED' || status === 'PARTIAL') {
        // Use processed_at as timestamp
        var ts = d.processed_at || d.created_at;
        var isComplete = status === 'COMPLETED';
        notifications.push({
          id: 'own_' + d.doc_no + '_' + status,
          type: isComplete ? 'completed' : 'partial',
          icon: isComplete ? 'bi-check-circle-fill' : 'bi-hourglass-split',
          iconColor: isComplete ? '#10b981' : '#3b82f6',
          title: isComplete ? 'Request Served!' : 'Request Partially Served',
          subtitle: d.doc_no,
          meta: d.processed_by ? 'By ' + d.processed_by : 'Status: ' + status,
          timestamp: ts,
          link: 'my-requests.html',
          docNo: d.doc_no
        });
      }
    });

  } catch(err) {
    _notifState.hadError = true;
    console.warn('[Production notif] Failed:', err.message);
  }

  return notifications;
}

// ═══════════════════════════════════════════════════════════
// UNREAD COUNT (based on localStorage last-read timestamp)
// ═══════════════════════════════════════════════════════════
// Category: stock/conflict alerts (id 'stk_') are announcements; everything else is a request
function notifCategory(n) {
  return String(n.id || '').indexOf('stk_') === 0 ? 'announce' : 'request';
}

// ── per-item state (read / unread overrides + dismissed), stored per user in this browser ──
function nsKey(k) { return 'ivm_notif_' + k + '_' + _notifState.username; }
function nsLoad(k) {
  try { return JSON.parse(localStorage.getItem(nsKey(k)) || '{}') || {}; } catch (e) { return {}; }
}
function nsSave(k, o) {
  var ids = Object.keys(o);
  if (ids.length > 600) {   // keep the newest ~500 entries
    ids.sort(function(a, b) { return (o[a].t || 0) - (o[b].t || 0); })
       .slice(0, ids.length - 500).forEach(function(i) { delete o[i]; });
  }
  try { localStorage.setItem(nsKey(k), JSON.stringify(o)); } catch (e) {}
}
function notifTs(n) { return new Date(n.timestamp).getTime() || 0; }

// An override only applies to the notification version it was made for (same timestamp or older),
// so an alert that fires again later comes back as new / unread.
function isNotifUnread(n) {
  var ts = notifTs(n), o = _notifState.ov[n.id];
  if (o && ts <= o.t) return o.s === 'u';
  return ts > getLastReadTs(notifCategory(n));
}
function isNotifDismissed(n) {
  var d = _notifState.dm[n.id];
  return !!d && notifTs(n) <= d.t;
}

function computeUnreadCount(notifications) {
  var r = 0, a = 0;
  notifications.forEach(function(n) {
    if (!isNotifUnread(n)) return;
    if (notifCategory(n) === 'announce') a++; else r++;
  });
  _notifState.unreadReq = r;
  _notifState.unreadAnn = a;
  _notifState.unreadCount = r + a;
  return r + a;
}

function notifReadKey(cat) {
  return 'ivm_notif_last_read_' + (cat === 'announce' ? 'ann_' : '') + _notifState.username;
}

function getLastReadTs(cat) {
  try {
    var v = localStorage.getItem(notifReadKey(cat));
    // announcements fall back to the old shared key until they have their own
    if (v === null && cat === 'announce') v = localStorage.getItem(notifReadKey('request'));
    return parseInt(v || '0', 10) || 0;
  } catch(e) { return 0; }
}

function setLastReadTs(ts, cat) {
  try { localStorage.setItem(notifReadKey(cat || 'request'), String(ts)); } catch(e) {}
  // "Mark all read" also clears items that were manually marked unread in that category
  var c = cat || 'request', changed = false;
  Object.keys(_notifState.ov).forEach(function(id) {
    var idCat = id.indexOf('stk_') === 0 ? 'announce' : 'request';
    if (idCat === c && _notifState.ov[id].s === 'u') { delete _notifState.ov[id]; changed = true; }
  });
  if (changed) nsSave('ov', _notifState.ov);
}

function setNotifTab(tab, e) {
  // The dropdown is re-rendered below, which detaches the clicked button. Without this, the outside-click
  // listener thinks the click was outside the panel and closes it.
  if (e) e.stopPropagation();
  _notifState.tab = tab === 'announce' ? 'announce' : 'request';
  try { localStorage.setItem('ivm_notif_tab', _notifState.tab); } catch (e) {}
  renderDropdown();
}

function markAllAsRead() {
  var cat = _notifState.tab;
  setLastReadTs(Date.now(), cat);
  computeUnreadCount(_notifState.notifications);
  renderBell();
  renderDropdown();
  erpShowToast(cat === 'announce' ? '✅ Announcements marked as read' : '✅ Requests marked as read', 'success');
}

// ═══════════════════════════════════════════════════════════
// RENDER BELL
// ═══════════════════════════════════════════════════════════
function renderBell() {
  var bellContainer = document.getElementById('erpBellContainer');
  if (!bellContainer) return;

  // Red badge = unread requests. Announcements only show a small grey badge when no request is waiting.
  var req = _notifState.unreadReq, ann = _notifState.unreadAnn;
  var badgeHtml = '';
  if (req > 0) badgeHtml = '<span class="badge-dot">' + (req > 99 ? '99+' : req) + '</span>';
  else if (ann > 0) badgeHtml = '<span class="badge-dot" style="background:#94a3b8;" title="Announcements">' + (ann > 99 ? '99+' : ann) + '</span>';

  bellContainer.innerHTML =
    '<button class="erp-btn-icon" id="erpBellBtn" title="Notifications">' +
      '<i class="bi bi-bell-fill"></i>' +
      badgeHtml +
    '</button>';

  // Attach click
  var btn = document.getElementById('erpBellBtn');
  if (btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleNotifDropdown();
    });
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER DROPDOWN
// ═══════════════════════════════════════════════════════════
function renderDropdown() {
  var notifContainer = document.getElementById('erpNotifContainer');
  if (!notifContainer) return;

  var hasTabs = _notifState.userRole === 'warehouse';
  var tab = hasTabs ? _notifState.tab : 'request';
  var allTab = _notifState.notifications.filter(function(n) { return notifCategory(n) === tab; });
  var notifs = allTab.slice(0, NOTIF_DROPDOWN_MAX);

  var html = '<div class="erp-notif-dropdown">';

  // Header
  html += '<div class="erp-notif-header">' +
    '<div class="fw-bold"><i class="bi bi-bell-fill me-2"></i>Notifications</div>' +
    (notifs.length > 0 ? '<button class="erp-notif-mark-read" onclick="markAllAsRead()" type="button">Mark all read</button>' : '') +
  '</div>';

  // Tabs (warehouse only: production has no announcements)
  if (hasTabs) {
    var rc = _notifState.unreadReq, ac = _notifState.unreadAnn;
    html += '<div class="erp-notif-tabs">' +
      '<button type="button" class="erp-notif-tab' + (tab === 'request' ? ' on' : '') + '" onclick="setNotifTab(\'request\', event)">' +
        '<i class="bi bi-file-earmark-plus me-1"></i>Requests' + (rc > 0 ? '<span class="tab-count">' + rc + '</span>' : '') + '</button>' +
      '<button type="button" class="erp-notif-tab' + (tab === 'announce' ? ' on' : '') + '" onclick="setNotifTab(\'announce\', event)">' +
        '<i class="bi bi-megaphone me-1"></i>Announcements' + (ac > 0 ? '<span class="tab-count ann">' + ac + '</span>' : '') + '</button>' +
    '</div>';
  }

  // List
  if (notifs.length === 0) {
    html += '<div class="erp-notif-empty">' +
      '<i class="bi bi-bell-slash fs-2 d-block mb-2 text-muted"></i>' +
      '<div>' + (tab === 'announce' ? 'No announcements' : 'No requests') + '</div>' +
    '</div>';
  } else {
    html += '<div class="erp-notif-list">';
    notifs.forEach(function(n) {
      var ts = new Date(n.timestamp).getTime();
      var isUnread = isNotifUnread(n);
      var timeAgo = formatTimeAgo(ts);

      var safeDoc = String(n.docNo || '').replace(/'/g, "\\'");
      html += '<div class="erp-notif-item' + (isUnread ? ' unread' : '') + '" ' +
        'onclick="handleNotifClick(\'' + n.link + '\', \'' + safeDoc + '\', \'' + tab + '\')" ' +
        'data-notif-id="' + n.id + '">' +
        '<div class="erp-notif-icon" style="background:' + n.iconColor + '20;color:' + n.iconColor + ';">' +
          '<i class="bi ' + n.icon + '"></i>' +
        '</div>' +
        '<div class="erp-notif-content">' +
          '<div class="erp-notif-title">' + erpEsc(n.title) + '</div>' +
          '<div class="erp-notif-subtitle"><code>' + erpEsc(n.subtitle) + '</code></div>' +
          (n.meta ? '<div class="erp-notif-meta">' + erpEsc(n.meta) + '</div>' : '') +
          '<div class="erp-notif-time">' + timeAgo + '</div>' +
        '</div>' +
        (isUnread ? '<div class="erp-notif-dot"></div>' : '') +
      '</div>';
    });
    html += '</div>';

    // Footer
    html += '<div class="erp-notif-footer">' +
      '<button type="button" class="erp-notif-view-all" onclick="openNotifCenter(event)">' +
        'View All' + (allTab.length > notifs.length ? ' (' + allTab.length + ')' : '') + ' <i class="bi bi-arrow-right ms-1"></i>' +
      '</button>' +
    '</div>';
  }

  html += (window.erpAlerts ? erpAlerts.settingsHtml() : '');
  html += '</div>';
  notifContainer.innerHTML = html;
}

function getNotifViewAllLink(tab) {
  if (_notifState.userRole === 'warehouse') return tab === 'announce' ? 'stock-monitor.html' : 'all-requests.html';
  if (_notifState.userRole === 'production') return 'my-requests.html';
  return '#';
}

// ═══════════════════════════════════════════════════════════
// TOGGLE DROPDOWN
// ═══════════════════════════════════════════════════════════
function toggleNotifDropdown() {
  var container = document.getElementById('erpNotifContainer');
  if (!container) return;

  var isOpen = container.classList.contains('open');

  // Close user menu if open
  document.querySelectorAll('.erp-user-menu.open').forEach(function(m) {
    m.classList.remove('open');
  });

  if (isOpen) {
    container.classList.remove('open');
  } else {
    container.classList.add('open');
    // Re-render to ensure freshness
    renderDropdown();
  }
}

// ═══════════════════════════════════════════════════════════
// CLICK HANDLER
// ═══════════════════════════════════════════════════════════
function handleNotifClick(link, docNo, cat) {
  // Mark only this category as read (opening an alert must not clear unread requests)
  setLastReadTs(Date.now(), cat || 'request');
  computeUnreadCount(_notifState.notifications);
  renderBell();

  // Close dropdown
  var container = document.getElementById('erpNotifContainer');
  if (container) container.classList.remove('open');

  // Navigate
  if (link && link !== '#') {
    window.location.href = link;
  }
}

// ═══════════════════════════════════════════════════════════
// CLOSE ON OUTSIDE CLICK
// ═══════════════════════════════════════════════════════════
document.addEventListener('click', function(e) {
  var container = document.getElementById('erpNotifContainer');
  if (!container) return;
  if (!container.contains(e.target) && !e.target.closest('#erpBellBtn')) {
    container.classList.remove('open');
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var container = document.getElementById('erpNotifContainer');
    if (container) container.classList.remove('open');
  }
});

// ═══════════════════════════════════════════════════════════
// NOTIFICATION CENTER — "View All" modal
// Browse everything, select one / many (click, Shift+click, Ctrl+A),
// then Mark read · Mark unread · Dismiss (with Undo) · Open.
// Read / dismissed state is kept per user in this browser (localStorage).
// ═══════════════════════════════════════════════════════════
function ncEl(id) { return document.getElementById(id); }

function ncList() {
  var nc = _notifState.nc, q = nc.q.trim().toLowerCase();
  return _notifState.notifications.filter(function(n) {
    if (notifCategory(n) !== nc.tab) return false;
    if (nc.type && n.title !== nc.type) return false;
    if (nc.unreadOnly && !isNotifUnread(n)) return false;
    if (q && (n.title + ' ' + n.subtitle + ' ' + (n.meta || '')).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

function ncGroup(ts) {
  var d = new Date(ts), t = new Date();
  var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  var diff = Math.round((t0 - d0) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function openNotifCenter(e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  var nc = _notifState.nc;
  nc.tab = _notifState.userRole === 'warehouse' ? _notifState.tab : 'request';
  nc.q = ''; nc.type = ''; nc.unreadOnly = false; nc.sel = {}; nc.lastIdx = -1; nc.undo = null; nc.vis = [];

  var dd = ncEl('erpNotifContainer');
  if (dd) dd.classList.remove('open');

  ncBuild();
  ncEl('erpNcQ').value = '';
  ncEl('erpNcUnread').checked = false;
  ncEl('erpNcSnack').className = 'erp-nc-snack';

  nc.open = true;
  ncEl('erpNcOverlay').classList.add('show');
  document.body.classList.add('erp-nc-lock');
  ncRender();
  setTimeout(function() { var m = ncEl('erpNcModal'); if (m) m.focus(); }, 30);
}

function closeNotifCenter() {
  var nc = _notifState.nc;
  if (!nc.open) return;
  nc.open = false;
  var ov = ncEl('erpNcOverlay');
  if (ov) ov.classList.remove('show');
  document.body.classList.remove('erp-nc-lock');
  var bell = ncEl('erpBellBtn');
  if (bell) bell.focus();
}

function ncBuild() {
  if (ncEl('erpNcOverlay')) return;
  var ov = document.createElement('div');
  ov.id = 'erpNcOverlay';
  ov.className = 'erp-nc-overlay';
  ov.innerHTML =
    '<div class="erp-nc-modal" id="erpNcModal" role="dialog" aria-modal="true" aria-labelledby="erpNcTitle" tabindex="-1">' +
      '<div class="erp-nc-head">' +
        '<div class="erp-nc-title" id="erpNcTitle"><i class="bi bi-bell-fill"></i> Notifications</div>' +
        '<button type="button" class="erp-nc-x" data-nc="close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="erp-nc-tabs" id="erpNcTabs"></div>' +
      '<div class="erp-nc-tools">' +
        '<label class="erp-nc-selall" title="Select all shown"><input type="checkbox" id="erpNcAll"><span>Select all</span></label>' +
        '<div class="erp-nc-search"><i class="bi bi-search"></i>' +
          '<input type="search" id="erpNcQ" placeholder="Search doc no., item code, requestor…" autocomplete="off"></div>' +
        '<select id="erpNcType" aria-label="Filter by type"><option value="">All types</option></select>' +
        '<label class="erp-nc-unreadonly"><input type="checkbox" id="erpNcUnread"><span>Unread only</span></label>' +
      '</div>' +
      '<div class="erp-nc-bar" id="erpNcBar"></div>' +
      '<div class="erp-nc-list" id="erpNcList" role="listbox" aria-multiselectable="true"></div>' +
      '<div class="erp-nc-foot">' +
        '<span class="erp-nc-hint">Click to select · Shift+click for a range · Ctrl+A select all · Esc to close</span>' +
        '<a id="erpNcGo" href="#">Open page <i class="bi bi-arrow-right"></i></a>' +
      '</div>' +
      '<div class="erp-nc-snack" id="erpNcSnack"></div>' +
    '</div>';
  document.body.appendChild(ov);

  // click: backdrop, buttons (data-nc), rows
  ov.addEventListener('click', function(e) {
    if (e.target === ov) { closeNotifCenter(); return; }
    var btn = e.target.closest('[data-nc]');
    if (btn) { ncAction(btn.getAttribute('data-nc'), btn); return; }
    var openBtn = e.target.closest('.erp-nc-open');
    var row = e.target.closest('.erp-nc-row');
    if (openBtn && row) { ncOpenItem(row.getAttribute('data-id')); return; }
    if (row) ncToggle(parseInt(row.getAttribute('data-idx'), 10), e.shiftKey);
  });

  ncEl('erpNcQ').addEventListener('input', function() {
    _notifState.nc.q = this.value; _notifState.nc.lastIdx = -1; ncRender();
  });
  ncEl('erpNcType').addEventListener('change', function() {
    _notifState.nc.type = this.value; _notifState.nc.lastIdx = -1; ncRender();
  });
  ncEl('erpNcUnread').addEventListener('change', function() {
    _notifState.nc.unreadOnly = this.checked; _notifState.nc.lastIdx = -1; ncRender();
  });
  ncEl('erpNcAll').addEventListener('change', function() { ncSelectAll(this.checked); });
}

// Esc closes, Ctrl/Cmd+A selects everything shown, Space/Enter toggles a focused row
document.addEventListener('keydown', function(e) {
  var nc = _notifState.nc;
  if (!nc || !nc.open) return;
  var tag = (e.target && e.target.tagName) || '';
  var typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (e.key === 'Escape') { e.preventDefault(); closeNotifCenter(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !typing) {   // inside a text box, Ctrl+A keeps its normal meaning
    e.preventDefault(); ncSelectAll(true); return;
  }
  if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('erp-nc-row')) {
    e.preventDefault(); ncToggle(parseInt(e.target.getAttribute('data-idx'), 10), e.shiftKey);
  }
});

function ncSelectAll(on) {
  var nc = _notifState.nc;
  (nc.vis || []).forEach(function(id) { if (on) nc.sel[id] = true; else delete nc.sel[id]; });
  ncRender();
}

function ncToggle(idx, shift) {
  var nc = _notifState.nc, id = (nc.vis || [])[idx];
  if (id === undefined) return;
  if (shift && nc.lastIdx >= 0 && nc.vis[nc.lastIdx] !== undefined) {
    var a = Math.min(nc.lastIdx, idx), b = Math.max(nc.lastIdx, idx);
    for (var i = a; i <= b; i++) nc.sel[nc.vis[i]] = true;
  } else {
    if (nc.sel[id]) delete nc.sel[id]; else nc.sel[id] = true;
    nc.lastIdx = idx;
  }
  ncRender();
}

function ncAction(act, btn) {
  var nc = _notifState.nc;
  if (act === 'close') return closeNotifCenter();
  if (act === 'tab') {
    nc.tab = btn.getAttribute('data-tab') === 'announce' ? 'announce' : 'request';
    nc.type = ''; nc.sel = {}; nc.lastIdx = -1;
    try { _notifState.tab = nc.tab; localStorage.setItem('ivm_notif_tab', nc.tab); } catch (e) {}
    renderDropdown();
    return ncRender();
  }
  if (act === 'clear') { nc.sel = {}; return ncRender(); }
  if (act === 'readall') {
    setLastReadTs(Date.now(), nc.tab);
    ncSnack(nc.tab === 'announce' ? 'All announcements marked as read' : 'All requests marked as read');
    return ncRefreshAll();
  }
  if (act === 'undo') return ncUndo();
  if (act === 'open') {
    var one = Object.keys(nc.sel)[0];
    return one && ncOpenItem(one);
  }
  if (act === 'read' || act === 'unread' || act === 'dismiss') return ncApply(act);
}

function ncSelectedItems() {
  var sel = _notifState.nc.sel;
  return _notifState.notifications.filter(function(n) { return sel[n.id]; });
}

function ncApply(kind) {
  var nc = _notifState.nc, items = ncSelectedItems();
  if (!items.length) return;
  var label = items.length + (items.length === 1 ? ' notification' : ' notifications');

  if (kind === 'read' || kind === 'unread') {
    items.forEach(function(n) { _notifState.ov[n.id] = { s: kind === 'read' ? 'r' : 'u', t: notifTs(n) }; });
    nsSave('ov', _notifState.ov);
    ncSnack(label + ' marked as ' + kind);
  } else {
    var prev = {}, gone = {};
    items.forEach(function(n) {
      prev[n.id] = _notifState.dm[n.id] || null;
      _notifState.dm[n.id] = { t: notifTs(n) };
      gone[n.id] = true;
    });
    nsSave('dm', _notifState.dm);
    _notifState.notifications = _notifState.notifications.filter(function(n) { return !gone[n.id]; });
    nc.undo = { prev: prev, items: items };
    ncSnack(label + ' dismissed', true);
  }
  nc.sel = {}; nc.lastIdx = -1;
  ncRefreshAll();
}

function ncUndo() {
  var nc = _notifState.nc, u = nc.undo;
  if (!u) return;
  u.items.forEach(function(n) {
    if (u.prev[n.id]) _notifState.dm[n.id] = u.prev[n.id]; else delete _notifState.dm[n.id];
    _notifState.notifications.push(n);
  });
  _notifState.notifications.sort(function(a, b) { return notifTs(b) - notifTs(a); });
  nsSave('dm', _notifState.dm);
  nc.undo = null;
  ncSnack(u.items.length + ' restored');
  ncRefreshAll();
}

function ncOpenItem(id) {
  var n = null;
  _notifState.notifications.forEach(function(x) { if (x.id === id) n = x; });
  if (!n) return;
  _notifState.ov[n.id] = { s: 'r', t: notifTs(n) };   // opening one item marks only that item as read
  nsSave('ov', _notifState.ov);
  computeUnreadCount(_notifState.notifications);
  renderBell();
  closeNotifCenter();
  if (n.link && n.link !== '#') window.location.href = n.link;
}

function ncRefreshAll() {
  computeUnreadCount(_notifState.notifications);
  renderBell();
  renderDropdown();
  ncRender();
}

var _ncSnackTimer = null;
function ncSnack(msg, withUndo) {
  var el = ncEl('erpNcSnack');
  if (!el) return;
  el.innerHTML = '<span>' + erpEsc(msg) + '</span>' + (withUndo ? '<button type="button" data-nc="undo">Undo</button>' : '');
  el.className = 'erp-nc-snack show';
  clearTimeout(_ncSnackTimer);
  _ncSnackTimer = setTimeout(function() { el.className = 'erp-nc-snack'; }, withUndo ? 8000 : 2500);
}

function ncRender() {
  var nc = _notifState.nc, ov = ncEl('erpNcOverlay');
  if (!ov) return;
  var isWh = _notifState.userRole === 'warehouse';

  // drop selections whose notification is gone
  var present = {};
  _notifState.notifications.forEach(function(n) { present[n.id] = true; });
  Object.keys(nc.sel).forEach(function(id) { if (!present[id]) delete nc.sel[id]; });

  // tabs (warehouse only)
  var tabsEl = ncEl('erpNcTabs');
  if (isWh) {
    var rTot = 0, aTot = 0;
    _notifState.notifications.forEach(function(n) { if (notifCategory(n) === 'announce') aTot++; else rTot++; });
    tabsEl.style.display = '';
    tabsEl.innerHTML =
      '<button type="button" class="erp-nc-tab' + (nc.tab === 'request' ? ' on' : '') + '" data-nc="tab" data-tab="request">' +
        '<i class="bi bi-file-earmark-plus"></i> Requests <span class="n">' + rTot + '</span>' +
        (_notifState.unreadReq > 0 ? '<span class="u">' + _notifState.unreadReq + ' new</span>' : '') + '</button>' +
      '<button type="button" class="erp-nc-tab' + (nc.tab === 'announce' ? ' on' : '') + '" data-nc="tab" data-tab="announce">' +
        '<i class="bi bi-megaphone"></i> Announcements <span class="n">' + aTot + '</span>' +
        (_notifState.unreadAnn > 0 ? '<span class="u">' + _notifState.unreadAnn + ' new</span>' : '') + '</button>';
  } else {
    tabsEl.style.display = 'none';
  }

  // type filter options (from what is in this tab)
  var inTab = _notifState.notifications.filter(function(n) { return notifCategory(n) === nc.tab; });
  var types = [];
  inTab.forEach(function(n) { if (types.indexOf(n.title) === -1) types.push(n.title); });
  types.sort();
  if (nc.type && types.indexOf(nc.type) === -1) nc.type = '';
  var sel = ncEl('erpNcType'), sig = types.join('|');
  if (sel.getAttribute('data-sig') !== sig) {
    sel.innerHTML = '<option value="">All types</option>' +
      types.map(function(t) { return '<option value="' + erpEsc(t) + '">' + erpEsc(t) + '</option>'; }).join('');
    sel.setAttribute('data-sig', sig);
  }
  sel.value = nc.type;

  // list
  var list = ncList();
  nc.vis = list.map(function(n) { return n.id; });
  var html = '', lastGroup = null;
  list.forEach(function(n, idx) {
    var ts = notifTs(n), g = ncGroup(ts);
    if (g !== lastGroup) { html += '<div class="erp-nc-group">' + erpEsc(g) + '</div>'; lastGroup = g; }
    var unread = isNotifUnread(n), on = !!nc.sel[n.id];
    html += '<div class="erp-nc-row' + (unread ? ' unread' : '') + (on ? ' selected' : '') + '" role="option" aria-selected="' + on + '" tabindex="0" ' +
        'data-id="' + erpEsc(n.id) + '" data-idx="' + idx + '">' +
      '<span class="erp-nc-cb"><i class="bi ' + (on ? 'bi-check-square-fill' : 'bi-square') + '"></i></span>' +
      '<div class="erp-notif-icon" style="background:' + erpEsc(n.iconColor) + '20;color:' + erpEsc(n.iconColor) + ';"><i class="bi ' + erpEsc(n.icon) + '"></i></div>' +
      '<div class="erp-nc-main">' +
        '<div class="erp-nc-rt">' + erpEsc(n.title) + (unread ? '<span class="erp-nc-new">NEW</span>' : '') + '</div>' +
        '<div class="erp-notif-subtitle"><code>' + erpEsc(n.subtitle) + '</code></div>' +
        (n.meta ? '<div class="erp-notif-meta">' + erpEsc(n.meta) + '</div>' : '') +
      '</div>' +
      '<div class="erp-nc-side">' +
        '<span class="erp-nc-time" title="' + erpEsc(new Date(ts).toLocaleString()) + '">' + formatTimeAgo(ts) + '</span>' +
        '<button type="button" class="erp-nc-open" title="Open">Open <i class="bi bi-arrow-right"></i></button>' +
      '</div>' +
    '</div>';
  });
  if (!list.length) {
    html = '<div class="erp-notif-empty"><i class="bi bi-bell-slash fs-2 d-block mb-2"></i>' +
      (inTab.length ? 'No notifications match your filters' : (nc.tab === 'announce' ? 'No announcements' : 'No requests')) + '</div>';
  }
  var listEl = ncEl('erpNcList'), st = listEl.scrollTop;
  listEl.innerHTML = html;
  listEl.scrollTop = st;

  // select-all checkbox state
  var selCount = Object.keys(nc.sel).length;
  var visSel = nc.vis.filter(function(id) { return nc.sel[id]; }).length;
  var all = ncEl('erpNcAll');
  all.checked = nc.vis.length > 0 && visSel === nc.vis.length;
  all.indeterminate = visSel > 0 && visSel < nc.vis.length;
  all.disabled = nc.vis.length === 0;

  // action bar
  var bar = ncEl('erpNcBar');
  if (selCount > 0) {
    bar.className = 'erp-nc-bar active';
    bar.innerHTML =
      '<strong>' + selCount + ' selected</strong>' +
      '<button type="button" data-nc="read"><i class="bi bi-envelope-open"></i> Mark read</button>' +
      '<button type="button" data-nc="unread"><i class="bi bi-envelope"></i> Mark unread</button>' +
      '<button type="button" class="danger" data-nc="dismiss"><i class="bi bi-trash3"></i> Dismiss</button>' +
      (selCount === 1 ? '<button type="button" data-nc="open"><i class="bi bi-box-arrow-up-right"></i> Open</button>' : '') +
      '<button type="button" class="ghost" data-nc="clear">Clear</button>';
  } else {
    var unreadHere = inTab.filter(isNotifUnread).length;
    bar.className = 'erp-nc-bar';
    bar.innerHTML =
      '<span class="muted">' + list.length + (list.length === inTab.length ? '' : ' of ' + inTab.length) + ' shown · ' + unreadHere + ' unread</span>' +
      (unreadHere > 0 ? '<button type="button" class="ghost" data-nc="readall"><i class="bi bi-check2-all"></i> Mark all read</button>' : '');
  }

  var go = ncEl('erpNcGo');
  go.setAttribute('href', getNotifViewAllLink(nc.tab));
  go.textContent = '';
  go.innerHTML = (nc.tab === 'announce' ? 'Open Stock Monitor' : (_notifState.userRole === 'production' ? 'Open My Requests' : 'Open All Requests')) + ' <i class="bi bi-arrow-right"></i>';
}

// ═══════════════════════════════════════════════════════════
// TIME FORMATTING
// ═══════════════════════════════════════════════════════════
function formatTimeAgo(ts) {
  var now = Date.now();
  var diff = now - ts;
  var seconds = Math.floor(diff / 1000);
  var minutes = Math.floor(seconds / 60);
  var hours = Math.floor(minutes / 60);
  var days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  if (hours < 24) return hours + 'h ago';
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2500 }).show();
}

// Auto-init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNotifications);
} else {
  setTimeout(initNotifications, 500);
}

console.log('✅ notifications.js loaded');
