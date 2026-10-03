// ============================================================
// GEMCOR ERP — Supabase API Layer (v2)
// All reads/writes to erp_* tables
// ============================================================

// ═══════════════════════════════════════════════════════════
// CORE FETCH
// ═══════════════════════════════════════════════════════════
async function erpFetch(table, query, opts) {
  opts = opts || {};
  var url = erpUrl(table);
  if (query) url += '?' + query;
  
  var res = await fetch(url, {
    method: opts.method || 'GET',
    headers: erpHeaders(opts.headers),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store'
  });
  
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('ERP API ' + table + ' failed: ' + res.status + ' ' + errText);
  }
  
  if (opts.method === 'DELETE') return { success: true };
  return await res.json();
}

// ═══════════════════════════════════════════════════════════
// STOCK SUMMARY
// ═══════════════════════════════════════════════════════════
async function erpGetStockSummary(force) {
  var cacheKey = 'stock_summary';
  if (!force) {
    var cached = erpGetCache(cacheKey);
    if (cached) return { success: true, summary: cached, _cached: true };
  }
  
  try {
    var rows = await erpFetch('erp_v_stock_summary', 'select=*&limit=1');
    var summary = rows[0] || {};
    erpSetCache(cacheKey, summary, ERP_CACHE_TTL.STOCK_SUMMARY);
    return { success: true, summary: summary };
  } catch(err) {
    console.error('[erpGetStockSummary]', err);
    return { success: false, error: err.message, summary: {} };
  }
}

