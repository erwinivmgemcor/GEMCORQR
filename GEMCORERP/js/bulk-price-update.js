/* ============================================================
 * GEMCOR ERP — Bulk Price Update (Unit Cost)
 * Stock Monitor → "Bulk Price Update"
 * Daloy: I-download ang template → lagyan ng New Unit Cost → i-upload → PREVIEW → Apply → (Undo kung kailangan)
 * unit_cost LANG ang binabago (via erp_apply_unit_cost_update). Walang ledger/on-hand/SOF/dokumento.
 * Kailangan: erp-bulk-price-update.sql sa Supabase.
 * ============================================================ */
(function () {
  'use strict';

  var S = { rows: [], preview: null, filter: 'CHANGE', fileName: '', busy: false };

  // ── mga helper ──────────────────────────────────────────────
  function user() {
    return localStorage.getItem('ivm_userFullname') || localStorage.getItem('ivm_username') || 'WAREHOUSE';
  }
  function toast(m, t) { if (typeof erpShowToast === 'function') erpShowToast(m, t || 'info'); }
  function peso(n) {
    if (n === null || n === undefined || n === '') return '—';
    return '₱' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  async function rpc(name, body) {
    var res = await fetch(erpUrl('rpc/' + name), { method: 'POST', headers: erpHeaders(), body: JSON.stringify(body) });
    var txt = await res.text(), data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!res.ok) {
      var m = (data && (data.message || data.hint)) || txt || ('HTTP ' + res.status);
      if (/Could not find the function|PGRST202/i.test(m))
        m = 'Wala pa ang bagong function sa database. I-run muna ang erp-bulk-price-update.sql sa Supabase.';
      throw new Error(m);
    }
    return data;
  }

  // ── CSV ─────────────────────────────────────────────────────
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = ',';
    var cnt = { ',': (first.match(/,/g) || []).length, ';': (first.match(/;/g) || []).length, '\t': (first.match(/\t/g) || []).length };
    if (cnt[';'] > cnt[delim]) delim = ';';
    if (cnt['\t'] > cnt[delim]) delim = '\t';
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row);
    return rows;
  }

  function norm(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function findColumns(header) {
    var h = header.map(norm), code = -1, cost = -1, i;
    for (i = 0; i < h.length; i++) if (['item code', 'itemcode', 'code', 'item'].indexOf(h[i]) !== -1) { code = i; break; }
    // New Unit Cost muna; kung wala, "unit cost/price" na HINDI "current/old"
    for (i = 0; i < h.length; i++) if (/^new /.test(h[i]) && /(cost|price)/.test(h[i])) { cost = i; break; }
    if (cost === -1) for (i = 0; i < h.length; i++)
      if (/(unit cost|unit price|^cost$|^price$)/.test(h[i]) && !/(current|old|previous|prev)/.test(h[i])) { cost = i; break; }
    return { code: code, cost: cost };
  }

  // "₱1,234.50" / "PHP 12" / "12.5" → number; blangko → null; di-mabasa → NaN
  function money(v) {
    var s = String(v == null ? '' : v).trim();
    if (s === '') return null;
    s = s.replace(/₱|php|pesos?|\s/gi, '').replace(/,/g, '');
    if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) return NaN;
    return Number(s);
  }

  function buildRows(csv) {
    var cols = findColumns(csv[0]);
    if (cols.code === -1) throw new Error('Walang "Item Code" column. Gamitin ang template (Download Template).');
    if (cols.cost === -1) throw new Error('Walang "New Unit Cost" column. Gamitin ang template (Download Template).');
    var out = [], skippedBlank = 0;
    for (var r = 1; r < csv.length; r++) {
      var code = String(csv[r][cols.code] == null ? '' : csv[r][cols.code]).trim();
      var raw = csv[r][cols.cost];
      var val = money(raw);
      if (val === null) { skippedBlank++; continue; }            // blangko = huwag galawin
      out.push({ row: r + 1, item_code: code, unit_cost: isNaN(val) ? null : val });
    }
    return { rows: out, skippedBlank: skippedBlank };
  }

  // ── Template (kasalukuyang presyo ng lahat ng item) ─────────
  async function downloadTemplate() {
    var btn = document.getElementById('bpuTplBtn');
    var old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Kinukuha...';
    try {
      var items = await erpFetchAll('erp_items',
        'select=item_code,description,base_unit,unit_cost&is_deleted=eq.false&order=item_code.asc');
      var q = function (v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = ['Item Code,Description,Unit,Current Unit Cost,New Unit Cost'];
      items.forEach(function (it) {
        lines.push([q(it.item_code), q(it.description), q(it.base_unit), it.unit_cost == null ? '' : it.unit_cost, ''].join(','));
      });
      var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'price-update-template-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      toast('Na-download ang template (' + items.length + ' item)', 'success');
    } catch (e) { toast('Hindi makuha ang listahan: ' + e.message, 'danger'); }
    finally { btn.disabled = false; btn.innerHTML = old; }
  }

  // ── Modal ───────────────────────────────────────────────────
  function ensureModal() {
    if (document.getElementById('bpuModal')) return;
    var css = document.createElement('style');
    css.textContent =
      '#bpuModal .bpu-step{display:flex;gap:12px;align-items:flex-start;padding:10px 0}' +
      '#bpuModal .bpu-n{flex:0 0 28px;height:28px;border-radius:50%;background:#1e3a5f;color:#fff;font-weight:800;display:grid;place-items:center;font-size:.8rem}' +
      '#bpuModal .bpu-chip{cursor:pointer;border:1.5px solid transparent;border-radius:999px;padding:5px 12px;font-size:.78rem;font-weight:700;background:#f1f5f9;color:#475569;user-select:none}' +
      '#bpuModal .bpu-chip.on{background:#1e3a5f;color:#fff}' +
      '#bpuModal .bpu-chip b{margin-left:6px;background:rgba(0,0,0,.08);border-radius:999px;padding:0 7px}' +
      '#bpuModal .bpu-chip.on b{background:rgba(255,255,255,.2)}' +
      '#bpuModal .bpu-up{color:#b91c1c;font-weight:700}#bpuModal .bpu-down{color:#047857;font-weight:700}' +
      '#bpuModal .bpu-drop{border:2px dashed #b6c4da;border-radius:12px;padding:18px;text-align:center;background:#f8fafc}';
    document.head.appendChild(css);
    var d = document.createElement('div');
    d.innerHTML =
      '<div class="modal fade" id="bpuModal" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title"><i class="bi bi-tag me-2"></i>Bulk Price Update <small class="text-muted fs-6">(Unit Cost)</small></h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
      '<div class="modal-body" id="bpuBody"></div>' +
      '<div class="modal-footer" id="bpuFooter"></div></div></div></div>';
    document.body.appendChild(d.firstChild);
  }

  function show() {
    var el = document.getElementById('bpuModal');
    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function renderStart(note) {
    S.rows = []; S.preview = null;
    document.getElementById('bpuBody').innerHTML =
      (note || '') +
      '<div class="alert alert-info py-2 small mb-3"><i class="bi bi-shield-check me-1"></i>' +
      '<strong>Ligtas ito:</strong> <strong>Unit Cost lang</strong> ang mababago. Hindi gagalawin ang on-hand, stock ledger, SOF, at mga dokumento (MRIF/MRR/MRS). ' +
      'May preview muna bago i-apply, at may <strong>Undo</strong> pagkatapos.</div>' +
      '<div class="bpu-step"><div class="bpu-n">1</div><div class="flex-grow-1"><strong>I-download ang template</strong> ' +
      '<span class="text-muted small">— laman nito ang lahat ng item at ang kasalukuyang presyo.</span><br>' +
      '<button class="btn btn-sm btn-outline-primary mt-2" id="bpuTplBtn"><i class="bi bi-download me-1"></i>Download Template (CSV)</button></div></div>' +
      '<div class="bpu-step"><div class="bpu-n">2</div><div class="flex-grow-1"><strong>Ilagay ang bagong presyo</strong> ' +
      'sa column na <code>New Unit Cost</code>. Ang <strong>blangko ay hindi gagalawin</strong>, kaya pwedeng iwan ang mga item na hindi magbabago. ' +
      '<span class="text-muted small">I-save bilang CSV. Huwag baguhin ang Item Code.</span></div></div>' +
      '<div class="bpu-step"><div class="bpu-n">3</div><div class="flex-grow-1"><strong>I-upload ang file</strong>' +
      '<div class="bpu-drop mt-2"><input type="file" id="bpuFile" accept=".csv,text/csv" class="form-control" style="max-width:420px;margin:auto"></div></div></div>' +
      '<hr><div class="d-flex justify-content-between align-items-center"><strong class="small">Mga nakaraang batch</strong>' +
      '<button class="btn btn-sm btn-link" id="bpuRefreshHist">I-refresh</button></div><div id="bpuHist" class="small text-muted">Kinukuha...</div>';
    document.getElementById('bpuFooter').innerHTML = '<button class="btn btn-light" data-bs-dismiss="modal">Close</button>';
    document.getElementById('bpuTplBtn').onclick = downloadTemplate;
    document.getElementById('bpuFile').onchange = onFile;
    document.getElementById('bpuRefreshHist').onclick = loadHistory;
    loadHistory();
  }

  async function loadHistory() {
    var box = document.getElementById('bpuHist');
    if (!box) return;
    try {
      var list = await rpc('erp_list_unit_cost_batches', { p_limit: 10 });
      if (!list || !list.length) { box.textContent = 'Wala pang batch.'; return; }
      box.innerHTML = '<table class="table table-sm align-middle mb-0"><thead><tr><th>Batch</th><th>Petsa</th><th>Gumawa</th><th class="text-end">Items</th><th>Dahilan</th><th>Status</th><th></th></tr></thead><tbody>' +
        list.map(function (b) {
          var applied = b.status === 'APPLIED';
          return '<tr><td><code>' + erpEsc(b.batch_no) + '</code></td><td>' + erpEsc(new Date(b.created_at).toLocaleString()) + '</td>' +
            '<td>' + erpEsc(b.created_by) + '</td><td class="text-end">' + b.item_count + '</td><td>' + erpEsc(b.reason) + '</td>' +
            '<td><span class="badge ' + (applied ? 'bg-primary' : 'bg-secondary') + '">' + b.status + '</span></td>' +
            '<td class="text-end">' + (applied ? '<button class="btn btn-sm btn-outline-danger py-0" data-undo="' + erpEsc(b.batch_no) + '"><i class="bi bi-arrow-counterclockwise"></i> Undo</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
      box.querySelectorAll('[data-undo]').forEach(function (b) { b.onclick = function () { undoBatch(b.getAttribute('data-undo')); }; });
    } catch (e) { box.innerHTML = '<span class="text-danger">' + erpEsc(e.message) + '</span>'; }
  }

  async function undoBatch(batchNo) {
    var reason = prompt('Bakit i-u-undo ang ' + batchNo + '? (kailangan)');
    if (!reason || !reason.trim()) return;
    if (!confirm('Ibabalik ang lumang presyo ng LAHAT ng item sa batch na ' + batchNo + '.\n\nAng item na binago na ulit pagkatapos ng batch na ito ay HINDI gagalawin.\n\nTuloy?')) return;
    try {
      var r = await rpc('erp_undo_unit_cost_update', { p_batch_no: batchNo, p_reason: reason.trim(), p_user: user() });
      if (!r || !r.success) throw new Error((r && r.error) || 'Undo failed');
      var msg = '✅ ' + r.restored + ' item ang naibalik ang presyo';
      if (r.skipped_count) msg += ' · ' + r.skipped_count + ' ang hindi ginalaw (may bagong edit na): ' + r.skipped.map(function (x) { return x.item_code; }).slice(0, 5).join(', ');
      toast(msg, 'success');
      if (typeof erpLoadDashboard === 'function') erpLoadDashboard();
      loadHistory();
    } catch (e) { toast(e.message, 'danger'); alert(e.message); }
  }

  // ── Upload + Preview ────────────────────────────────────────
  function onFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    S.fileName = f.name;
    var rd = new FileReader();
    rd.onload = async function () {
      try {
        var csv = parseCsv(rd.result);
        if (csv.length < 2) throw new Error('Walang laman ang file.');
        var built = buildRows(csv);
        if (!built.rows.length) throw new Error('Walang nakitang New Unit Cost sa file (lahat ay blangko).');
        S.rows = built.rows;
        document.getElementById('bpuBody').innerHTML = '<div class="text-center py-5"><div class="spinner-border"></div><div class="mt-2 text-muted">Sinusuri ang ' + built.rows.length + ' row...</div></div>';
        var res = await rpc('erp_preview_unit_cost_update', { p_rows: built.rows });
        if (!res || !res.success) throw new Error('Preview failed');
        S.preview = res; S.skippedBlank = built.skippedBlank;
        S.filter = res.summary.change ? 'CHANGE' : 'ALL';
        renderPreview();
      } catch (e) { renderStart('<div class="alert alert-danger py-2 small">' + erpEsc(e.message) + '</div>'); }
    };
    rd.readAsText(f);
  }

  var LABEL = { CHANGE: ['Babaguhin', 'bg-primary'], UNCHANGED: ['Pareho na', 'bg-secondary'], NOT_FOUND: ['Wala sa system', 'bg-danger'],
                INVALID: ['Invalid', 'bg-danger'], DUPLICATE: ['Doble', 'bg-dark'] };

  function renderPreview() {
    var p = S.preview, s = p.summary;
    var blocked = s.duplicate > 0;
    var chips = [['CHANGE', 'Babaguhin', s.change], ['BIG', 'Malaking pagbabago (≥50%)', s.big], ['UNCHANGED', 'Pareho na', s.unchanged],
                 ['NOT_FOUND', 'Wala sa system', s.not_found], ['INVALID', 'Invalid', s.invalid], ['DUPLICATE', 'Doble sa file', s.duplicate], ['ALL', 'Lahat', s.total]];
    var html = '<div class="small text-muted mb-2"><i class="bi bi-file-earmark-spreadsheet me-1"></i>' + erpEsc(S.fileName) +
      ' · ' + s.total + ' row na may presyo' + (S.skippedBlank ? ' · ' + S.skippedBlank + ' blangko (hindi gagalawin)' : '') + '</div>';
    if (!p.freeze_active) html += '<div class="alert alert-danger py-2 small"><i class="bi bi-exclamation-octagon me-1"></i><strong>Hindi pa naka-install ang Ledger Cost Freeze.</strong> ' +
      'Kapag nag-apply ka ngayon, <strong>magbabago ang gastos ng mga lumang project</strong> (gagamitin ang bagong presyo). ' +
      'I-run muna ang <code>erp-ledger-cost-freeze.sql</code> sa Supabase.</div>';
    else html += '<div class="alert alert-success py-2 small"><i class="bi bi-lock me-1"></i>Naka-freeze ang gastos ng mga lumang transaksyon at project (mananatili sa dating presyo). ' +
      'Ang bagong presyo ay para sa mga susunod na transaksyon at sa mga item na walang presyo dati.</div>';
    if (blocked) html += '<div class="alert alert-danger py-2 small"><strong>May dobleng item code sa file.</strong> Hindi ito maa-apply hangga\'t hindi naaayos. Piliin ang "Doble sa file" para makita.</div>';
    if (s.not_found || s.invalid) html += '<div class="alert alert-warning py-2 small">May ' + (s.not_found + s.invalid) + ' row na <strong>lalaktawan</strong> (hindi mahanap ang item o invalid ang presyo). Ang iba ay maa-apply pa rin.</div>';
    if (s.big) html += '<div class="alert alert-warning py-2 small"><i class="bi bi-exclamation-triangle me-1"></i><strong>' + s.big + ' item</strong> ang may pagbabagong 50% pataas (o walang dating presyo). Tingnan kung typo.</div>';
    html += '<div class="d-flex flex-wrap gap-2 mb-2" id="bpuChips">' + chips.map(function (c) {
      return '<span class="bpu-chip ' + (S.filter === c[0] ? 'on' : '') + '" data-f="' + c[0] + '">' + c[1] + '<b>' + c[2] + '</b></span>';
    }).join('') + '</div>';

    var rows = p.rows.filter(function (r) {
      if (S.filter === 'ALL') return true;
      if (S.filter === 'BIG') return r.status === 'CHANGE' && (!r.old || Math.abs(r.pct || 0) >= 50);
      return r.status === S.filter;
    });
    var shown = rows.slice(0, 500);
    html += '<div class="table-responsive" style="max-height:340px;overflow:auto"><table class="table table-sm table-hover align-middle mb-0"><thead class="table-light" style="position:sticky;top:0"><tr>' +
      '<th>Row</th><th>Item Code</th><th>Description</th><th class="text-end">Dati</th><th class="text-end">Bago</th><th class="text-end">Pagbabago</th><th>Status</th></tr></thead><tbody>' +
      (shown.length ? shown.map(function (r) {
        var lb = LABEL[r.status] || [r.status, 'bg-secondary'];
        var pct = r.pct == null ? (r.status === 'CHANGE' ? '<span class="text-muted small">bagong presyo</span>' : '—')
          : '<span class="' + (r.pct > 0 ? 'bpu-up' : r.pct < 0 ? 'bpu-down' : 'text-muted') + '">' + (r.pct > 0 ? '▲ +' : r.pct < 0 ? '▼ ' : '') + r.pct + '%</span>';
        var code = r.item_code ? '<code>' + erpEsc(r.item_code) + '</code>' + (r.input && r.input.toUpperCase() !== r.item_code.toUpperCase() ? ' <small class="text-muted">(' + erpEsc(r.input) + ')</small>' : '') +
          (r.inactive ? ' <span class="badge bg-warning text-dark">inactive</span>' : '') : '<code class="text-danger">' + erpEsc(r.input || '(blangko)') + '</code>';
        return '<tr' + (r.status === 'NOT_FOUND' || r.status === 'INVALID' || r.status === 'DUPLICATE' ? ' class="table-danger"' : '') + '><td>' + r.row + '</td><td>' + code + '</td>' +
          '<td class="small">' + erpEsc((r.description || '').substring(0, 70)) + '</td><td class="text-end">' + peso(r.old) + '</td>' +
          '<td class="text-end fw-bold">' + (r.new == null ? '<span class="text-danger">invalid</span>' : peso(r.new)) + '</td><td class="text-end">' + pct + '</td>' +
          '<td><span class="badge ' + lb[1] + '">' + lb[0] + '</span></td></tr>';
      }).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">Walang row sa filter na ito.</td></tr>') +
      '</tbody></table></div>' + (rows.length > 500 ? '<div class="small text-muted mt-1">Ipinapakita ang unang 500 sa ' + rows.length + '.</div>' : '');

    html += '<div class="mt-3"><label class="form-label small fw-bold">Dahilan ng pagbabago <span class="text-danger">*</span></label>' +
      '<input class="form-control" id="bpuReason" placeholder="Hal. Bagong presyo ng supplier — Nov 2026 / Utos ni Manager"></div>';
    document.getElementById('bpuBody').innerHTML = html;
    document.getElementById('bpuChips').querySelectorAll('.bpu-chip').forEach(function (c) {
      c.onclick = function () { var r = document.getElementById('bpuReason'); var keep = r ? r.value : ''; S.filter = c.getAttribute('data-f'); renderPreview(); document.getElementById('bpuReason').value = keep; };
    });
    var f = document.getElementById('bpuFooter');
    f.innerHTML = '<button class="btn btn-light me-auto" id="bpuBack"><i class="bi bi-arrow-left me-1"></i>Ibang file</button>' +
      '<button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>' +
      '<button class="btn btn-primary" id="bpuApply"' + (blocked || !s.change ? ' disabled' : '') + '><i class="bi bi-check2-circle me-1"></i>Apply ' + s.change + ' price change' + (s.change === 1 ? '' : 's') + '</button>';
    document.getElementById('bpuBack').onclick = function () { renderStart(); };
    document.getElementById('bpuApply').onclick = apply;
  }

  async function apply() {
    if (S.busy) return;
    var reason = (document.getElementById('bpuReason').value || '').trim();
    if (!reason) { toast('Ilagay ang dahilan ng pagbabago', 'warning'); document.getElementById('bpuReason').focus(); return; }
    var s = S.preview.summary;
    if (!S.preview.freeze_active && !confirm('BABALA: Hindi naka-install ang Ledger Cost Freeze.\n\nMagbabago ang gastos ng LAHAT ng lumang project at transaksyon.\n\nTuloy pa rin?')) return;
    if (!confirm('I-a-apply ang ' + s.change + ' bagong presyo.\n\n' +
      '• Unit Cost lang ang mababago (hindi ang stock o transaksyon)\n' +
      '• Magbabago ang Stock Value at mga report na gumagamit ng kasalukuyang presyo\n' +
      (s.big ? '• May ' + s.big + ' item na malaki ang pagbabago — nasuri mo na ba?\n' : '') +
      '• Pwede itong i-Undo pagkatapos\n\nTuloy?')) return;
    S.busy = true;
    var b = document.getElementById('bpuApply'), old = b.innerHTML;
    b.disabled = true; b.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Applying...';
    try {
      var r = await rpc('erp_apply_unit_cost_update', { p_rows: S.rows, p_reason: reason, p_user: user() });
      if (!r || !r.success) throw new Error((r && r.error) || 'Apply failed');
      toast('✅ ' + r.items_updated + ' presyo ang na-update (' + r.batch_no + ')', 'success');
      if (typeof erpLoadDashboard === 'function') erpLoadDashboard();
      renderStart('<div class="alert alert-success py-2"><i class="bi bi-check-circle me-1"></i><strong>Tapos na.</strong> ' + r.items_updated +
        ' presyo ang na-update. Batch <code>' + erpEsc(r.batch_no) + '</code>. Kung may mali, i-click ang <strong>Undo</strong> sa listahan sa ibaba.</div>');
    } catch (e) {
      toast(e.message, 'danger'); alert(e.message);
      b.disabled = false; b.innerHTML = old;
    } finally { S.busy = false; }
  }

  // ── Bukas ──────────────────────────────────────────────────
  window.bpuOpen = function () {
    if (localStorage.getItem('ivm_userRole') !== 'warehouse') {
      toast('Warehouse lang ang may access sa Bulk Price Update', 'warning'); return;
    }
    ensureModal(); renderStart(); show();
  };
  window._bpuTest = { parseCsv: parseCsv, buildRows: buildRows, money: money, findColumns: findColumns };
  console.log('✅ bulk-price-update.js v1.1 loaded');
})();
