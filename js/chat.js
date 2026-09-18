// ============================================================
// CHAT — Document-attached + General DMs
// ============================================================

var _chatState = {
  currentUser: null,
  currentFullname: '',
  activeTab: 'chats',
  openWith: null,
  openType: null,
  openDocType: null,
  pollTimer: null,
  badgeTimer: null,
  lastMsgTs: 0
};

window.initChat = function() {
  _chatState.currentUser = localStorage.getItem('ivm_username') || '';
  _chatState.currentFullname = localStorage.getItem('ivm_userFullname') || _chatState.currentUser;
  if (!_chatState.currentUser) return;
  refreshChatBadge();
  if (_chatState.badgeTimer) clearInterval(_chatState.badgeTimer);
  _chatState.badgeTimer = setInterval(refreshChatBadge, 30000);
};

document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    if (_chatState.badgeTimer) { clearInterval(_chatState.badgeTimer); _chatState.badgeTimer = null; }
    if (_chatState.pollTimer) { clearInterval(_chatState.pollTimer); _chatState.pollTimer = null; }
  } else {
    if (_chatState.currentUser) initChat();
    if (_chatState.openWith && _chatState.openType) {
      if (_chatState.openType === 'user') openDmConversation(_chatState.openWith);
      else if (_chatState.openType === 'doc') openDocConversation(_chatState.openWith, _chatState.openDocType);
    }
  }
});

window.refreshChatBadge = async function() {
  if (!_chatState.currentUser) return;
  try {
    var url = API_URL + '?action=getUnreadMessageCount&username=' + encodeURIComponent(_chatState.currentUser) + '&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 12000, retries: 0 });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { return; }
    if (!data || !data.success) return;
    var badge = document.getElementById('chatBadgeSidebar');
    if (badge) {
      badge.textContent = data.unread;
      badge.classList.toggle('d-none', data.unread === 0);
    }
    var prev = parseInt(localStorage.getItem('ivm_chatUnread') || '0');
    if (data.unread > prev && typeof playSuccessBeep === 'function') playSuccessBeep();
    localStorage.setItem('ivm_chatUnread', String(data.unread));
  } catch(e) {}
};

window.openChatSection = function() {
  _chatState.currentUser = localStorage.getItem('ivm_username') || '';
  _chatState.currentFullname = localStorage.getItem('ivm_userFullname') || _chatState.currentUser;
  var emptyEl = document.getElementById('chatEmptyState');
  var panelEl = document.getElementById('chatPanel');
  if (emptyEl) emptyEl.style.display = _chatState.openWith ? 'none' : '';
  if (panelEl) panelEl.style.display = _chatState.openWith ? '' : 'none';
  loadChatList();
  refreshChatBadge();
};

window.switchChatTab = function(tab) {
  _chatState.activeTab = tab;
  document.querySelectorAll('.chat-tab-btn').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  loadChatList();
};

