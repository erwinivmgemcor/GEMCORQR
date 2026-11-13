// ============================================================
// GEMCOR ERP — Notes & Reminders (user menu → Notes & Reminders)
// Notepad na naka-save sa Supabase (table: erp_notes) + mga gamit sa operations:
//   • Due date / reminder + badge sa user menu + paalala isang beses kada araw
//   • Priority (High), Pin, Snooze, Mark done
//   • Auto-link: MRIF / MRS / MRR / PRF / SOF / Item code sa note ay nagiging clickable
//   • Team tab: Shared notes / Shift handoff para sa buong team
//   • Copy summary (para i-paste sa chat / Viber)
// Kailangan: erp-notes.sql
// ============================================================
(function () {
  if (window.erpNotes) return;

  var ME = '', ME_NAME = '';
  try { ME = localStorage.getItem('ivm_username') || ''; ME_NAME = localStorage.getItem('ivm_userFullname') || ME; } catch (e) {}
  if (!ME) return;

  var CATS = {
    GENERAL:   { label: 'General',          icon: 'bi-sticky',              color: '#64748b' },
    FOLLOW_UP: { label: 'Follow-up',        icon: 'bi-arrow-repeat',        color: '#2563eb' },
    DELIVERY:  { label: 'Delivery / Supplier', icon: 'bi-truck',            color: '#d97706' },
    COUNT:     { label: 'Count / Audit',    icon: 'bi-clipboard-check',     color: '#059669' },
    ISSUE:     { label: 'Issue / Problem',  icon: 'bi-exclamation-triangle', color: '#dc2626' },
    HANDOFF:   { label: 'Shift handoff',    icon: 'bi-people',              color: '#7c3aed' }
  };
  var TEMPLATES = ['Follow up supplier: ', 'Check stock of ', 'Call requestor re: ', 'Recount: ', 'Handoff: '];

  var S = { notes: [], ok: true, loaded: false, tab: 'mine', filter: 'open', q: '', editId: null, cat: 'GENERAL', due: '', prio: 'NORMAL', shared: false };

  // ───────── helpers ─────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function addDays(base, n) { var d = base ? new Date(base + 'T00:00:00') : new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function daysFromToday(s) { return Math.round((new Date(s + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000); }
  function when(iso) { try { return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function toast(m, t) { if (typeof window.erpShowToast === 'function') window.erpShowToast(m, t || 'info'); }

  // ───────── data ─────────
  async function load() {
    try {
      var rows = await erpFetch('erp_notes', 'select=*&or=(owner.eq.' + encodeURIComponent(ME) + ',is_shared.eq.true)&order=id.desc&limit=500');
      S.notes = rows || []; S.ok = true;
    } catch (e) { S.ok = false; S.notes = S.notes || []; }
    S.loaded = true;
    renderBadge();
  }
  async function insert(row) {
    var res = await fetch(erpUrl('erp_notes'), { method: 'POST', headers: erpHeaders(), body: JSON.stringify([row]) });
    if (!res.ok) throw new Error(await res.text());
    var j = await res.json(); return j && j[0];
  }
  async function patch(id, fields) {
    var res = await fetch(erpUrl('erp_notes') + '?id=eq.' + id, { method: 'PATCH', headers: erpHeaders(), body: JSON.stringify(fields) });
    if (!res.ok) throw new Error(await res.text());
    var j = await res.json(); return j && j[0];
  }
  async function remove(id) {
    var res = await fetch(erpUrl('erp_notes') + '?id=eq.' + id, { method: 'DELETE', headers: erpHeaders() });
    if (!res.ok) throw new Error(await res.text());
  }
  function byId(id) { return S.notes.filter(function (n) { return n.id === id; })[0]; }
  function replaceLocal(n) { if (!n) return; var i = S.notes.findIndex(function (x) { return x.id === n.id; }); if (i >= 0) S.notes[i] = n; else S.notes.unshift(n); }

  // ───────── references inside text → links ─────────
  function refsOf(text) {
    var out = [], seen = {};
    function add(label, url, icon) { if (seen[label]) return; seen[label] = 1; out.push({ label: label, url: url, icon: icon }); }
    var m, re;
    re = /\b(MRIF|MRS)\d{5,}[A-Za-z0-9\-]*/gi;
    while ((m = re.exec(text))) add(m[0], 'all-requests.html?q=' + encodeURIComponent(m[0]), 'bi-file-earmark-text');
    re = /\bMRR\d{5,}[A-Za-z0-9\-]*/gi;
    while ((m = re.exec(text))) add(m[0], 'mrr-list.html?highlight=' + encodeURIComponent(m[0]), 'bi-box-arrow-in-down');
    re = /\bPRF\s?#?\s?\d[\d\-.]*/gi;
    while ((m = re.exec(text))) { var p = m[0].replace(/\s+/g, '').replace(/[.\-]+$/, ''); add(p, 'prf-monitor.html?q=' + encodeURIComponent(p), 'bi-cart'); }
    re = /\bSOF\s?#?\s?(\d{4,6})\b/gi;
    while ((m = re.exec(text))) add('SOF ' + m[1], 'sof-tracker.html?q=' + encodeURIComponent(m[1]), 'bi-diagram-3');
    re = /\b(GEM-[A-Z0-9]{4,}|SUPP\d{3,})\b/g;
    while ((m = re.exec(text))) add(m[0], 'item-in-out.html?code=' + encodeURIComponent(m[0]), 'bi-upc-scan');
    return out;
  }

  // ───────── ordering / counts ─────────
  function dueState(n) {
    if (n.is_done || !n.due_date) return null;
    var d = daysFromToday(n.due_date);
    return d < 0 ? { cls: 'over', text: 'Overdue ' + (-d) + 'd' } : d === 0 ? { cls: 'today', text: 'Due today' } : d === 1 ? { cls: 'soon', text: 'Tomorrow' } : { cls: 'later', text: new Date(n.due_date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) };
  }
  function rank(n) {
    if (n.is_done) return 9;
    var d = n.due_date ? daysFromToday(n.due_date) : 999;
    return d < 0 ? 1 : d === 0 ? 2 : d <= 3 ? 3 : 4;
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      if (!!b.is_pinned !== !!a.is_pinned && !a.is_done && !b.is_done) return b.is_pinned ? 1 : -1;
      var r = rank(a) - rank(b); if (r) return r;
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      if (a.priority !== b.priority) return a.priority === 'HIGH' ? -1 : 1;
      return b.id - a.id;
    });
  }
  function dueCount() {
    var t = today();
    return S.notes.filter(function (n) { return n.owner === ME && !n.is_done && n.due_date && n.due_date <= t; }).length;
  }
  function renderBadge() {
    var c = dueCount(), b = document.getElementById('erpNotesBadge');
    if (b) { b.textContent = c ? c : ''; b.style.display = c ? 'inline-block' : 'none'; }
    var m = document.getElementById('erpUserMenu');
    if (m) m.classList.toggle('erp-has-notes-due', c > 0);
  }

  // ───────── UI ─────────
  function injectCss() {
    if (document.getElementById('erpNotesCss')) return;
    var st = document.createElement('style'); st.id = 'erpNotesCss';
    st.textContent =
      '.erp-notes-badge{margin-left:auto;background:#dc2626;color:#fff;font-size:.66rem;font-weight:800;padding:1px 7px;border-radius:999px;display:none;}' +
      '#erpUserMenu.erp-has-notes-due .erp-user-avatar{box-shadow:0 0 0 2px #fff,0 0 0 4px #f59e0b;}' +
      '.en-back{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:10040;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s,visibility .2s;}' +
      '.en-back.show{opacity:1;visibility:visible;pointer-events:auto;}' +
      '.en-panel{position:fixed;top:0;right:0;height:100%;width:min(460px,100vw);background:#fff;z-index:10050;box-shadow:-8px 0 30px rgba(15,23,42,.18);display:flex;flex-direction:column;transform:translateX(100%);visibility:hidden;pointer-events:none;transition:transform .22s,visibility .22s;font-size:.86rem;color:#0f172a;}' +
      '.en-panel.show{transform:none;visibility:visible;pointer-events:auto;}' +
      '.en-head{padding:14px 16px;background:#1e3a5f;color:#fff;display:flex;align-items:center;gap:10px;}' +
      '.en-head h5{margin:0;font-size:1rem;font-weight:800;flex:1;}' +
      '.en-x{border:0;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer;}' +
      '.en-tabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid #e2e8f0;}' +
      '.en-tab{border:0;background:transparent;padding:8px 12px;font-weight:700;font-size:.82rem;color:#64748b;border-bottom:3px solid transparent;cursor:pointer;}' +
      '.en-tab.on{color:#1e3a5f;border-bottom-color:#1e3a5f;}' +
      '.en-tab b{background:#e2e8f0;border-radius:999px;padding:0 7px;font-size:.7rem;margin-left:4px;}' +
      '.en-comp{padding:12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;}' +
      '.en-comp textarea{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:.86rem;resize:vertical;min-height:62px;font-family:inherit;}' +
      '.en-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;}' +
      '.en-chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:3px 10px;font-size:.72rem;font-weight:600;cursor:pointer;color:#334155;}' +
      '.en-chip:hover{background:#e2e8f0;} .en-chip.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff;}' +
      '.en-chip.hi.on{background:#dc2626;border-color:#dc2626;}' +
      '.en-sel,.en-date{border:1px solid #cbd5e1;border-radius:8px;padding:3px 6px;font-size:.76rem;background:#fff;}' +
      '.en-btn{border:0;border-radius:8px;padding:6px 14px;font-weight:700;font-size:.8rem;cursor:pointer;background:#1e3a5f;color:#fff;}' +
      '.en-btn.ghost{background:#e2e8f0;color:#334155;}' +
      '.en-filter{display:flex;gap:6px;align-items:center;padding:8px 12px;}' +
      '.en-filter input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:5px 9px;font-size:.8rem;}' +
      '.en-list{flex:1;overflow:auto;padding:4px 12px 16px;}' +
      '.en-card{border:1px solid #e2e8f0;border-left:4px solid #94a3b8;border-radius:10px;padding:9px 11px;margin-top:8px;background:#fff;}' +
      '.en-card.high{border-left-color:#dc2626;} .en-card.done{opacity:.6;background:#f8fafc;}' +
      '.en-card.pin{box-shadow:0 0 0 1px #fde68a;background:#fffdf5;}' +
      '.en-body{white-space:pre-wrap;word-break:break-word;line-height:1.38;}' +
      '.en-done .en-body{text-decoration:line-through;}' +
      '.en-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font-size:.7rem;color:#64748b;}' +
      '.en-tag{font-weight:800;padding:1px 8px;border-radius:999px;background:#f1f5f9;}' +
      '.en-due{font-weight:800;padding:1px 8px;border-radius:999px;}' +
      '.en-due.over{background:#fee2e2;color:#b91c1c;} .en-due.today{background:#fef3c7;color:#b45309;} .en-due.soon{background:#dbeafe;color:#1d4ed8;} .en-due.later{background:#f1f5f9;color:#475569;}' +
      '.en-ref{display:inline-flex;gap:4px;align-items:center;font-size:.7rem;font-weight:700;background:#e0f2fe;color:#075985;border-radius:6px;padding:1px 7px;text-decoration:none;}' +
      '.en-ref:hover{background:#bae6fd;color:#075985;}' +
      '.en-acts{display:flex;gap:2px;margin-top:6px;}' +
      '.en-a{border:0;background:transparent;color:#64748b;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:.8rem;}' +
      '.en-a:hover{background:#f1f5f9;color:#0f172a;} .en-a.ok:hover{color:#16a34a;} .en-a.del:hover{color:#dc2626;}' +
      '.en-empty{text-align:center;color:#94a3b8;padding:30px 10px;}' +
      '.en-warn{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin:10px 12px 0;font-size:.78rem;}';
    document.head.appendChild(st);
  }

  function ensurePanel() {
    if (document.getElementById('enPanel')) return;
    injectCss();
    var back = document.createElement('div'); back.className = 'en-back'; back.id = 'enBack'; back.onclick = close;
    var p = document.createElement('div'); p.className = 'en-panel'; p.id = 'enPanel';
    p.innerHTML =
      '<div class="en-head"><i class="bi bi-journal-text"></i><h5>Notes &amp; Reminders</h5>' +
        '<button class="en-x" title="Copy summary" id="enCopy"><i class="bi bi-clipboard"></i></button>' +
        '<button class="en-x" title="Close" id="enClose"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="en-tabs" id="enTabs"></div>' +
      '<div id="enWarn"></div>' +
      '<div class="en-comp" id="enComp"></div>' +
      '<div class="en-filter" id="enFilter"></div>' +
      '<div class="en-list" id="enList"></div>';
    document.body.appendChild(back); document.body.appendChild(p);
    document.getElementById('enClose').onclick = close;
    document.getElementById('enCopy').onclick = copySummary;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.classList.contains('show')) close(); });
  }

  function open() {
    ensurePanel();
    document.querySelectorAll('.erp-user-menu.open').forEach(function (m) { m.classList.remove('open'); });
    document.getElementById('enBack').classList.add('show');
    document.getElementById('enPanel').classList.add('show');
    resetComposer(); render();
    load().then(render);
  }
  function close() {
    var b = document.getElementById('enBack'), p = document.getElementById('enPanel');
    if (b) b.classList.remove('show'); if (p) p.classList.remove('show');
  }

  function resetComposer() { S.editId = null; S.cat = S.tab === 'team' ? 'HANDOFF' : 'GENERAL'; S.due = ''; S.prio = 'NORMAL'; S.shared = S.tab === 'team'; }

  function visible() {
    var q = S.q.toLowerCase().trim();
    return sorted(S.notes.filter(function (n) {
      if (S.tab === 'mine' ? n.owner !== ME : !n.is_shared) return false;
      if (S.filter === 'open' && n.is_done) return false;
      if (S.filter === 'done' && !n.is_done) return false;
      if (S.filter === 'due' && (n.is_done || !n.due_date || n.due_date > today())) return false;
      if (q && (String(n.body).toLowerCase().indexOf(q) === -1 && String(n.owner_name || '').toLowerCase().indexOf(q) === -1 && String((CATS[n.category] || {}).label || '').toLowerCase().indexOf(q) === -1)) return false;
      return true;
    }));
  }

  function render() {
    if (!document.getElementById('enPanel')) return;
    var mineOpen = S.notes.filter(function (n) { return n.owner === ME && !n.is_done; }).length;
    var teamOpen = S.notes.filter(function (n) { return n.is_shared && !n.is_done; }).length;
    document.getElementById('enTabs').innerHTML =
      '<button class="en-tab ' + (S.tab === 'mine' ? 'on' : '') + '" data-t="mine"><i class="bi bi-person"></i> My Notes<b>' + mineOpen + '</b></button>' +
      '<button class="en-tab ' + (S.tab === 'team' ? 'on' : '') + '" data-t="team"><i class="bi bi-people"></i> Team / Handoff<b>' + teamOpen + '</b></button>';
    document.querySelectorAll('#enTabs .en-tab').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-t'); resetComposer(); render(); }; });

    document.getElementById('enWarn').innerHTML = S.ok ? '' :
      '<div class="en-warn"><b>Hindi ma-load ang notes.</b> I-run muna ang <code>erp-notes.sql</code> sa Supabase SQL Editor (isang beses lang), tapos mag-refresh.</div>';

    renderComposer(); renderFilter(); renderList();
  }

  function renderComposer() {
    var n = S.editId ? byId(S.editId) : null;
    var el = document.getElementById('enComp');
    var cur = el.querySelector('textarea') ? el.querySelector('textarea').value : (n ? n.body : '');
    el.innerHTML =
      '<textarea id="enText" maxlength="1000" placeholder="' + (S.tab === 'team' ? 'Shift handoff / paalala sa team… (e.g. Handoff: MRIF0022294 partial pa, hinihintay ang stock)' : 'Isulat ang note… (puwedeng isama ang MRIF0022294, PRF#11-13, SOF 11922, o GEM-HDM… para maging link)') + '">' + esc(cur) + '</textarea>' +
      '<div class="en-row">' + TEMPLATES.map(function (t, i) { return '<button class="en-chip" data-tpl="' + i + '">' + esc(t.replace(/[:]\s*$/, '').trim()) + '</button>'; }).join('') + '</div>' +
      '<div class="en-row">' +
        '<select class="en-sel" id="enCat">' + Object.keys(CATS).map(function (k) { return '<option value="' + k + '"' + (S.cat === k ? ' selected' : '') + '>' + CATS[k].label + '</option>'; }).join('') + '</select>' +
        '<input type="date" class="en-date" id="enDue" value="' + esc(S.due) + '" title="Remind me on">' +
        '<button class="en-chip" data-due="0">Today</button><button class="en-chip" data-due="1">Tomorrow</button><button class="en-chip" data-due="7">1 week</button>' +
        '<button class="en-chip hi ' + (S.prio === 'HIGH' ? 'on' : '') + '" id="enPrio"><i class="bi bi-flag-fill"></i> High</button>' +
        '<button class="en-chip ' + (S.shared ? 'on' : '') + '" id="enShare" title="Makikita ng buong team"><i class="bi bi-people"></i> Share with team</button>' +
      '</div>' +
      '<div class="en-row" style="justify-content:flex-end">' +
        (S.editId ? '<button class="en-btn ghost" id="enCancel">Cancel edit</button>' : '') +
        '<button class="en-btn" id="enSave"><i class="bi bi-check2-circle"></i> ' + (S.editId ? 'Update' : 'Add note') + '</button></div>';

    var ta = document.getElementById('enText');
    el.querySelectorAll('[data-tpl]').forEach(function (b) { b.onclick = function () { ta.value = TEMPLATES[Number(b.getAttribute('data-tpl'))] + ta.value; ta.focus(); }; });
    el.querySelectorAll('[data-due]').forEach(function (b) { b.onclick = function () { S.due = addDays(null, Number(b.getAttribute('data-due'))); document.getElementById('enDue').value = S.due; }; });
    document.getElementById('enDue').onchange = function () { S.due = this.value; };
    document.getElementById('enCat').onchange = function () { S.cat = this.value; if (S.cat === 'HANDOFF') { S.shared = true; document.getElementById('enShare').classList.add('on'); } };
    document.getElementById('enPrio').onclick = function () { S.prio = S.prio === 'HIGH' ? 'NORMAL' : 'HIGH'; this.classList.toggle('on', S.prio === 'HIGH'); };
    document.getElementById('enShare').onclick = function () { S.shared = !S.shared; this.classList.toggle('on', S.shared); };
    document.getElementById('enSave').onclick = save;
    var c = document.getElementById('enCancel'); if (c) c.onclick = function () { document.getElementById('enText').value = ''; resetComposer(); render(); };
  }

  function renderFilter() {
    var f = [['open', 'Open'], ['due', 'Due / Overdue'], ['done', 'Done'], ['all', 'All']];
    document.getElementById('enFilter').innerHTML =
      f.map(function (x) { return '<button class="en-chip ' + (S.filter === x[0] ? 'on' : '') + '" data-f="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '<input id="enSearch" placeholder="Search notes…" value="' + esc(S.q) + '">';
    document.querySelectorAll('#enFilter [data-f]').forEach(function (b) { b.onclick = function () { S.filter = b.getAttribute('data-f'); renderFilter(); renderList(); }; });
    var s = document.getElementById('enSearch'); s.oninput = function () { S.q = this.value; renderList(); };
  }

  function renderList() {
    var list = visible(), el = document.getElementById('enList');
    if (!S.loaded) { el.innerHTML = '<div class="en-empty">Loading…</div>'; return; }
    if (!list.length) { el.innerHTML = '<div class="en-empty"><i class="bi bi-journal-text" style="font-size:1.8rem"></i><div class="mt-2">' + (S.filter === 'open' ? 'Walang open na notes. Magdagdag sa taas.' : 'Walang notes dito.') + '</div></div>'; return; }
    el.innerHTML = list.map(function (n) {
      var cat = CATS[n.category] || CATS.GENERAL, ds = dueState(n), mine = n.owner === ME;
      var refs = refsOf(n.body || '').map(function (r) { return '<a class="en-ref" href="' + esc(r.url) + '"><i class="bi ' + r.icon + '"></i>' + esc(r.label) + '</a>'; }).join(' ');
      return '<div class="en-card ' + (n.priority === 'HIGH' ? 'high ' : '') + (n.is_done ? 'done en-done ' : '') + (n.is_pinned ? 'pin' : '') + '" data-id="' + n.id + '">' +
        '<div class="en-body">' + (n.is_pinned ? '<i class="bi bi-pin-angle-fill" style="color:#d97706"></i> ' : '') + esc(n.body) + '</div>' +
        (refs ? '<div class="en-meta">' + refs + '</div>' : '') +
        '<div class="en-meta">' +
          '<span class="en-tag" style="color:' + cat.color + '"><i class="bi ' + cat.icon + '"></i> ' + esc(cat.label) + '</span>' +
          (ds ? '<span class="en-due ' + ds.cls + '"><i class="bi bi-alarm"></i> ' + esc(ds.text) + '</span>' : '') +
          (n.priority === 'HIGH' ? '<span class="en-due over"><i class="bi bi-flag-fill"></i> High</span>' : '') +
          (n.is_shared ? '<span class="en-tag"><i class="bi bi-people"></i> ' + (mine ? 'Shared' : esc(n.owner_name || n.owner)) + '</span>' : '') +
          '<span>' + esc(when(n.is_done && n.done_at ? n.done_at : (n.created_at || ''))) + (n.is_done && n.done_by ? ' · done by ' + esc(n.done_by) : '') + '</span>' +
        '</div>' +
        '<div class="en-acts">' +
          ((mine || n.is_shared) ? '<button class="en-a ok" data-a="done" title="' + (n.is_done ? 'Reopen' : 'Mark done') + '"><i class="bi ' + (n.is_done ? 'bi-arrow-counterclockwise' : 'bi-check2-circle') + '"></i></button>' : '') +
          (mine && !n.is_done ? '<button class="en-a" data-a="pin" title="Pin"><i class="bi bi-pin-angle"></i></button>' : '') +
          (mine && !n.is_done ? '<button class="en-a" data-a="snooze" title="Snooze to tomorrow"><i class="bi bi-alarm"></i> +1d</button>' : '') +
          (mine ? '<button class="en-a" data-a="edit" title="Edit"><i class="bi bi-pencil-square"></i></button>' : '') +
          (mine ? '<button class="en-a del" data-a="del" title="Delete"><i class="bi bi-trash"></i></button>' : '') +
        '</div></div>';
    }).join('');
    el.querySelectorAll('.en-a').forEach(function (b) {
      b.onclick = function () { act(Number(b.closest('.en-card').getAttribute('data-id')), b.getAttribute('data-a')); };
    });
  }

  // ───────── actions ─────────
  async function save() {
    var body = document.getElementById('enText').value.trim();
    if (!body) { toast('Isulat muna ang note', 'warning'); return; }
    var btn = document.getElementById('enSave'); btn.disabled = true;
    try {
      var fields = { body: body, category: S.cat, priority: S.prio, due_date: S.due || null, is_shared: !!S.shared, updated_at: new Date().toISOString() };
      var row;
      if (S.editId) row = await patch(S.editId, fields);
      else row = await insert(Object.assign({ owner: ME, owner_name: ME_NAME }, fields));
      replaceLocal(row);
      var wasEdit = !!S.editId;
      document.getElementById('enText').value = '';
      resetComposer(); render(); renderBadge();
      toast(wasEdit ? 'Note updated' : '📝 Note saved', 'success');
    } catch (e) {
      S.ok = false; render();
      toast('Hindi na-save: ' + String(e.message || e).slice(0, 120), 'danger');
    } finally { var b = document.getElementById('enSave'); if (b) b.disabled = false; }
  }

  async function act(id, a) {
    var n = byId(id); if (!n) return;
    try {
      if (a === 'edit') { S.editId = id; S.cat = n.category || 'GENERAL'; S.due = n.due_date || ''; S.prio = n.priority || 'NORMAL'; S.shared = !!n.is_shared; document.getElementById('enComp').innerHTML = ''; render(); var t = document.getElementById('enText'); if (t) { t.value = n.body; t.focus(); } return; }
      if (a === 'del') { if (!confirm('Burahin ang note na ito?')) return; await remove(id); S.notes = S.notes.filter(function (x) { return x.id !== id; }); }
      if (a === 'done') replaceLocal(await patch(id, { is_done: !n.is_done, done_at: n.is_done ? null : new Date().toISOString(), done_by: n.is_done ? null : ME_NAME, updated_at: new Date().toISOString() }));
      if (a === 'pin') replaceLocal(await patch(id, { is_pinned: !n.is_pinned, updated_at: new Date().toISOString() }));
      if (a === 'snooze') replaceLocal(await patch(id, { due_date: addDays(null, 1), updated_at: new Date().toISOString() }));
      render(); renderBadge();
    } catch (e) { toast('Failed: ' + String(e.message || e).slice(0, 120), 'danger'); }
  }

  function copySummary() {
    var list = visible().filter(function (n) { return !n.is_done; });
    if (!list.length) { toast('Walang open na notes na ika-copy', 'warning'); return; }
    var lines = ['📝 ' + (S.tab === 'team' ? 'TEAM / HANDOFF' : 'MY NOTES') + ' — ' + new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + ' (' + ME_NAME + ')'];
    list.forEach(function (n) {
      var ds = dueState(n);
      lines.push('• ' + (n.priority === 'HIGH' ? '[HIGH] ' : '') + n.body.replace(/\s*\n\s*/g, ' ') + (ds ? ' (' + ds.text + ')' : '') + (S.tab === 'team' ? ' — ' + (n.owner_name || n.owner) : ''));
    });
    var txt = lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Summary copied', 'success'); }, function () {
      var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Summary copied', 'success'); } catch (e) {} ta.remove();
    });
  }

  // ───────── startup: badge + once-a-day reminder ─────────
  function boot() {
    injectCss();
    load().then(function () {
      var c = dueCount();
      try {
        if (c && localStorage.getItem('erp_notes_toast') !== today()) {
          localStorage.setItem('erp_notes_toast', today());
          toast('📝 ' + c + ' note' + (c > 1 ? 's' : '') + ' due / overdue — open Notes & Reminders from your profile menu', 'warning');
        }
      } catch (e) {}
    });
    setInterval(function () { if (!document.hidden) load(); }, 5 * 60 * 1000);
  }

  window.erpNotes = { open: open, close: close, reload: function () { return load().then(render); } };
  if (document.readyState === 'complete') setTimeout(boot, 800); else window.addEventListener('load', function () { setTimeout(boot, 800); });
})();
