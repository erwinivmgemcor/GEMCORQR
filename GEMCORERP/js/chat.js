// ============================================================
// GEMCOR ERP — Chat System v3.0
// DM + Document threads via Supabase `messages` table
//  • Profile pictures (erp-avatars.js)
//  • Grouped bubbles, read ticks, emoji, jump-to-latest
//  • No more duplicated history on refresh (messages merged by id)
//  • Live: erp-chat-alerts.js tells this page the moment a message arrives
//  ✅ Role-based MRR filtering (warehouse only)
// ============================================================

var _chatState = {
  currentUser: null,
  currentFullname: '',
  activeTab: 'chats',
  openWith: null,
  openType: null,
  openDocType: null,
  users: [],
  msgs: [],            // messages of the open thread
  threadSig: '',
  lastTs: '',          // ISO created_at of the newest message we hold
  listSig: '',
  pollTimer: null,
  listTimer: null,
  loadingThread: false,
  isMobile: false,
  tempSeq: 0
};

var CHAT_EMOJI = ['😀','😂','😊','😍','👍','🙏','👏','🎉','😅','🤝','👌','✅','❌','⚠️','📦','🚚','⏰','❓','❤️','🔥','😢','😮','🙌','💪'];

// ═══════════════════════════════════════════════════════════
// ROLE HELPERS
// ═══════════════════════════════════════════════════════════
function _getUserRole() { return localStorage.getItem('ivm_userRole') || ''; }
function _isWarehouse() { return _getUserRole() === 'warehouse'; }
function _canAccessDocType(docType) {
  return !(String(docType || '').toUpperCase() === 'MRR' && !_isWarehouse());
}
function _getAllowedDocTypes() { return _isWarehouse() ? ['MRIF', 'MRR', 'MRS'] : ['MRIF', 'MRS']; }

function avHtml(username, fullname) {
  if (window.erpAvatars) return window.erpAvatars.html(username, fullname);
  return erpEsc(getInitials(fullname || username));
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  _chatState.currentUser = localStorage.getItem('ivm_username') || '';
  _chatState.currentFullname = localStorage.getItem('ivm_userFullname') || _chatState.currentUser;
  _chatState.isMobile = window.matchMedia('(max-width: 767.98px)').matches;
  if (!_chatState.currentUser) return;

  chatCheckHealth();
  loadConversations(false);
  if (window.erpAvatars) window.erpAvatars.refresh();

  setupInput();
  window.addEventListener('resize', function() {
    _chatState.isMobile = window.matchMedia('(max-width: 767.98px)').matches;
  });

  // the global alert module (erp-chat-alerts.js) fires this the moment something arrives
  window.addEventListener('erp-chat-new', function(e) {
    loadConversations(true);
    var list = (e && e.detail) || [];
    if (_chatState.openWith && list.some(_belongsToOpenThread)) pollThread();
  });
  window.addEventListener('erp-avatars-updated', function() {
    _chatState.listSig = ''; _chatState.threadSig = '';
    loadConversations(true);
    if (_chatState.openWith) { _fillHeader(); _renderThread(true); }
  });

  _chatState.listTimer = setInterval(function() {
    if (!document.hidden) loadConversations(true);
  }, 12000);

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) return;
    loadConversations(true);
    if (_chatState.openWith) { pollThread(); _markOpenRead(); }
  });
});

function _belongsToOpenThread(m) {
  if (!m || !_chatState.openWith) return false;
  if (_chatState.openType === 'doc') return m.doc_no === _chatState.openWith;
  return !m.doc_no && (m.sender === _chatState.openWith || m.recipient === _chatState.openWith);
}

