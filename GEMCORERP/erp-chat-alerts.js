// ============================================================
// GEMCOR ERP — Chat Alerts  v1.0
// Runs on EVERY page (loaded by erp-nav.js), so a new message pops up
// wherever the user is — with the sender's photo, a sound, and a quick-reply box.
//
//   DM            : any new unread message sent to me
//   Doc thread    : new messages in a document discussion I took part in
//   Session start : one popup for messages that arrived while I was away
//
// Also keeps the sidebar "Messages" badge and the tab title up to date.
// Events:  erp-chat-new (detail = [messages])  ·  erp-chat-read  ·  erp-chat-count
// ============================================================
(function () {
  'use strict';
  if (window.erpChatAlerts) return;

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ss(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  var ME = ls('ivm_username') || '';
  if (!ME || typeof window.erpUrl !== 'function') return;
  var MYNAME = ls('ivm_userFullname') || ME;
  var ROLE = ls('ivm_userRole') || '';
  var CHAT_PAGE = /chat\.html$/i.test(location.pathname);

  var CFG = { dmMs: 5000, hiddenMs: 20000, docEvery: 2, countEvery: 4, maxPopups: 3, popupMs: 15000, partMs: 180000 };
  var CUR_KEY = 'ivm_chatcur_' + ME;
  var EPOCH = '1970-01-01T00:00:00Z';

  var cur = { dm: '', doc: '' };
  try { var c0 = JSON.parse(ls(CUR_KEY) || '{}'); cur.dm = c0.dm || ''; cur.doc = c0.doc || ''; } catch (e) {}
  var seen = {}, participates = {}, partAt = 0, unread = 0, ticks = 0, busy = false, timer = null, started = false;

  // ── tiny helpers ───────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function q(v) { return encodeURIComponent(v); }
  async function get(path) {
    var r = await fetch(window.erpUrl(path), { headers: window.erpHeaders(), cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function saveCur() { lsSet(CUR_KEY, JSON.stringify(cur)); }
  function maxTs(a, b) { return (!a || (b && new Date(b) > new Date(a))) ? (b || a) : a; }
  function allowedDoc(t) { return !(String(t || '').toUpperCase() === 'MRR' && ROLE !== 'warehouse'); }
  function docTypes() { return ROLE === 'warehouse' ? 'MRIF,MRR,MRS' : 'MRIF,MRS'; }

  function loadScript(id, src, cb) {
    var ex = document.getElementById(id);
    if (ex) { if (cb) ex.addEventListener('load', cb); return; }
    var s = document.createElement('script'); s.id = id; s.src = src; if (cb) s.onload = cb;
    document.head.appendChild(s);
  }
  function avatarHtml(user, name) {
    if (window.erpAvatars) return window.erpAvatars.html(user, name);
    var p = String(name || user || '?').trim().split(/\s+/);
    return esc((p.length >= 2 ? p[0][0] + p[p.length - 1][0] : p[0].substring(0, 2)).toUpperCase());
  }

  // ── sound (reuses the engine in notif-alerts.js) ──────────
  function playSound() {
    if (window.erpAlerts && window.erpAlerts.play) { window.erpAlerts.play('message'); return; }
    loadScript('erpAlertsScript', 'notif-alerts.js', function () {
      if (window.erpAlerts) window.erpAlerts.play('message');
    });
  }

  // ── badge + title ─────────────────────────────────────────
  function paintBadge() {
    var b = document.getElementById('chatBadgeSidebar');
    if (b) { b.textContent = unread > 99 ? '99+' : unread; b.classList.toggle('d-none', unread <= 0); }
    lsSet('ivm_chatUnread', String(unread));
    window.dispatchEvent(new CustomEvent('erp-chat-count', { detail: unread }));
  }

  async function refreshCount() {
    try {
      var rows = await get('messages?select=id&recipient=eq.' + q(ME) + '&is_read=eq.false&limit=1000');
      unread = (rows || []).length; paintBadge();
    } catch (e) {}
  }

  var baseTitle = null, titleN = 0;
  function bumpTitle(n) {
    if (!document.hidden) return;
    if (titleN === 0) baseTitle = document.title.replace(/^\(\d+\)\s*(New messages? — )?/, '');
    titleN += n;
    document.title = '(' + titleN + ') New message' + (titleN > 1 ? 's' : '') + ' — ' + baseTitle;
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (titleN && baseTitle) document.title = baseTitle;
      titleN = 0; tick();
    }
  });

  function osNotify(g) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var n = new Notification(g.title, { body: g.text, tag: 'chat-' + g.key, icon: '../gemcor-logo.png' });
      n.onclick = function () { try { window.focus(); n.close(); } catch (e) {} openThread(g); };
    } catch (e) {}
  }

  // ── popup UI ──────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('erpMsgStyle')) return;
    var st = document.createElement('style'); st.id = 'erpMsgStyle';
    st.textContent =
      '#erpMsgHost{position:fixed;right:16px;bottom:18px;z-index:99999;display:flex;flex-direction:column;gap:10px;width:360px;max-width:calc(100vw - 24px);pointer-events:none}' +
      '.erp-msg{pointer-events:auto;position:relative;overflow:hidden;background:#fff;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.28),0 2px 8px rgba(15,23,42,.1);border:1px solid #e2e8f0;animation:erpMsgIn .32s cubic-bezier(.2,.9,.3,1.15);font-family:inherit}' +
      '.erp-msg.out{animation:erpMsgOut .22s ease forwards}' +
      '.erp-msg-top{display:flex;gap:12px;align-items:flex-start;padding:13px 36px 8px 13px;cursor:pointer}' +
      '.erp-msg-av{width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#1e3a5f,#2f5d96);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0;overflow:hidden;position:relative}' +
      '.erp-msg-av img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.erp-msg-av.doc{background:linear-gradient(135deg,#8b5cf6,#6d28d9);font-size:1.2rem}' +
      '.erp-msg-main{min-width:0;flex:1}' +
      '.erp-msg-name{font-weight:800;font-size:.92rem;color:#0f172a;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.erp-msg-tag{font-size:.62rem;font-weight:700;background:#ede9fe;color:#6d28d9;border-radius:6px;padding:1px 6px}' +
      '.erp-msg-now{margin-left:auto;font-size:.68rem;color:#2563eb;font-weight:700}' +
      '.erp-msg-text{font-size:.86rem;color:#334155;margin-top:2px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}' +
      '.erp-msg-more{font-size:.72rem;color:#2563eb;font-weight:700;margin-top:3px}' +
      '.erp-msg-x{position:absolute;top:6px;right:8px;border:0;background:none;color:#94a3b8;font-size:1.3rem;line-height:1;cursor:pointer;padding:2px 5px}.erp-msg-x:hover{color:#0f172a}' +
      '.erp-msg-reply{display:flex;gap:6px;padding:0 12px 12px 71px}' +
      '.erp-msg-reply input{flex:1;min-width:0;border:1.5px solid #e2e8f0;background:#f1f5f9;border-radius:999px;padding:7px 12px;font-size:.84rem;font-family:inherit;outline:none}' +
      '.erp-msg-reply input:focus{background:#fff;border-color:#1e3a5f}' +
      '.erp-msg-reply button{border:0;background:#1e3a5f;color:#fff;border-radius:999px;padding:0 14px;font-weight:700;font-size:.8rem;cursor:pointer}' +
      '.erp-msg-reply button:disabled{opacity:.5;cursor:default}' +
      '.erp-msg-sent{padding:0 14px 12px 71px;font-size:.8rem;color:#15803d;font-weight:600}' +
      '.erp-msg-bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:#2563eb;opacity:.55;transform-origin:left;animation:erpMsgBar linear forwards}' +
      '.erp-msg:hover .erp-msg-bar,.erp-msg:focus-within .erp-msg-bar{animation-play-state:paused}' +
      '@keyframes erpMsgIn{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:none}}' +
      '@keyframes erpMsgOut{to{opacity:0;transform:translateX(40px)}}' +
      '@keyframes erpMsgBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
      '@media (max-width:520px){#erpMsgHost{right:8px;left:8px;width:auto;bottom:10px}.erp-msg-reply{padding-left:13px}.erp-msg-sent{padding-left:13px}}' +
      '@media (prefers-reduced-motion:reduce){.erp-msg,.erp-msg-bar{animation:none !important}}';
    document.head.appendChild(st);
  }

  function host() {
    injectStyle();
    var h = document.getElementById('erpMsgHost');
    if (!h) {
      h = document.createElement('div'); h.id = 'erpMsgHost';
      h.setAttribute('role', 'status'); h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }

  var popups = {};   // key -> { g, el }

  function closePopup(key) {
    var p = popups[key]; if (!p) return;
    delete popups[key];
    p.el.classList.add('out');
    setTimeout(function () { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); }, 240);
  }

  function renderPopup(g) {
    var p = popups[g.key];
    var isNew = !p;
    var el = p ? p.el : document.createElement('div');
    if (isNew) { el.className = 'erp-msg'; popups[g.key] = p = { g: g, el: el }; }
    p.g = g;

    var avatar = g.type === 'doc'
      ? '<div class="erp-msg-av doc"><i class="bi bi-file-earmark-text"></i></div>'
      : '<div class="erp-msg-av" data-av="' + esc(g.user) + '" data-nm="' + esc(g.name) + '">' + avatarHtml(g.user, g.name) + '</div>';
    var tag = g.type === 'doc' ? '<span class="erp-msg-tag">' + esc(g.docType || 'DOC') + '</span>' : '';
    var who = g.type === 'doc' ? esc(g.title) : esc(g.name);
    var text = g.type === 'doc' ? esc(g.fromName + ': ' + g.text) : esc(g.text);
    var more = g.count > 1 ? '<div class="erp-msg-more">+' + (g.count - 1) + ' more new message' + (g.count > 2 ? 's' : '') + '</div>' : '';
    var replyable = g.type !== 'summary';

    el.innerHTML =
      '<div class="erp-msg-top" data-act="open">' + avatar +
        '<div class="erp-msg-main"><div class="erp-msg-name">' + who + tag + '<span class="erp-msg-now">now</span></div>' +
        '<div class="erp-msg-text">' + text + '</div>' + more + '</div></div>' +
      '<button class="erp-msg-x" type="button" data-act="close" aria-label="Dismiss">×</button>' +
      (replyable ? '<div class="erp-msg-reply"><input type="text" maxlength="500" placeholder="Reply…" aria-label="Reply"><button type="button" data-act="send">Send</button></div>' : '') +
      '<div class="erp-msg-bar" style="animation-duration:' + CFG.popupMs + 'ms"></div>';

    var bar = el.querySelector('.erp-msg-bar');
    bar.addEventListener('animationend', function () { closePopup(g.key); });

    if (isNew) {
      el.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]'); if (!a) return;
        var act = a.getAttribute('data-act'), cur2 = popups[g.key] && popups[g.key].g;
        if (act === 'close') { e.stopPropagation(); closePopup(g.key); }
        else if (act === 'open') { closePopup(g.key); openThread(cur2 || g); }
        else if (act === 'send') { sendReply(cur2 || g, el); }
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); sendReply((popups[g.key] && popups[g.key].g) || g, el); }
        if (e.key === 'Escape') closePopup(g.key);
      });
      host().appendChild(el);
      // keep at most N visible (oldest go first)
      var keys = Object.keys(popups);
      while (keys.length > CFG.maxPopups) { closePopup(keys.shift()); }
    }
  }

  function refreshPopupAvatars() {
    document.querySelectorAll('#erpMsgHost .erp-msg-av[data-av]').forEach(function (el) {
      el.innerHTML = avatarHtml(el.getAttribute('data-av'), el.getAttribute('data-nm'));
    });
  }
  window.addEventListener('erp-avatars-updated', refreshPopupAvatars);

  // ── actions ───────────────────────────────────────────────
  function openThread(g) {
    if (g.type === 'summary') { location.href = 'chat.html'; return; }
    var url = g.type === 'doc'
      ? 'chat.html?doc=' + q(g.docNo) + '&type=' + q(g.docType || '')
      : 'chat.html?user=' + q(g.user);
    if (CHAT_PAGE && typeof window.openUserConversation === 'function') {
      try { window.focus(); } catch (e) {}
      if (g.type === 'doc') {
        if (window.switchChatTab) window.switchChatTab('documents');
        setTimeout(function () { window.openDocConversation(g.docNo, g.docType || ''); }, 350);
      } else {
        if (window._chatState && window._chatState.activeTab !== 'chats' && window.switchChatTab) window.switchChatTab('chats');
        window.openUserConversation(g.user);
      }
    } else {
      location.href = url;
    }
  }

  async function sendReply(g, el) {
    var input = el.querySelector('input'), btn = el.querySelector('[data-act=send]');
    var body = input ? input.value.trim() : '';
    if (!body) { if (input) input.focus(); return; }
    btn.disabled = true; input.disabled = true;
    var payload = { sender: ME, sender_fullname: MYNAME, body: body, is_read: false, read_at: null,
                    doc_no: null, doc_type: null, recipient: null };
    if (g.type === 'doc') { payload.doc_no = g.docNo; payload.doc_type = g.docType || ''; participates[g.docNo] = 1; }
    else payload.recipient = g.user;
    try {
      var r = await fetch(window.erpUrl('messages'), { method: 'POST', headers: window.erpHeaders(), body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // replying means it was read
      var markUrl = g.type === 'doc'
        ? 'messages?doc_no=eq.' + q(g.docNo) + '&is_read=eq.false&sender=not.eq.' + q(ME)
        : 'messages?recipient=eq.' + q(ME) + '&sender=eq.' + q(g.user) + '&or=(doc_no.is.null,doc_no.eq.)&is_read=eq.false';
      fetch(window.erpUrl(markUrl), { method: 'PATCH', headers: window.erpHeaders(),
        body: JSON.stringify({ is_read: true, read_at: new Date().toISOString() }) })
        .then(function () { refreshCount(); window.dispatchEvent(new CustomEvent('erp-chat-read')); }, function () {});
      el.querySelector('.erp-msg-reply').outerHTML = '<div class="erp-msg-sent"><i class="bi bi-check2-all"></i> Sent</div>';
      el.querySelector('.erp-msg-bar').style.animationDuration = '1500ms';
      el.querySelector('.erp-msg-bar').style.animation = 'erpMsgBar 1500ms linear forwards';
      window.dispatchEvent(new CustomEvent('erp-chat-new', { detail: [] }));
    } catch (e) {
      input.disabled = false; btn.disabled = false; input.placeholder = 'Not sent — try again';
    }
  }

  // ── detection ─────────────────────────────────────────────
  function suppressed(m) {
    // already looking at that very conversation on the Messages page
    if (!CHAT_PAGE || document.hidden || !window._chatState) return false;
    var st = window._chatState;
    if (!st.openWith) return false;
    if (m.doc_no) return st.openType === 'doc' && st.openWith === m.doc_no;
    return st.openType === 'user' && st.openWith === m.sender;
  }

  function handle(rows) {
    var fresh = [];
    rows.forEach(function (m) {
      var k = m.id != null ? 'i' + m.id : m.created_at + m.sender;
      if (seen[k]) return; seen[k] = 1; fresh.push(m);
    });
    if (!fresh.length) return;

    window.dispatchEvent(new CustomEvent('erp-chat-new', { detail: fresh }));

    var dmCount = fresh.filter(function (m) { return !m.doc_no && m.recipient === ME; }).length;
    if (dmCount) { unread += dmCount; paintBadge(); }

    var groups = {}, order = [];
    fresh.forEach(function (m) {
      if (suppressed(m)) return;
      var isDoc = !!m.doc_no;
      var key = isDoc ? 'doc:' + m.doc_no : 'dm:' + m.sender;
      if (!groups[key]) {
        groups[key] = { key: key, type: isDoc ? 'doc' : 'dm', user: m.sender, name: m.sender_fullname || m.sender,
          docNo: m.doc_no, docType: m.doc_type, title: m.doc_no, fromName: String(m.sender_fullname || m.sender).split(' ')[0],
          text: '', count: 0 };
        order.push(key);
      }
      var g = groups[key]; g.count++; g.text = m.body || ''; g.fromName = String(m.sender_fullname || m.sender).split(' ')[0];
    });
    if (!order.length) return;

    // fold in what an open popup for the same thread already counted
    order.forEach(function (k) {
      var old = popups[k]; if (old) groups[k].count += old.g.count;
    });

    var list = order.map(function (k) { return groups[k]; });
    if (list.length > CFG.maxPopups) {
      var total = list.reduce(function (s, g) { return s + g.count; }, 0);
      Object.keys(popups).forEach(closePopup);
      list = [{ key: 'summary', type: 'summary', user: '', name: total + ' new messages',
        text: 'From ' + list.length + ' conversations — click to open', count: 1 }];
    }
    list.forEach(function (g) { renderPopup(g); osNotify({ key: g.key, title: g.type === 'doc' ? g.title : g.name, text: g.text, type: g.type, user: g.user, docNo: g.docNo, docType: g.docType }); });
    bumpTitle(fresh.length);
    playSound();
  }

  // ── polling ───────────────────────────────────────────────
  var SEL = 'select=id,sender,sender_fullname,recipient,body,doc_no,doc_type,created_at';

  async function loadParticipation() {
    if (Date.now() - partAt < CFG.partMs) return;
    partAt = Date.now();
    try {
      var rows = await get('messages?select=doc_no&sender=eq.' + q(ME) + '&doc_no=not.is.null&limit=1000');
      (rows || []).forEach(function (r) { if (r.doc_no) participates[r.doc_no] = 1; });
    } catch (e) {}
  }

  async function startOfSession() {
    // newest message timestamps become the baseline so nothing is announced twice
    var dmNewest = await get('messages?select=created_at&recipient=eq.' + q(ME) + '&order=created_at.desc&limit=1');
    var docNewest = await get('messages?select=created_at&doc_no=not.is.null&order=created_at.desc&limit=1');
    var unreadRows = await get('messages?' + SEL + '&recipient=eq.' + q(ME) + '&is_read=eq.false&or=(doc_no.is.null,doc_no.eq.)&order=created_at.desc&limit=200');
    cur.dm = maxTs(cur.dm, dmNewest && dmNewest[0] && dmNewest[0].created_at);
    cur.doc = maxTs(cur.doc, docNewest && docNewest[0] && docNewest[0].created_at);
    saveCur();
    unread = (unreadRows || []).length; paintBadge();

    if (unreadRows && unreadRows.length && !CHAT_PAGE) {
      var bySender = {}, n = 0;
      unreadRows.forEach(function (m) { bySender[m.sender] = bySender[m.sender] || []; bySender[m.sender].push(m); n++; });
      var senders = Object.keys(bySender);
      unreadRows.forEach(function (m) { seen[m.id != null ? 'i' + m.id : m.created_at + m.sender] = 1; });
      if (senders.length === 1) {
        var latest = bySender[senders[0]][0];
        renderPopup({ key: 'dm:' + senders[0], type: 'dm', user: senders[0], name: latest.sender_fullname || senders[0],
          text: latest.body || '', count: n });
      } else {
        renderPopup({ key: 'summary', type: 'summary', user: '', name: 'You have ' + n + ' unread messages',
          text: 'From ' + senders.length + ' people — click to open', count: 1 });
      }
      bumpTitle(n); playSound();
    } else if (unreadRows) {
      unreadRows.forEach(function (m) { seen[m.id != null ? 'i' + m.id : m.created_at + m.sender] = 1; });
    }
  }

  async function tick() {
    if (busy) return; busy = true;
    clearTimeout(timer);
    try {
      if (!started) {
        started = true;
        if (!ss('ivm_chat_sess')) { ssSet('ivm_chat_sess', '1'); await startOfSession(); }
        else if (!cur.dm && !cur.doc) { await startOfSession(); }
        else { await refreshCount(); }
        loadParticipation();
        if (window.erpAvatars) window.erpAvatars.refresh();
      } else {
        ticks++;
        var rows = await get('messages?' + SEL + '&recipient=eq.' + q(ME) + '&is_read=eq.false&or=(doc_no.is.null,doc_no.eq.)' +
          '&created_at=gt.' + q(cur.dm || EPOCH) + '&order=created_at.asc&limit=50');
        rows = rows || [];
        rows.forEach(function (m) { cur.dm = maxTs(cur.dm, m.created_at); });

        if (ticks % CFG.docEvery === 0) {
          await loadParticipation();
          var docs = await get('messages?' + SEL + '&doc_no=not.is.null&doc_no=neq.&sender=neq.' + q(ME) +
            '&doc_type=in.(' + docTypes() + ')&is_read=eq.false&created_at=gt.' + q(cur.doc || EPOCH) + '&order=created_at.asc&limit=50');
          (docs || []).forEach(function (m) {
            cur.doc = maxTs(cur.doc, m.created_at);
            if (participates[m.doc_no] && allowedDoc(m.doc_type)) rows.push(m);
          });
        }
        if (rows.length || ticks % CFG.countEvery === 0) saveCur();
        if (rows.length) handle(rows);
        if (ticks % CFG.countEvery === 0) refreshCount();
      }
    } catch (e) { /* offline or table unreachable: try again next round */ }
    busy = false;
    timer = setTimeout(tick, document.hidden ? CFG.hiddenMs : CFG.dmMs);
  }

  window.addEventListener('erp-chat-read', function () { refreshCount(); });

  window.erpChatAlerts = {
    refreshCount: refreshCount,
    unread: function () { return unread; },
    poll: tick,
    _test: function (m) { handle([m]); }
  };

  function boot() {
    if (!window.erpAvatars) loadScript('erpAvatarsScript', 'erp-avatars.js', function () { window.erpAvatars.refresh(); });
    setTimeout(tick, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  console.log('✅ erp-chat-alerts.js v1.0 loaded');
})();
