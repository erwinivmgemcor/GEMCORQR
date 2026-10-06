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
  refreshInterval: null,
  lastFetchTs: 0
};

var NOTIF_REFRESH_MS = 30000; // 30 seconds

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

  // Initial fetch
  fetchNotifications();

  // Auto-refresh
  if (_notifState.refreshInterval) clearInterval(_notifState.refreshInterval);
  _notifState.refreshInterval = setInterval(fetchNotifications, NOTIF_REFRESH_MS);

  // Pause when tab hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      if (_notifState.refreshInterval) {
        clearInterval(_notifState.refreshInterval);
        _notifState.refreshInterval = null;
      }
    } else {
      fetchNotifications();
      if (!_notifState.refreshInterval) {
        _notifState.refreshInterval = setInterval(fetchNotifications, NOTIF_REFRESH_MS);
      }
    }
  });

  console.log('[Notifications] Ready for', _notifState.userRole, ':', _notifState.userFullname);
}

// ═══════════════════════════════════════════════════════════
// FETCH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
async function fetchNotifications() {
  try {
    var notifications = [];

    if (_notifState.userRole === 'warehouse') {
      notifications = await fetchWarehouseNotifications();
    } else if (_notifState.userRole === 'production') {
      notifications = await fetchProductionNotifications();
    }

    // Sort by timestamp desc
    notifications.sort(function(a, b) {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    _notifState.notifications = notifications.slice(0, 20); // Top 20
    _notifState.unreadCount = computeUnreadCount(notifications);
    _notifState.lastFetchTs = Date.now();

    renderBell();
    renderDropdown();

    console.log('[Notifications] Fetched', notifications.length, 'notifications · Unread:', _notifState.unreadCount);

  } catch(err) {
    console.error('[fetchNotifications]', err);
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
      '&order=created_at.desc&limit=50');

    (docsRes || []).forEach(function(d) {
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
    console.warn('[Production notif] Failed:', err.message);
  }

  return notifications;
}

// ═══════════════════════════════════════════════════════════
// UNREAD COUNT (based on localStorage last-read timestamp)
// ═══════════════════════════════════════════════════════════
function computeUnreadCount(notifications) {
  var lastReadTs = getLastReadTs();
  var count = 0;

  notifications.forEach(function(n) {
    var ts = new Date(n.timestamp).getTime();
    if (ts > lastReadTs) count++;
  });

  return count;
}

function getLastReadTs() {
  try {
    var key = 'ivm_notif_last_read_' + _notifState.username;
    return parseInt(localStorage.getItem(key) || '0', 10) || 0;
  } catch(e) { return 0; }
}

function setLastReadTs(ts) {
  try {
    var key = 'ivm_notif_last_read_' + _notifState.username;
    localStorage.setItem(key, String(ts));
  } catch(e) {}
}

function markAllAsRead() {
  setLastReadTs(Date.now());
  _notifState.unreadCount = 0;
  renderBell();
  renderDropdown();
  erpShowToast('✅ All marked as read', 'success');
}

// ═══════════════════════════════════════════════════════════
// RENDER BELL
// ═══════════════════════════════════════════════════════════
function renderBell() {
  var bellContainer = document.getElementById('erpBellContainer');
  if (!bellContainer) return;

  var count = _notifState.unreadCount;
  var badgeHtml = count > 0 ? '<span class="badge-dot">' + (count > 99 ? '99+' : count) + '</span>' : '';

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

  var notifs = _notifState.notifications;
  var lastReadTs = getLastReadTs();

  var html = '<div class="erp-notif-dropdown">';

  // Header
  html += '<div class="erp-notif-header">' +
    '<div class="fw-bold"><i class="bi bi-bell-fill me-2"></i>Notifications</div>' +
    (notifs.length > 0 ? '<button class="erp-notif-mark-read" onclick="markAllAsRead()" type="button">Mark all read</button>' : '') +
  '</div>';

  // List
  if (notifs.length === 0) {
    html += '<div class="erp-notif-empty">' +
      '<i class="bi bi-bell-slash fs-2 d-block mb-2 text-muted"></i>' +
      '<div>No notifications</div>' +
    '</div>';
  } else {
    html += '<div class="erp-notif-list">';
    notifs.forEach(function(n) {
      var ts = new Date(n.timestamp).getTime();
      var isUnread = ts > lastReadTs;
      var timeAgo = formatTimeAgo(ts);

      var safeDoc = String(n.docNo || '').replace(/'/g, "\\'");
      html += '<div class="erp-notif-item' + (isUnread ? ' unread' : '') + '" ' +
        'onclick="handleNotifClick(\'' + n.link + '\', \'' + safeDoc + '\')" ' +
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
      '<a href="' + getNotifViewAllLink() + '" class="erp-notif-view-all">' +
        'View All <i class="bi bi-arrow-right ms-1"></i>' +
      '</a>' +
    '</div>';
  }

  html += '</div>';
  notifContainer.innerHTML = html;
}

function getNotifViewAllLink() {
  if (_notifState.userRole === 'warehouse') return 'all-requests.html';
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
function handleNotifClick(link, docNo) {
  // Mark this notification as read by setting last-read to NOW
  setLastReadTs(Date.now());
  _notifState.unreadCount = 0;
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