async function chatCheckHealth() {
  var badge = document.getElementById('erpHealthBadge');
  if (!badge) return;
  var text = document.getElementById('erpHealthText');
  var dot = badge.querySelector('.dot');
  try {
    var result = await erpHealthCheck();
    dot.className = result.success ? 'dot dot-ok' : 'dot dot-error';
    text.textContent = result.success ? 'Connected (' + result.latency + 'ms)' : 'Offline';
  } catch(err) { dot.className = 'dot dot-error'; text.textContent = 'Error'; }
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function switchChatTab(tab) {
  _chatState.activeTab = tab;
  _chatState.listSig = '';
  document.querySelectorAll('.chat-tab-btn').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  loadConversations(false);
}
window.switchChatTab = switchChatTab;

// ═══════════════════════════════════════════════════════════
// CONVERSATION LIST
// ═══════════════════════════════════════════════════════════
async function loadConversations(silent) {
  var container = document.getElementById('chatConversationList');
  if (!container) return;

  if (!silent) {
    container.innerHTML = '<div class="chat-conv-loading"><div class="erp-spinner" style="width:24px;height:24px;border-width:2.5px;"></div></div>';
  }
  try {
    if (_chatState.activeTab === 'documents') await loadDocumentThreads(silent);
    else await loadUserConversations(silent);
  } catch(err) {
    console.error('[Chat] Load conversations failed:', err);
    if (!silent) container.innerHTML = '<div class="chat-conv-loading text-danger">Failed to load</div>';
  }
}

function _setList(html, sig) {
  var container = document.getElementById('chatConversationList');
  if (!container) return;
  if (sig === _chatState.listSig) return;
  _chatState.listSig = sig;
  var keep = container.scrollTop;
  container.innerHTML = html;
  container.scrollTop = keep;
  filterConversations();
}

function _setTotalUnread(n) {
  var el = document.getElementById('chatTotalUnread');
  if (!el) return;
  el.textContent = n; el.style.display = n > 0 ? '' : 'none';
}

function _roleChip(user) {
  var roles = user && Array.isArray(user.roles) ? user.roles : [];
  var w = roles.indexOf('warehouse') !== -1, p = roles.indexOf('production') !== -1;
  if (w && p) return '<span class="chat-chip both">BOTH</span>';
  if (w) return '<span class="chat-chip wh">WH</span>';
  if (p) return '<span class="chat-chip pr">PR</span>';
  return '';
}

async function loadUserConversations(silent) {
  var me = _chatState.currentUser;
  var usersRes = await erpFetch('users', 'select=username,fullname,roles,department&order=fullname.asc');
  if (!usersRes || usersRes.length === 0) {
    _setList('<div class="chat-conv-loading small">No users found</div>', 'empty-users');
    return;
  }
  _chatState.users = usersRes.filter(function(u) { return u.username !== me; });

  var messagesRes = await erpFetch('messages',
    'select=*' +
    '&or=(sender.eq.' + encodeURIComponent(me) + ',recipient.eq.' + encodeURIComponent(me) + ')' +
    '&or=(doc_no.is.null,doc_no.eq.)' +
    '&order=created_at.desc&limit=500');

  var convMap = {};
  (messagesRes || []).forEach(function(m) {
    var other = m.sender === me ? m.recipient : m.sender;
    if (!other) return;
    if (!convMap[other]) convMap[other] = { other: other, lastMsg: m, unread: 0 };
    if (m.recipient === me && !m.is_read) convMap[other].unread++;
  });

  var convs = Object.keys(convMap).map(function(k) { return convMap[k]; });
  convs.sort(function(a, b) {
    if (a.unread > 0 && b.unread === 0) return -1;
    if (b.unread > 0 && a.unread === 0) return 1;
    return new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime();
  });

  var totalUnread = convs.reduce(function(s, c) { return s + c.unread; }, 0);
  _setTotalUnread(totalUnread);

  function findUser(u) { return _chatState.users.find(function(x) { return x.username === u; }); }

  var html = '', sig = 'u|' + _chatState.openWith + '|';
  convs.forEach(function(c) {
    var user = findUser(c.other);
    var fullname = user ? (user.fullname || c.other) : c.other;
    var preview = c.lastMsg.body || '';
    if (preview.length > 46) preview = preview.substring(0, 46) + '…';
    var prefix = c.lastMsg.sender === me ? 'You: ' : '';
    var active = (_chatState.openWith === c.other && _chatState.openType === 'user') ? ' active' : '';
    var av = avHtml(c.other, fullname);
    sig += c.other + ':' + c.lastMsg.id + ':' + c.unread + ':' + (window.erpAvatars ? (window.erpAvatars.get(c.other) || '').length : 0) + ';';

    html += '<div class="chat-conv-item' + active + (c.unread ? ' unread' : '') + '" data-username="' + erpEsc(c.other) + '" data-name="' + erpEsc(fullname) + '" onclick="openUserConversation(\'' + String(c.other).replace(/\\/g,'\\\\').replace(/'/g, "\\'") + '\')">' +
      '<div class="chat-conv-avatar">' + av + '</div>' +
      '<div class="chat-conv-content">' +
        '<div class="chat-conv-row"><div class="chat-conv-name">' + erpEsc(fullname) + _roleChip(user) + '</div>' +
        '<div class="chat-conv-time">' + erpEsc(formatTimeAgo(c.lastMsg.created_at)) + '</div></div>' +
        '<div class="chat-conv-preview">' + erpEsc(prefix + preview) + '</div>' +
      '</div>' +
      (c.unread > 0 ? '<div class="chat-unread-badge">' + c.unread + '</div>' : '') +
    '</div>';
  });

  var fresh = _chatState.users.filter(function(u) { return !convMap[u.username]; });
  if (fresh.length) {
    if (convs.length) html += '<div class="chat-section-label">Start a new chat</div>';
    fresh.forEach(function(u) {
      var fullname = u.fullname || u.username;
      sig += 'n' + u.username + (window.erpAvatars ? (window.erpAvatars.get(u.username) || '').length : 0) + ';';
      html += '<div class="chat-conv-item" data-username="' + erpEsc(u.username) + '" data-name="' + erpEsc(fullname) + '" onclick="openUserConversation(\'' + String(u.username).replace(/\\/g,'\\\\').replace(/'/g, "\\'") + '\')">' +
        '<div class="chat-conv-avatar">' + avHtml(u.username, fullname) + '</div>' +
        '<div class="chat-conv-content">' +
          '<div class="chat-conv-name">' + erpEsc(fullname) + _roleChip(u) + '</div>' +
          '<div class="chat-conv-preview hint">Tap to start a chat</div>' +
        '</div></div>';
    });
  }
  _setList(html || '<div class="chat-conv-loading small">No users to chat with</div>', sig);
}

async function loadDocumentThreads(silent) {
  var me = _chatState.currentUser;
  var typeFilter = '&doc_type=in.(' + _getAllowedDocTypes().join(',') + ')';
  var messagesRes = await erpFetch('messages',
    'select=*&doc_no=not.is.null&doc_no=neq.' + typeFilter + '&order=created_at.desc&limit=500');

  var threadMap = {};
  (messagesRes || []).forEach(function(m) {
    if (!m.doc_no) return;
    if (!threadMap[m.doc_no]) threadMap[m.doc_no] = { docNo: m.doc_no, docType: m.doc_type || '', lastMsg: m, unread: 0 };
    if (m.sender !== me && !m.is_read) threadMap[m.doc_no].unread++;
  });
  var threads = Object.keys(threadMap).map(function(k) { return threadMap[k]; });
  threads.sort(function(a, b) {
    if (a.unread > 0 && b.unread === 0) return -1;
    if (b.unread > 0 && a.unread === 0) return 1;
    return new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime();
  });

  if (!threads.length) {
    _setList('<div class="chat-conv-loading small">No document discussions yet.<br><br>' +
      '<i class="bi bi-file-earmark-text" style="font-size:2rem;opacity:.3;"></i><br>' +
      'Open a document and click "Discuss" to start one.</div>', 'empty-docs');
    return;
  }

  var html = '', sig = 'd|' + _chatState.openWith + '|';
  threads.forEach(function(t) {
    var isMe = t.lastMsg.sender === me;
    var senderName = isMe ? 'You' : String(t.lastMsg.sender_fullname || t.lastMsg.sender || '').split(' ')[0];
    var preview = t.lastMsg.body || '';
    if (preview.length > 40) preview = preview.substring(0, 40) + '…';
    var cls = t.docType === 'MRIF' ? 'mrif' : t.docType === 'MRR' ? 'mrr' : t.docType === 'MRS' ? 'mrs' : '';
    var chip = t.docType ? '<span class="chat-chip ' + cls + '">' + erpEsc(t.docType) + '</span>' : '';
    var active = (_chatState.openWith === t.docNo && _chatState.openType === 'doc') ? ' active' : '';
    sig += t.docNo + ':' + t.lastMsg.id + ':' + t.unread + ';';

    html += '<div class="chat-conv-item' + active + (t.unread ? ' unread' : '') + '" data-doc="' + erpEsc(t.docNo) + '" data-name="' + erpEsc(t.docNo) + '" onclick="openDocConversation(\'' + String(t.docNo).replace(/\\/g,'\\\\').replace(/'/g, "\\'") + '\', \'' + String(t.docType || '').replace(/'/g, "\\'") + '\')">' +
      '<div class="chat-conv-avatar chat-av-doc"><i class="bi bi-file-earmark-text"></i></div>' +
      '<div class="chat-conv-content">' +
        '<div class="chat-conv-row"><div class="chat-conv-name">' + erpEsc(t.docNo) + chip + '</div>' +
        '<div class="chat-conv-time">' + erpEsc(formatTimeAgo(t.lastMsg.created_at)) + '</div></div>' +
        '<div class="chat-conv-preview">' + erpEsc(senderName + ': ' + preview) + '</div>' +
      '</div>' +
      (t.unread > 0 ? '<div class="chat-unread-badge">' + t.unread + '</div>' : '') +
    '</div>';
  });
  _setList(html, sig);
}

// ═══════════════════════════════════════════════════════════
// OPEN CONVERSATIONS
// ═══════════════════════════════════════════════════════════
function _resetThread() {
  _chatState.msgs = []; _chatState.threadSig = ''; _chatState.lastTs = '';
  _hideJump();
}

function _fillHeader() {
  var avEl = document.getElementById('chatPanelAvatar');
  if (_chatState.openType === 'user') {
    var user = _chatState.users.find(function(u) { return u.username === _chatState.openWith; });
    var fullname = user ? (user.fullname || _chatState.openWith) : _chatState.openWith;
    document.getElementById('chatWithName').textContent = fullname;
    document.getElementById('chatWithSub').textContent = '@' + _chatState.openWith + (user && user.department ? ' · ' + user.department : '');
    avEl.className = 'chat-panel-avatar';
    avEl.innerHTML = avHtml(_chatState.openWith, fullname);
  } else {
    document.getElementById('chatWithName').textContent = _chatState.openWith;
    document.getElementById('chatWithSub').textContent = 'Document discussion';
    avEl.className = 'chat-panel-avatar chat-av-doc';
    avEl.innerHTML = '<i class="bi bi-file-earmark-text"></i>';
  }
}

function _showPanel() {
  if (_chatState.isMobile) document.getElementById('chatWrapper').classList.add('mobile-chat-open');
  document.getElementById('chatEmptyState').style.display = 'none';
  document.getElementById('chatPanel').style.display = 'flex';
}

async function openUserConversation(otherUsername) {
  _chatState.openWith = otherUsername;
  _chatState.openType = 'user';
  _chatState.openDocType = null;
  _resetThread();
  _showPanel();
  document.getElementById('chatDocBanner').style.display = 'none';
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-username') === otherUsername);
  });

  if (!_chatState.users.length) {
    try { await loadConversations(true); } catch(e) {}
  }
  _fillHeader();
  _setThreadLoading();
  _markOpenRead();
  await loadThread();
  setTimeout(function() { var i = document.getElementById('chatInput'); if (i && !_chatState.isMobile) i.focus(); }, 150);
  startPolling();
}
window.openUserConversation = openUserConversation;

async function openDocConversation(docNo, docType) {
  if (!_canAccessDocType(docType)) {
    if (typeof erpShowToast === 'function') erpShowToast('MRR discussions are accessible to warehouse only', 'warning');
    setTimeout(function() { window.location.href = 'chat.html'; }, 500);
    return;
  }
  _chatState.openWith = docNo;
  _chatState.openType = 'doc';
  _chatState.openDocType = docType || '';
  _resetThread();
  _showPanel();
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-doc') === docNo);
  });
  _fillHeader();
  var banner = document.getElementById('chatDocBanner');
  banner.style.display = 'block';
  banner.innerHTML = '<i class="bi bi-file-earmark-text me-1"></i>Discussion about <strong>' + erpEsc(docNo) + '</strong>' +
    (docType ? ' <span class="chat-chip ' + String(docType).toLowerCase() + '">' + erpEsc(docType) + '</span>' : '');

  _setThreadLoading();
  _markOpenRead();
  await loadThread();
  setTimeout(function() { var i = document.getElementById('chatInput'); if (i && !_chatState.isMobile) i.focus(); }, 150);
  startPolling();
}
window.openDocConversation = openDocConversation;