window.loadChatList = async function() {
  var container = document.getElementById('chatConversationList');
  if (!container) return;
  container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  var url, key;
  if (_chatState.activeTab === 'documents') {
    url = API_URL + '?action=getDocumentThreads&username=' + encodeURIComponent(_chatState.currentUser) + '&_t=' + Date.now();
    key = 'threads';
  } else {
    url = API_URL + '?action=getConversations&username=' + encodeURIComponent(_chatState.currentUser) + '&_t=' + Date.now();
    key = 'conversations';
  }
  try {
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 20000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (!data.success) { container.innerHTML = '<div class="text-muted text-center py-3">Failed to load</div>'; return; }
    var list = data[key] || [];
    if (list.length === 0) {
      container.innerHTML = '<div class="text-muted text-center py-4 small">' +
        (_chatState.activeTab === 'documents' ? 'No document discussions yet.<br>Open a document to start one.' : 'No users to chat with') + '</div>';
      return;
    }
    var html = '';
    if (_chatState.activeTab === 'documents') {
      list.forEach(function(t) {
        var timeStr = t.lastTs ? _chatFmtTime(new Date(t.lastTs)) : '';
        var preview = t.lastBody ? _chatEsc(t.lastBody.slice(0, 42)) : '';
        if (t.lastBody && t.lastBody.length > 42) preview += '...';
        var prefix = t.lastFromMe ? 'You: ' : (t.lastSenderFullname ? t.lastSenderFullname.split(' ')[0] + ': ' : '');
        var unreadBadge = t.unread > 0 ? '<span class="badge bg-danger rounded-pill ms-2">' + t.unread + '</span>' : '';
        var active = (_chatState.openType === 'doc' && _chatState.openWith === t.docNo) ? ' active' : '';
        html += '<div class="chat-conv-item' + active + '" data-doc="' + _chatEsc(t.docNo) + '" data-doctype="' + _chatEsc(t.docType) + '">' +
          '<div class="d-flex justify-content-between align-items-start">' +
            '<div class="flex-grow-1" style="min-width:0;">' +
              '<div class="d-flex justify-content-between align-items-center">' +
                '<span class="fw-bold text-truncate">' + _chatEsc(t.docNo) + '</span>' +
                '<small class="text-muted ms-2 flex-shrink-0">' + timeStr + '</small>' +
              '</div>' +
              '<div class="small text-muted text-truncate mt-1">' +
                (t.docType ? '<span class="badge bg-secondary me-1" style="font-size:0.6rem;">' + _chatEsc(t.docType) + '</span>' : '') +
                prefix + preview + unreadBadge +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
    } else {
      list.forEach(function(c) {
        var timeStr = c.lastTs ? _chatFmtTime(new Date(c.lastTs)) : '';
        var preview = c.lastBody ? _chatEsc(c.lastBody.slice(0, 42)) : '<span class="text-muted fst-italic">Tap to start a chat</span>';
        if (c.lastBody && c.lastBody.length > 42) preview += '...';
        var prefix = c.lastFromMe ? 'You: ' : '';
        var unreadBadge = c.unread > 0 ? '<span class="badge bg-danger rounded-pill ms-2">' + c.unread + '</span>' : '';
        var active = (_chatState.openType === 'user' && _chatState.openWith === c.otherUsername) ? ' active' : '';
        var roleTag = '';
        if (c.roles && c.roles.indexOf('warehouse') !== -1 && c.roles.indexOf('production') !== -1) roleTag = '<span class="badge bg-info text-dark ms-1" style="font-size:0.6rem;">BOTH</span>';
        else if (c.roles && c.roles.indexOf('warehouse') !== -1) roleTag = '<span class="badge bg-success ms-1" style="font-size:0.6rem;">WH</span>';
        else if (c.roles && c.roles.indexOf('production') !== -1) roleTag = '<span class="badge bg-warning text-dark ms-1" style="font-size:0.6rem;">PR</span>';
        html += '<div class="chat-conv-item' + active + '" data-username="' + _chatEsc(c.otherUsername) + '">' +
          '<div class="d-flex justify-content-between align-items-start">' +
            '<div class="flex-grow-1" style="min-width:0;">' +
              '<div class="d-flex justify-content-between align-items-center">' +
                '<span class="fw-bold text-truncate">' + _chatEsc(c.otherFullname) + roleTag + '</span>' +
                '<small class="text-muted ms-2 flex-shrink-0">' + timeStr + '</small>' +
              '</div>' +
              '<div class="small text-muted text-truncate mt-1">' + prefix + preview + unreadBadge + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
    }
    container.innerHTML = html;
    container.querySelectorAll('.chat-conv-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var u = this.getAttribute('data-username');
        var d = this.getAttribute('data-doc');
        var dt = this.getAttribute('data-doctype');
        if (u) openDmConversation(u);
        else if (d) openDocConversation(d, dt);
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="text-danger text-center py-3 small">Error: ' + _chatEsc(err.message) + '</div>';
  }
};

window.openDmConversation = async function(otherUsername) {
  _chatState.openWith = otherUsername;
  _chatState.openType = 'user';
  _chatState.openDocType = null;
  _chatState.lastMsgTs = 0;
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-username') === otherUsername);
  });
  var emptyEl = document.getElementById('chatEmptyState');
  var panelEl = document.getElementById('chatPanel');
  if (emptyEl) emptyEl.style.display = 'none';
  if (panelEl) panelEl.style.display = '';
  var fullname = otherUsername;
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    if (el.getAttribute('data-username') === otherUsername) {
      var nameEl = el.querySelector('.fw-bold');
      if (nameEl) fullname = nameEl.textContent.replace(/(BOTH|WH|PR)$/,'').trim();
    }
  });
  var headerEl = document.getElementById('chatWithName');
  if (headerEl) headerEl.textContent = fullname;
  var docBanner = document.getElementById('chatDocBanner');
  if (docBanner) docBanner.style.display = 'none';
  var messagesEl = document.getElementById('chatMessages');
  if (messagesEl) messagesEl.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  var readUrl = API_URL + '?action=markConversationRead&username=' + encodeURIComponent(_chatState.currentUser) + '&with=' + encodeURIComponent(otherUsername) + '&_t=' + Date.now();
  var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
  fetchFn(readUrl, { redirect: 'follow' }, { timeout: 15000, retries: 0 }).catch(function() {});
  await loadDmMessages(otherUsername, 0, false);
  setTimeout(function() {
    var input = document.getElementById('chatInput');
    if (input && window.innerWidth > 768) input.focus();
  }, 300);
  if (_chatState.pollTimer) clearInterval(_chatState.pollTimer);
  _chatState.pollTimer = setInterval(function() {
    if (_chatState.openWith && _chatState.openType === 'user') loadDmMessages(_chatState.openWith, _chatState.lastMsgTs, true);
  }, 8000);
  refreshChatBadge();
};

window.openDocConversation = async function(docNo, docType) {
  _chatState.openWith = docNo;
  _chatState.openType = 'doc';
  _chatState.openDocType = docType || '';
  _chatState.lastMsgTs = 0;
  document.querySelectorAll('.chat-conv-item').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-doc') === docNo);
  });
  var emptyEl = document.getElementById('chatEmptyState');
  var panelEl = document.getElementById('chatPanel');
  if (emptyEl) emptyEl.style.display = 'none';
  if (panelEl) panelEl.style.display = '';
  var headerEl = document.getElementById('chatWithName');
  if (headerEl) headerEl.textContent = docNo;
  var docBanner = document.getElementById('chatDocBanner');
  if (docBanner) {
    docBanner.style.display = '';
    docBanner.innerHTML = '<i class="bi bi-file-earmark-text me-1"></i>Discussion about <strong>' + _chatEsc(docNo) + '</strong>' + (docType ? ' <span class="badge bg-secondary ms-1">' + _chatEsc(docType) + '</span>' : '');
  }
  var messagesEl = document.getElementById('chatMessages');
  if (messagesEl) messagesEl.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  var readUrl = API_URL + '?action=markDocThreadRead&docNo=' + encodeURIComponent(docNo) + '&username=' + encodeURIComponent(_chatState.currentUser) + '&_t=' + Date.now();
  var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
  fetchFn(readUrl, { redirect: 'follow' }, { timeout: 15000, retries: 0 }).catch(function() {});
  await loadDocMessages(docNo, 0, false);
  setTimeout(function() {
    var input = document.getElementById('chatInput');
    if (input && window.innerWidth > 768) input.focus();
  }, 300);
  if (_chatState.pollTimer) clearInterval(_chatState.pollTimer);
  _chatState.pollTimer = setInterval(function() {
    if (_chatState.openWith && _chatState.openType === 'doc') loadDocMessages(_chatState.openWith, _chatState.lastMsgTs, true);
  }, 8000);
  refreshChatBadge();
};

