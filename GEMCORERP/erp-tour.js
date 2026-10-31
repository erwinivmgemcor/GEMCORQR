// ============================================================
// GEMCOR ERP — First-time Guide (production users)
// Auto-starts once per user (localStorage). Replay: user menu → "Quick Guide".
// Buttons: Back / Next / Skip tour. Keys: → ← Esc.
// Self-contained: no libraries.
// ============================================================
(function () {
  'use strict';
  var VERSION = 'v1';                       // bump to show the guide again to everybody
  function user() { try { return localStorage.getItem('ivm_username') || 'anon'; } catch (e) { return 'anon'; } }
  function firstName() {
    try { var n = (localStorage.getItem('ivm_userFullname') || '').trim().split(/\s+/)[0] || ''; return n ? n.charAt(0) + n.slice(1).toLowerCase() : ''; } catch (e) { return ''; }
  }
  function key() { return 'erp_tour_' + VERSION + '_' + user(); }
  function isDone() { try { return localStorage.getItem(key()) === '1'; } catch (e) { return false; } }
  function markDone() { try { localStorage.setItem(key(), '1'); } catch (e) {} }

  function q(sel) { return document.querySelector(sel); }
  function sidebarLink(href) { return q('#erpSidebar a[href$="' + href + '"]'); }
  function submenuParent(text) {
    var list = document.querySelectorAll('#erpSidebar .erp-sidebar-submenu-parent');
    for (var i = 0; i < list.length; i++) if (list[i].textContent.indexOf(text) !== -1) return list[i];
    return null;
  }

  function steps() {
    var n = firstName();
    return [
      { title: 'Welcome' + (n ? ', ' + n : '') + '! 👋', body: 'Mabilis na tour lang ito (mga 1 minuto) para malaman mo kung saan gagawa ng request sa warehouse. Pwede mong i-<b>Skip</b> anumang oras, at mabubuksan ulit sa user menu → <b>Quick Guide</b>.' },
      { target: function () { return sidebarLink('my-requests.html'); }, title: 'My Requests', body: 'Home mo ito. Dito makikita lahat ng request mo at ang status: <b>Pending</b> (hinihintay pa ang warehouse), <b>Partial</b> (may naibigay na, may kulang pa) at <b>Completed</b>.' },
      { target: function () { return submenuParent('New MRIF'); }, title: 'New MRIF — humingi ng materyales', body: 'Dito ka gagawa ng request ng materyales sa warehouse. Piliin ang <b>With JO</b> kung may Job Order, o <b>Manual (No JO)</b> kung wala. Pagka-submit, may lalabas na <b>QR</b> — ipakita ito sa warehouse.' },
      { target: function () { return submenuParent('New MRS'); }, title: 'New MRS — magsauli ng sobra', body: 'Gamitin ito kapag may sobra o hindi nagamit na materyales na isasauli sa warehouse. Pareho ang daloy: With JO o Manual.' },
      { target: function () { return sidebarLink('project-costing.html'); }, title: 'Project Costing', body: 'Tingnan dito ang gastos ng materyales bawat project/JO.' },
      { target: function () { return sidebarLink('chat.html'); }, title: 'Messages', body: 'Mag-chat sa warehouse kung may tanong sa request mo, para hindi na kailangang pumunta o tumawag.' },
      { target: function () { return q('.erp-search-bar'); }, title: 'Search', body: 'Hanapin agad ang kahit anong Doc No. o item. Shortcut: <b>Ctrl + K</b> (⌘K sa Mac).' },
      { target: function () { return q('#erpBellContainer') || q('#erpNotifContainer'); }, title: 'Notifications', body: 'Dito lalabas kapag na-process o may update ang request mo. Tingnan ito kapag may pulang numero.' },
      { target: function () { return q('.erp-user-toggle'); }, title: 'Account menu', body: '<b>Refresh Data</b> kung hindi mo nakikita ang pinakabagong update, <b>Settings</b> para sa profile at larawan, at <b>Quick Guide</b> para ulitin ang tour na ito.' },
      { title: 'Handa ka na! ✅', body: 'Simulan sa <b>New MRIF</b> kapag may kailangan kang materyales. Kung may problema, i-message ang warehouse sa <b>Messages</b>.' }
    ];
  }

  var S = null;   // state

  function injectCss() {
    if (document.getElementById('erpTourCss')) return;
    var st = document.createElement('style');
    st.id = 'erpTourCss';
    st.textContent =
      '#erpTourShield{position:fixed;inset:0;z-index:100000;background:transparent;}' +
      '#erpTourSpot{position:fixed;z-index:100001;border-radius:10px;pointer-events:none;box-shadow:0 0 0 9999px rgba(15,23,42,.62),0 0 0 3px #38bdf8;transition:all .25s ease;}' +
      '#erpTourSpot.center{box-shadow:0 0 0 9999px rgba(15,23,42,.62);}' +
      '#erpTourCard{position:fixed;z-index:100002;width:min(360px,calc(100vw - 24px));background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.35);padding:16px 18px 14px;font-family:inherit;}' +
      '#erpTourCard h3{font-size:1.02rem;font-weight:800;margin:0 0 6px;color:#1e3a5f;}' +
      '#erpTourCard p{font-size:.88rem;line-height:1.5;margin:0 0 12px;color:#334155;}' +
      '#erpTourCard .tr-foot{display:flex;align-items:center;gap:8px;}' +
      '#erpTourCard .tr-dots{display:flex;gap:4px;flex:1;flex-wrap:wrap;}' +
      '#erpTourCard .tr-dots i{width:7px;height:7px;border-radius:50%;background:#cbd5e1;display:block;}' +
      '#erpTourCard .tr-dots i.on{background:#1e3a5f;}' +
      '#erpTourCard button{border:0;border-radius:8px;font-size:.83rem;font-weight:700;padding:7px 14px;cursor:pointer;}' +
      '#erpTourCard .tr-skip{background:transparent;color:#64748b;padding:7px 8px;}' +
      '#erpTourCard .tr-skip:hover{color:#0f172a;text-decoration:underline;}' +
      '#erpTourCard .tr-back{background:#e2e8f0;color:#0f172a;}' +
      '#erpTourCard .tr-next{background:#1e3a5f;color:#fff;}' +
      '#erpTourCard .tr-count{font-size:.7rem;font-weight:700;color:#94a3b8;letter-spacing:.04em;margin-bottom:4px;}' +
      '@media(max-width:600px){#erpTourCard{left:12px !important;right:12px;bottom:12px;top:auto !important;width:auto;}}';
    document.head.appendChild(st);
  }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  }

  function build() {
    var shield = document.createElement('div'); shield.id = 'erpTourShield';
    var spot = document.createElement('div'); spot.id = 'erpTourSpot';
    var card = document.createElement('div'); card.id = 'erpTourCard'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
    document.body.appendChild(shield); document.body.appendChild(spot); document.body.appendChild(card);
    S.shield = shield; S.spot = spot; S.card = card;
    card.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('tr-next')) next();
      else if (b.classList.contains('tr-back')) go(S.i - 1, -1);
      else if (b.classList.contains('tr-skip')) finish();
    });
  }

  function go(i, dir) {
    if (!S) return;
    dir = dir || 1;
    // skip steps whose target isn't on screen (e.g. hidden sidebar on phones → show as plain card)
    S.i = Math.max(0, Math.min(S.steps.length - 1, i));
    render();
  }
  function next() { if (S.i >= S.steps.length - 1) finish(); else go(S.i + 1, 1); }

  function render() {
    var st = S.steps[S.i], total = S.steps.length;
    var el = st.target ? st.target() : null;
    if (el) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    var has = el && visible(el);
    var dots = ''; for (var d = 0; d < total; d++) dots += '<i class="' + (d === S.i ? 'on' : '') + '"></i>';
    var last = S.i === total - 1;
    S.card.innerHTML =
      '<div class="tr-count">STEP ' + (S.i + 1) + ' OF ' + total + '</div>' +
      '<h3>' + st.title + '</h3><p>' + st.body + '</p>' +
      '<div class="tr-foot"><div class="tr-dots">' + dots + '</div>' +
        (last ? '' : '<button class="tr-skip" type="button">Skip tour</button>') +
        (S.i > 0 ? '<button class="tr-back" type="button">Back</button>' : '') +
        '<button class="tr-next" type="button">' + (last ? 'Finish' : (S.i === 0 ? 'Start' : 'Next')) + '</button></div>';
    position(has ? el : null);
    var nb = S.card.querySelector('.tr-next'); if (nb) nb.focus({ preventScroll: true });
  }

  function position(el) {
    var spot = S.spot, card = S.card, vw = window.innerWidth, vh = window.innerHeight, pad = 6;
    if (!el) {
      spot.className = 'center';
      spot.style.cssText = 'left:' + (vw / 2) + 'px;top:' + (vh / 2) + 'px;width:0;height:0;';
      card.style.left = Math.max(12, (vw - card.offsetWidth) / 2) + 'px';
      card.style.top = Math.max(12, (vh - card.offsetHeight) / 2) + 'px';
      return;
    }
    var r = el.getBoundingClientRect();
    spot.className = '';
    spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
    var cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, left, top;
    if (r.right + gap + cw < vw - 8) { left = r.right + gap; top = r.top + r.height / 2 - ch / 2; }       // right of target (sidebar items)
    else if (r.bottom + gap + ch < vh - 8) { top = r.bottom + gap; left = r.left + r.width / 2 - cw / 2; } // below (topbar items)
    else { top = r.top - gap - ch; left = r.left + r.width / 2 - cw / 2; }                                 // above
    left = Math.max(12, Math.min(left, vw - cw - 12));
    top = Math.max(12, Math.min(top, vh - ch - 12));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }

  function onKey(e) {
    if (!S) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(S.i - 1, -1); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(); }
  }
  function onResize() { if (S) render(); }

  function finish() {
    markDone();
    if (!S) return;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    [S.shield, S.spot, S.card].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    S = null;
  }

  function start(force) {
    if (S) return;
    if (!force && isDone()) return;
    injectCss();
    S = { i: 0, steps: steps() };
    build();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    render();
  }

  window.erpTour = { start: start, isDone: isDone, reset: function () { try { localStorage.removeItem(key()); } catch (e) {} } };
})();