function closeConversation() {
  _chatState.openWith = null;
  _chatState.openType = null;
  if (_chatState.pollTimer) { clearInterval(_chatState.pollTimer); _chatState.pollTimer = null; }
  if (_chatState.isMobile) document.getElementById('chatWrapper').classList.remove('mobile-chat-open');
  document.getElementById('chatEmptyState').style.display = 'flex';
  document.getElementById('chatPanel').style.display = 'none';
  _chatState.listSig = '';
  loadConversations(true);
}
window.closeConversation = closeConversation;

function _setThreadLoading() {
  document.getElementById('chatMessages').innerHTML =
    '<div class="chat-nomsg"><div class="erp-spinner" style="width:24px;height:24px;border-width:2.5px;margin:0 auto;"></div></div>';
}

// ═══════════════════════════════════════════════════════════
// THREAD DATA (merge by id — never duplicates)
// ═══════════════════════════════════════════════════════════
function _msgKey(m) { return m.id != null ? 'i' + m.id : 'k' + m.created_at + '|' + m.sender + '|' + (m.body || ''); }

function _mergeMsgs(rows) {
  var map = {};
  _chatState.msgs.forEach(function(m) { map[_msgKey(m)] = m; });
  var added = 0;
  (rows || []).forEach(function(m) {
    var k = _msgKey(m);
    if (!map[k]) added++;
    map[k] = m;
  });
  var all = Object.keys(map).map(function(k) { return map[k]; });
  all.sort(function(a, b) {
    var d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return d || (Number(a.id) - Number(b.id)) || 0;
  });
  _chatState.msgs = all;
  if (all.length) _chatState.lastTs = all[all.length - 1].created_at;
  return added;
}

