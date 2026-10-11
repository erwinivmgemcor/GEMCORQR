// ============================================================
// GEMCOR ERP — Chat System
// DM + Document threads via Supabase `messages` table
// ============================================================

var _chatState = {
  currentUser: null,
  currentFullname: '',
  activeTab: 'chats',
  openWith: null,           // Username of DM recipient OR doc_no
  openType: null,           // 'user' | 'doc'
  openDocType: null,        // MRIF | MRR | MRS
  conversations: [],
  users: [],
  pollTimer: null,
  badgeTimer: null,
  lastMsgTs: 0,
  isMobile: false
};

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Chat] Initializing...');
  
  _chatState.currentUser = localStorage.getItem('ivm_username') || '';
  _chatState.currentFullname = localStorage.getItem('ivm_userFullname') || _chatState.currentUser;
  _chatState.isMobile = window.matchMedia('(max-width: 767.98px)').matches;
  
  if (!_chatState.currentUser) {
    console.warn('[Chat] No user logged in');
    return;
  }
  
  console.log('[Chat] User:', _chatState.currentUser, '| Fullname:', _chatState.currentFullname);
  
  chatCheckHealth();
  loadConversations();
  refreshChatBadge();
  
  // Auto-refresh badge every 2 min
  _chatState.badgeTimer = setInterval(refreshChatBadge, 120000);
  
  // Handle resize
  window.addEventListener('resize', function() {
    _chatState.isMobile = window.matchMedia('(max-width: 767.98px)').matches;
  });
  
  // Setup input handlers
  setupInputHandlers();
  
  // Pause polling when tab hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      if (_chatState.pollTimer) clearInterval(_chatState.pollTimer);
      if (_chatState.badgeTimer) clearInterval(_chatState.badgeTimer);
    } else {
      refreshChatBadge();
      _chatState.badgeTimer = setInterval(refreshChatBadge, 120000);
      if (_chatState.openWith && _chatState.openType === 'user') {
        loadMessages(_chatState.openWith, 0, false);
        startPolling();
      } else if (_chatState.openWith && _chatState.openType === 'doc') {
        loadDocMessages(_chatState.openWith, 0, false);
        startPolling();
      }
    }
  });
});

