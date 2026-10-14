// ============================================================
// GEMCOR ERP — Global Search (⌘K / Ctrl+K)
// v1.0 — Cross-module instant search
// ============================================================

(function() {
  'use strict';

  var _gs = {
    isOpen: false,
    query: '',
    results: { items: [], mrif: [], mrr: [], mrs: [], prf: [], vendors: [] },
    flatResults: [],
    selectedIndex: 0,
    searchTimer: null,
    recentKey: 'ivm_recentSearches',
    maxRecent: 5,
    dataCache: {
      items: null,
      vendors: null,
      documents: null,
      prfs: null
    },
    dataCacheTime: {},
    CACHE_TTL: 5 * 60 * 1000  // 5 minutes
  };

  // ═══════════════════════════════════════════════════════════
  // STYLES
  // ═══════════════════════════════════════════════════════════
  function _injectStyles() {
    if (document.getElementById('globalSearchStyles')) return;

    var style = document.createElement('style');
    style.id = 'globalSearchStyles';
    style.textContent = [
      '@keyframes gsFadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes gsSlideIn { from { opacity: 0; transform: translateY(-20px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }',
      '@keyframes gsSpin { to { transform: rotate(360deg); } }',

      '#gsOverlay {',
      '  position: fixed; top: 0; left: 0; right: 0; bottom: 0;',
      '  background: rgba(10, 22, 40, 0.55);',
      '  backdrop-filter: blur(4px);',
      '  z-index: 99998;',
      '  display: none;',
      '  align-items: flex-start;',
      '  justify-content: center;',
      '  padding: 80px 20px 40px 20px;',
      '  animation: gsFadeIn 0.15s ease;',
      '  overflow-y: auto;',
      '}',
      '#gsOverlay.show { display: flex; }',

      '#gsModal {',
      '  width: 100%;',
      '  max-width: 640px;',
      '  background: #fff;',
      '  border-radius: 16px;',
      '  box-shadow: 0 24px 72px rgba(0,0,0,0.35);',
      '  overflow: hidden;',
      '  animation: gsSlideIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);',
      '  display: flex;',
      '  flex-direction: column;',
      '  max-height: calc(100vh - 120px);',
      '}',

      '#gsInputWrap {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 12px;',
      '  padding: 18px 22px;',
      '  border-bottom: 1px solid #e2e8f0;',
      '  flex-shrink: 0;',
      '}',
      '#gsInputWrap i.gs-search-icon {',
      '  font-size: 1.2rem;',
      '  color: #64748b;',
      '}',
      '#gsInput {',
      '  flex: 1;',
      '  border: none;',
      '  outline: none;',
      '  font-size: 1.1rem;',
      '  font-family: inherit;',
      '  color: #0f172a;',
      '  background: transparent;',
      '  padding: 4px 0;',
      '}',
      '#gsInput::placeholder { color: #94a3b8; }',
      '#gsInputWrap kbd {',
      '  padding: 4px 8px;',
      '  background: #f1f5f9;',
      '  border: 1px solid #e2e8f0;',
      '  border-radius: 6px;',
      '  font-size: 0.7rem;',
      '  font-weight: 700;',
      '  color: #64748b;',
      '  font-family: inherit;',
      '}',

      '#gsResults {',
      '  flex: 1;',
      '  overflow-y: auto;',
      '  padding: 8px 0;',
      '  min-height: 100px;',
      '}',

      '.gs-section-label {',
      '  font-size: 0.68rem;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.08em;',
      '  color: #94a3b8;',
      '  padding: 12px 22px 6px 22px;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '}',
      '.gs-section-label i { font-size: 0.85rem; }',
      '.gs-section-label .gs-count {',
      '  background: #e2e8f0;',
      '  color: #475569;',
      '  padding: 1px 7px;',
      '  border-radius: 8px;',
      '  font-size: 0.62rem;',
      '}',

      '.gs-item {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 12px;',
      '  padding: 10px 22px;',
      '  cursor: pointer;',
      '  transition: background 0.1s;',
      '  border-left: 3px solid transparent;',
      '}',
      '.gs-item:hover, .gs-item.selected {',
      '  background: #eff6ff;',
      '  border-left-color: #1e3a5f;',
      '}',
      '.gs-item-icon {',
      '  width: 32px;',
      '  height: 32px;',
      '  border-radius: 8px;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  font-size: 0.95rem;',
      '  flex-shrink: 0;',
      '}',
      '.gs-item-icon.icon-item { background: #dbeafe; color: #1e40af; }',
      '.gs-item-icon.icon-mrif { background: #fef3c7; color: #92400e; }',
      '.gs-item-icon.icon-mrr { background: #d1fae5; color: #065f46; }',
      '.gs-item-icon.icon-mrs { background: #fee2e2; color: #991b1b; }',
      '.gs-item-icon.icon-prf { background: #e9d5ff; color: #6b21a8; }',
      '.gs-item-icon.icon-vendor { background: #f1f5f9; color: #475569; }',

      '.gs-item-body {',
      '  flex: 1;',
      '  min-width: 0;',
      '}',
      '.gs-item-title {',
      '  font-weight: 700;',
      '  font-size: 0.88rem;',
      '  color: #0f172a;',
      '  margin-bottom: 2px;',
      '  font-family: "Courier New", monospace;',
      '}',
      '.gs-item-subtitle {',
      '  font-size: 0.78rem;',
      '  color: #64748b;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '.gs-item-badge {',
      '  font-size: 0.68rem;',
      '  font-weight: 700;',
      '  padding: 2px 8px;',
      '  border-radius: 8px;',
      '  flex-shrink: 0;',
      '}',
      '.gs-badge-served { background: #d1fae5; color: #065f46; }',
      '.gs-badge-pending { background: #fef3c7; color: #92400e; }',
      '.gs-badge-partial { background: #dbeafe; color: #1e40af; }',
      '.gs-badge-info { background: #f1f5f9; color: #475569; }',

      '.gs-empty {',
      '  padding: 60px 20px;',
      '  text-align: center;',
      '  color: #94a3b8;',
      '}',
      '.gs-empty i {',
      '  font-size: 2.5rem;',
      '  opacity: 0.4;',
      '  display: block;',
      '  margin-bottom: 12px;',
      '}',
      '.gs-empty-title {',
      '  font-size: 0.95rem;',
      '  font-weight: 700;',
      '  color: #64748b;',
      '  margin-bottom: 4px;',
      '}',
      '.gs-empty-hint {',
      '  font-size: 0.82rem;',
      '}',

      '.gs-recent-label {',
      '  font-size: 0.7rem;',
      '  font-weight: 700;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.08em;',
      '  color: #94a3b8;',
      '  padding: 16px 22px 8px 22px;',
      '  display: flex;',
      '  justify-content: space-between;',
      '  align-items: center;',
      '}',
      '.gs-recent-clear {',
      '  background: transparent;',
      '  border: none;',
      '  color: #64748b;',
      '  font-size: 0.72rem;',
      '  font-weight: 600;',
      '  cursor: pointer;',
      '  padding: 4px 8px;',
      '  border-radius: 6px;',
      '  font-family: inherit;',
      '}',
      '.gs-recent-clear:hover {',
      '  background: #f1f5f9;',
      '  color: #0f172a;',
      '}',

      '.gs-loading {',
      '  padding: 40px;',
      '  text-align: center;',
      '  color: #94a3b8;',
      '}',
      '.gs-loading-spinner {',
      '  width: 32px;',
      '  height: 32px;',
      '  border: 3px solid #e2e8f0;',
      '  border-top-color: #1e3a5f;',
      '  border-radius: 50%;',
      '  animation: gsSpin 0.6s linear infinite;',
      '  margin: 0 auto 12px;',
      '}',

      '#gsFooter {',
      '  padding: 10px 22px;',
      '  border-top: 1px solid #e2e8f0;',
      '  display: flex;',
      '  justify-content: space-between;',
      '  align-items: center;',
      '  background: #f8fafc;',
      '  font-size: 0.72rem;',
      '  color: #64748b;',
      '  flex-shrink: 0;',
      '}',
      '#gsFooter .gs-hint {',
      '  display: flex;',
      '  gap: 16px;',
      '}',
      '#gsFooter .gs-hint kbd {',
      '  background: #fff;',
      '  border: 1px solid #e2e8f0;',
      '  padding: 2px 6px;',
      '  border-radius: 4px;',
      '  font-size: 0.65rem;',
      '  font-weight: 700;',
      '  font-family: inherit;',
      '  color: #475569;',
      '}',

      '#gsOverlay mark {',
      '  background: #fef08a;',
      '  color: #0f172a;',
      '  padding: 0 2px;',
      '  border-radius: 2px;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // MODAL HTML — Lazy creation
  // ═══════════════════════════════════════════════════════════
  function _ensureModal() {
    if (document.getElementById('gsOverlay')) return;

    _injectStyles();

    var overlay = document.createElement('div');
    overlay.id = 'gsOverlay';
    overlay.innerHTML = [
      '<div id="gsModal" onclick="event.stopPropagation()">',
      '  <div id="gsInputWrap">',
      '    <i class="bi bi-search gs-search-icon"></i>',
      '    <input type="text" id="gsInput" placeholder="Search items, MRIF, MRR, MRS, PRF, vendors..." autocomplete="off" spellcheck="false">',
      '    <kbd>ESC</kbd>',
      '  </div>',
      '  <div id="gsResults"></div>',
      '  <div id="gsFooter">',
      '    <div class="gs-hint">',
      '      <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>',
      '      <span><kbd>↵</kbd> Open</span>',
      '      <span><kbd>ESC</kbd> Close</span>',
      '    </div>',
      '    <div><strong id="gsResultCount">0</strong> results</div>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    // Click outside → close
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeSearch();
    });

    // Input handlers
    var input = document.getElementById('gsInput');
    input.addEventListener('input', function() {
      _gs.query = this.value.trim();
      _gs.selectedIndex = 0;
      _debounceSearch();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════
  function openSearch() {
    _ensureModal();
    _gs.isOpen = true;
    _gs.query = '';
    _gs.selectedIndex = 0;

    var overlay = document.getElementById('gsOverlay');
    var input = document.getElementById('gsInput');
    overlay.classList.add('show');
    input.value = '';

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Render initial state (recent searches or empty)
    _renderInitial();

    setTimeout(function() {
      input.focus();
    }, 50);
  }

  function closeSearch() {
    var overlay = document.getElementById('gsOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    _gs.isOpen = false;
    document.body.style.overflow = '';
  }

  // ═══════════════════════════════════════════════════════════
  // DEBOUNCE
  // ═══════════════════════════════════════════════════════════
  function _debounceSearch() {
    if (_gs.searchTimer) clearTimeout(_gs.searchTimer);
    if (!_gs.query || _gs.query.length < 2) {
      _renderInitial();
      return;
    }
    _gs.searchTimer = setTimeout(function() {
      _performSearch(_gs.query);
    }, 200);
  }

  // ═══════════════════════════════════════════════════════════
  // INITIAL STATE — Recent searches
  // ═══════════════════════════════════════════════════════════
  function _renderInitial() {
    var results = document.getElementById('gsResults');
    if (!results) return;

    var recent = _getRecent();

    if (recent.length === 0) {
      results.innerHTML = [
        '<div class="gs-empty">',
        '  <i class="bi bi-search"></i>',
        '  <div class="gs-empty-title">Type to search across the system</div>',
        '  <div class="gs-empty-hint">Items · MRIF · MRR · MRS · PRF · Vendors</div>',
        '</div>'
      ].join('');
      _updateResultCount(0);
      return;
    }

    var html = '';
    html += '<div class="gs-recent-label">';
    html += '  <span><i class="bi bi-clock-history me-1"></i>Recent Searches</span>';
    html += '  <button class="gs-recent-clear" onclick="window.erpClearRecentSearches()">Clear</button>';
    html += '</div>';

    recent.forEach(function(term, idx) {
      html += '<div class="gs-item" data-action="recent" data-term="' + _escAttr(term) + '" data-idx="' + idx + '">' +
        '  <div class="gs-item-icon icon-vendor"><i class="bi bi-clock-history"></i></div>' +
        '  <div class="gs-item-body">' +
        '    <div class="gs-item-title">' + _esc(term) + '</div>' +
        '  </div>' +
        '  <button class="gs-recent-clear" onclick="event.stopPropagation();window.erpRemoveRecent(\'' + _escAttr(term) + '\')">' +
        '    <i class="bi bi-x"></i>' +
        '  </button>' +
        '</div>';
    });

    results.innerHTML = html;
    _bindResultClicks();
    _updateResultCount(recent.length);
  }

  // ═══════════════════════════════════════════════════════════
  // LOAD DATA (with cache)
  // ═══════════════════════════════════════════════════════════
  async function _loadData(type) {
    var now = Date.now();
    if (_gs.dataCache[type] && _gs.dataCacheTime[type] && 
        (now - _gs.dataCacheTime[type]) < _gs.CACHE_TTL) {
      return _gs.dataCache[type];
    }

    try {
      var data = null;

      if (type === 'items') {
        data = await erpFetch('erp_items',
          'select=item_code,description,category,location,on_hand,base_unit' +
          '&is_active=eq.true&is_deleted=eq.false&is_deprecated_2026=eq.false' +
          '&limit=5000&order=item_code.asc');

      } else if (type === 'vendors') {
        data = await erpFetch('vendors', 'select=name&order=name.asc&limit=500');

      } else if (type === 'documents') {
        // MRIF, MRR, MRS combined
        data = await erpFetch('documents',
          'select=doc_no,doc_type,status,requestor,jo_no,po_no,vendor,created_at,item_count' +
          '&order=created_at.desc&limit=2000');

      } else if (type === 'prfs') {
        data = await erpFetch('prf_documents',
          'select=id,prf_no,base_prf_no,version_number,category,requestor,total_items,total_qty,created_at' +
          '&order=created_at.desc&limit=1000');
      }

      _gs.dataCache[type] = data || [];
      _gs.dataCacheTime[type] = now;
      return data || [];

    } catch (err) {
      console.warn('[GlobalSearch] Load ' + type + ' failed:', err.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════
  async function _performSearch(query) {
    var results = document.getElementById('gsResults');
    if (!results) return;

    results.innerHTML = '<div class="gs-loading">' +
      '<div class="gs-loading-spinner"></div>' +
      '<div>Searching...</div>' +
      '</div>';

    var q = query.toLowerCase();

    try {
      // Load all sources in parallel
      var [items, vendors, documents, prfs] = await Promise.all([
        _loadData('items'),
        _loadData('vendors'),
        _loadData('documents'),
        _loadData('prfs')
      ]);

      // Filter
      var matchedItems = items.filter(function(it) {
        var code = String(it.item_code || '').toLowerCase();
        var desc = String(it.description || '').toLowerCase();
        return code.indexOf(q) !== -1 || desc.indexOf(q) !== -1;
      }).slice(0, 8);

      var matchedVendors = vendors.filter(function(v) {
        return String(v.name || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 5);

      var matchedMrif = [], matchedMrr = [], matchedMrs = [];
      documents.forEach(function(d) {
        var docNo = String(d.doc_no || '').toLowerCase();
        var req = String(d.requestor || '').toLowerCase();
        var jo = String(d.jo_no || '').toLowerCase();
        var po = String(d.po_no || '').toLowerCase();
        var vend = String(d.vendor || '').toLowerCase();
        
        if (docNo.indexOf(q) === -1 && req.indexOf(q) === -1 &&
            jo.indexOf(q) === -1 && po.indexOf(q) === -1 && vend.indexOf(q) === -1) return;

        var type = String(d.doc_type || '').toUpperCase();
        var item = {
          docNo: d.doc_no,
          type: type,
          status: d.status || 'PENDING',
          requestor: d.requestor || '',
          joNo: d.jo_no || '',
          createdAt: d.created_at,
          itemCount: d.item_count || 0
        };

        if (type === 'MRIF' && matchedMrif.length < 5) matchedMrif.push(item);
        else if (type === 'MRR' && matchedMrr.length < 5) matchedMrr.push(item);
        else if (type === 'MRS' && matchedMrs.length < 5) matchedMrs.push(item);
      });

      var matchedPrf = prfs.filter(function(p) {
        var no = String(p.prf_no || '').toLowerCase();
        var base = String(p.base_prf_no || '').toLowerCase();
        var req = String(p.requestor || '').toLowerCase();
        var cat = String(p.category || '').toLowerCase();
        return no.indexOf(q) !== -1 || base.indexOf(q) !== -1 ||
               req.indexOf(q) !== -1 || cat.indexOf(q) !== -1;
      }).slice(0, 5);

      _gs.results = {
        items: matchedItems,
        vendors: matchedVendors,
        mrif: matchedMrif,
        mrr: matchedMrr,
        mrs: matchedMrs,
        prf: matchedPrf
      };

      _buildFlatResults();
      _renderResults(query);

      // Save to recent (only if may results)
      var total = _gs.flatResults.length;
      if (total > 0) {
        _saveRecent(query);
      }

    } catch (err) {
      console.error('[GlobalSearch]', err);
      results.innerHTML = '<div class="gs-empty">' +
        '<i class="bi bi-exclamation-triangle text-danger"></i>' +
        '<div class="gs-empty-title">Search failed</div>' +
        '<div class="gs-empty-hint">' + _esc(err.message) + '</div>' +
        '</div>';
    }
  }

  function _buildFlatResults() {
    _gs.flatResults = [];
    var r = _gs.results;

    r.items.forEach(function(it) {
      _gs.flatResults.push({
        type: 'item',
        item_code: it.item_code,
        description: it.description,
        category: it.category,
        location: it.location,
        on_hand: it.on_hand
      });
    });

    r.mrif.forEach(function(d) { _gs.flatResults.push({ type: 'MRIF', doc: d }); });
    r.mrr.forEach(function(d) { _gs.flatResults.push({ type: 'MRR', doc: d }); });
    r.mrs.forEach(function(d) { _gs.flatResults.push({ type: 'MRS', doc: d }); });
    r.prf.forEach(function(p) { _gs.flatResults.push({ type: 'PRF', prf: p }); });
    r.vendors.forEach(function(v) { _gs.flatResults.push({ type: 'vendor', name: v.name }); });
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER RESULTS
  // ═══════════════════════════════════════════════════════════
  function _renderResults(query) {
    var container = document.getElementById('gsResults');
    if (!container) return;

    var r = _gs.results;
    var total = _gs.flatResults.length;

    if (total === 0) {
      container.innerHTML = '<div class="gs-empty">' +
        '<i class="bi bi-inbox"></i>' +
        '<div class="gs-empty-title">No results for "' + _esc(query) + '"</div>' +
        '<div class="gs-empty-hint">Try different keywords or check spelling</div>' +
        '</div>';
      _updateResultCount(0);
      return;
    }

    var q = query.toLowerCase();
    var html = '';
    var flatIdx = 0;

    // ═══ ITEMS ═══
    if (r.items.length > 0) {
      html += '<div class="gs-section-label">' +
        '<i class="bi bi-box-seam"></i>Items <span class="gs-count">' + r.items.length + '</span>' +
        '</div>';
      r.items.forEach(function(it) {
        html += '<div class="gs-item' + (_gs.selectedIndex === flatIdx ? ' selected' : '') + '" ' +
          'data-action="item" data-code="' + _escAttr(it.item_code) + '" data-idx="' + flatIdx + '">' +
          '<div class="gs-item-icon icon-item"><i class="bi bi-box-seam"></i></div>' +
          '<div class="gs-item-body">' +
            '<div class="gs-item-title">' + _highlight(it.item_code, q) + '</div>' +
            '<div class="gs-item-subtitle">' + _highlight(it.description || '', q) + 
              (it.category ? ' · ' + _esc(it.category) : '') +
              (it.on_hand !== undefined ? ' · On-Hand: ' + _esc(String(it.on_hand)) : '') +
            '</div>' +
          '</div>' +
        '</div>';
        flatIdx++;
      });
    }

    // ═══ PRF ═══
    if (r.prf.length > 0) {
      html += '<div class="gs-section-label">' +
        '<i class="bi bi-file-earmark-text"></i>PRF <span class="gs-count">' + r.prf.length + '</span>' +
        '</div>';
      r.prf.forEach(function(p) {
        var vBadge = (parseInt(p.version_number, 10) || 1) > 1 
          ? ' <span class="badge bg-warning text-dark" style="font-size:0.6rem;">v' + p.version_number + '</span>' 
          : '';
        html += '<div class="gs-item' + (_gs.selectedIndex === flatIdx ? ' selected' : '') + '" ' +
          'data-action="prf" data-id="' + p.id + '" data-idx="' + flatIdx + '">' +
          '<div class="gs-item-icon icon-prf"><i class="bi bi-file-earmark-text"></i></div>' +
          '<div class="gs-item-body">' +
            '<div class="gs-item-title">' + _highlight(p.prf_no, q) + vBadge + '</div>' +
            '<div class="gs-item-subtitle">' + _esc(p.requestor || '') + 
              ' · ' + _esc(p.category || '') +
              ' · ' + (p.total_items || 0) + ' items' +
            '</div>' +
          '</div>' +
          '<span class="gs-item-badge gs-badge-info">' + (p.total_qty || 0) + ' qty</span>' +
        '</div>';
        flatIdx++;
      });
    }

    // ═══ MRIF ═══
    if (r.mrif.length > 0) {
      html += '<div class="gs-section-label">' +
        '<i class="bi bi-box-arrow-up-right"></i>MRIF <span class="gs-count">' + r.mrif.length + '</span>' +
        '</div>';
      r.mrif.forEach(function(d) {
        html += _buildDocResultRow('MRIF', d, q, flatIdx);
        flatIdx++;
      });
    }

    // ═══ MRR ═══
    if (r.mrr.length > 0) {
      html += '<div class="gs-section-label">' +
        '<i class="bi bi-box-arrow-in-down"></i>MRR <span class="gs-count">' + r.mrr.length + '</span>' +
        '</div>';
      r.mrr.forEach(function(d) {
        html += _buildDocResultRow('MRR', d, q, flatIdx);
        flatIdx++;
      });
    }

    // ═══ MRS ═══
    if (r.mrs.length > 0) {
      html += '<div class="gs-section-label">' +
        '<i class="bi bi-arrow-counterclockwise"></i>MRS <span class="gs-count">' + r.mrs.length + '</span>' +
        '</div>';
      r.mrs.forEach(function(d) {
        html += _buildDocResultRow('MRS', d, q, flatIdx);
        flatIdx++;
      });
    }

    // ═══ VENDORS ═══
    if (r.vendors.length > 0) {
      html += '<div class="gs-section-label">' +
        '<i class="bi bi-shop"></i>Vendors <span class="gs-count">' + r.vendors.length + '</span>' +
        '</div>';
      r.vendors.forEach(function(v) {
        html += '<div class="gs-item' + (_gs.selectedIndex === flatIdx ? ' selected' : '') + '" ' +
          'data-action="vendor" data-name="' + _escAttr(v.name) + '" data-idx="' + flatIdx + '">' +
          '<div class="gs-item-icon icon-vendor"><i class="bi bi-shop"></i></div>' +
          '<div class="gs-item-body">' +
            '<div class="gs-item-title" style="font-family:inherit;">' + _highlight(v.name, q) + '</div>' +
            '<div class="gs-item-subtitle">Vendor</div>' +
          '</div>' +
        '</div>';
        flatIdx++;
      });
    }

    container.innerHTML = html;
    _bindResultClicks();
    _updateResultCount(total);
    _scrollToSelected();
  }

  function _buildDocResultRow(type, doc, q, flatIdx) {
    var statusUpper = String(doc.status || 'PENDING').toUpperCase();
    var badgeClass = 'gs-badge-pending';
    if (statusUpper === 'SERVED' || statusUpper === 'COMPLETED') badgeClass = 'gs-badge-served';
    else if (statusUpper === 'PARTIAL') badgeClass = 'gs-badge-partial';

    var iconClass = 'icon-' + type.toLowerCase();

    return '<div class="gs-item' + (_gs.selectedIndex === flatIdx ? ' selected' : '') + '" ' +
      'data-action="doc" data-doc="' + _escAttr(doc.docNo) + '" data-type="' + type + '" data-idx="' + flatIdx + '">' +
      '<div class="gs-item-icon ' + iconClass + '"><i class="bi bi-file-earmark-text"></i></div>' +
      '<div class="gs-item-body">' +
        '<div class="gs-item-title">' + _highlight(doc.docNo, q) + '</div>' +
        '<div class="gs-item-subtitle">' + _esc(doc.requestor || '') + 
          (doc.joNo ? ' · JO: ' + _esc(doc.joNo) : '') +
          ' · ' + (doc.itemCount || 0) + ' items' +
        '</div>' +
      '</div>' +
      '<span class="gs-item-badge ' + badgeClass + '">' + statusUpper + '</span>' +
    '</div>';
  }

  function _bindResultClicks() {
    document.querySelectorAll('.gs-item').forEach(function(el) {
      el.addEventListener('click', function() {
        var action = this.getAttribute('data-action');

        if (action === 'recent') {
          var term = this.getAttribute('data-term');
          document.getElementById('gsInput').value = term;
          _gs.query = term;
          _performSearch(term);
          return;
        }

        if (action === 'item') {
          var code = this.getAttribute('data-code');
          closeSearch();
          window.location.href = 'item-in-out.html?code=' + encodeURIComponent(code);
          return;
        }

        if (action === 'doc') {
          var doc = this.getAttribute('data-doc');
          var type = this.getAttribute('data-type');
          closeSearch();
          var map = {
            'MRIF': 'mrif-list.html',
            'MRR': 'mrr-list.html',
            'MRS': 'mrs-list.html'
          };
          window.location.href = (map[type] || 'all-requests.html') + '?highlight=' + encodeURIComponent(doc);
          return;
        }

        if (action === 'prf') {
          closeSearch();
          window.location.href = 'prf-monitor.html?prf=' + this.getAttribute('data-id');
          return;
        }

        if (action === 'vendor') {
          closeSearch();
          erpShowToast('Vendor: ' + this.getAttribute('data-name'), 'info');
          return;
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // KEYBOARD NAVIGATION
  // ═══════════════════════════════════════════════════════════
  function _handleKeydown(e) {
    if (!_gs.isOpen) {
      // Global shortcut
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openSearch();
      }
      return;
    }

    // ESC
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      return;
    }

    // Arrow Down
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _gs.selectedIndex = Math.min(_gs.selectedIndex + 1, _gs.flatResults.length - 1);
      _updateSelection();
      return;
    }

    // Arrow Up
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _gs.selectedIndex = Math.max(_gs.selectedIndex - 1, 0);
      _updateSelection();
      return;
    }

    // Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      var selected = document.querySelector('.gs-item.selected');
      if (selected) selected.click();
      return;
    }
  }

  function _updateSelection() {
    document.querySelectorAll('.gs-item').forEach(function(el) {
      var idx = parseInt(el.getAttribute('data-idx'), 10);
      if (idx === _gs.selectedIndex) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
    _scrollToSelected();
  }

  function _scrollToSelected() {
    var selected = document.querySelector('.gs-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RECENT SEARCHES
  // ═══════════════════════════════════════════════════════════
  function _getRecent() {
    try {
      var raw = localStorage.getItem(_gs.recentKey);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
  }

  function _saveRecent(term) {
    if (!term || term.length < 2) return;
    try {
      var arr = _getRecent();
      // Remove duplicates
      arr = arr.filter(function(t) { return t !== term; });
      arr.unshift(term);
      // Limit
      arr = arr.slice(0, _gs.maxRecent);
      localStorage.setItem(_gs.recentKey, JSON.stringify(arr));
    } catch(e) {}
  }

  function _removeRecent(term) {
    try {
      var arr = _getRecent();
      arr = arr.filter(function(t) { return t !== term; });
      localStorage.setItem(_gs.recentKey, JSON.stringify(arr));
      _renderInitial();
    } catch(e) {}
  }

  function _clearRecent() {
    try {
      localStorage.removeItem(_gs.recentKey);
      _renderInitial();
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  }

  function _highlight(text, query) {
    if (!text || !query) return _esc(text);
    var escaped = _esc(text);
    var q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp('(' + q + ')', 'gi');
    return escaped.replace(regex, '<mark>$1</mark>');
  }

  function _updateResultCount(n) {
    var el = document.getElementById('gsResultCount');
    if (el) el.textContent = n;
  }

  // ═══════════════════════════════════════════════════════════
  // GLOBAL KEYBOARD
  // ═══════════════════════════════════════════════════════════
  document.addEventListener('keydown', _handleKeydown);

  // ═══════════════════════════════════════════════════════════
  // EXPOSE GLOBALLY
  // ═══════════════════════════════════════════════════════════
  window.erpOpenSearch = openSearch;
  window.erpCloseSearch = closeSearch;
  window.erpClearRecentSearches = _clearRecent;
  window.erpRemoveRecent = _removeRecent;

  console.log('✅ global-search.js v1.0 loaded (⌘K/Ctrl+K)');

})();