function _dmQueries(since) {
  var me = encodeURIComponent(_chatState.currentUser), other = encodeURIComponent(_chatState.openWith);
  var docFilter = '&or=(doc_no.is.null,doc_no.eq.)';
  var after = since ? '&created_at=gt.' + encodeURIComponent(since) : '';
  var order = since ? '&order=created_at.asc&limit=100' : '&order=created_at.desc&limit=300';
  return [
    erpFetch('messages', 'select=*&sender=eq.' + me + '&recipient=eq.' + other + docFilter + after + order),
    erpFetch('messages', 'select=*&sender=eq.' + other + '&recipient=eq.' + me + docFilter + after + order)
  ];
}

async function loadThread() {
  if (!_chatState.openWith) return;
  var token = _chatState.openType + '|' + _chatState.openWith;
  try {
    var rows;
    if (_chatState.openType === 'user') {
      var r = await Promise.all(_dmQueries(''));
      rows = (r[0] || []).concat(r[1] || []);
    } else {
      rows = await erpFetch('messages', 'select=*&doc_no=eq.' + encodeURIComponent(_chatState.openWith) + '&order=created_at.desc&limit=300');
    }
    if (token !== _chatState.openType + '|' + _chatState.openWith) return;   // user switched meanwhile
    _chatState.msgs = []; _mergeMsgs(rows);
    _renderThread(true);
  } catch(err) {
    console.error('[Chat] Load thread failed:', err);
    document.getElementById('chatMessages').innerHTML =
      '<div class="chat-nomsg text-danger">Failed to load: ' + erpEsc(err.message) + '</div>';
  }
}