window.closeChatConversation = function() {
  _chatState.openWith = null;
  _chatState.openType = null;
  if (_chatState.pollTimer) { clearInterval(_chatState.pollTimer); _chatState.pollTimer = null; }
  var emptyEl = document.getElementById('chatEmptyState');
  var panelEl = document.getElementById('chatPanel');
  if (emptyEl) emptyEl.style.display = '';
  if (panelEl) panelEl.style.display = 'none';
  loadChatList();
};

async function loadDmMessages(otherUser, sinceTs, append) {
  var container = document.getElementById('chatMessages');
  if (!container) return;
  if (!append) container.innerHTML = '';
  try {
    var url = API_URL + '?action=getMessagesWith&username=' + encodeURIComponent(_chatState.currentUser) + '&with=' + encodeURIComponent(otherUser) + '&since=' + (sinceTs || 0) + '&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 20000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (!data.success) return;
    _renderChatMessages(container, data.messages || [], append);
  } catch (err) {
    if (!append) container.innerHTML = '<div class="text-danger text-center py-3 small">' + _chatEsc(err.message) + '</div>';
  }
}

async function loadDocMessages(docNo, sinceTs, append) {
  var container = document.getElementById('chatMessages');
  if (!container) return;
  if (!append) container.innerHTML = '';
  try {
    var url = API_URL + '?action=getDocMessages&docNo=' + encodeURIComponent(docNo) + '&username=' + encodeURIComponent(_chatState.currentUser) + '&since=' + (sinceTs || 0) + '&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 20000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (!data.success) return;
    _renderChatMessages(container, data.messages || [], append);
  } catch (err) {
    if (!append) container.innerHTML = '<div class="text-danger text-center py-3 small">' + _chatEsc(err.message) + '</div>';
  }
}

