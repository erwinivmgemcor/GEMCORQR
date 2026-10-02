// ============================================================
// GEMCOR ERP — Supabase API Layer
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
// STOCK SUMMARY — KPI cards
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
// ALL ITEMS — table data
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
// ITEM MOVEMENTS (ledger)
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
// REORDER LIST — for PR
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
// WEEKLY MOVEMENT — monitoring
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
// CATEGORY STATS — for charts
// ═══════════════════════════════════════════════════════════
async function erpGetCategoryStats() {
  try {
    var rows = await erpFetch('erp_items',
      'select=category,on_hand,unit_cost,abc_classification,inventory_movement');
    
    var byCategory = {};
    var byABC = { A: 0, B: 0, C: 0, 'N/A': 0 };
    var byMovement = {};
    var byLocation = {};
    
    (rows || []).forEach(function(it) {
      // Category
      var cat = it.category || 'UNCATEGORIZED';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, value: 0, units: 0 };
      byCategory[cat].count++;
      byCategory[cat].value += Number(it.on_hand || 0) * Number(it.unit_cost || 0);
      byCategory[cat].units += Number(it.on_hand || 0);
      
      // ABC
      var abc = String(it.abc_classification || 'N/A').toUpperCase();
      if (byABC[abc] === undefined) byABC[abc] = 0;
      byABC[abc] += Number(it.on_hand || 0) * Number(it.unit_cost || 0);
      
      // Movement
      var mov = String(it.inventory_movement || 'UNCLASSIFIED').toUpperCase();
      if (!byMovement[mov]) byMovement[mov] = 0;
      byMovement[mov]++;
    });
    
    return {
      success: true,
      byCategory: byCategory,
      byABC: byABC,
      byMovement: byMovement
    };
  } catch(err) {
    console.error('[erpGetCategoryStats]', err);
    return { success: false, error: err.message, byCategory: {}, byABC: {}, byMovement: {} };
  }
}

// ═══════════════════════════════════════════════════════════
// SOF LOOKUP — for MRIF auto-fill
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
// PRF PO LOOKUP — for MRR auto-fill
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
// DISTINCT FILTER VALUES
// ═══════════════════════════════════════════════════════════
async function erpGetDistinctValues(column) {
  try {
    var rows = await erpFetch('erp_items',
      'select=' + column + '&' + column + '=not.is.null&order=' + column + '.asc');
    var seen = {};
    var values = [];
    (rows || []).forEach(function(r) {
      var v = r[column];
      if (v && !seen[v]) {
        seen[v] = true;
        values.push(v);
      }
    });
    return { success: true, values: values };
  } catch(err) {
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
    return {
      success: res.ok,
      latency: Date.now() - t0
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

console.log('✅ erp-supabase.js loaded');