async function pollThread() {
  if (!_chatState.openWith || _chatState.loadingThread) return;
  _chatState.loadingThread = true;
  var token = _chatState.openType + '|' + _chatState.openWith;
  try {
    var added = 0, changed = false;
    if (_chatState.openType === 'user') {
      var calls = _dmQueries(_chatState.lastTs);
      calls.push(erpFetch('messages',
        'select=id&sender=eq.' + encodeURIComponent(_chatState.currentUser) +
        '&recipient=eq.' + encodeURIComponent(_chatState.openWith) +
        '&or=(doc_no.is.null,doc_no.eq.)&is_read=eq.false&limit=300'));
      var r = await Promise.all(calls);
      if (token !== _chatState.openType + '|' + _chatState.openWith) return;
      added = _mergeMsgs((r[0] || []).concat(r[1] || []));
      // read ticks: my messages that are no longer unread on the server
      var stillUnread = {};
      (r[2] || []).forEach(function(x) { stillUnread[x.id] = 1; });
      _chatState.msgs.forEach(function(m) {
        if (m.id != null && m.sender === _chatState.currentUser && !m.is_read && !stillUnread[m.id]) { m.is_read = true; changed = true; }
      });
    } else {
      var rows = await erpFetch('messages',
        'select=*&doc_no=eq.' + encodeURIComponent(_chatState.openWith) +
        '&created_at=gt.' + encodeURIComponent(_chatState.lastTs || '1970-01-01T00:00:00Z') +
        '&order=created_at.asc&limit=100');
      if (token !== _chatState.openType + '|' + _chatState.openWith) return;
      added = _mergeMsgs(rows || []);
    }
    if (added || changed) {
      var incoming = _chatState.msgs.slice(-added).filter(function(m) { return m.sender !== _chatState.currentUser; });
      _renderThread(false, incoming.length);
      if (incoming.length && !document.hidden) _markOpenRead();
      loadConversations(true);
    }
  } catch(e) { /* next poll retries */ }
  finally { _chatState.loadingThread = false; }
}