function _renderChatMessages(container, msgs, append) {
  if (msgs.length === 0 && !append) {
    container.innerHTML = '<div class="text-center text-muted py-5 small">' +
      '<i class="bi bi-chat-dots fs-1 d-block mb-2 opacity-50"></i>No messages yet. Say hi 👋</div>';
    return;
  }
  if (msgs.length > 0) _chatState.lastMsgTs = msgs[msgs.length - 1].ts;
  var html = '';
  var lastDateLabel = '';
  msgs.forEach(function(m) {
    var d = new Date(m.ts);
    var dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (dateLabel !== lastDateLabel) {
      html += '<div class="chat-date-sep">' + dateLabel + '</div>';
      lastDateLabel = dateLabel;
    }
    var time = _chatFmtTime(d);
    var cls = m.fromMe ? 'chat-bubble chat-bubble-me' : 'chat-bubble chat-bubble-them';
    var senderLine = '';
    if (!m.fromMe && _chatState.openType === 'doc') {
      var first = (m.senderFullname || m.sender || '').split(' ')[0];
      senderLine = '<div class="chat-bubble-sender">' + _chatEsc(first) + '</div>';
    }
    html += '<div class="' + cls + '">' + senderLine +
      '<div class="chat-bubble-body">' + _chatEsc(m.body) + '</div>' +
      '<div class="chat-bubble-time">' + time + '</div>' +
    '</div>';
  });
  if (append) container.insertAdjacentHTML('beforeend', html);
  else container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

window.sendChatMessage = async function() {
  var input = document.getElementById('chatInput');
  if (!input || !_chatState.openWith) return;
  var body = input.value.trim();
  if (!body) return;
  input.value = '';
  input.style.height = 'auto';
  var recipient = '';
  var docNo = '';
  var docType = '';
  if (_chatState.openType === 'user') recipient = _chatState.openWith;
  else if (_chatState.openType === 'doc') { docNo = _chatState.openWith; docType = _chatState.openDocType || ''; }
  var container = document.getElementById('chatMessages');
  var tempId = 'temp_' + Date.now();
  if (container) {
    container.insertAdjacentHTML('beforeend',
      '<div class="chat-bubble chat-bubble-me" id="' + tempId + '" style="opacity:0.6;">' +
        '<div class="chat-bubble-body">' + _chatEsc(body) + '</div>' +
        '<div class="chat-bubble-time">Sending...</div>' +
      '</div>');
    container.scrollTop = container.scrollHeight;
  }
  try {
    var payload = {
      action: 'sendChatMessage',
      sender: _chatState.currentUser,
      senderFullname: _chatState.currentFullname,
      recipient: recipient,
      body: body,
      docNo: docNo,
      docType: docType
    };
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }, { timeout: 30000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (!data.success) throw new Error(data.error || 'Send failed');
    if (_chatState.openType === 'user') await loadDmMessages(_chatState.openWith, 0, false);
    else await loadDocMessages(_chatState.openWith, 0, false);
    loadChatList();
  } catch (err) {
    showToast('Failed to send: ' + err.message, 'danger');
    var temp = document.getElementById(tempId);
    if (temp) temp.remove();
  }
};

window.discussDocument = function(docNo, docType) {
  if (!docNo) return;
  _chatState.openType = 'doc';
  _chatState.openWith = docNo;
  _chatState.openDocType = docType || '';
  _chatState.activeTab = 'documents';
  if (typeof navigateTo === 'function') {
    navigateTo('messages');
    setTimeout(function() {
      switchChatTab('documents');
      openDocConversation(docNo, docType);
    }, 300);
  } else {
    openDocConversation(docNo, docType);
  }
};

function _chatEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _chatFmtTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('chatInput');
  if (input) {
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
  var sendBtn = document.getElementById('chatSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);
  var backBtn = document.getElementById('chatBackBtn');
  if (backBtn) backBtn.addEventListener('click', closeChatConversation);
});

console.log('✅ chat.js loaded');
