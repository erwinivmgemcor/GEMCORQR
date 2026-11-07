// ============================================================
// GEMCOR ERP — About page (about.js)
// - Team photos: drop files in GEMCORERP/team/ (see team/README.txt)
// - Process flows, FAQs and the feature list are plain data below —
//   edit the arrays to change the content.
// - Links inside the flows only appear for pages the current role
//   can actually open (uses the same rules as the sidebar).
// ============================================================
(function () {
  'use strict';

  var root = document.querySelector('.ab');
  if (!root) return;
  root.classList.add('ab-js');

  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var HAS_IO = 'IntersectionObserver' in window;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function userRole() { try { return localStorage.getItem('ivm_userRole') || ''; } catch (e) { return ''; } }
  function isAdmin() { try { return localStorage.getItem('ivm_isAdmin') === 'true'; } catch (e) { return false; } }

  // run fn once when el scrolls into view (or right away without IntersectionObserver)
  function onceVisible(el, fn, threshold) {
    if (!el) return;
    if (!HAS_IO) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { io.disconnect(); fn(); }
      });
    }, { threshold: threshold || 0.15 });
    io.observe(el);
  }

  // ── Version pill ────────────────────────────────────────────
  (function () {
    var el = $('#abVersion');
    var v = (typeof ERP_APP_VERSION !== 'undefined') ? ERP_APP_VERSION : (window.ERP_APP_VERSION || '');
    if (el && v) el.innerHTML = '<i class="bi bi-tag"></i>GEMCOR ERP v' + esc(v);
  })();

  // ═══════════════════════════════════════════════════════════
  // TEAM PHOTOS — tries team/<name>.jpg, .jpeg, .png, .webp
  // ═══════════════════════════════════════════════════════════
  var PHOTO_EXT = ['jpg', 'jpeg', 'png', 'webp'];
  $$('.ab-photo[data-photo]').forEach(function (box) {
    var slug = box.getAttribute('data-photo');
    var holder = $('.ab-photo-in', box);
    var n = 0;
    (function tryNext() {
      if (n >= PHOTO_EXT.length) return;            // no photo yet → initials stay
      var img = new Image();
      img.alt = box.parentNode.querySelector('h3') ? box.parentNode.querySelector('h3').textContent : '';
      img.onload = function () { holder.insertBefore(img, holder.firstChild); box.classList.add('has-photo'); };
      img.onerror = function () { n++; tryNext(); };
      img.src = 'team/' + slug + '.' + PHOTO_EXT[n];
    })();
  });

  // org chart: connectors draw, then the cards pop in
  var org = $('#abOrg');
  if (org) onceVisible(org, function () { org.classList.add('is-in'); }, 0.25);

  // ═══════════════════════════════════════════════════════════
  // PAGE LINKS (only for pages the current role can open)
  // ═══════════════════════════════════════════════════════════
  function navRegistry() {
    var reg = {};
    function add(it) { if (it && it.id && it.href) { (reg[it.id] = reg[it.id] || []).push(it); } }
    try {
      window.erpNavState.getNavGroups().forEach(function (g) {
        g.items.forEach(function (it) { add(it); (it.items || []).forEach(add); });
      });
    } catch (e) { /* nav not ready — chips fall back to plain text */ }
    return reg;
  }
  function allowed(it) {
    if (it.adminOnly && !isAdmin()) return false;
    return !it.roles || it.roles.indexOf(userRole()) !== -1;
  }
  var CHIP_LABEL = {
    'new-mrif': 'New MRIF (With JO)', 'new-mrif-manual': 'New MRIF (Manual)',
    'new-mrs': 'New MRS (With JO)', 'new-mrs-manual': 'New MRS (Manual)'
  };
  function pageChip(ref, reg) {
    var list = reg[ref];
    if (!list) return '<span class="ab-page"><i class="bi bi-window"></i>' + esc(ref) + '</span>';
    var ok = null;
    for (var i = 0; i < list.length; i++) { if (allowed(list[i])) { ok = list[i]; break; } }
    if (ok) return '<a class="ab-page" href="' + esc(ok.href) + '"><i class="bi bi-box-arrow-up-right"></i>' + esc(CHIP_LABEL[ref] || ok.label) + '</a>';
    return '<span class="ab-page is-off" title="Hindi kasama sa access ng role mo"><i class="bi bi-lock"></i>' + esc(CHIP_LABEL[ref] || list[0].label) + '</span>';
  }

  // ═══════════════════════════════════════════════════════════
  // PROCESS FLOWS
  // ═══════════════════════════════════════════════════════════
  var ACTORS = {
    prod: { l: 'Production',  c: '#2563eb', i: 'bi-tools' },
    wh:   { l: 'Warehouse',   c: '#1e3a5f', i: 'bi-box-seam' },
    proc: { l: 'Procurement', c: '#c26a05', i: 'bi-cart-check' },
    fin:  { l: 'Finance',     c: '#059669', i: 'bi-cash-coin' },
    sys:  { l: 'System',      c: '#7c3aed', i: 'bi-cpu' }
  };

  var FLOWS = [
    {
      id: 'p2w', icon: 'bi-box-arrow-in-right', label: 'Production → Warehouse', sub: 'Humihingi at nagbabalik',
      intro: 'Ang production ang nagsisimula: humihingi ng materyales gamit ang MRIF, at nagbabalik ng sobra gamit ang MRS.',
      lanes: [
        { title: 'Humihingi ng materyales (MRIF)', steps: [
          { a: 'prod', t: 'Gumawa ng MRIF', d: 'Ilagay ang JO number at kusang lalabas ang client at project. Kung walang JO, gamitin ang Manual (No JO). Piliin ang items gamit ang auto-suggest at ilagay ang qty.', pg: ['new-mrif', 'new-mrif-manual'] },
          { a: 'prod', t: 'I-submit', d: 'Pwedeng lagyan ng SOF number kung ang stock ay naka-reserve para sa isang sales order. Hindi madodoble ang request kahit ma-double click.' },
          { a: 'sys',  t: 'Pumasok sa warehouse queue', d: 'PENDING ang status. Lalabas ito sa All Requests ng warehouse at madadagdagan ang badge sa sidebar.', pg: ['all-requests'] },
          { a: 'prod', t: 'Subaybayan ang status', d: 'Makikita ang Pending, Partial o Completed sa My Requests. Pwedeng mag-message sa warehouse tungkol sa request.', pg: ['my-requests', 'chat'] }
        ] },
        { title: 'Nagbabalik ng sobra (MRS)', steps: [
          { a: 'prod', t: 'Gumawa ng MRS', d: 'Piliin ang With JO o Manual. Ang Qty Returned lang ang kailangang ilagay.', pg: ['new-mrs', 'new-mrs-manual'] },
          { a: 'sys',  t: 'PENDING sa warehouse', d: 'Hihintayin ang pag-verify ng warehouse sa aktwal na bumalik na items.' },
          { a: 'prod', t: 'Tingnan ang resulta', d: 'Kapag na-verify na, makikita ang bagong status sa My Requests.', pg: ['my-requests'] }
        ] }
      ]
    },
    {
      id: 'w2p', icon: 'bi-box-arrow-up-right', label: 'Warehouse → Production', sub: 'Pag-process at paglabas',
      intro: 'Ito ang ginagawa ng warehouse sa bawat request: bantayan ang stock, ilabas ang materyales, at itala ang bawat galaw.',
      status: true,
      lanes: [
        { title: 'Paglabas ng materyales (MRIF)', steps: [
          { a: 'wh',  t: 'Buksan ang request', d: 'Nasa All Requests ang lahat ng bukas na MRIF at MRS. Makikita rin kung aling kategorya (Components, Consumables, Fabmat) ang hawak ng bawat staff.', pg: ['all-requests'] },
          { a: 'sys', t: 'I-lock ang request', d: 'Lalabas ang “in process by…” para hindi sabay na maproseso ng dalawang staff. Kusang nawawala ang lock kapag natapos, umalis, o nawalan ng koneksyon.' },
          { a: 'wh',  t: 'I-verify ang items', d: 'I-scan ang barcode o i-tick ang item, at ilagay ang qty na ilalabas. Kung mali ang unit na inilagay ng production, pwede itong ayusin dito.', pg: ['Process MRIF'] },
          { a: 'sys', t: 'Stock check', d: 'Hindi pwedeng lumampas sa available. Ang stock na naka-reserve sa SOF ay hindi magagamit ng MRIF na walang SOF.' },
          { a: 'sys', t: 'Itala sa ledger', d: 'Isang buong transaksyon: bawas sa stock, tala sa stock ledger at update sa nagamit na SOF. Kapag pumalya, walang nasave na kalahati.' },
          { a: 'wh',  t: 'Status at print', d: 'Pending → Partial → Completed. Pwedeng i-print ang MRIF, at nakatala kung sino ang nag-print.', pg: ['mrif-list'] }
        ] },
        { title: 'Pagtanggap ng ibinalik (MRS)', steps: [
          { a: 'wh',  t: 'Buksan ang MRS', d: 'Lalabas ito sa All Requests kasama ng mga MRIF.', pg: ['all-requests', 'mrs-list'] },
          { a: 'wh',  t: 'I-verify ang aktwal na bumalik', d: 'Tingnan ang pisikal na items at ilagay ang actual returned qty. Hindi ito pwedeng lumampas sa hiniling na ibalik.', pg: ['Process MRS'] },
          { a: 'sys', t: 'Kusang status', d: 'Kinukuwenta ang status ayon sa na-verify na qty, at makikita agad ito ng production.' }
        ] }
      ]
    },
    {
      id: 'proc', icon: 'bi-cart-check', label: 'Procurement', sub: 'Mula reorder hanggang pagtanggap',
      intro: 'Mula sa items na paubos na, hanggang sa pagdating ng delivery at pagpasok nito sa stock.',
      lanes: [
        { title: 'Reorder → PRF → MRR', steps: [
          { a: 'sys',  t: 'Lalabas sa Needs', d: 'Items na bumaba sa buffer, bawas na ang nasa order. Ang net needed lang ang ipapa-PRF.', pg: ['replenishment'] },
          { a: 'wh',   t: 'Gumawa ng PRF', d: 'Pumili ng items. Hanggang 30 items bawat PRF, at kusang hinahati ayon sa category. Kusa ring may PRF number.', pg: ['replenishment'] },
          { a: 'wh',   t: 'Noted by at Approved by', d: 'May default na pangalan na nakalagay; pwedeng palitan bago i-print.' },
          { a: 'proc', t: 'Subaybayan sa PRF Monitor', d: 'Read-only para sa procurement: status ng PRF, PO data, at kung aling items ang bukas pa.', pg: ['prf-monitor', 'replenishment'] },
          { a: 'wh',   t: 'Tanggapin sa MRR', d: 'Ilagay ang PO, SOF, PRF, vendor, DR number at petsa ng pagtanggap.', pg: ['New MRR', 'mrr-list'] },
          { a: 'proc', t: 'Makita ang resulta', d: 'Tumataas ang on-hand sa ledger, at kita agad ng procurement ang tinanggap sa MRR Monitoring.', pg: ['mrr-monitoring', 'sof-tracker'] }
        ] }
      ]
    },
    {
      id: 'fin', icon: 'bi-cash-coin', label: 'Finance', sub: 'Gastos at presyo',
      intro: 'Bawat galaw ng stock ay may halaga, kaya malinaw ang gastos ng bawat project.',
      lanes: [
        { title: 'Gastos ng project at pagbabago ng presyo', steps: [
          { a: 'sys', t: 'Bawat galaw, may halaga', d: 'Ang labas at pasok ng stock ay naka-tala sa ledger kasama ang unit cost.' },
          { a: 'fin', t: 'Project Costing', d: 'Makikita ang gastos ng bawat project, ang items na bumuo nito, at ang mga galaw. View-only ito.', pg: ['project-costing'] },
          { a: 'fin', t: 'MRIF Monitoring', d: 'Bantayan ang mga issuance ng materyales ayon sa petsa, project at department.', pg: ['mrif-monitoring'] },
          { a: 'wh',  t: 'Bulk Price Update', d: 'Mag-upload ng bagong presyo sa Stock Monitor. May preview, dahilan, at Undo pagkatapos.', pg: ['stock-monitor'] },
          { a: 'sys', t: 'Ledger Cost Freeze', d: 'Kapag nagbago ang presyo, mananatili sa lumang presyo ang mga lumang transaksyon at project. Ang bagong presyo ay para sa susunod na galaw.' }
        ] }
      ]
    }
  ];

  var STATUS_NOTE = 'Mga status ng MRIF:';
  var flowTabs = $('#abFlowTabs');
  var flowPanel = $('#abFlowPanel');
  var flowIdx = 0;
  var flowStarted = false;

  function renderTabs() {
    if (!flowTabs) return;
    flowTabs.innerHTML = FLOWS.map(function (f, i) {
      return '<button type="button" class="ab-tab" role="tab" id="abTab' + i + '" data-i="' + i + '" aria-selected="' + (i === flowIdx) + '" aria-controls="abFlowPanel">' +
        '<i class="bi ' + f.icon + '"></i><span>' + esc(f.label) + '<small>' + esc(f.sub) + '</small></span></button>';
    }).join('');
    $$('.ab-tab', flowTabs).forEach(function (b) {
      b.addEventListener('click', function () { flowIdx = +b.getAttribute('data-i'); renderTabs(); renderFlow(); });
    });
  }

  function renderFlow() {
    if (!flowPanel) return;
    var f = FLOWS[flowIdx];
    var reg = navRegistry();
    var html = '<p class="ab-flow-intro">' + esc(f.intro) + '</p>';
    html += '<div class="ab-lanes' + (f.lanes.length === 1 ? ' one' : '') + '">';
    f.lanes.forEach(function (lane) {
      var n = lane.steps.length;
      html += '<div class="ab-lane"><h3>' + esc(lane.title) + '</h3>';
      html += '<div class="ab-track"><ol class="ab-steps">';
      lane.steps.forEach(function (s, i) {
        var ac = ACTORS[s.a];
        html += '<li class="ab-step" style="--i:' + i + ';--c:' + ac.c + '">' +
          '<span class="ab-step-n">' + (i + 1) + '</span>' +
          '<div class="ab-step-card"><span class="ab-actor"><i class="bi ' + ac.i + '"></i>' + esc(ac.l) + '</span>' +
          '<h4>' + esc(s.t) + '</h4><p>' + esc(s.d) + '</p>' +
          (s.pg ? '<div class="ab-pages">' + s.pg.map(function (p) { return pageChip(p, reg); }).join('') + '</div>' : '') +
          '</div></li>';
      });
      html += '</ol></div></div>';
    });
    html += '</div>';
    if (f.status) {
      html += '<div class="ab-status"><span>' + esc(STATUS_NOTE) + '</span>' +
        '<span class="ab-status-pill" style="--k:0">PENDING</span><i class="bi bi-arrow-right"></i>' +
        '<span class="ab-status-pill" style="--k:1">PARTIAL</span><i class="bi bi-arrow-right"></i>' +
        '<span class="ab-status-pill" style="--k:2">COMPLETED</span>' +
        '<span style="margin-left:6px">o</span><span class="ab-status-pill cx">CANCELLED</span></div>';
    }
    flowPanel.setAttribute('aria-labelledby', 'abTab' + flowIdx);
    flowPanel.innerHTML = html;
  }

  renderTabs();
  onceVisible($('#flow'), function () { flowStarted = true; renderFlow(); }, 0.2);
  // nav may finish a moment after this script — refresh links once it is ready
  window.addEventListener('load', function () { if (flowStarted) { /* keep animation state; only re-link */ relinkFlow(); } });
  function relinkFlow() {
    var reg = navRegistry();
    var f = FLOWS[flowIdx];
    var steps = $$('.ab-step', flowPanel);
    var k = 0;
    f.lanes.forEach(function (lane) {
      lane.steps.forEach(function (s) {
        var el = steps[k++];
        var box = el && $('.ab-pages', el);
        if (box && s.pg) box.innerHTML = s.pg.map(function (p) { return pageChip(p, reg); }).join('');
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // FAQS
  // ═══════════════════════════════════════════════════════════
  var FAQ_CATS = [
    { id: 'all',    l: 'Lahat' },
    { id: 'req',    l: 'Requests' },
    { id: 'edit',   l: 'Edit at correction' },
    { id: 'stock',  l: 'Stock at gastos' },
    { id: 'access', l: 'Access at tools' }
  ];
  var FAQS = [
    { c: 'req', q: 'Paano gumawa ng MRIF kung walang JO number?',
      a: '<p>Sa sidebar, buksan ang <b>New MRIF</b> at piliin ang <b>Manual (No JO)</b>. Ilagay mo mismo ang client, project at items.</p><p>Ganito rin sa MRS: piliin ang <b>Manual (No JO)</b> sa ilalim ng New MRS.</p>' },
    { c: 'req', q: 'Ano ang ibig sabihin ng Pending, Partial, Completed at Cancelled?',
      a: '<ul><li><b>Pending</b>: wala pang naibibigay ang warehouse.</li><li><b>Partial</b>: may naibigay na, pero kulang pa ang ibang items.</li><li><b>Completed</b>: kumpleto na ang naibigay.</li><li><b>Cancelled</b>: kinansela dahil mali o duplicate. Hindi binubura ang record.</li></ul>' },
    { c: 'req', q: 'Paano magbalik ng sobrang materyales?',
      a: '<ol><li>Buksan ang <b>New MRS</b> (With JO o Manual).</li><li>Piliin ang items at ilagay ang <b>Qty Returned</b>.</li><li>I-submit. Ang warehouse ang magve-verify ng aktwal na bumalik.</li></ol><p class="ab-tip">Hindi pwedeng lumampas ang na-verify na qty sa hiniling mong ibalik.</p>' },
    { c: 'req', q: 'May nakalagay na “in process by…” at hindi ko mabuksan ang request. Bakit?',
      a: '<p>May ibang warehouse staff na nagpoproseso ng request na iyon. Ito ay para hindi magkasabay ang dalawang tao at hindi madoble ang labas ng stock.</p><p>Kusang nawawala ang lock kapag natapos o umalis ang staff, o kapag 5 minuto na siyang walang signal. Subukan ulit pagkatapos.</p>' },
    { c: 'req', q: 'Bakit sinasabing kulang ang stock kahit may on-hand sa Stock Monitor?',
      a: '<p>Posibleng naka-reserve ang stock para sa isang SOF (sales order). Ang MRIF na walang SOF ay makakagamit lang ng <b>on-hand na bawas ang naka-reserve</b>.</p><p>Gumamit ng MRIF na may SOF number kung para sa SOF na iyon ang kukunin.</p>' },
    { c: 'req', q: 'Paano gumawa ng PRF?',
      a: '<ol><li>Buksan ang <b>Replenishment &amp; PRFs</b>, tab na <b>Needs</b>.</li><li>Makikita ang items na bumaba sa buffer, bawas na ang nasa order.</li><li>Piliin ang items at i-click ang Create PRF.</li><li>Hanggang 30 items bawat PRF. Kusa itong hahatiin ayon sa category at may sariling PRF number.</li></ol><p>Subaybayan ang status sa tab na <b>PRFs</b>.</p>' },

    { c: 'edit', q: 'Paano mag-edit ng request na naipasa ko na? (Production)',
      a: '<ol><li>Sa <b>My Requests</b>, hanapin ang request na <b>Pending</b> at i-click ang <b>Request Edit</b>.</li><li>Isulat ang dahilan at i-confirm.</li><li>Hintayin ang approval ng warehouse. Lalabas ang <b>Edit Pending Approval</b>.</li><li>Kapag na-approve, lalabas ang <b>Edit Now</b>. Baguhin ang items o qty at i-save.</li></ol><p class="ab-tip">Walang pag-edit habang Partial o Completed na ang request. Tingnan ang susunod na tanong.</p>' },
    { c: 'edit', q: 'Na-reject ang edit request ko. Ano ang gagawin?',
      a: '<p>Ilapit ang cursor sa button na <b>Rejected — Request Again</b> para makita ang dahilan ng warehouse. Ayusin ang paliwanag at i-click ito para magpasa ulit.</p>' },
    { c: 'edit', q: 'Partial o Completed na ang request pero may mali. May paraan pa ba?',
      a: '<p>Hindi na pwedeng i-edit ng production ang Partial at Completed. Mag-message sa warehouse (Messages) at sabihin ang mali.</p><ul><li><b>Pending o Partial</b>: pwedeng i-edit nang direkta ng warehouse. Kailangan ng dahilan at may audit trail.</li><li><b>Completed na MRIF</b>: may Correction mode. Item code, description at unit lang ang pwedeng ituwid; hindi pwedeng baguhin ang qty o magdagdag o magtanggal ng item.</li></ul><p>Kung sobra ang naibigay, gumawa ng <b>MRS</b> para maibalik ito.</p>' },
    { c: 'edit', q: 'Nagawa ang MRIF nang mali o na-duplicate. Paano burahin?',
      a: '<p>Hindi binubura ang MRIF. Ang warehouse staff o admin ay mag-c-<b>Cancel MRIF</b> na may dahilan, at magiging <b>CANCELLED</b> ito.</p><p class="ab-tip">Pwede lang mag-cancel kung wala pang naibibigay sa request.</p>' },
    { c: 'edit', q: 'May mali sa MRR (maling qty, vendor o DR number). Paano ayusin?',
      a: '<p>Sa <b>MRR List</b>, ang warehouse ay may dalawang pagpipilian:</p><ul><li><b>Edit</b> para itama ang detalye o qty.</li><li><b>Void</b> kung dapat tanggalin ang buong MRR. Magiging CANCELLED ito.</li></ul><p>Ang database ang nag-aayos ng stock at SOF nang buo, kaya walang kalahating nasave kapag pumalya.</p>' },
    { c: 'edit', q: 'Mali ang unit na inilagay ng production. Paano ituwid?',
      a: '<p>Habang nagpoproseso ng MRIF o MRS, sa popup ng pag-verify ng qty ay may <b>Unit</b> dropdown. Piliin ang tamang unit at i-save. Nakatala ang pagbabago.</p>' },

    { c: 'stock', q: 'Nagbago ang presyo ng item. Magbabago ba ang gastos ng mga lumang project?',
      a: '<p>Hindi. Sa <b>Ledger Cost Freeze</b>, kapag nagbago ang unit cost, naitatala muna ang lumang presyo sa mga lumang transaksyon. Mananatili ang gastos ng lumang project, at ang bagong presyo ay para na lang sa susunod na galaw.</p><p class="ab-tip">Ang item na walang presyo dati ay lalapat ang unang presyo sa mga lumang transaksyon nito.</p>' },
    { c: 'stock', q: 'Nagkamali ako sa Bulk Price Update. Paano ibalik?',
      a: '<p>Sa <b>Stock Monitor</b>, buksan ang Bulk Price Update at hanapin ang batch sa <b>Mga nakaraang batch</b>. I-click ang <b>Undo</b> sa batch na iyon.</p><p class="ab-tip">Ang item na na-edit ulit pagkatapos ng batch ay hindi na ginagalaw ng Undo.</p>' },
    { c: 'stock', q: 'Paano gawin ang Inventory Count?',
      a: '<ol><li>Sa <b>Inventory Count</b>, gumawa ng bagong session (buong bilang o SPOT count).</li><li>Bilangin ang items gamit ang scan o manual input.</li><li>I-submit para sa review. Makikita ang variance, kasama ang mga galaw pagkatapos ng bilang.</li><li>Ang approver ang mag-aapprove o magre-reject. Pwedeng i-reopen o i-cancel ang session.</li></ol>' },

    { c: 'access', q: 'Bakit hindi ko makita ang ibang pages?',
      a: '<p>Ayon sa role ang menu at access:</p><ul><li><b>Production</b>: My Requests, New MRIF at MRS, Messages, Project Costing, Break Room.</li><li><b>Warehouse</b>: halos lahat ng operations pages.</li><li><b>Procurement</b>: PRF Monitor, Replenishment (PRFs), MRR Monitoring, SOF Tracker. View-only.</li><li><b>Finance</b>: MRIF Monitoring at Project Costing. View-only.</li><li><b>Admin</b>: dagdag ang User Management, Supabase Admin, Warehouse KPI at System Health.</li></ul>' },
    { c: 'access', q: 'Paano palitan ang profile photo o password?',
      a: '<p>I-click ang pangalan mo sa kanang itaas, tapos <b>Settings</b>. Doon mo mapapalitan ang litrato, password at preferences.</p>' },
    { c: 'access', q: 'Paano i-install ang system sa phone o desktop?',
      a: '<p>Gumagana ang GEMCOR ERP bilang app. Kapag may lumabas na install prompt, i-click ito. Kung wala, gamitin ang menu ng browser: <b>Install app</b> o <b>Add to Home screen</b>.</p>' },
    { c: 'access', q: 'Mabagal o walang internet. Ano ang mangyayari?',
      a: '<p>Makikita sa taas kung <b>Connected</b> o <b>Offline</b> ang system. Kapag mabagal o offline, lalabas ang “Maglaro muna” para sa Break Room.</p><p class="ab-tip">Kailangan ng internet para mag-save dahil nasa Supabase ang data. Hintayin ang success message bago isara ang page.</p>' },
    { c: 'access', q: 'Ano ang mga keyboard shortcut?',
      a: '<ul><li><kbd>Ctrl</kbd>+<kbd>K</kbd> (o <kbd>⌘</kbd>+<kbd>K</kbd>): global search</li><li><kbd>Alt</kbd>+<kbd>A</kbd>: magdagdag ng item row</li><li><kbd>Enter</kbd>: susunod na field, at bagong row pagkatapos ng huli</li><li><kbd>Ctrl</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd>: parehong column, naunang o susunod na row</li><li><kbd>Alt</kbd>+<kbd>Delete</kbd>: alisin ang kasalukuyang row</li><li><kbd>Ctrl</kbd>+<kbd>S</kbd>: submit</li><li><kbd>Ctrl</kbd>+<kbd>/</kbd>: ipakita ang listahan ng shortcuts</li></ul>' }
  ];

  var faqList = $('#abFaqList');
  var faqChips = $('#abFaqChips');
  var faqSearch = $('#abFaqSearch');
  var faqCount = $('#abFaqCount');
  var faqEmpty = $('#abFaqEmpty');
  var faqCat = 'all';
  var catLabel = {};
  FAQ_CATS.forEach(function (c) { catLabel[c.id] = c.l; });

  function plain(html) { var d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').toLowerCase(); }
  FAQS.forEach(function (f) { f.text = (f.q + ' ' + plain(f.a)).toLowerCase(); });

  function buildFaq() {
    if (!faqList) return;
    faqChips.innerHTML = FAQ_CATS.map(function (c) {
      return '<button type="button" class="ab-chip' + (c.id === faqCat ? ' on' : '') + '" data-c="' + c.id + '" aria-pressed="' + (c.id === faqCat) + '">' + esc(c.l) + '</button>';
    }).join('');
    $$('.ab-chip', faqChips).forEach(function (b) {
      b.addEventListener('click', function () {
        faqCat = b.getAttribute('data-c');
        $$('.ab-chip', faqChips).forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        filterFaq();
      });
    });
    faqList.innerHTML = FAQS.map(function (f, i) {
      return '<div class="ab-faq-item" data-c="' + f.c + '" data-i="' + i + '">' +
        '<button type="button" class="ab-faq-q" aria-expanded="false" aria-controls="abFaqA' + i + '" id="abFaqQ' + i + '">' +
        '<span class="ab-cat">' + esc(catLabel[f.c]) + '</span><span class="ab-q">' + esc(f.q) + '</span><i class="bi bi-chevron-down ab-chev"></i></button>' +
        '<div class="ab-faq-a" id="abFaqA' + i + '" role="region" aria-labelledby="abFaqQ' + i + '"><div><div class="ab-faq-body">' + f.a + '</div></div></div></div>';
    }).join('');
    $$('.ab-faq-q', faqList).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.parentNode;
        var willOpen = !item.classList.contains('open');
        $$('.ab-faq-item.open', faqList).forEach(function (o) {
          o.classList.remove('open');
          $('.ab-faq-q', o).setAttribute('aria-expanded', 'false');
        });
        if (willOpen) { item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    filterFaq(true);
  }

  function filterFaq(first) {
    var term = (faqSearch.value || '').trim().toLowerCase();
    var shown = 0;
    $$('.ab-faq-item', faqList).forEach(function (el) {
      var f = FAQS[+el.getAttribute('data-i')];
      var ok = (faqCat === 'all' || f.c === faqCat) && (!term || f.text.indexOf(term) !== -1);
      el.hidden = !ok;
      el.classList.remove('ab-in');
      if (ok) {
        el.style.setProperty('--i', Math.min(shown, 10));
        if (!first && !REDUCED) { void el.offsetWidth; el.classList.add('ab-in'); }
        shown++;
      }
    });
    faqCount.textContent = shown + (shown === 1 ? ' tanong' : ' tanong') + (term || faqCat !== 'all' ? ' ang tugma' : '');
    faqEmpty.hidden = shown !== 0;
  }
  if (faqSearch) {
    var faqTimer;
    faqSearch.addEventListener('input', function () { clearTimeout(faqTimer); faqTimer = setTimeout(filterFaq, 120); });
  }
  buildFaq();

  // ═══════════════════════════════════════════════════════════
  // FEATURES (normal → advanced)
  // roles: P production · W warehouse · R procurement · F finance · A admin
  // ═══════════════════════════════════════════════════════════
  var ROLE_LABEL = { P: 'Production', W: 'Warehouse', R: 'Procurement', F: 'Finance', A: 'Admin' };
  var TIERS = [
    { id: 'basic', title: 'Pang-araw-araw', sub: 'Para sa lahat ng gumagamit ng system', items: [
      ['bi-shield-lock', 'Login at role-based access', 'Bawat user ay may role. Ang menu at pages ay ayon sa role.', 'PWRFA'],
      ['bi-list-check', 'My Requests', 'Lahat ng MRIF at MRS mo na may status na Pending, Partial, Completed o Cancelled.', 'P'],
      ['bi-box-arrow-up-right', 'New MRIF (With JO)', 'Ilagay ang JO number at kusang lalabas ang client at project.', 'P'],
      ['bi-pencil-square', 'Manual MRIF at MRS', 'Para sa request na walang JO. Mano-mano ang detalye.', 'P'],
      ['bi-arrow-counterclockwise', 'New MRS (Returns)', 'Magbalik ng sobrang materyales. Ang Qty Returned lang ang ilalagay.', 'P'],
      ['bi-search', 'Item auto-suggest', 'Hanapin ang item sa pangalan o code habang nagta-type.', 'PWR'],
      ['bi-chat-dots', 'Messages', 'Chat ng warehouse at production, may usapan kada dokumento, read ticks, emoji at profile photo.', 'PW'],
      ['bi-bell', 'Notifications at alerts', 'Bell sa taas, popup at tunog ng bagong mensahe, at badge sa sidebar.', 'PWRFA'],
      ['bi-command', 'Global search (Ctrl+K)', 'Maghanap ng item, dokumento o page mula sa kahit anong screen.', 'PWRFA'],
      ['bi-person-gear', 'Settings at profile photo', 'Palitan ang litrato, password at preferences.', 'PWRFA'],
      ['bi-signpost-split', 'Quick Guide', 'Maikling tour para sa production sa unang gamit. Pwedeng ulitin sa user menu.', 'P'],
      ['bi-download', 'Install as app', 'I-install sa phone o desktop para parang regular na app.', 'PWRFA'],
      ['bi-wifi', 'Connection indicator', 'Makikita sa taas kung Connected o Offline ang system.', 'PWRFA'],
      ['bi-controller', 'Break Room: Crate Blast', 'Maliit na laro para sa pahinga o kapag mabagal ang internet.', 'PW']
    ] },
    { id: 'ops', title: 'Operations ng warehouse', sub: 'Pang-araw-araw na trabaho ng warehouse, procurement at finance', items: [
      ['bi-box-seam', 'Stock Monitor', 'On-hand, buffer at halaga ng bawat item. May filter, inline edit at CSV import.', 'W'],
      ['bi-inbox', 'All Requests', 'Lahat ng bukas na MRIF at MRS, may badge sa sidebar at kategorya ng may hawak.', 'W'],
      ['bi-upc-scan', 'Process MRIF', 'Barcode scan, pag-verify ng qty, partial release at pag-ayos ng unit.', 'W'],
      ['bi-clipboard-check', 'Process MRS', 'I-verify ang aktwal na bumalik. Hindi lalampas sa hiniling.', 'W'],
      ['bi-lock', 'Request lock', 'Ang “in process by…” ay pumipigil na dalawang staff ang magproseso nang sabay.', 'W'],
      ['bi-card-list', 'MRIF, MRR at MRS lists', 'Hanapin, tingnan at i-print ang bawat dokumento.', 'W'],
      ['bi-box-arrow-in-down', 'New MRR (Receiving)', 'Itala ang dumating na items kasama ang PO, SOF, PRF, vendor at DR number.', 'W'],
      ['bi-pencil', 'Edit Requests', 'Aprubahan o i-reject ang hiling ng production na mag-edit.', 'W'],
      ['bi-tools', 'Edit, Void at Cancel', 'Direct edit, MRR void at MRIF cancel. Laging may dahilan at audit.', 'W'],
      ['bi-qr-code', 'Barcode / QR generator', 'Mag-print ng QR labels nang batch. Adjustable ang laki at layout.', 'W'],
      ['bi-printer', 'Print preview at print log', 'Nakatala kung sino at kailan nag-print ng dokumento.', 'W'],
      ['bi-clipboard-data', 'Inventory Count', 'Buong o SPOT count, scan o manual, review at approve.', 'W'],
      ['bi-cart-plus-fill', 'Replenishment at PRF', 'Items sa ilalim ng buffer, bawas ang nasa order, at paggawa ng PRF.', 'W'],
      ['bi-file-earmark-text', 'PRF Monitor', 'Status ng PRF at PO. View-only para sa procurement.', 'RW'],
      ['bi-file-earmark-ruled', 'SOF Tracker', 'Stock na naka-reserve para sa sales order at kung gaano na ang nagamit.', 'WR'],
      ['bi-cash-coin', 'Project Costing', 'Gastos ng bawat project at ang mga galaw na bumuo nito.', 'PWF'],
      ['bi-calendar-week', 'Weekly at document monitoring', 'Weekly Monitoring at MRIF, MRR at MRS Monitoring.', 'WRF'],
      ['bi-arrow-left-right', 'Item In & Out', 'Beginning balance, total in, total out at ending balance ng item.', 'W'],
      ['bi-graph-up-arrow', 'Usage Trend at Monthly Usage', 'Konsumo kada buwan at trend para sa reorder.', 'W'],
      ['bi-clock-history', 'Process History', 'Gawain ng bawat warehouse staff sa MRIF, MRR, MRS at PRF.', 'W']
    ] },
    { id: 'adv', title: 'Advanced at admin', sub: 'Mga kontrol, proteksyon at monitoring', items: [
      ['bi-grid-1x2', 'Management Dashboard', 'Mga KPI at charts na may as-of date para sa mabilis na pagtingin.', 'W'],
      ['bi-speedometer2', 'Warehouse KPI', 'Turnaround, performance ng staff at aging ng backlog.', 'A'],
      ['bi-people-fill', 'User Management', 'Pamahalaan ang users, roles at pag-assign ng kategorya.', 'A'],
      ['bi-database-fill-gear', 'Supabase Admin Console', 'Tingnan at ayusin ang tables ng database. Protektado ng PIN.', 'A'],
      ['bi-activity', 'System Health', 'Ping at error log para makita ang kalagayan ng system.', 'A'],
      ['bi-currency-exchange', 'Bulk Price Update', 'Maramihang presyo na may preview, dahilan at Undo.', 'W'],
      ['bi-snow2', 'Ledger Cost Freeze', 'Hindi nagbabago ang gastos ng lumang transaksyon kapag nagbago ang presyo.', 'WF'],
      ['bi-bookmark-check', 'SOF priority reservation', 'Protektado ang stock na naka-reserve para sa sales order.', 'W'],
      ['bi-shield-check', 'All-or-nothing transactions', 'Ang mahahalagang galaw ay buo ang pagkaka-save sa database o walang nagbago.', 'WA'],
      ['bi-journal-text', 'Audit trail', 'May dahilan, pangalan at oras ang bawat edit at correction.', 'WA'],
      ['bi-eye', 'Read-only guard', 'View-only ang procurement at finance, at hinaharang ang anumang pagsulat.', 'RF'],
      ['bi-keyboard', 'Keyboard shortcuts', 'Mabilis na pag-encode sa MRIF, MRR, MRS at PRF.', 'PW'],
      ['bi-cloud-arrow-down', 'Auto-update banner', 'Lalabas ang “Update Available” kapag may bagong bersyon.', 'PWRFA'],
      ['bi-cloud-slash', 'Offline page at net watch', 'May fallback page at Break Room kapag mabagal o offline ang koneksyon.', 'PWRFA']
    ] }
  ];

  var featTiers = $('#abFeatTiers');
  var featChips = $('#abFeatChips');
  var featRole = 'all';
  var featTotal = 0;
  TIERS.forEach(function (t) { featTotal += t.items.length; });
  var featCountEl = $('#abFeatCount');
  if (featCountEl) { featCountEl.setAttribute('data-count', featTotal); featCountEl.textContent = featTotal; }

  function buildFeatures() {
    if (!featTiers) return;
    var chips = [{ id: 'all', l: 'Lahat' }].concat(Object.keys(ROLE_LABEL).map(function (k) { return { id: k, l: ROLE_LABEL[k] }; }));
    featChips.innerHTML = chips.map(function (c) {
      return '<button type="button" class="ab-chip' + (c.id === featRole ? ' on' : '') + '" data-r="' + c.id + '" aria-pressed="' + (c.id === featRole) + '">' + esc(c.l) + '</button>';
    }).join('');
    $$('.ab-chip', featChips).forEach(function (b) {
      b.addEventListener('click', function () {
        featRole = b.getAttribute('data-r');
        $$('.ab-chip', featChips).forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        filterFeatures();
      });
    });
    featTiers.innerHTML = TIERS.map(function (t) {
      return '<div class="ab-tier" data-tier="' + t.id + '"><div class="ab-tier-h"><h3>' + esc(t.title) + '</h3><span>' + esc(t.sub) + ' · <b class="ab-tier-n"></b></span></div>' +
        '<div class="ab-grid">' + t.items.map(function (f) {
          return '<article class="ab-feat" data-roles="' + f[3] + '"><div class="ab-feat-ic"><i class="bi ' + f[0] + '"></i></div><div><h4>' + esc(f[1]) + '</h4><p>' + esc(f[2]) + '</p>' +
            '<div class="ab-roles">' + f[3].split('').map(function (r) { return '<span class="ab-rt ' + r.toLowerCase() + '">' + ROLE_LABEL[r] + '</span>'; }).join('') + '</div></div></article>';
        }).join('') + '</div></div>';
    }).join('');
    filterFeatures(true);
  }

  function filterFeatures(first) {
    $$('.ab-tier', featTiers).forEach(function (tier) {
      var shown = 0;
      var grid = $('.ab-grid', tier);
      $$('.ab-feat', tier).forEach(function (el) {
        var ok = featRole === 'all' || el.getAttribute('data-roles').indexOf(featRole) !== -1;
        el.hidden = !ok;
        if (ok) { el.style.setProperty('--i', Math.min(shown, 12)); shown++; }
      });
      $('.ab-tier-n', tier).textContent = shown + (shown === 1 ? ' feature' : ' features');
      tier.hidden = shown === 0;
      if (!first) {                       // replay the cascade after a filter change
        grid.classList.remove('is-in');
        void grid.offsetWidth;
        grid.classList.add('is-in');
      }
    });
  }
  buildFeatures();

  // cascade when each tier scrolls into view
  $$('.ab-grid', featTiers).forEach(function (g) { onceVisible(g, function () { g.classList.add('is-in'); }, 0.08); });

  // count-up for the total
  onceVisible(featCountEl, function () {
    if (REDUCED || !featCountEl) return;
    var target = featTotal, start = null, dur = 900;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      featCountEl.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    featCountEl.textContent = '0';
    requestAnimationFrame(step);
  }, 0.5);

  // ═══════════════════════════════════════════════════════════
  // SCROLL SPY for the jump bar
  // ═══════════════════════════════════════════════════════════
  var jump = $$('.ab-jump a');
  if (jump.length) {
    var spyTargets = jump.map(function (a) { return { a: a, el: document.getElementById(a.getAttribute('href').slice(1)) }; })
      .filter(function (t) { return t.el; });
    var spyTick = false;
    function spy() {
      spyTick = false;
      var line = window.innerHeight * 0.4, current = null;
      spyTargets.forEach(function (t) { if (t.el.getBoundingClientRect().top <= line) current = t; });
      jump.forEach(function (a) { a.classList.toggle('on', !!current && current.a === a); });
    }
    window.addEventListener('scroll', function () { if (!spyTick) { spyTick = true; requestAnimationFrame(spy); } }, { passive: true });
    window.addEventListener('resize', spy);
    spy();
  }
})();