function startPolling() {
  if (_chatState.pollTimer) clearInterval(_chatState.pollTimer);
  _chatState.pollTimer = setInterval(function() {
    if (!_chatState.openWith || document.hidden) return;
    pollThread();
  }, 4000);
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, function(u) {
    return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>';
  });
}

function _renderThread(forceBottom, newIncoming) {
  var container = document.getElementById('chatMessages');
  if (!container) return;
  var msgs = _chatState.msgs;
  var sig = msgs.map(function(m) { return _msgKey(m) + (m.is_read ? 'r' : ''); }).join(',');
  if (sig === _chatState.threadSig && !forceBottom) return;
  _chatState.threadSig = sig;

  if (!msgs.length) {
    container.innerHTML = '<div class="chat-nomsg"><i class="bi bi-chat-dots"></i>No messages yet. Say hi 👋</div>';
    return;
  }

  var nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 90;
  var prevTop = container.scrollTop;
  var isDoc = _chatState.openType === 'doc';
  var me = _chatState.currentUser;
  var html = '', lastDate = '';

  msgs.forEach(function(m, i) {
    var d = new Date(m.created_at), label = formatDateLabel(d);
    if (label !== lastDate) { html += '<div class="chat-date-sep">' + erpEsc(label) + '</div>'; lastDate = label; }

    var prev = msgs[i - 1], next = msgs[i + 1];
    var isMe = m.sender === me;
    function sameGroup(a, b) {
      return a && b && a.sender === b.sender && formatDateLabel(new Date(a.created_at)) === formatDateLabel(new Date(b.created_at)) &&
        Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 5 * 60 * 1000;
    }
    var first = !sameGroup(prev, m), last = !sameGroup(m, next);

    var avatar = '';
    if (!isMe) {
      avatar = last
        ? '<div class="chat-msg-avatar">' + avHtml(m.sender, m.sender_fullname) + '</div>'
        : '<div class="chat-msg-spacer"></div>';
    }
    var senderLine = (!isMe && isDoc && first)
      ? '<div class="chat-bubble-sender">' + erpEsc(m.sender_fullname || m.sender) + '</div>' : '';

    var tick = '';
    if (isMe && !isDoc) tick = '<i class="bi ' + (m.is_read ? 'bi-check2-all read' : 'bi-check2') + ' chat-tick"></i>';
    var timeLine = last ? '<div class="chat-bubble-time">' + erpEsc(formatTime(d)) + tick + '</div>' : '';

    html += '<div class="chat-row ' + (isMe ? 'me' : 'them') + (first ? ' first' : '') + (last ? ' last' : '') + '" title="' + erpEsc(formatTime(d)) + '">' +
      avatar +
      '<div class="chat-bubble ' + (isMe ? 'chat-bubble-me' : 'chat-bubble-them') + '">' + senderLine +
        '<div class="chat-bubble-body">' + linkify(erpEsc(m.body || '')) + '</div>' + timeLine +
      '</div></div>';
  });

  container.innerHTML = html;
  if (forceBottom || nearBottom) { container.scrollTop = container.scrollHeight; _hideJump(); }
  else {
    container.scrollTop = prevTop;
    if (newIncoming) _showJump(newIncoming);
  }
}

