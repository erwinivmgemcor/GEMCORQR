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
    return '<span class="ab-page is-off" title="Not available for your role"><i class="bi bi-lock"></i>' + esc(CHIP_LABEL[ref] || list[0].label) + '</span>';
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
      id: 'p2w', icon: 'bi-box-arrow-in-right', label: 'Production → Warehouse', sub: 'Requests and returns',
      intro: 'Production starts the cycle: it requests materials with an MRIF and returns surplus with an MRS.',
      lanes: [
        { title: 'Requesting materials (MRIF)', steps: [
          { a: 'prod', t: 'Create an MRIF', d: 'Enter the JO number and the client and project fill in automatically. If there is no JO, use Manual (No JO). Select items with auto-suggest and enter the quantities.', pg: ['new-mrif', 'new-mrif-manual'] },
          { a: 'prod', t: 'Submit', d: 'Optionally add an SOF number when the stock is reserved for a sales order. Double-clicking will not create a duplicate request.' },
          { a: 'sys',  t: 'Enters the warehouse queue', d: 'The status is PENDING. The request appears in the warehouse All Requests list and the sidebar badge updates.', pg: ['all-requests'] },
          { a: 'prod', t: 'Track the status', d: 'Follow Pending, Partial or Completed in My Requests, and message the warehouse about the request if needed.', pg: ['my-requests', 'chat'] }
        ] },
        { title: 'Returning surplus (MRS)', steps: [
          { a: 'prod', t: 'Create an MRS', d: 'Choose With JO or Manual. Only the Qty Returned needs to be entered.', pg: ['new-mrs', 'new-mrs-manual'] },
          { a: 'sys',  t: 'Pending warehouse verification', d: 'The warehouse verifies the items that were actually returned.' },
          { a: 'prod', t: 'Review the result', d: 'Once verified, the updated status appears in My Requests.', pg: ['my-requests'] }
        ] }
      ]
    },
    {
      id: 'w2p', icon: 'bi-box-arrow-up-right', label: 'Warehouse → Production', sub: 'Processing and issuing',
      intro: 'What the warehouse does with each request: protect stock levels, issue materials and record every movement.',
      status: true,
      lanes: [
        { title: 'Issuing materials (MRIF)', steps: [
          { a: 'wh',  t: 'Open the request', d: 'All open MRIFs and MRSs are listed in All Requests, including which staff member handles each category (Components, Consumables, Fabmat).', pg: ['all-requests'] },
          { a: 'sys', t: 'Lock the request', d: 'An “in process by…” lock prevents two staff members from processing the same request. It releases automatically when the work is finished, abandoned or the connection is lost.' },
          { a: 'wh',  t: 'Verify the items', d: 'Scan the barcode or tick the item and enter the quantity to issue. If production entered the wrong unit, it can be corrected here.', pg: ['Process MRIF'] },
          { a: 'sys', t: 'Stock check', d: 'The issued quantity cannot exceed what is available. Stock reserved for an SOF is not available to an MRIF without an SOF.' },
          { a: 'sys', t: 'Record in the ledger', d: 'One complete transaction: stock is deducted, the movement is written to the stock ledger and SOF usage is updated. If anything fails, nothing is partially saved.' },
          { a: 'wh',  t: 'Status and printing', d: 'Pending → Partial → Completed. The MRIF can be printed, and each print is logged by user.', pg: ['mrif-list'] }
        ] },
        { title: 'Receiving returns (MRS)', steps: [
          { a: 'wh',  t: 'Open the MRS', d: 'It appears in All Requests alongside MRIFs.', pg: ['all-requests', 'mrs-list'] },
          { a: 'wh',  t: 'Verify what came back', d: 'Check the physical items and enter the actual returned quantity, which cannot exceed the quantity requested.', pg: ['Process MRS'] },
          { a: 'sys', t: 'Automatic status', d: 'The status is calculated from the verified quantity and is visible to production immediately.' }
        ] }
      ]
    },
    {
      id: 'proc', icon: 'bi-cart-check', label: 'Procurement', sub: 'From reorder to receiving',
      intro: 'From items running low to the delivery arriving and entering stock.',
      lanes: [
        { title: 'Reorder → PRF → MRR', steps: [
          { a: 'sys',  t: 'Appears under Needs', d: 'Items below their buffer level, net of what is already on order. Only the net requirement goes onto a PRF.', pg: ['replenishment'] },
          { a: 'wh',   t: 'Create a PRF', d: 'Select the items. Each PRF holds up to 30 items and is split by category automatically, with its own PRF number.', pg: ['replenishment'] },
          { a: 'wh',   t: 'Noted by and Approved by', d: 'Default names are prefilled and can be changed before printing.' },
          { a: 'proc', t: 'Track in PRF Monitor', d: 'Read-only for procurement: PRF status, PO data and which items are still open.', pg: ['prf-monitor', 'replenishment'] },
          { a: 'wh',   t: 'Receive on an MRR', d: 'Enter the PO, SOF, PRF, vendor, DR number and receiving date.', pg: ['New MRR', 'mrr-list'] },
          { a: 'proc', t: 'See the result', d: 'On-hand rises in the ledger, and procurement can see the receipt in MRR Monitoring.', pg: ['mrr-monitoring', 'sof-tracker'] }
        ] }
      ]
    },
    {
      id: 'fin', icon: 'bi-cash-coin', label: 'Finance', sub: 'Costing and pricing',
      intro: 'Every stock movement carries a value, so the cost of each project is clear.',
      lanes: [
        { title: 'Project costing and price changes', steps: [
          { a: 'sys', t: 'Every movement has a value', d: 'Stock in and out is recorded in the ledger together with the unit cost.' },
          { a: 'fin', t: 'Project Costing', d: 'View the cost of each project, the items behind it and the movements. View-only.', pg: ['project-costing'] },
          { a: 'fin', t: 'MRIF Monitoring', d: 'Monitor material issuances by date, project and department.', pg: ['mrif-monitoring'] },
          { a: 'wh',  t: 'Bulk Price Update', d: 'Upload new prices in Stock Monitor, with a preview, a reason and an Undo afterwards.', pg: ['stock-monitor'] },
          { a: 'sys', t: 'Ledger Cost Freeze', d: 'When a price changes, past transactions and projects keep the old price. The new price applies only to later movements.' }
        ] }
      ]
    }
  ];

  var STATUS_NOTE = 'MRIF statuses:';
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
        '<span style="margin-left:6px">or</span><span class="ab-status-pill cx">CANCELLED</span></div>';
    }
    flowPanel.setAttribute('aria-labelledby', 'abTab' + flowIdx);
    flowPanel.innerHTML = html;
  }

  renderTabs();
  onceVisible($('#flow'), function () { flowStarted = true; renderFlow(); }, 0.2);
  // the sidebar may finish a moment after this script, so refresh links once it is ready
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
    { id: 'all',    l: 'All' },
    { id: 'req',    l: 'Requests' },
    { id: 'edit',   l: 'Edits and corrections' },
    { id: 'stock',  l: 'Stock and costing' },
    { id: 'access', l: 'Access and tools' }
  ];
  var FAQS = [
    { c: 'req', q: 'How do I create an MRIF without a JO number?',
      a: '<p>In the sidebar, open <b>New MRIF</b> and choose <b>Manual (No JO)</b>. Enter the client, project and items yourself.</p><p>The same applies to returns: choose <b>Manual (No JO)</b> under New MRS.</p>' },
    { c: 'req', q: 'What do Pending, Partial, Completed and Cancelled mean?',
      a: '<ul><li><b>Pending</b>: the warehouse has not issued anything yet.</li><li><b>Partial</b>: some items have been issued, but others are still outstanding.</li><li><b>Completed</b>: everything requested has been issued.</li><li><b>Cancelled</b>: cancelled because it was created in error or duplicated. The record is kept.</li></ul>' },
    { c: 'req', q: 'How do I return surplus materials?',
      a: '<ol><li>Open <b>New MRS</b> (With JO or Manual).</li><li>Select the items and enter the <b>Qty Returned</b>.</li><li>Submit. The warehouse verifies what was actually returned.</li></ol><p class="ab-tip">The verified quantity cannot exceed the quantity you asked to return.</p>' },
    { c: 'req', q: 'A request shows “in process by…” and I cannot open it. Why?',
      a: '<p>Another warehouse staff member is processing that request. This prevents two people from working on it at once and issuing stock twice.</p><p>The lock releases automatically when they finish or leave, or after 5 minutes without activity. Please try again shortly.</p>' },
    { c: 'req', q: 'Why is stock reported as insufficient when Stock Monitor shows on-hand quantity?',
      a: '<p>The stock may be reserved for an SOF (sales order). An MRIF without an SOF can only use <b>on-hand minus reserved stock</b>.</p><p>Use an MRIF that carries the SOF number if the material is intended for that SOF.</p>' },
    { c: 'req', q: 'How do I create a PRF?',
      a: '<ol><li>Open <b>Replenishment &amp; PRFs</b> and go to the <b>Needs</b> tab.</li><li>Review the items that fell below their buffer, net of what is already on order.</li><li>Select the items and click Create PRF.</li><li>Each PRF holds up to 30 items. It is split by category automatically and receives its own PRF number.</li></ol><p>Track its progress in the <b>PRFs</b> tab.</p>' },

    { c: 'edit', q: 'How do I edit a request I have already submitted? (Production)',
      a: '<ol><li>In <b>My Requests</b>, find the <b>Pending</b> request and click <b>Request Edit</b>.</li><li>Enter the reason and confirm.</li><li>Wait for warehouse approval. The button reads <b>Edit Pending Approval</b>.</li><li>Once approved, <b>Edit Now</b> appears. Change the items or quantities and save.</li></ol><p class="ab-tip">A request cannot be edited once it is Partial or Completed. See the next questions for those cases.</p>' },
    { c: 'edit', q: 'My edit request was rejected. What should I do?',
      a: '<p>Hover over the <b>Rejected — Request Again</b> button to see the warehouse’s reason. Clarify your explanation and click the button to submit a new request.</p>' },
    { c: 'edit', q: 'The request is Partial or Completed but contains a mistake. Can it still be corrected?',
      a: '<p>Production can no longer edit Partial or Completed requests. Message the warehouse (Messages) and describe the error.</p><ul><li><b>Pending or Partial</b>: the warehouse can edit the request directly. A reason is required and an audit record is kept.</li><li><b>Completed MRIF</b>: Correction mode is available. Only the item code, description and unit can be corrected. Quantities cannot be changed and items cannot be added or removed.</li></ul><p>If too much was issued, create an <b>MRS</b> to return the excess.</p>' },
    { c: 'edit', q: 'An MRIF was created by mistake or duplicated. How do I remove it?',
      a: '<p>An MRIF is never deleted. Warehouse staff or an admin uses <b>Cancel MRIF</b> with a reason, and the document becomes <b>CANCELLED</b>.</p><p class="ab-tip">Cancelling is only possible while nothing has been issued against the request.</p>' },
    { c: 'edit', q: 'There is an error on an MRR (wrong quantity, vendor or DR number). How do I fix it?',
      a: '<p>In the <b>MRR List</b>, the warehouse has two options:</p><ul><li><b>Edit</b> to correct the details or quantities.</li><li><b>Void</b> to remove the whole MRR. It becomes CANCELLED.</li></ul><p>The database adjusts stock and SOF as a single unit, so a failure never leaves a partial change.</p>' },
    { c: 'edit', q: 'Production entered the wrong unit. How do I correct it?',
      a: '<p>While processing an MRIF or MRS, the quantity verification pop-up includes a <b>Unit</b> dropdown. Select the correct unit and save. The change is recorded.</p>' },

    { c: 'stock', q: 'An item’s price changed. Will the cost of past projects change?',
      a: '<p>No. With <b>Ledger Cost Freeze</b>, when a unit cost changes, the previous price is first recorded on the item’s past transactions. Past project costs stay the same, and the new price applies only to later movements.</p><p class="ab-tip">If an item previously had no price, its first price also applies to its earlier transactions.</p>' },
    { c: 'stock', q: 'I made a mistake in a Bulk Price Update. How do I reverse it?',
      a: '<p>In <b>Stock Monitor</b>, open Bulk Price Update and find the batch under <b>Previous batches</b>. Click <b>Undo</b> on that batch.</p><p class="ab-tip">Undo does not touch an item that was edited again after the batch was applied.</p>' },
    { c: 'stock', q: 'How do I run an Inventory Count?',
      a: '<ol><li>In <b>Inventory Count</b>, create a new session (full count or SPOT count).</li><li>Count the items by scanning or manual entry.</li><li>Submit for review. The variance is shown, taking movements after the count into account.</li><li>The approver approves or rejects the count. A session can be reopened or cancelled.</li></ol>' },

    { c: 'access', q: 'Why can’t I see some pages?',
      a: '<p>Menus and access depend on your role:</p><ul><li><b>Production</b>: My Requests, New MRIF and MRS, Messages, Project Costing, Break Room.</li><li><b>Warehouse</b>: all operational pages.</li><li><b>Procurement</b>: PRF Monitor, Replenishment (PRFs), MRR Monitoring, SOF Tracker. View-only.</li><li><b>Finance</b>: MRIF Monitoring and Project Costing. View-only.</li><li><b>Admin</b>: additionally User Management, Supabase Admin, Warehouse KPI and System Health.</li></ul>' },
    { c: 'access', q: 'How do I change my profile photo or password?',
      a: '<p>Click your name at the top right, then <b>Settings</b>. You can change your photo, password and preferences there.</p>' },
    { c: 'access', q: 'How do I install the system on my phone or desktop?',
      a: '<p>GEMCOR ERP works as an installable app. If an install prompt appears, click it. Otherwise use the browser menu: <b>Install app</b> or <b>Add to Home screen</b>.</p>' },
    { c: 'access', q: 'What happens when the internet is slow or offline?',
      a: '<p>The top bar shows whether the system is <b>Connected</b> or <b>Offline</b>. When the connection is slow or lost, a prompt to open the Break Room game appears.</p><p class="ab-tip">An internet connection is required to save, because the data lives in Supabase. Wait for the success message before closing the page.</p>' },
    { c: 'access', q: 'What keyboard shortcuts are available?',
      a: '<ul><li><kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>⌘</kbd>+<kbd>K</kbd>): global search</li><li><kbd>Alt</kbd>+<kbd>A</kbd>: add an item row</li><li><kbd>Enter</kbd>: next field, and a new row after the last field</li><li><kbd>Ctrl</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd>: same column, previous or next row</li><li><kbd>Alt</kbd>+<kbd>Delete</kbd>: remove the current row</li><li><kbd>Ctrl</kbd>+<kbd>S</kbd>: submit</li><li><kbd>Ctrl</kbd>+<kbd>/</kbd>: show the shortcut list</li></ul>' }
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
    faqCount.textContent = shown + (shown === 1 ? ' question' : ' questions') + (term || faqCat !== 'all' ? ' found' : '');
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
    { id: 'basic', title: 'Everyday use', sub: 'For everyone who uses the system', items: [
      ['bi-shield-lock', 'Login and role-based access', 'Each user has a role, and the menu and pages follow it.', 'PWRFA'],
      ['bi-list-check', 'My Requests', 'All of your MRIFs and MRSs with their status: Pending, Partial, Completed or Cancelled.', 'P'],
      ['bi-box-arrow-up-right', 'New MRIF (With JO)', 'Enter the JO number and the client and project fill in automatically.', 'P'],
      ['bi-pencil-square', 'Manual MRIF and MRS', 'For requests without a JO, with details entered manually.', 'P'],
      ['bi-arrow-counterclockwise', 'New MRS (Returns)', 'Return surplus materials by entering only the Qty Returned.', 'P'],
      ['bi-search', 'Item auto-suggest', 'Find an item by name or code as you type.', 'PWR'],
      ['bi-chat-dots', 'Messages', 'Direct and per-document chat between warehouse and production, with read receipts, emoji and profile photos.', 'PW'],
      ['bi-bell', 'Notifications and alerts', 'Bell icon, pop-ups and sound for new messages, and a sidebar badge.', 'PWRFA'],
      ['bi-command', 'Global search (Ctrl+K)', 'Find items, documents or pages from any screen.', 'PWRFA'],
      ['bi-person-gear', 'Settings and profile photo', 'Change your photo, password and preferences.', 'PWRFA'],
      ['bi-signpost-split', 'Quick Guide', 'A short first-use tour for production, replayable from the user menu.', 'P'],
      ['bi-download', 'Install as an app', 'Install on a phone or desktop to use it like a regular app.', 'PWRFA'],
      ['bi-wifi', 'Connection indicator', 'Shows at the top whether the system is Connected or Offline.', 'PWRFA'],
      ['bi-controller', 'Break Room: Crate Blast', 'A small game for breaks or for when the connection is slow.', 'PW']
    ] },
    { id: 'ops', title: 'Warehouse operations', sub: 'Daily work for warehouse, procurement and finance', items: [
      ['bi-box-seam', 'Stock Monitor', 'On-hand, buffer and value per item, with filters, inline edit and CSV import.', 'W'],
      ['bi-inbox', 'All Requests', 'Every open MRIF and MRS, with a sidebar badge and the staff member responsible for each category.', 'W'],
      ['bi-upc-scan', 'Process MRIF', 'Barcode scanning, quantity verification, partial release and unit correction.', 'W'],
      ['bi-clipboard-check', 'Process MRS', 'Verify the actual returned quantity, capped at the quantity requested.', 'W'],
      ['bi-lock', 'Request lock', 'The “in process by…” lock stops two staff from processing the same request.', 'W'],
      ['bi-card-list', 'MRIF, MRR and MRS lists', 'Search, view and print each document.', 'W'],
      ['bi-box-arrow-in-down', 'New MRR (Receiving)', 'Record received items with the PO, SOF, PRF, vendor and DR number.', 'W'],
      ['bi-pencil', 'Edit Requests', 'Approve or reject production’s requests to edit a submitted document.', 'W'],
      ['bi-tools', 'Edit, Void and Cancel', 'Direct edit, MRR void and MRIF cancel, always with a reason and audit record.', 'W'],
      ['bi-qr-code', 'Barcode / QR generator', 'Print QR labels in batches with adjustable size and layout.', 'W'],
      ['bi-printer', 'Print preview and print log', 'Records who printed a document and when.', 'W'],
      ['bi-clipboard-data', 'Inventory Count', 'Full or spot counts, by scan or manual entry, with review and approval.', 'W'],
      ['bi-cart-plus-fill', 'Replenishment and PRF', 'Items below buffer, net of open orders, and PRF creation.', 'W'],
      ['bi-file-earmark-text', 'PRF Monitor', 'PRF and PO status, view-only for procurement.', 'RW'],
      ['bi-file-earmark-ruled', 'SOF Tracker', 'Stock reserved for sales orders and how much has been used.', 'WR'],
      ['bi-cash-coin', 'Project Costing', 'The cost of each project and the movements behind it.', 'PWF'],
      ['bi-calendar-week', 'Weekly and document monitoring', 'Weekly Monitoring plus MRIF, MRR and MRS Monitoring.', 'WRF'],
      ['bi-arrow-left-right', 'Item In & Out', 'Beginning balance, total in, total out and ending balance per item.', 'W'],
      ['bi-graph-up-arrow', 'Usage Trend and Monthly Usage', 'Monthly consumption and trends to support reordering.', 'W'],
      ['bi-clock-history', 'Process History', 'Each warehouse staff member’s activity across MRIF, MRR, MRS and PRF.', 'W']
    ] },
    { id: 'adv', title: 'Advanced and admin', sub: 'Controls, safeguards and monitoring', items: [
      ['bi-grid-1x2', 'Management Dashboard', 'KPIs and charts with an as-of date for a quick overview.', 'W'],
      ['bi-speedometer2', 'Warehouse KPI', 'Turnaround time, staff performance and backlog aging.', 'A'],
      ['bi-people-fill', 'User Management', 'Manage users, roles and category assignments.', 'A'],
      ['bi-database-fill-gear', 'Supabase Admin Console', 'Browse and maintain database tables, protected by a PIN.', 'A'],
      ['bi-activity', 'System Health', 'Ping and error log to monitor the state of the system.', 'A'],
      ['bi-currency-exchange', 'Bulk Price Update', 'Update many prices at once with a preview, a reason and Undo.', 'W'],
      ['bi-snow2', 'Ledger Cost Freeze', 'Past transactions keep their original cost when a price changes.', 'WF'],
      ['bi-bookmark-check', 'SOF priority reservation', 'Stock reserved for a sales order is protected from other requests.', 'W'],
      ['bi-shield-check', 'All-or-nothing transactions', 'Critical movements are saved completely in the database or not at all.', 'WA'],
      ['bi-journal-text', 'Audit trail', 'Every edit and correction records a reason, the user and a timestamp.', 'WA'],
      ['bi-eye', 'Read-only guard', 'Procurement and finance are view-only, and any write attempt is blocked.', 'RF'],
      ['bi-keyboard', 'Keyboard shortcuts', 'Faster data entry on the MRIF, MRR, MRS and PRF screens.', 'PW'],
      ['bi-cloud-arrow-down', 'Auto-update banner', 'An “Update Available” banner appears when a new version is released.', 'PWRFA'],
      ['bi-cloud-slash', 'Offline page and net watch', 'A fallback page and the Break Room appear when the connection is slow or lost.', 'PWRFA']
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
    var chips = [{ id: 'all', l: 'All roles' }].concat(Object.keys(ROLE_LABEL).map(function (k) { return { id: k, l: ROLE_LABEL[k] }; }));
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