async function chatCheckHealth() {
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
// TABS
// ═══════════════════════════════════════════════════════════
function switchChatTab(tab) {
  _chatState.activeTab = tab;
  
  document.querySelectorAll('.chat-tab-btn').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  
  loadConversations();
}

window.switchChatTab = switchChatTab;

// ═══════════════════════════════════════════════════════════
// LOAD CONVERSATIONS
// ═══════════════════════════════════════════════════════════
async function loadConversations() {
  var container = document.getElementById('chatConversationList');
  if (!container) return;
  
  container.innerHTML = '<div class="chat-conv-loading">' +
    '<div class="erp-spinner" style="width:24px;height:24px;border-width:2.5px;"></div>' +
    '</div>';
  
  try {
    if (_chatState.activeTab === 'documents') {
      await loadDocumentThreads();
    } else {
      await loadUserConversations();
    }
  } catch(err) {
    console.error('[Chat] Load conversations failed:', err);
    container.innerHTML = '<div class="chat-conv-loading text-danger">Failed to load</div>';
  }
}

async function loadUserConversations() {
  var container = document.getElementById('chatConversationList');
  
  // ═══ Load all users (except self) ═══
  var usersRes = await erpFetch('users',
    'select=username,fullname,roles,department&order=fullname.asc');
  
  if (!usersRes || usersRes.length === 0) {
    container.innerHTML = '<div class="chat-conv-loading text-muted small">No users found</div>';
    return;
  }
  
  _chatState.users = usersRes.filter(function(u) {
    return u.username !== _chatState.currentUser;
  });
  
  // ═══ Load recent messages with each user ═══
  var messagesRes = await erpFetch('messages',
    'select=*&or=(sender.eq.' + encodeURIComponent(_chatState.currentUser) +
    ',recipient.eq.' + encodeURIComponent(_chatState.currentUser) + ')' +
    '&doc_no=is.null' +
    '&order=created_at.desc&limit=500');
  
  // Group by other user
  var convMap = {};
  (messagesRes || []).forEach(function(m) {
    var other = m.sender === _chatState.currentUser ? m.recipient : m.sender;
    if (!other) return;
    if (!convMap[other]) {
      convMap[other] = {
        other: other,
        lastMsg: m,
        unread: 0
      };
    }
    // Count unread
    if (m.recipient === _chatState.currentUser && !m.is_read) {
      convMap[other].unread++;
    }
  });
  
  // ═══ Render ═══
  var html = '';
  
  // Existing conversations
  var convsWithMsgs = Object.keys(convMap).map(function(k) { return convMap[k]; });
  
  // Sort: unread first, then most recent
  convsWithMsgs.sort(function(a, b) {
    if (a.unread > 0 && b.unread === 0) return -1;
    if (b.unread > 0 && a.unread === 0) return 1;
    return new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime();
  });
  
  // Find user info helper
  function findUser(username) {
    return _chatState.users.find(function(u) { return u.username === username; });
  }
  
  // Render existing conversations
  convsWithMsgs.forEach(function(c) {
    var user = findUser(c.other);
    var fullname = user ? (user.fullname || c.other) : c.other;
    var initials = getInitials(fullname);
    var timeStr = formatTimeAgo(c.lastMsg.created_at);
    var preview = c.lastMsg.body || '';
    var isMe = c.lastMsg.sender === _chatState.currentUser;
    var prefix = isMe ? 'You: ' : '';
    
    if (preview.length > 40) preview = preview.substring(0, 40) + '...';
    
    var roleBadge = '';
    if (user && user.roles) {
      var roles = Array.isArray(user.roles) ? user.roles : [];
      if (roles.indexOf('warehouse') !== -1 && roles.indexOf('production') !== -1) {
        roleBadge = '<span class="badge bg-info text-dark" style="font-size:0.6rem;">BOTH</span>';
      } else if (roles.indexOf('warehouse') !== -1) {
        roleBadge = '<span class="badge bg-success" style="font-size:0.6rem;">WH</span>';
      } else if (roles.indexOf('production') !== -1) {
        roleBadge = '<span class="badge bg-warning text-dark" style="font-size:0.6rem;">PR</span>';
      }
    }
    
    var active = (_chatState.openWith === c.other && _chatState.openType === 'user') ? ' active' : '';
    var safeOther = String(c.other).replace(/'/g, "\\'");
    
    html += '<div class="chat-conv-item' + active + '" data-username="' + erpEsc(c.other) + '" onclick="openUserConversation(\'' + safeOther + '\')">' +
      '<div class="d-flex align-items-start gap-2">' +
        '<div class="chat-conv-avatar">' + erpEsc(initials) + '</div>' +
        '<div class="chat-conv-content">' +
          '<div class="d-flex justify-content-between align-items-center gap-2">' +
            '<div class="chat-conv-name">' + erpEsc(fullname) + roleBadge + '</div>' +
            '<div class="chat-conv-time">' + erpEsc(timeStr) + '</div>' +
          '</div>' +
          '<div class="chat-conv-preview">' + erpEsc(prefix + preview) + '</div>' +
        '</div>' +
        (c.unread > 0 ? '<div class="chat-unread-badge">' + c.unread + '</div>' : '') +
      '</div>' +
    '</div>';
  });
  
  // Then users without messages
  var usersWithoutMsgs = _chatState.users.filter(function(u) {
    return !convMap[u.username];
  });
  
  if (usersWithoutMsgs.length > 0) {
    if (convsWithMsgs.length > 0) {
      html += '<div style="padding:12px 16px;font-size:0.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;background:#f8fafc;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">Start new chat</div>';
    }
    
    usersWithoutMsgs.forEach(function(u) {
      var fullname = u.fullname || u.username;
      var initials = getInitials(fullname);
      var safeUsername = String(u.username).replace(/'/g, "\\'");
      
      html += '<div class="chat-conv-item" data-username="' + erpEsc(u.username) + '" onclick="openUserConversation(\'' + safeUsername + '\')">' +
        '<div class="d-flex align-items-start gap-2">' +
          '<div class="chat-conv-avatar">' + erpEsc(initials) + '</div>' +
          '<div class="chat-conv-content">' +
            '<div class="chat-conv-name">' + erpEsc(fullname) + '</div>' +
            '<div class="chat-conv-preview text-muted fst-italic">Tap to start a chat</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
  }
  
  if (!html) {
    html = '<div class="chat-conv-loading text-muted small">No users to chat with</div>';
  }
  
  container.innerHTML = html;
}

async function loadDocumentThreads() {
  var container = document.getElementById('chatConversationList');
  
  // ═══ Load messages with doc_no not null ═══
  var messagesRes = await erpFetch('messages',
    'select=*&doc_no=not.is.null&order=created_at.desc&limit=500');
  
  // Group by doc_no
  var threadMap = {};
  (messagesRes || []).forEach(function(m) {
    var docNo = m.doc_no;
    if (!docNo) return;
    if (!threadMap[docNo]) {
      threadMap[docNo] = {
        docNo: docNo,
        docType: m.doc_type || '',
        lastMsg: m,
        unread: 0
      };
    }
    // Count unread (if not sender and not read)
    if (m.sender !== _chatState.currentUser && !m.is_read) {
      threadMap[docNo].unread++;
    }
  });
  
  var threads = Object.keys(threadMap).map(function(k) { return threadMap[k]; });
  
  threads.sort(function(a, b) {
    if (a.unread > 0 && b.unread === 0) return -1;
    if (b.unread > 0 && a.unread === 0) return 1;
    return new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime();
  });
  
  if (threads.length === 0) {
    container.innerHTML = '<div class="chat-conv-loading text-muted small">' +
      'No document discussions yet.<br><br>' +
      '<i class="bi bi-file-earmark-text" style="font-size:2rem;opacity:0.3;"></i><br>' +
      'Open a document and click "Discuss" to start one.' +
      '</div>';
    return;
  }
  
  var html = '';
  threads.forEach(function(t) {
    var docNo = t.docNo;
    var docType = t.docType;
    var timeStr = formatTimeAgo(t.lastMsg.created_at);
    var preview = t.lastMsg.body || '';
    var isMe = t.lastMsg.sender === _chatState.currentUser;
    var senderName = isMe ? 'You' : (t.lastMsg.sender_fullname || t.lastMsg.sender);
    var prefix = senderName + ': ';
    
    if (preview.length > 40) preview = preview.substring(0, 40) + '...';
    
    var typeBadge = '';
    if (docType === 'MRIF') typeBadge = '<span class="badge bg-warning text-dark" style="font-size:0.6rem;">MRIF</span>';
    else if (docType === 'MRR') typeBadge = '<span class="badge bg-success" style="font-size:0.6rem;">MRR</span>';
    else if (docType === 'MRS') typeBadge = '<span class="badge bg-danger" style="font-size:0.6rem;">MRS</span>';
    
    var active = (_chatState.openWith === docNo && _chatState.openType === 'doc') ? ' active' : '';
    var safeDoc = String(docNo).replace(/'/g, "\\'");
    var safeType = String(docType || '').replace(/'/g, "\\'");
    
    html += '<div class="chat-conv-item' + active + '" data-doc="' + erpEsc(docNo) + '" onclick="openDocConversation(\'' + safeDoc + '\', \'' + safeType + '\')">' +
      '<div class="d-flex align-items-start gap-2">' +
        '<div class="chat-conv-avatar" style="background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);">' +
          '<i class="bi bi-file-earmark-text"></i>' +
        '</div>' +
        '<div class="chat-conv-content">' +
          '<div class="d-flex justify-content-between align-items-center gap-2">' +
            '<div class="chat-conv-name" style="font-size:0.82rem;">' + erpEsc(docNo) + typeBadge + '</div>' +
            '<div class="chat-conv-time">' + erpEsc(timeStr) + '</div>' +
          '</div>' +
          '<div class="chat-conv-preview">' + erpEsc(prefix + preview) + '</div>' +
        '</div>' +
        (t.unread > 0 ? '<div class="chat-unread-badge">' + t.unread + '</div>' : '') +
      '</div>' +
    '</div>';
  });
  
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// OPEN CONVERSATIONS
// ═══════════════════════════════════════════════════════════
async function openUserConversation(otherUsername) {
  _chatState.openWith = otherUsername;
  _chatState.openType = 'user';
  _chatState.openDocType = null;
  _chatState.lastMsgTs = 0;
  
  // Mobile view
  if (_chatState.isMobile) {
    document.getElementById('chatWrapper').classList.add('mobile-chat-open');
  }
  
  // Highlight active
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-username') === otherUsername);
  });
  
  // Show panel
  document.getElementById('chatEmptyState').style.display = 'none';
  document.getElementById('chatPanel').style.display = 'flex';
  document.getElementById('chatDocBanner').style.display = 'none';
  
  // Find user info
  var user = _chatState.users.find(function(u) { return u.username === otherUsername; });
  var fullname = user ? (user.fullname || otherUsername) : otherUsername;
  var initials = getInitials(fullname);
  
  document.getElementById('chatWithName').textContent = fullname;
  document.getElementById('chatWithSub').textContent = '@' + otherUsername;
  document.getElementById('chatPanelAvatar').textContent = initials;
  
  // Load messages
  var messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = '<div class="text-center py-3"><div class="erp-spinner" style="width:24px;height:24px;border-width:2.5px;margin:0 auto;"></div></div>';
  
  // Mark as read
  markConversationRead(otherUsername);
  
  await loadMessages(otherUsername, 0, false);
  
  // Focus input
  setTimeout(function() {
    var input = document.getElementById('chatInput');
    if (input) input.focus();
  }, 200);
  
  // Start polling
  startPolling();
}

window.openUserConversation = openUserConversation;

async function openDocConversation(docNo, docType) {
  _chatState.openWith = docNo;
  _chatState.openType = 'doc';
  _chatState.openDocType = docType || '';
  _chatState.lastMsgTs = 0;
  
  if (_chatState.isMobile) {
    document.getElementById('chatWrapper').classList.add('mobile-chat-open');
  }
  
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-doc') === docNo);
  });
  
  document.getElementById('chatEmptyState').style.display = 'none';
  document.getElementById('chatPanel').style.display = 'flex';
  
  document.getElementById('chatWithName').textContent = docNo;
  document.getElementById('chatWithSub').textContent = 'Document discussion';
  document.getElementById('chatPanelAvatar').innerHTML = '<i class="bi bi-file-earmark-text"></i>';
  document.getElementById('chatPanelAvatar').style.background = 'linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%)';
  
  // Show doc banner
  var banner = document.getElementById('chatDocBanner');
  banner.style.display = 'block';
  banner.innerHTML = '<i class="bi bi-file-earmark-text me-1"></i>Discussion about <strong>' + erpEsc(docNo) + '</strong>' +
    (docType ? ' <span class="badge bg-secondary ms-1">' + erpEsc(docType) + '</span>' : '');
  
  var messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = '<div class="text-center py-3"><div class="erp-spinner" style="width:24px;height:24px;border-width:2.5px;margin:0 auto;"></div></div>';
  
  markDocThreadRead(docNo);
  
  await loadDocMessages(docNo, 0, false);
  
  setTimeout(function() {
    var input = document.getElementById('chatInput');
    if (input) input.focus();
  }, 200);
  
  startPolling();
}

window.openDocConversation = openDocConversation;

function closeConversation() {
  _chatState.openWith = null;
  _chatState.openType = null;
  
  if (_chatState.pollTimer) {
    clearInterval(_chatState.pollTimer);
    _chatState.pollTimer = null;
  }
  
  if (_chatState.isMobile) {
    document.getElementById('chatWrapper').classList.remove('mobile-chat-open');
  }
  
  document.getElementById('chatEmptyState').style.display = 'flex';
  document.getElementById('chatPanel').style.display = 'none';
  
  loadConversations();
}

window.closeConversation = closeConversation;

// ═══════════════════════════════════════════════════════════
// LOAD MESSAGES
// ═══════════════════════════════════════════════════════════
async function loadMessages(otherUser, sinceTs, append) {
  var container = document.getElementById('chatMessages');
  if (!container) return;
  
  if (!append) {
    // Will be replaced
  }
  
  try {
    var query = 'select=*' +
                '&or=(and(sender.eq.' + encodeURIComponent(_chatState.currentUser) +
                ',recipient.eq.' + encodeURIComponent(otherUser) + '),' +
                'and(sender.eq.' + encodeURIComponent(otherUser) +
                ',recipient.eq.' + encodeURIComponent(_chatState.currentUser) + '))' +
                '&doc_no=is.null' +
                '&order=created_at.asc' +
                (sinceTs > 0 ? '&created_at=gt.' + new Date(sinceTs).toISOString() : '') +
                '&limit=200';
    
    var rows = await erpFetch('messages', query);
    
    _renderMessages(container, rows || [], append);
  } catch(err) {
    console.error('[Chat] Load messages failed:', err);
    if (!append) {
      container.innerHTML = '<div class="text-danger text-center py-3 small">Failed to load messages</div>';
    }
  }
}

async function loadDocMessages(docNo, sinceTs, append) {
  var container = document.getElementById('chatMessages');
  if (!container) return;
  
  try {
    var query = 'select=*' +
                '&doc_no=eq.' + encodeURIComponent(docNo) +
                '&order=created_at.asc' +
                (sinceTs > 0 ? '&created_at=gt.' + new Date(sinceTs).toISOString() : '') +
                '&limit=200';
    
    var rows = await erpFetch('messages', query);
    
    _renderMessages(container, rows || [], append, true);
  } catch(err) {
    console.error('[Chat] Load doc messages failed:', err);
  }
}

function _renderMessages(container, msgs, append, isDocThread) {
  if (msgs.length === 0 && !append) {
    container.innerHTML = '<div class="text-center text-muted py-5 small">' +
      '<i class="bi bi-chat-dots" style="font-size:2.5rem;opacity:0.3;display:block;margin-bottom:12px;"></i>' +
      'No messages yet. Say hi 👋</div>';
    return;
  }
  
  if (msgs.length > 0) {
    _chatState.lastMsgTs = new Date(msgs[msgs.length - 1].created_at).getTime();
  }
  
  var html = '';
  var lastDateLabel = '';
  
  msgs.forEach(function(m) {
    var d = new Date(m.created_at);
    var dateLabel = formatDateLabel(d);
    
    if (dateLabel !== lastDateLabel) {
      html += '<div class="chat-date-sep">' + erpEsc(dateLabel) + '</div>';
      lastDateLabel = dateLabel;
    }
    
    var time = formatTime(d);
    var isMe = m.sender === _chatState.currentUser;
    var cls = isMe ? 'chat-bubble chat-bubble-me' : 'chat-bubble chat-bubble-them';
    
    var senderLine = '';
    if (!isMe && isDocThread) {
      var first = (m.sender_fullname || m.sender || '').split(' ')[0];
      senderLine = '<div class="chat-bubble-sender">' + erpEsc(first) + '</div>';
    }
    
    html += '<div class="' + cls + '">' + senderLine +
      '<div>' + erpEsc(m.body) + '</div>' +
      '<div class="chat-bubble-time">' + erpEsc(time) + '</div>' +
    '</div>';
  });
  
  if (append) {
    container.insertAdjacentHTML('beforeend', html);
  } else {
    container.innerHTML = html;
  }
  
  container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════════════════
async function sendMessage() {
  var input = document.getElementById('chatInput');
  if (!input || !_chatState.openWith) return;
  
  var body = input.value.trim();
  if (!body) return;
  
  // Clear input immediately
  input.value = '';
  input.style.height = 'auto';
  
  var payload = {
    sender: _chatState.currentUser,
    sender_fullname: _chatState.currentFullname,
    body: body
  };
  
  if (_chatState.openType === 'user') {
    payload.recipient = _chatState.openWith;
  } else if (_chatState.openType === 'doc') {
    payload.doc_no = _chatState.openWith;
    payload.doc_type = _chatState.openDocType || '';
  }
  
  // Optimistic UI — show temp bubble
  var container = document.getElementById('chatMessages');
  var tempId = 'temp_' + Date.now();
  container.insertAdjacentHTML('beforeend',
    '<div class="chat-bubble chat-bubble-me" id="' + tempId + '" style="opacity:0.6;">' +
      '<div>' + erpEsc(body) + '</div>' +
      '<div class="chat-bubble-time">Sending...</div>' +
    '</div>');
  container.scrollTop = container.scrollHeight;
  
  try {
    var res = await fetch(erpUrl('messages'), {
      method: 'POST',
      headers: erpHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('Send failed: ' + res.status + ' ' + errText);
    }
    
    // Remove temp bubble
    var temp = document.getElementById(tempId);
    if (temp) temp.remove();
    
    // Reload messages
    if (_chatState.openType === 'user') {
      await loadMessages(_chatState.openWith, 0, false);
    } else {
      await loadDocMessages(_chatState.openWith, 0, false);
    }
    
    // Refresh conversation list
    loadConversations();
    
  } catch(err) {
    console.error('[Chat] Send failed:', err);
    var temp2 = document.getElementById(tempId);
    if (temp2) {
      temp2.style.opacity = '1';
      temp2.style.background = '#dc2626';
    }
    erpShowToast('Failed to send: ' + err.message, 'danger');
  }
}

window.sendMessage = sendMessage;

// ═══════════════════════════════════════════════════════════
// MARK AS READ
// ═══════════════════════════════════════════════════════════
async function markConversationRead(otherUser) {
  try {
    await fetch(erpUrl('messages?recipient=eq.' + encodeURIComponent(_chatState.currentUser) +
                       '&sender=eq.' + encodeURIComponent(otherUser) +
                       '&doc_no=is.null&is_read=eq.false'), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        is_read: true,
        read_at: new Date().toISOString()
      })
    });
  } catch(e) {
    console.warn('[Chat] Mark read failed:', e);
  }
}

async function markDocThreadRead(docNo) {
  try {
    await fetch(erpUrl('messages?doc_no=eq.' + encodeURIComponent(docNo) +
                       '&is_read=eq.false&sender=not.eq.' + encodeURIComponent(_chatState.currentUser)), {
      method: 'PATCH',
      headers: erpHeaders(),
      body: JSON.stringify({
        is_read: true,
        read_at: new Date().toISOString()
      })
    });
  } catch(e) {
    console.warn('[Chat] Mark doc read failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════
// BADGE
// ═══════════════════════════════════════════════════════════
async function refreshChatBadge() {
  try {
    var rows = await erpFetch('messages',
      'select=id&recipient=eq.' + encodeURIComponent(_chatState.currentUser) +
      '&is_read=eq.false&limit=1000');
    
    var count = (rows || []).length;
    
    // Update sidebar badge (in nav)
    var badge = document.getElementById('chatBadgeSidebar');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('d-none', count === 0);
    }
    
    // Update tab title
    if (count > 0) {
      document.title = '(' + count + ') Messages — GEMCOR ERP';
    } else {
      document.title = 'Messages — GEMCOR ERP';
    }
    
    localStorage.setItem('ivm_chatUnread', String(count));
    
  } catch(err) {
    console.warn('[Chat] Badge failed:', err);
  }
}

window.refreshChatBadge = refreshChatBadge;

// ═══════════════════════════════════════════════════════════
// POLLING
// ═══════════════════════════════════════════════════════════
function startPolling() {
  if (_chatState.pollTimer) clearInterval(_chatState.pollTimer);
  
  _chatState.pollTimer = setInterval(function() {
    if (!_chatState.openWith) return;
    if (document.hidden) return;
    
    if (_chatState.openType === 'user') {
      loadMessages(_chatState.openWith, _chatState.lastMsgTs, true);
    } else if (_chatState.openType === 'doc') {
      loadDocMessages(_chatState.openWith, _chatState.lastMsgTs, true);
    }
  }, 8000);
}

// ═══════════════════════════════════════════════════════════
// FILTER
// ═══════════════════════════════════════════════════════════
function filterConversations() {
  var term = (document.getElementById('chatSearchInput').value || '').toLowerCase().trim();
  
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    var text = el.textContent.toLowerCase();
    el.style.display = (!term || text.indexOf(term) !== -1) ? '' : 'none';
  });
}

window.filterConversations = filterConversations;

// ═══════════════════════════════════════════════════════════
// INPUT HANDLERS
// ═══════════════════════════════════════════════════════════
function setupInputHandlers() {
  var input = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSendBtn');
  
  if (input) {
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function getInitials(name) {
  if (!name) return '?';
  var parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  var now = Date.now();
  var time = new Date(ts).getTime();
  var diff = now - time;
  
  var seconds = Math.floor(diff / 1000);
  var minutes = Math.floor(seconds / 60);
  var hours = Math.floor(minutes / 60);
  var days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'now';
  if (minutes < 60) return minutes + 'm';
  if (hours < 24) return hours + 'h';
  if (days < 7) return days + 'd';
  
  var d = new Date(ts);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

function formatTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function formatDateLabel(d) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  
  var diff = (today - msgDate) / (1000 * 60 * 60 * 24);
  
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function erpEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function erpShowToast(msg, type) {
  var toastEl = document.getElementById('erpToast');
  if (!toastEl) { console.log('[Toast]', type, msg); return; }
  document.getElementById('erpToastBody').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 }).show();
}

// ═══════════════════════════════════════════════════════════
// GLOBAL: Discuss document (called from other pages)
// ═══════════════════════════════════════════════════════════
window.discussDocument = function(docNo, docType) {
  if (!docNo) return;
  
  // Save intent
  localStorage.setItem('ivm_chat_open_doc', docNo);
  localStorage.setItem('ivm_chat_open_type', docType || '');
  
  // Navigate to chat page
  window.location.href = 'chat.html?doc=' + encodeURIComponent(docNo) + '&type=' + encodeURIComponent(docType || '');
};

// ═══════════════════════════════════════════════════════════
// URL PARAM HANDLER
// ═══════════════════════════════════════════════════════════
function checkUrlParams() {
  var params = new URLSearchParams(window.location.search);
  var docNo = params.get('doc');
  var docType = params.get('type');
  var user = params.get('user');
  
  if (docNo) {
    // Wait for DOM ready
    setTimeout(function() {
      switchChatTab('documents');
      setTimeout(function() {
        openDocConversation(docNo, docType || '');
      }, 500);
    }, 800);
  } else if (user) {
    setTimeout(function() {
      openUserConversation(user);
    }, 500);
  }
}

// Run URL param check after load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(checkUrlParams, 1000);
  });
} else {
  setTimeout(checkUrlParams, 1000);
}

console.log('✅ chat.js loaded');