function _showJump(n) {
  var b = document.getElementById('chatJump'); if (!b) return;
  _chatState.jumpCount = (_chatState.jumpCount || 0) + n;
  document.getElementById('chatJumpText').textContent = _chatState.jumpCount + ' new message' + (_chatState.jumpCount > 1 ? 's' : '');
  b.style.display = 'flex';
}
function _hideJump() {
  _chatState.jumpCount = 0;
  var b = document.getElementById('chatJump'); if (b) b.style.display = 'none';
}
function chatScrollToEnd() {
  var c = document.getElementById('chatMessages');
  if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
  _hideJump();
}
window.chatScrollToEnd = chatScrollToEnd;

// ═══════════════════════════════════════════════════════════
// SEND
// ═══════════════════════════════════════════════════════════
async function sendMessage() {
  var input = document.getElementById('chatInput');
  if (!input) return;
  if (!_chatState.openWith) {
    if (typeof erpShowToast === 'function') erpShowToast('Open a conversation first', 'warning');
    return;
  }
  var body = input.value.trim();
  if (!body) return;
  if (_chatState.openType === 'doc' && !_canAccessDocType(_chatState.openDocType)) {
    if (typeof erpShowToast === 'function') erpShowToast('MRR discussions are warehouse-only', 'warning');
    return;
  }
  input.value = ''; input.style.height = 'auto'; _updateCounter();
  document.getElementById('chatEmojiPop').style.display = 'none';
  _sendBody(body);
}
window.sendMessage = sendMessage;

async function _sendBody(body, retryEl) {
  var container = document.getElementById('chatMessages');
  var payload = {
    sender: _chatState.currentUser,
    sender_fullname: _chatState.currentFullname,
    body: body, is_read: false, read_at: null,
    doc_no: null, doc_type: null, recipient: null
  };
  if (_chatState.openType === 'user') payload.recipient = _chatState.openWith;
  else { payload.doc_no = _chatState.openWith; payload.doc_type = _chatState.openDocType || ''; }
  var token = _chatState.openType + '|' + _chatState.openWith;

  var temp = retryEl;
  if (!temp && container) {
    var emptyNote = container.querySelector('.chat-nomsg'); if (emptyNote) emptyNote.remove();
    temp = document.createElement('div');
    temp.className = 'chat-row me last first';
    container.appendChild(temp);
  }
  if (temp) {
    temp.onclick = null; temp.style.cursor = '';
    temp.innerHTML = '<div class="chat-bubble chat-bubble-me sending"><div class="chat-bubble-body">' + linkify(erpEsc(body)) +
      '</div><div class="chat-bubble-time">Sending…</div></div>';
    container.scrollTop = container.scrollHeight;
  }

  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 15000);
    var res = await fetch(erpUrl('messages'), {
      method: 'POST', headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload), signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var result = await res.json();
    if (temp && temp.parentNode) temp.remove();
    if (token === _chatState.openType + '|' + _chatState.openWith && result && result[0]) {
      _mergeMsgs([result[0]]);
      _renderThread(true);
    }
    try { loadConversations(true); } catch(e) {}
  } catch(err) {
    console.error('[Chat] Send failed:', err);
    if (temp) {
      temp.innerHTML = '<div class="chat-bubble chat-bubble-me failed"><div class="chat-bubble-body">' + linkify(erpEsc(body)) +
        '</div><div class="chat-bubble-time">Failed · click to retry</div></div>';
      temp.style.cursor = 'pointer';
      temp.onclick = function() { _sendBody(body, temp); };
    }
    if (typeof erpShowToast === 'function') erpShowToast('Message not sent: ' + err.message, 'danger');
  }
}

// ═══════════════════════════════════════════════════════════
// MARK AS READ
// ═══════════════════════════════════════════════════════════
function _markOpenRead() {
  if (!_chatState.openWith) return;
  var p = _chatState.openType === 'user' ? markConversationRead(_chatState.openWith) : markDocThreadRead(_chatState.openWith);
  Promise.resolve(p).then(function() {
    window.dispatchEvent(new CustomEvent('erp-chat-read'));
    loadConversations(true);
  });
}

async function markConversationRead(otherUser) {
  try {
    await fetch(erpUrl('messages?recipient=eq.' + encodeURIComponent(_chatState.currentUser) +
                       '&sender=eq.' + encodeURIComponent(otherUser) +
                       '&or=(doc_no.is.null,doc_no.eq.)&is_read=eq.false'), {
      method: 'PATCH', headers: erpHeaders(),
      body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() })
    });
  } catch(e) {}
}

