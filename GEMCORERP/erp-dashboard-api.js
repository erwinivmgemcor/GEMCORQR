// ============================================================
// GEMCOR ERP — Management Dashboard API Layer
// Fetches data from Supabase RPC functions
// ============================================================

var _dashboardCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000  // 5 minutes
};

// ═══════════════════════════════════════════════════════════
// MAIN FUNCTION — Fetch complete dashboard data
// ═══════════════════════════════════════════════════════════
async function erpGetManagementDashboard(opts) {
  opts = opts || {};
  
  var fromDate = opts.fromDate || _getDefaultFromDate(opts.monthFilter);
  var toDate = opts.toDate || new Date().toISOString().slice(0, 10);
  var category = opts.category || null;
  var stockClass = opts.stockClass || null;
  var location = opts.location || null;
  
  // Cache check (only if no filters or same filters)
  var cacheKey = [fromDate, toDate, category, stockClass, location].join('|');
  if (_dashboardCache.data && 
      _dashboardCache.cacheKey === cacheKey && 
      (Date.now() - _dashboardCache.timestamp) < _dashboardCache.ttl) {
    console.log('[Dashboard] Using cache');
    return _dashboardCache.data;
  }
  
  try {
    var t0 = Date.now();
    
    // Call Supabase RPC
    var res = await fetch(erpUrl('rpc/erp_get_management_dashboard'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_from_date: fromDate,
        p_to_date: toDate,
        p_category: category,
        p_stock_class: stockClass,
        p_location: location
      })
    });
    
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('RPC failed: ' + res.status + ' ' + errText.substring(0, 200));
    }
    
    var data = await res.json();
    
    console.log('[Dashboard] Loaded in ' + (Date.now() - t0) + 'ms');
    
    // Cache result
    _dashboardCache = {
      data: data,
      cacheKey: cacheKey,
      timestamp: Date.now(),
      ttl: 5 * 60 * 1000
    };
    
    return data;
    
  } catch(err) {
    console.error('[erpGetManagementDashboard]', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function _getDefaultFromDate(monthFilter) {
  // If month specified, use that month's start
  if (monthFilter && monthFilter !== 'all' && monthFilter !== '') {
    var parts = monthFilter.split('-'); // format: 'YYYY-MM'
    if (parts.length === 2) {
      return parts[0] + '-' + parts[1] + '-01';
    }
  }
  // Default: 30 days ago
  var d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function _getDefaultToDate(monthFilter) {
  // If month specified, use that month's end
  if (monthFilter && monthFilter !== 'all' && monthFilter !== '') {
    var parts = monthFilter.split('-');
    if (parts.length === 2) {
      var lastDay = new Date(parseInt(parts[0]), parseInt(parts[1]), 0).getDate();
      return parts[0] + '-' + parts[1] + '-' + String(lastDay).padStart(2, '0');
    }
  }
  return new Date().toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// INDIVIDUAL FETCHERS (for targeted queries)
// ═══════════════════════════════════════════════════════════

async function erpGetTurnoverRatio(fromDate, toDate) {
  try {
    var res = await fetch(erpUrl('rpc/erp_get_turnover_ratio'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_from_date: fromDate || null,
        p_to_date: toDate || null
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return { success: true, data: data };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

async function erpGetInventoryAccuracy() {
  try {
    var res = await fetch(erpUrl('rpc/erp_get_inventory_accuracy'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return { success: true, data: data };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

async function erpGetPeriodActivity(fromDate, toDate, category, location) {
  try {
    var res = await fetch(erpUrl('rpc/erp_get_period_activity'), {
      method: 'POST',
      headers: erpHeaders(),
      body: JSON.stringify({
        p_from_date: fromDate || null,
        p_to_date: toDate || null,
        p_category: category || null,
        p_location: location || null
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    return { success: true, data: data };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// FILTER OPTIONS
// ═══════════════════════════════════════════════════════════

async function erpGetDashboardFilterOptions() {
  try {
    // Fetch categories, locations, stock classes
    var [catRows, locRows, stockRows] = await Promise.all([
      erpFetch('erp_items', 'select=category&category=not.is.null&is_active=eq.true&limit=5000'),
      erpFetch('erp_items', 'select=location&location=not.is.null&is_active=eq.true&limit=5000'),
      erpFetch('erp_items', 'select=stock_classification&stock_classification=not.is.null&is_active=eq.true&limit=5000')
    ]);
    
    var categories = _uniqueSorted(catRows, 'category');
    var locations = _uniqueSorted(locRows, 'location');
    var stockClasses = _uniqueSorted(stockRows, 'stock_classification');
    
    return {
      success: true,
      categories: categories,
      locations: locations,
      stockClasses: stockClasses
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

function _uniqueSorted(rows, column) {
  var seen = {};
  var values = [];
  (rows || []).forEach(function(r) {
    var v = String(r[column] || '').trim();
    if (v && !seen[v]) {
      seen[v] = true;
      values.push(v);
    }
  });
  return values.sort();
}

// ═══════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════
console.log('✅ erp-dashboard-api.js loaded');