// ═══════════════════════════════════════════════════════════
// ALL ITEMS
// ═══════════════════════════════════════════════════════════
async function erpGetAllItems(filters) {
  filters = filters || {};
  var query = 'select=*&order=item_code.asc';
  var limit = filters.limit || 5000;
  query += '&limit=' + limit;
  
  if (filters.category) query += '&category=eq.' + encodeURIComponent(filters.category);
  if (filters.location) query += '&location=eq.' + encodeURIComponent(filters.location);
  if (filters.movement) query += '&inventory_movement=eq.' + encodeURIComponent(filters.movement);
  if (filters.abc) query += '&abc_classification=eq.' + encodeURIComponent(filters.abc);
  if (filters.isActive !== undefined) query += '&is_active=eq.' + filters.isActive;
  if (filters.search) {
    query += '&or=(item_code.ilike.*' + encodeURIComponent(filters.search) + '*,description.ilike.*' + encodeURIComponent(filters.search) + '*)';
  }
  
  try {
    var rows = await erpFetch('erp_items', query);
    return { success: true, items: rows || [], count: (rows || []).length };
  } catch(err) {
    console.error('[erpGetAllItems]', err);
    return { success: false, error: err.message, items: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// ITEM DETAILS
// ═══════════════════════════════════════════════════════════
async function erpGetItemDetails(itemCode) {
  try {
    var rows = await erpFetch('erp_items', 'item_code=eq.' + encodeURIComponent(itemCode) + '&limit=1');
    if (!rows || rows.length === 0) return { success: false, error: 'Item not found' };
    return { success: true, item: rows[0] };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// ITEM MOVEMENTS
// ═══════════════════════════════════════════════════════════
async function erpGetItemMovements(itemCode, limit) {
  limit = limit || 50;
  try {
    var rows = await erpFetch('erp_stock_ledger',
      'item_code=eq.' + encodeURIComponent(itemCode) +
      '&order=transaction_date.desc&limit=' + limit);
    return { success: true, movements: rows || [] };
  } catch(err) {
    return { success: false, error: err.message, movements: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// REORDER LIST
// ═══════════════════════════════════════════════════════════
async function erpGetReorderList(force) {
  var cacheKey = 'reorder_list';
  if (!force) {
    var cached = erpGetCache(cacheKey);
    if (cached) return { success: true, items: cached, _cached: true };
  }
  
  try {
    var rows = await erpFetch('erp_v_reorder_list', 'select=*');
    erpSetCache(cacheKey, rows, ERP_CACHE_TTL.REORDER);
    return { success: true, items: rows || [] };
  } catch(err) {
    console.error('[erpGetReorderList]', err);
    return { success: false, error: err.message, items: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// WEEKLY MOVEMENT (view-based)
// ═══════════════════════════════════════════════════════════
async function erpGetWeeklyMovement(force) {
  var cacheKey = 'weekly_movement';
  if (!force) {
    var cached = erpGetCache(cacheKey);
    if (cached) return { success: true, items: cached, _cached: true };
  }
  
  try {
    var rows = await erpFetch('erp_v_weekly_movement', 'select=*&limit=5000');
    erpSetCache(cacheKey, rows, ERP_CACHE_TTL.WEEKLY);
    return { success: true, items: rows || [] };
  } catch(err) {
    console.error('[erpGetWeeklyMovement]', err);
    return { success: false, error: err.message, items: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// ★ NEW: WEEKLY DATA FOR SPECIFIC WEEK (Mon-Sun)
// Aggregates from erp_stock_ledger + erp_items
// ═══════════════════════════════════════════════════════════
async function erpGetWeeklyData(weekStartISO, weekEndISO) {
  try {
    // 1. Fetch all items (for metadata: desc, category, location, unit)
    var items = await erpFetch('erp_items',
      'select=item_code,description,category,location,base_unit,on_hand,unit_cost,abc_classification,inventory_movement&is_active=eq.true&limit=10000');
    
    // 2. Fetch all ledger entries within the week
    var ledger = await erpFetch('erp_stock_ledger',
      'select=item_code,qty_in,qty_out,transaction_type,transaction_date,balance_before,balance_after' +
      '&transaction_date=gte.' + encodeURIComponent(weekStartISO) +
      '&transaction_date=lt.' + encodeURIComponent(weekEndISO) +
      '&order=transaction_date.asc&limit=50000');
    
    // 3. Build map: item_code → {in, out, opening, closing, tx count}
    var movementMap = {};
    
    (ledger || []).forEach(function(tx) {
      var code = tx.item_code;
      if (!movementMap[code]) {
        movementMap[code] = {
          in: 0,
          out: 0,
          opening: Number(tx.balance_before || 0),
          closing: Number(tx.balance_after || 0),
          txCount: 0,
          firstTxDate: tx.transaction_date,
          lastTxDate: tx.transaction_date
        };
      }
      movementMap[code].in += Number(tx.qty_in || 0);
      movementMap[code].out += Number(tx.qty_out || 0);
      movementMap[code].closing = Number(tx.balance_after || 0);
      movementMap[code].txCount++;
      movementMap[code].lastTxDate = tx.transaction_date;
    });
    
    // 4. Combine items + movement
    var result = (items || []).map(function(it) {
      var mov = movementMap[it.item_code] || {
        in: 0, out: 0, opening: null, closing: null, txCount: 0
      };
      
      return {
        item_code: it.item_code,
        description: it.description,
        category: it.category,
        location: it.location,
        base_unit: it.base_unit,
        unit_cost: Number(it.unit_cost || 0),
        abc_classification: it.abc_classification,
        inventory_movement: it.inventory_movement,
        current_on_hand: Number(it.on_hand || 0),
        opening: mov.opening !== null ? mov.opening : Number(it.on_hand || 0),
        qty_in: mov.in,
        qty_out: mov.out,
        closing: mov.closing !== null ? mov.closing : Number(it.on_hand || 0),
        tx_count: mov.txCount
      };
    });
    
    return { success: true, items: result };
  } catch(err) {
    console.error('[erpGetWeeklyData]', err);
    return { success: false, error: err.message, items: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════
async function erpGetActiveAlerts(force) {
  var cacheKey = 'active_alerts';
  if (!force) {
    var cached = erpGetCache(cacheKey);
    if (cached) return { success: true, alerts: cached, _cached: true };
  }
  
  try {
    var rows = await erpFetch('erp_alerts',
      'is_resolved=eq.false&order=severity.desc,created_at.desc&limit=200');
    erpSetCache(cacheKey, rows, ERP_CACHE_TTL.ALERTS);
    return { success: true, alerts: rows || [] };
  } catch(err) {
    console.error('[erpGetActiveAlerts]', err);
    return { success: false, error: err.message, alerts: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// CATEGORY STATS
// ═══════════════════════════════════════════════════════════
async function erpGetCategoryStats() {
  try {
    var rows = await erpFetch('erp_items',
      'select=category,on_hand,unit_cost,abc_classification,inventory_movement');
    
    var byCategory = {};
    var byABC = { A: 0, B: 0, C: 0, 'N/A': 0 };
    var byMovement = {};
    
    (rows || []).forEach(function(it) {
      var cat = it.category || 'UNCATEGORIZED';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, value: 0, units: 0 };
      byCategory[cat].count++;
      byCategory[cat].value += Number(it.on_hand || 0) * Number(it.unit_cost || 0);
      byCategory[cat].units += Number(it.on_hand || 0);
      
      var abc = String(it.abc_classification || 'N/A').toUpperCase();
      if (byABC[abc] === undefined) byABC[abc] = 0;
      byABC[abc] += Number(it.on_hand || 0) * Number(it.unit_cost || 0);
      
      var mov = String(it.inventory_movement || 'UNCLASSIFIED').toUpperCase();
      if (!byMovement[mov]) byMovement[mov] = 0;
      byMovement[mov]++;
    });
    
    return { success: true, byCategory: byCategory, byABC: byABC, byMovement: byMovement };
  } catch(err) {
    console.error('[erpGetCategoryStats]', err);
    return { success: false, error: err.message, byCategory: {}, byABC: {}, byMovement: {} };
  }
}

// ═══════════════════════════════════════════════════════════
// SOF LOOKUP
// ═══════════════════════════════════════════════════════════
async function erpGetSofByJo(joNo) {
  try {
    var rows = await erpFetch('erp_sof_cache', 'jo_no=eq.' + encodeURIComponent(joNo) + '&limit=1');
    if (!rows || rows.length === 0) return { success: false, error: 'Not found' };
    return { success: true, sof: rows[0] };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// PRF PO LOOKUP
// ═══════════════════════════════════════════════════════════
async function erpGetPrfPoByPo(poNo) {
  try {
    var rows = await erpFetch('erp_prf_po_cache',
      'po_no=eq.' + encodeURIComponent(poNo) + '&order=item_no.asc');
    if (!rows || rows.length === 0) return { success: false, error: 'Not found' };
    return { success: true, items: rows, total: rows.length };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// DISTINCT VALUES
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// DISTINCT VALUES — Fetch from appropriate table
// ═══════════════════════════════════════════════════════════
async function erpGetDistinctValues(column) {
  // Determine which table to query based on column
  // requestor / department / status / doc_type → erp_documents
  // category / location / movement / abc → erp_items
  
  var docColumns = ['requestor', 'department', 'status', 'doc_type', 'jo_no', 'gem_so_no', 'client_name', 'project', 'po_no', 'vendor', 'dr_no', 'prepared_by'];
  var itemColumns = ['category', 'location', 'inventory_movement', 'abc_classification', 'stock_classification', 'base_unit'];
  
  var table = null;
  if (docColumns.indexOf(column) !== -1) table = 'erp_documents';
  else if (itemColumns.indexOf(column) !== -1) table = 'erp_items';
  else {
    console.warn('[erpGetDistinctValues] Unknown column:', column);
    return { success: false, error: 'Unknown column', values: [] };
  }
  
  try {
    var rows = await erpFetch(table,
      'select=' + column + '&' + column + '=not.is.null&order=' + column + '.asc&limit=5000');
    
    var seen = {};
    var values = [];
    (rows || []).forEach(function(r) {
      var v = r[column];
      if (v && String(v).trim() && !seen[v]) {
        seen[v] = true;
        values.push(v);
      }
    });
    
    return { success: true, values: values };
  } catch(err) {
    console.warn('[erpGetDistinctValues]', column, err.message);
    return { success: false, error: err.message, values: [] };
  }
}
// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════
async function erpHealthCheck() {
  try {
    var t0 = Date.now();
    var res = await fetch(erpUrl('erp_items') + '?select=id&limit=1', {
      headers: erpHeaders()
    });
    return { success: res.ok, latency: Date.now() - t0 };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

console.log('✅ erp-supabase.js loaded — v2');