async function markDocThreadRead(docNo) {
  try {
    await fetch(erpUrl('messages?doc_no=eq.' + encodeURIComponent(docNo) +
                       '&is_read=eq.false&sender=not.eq.' + encodeURIComponent(_chatState.currentUser)), {
      method: 'PATCH', headers: erpHeaders(),
      body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() })
    });
  } catch(e) {}
}

// kept for other pages that call it
async function refreshChatBadge() {
  if (window.erpChatAlerts && window.erpChatAlerts.refreshCount) return window.erpChatAlerts.refreshCount();
}
window.refreshChatBadge = refreshChatBadge;

// ═══════════════════════════════════════════════════════════
// FILTER
// ═══════════════════════════════════════════════════════════
function filterConversations() {
  var inp = document.getElementById('chatSearchInput');
  var term = ((inp && inp.value) || '').toLowerCase().trim();
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    var text = ((el.getAttribute('data-name') || '') + ' ' + (el.getAttribute('data-username') || '') + ' ' + (el.getAttribute('data-doc') || '')).toLowerCase();
    el.style.display = (!term || text.indexOf(term) !== -1) ? '' : 'none';
  });
}
window.filterConversations = filterConversations;

// ═══════════════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════════════
function _updateCounter() {
  var input = document.getElementById('chatInput'), c = document.getElementById('chatCounter');
  if (!input || !c) return;
  var left = 500 - input.value.length;
  c.textContent = left <= 80 ? left : '';
  c.classList.toggle('warn', left <= 20);
}

function setupInput() {
  var input = document.getElementById('chatInput');
  var btn = document.getElementById('chatSendBtn');
  var emojiBtn = document.getElementById('chatEmojiBtn');
  var pop = document.getElementById('chatEmojiPop');
  if (!input || !btn) return;

  input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    _updateCounter();
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  btn.addEventListener('click', function(e) { e.preventDefault(); sendMessage(); });

  if (pop && emojiBtn) {
    pop.innerHTML = CHAT_EMOJI.map(function(e) { return '<button type="button" data-e="' + e + '">' + e + '</button>'; }).join('');
    emojiBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      pop.style.display = pop.style.display === 'none' ? 'grid' : 'none';
    });
    pop.addEventListener('click', function(e) {
      var b = e.target.closest('button[data-e]'); if (!b) return;
      var s = input.selectionStart || input.value.length;
      if (input.value.length + b.dataset.e.length <= 500) {
        input.value = input.value.slice(0, s) + b.dataset.e + input.value.slice(input.selectionEnd || s);
        input.focus(); input.selectionStart = input.selectionEnd = s + b.dataset.e.length;
        _updateCounter();
      }
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#chatEmojiPop')) pop.style.display = 'none';
    });
  }

  var msgs = document.getElementById('chatMessages');
  if (msgs) msgs.addEventListener('scroll', function() {
    if (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 90) _hideJump();
  });
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function getInitials(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  var diff = Date.now() - new Date(ts).getTime();
  var seconds = Math.floor(diff / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (seconds < 60) return 'now';
  if (minutes < 60) return minutes + 'm';
  if (hours < 24) return hours + 'h';
  if (days < 7) return days + 'd';
  var d = new Date(ts), months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

function formatTime(d) {
  var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return ((h % 12) || 12) + ':' + m + ' ' + (h >= 12 ? 'PM' : 'AM');
}

function formatDateLabel(d) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var diff = Math.round((today - msgDate) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════
// URL PARAMS  (chat.html?user=X  or  ?doc=NO&type=MRIF)
// ═══════════════════════════════════════════════════════════
function checkUrlParams() {
  var params = new URLSearchParams(window.location.search);
  var docNo = params.get('doc'), docType = params.get('type'), user = params.get('user');
  if (docNo) {
    switchChatTab('documents');
    setTimeout(function() { openDocConversation(docNo, docType || ''); }, 400);
  } else if (user) {
    setTimeout(function() { openUserConversation(user); }, 400);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { setTimeout(checkUrlParams, 600); });
} else { setTimeout(checkUrlParams, 600); }

console.log('✅ chat.js v3.0 loaded');
